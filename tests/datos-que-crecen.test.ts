import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { clienteVacio, type Catalogo, type Producto, type SolicitudItem } from '../src/catalogo/tipos';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { abrirBaseDatos } from '../src/servidor/base-datos';
import { guardarConfiguracionNegocio, leerConfiguracionNegocio } from '../src/servidor/configuracion-negocio';
import { Servicio } from '../src/servidor/servicio';

// Datos que crecen (docs/verificacion-pendiente.md §2): el snapshot de cada documento no repite el logo en base64, y
// la limpieza diaria purga lo que ya no se usa.

// Chromium simulado: el «PDF» es el HTML que recibió la página, para comparar lo impreso en cada generación.
vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn(async () => ({
      on: () => {},
      close: async () => {},
      newPage: async () => {
        let contenido = '';
        return {
          close: async () => {},
          setDefaultTimeout: () => {},
          route: async () => {},
          setContent: async (html: string) => {
            contenido = html;
          },
          evaluate: async () => {},
          pdf: async ({ path }: { path: string }) => {
            const { writeFile: escribir } = await import('node:fs/promises');
            await escribir(path, contenido);
          },
        };
      },
    })),
  },
}));
const { cerrarNavegadorPdf, compactarLogo, referenciaLogo } = await import('../src/servidor/pdf');
const limpieza = await import('../src/servidor/limpieza');

const molco: Producto = {
  codigo: 'MOL-O-3-A',
  modelo: 'MOLCO',
  familia: 'PUERTA',
  tipo: 'PUERTA PANEL',
  madera: 'PINO OREGON',
  medida: '0,80 A 0,85',
  anchoMin: 0.8,
  anchoMax: 0.85,
  largo: 2,
  precioNeto: 100_000,
  descripcion: 'MOLCO',
  filaOrigen: 4,
};
const catalogo: Catalogo = { fuente: 'test', sha256: 'test', fecha: '2026-01-01', productos: [molco] };
const pedido: SolicitudItem = { modelo: 'MOLCO', madera: 'PINO OREGON', ancho: 0.82, alto: 2, medida: null, cantidad: 2, tipoMedida: 'hoja' };
const DIA = 86_400_000;
const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#324536"/></svg>';
const OTRO_LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="#8a5a37"/></svg>';
const base64 = (svg: string) => Buffer.from(svg, 'utf8').toString('base64');

