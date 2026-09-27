import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';
import { z } from 'zod';
import { estadoInicial, type Estado } from '../negocio/estado';
export const directorioDatos = () =>
  resolve(/* turbopackIgnore: true */ process.env.NELTUME_DATA_DIR ?? 'data');
export class ErrorOcupado extends Error {
  constructor() {
    super(
      'Otra operación está en curso. Espera unos segundos y vuelve a intentar; tu borrador está guardado.',
    );
    this.name = 'ErrorOcupado';
  }
}
// Validación estructural mínima: detecta un archivo ajeno o truncado sin reescribir los contadores.
const estadoSchema = z.object({
  siguienteCotizacion: z.number().int().positive(),
  siguienteNota: z.number().int().positive(),
  cotizaciones: z.array(
    z.looseObject({
      id: z.string(),
      numero: z.number().int().nullable(),
      estado: z.enum(['borrador', 'emitida', 'aprobada']),
    }),
  ),
});
async function sincronizar(ruta: string) {
  const fh = await open(ruta, 'r');
  try {
    await fh.sync();
  } catch {
    // Algunos sistemas no permiten fsync sobre directorios; el archivo ya quedó sincronizado.
  } finally {
    await fh.close();
  }
}
export class Almacen {
  constructor(public directorio = directorioDatos()) {}
  async leer(): Promise<Estado> {
    let texto: string;
    try {
      texto = await readFile(join(this.directorio, 'estado.json'), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return estadoInicial();
      throw errorLectura();
    }
    let datos: unknown;
    try {
      datos = JSON.parse(texto);
    } catch {
      throw errorLectura();
    }
    if (!estadoSchema.safeParse(datos).success) throw errorLectura();
    return datos as Estado;
  }
  async guardar(estado: Estado) {
    const destino = join(this.directorio, 'estado.json'),
      temporal = `${destino}.${randomUUID()}.tmp`;
    try {
      const fh = await open(temporal, 'w', 0o600);
      try {
        await fh.writeFile(JSON.stringify(estado, null, 2));
        // Durabilidad antes del rename: un correlativo reservado no debe perderse ante un corte.
        await fh.sync();
      } finally {
        await fh.close();
      }
      await rename(temporal, destino);
      await sincronizar(this.directorio);
    } finally {
      await rm(temporal, { force: true });
    }
  }
  async transaccion<T>(fn: (estado: Estado, guardar: () => Promise<void>) => Promise<T>): Promise<T> {
    await mkdir(this.directorio, { recursive: true });
    let release: () => Promise<void>;
    try {
      release = await lockfile.lock(this.directorio, {
        realpath: false,
        lockfilePath: join(this.directorio, '.estado.lock'),
        stale: 30000,
        retries: { retries: 60, minTimeout: 100, maxTimeout: 500 },
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ELOCKED') throw new ErrorOcupado();
      throw e;
    }
    try {
      const estado = await this.leer();
      const resultado = await fn(estado, () => this.guardar(estado));
      await this.guardar(estado);
      return resultado;
    } finally {
      await release();
    }
  }
}
const errorLectura = () =>
  new Error('No se pudo leer estado.json. Restaura una copia válida; no se reiniciaron los contadores.');
