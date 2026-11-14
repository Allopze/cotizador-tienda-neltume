import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { abrirBaseDatos, cerrarBaseDatos, VERSION_ESQUEMA } from '../src/servidor/base-datos';
import { Almacen } from '../src/servidor/almacen';
import { completarEstadoLegado, estadoPersistidoSchema } from '../src/servidor/persistencia-esquemas';
import { restaurarRespaldo } from '../scripts/lib/restauracion';
import { clienteVacio } from '../src/catalogo/tipos';
import { REGLAS, montosVacios } from '../src/negocio/precios';

const raiz = process.cwd();
const tsx = join(raiz, 'node_modules', '.bin', 'tsx');
let dir: string | undefined;

afterEach(async () => {
  cerrarBaseDatos();
  vi.unstubAllEnvs();
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function tempDir() {
  dir = await mkdtemp(join(tmpdir(), 'neltume-v30-'));
  return dir;
}

describe('A1 · Migración v29 → v30 y persistencia de facturación', () => {
  it('migra una base v29 sin perder datos, incluyendo aprobadas pendientes y ya facturadas pre-v30', async () => {
    const base = await tempDir();
    const ruta = join(base, 'cotizador.sqlite');
    const db = abrirBaseDatos(ruta, { cachear: false });
    const almacen = new Almacen(base, ruta);
    const fecha = '2026-10-10T12:00:00.000Z';

    await almacen.transaccion((u) => {
      u.guardar({
        id: '11111111-1111-4111-8111-111111111111',
        numero: 501,
        estado: 'aprobada',
        cliente: { ...clienteVacio(), nombre: 'Cliente Antiguo Pendiente', comuna: 'Temuco' },
        solicitudes: [],
        montos: montosVacios(),
        incompletos: [],
        historial: [],
        creada: fecha,
        actualizada: fecha,
        pdf: null,
        fechaEmision: fecha,
        fechaAprobacion: fecha,
        vence: null,
        descuento: 0,
        flete: 0,
        margenCotizacion: null,
        observaciones: null,
        despacho: null,
        reglas: { ...REGLAS },
        creadaPor: 'Ana',
        emitidaPor: 'Ana',
        aprobadaPor: 'Ana',
        anuladaPor: null,
        fechaAnulacion: null,
        motivoAnulacion: null,
        reemplazadaPor: null,
        versionCatalogo: null,
        notas: [],
        estadoComercial: 'aprobada',
        estadoOperativo: 'sin_pedido',
        pagos: [],
        comentariosInternos: [],
        facturacion: {
          estado: 'pendiente',
          documento: null,
          receptor: null,
          tipo: null,
          identificadorExterno: null,
          fecha: null,
        },
      });
      u.guardar({
        id: '22222222-2222-4222-8222-222222222222',
        numero: 502,
        estado: 'aprobada',
        cliente: { ...clienteVacio(), nombre: 'Cliente Antiguo Facturado', comuna: 'Osorno' },
        solicitudes: [],
        montos: montosVacios(),
        incompletos: [],
        historial: [],
        creada: fecha,
        actualizada: fecha,
        pdf: null,
        fechaEmision: fecha,
        fechaAprobacion: fecha,
        vence: null,
        descuento: 0,
        flete: 0,
        margenCotizacion: null,
        observaciones: null,
        despacho: null,
        reglas: { ...REGLAS },
        creadaPor: 'Ana',
        emitidaPor: 'Ana',
        aprobadaPor: 'Ana',
        anuladaPor: null,
        fechaAnulacion: null,
        motivoAnulacion: null,
        reemplazadaPor: null,
        versionCatalogo: null,
        notas: [],
        estadoComercial: 'aprobada',
        estadoOperativo: 'sin_pedido',
        pagos: [],
        comentariosInternos: [],
        facturacion: {
          estado: 'facturada',
          documento: null,
          receptor: null,
          tipo: 'factura',
          identificadorExterno: '987',
          fecha,
        },
      });
    });
    db.close();

    // Simulamos una base v29 real quitando las 7 columnas nuevas y fijando user_version = 29.
    const cruda = new Database(ruta);
    for (const col of [
      'facturacion_documento',
      'facturacion_razon_social',
      'facturacion_rut',
      'facturacion_giro',
      'facturacion_direccion',
      'facturacion_comuna',
      'facturacion_correo',
    ])
      cruda.exec(`ALTER TABLE cotizaciones DROP COLUMN ${col};`);
    cruda.pragma('user_version = 29');
    cruda.close();

    const migrada = abrirBaseDatos(ruta, { cachear: false });
    expect(migrada.pragma('user_version', { simple: true })).toBe(VERSION_ESQUEMA);
    migrada.close();

    const lector = new Almacen(base, ruta);
    const pendiente = lector.obtener('11111111-1111-4111-8111-111111111111');
    const facturada = lector.obtener('22222222-2222-4222-8222-222222222222');
    expect(pendiente?.facturacion).toEqual({
      estado: 'pendiente',
      documento: null,
      receptor: null,
      tipo: null,
      identificadorExterno: null,
      fecha: null,
    });
    expect(facturada?.facturacion).toEqual({
      estado: 'facturada',
      documento: null,
      receptor: null,
      tipo: 'factura',
      identificadorExterno: '987',
      fecha,
    });

    const listado = lector.listar();
    expect(listado.cotizaciones.find((c) => c.numero === 502)?.facturacion).toEqual({
      estado: 'facturada',
      documento: null,
      tipo: 'factura',
      receptor: null,
    });
  });

  it('completarEstadoLegado hidrata facturación antigua y nueva sin perder documento ni receptor', () => {
    const crudo = completarEstadoLegado({
      siguienteCotizacion: 325,
      siguienteNota: 2,
      cotizaciones: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          numero: 324,
          estado: 'aprobada',
          cliente: { ...clienteVacio(), nombre: 'Ana' },
          solicitudes: [],
          montos: montosVacios(),
          incompletos: [],
          historial: [],
          creada: '2026-10-01T12:00:00.000Z',
          actualizada: '2026-10-01T12:00:00.000Z',
          pdf: null,
          fechaEmision: '2026-10-01T12:00:00.000Z',
          vence: null,
          descuento: 0,
          flete: 0,
          margenCotizacion: null,
          observaciones: null,
          despacho: null,
          facturacion: {
            estado: 'pendiente',
            tipo: null,
            identificadorExterno: null,
            fecha: null,
          },
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          numero: 325,
          estado: 'aprobada',
          cliente: { ...clienteVacio(), nombre: 'Constructora Sur' },
          solicitudes: [],
          montos: montosVacios(),
          incompletos: [],
          historial: [],
          creada: '2026-10-01T12:00:00.000Z',
          actualizada: '2026-10-01T12:00:00.000Z',
          pdf: null,
          fechaEmision: '2026-10-01T12:00:00.000Z',
          vence: null,
          descuento: 0,
          flete: 0,
          margenCotizacion: null,
          observaciones: null,
          despacho: null,
          facturacion: {
            estado: 'pendiente',
            documento: 'factura',
            receptor: {
              razonSocial: 'Constructora Sur SpA',
              rut: '76.543.210-3',
              giro: 'Construcción',
              direccion: 'Av. Alemania 100',
              comuna: 'Temuco',
              correo: 'facturas@sur.cl',
            },
            tipo: null,
            identificadorExterno: null,
            fecha: null,
          },
        },
      ],
    });
    const parsed = estadoPersistidoSchema.parse(crudo);
    expect(parsed.cotizaciones[0].facturacion).toEqual({
      estado: 'pendiente',
      documento: null,
      receptor: null,
      tipo: null,
      identificadorExterno: null,
      fecha: null,
    });
    expect(parsed.cotizaciones[1].facturacion).toEqual({
      estado: 'pendiente',
      documento: 'factura',
      receptor: {
        razonSocial: 'Constructora Sur SpA',
        rut: '76.543.210-3',
        giro: 'Construcción',
        direccion: 'Av. Alemania 100',
        comuna: 'Temuco',
        correo: 'facturas@sur.cl',
      },
      tipo: null,
      identificadorExterno: null,
      fecha: null,
    });
  });

  it('respaldar → restaurar conserva documento y receptor en v30', async () => {
    const base = await tempDir();
    const datos = join(base, 'data');
    const entorno = {
      NELTUME_DATA_DIR: datos,
      NELTUME_DB_PATH: join(datos, 'cotizador.sqlite'),
      NELTUME_CATALOGO_CONFIG: join(base, 'config', 'catalogo.json'),
      NELTUME_RESPALDO_DIR: join(base, 'respaldos'),
    };
    for (const [k, v] of Object.entries(entorno)) vi.stubEnv(k, v);
    mkdirSync(join(base, 'config'));

    const almacen = new Almacen(datos, entorno.NELTUME_DB_PATH);
    const id = '33333333-3333-4333-8333-333333333333';
    const fecha = '2026-10-12T12:00:00.000Z';
    await almacen.transaccion((u) =>
      u.guardar({
        id,
        numero: 601,
        estado: 'aprobada',
        cliente: { ...clienteVacio(), nombre: 'Constructora Lingue' },
        solicitudes: [],
        montos: montosVacios(),
        incompletos: [],
        historial: [],
        creada: fecha,
        actualizada: fecha,
        pdf: null,
        fechaEmision: fecha,
        fechaAprobacion: fecha,
        vence: null,
        descuento: 0,
        flete: 0,
        margenCotizacion: null,
        observaciones: null,
        despacho: null,
        reglas: { ...REGLAS },
        creadaPor: 'Ana',
        emitidaPor: 'Ana',
        aprobadaPor: 'Ana',
        anuladaPor: null,
        fechaAnulacion: null,
        motivoAnulacion: null,
        reemplazadaPor: null,
        versionCatalogo: null,
        notas: [],
        estadoComercial: 'aprobada',
        estadoOperativo: 'sin_pedido',
        pagos: [],
        comentariosInternos: [],
        facturacion: {
          estado: 'pendiente',
          documento: 'factura',
          receptor: {
            razonSocial: 'Constructora Lingue SpA',
            rut: '76.543.210-3',
            giro: 'Obras civiles',
            direccion: 'Caupolicán 250',
            comuna: 'Temuco',
            correo: 'dte@lingue.cl',
          },
          tipo: null,
          identificadorExterno: null,
          fecha: null,
        },
      }),
    );
    cerrarBaseDatos();

    const r = spawnSync(tsx, ['scripts/respaldar.ts'], { cwd: raiz, env: { ...process.env, ...entorno }, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const carpeta = r.stdout.match(/^Respaldo en ([^:]+):/m)![1];

    // Borrar el dato después del respaldo y luego restaurar.
    const db2 = abrirBaseDatos();
    db2.prepare('UPDATE cotizaciones SET facturacion_documento = NULL, facturacion_razon_social = NULL WHERE id = ?').run(id);
    cerrarBaseDatos();

    await restaurarRespaldo(carpeta);
    const recuperada = new Almacen(datos, entorno.NELTUME_DB_PATH).obtener(id);
    expect(recuperada?.facturacion).toEqual({
      estado: 'pendiente',
      documento: 'factura',
      receptor: {
        razonSocial: 'Constructora Lingue SpA',
        rut: '76.543.210-3',
        giro: 'Obras civiles',
        direccion: 'Caupolicán 250',
        comuna: 'Temuco',
        correo: 'dte@lingue.cl',
      },
      tipo: null,
      identificadorExterno: null,
      fecha: null,
    });
  });
});
