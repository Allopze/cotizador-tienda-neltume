import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Catalogo, Cliente } from '../src/catalogo/tipos';
import { digitoVerificador } from '../src/negocio/cliente';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { auditoriaDeCliente, listarClientesActivos } from '../src/servidor/repositorio-clientes';
import { Servicio } from '../src/servidor/servicio';
import {
  ACTOR_IMPORTACION_CLIENTES,
  importarClientesDesdeHistorial,
} from '../scripts/clientes-desde-historial';

vi.mock('../src/servidor/pdf', () => ({
  prepararPdf: vi.fn(async () => {}),
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

const raiz = process.cwd();
const tsx = join(raiz, 'node_modules', '.bin', 'tsx');
const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

const catalogo: Catalogo = {
  fuente: 'test.xlsx',
  sha256: 'catalogo-test',
  fecha: '2026-01-01T00:00:00.000Z',
  productos: [
    {
      codigo: 'HUI-M-3-A',
      modelo: 'Huilo Huilo',
      familia: 'PUERTA',
      tipo: 'PUERTA SÓLIDA',
      madera: 'MARA',
      medida: '0,80 A 0,85',
      anchoMin: 0.8,
      anchoMax: 0.85,
      altoMin: 2.3,
      altoMax: 2.4,
      largo: 2.35,
      precioNeto: 100_000,
      descripcion: 'HUILO HUILO MARA 0,80 A 0,85 MT X 2,30 A 2,40 MT',
      filaOrigen: 7,
    },
  ],
};

const rut = (cuerpo: string) => `${cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${digitoVerificador(cuerpo)}`;

async function prepararConHistorial() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-hist-cli-'));
  dirs.push(dir);
  const almacen = new Almacen(dir);
  const servicio = new Servicio(catalogo, { interpretar: vi.fn() }, almacen);
  const crear = async (cliente: Partial<Cliente>) => {
    const { cotizacion: q } = await servicio.ejecutar({
      tipo: 'agregar_producto',
      codigo: 'HUI-M-3-A',
      cantidad: 1,
      ancho: 0.82,
      alto: 2.35,
    });
    return (await servicio.ejecutar({ tipo: 'editar', id: q.id, actualizada: q.actualizada, cliente })).cotizacion;
  };
  await crear({ nombre: 'Constructora Lingue', rut: rut('76543210'), giro: 'Construcción', comuna: 'Temuco' });
  await crear({ nombre: 'Sin RUT SA', comuna: 'Osorno' });
  await crear({ nombre: 'RUT Inválido SA', rut: '12.345.678-0' });
  await crear({ rut: rut('11222333') }); // Solo RUT, sin nombre
  return { dir, db: almacen.baseDatos() };
}

describe('B6 · script clientes-desde-historial', () => {
  it('con --simular lista candidatos sin escribir; sin simular importa, audita y es idempotente', async () => {
    const { dir, db } = await prepararConHistorial();
    const env = { ...process.env, NELTUME_DATA_DIR: dir, NELTUME_DB_PATH: join(dir, 'cotizador.sqlite') };

    // Modo CLI --simular: no debe escribir en SQLite.
    const cliSim = spawnSync(tsx, ['scripts/clientes-desde-historial.ts', '--simular'], { cwd: raiz, env, encoding: 'utf8' });
    expect(cliSim.status).toBe(0);
    expect(cliSim.stdout).toContain('Simulación: se importarían 1 cliente(s)');
    expect(cliSim.stdout).toContain('Constructora Lingue');
    expect(listarClientesActivos(db)).toHaveLength(0);

    // Simulación por función.
    const sim = importarClientesDesdeHistorial(db, { simular: true });
    expect(sim.creados.map((c) => c.nombre)).toEqual(['Constructora Lingue']);
    expect(sim.omitidosSinRutOInvalido).toBe(2);
    expect(sim.omitidosSinNombre).toBe(1);
    expect(listarClientesActivos(db)).toHaveLength(0);

    // Ejecución real: crea Constructora Lingue con auditoría del script.
    const real = importarClientesDesdeHistorial(db, { simular: false });
    expect(real.creados.map((c) => c.nombre)).toEqual(['Constructora Lingue']);
    const activos = listarClientesActivos(db);
    expect(activos).toHaveLength(1);
    expect(activos[0].rut).toBe(rut('76543210'));

    const aud = auditoriaDeCliente(db, activos[0].id);
    expect(aud).toHaveLength(1);
    expect(aud[0].actor).toBe(ACTOR_IMPORTACION_CLIENTES);
    expect(aud[0].accion).toBe('crear');

    // Segunda ejecución: idempotente (0 creados, 1 ya registrado).
    const segunda = importarClientesDesdeHistorial(db, { simular: false });
    expect(segunda.creados).toHaveLength(0);
    expect(segunda.yaRegistrados).toBe(1);
  });
});