const dirs: string[] = [];
afterEach(async () => {
  await cerrarNavegadorPdf();
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-crecen-'));
  dirs.push(dir);
  const almacen = new Almacen(dir);
  const db = almacen.baseDatos();
  const ponerLogo = (svg: string) => {
    const actual = leerConfiguracionNegocio(db);
    guardarConfiguracionNegocio({ ...actual, empresa: { ...actual.empresa, logoSvg: svg } }, db);
  };
  ponerLogo(LOGO);
  const llm = {
    interpretar: vi.fn().mockResolvedValue({
      name: 'actualizar_cotizacion',
      input: { items: [pedido], cliente: { ...clienteVacio(), nombre: 'Ana Soto' } },
    }),
  };
  const servicio = new Servicio(catalogo, llm, almacen, { nombre: 'Paula', email: 'paula@neltume.cl' });
  const emitida = async () => {
    const q = (await servicio.ejecutar({ tipo: 'chat', mensaje: 'cotiza MOLCO' })).cotizacion;
    return (await servicio.ejecutar({ tipo: 'emitir', id: q.id, actualizada: q.actualizada } as never)).cotizacion;
  };
  const sobre = (q: { id: string; actualizada: string }, accion: Record<string, unknown>) =>
    servicio.ejecutar({ ...accion, id: q.id, actualizada: q.actualizada } as never);
  const snapshot = (archivo: string) =>
    (db.prepare('SELECT html FROM documentos_snapshot WHERE archivo = ?').get(archivo) as { html: string } | undefined)
      ?.html;
  return { dir, almacen, db, servicio, emitida, sobre, snapshot, ponerLogo };
}

describe('snapshot de documentos sin el logo en base64', () => {
  it('la emisión imprime el logo pero el snapshot guarda solo una referencia; regenerar da el mismo documento', async () => {
    const t = await setup();
    const q = await t.emitida();
    const ruta = join(t.dir, 'pdf', q.pdf!);
    const original = await readFile(ruta, 'utf8');
    expect(original).toContain(`src="data:image/svg+xml;base64,${base64(LOGO)}"`);

    const snapshot = t.snapshot(q.pdf!)!;
    expect(snapshot).not.toContain('base64');
    expect(snapshot).toContain(`src="${referenciaLogo(Buffer.from(LOGO))}"`);
    expect(snapshot.length).toBeLessThan(original.length);

    await rm(ruta);
    const r = await t.sobre(q, { tipo: 'regenerar_pdf', documento: 'cotizacion' });
    expect(r).toMatchObject({ archivo: q.pdf, avisos: [] });
    expect(await readFile(ruta, 'utf8')).toBe(original);
  });

  it('al regenerar se usa el logo vigente de la configuración del negocio', async () => {
    const t = await setup();
    const q = await t.emitida();
    const ruta = join(t.dir, 'pdf', q.pdf!);
    const original = await readFile(ruta, 'utf8');
    t.ponerLogo(OTRO_LOGO);
    await rm(ruta);
    await t.sobre(q, { tipo: 'regenerar_pdf', documento: 'cotizacion' });
    const regenerado = await readFile(ruta, 'utf8');
    expect(regenerado).toContain(`src="data:image/svg+xml;base64,${base64(OTRO_LOGO)}"`);
    expect(regenerado).not.toContain(base64(LOGO));
    // Todo lo demás es idéntico al documento emitido.
    expect(regenerado.replace(base64(OTRO_LOGO), '')).toBe(original.replace(base64(LOGO), ''));
  });

  it('compactarLogo convierte un snapshot antiguo con base64 en uno con referencia, sin tocar el resto', () => {
    const antiguo = `<header><img alt="Neltume" src="data:image/svg+xml;base64,${base64(LOGO)}"></header><p>texto</p>`;
    expect(compactarLogo(antiguo)).toBe(
      `<header><img alt="Neltume" src="${referenciaLogo(Buffer.from(LOGO))}"></header><p>texto</p>`,
    );
    expect(compactarLogo('<p>sin logo</p>')).toBe('<p>sin logo</p>');
  });
});

describe('limpieza de datos que crecen', () => {
  /** Una emitida vigente, una anulada hace 40 días y una anulada ayer, cada una con su snapshot. */
  async function conDocumentos() {
    const t = await setup();
    const vigente = await t.emitida();
    const vieja = await t.emitida();
    const reciente = await t.emitida();
    for (const q of [vieja, reciente]) await t.sobre(q, { tipo: 'anular', motivo: 'El cliente desistió' });
    const hace = (dias: number) => new Date(Date.now() - dias * DIA).toISOString();
    t.db.prepare('UPDATE cotizaciones SET fecha_anulacion = ? WHERE id = ?').run(hace(40), vieja.id);
    t.db.prepare('UPDATE cotizaciones SET fecha_anulacion = ? WHERE id = ?').run(hace(1), reciente.id);
    return { ...t, vigente, vieja, reciente, hace };
  }

  it('purga los snapshots de anuladas vencidas y los sin cotización, nunca los de emitidas o anuladas recientes', async () => {
    const t = await conDocumentos();
    t.db.pragma('foreign_keys = OFF');
    t.db.prepare("INSERT INTO documentos_snapshot VALUES ('cotizacion-9999.pdf', 'no-existe', '<html/>')").run();
    t.db.pragma('foreign_keys = ON');

    const purgables = limpieza.snapshotsPurgables(t.db, 30);
    expect(purgables.map((s) => [s.archivo, s.motivo]).sort()).toEqual(
      [
        [t.vieja.pdf, 'anulada'],
        ['cotizacion-9999.pdf', 'sin-cotizacion'],
      ].sort(),
    );
    expect(limpieza.purgarSnapshots(t.db, purgables, 30)).toBe(2);
    expect(t.snapshot(t.vieja.pdf!)).toBeUndefined();
    expect(t.snapshot(t.vigente.pdf!)).toBeDefined();
    expect(t.snapshot(t.reciente.pdf!)).toBeDefined();

    // Sin snapshot, el PDF de la anulada se puede rearmar igual desde la cotización (con aviso).
    await rm(join(t.dir, 'pdf', t.vieja.pdf!));
    const r = await t.sobre(t.almacen.obtener(t.vieja.id)!, { tipo: 'regenerar_pdf', documento: 'cotizacion' });
    expect(r.avisos).toHaveLength(1);
  });

  it('no purga un snapshot si la cotización dejó de cumplir la condición entre listar y borrar', async () => {
    const t = await conDocumentos();
    const purgables = limpieza.snapshotsPurgables(t.db, 30);
    t.db.prepare('UPDATE cotizaciones SET fecha_anulacion = ? WHERE id = ?').run(new Date().toISOString(), t.vieja.id);
    expect(limpieza.purgarSnapshots(t.db, purgables, 30)).toBe(0);
  });

  it('compacta los snapshots antiguos con el logo en base64', async () => {
    const t = await conDocumentos();
    const ref = referenciaLogo(Buffer.from(LOGO));
    t.db.prepare('UPDATE documentos_snapshot SET html = replace(html, ?, ?)').run(
      `src="${ref}"`,
      `src="data:image/svg+xml;base64,${base64(LOGO)}"`,
    );
    const compactables = limpieza.snapshotsCompactables(t.db);
    expect(compactables).toHaveLength(3);
    expect(limpieza.compactarSnapshots(t.db, compactables)).toBe(3);
    expect(limpieza.snapshotsCompactables(t.db)).toEqual([]);
    expect(t.snapshot(t.vigente.pdf!)).toContain(`src="${ref}"`);
  });

  it('auditoría de cuentas: borra solo lo de más de un año', async () => {
    const t = await setup();
    const insertar = t.db.prepare("INSERT INTO auditoria_cuentas (fecha, actor, objetivo, accion) VALUES (?, 'a', 'b', 'crear')");
    insertar.run(new Date(Date.now() - 400 * DIA).toISOString());
    insertar.run(new Date(Date.now() - 300 * DIA).toISOString());
    expect(limpieza.auditoriaAntigua(t.db)).toMatchObject({ cantidad: 1 });
    expect(limpieza.purgarAuditoria(t.db)).toBe(1);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM auditoria_cuentas').get()).toEqual({ n: 1 });
  });

  it('archivos: copias ANULADA viejas, temporales huérfanos y el lock abandonado; nunca un PDF emitido', async () => {
    const t = await setup();
    const pdf = join(t.dir, 'pdf');
    await mkdir(pdf, { recursive: true });
    const viejo = new Date(Date.now() - 40 * DIA);
    const archivo = async (nombre: string, fecha?: Date) => {
      await writeFile(join(pdf, nombre), '%PDF');
      if (fecha) await utimes(join(pdf, nombre), fecha, fecha);
    };
    await archivo('cotizacion-1.pdf', viejo);
    await archivo('cotizacion-1-anulada.pdf', viejo);
    await archivo('cotizacion-2-anulada.pdf');
    await archivo('.0b9f2c1e-3d4a-4b5c-8d6e-7f8091a2b3c4.pdf', new Date(Date.now() - 2 * 3_600_000));
    await archivo('.1b9f2c1e-3d4a-4b5c-8d6e-7f8091a2b3c4.pdf');
    await archivo('.otra-cosa.pdf', viejo);

    expect((await limpieza.pdfAnuladosAntiguos(t.dir, 30)).map((a) => a.ruta)).toEqual([join('pdf', 'cotizacion-1-anulada.pdf')]);
    expect((await limpieza.temporalesHuerfanos(t.dir)).map((a) => a.ruta)).toEqual([
      join('pdf', '.0b9f2c1e-3d4a-4b5c-8d6e-7f8091a2b3c4.pdf'),
    ]);

    // proper-lockfile deja una carpeta; una vigente (recién renovada) no se toca.
    const lock = join(t.dir, '.estado.lock');
    await mkdir(lock);
    expect(await limpieza.lockVencido(t.dir)).toBeNull();
    const hace = new Date(Date.now() - 11 * 60_000);
    await utimes(lock, hace, hace);
    expect(await limpieza.lockVencido(t.dir)).toMatchObject({ ruta: '.estado.lock' });
    expect(await limpieza.eliminarLockVencido(t.dir)).toBe(1);
    expect(await limpieza.lockVencido(t.dir)).toBeNull();
  });

  it('npm run limpiar-borradores lista sin --confirmar y purga con --confirmar', async () => {
    const t = await conDocumentos();
    t.db
      .prepare("INSERT INTO auditoria_cuentas (fecha, actor, objetivo, accion) VALUES (?, 'a', 'b', 'crear')")
      .run(new Date(Date.now() - 400 * DIA).toISOString());
    const anuladaVieja = join(t.dir, 'pdf', t.vieja.pdf!.replace(/\.pdf$/, '-anulada.pdf'));
    await writeFile(anuladaVieja, '%PDF');
    const viejo = new Date(Date.now() - 40 * DIA);
    await utimes(anuladaVieja, viejo, viejo);
    const temporal = join(t.dir, 'pdf', '.0b9f2c1e-3d4a-4b5c-8d6e-7f8091a2b3c4.pdf');
    await writeFile(temporal, '%PDF');
    await utimes(temporal, viejo, viejo);
    const lock = join(t.dir, '.estado.lock');
    await mkdir(lock);
    await utimes(lock, viejo, viejo);

    const limpiar = (...extra: string[]) => {
      const env: NodeJS.ProcessEnv = { ...process.env, NELTUME_DATA_DIR: t.dir };
      delete env.NELTUME_DB_PATH;
      return promisify(execFile)(resolve('node_modules/.bin/tsx'), ['scripts/limpiar-borradores.ts', '--dias', '30', ...extra], { env });
    };
    const listado = (await limpiar()).stdout;
    expect(listado).toContain(`${t.vieja.pdf}  N° ${t.vieja.numero} anulada`);
    expect(listado).toContain('1 snapshot(s) de documentos se eliminarían');
    expect(listado).toContain('1 registro(s) de auditoría de cuentas de más de 365 días');
    expect(listado).toContain('1 copia(s) «ANULADA» de más de 30 días');
    expect(listado).toContain('1 PDF temporal(es) de impresiones interrumpidas');
    expect(listado).toContain('data/.estado.lock quedó de un proceso terminado');
    expect(t.snapshot(t.vieja.pdf!)).toBeDefined();
    expect((await readdir(join(t.dir, 'pdf'))).sort()).toContain(t.vieja.pdf!.replace(/\.pdf$/, '-anulada.pdf'));

    const confirmado = (await limpiar('--confirmar')).stdout;
    expect(confirmado).toContain('Se eliminaron 1 snapshot(s) de documentos.');
    expect(confirmado).toContain('Se eliminaron 1 registro(s) de auditoría de cuentas');
    expect(confirmado).toContain('Se eliminaron 1 copia(s) «ANULADA»');
    expect(confirmado).toContain('Se eliminaron 1 PDF temporal(es)');
    expect(confirmado).toContain('Se eliminó data/.estado.lock abandonado.');
    const db = abrirBaseDatos(join(t.dir, 'cotizador.sqlite'));
    expect(t.snapshot(t.vieja.pdf!)).toBeUndefined();
    expect(t.snapshot(t.vigente.pdf!)).toBeDefined();
    expect(t.snapshot(t.reciente.pdf!)).toBeDefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM auditoria_cuentas').get()).toEqual({ n: 0 });
    const quedan = await readdir(join(t.dir, 'pdf'));
    expect(quedan).toEqual(expect.arrayContaining([t.vigente.pdf, t.vieja.pdf, t.reciente.pdf]));
    expect(quedan.some((n) => n.endsWith('-anulada.pdf') || n.startsWith('.'))).toBe(false);
  }, 30_000);
});
