import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Almacen } from '../src/servidor/almacen';
import { abrirBaseDatos, cerrarBaseDatos, VERSION_ESQUEMA } from '../src/servidor/base-datos';
import { restaurarRespaldo } from '../scripts/lib/restauracion';
import { clienteVacio } from '../src/catalogo/tipos';
import { montosVacios, REGLAS } from '../src/negocio/precios';

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
  dir = await mkdtemp(join(tmpdir(), 'neltume-v31-'));
  return dir;
}

describe('B1 · Migración v30 → v31, tabla clientes y respaldos', () => {
  it('migra una base v30 a v31 conservando cotizaciones y creando clientes + auditoria_clientes', async () => {
    const base = await tempDir();
    const ruta = join(base, 'cotizador.sqlite');
    const db = abrirBaseDatos(ruta, { cachear: false });
    const almacen = new Almacen(base, ruta);
    const fecha = '2026-10-12T12:00:00.000Z';

    await almacen.transaccion((u) =>
      u.guardar({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        numero: 701,
        estado: 'aprobada',
        cliente: { ...clienteVacio(), nombre: 'Cliente v30', rut: '76.543.210-3' },
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
            razonSocial: 'Cliente v30',
            rut: '76.543.210-3',
            giro: 'Construcción',
            direccion: 'Los Robles 1',
            comuna: 'Temuco',
            correo: 'dte@v30.cl',
          },
          tipo: null,
          identificadorExterno: null,
          fecha: null,
        },
      }),
    );
    db.close();

    // Simulamos una base v30 real quitando clientes + auditoria_clientes y fijando user_version = 30.
    const cruda = new Database(ruta);
    cruda.exec('DROP TABLE IF EXISTS auditoria_clientes; DROP TABLE IF EXISTS clientes;');
    cruda.pragma('user_version = 30');
    cruda.close();

    const migrada = abrirBaseDatos(ruta, { cachear: false });
    expect(migrada.pragma('user_version', { simple: true })).toBe(VERSION_ESQUEMA);
    expect(VERSION_ESQUEMA).toBe(31);

    const tablas = new Set(
      (migrada.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
        (t) => t.name,
      ),
    );
    expect(tablas.has('clientes')).toBe(true);
    expect(tablas.has('auditoria_clientes')).toBe(true);
    migrada.close();

    const conservada = new Almacen(base, ruta).obtener('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(conservada?.facturacion?.receptor?.razonSocial).toBe('Cliente v30');
  });

  it('el índice único parcial sobre rut_compacto bloquea duplicados activos pero permite nulos y dados de baja', async () => {
    const base = await tempDir();
    const ruta = join(base, 'cotizador.sqlite');
    const db = abrirBaseDatos(ruta, { cachear: false });
    const ahora = '2026-11-13T12:00:00.000Z';

    const insertar = db.prepare(`
      INSERT INTO clientes (id, nombre, nombre_normalizado, rut, rut_compacto, creado, actualizado)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    insertar.run('c1', 'Constructora Lingue', 'constructora lingue', '76.543.210-3', '765432103', ahora, ahora);

    // Segundo cliente activo con el mismo rut_compacto: debe fallar por el índice único parcial.
    expect(() =>
      insertar.run('c2', 'Otra Lingue', 'otra lingue', '76543210-3', '765432103', ahora, ahora),
    ).toThrow(/UNIQUE/);

    // Dos clientes activos sin RUT (rut_compacto IS NULL): permitidos.
    insertar.run('c3', 'Sin Rut Uno', 'sin rut uno', null, null, ahora, ahora);
    insertar.run('c4', 'Sin Rut Dos', 'sin rut dos', null, null, ahora, ahora);

    // Baja lógica de c1 libera el rut_compacto para un nuevo cliente activo.
    db.prepare('UPDATE clientes SET eliminado = ?, eliminado_por = ? WHERE id = ?').run(ahora, 'admin@neltume.cl', 'c1');
    insertar.run('c5', 'Nueva Lingue', 'nueva lingue', '76.543.210-3', '765432103', ahora, ahora);

    const activos = db.prepare('SELECT id FROM clientes WHERE eliminado IS NULL ORDER BY id').all() as { id: string }[];
    expect(activos.map((r) => r.id)).toEqual(['c3', 'c4', 'c5']);
    db.close();
  });

  it('respaldar → restaurar conserva la tabla clientes y auditoria_clientes', async () => {
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
    mkdirSync(datos, { recursive: true });

    const db = abrirBaseDatos(entorno.NELTUME_DB_PATH);
    const ahora = '2026-11-13T12:00:00.000Z';
    db.prepare(
      `INSERT INTO clientes (
        id, nombre, nombre_normalizado, rut, rut_compacto, correo, documento_habitual,
        factura_razon_social, factura_rut, creado, actualizado, creado_por
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'cli-1',
      'Constructora Lingue SpA',
      'constructora lingue spa',
      '76.543.210-3',
      '765432103',
      'dte@lingue.cl',
      'factura',
      'Constructora Lingue SpA',
      '76.543.210-3',
      ahora,
      ahora,
      'ana@neltume.cl',
    );
    db.prepare(
      `INSERT INTO auditoria_clientes (cliente_id, fecha, actor, accion, detalle)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('cli-1', ahora, 'ana@neltume.cl', 'crear', 'Creación de cliente Constructora Lingue SpA');
    cerrarBaseDatos();

    const r = spawnSync(tsx, ['scripts/respaldar.ts'], {
      cwd: raiz,
      env: { ...process.env, ...entorno },
      encoding: 'utf8',
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('1 clientes');
    const carpeta = r.stdout.match(/^Respaldo en ([^:]+):/m)![1];

    // Borramos el cliente después del respaldo y restauramos.
    const db2 = abrirBaseDatos();
    db2.prepare('DELETE FROM clientes WHERE id = ?').run('cli-1');
    cerrarBaseDatos();

    const resultado = await restaurarRespaldo(carpeta);
    expect(resultado.clientes).toBe(1);

    const recuperada = abrirBaseDatos();
    const cli = recuperada.prepare('SELECT nombre, correo, documento_habitual FROM clientes WHERE id = ?').get('cli-1') as
      | { nombre: string; correo: string; documento_habitual: string }
      | undefined;
    expect(cli).toEqual({
      nombre: 'Constructora Lingue SpA',
      correo: 'dte@lingue.cl',
      documento_habitual: 'factura',
    });
    const eventos = recuperada
      .prepare('SELECT accion, actor FROM auditoria_clientes WHERE cliente_id = ?')
      .all('cli-1') as { accion: string; actor: string }[];
    expect(eventos).toEqual([{ accion: 'crear', actor: 'ana@neltume.cl' }]);
  });
});
