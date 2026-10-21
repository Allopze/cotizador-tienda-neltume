import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { clienteVacio, type Catalogo, type Producto, type SolicitudItem } from '../src/catalogo/tipos';
import type { ResumenCotizacion } from '../src/negocio/estado';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { guardarReferencia } from '../src/servidor/archivos-referencia';
import { abrirBaseDatos, cerrarBaseDatos, VERSION_ESQUEMA } from '../src/servidor/base-datos';
import { textoBusqueda } from '../src/servidor/busqueda';
import { csvCotizaciones } from '../src/servidor/exportar';
import { Servicio } from '../src/servidor/servicio';

vi.mock('../src/servidor/pdf', () => ({
  prepararPdf: vi.fn(async () => {}),
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

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
const PDF = new TextEncoder().encode('%PDF-1.4\n% croquis\n');
const DIA = 86_400_000;

const dirs: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-v22-'));
  dirs.push(dir);
  const rutaDb = join(dir, 'cotizador.sqlite');
  const almacen = new Almacen(dir);
  const llm = {
    interpretar: vi.fn().mockResolvedValue({
      name: 'actualizar_cotizacion',
      input: { items: [pedido], cliente: { ...clienteVacio(), nombre: 'Ana Soto' } },
    }),
  };
  const servicio = new Servicio(catalogo, llm, almacen, { nombre: 'Paula', email: 'paula@neltume.cl' });
  let q = (await servicio.ejecutar({ tipo: 'chat', mensaje: 'cotiza MOLCO' })).cotizacion;
  const ir = async (accion: Record<string, unknown>) => {
    q = (await servicio.ejecutar({ ...accion, id: q.id, actualizada: q.actualizada } as never)).cotizacion;
    return q;
  };
  return { dir, rutaDb, almacen, ir, actual: () => q, db: () => abrirBaseDatos(rutaDb) };
}

const columnas = (db: ReturnType<typeof abrirBaseDatos>, tabla: string) =>
  (db.pragma(`table_info(${tabla})`) as { name: string }[]).map((c) => c.name);
const tablas = (db: ReturnType<typeof abrirBaseDatos>) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
const TABLAS_V22 = ['documentos_snapshot', 'papelera', 'catalogo_anterior', 'catalogo_ediciones', 'auditoria_cuentas'];

describe('migración v22', () => {
  it('una base v21 sube a la versión vigente con las columnas y tablas nuevas, y repetir la migración no falla', async () => {
    const t = await setup();
    t.db().exec(`
      ${TABLAS_V22.map((tabla) => `DROP TABLE ${tabla};`).join('\n')}
      ALTER TABLE notas_pedido DROP COLUMN despacho_destino;
      ALTER TABLE notas_pedido DROP COLUMN despacho_valor;
      PRAGMA user_version = 21;
    `);
    cerrarBaseDatos(t.rutaDb);
    const migrada = t.db();
    expect(migrada.pragma('user_version', { simple: true })).toBe(VERSION_ESQUEMA);
    expect(columnas(migrada, 'notas_pedido')).toEqual(expect.arrayContaining(['despacho_destino', 'despacho_valor']));
    expect(tablas(migrada)).toEqual(expect.arrayContaining(TABLAS_V22));
    // Una base que ya tiene todo lo de v22 (las pruebas de migraciones anteriores bajan user_version) vuelve a subir.
    migrada.pragma('user_version = 21');
    cerrarBaseDatos(t.rutaDb);
    expect(t.db().pragma('user_version', { simple: true })).toBe(VERSION_ESQUEMA);
    expect(new Almacen(t.dir).obtener(t.actual().id)?.cliente.nombre).toBe('Ana Soto');
  });

  it('la búsqueda por teléfono encuentra las cotizaciones guardadas antes de v22', async () => {
    const t = await setup();
    const q = await t.ir({ tipo: 'editar', cliente: { telefono: '+56 9 8765 4321' } });
    expect(t.almacen.listar({ q: '987654321' }).total).toBe(1);
    // Texto de búsqueda como lo dejaba el esquema anterior: sin el teléfono.
    const anterior = textoBusqueda({ numero: q.numero, cliente: { ...q.cliente, telefono: null }, productos: ['MOLCO', 'PINO OREGON'] });
    t.db().prepare('UPDATE cotizaciones SET busqueda = ?').run(anterior);
    expect(t.almacen.listar({ q: '987654321' }).total).toBe(0);
    t.db().pragma('user_version = 21');
    cerrarBaseDatos(t.rutaDb);
    const almacen = new Almacen(t.dir);
    for (const consulta of ['987654321', '+56 9 8765 4321', 'ana 8765'])
      expect(almacen.listar({ q: consulta }).cotizaciones.map((c) => c.id)).toEqual([q.id]);
  });
});

describe('nota de pedido: destino y valor del despacho', () => {
  it('se guardan y se leen; una nota sin ellos no recibe claves nulas', async () => {
    const t = await setup();
    await t.ir({ tipo: 'emitir' });
    await t.ir({ tipo: 'aprobar' });
    await t.ir({ tipo: 'pago', monto: Math.ceil(t.actual().montos.total / 2) });
    await t.ir({ tipo: 'despacho', despacho: { destino: 'Osorno' } });
    const q = await t.ir({ tipo: 'generar_nota', fabrica: 'panguipulli' });
    expect(new Almacen(t.dir).obtener(q.id)!.nota!.despacho).toMatchObject({ destino: 'Osorno', valor: q.flete });
    // Nota anterior a v22 (o migrada desde JSON): las columnas quedan en NULL.
    t.db().prepare('UPDATE notas_pedido SET despacho_destino = NULL, despacho_valor = NULL').run();
    const despacho = new Almacen(t.dir).obtener(q.id)!.nota!.despacho;
    expect(Object.keys(despacho)).not.toContain('destino');
    expect(Object.keys(despacho)).not.toContain('valor');
  });
});

describe('CSV del listado: pagos, operación y facturación', () => {
  const valores = (csv: string) => {
    const [cabecera, linea] = csv.split('\r\n');
    const celdas = linea.split(';');
    return Object.fromEntries(cabecera.split(';').map((titulo, i) => [titulo, celdas[i]]));
  };

  it('muestra lo pagado, el saldo y etiquetas legibles de operación y facturación', async () => {
    const t = await setup();
    await t.ir({ tipo: 'emitir' });
    await t.ir({ tipo: 'aprobar' });
    const anticipo = Math.ceil(t.actual().montos.total / 2);
    await t.ir({ tipo: 'pago', monto: anticipo });
    await t.ir({ tipo: 'generar_nota', fabrica: 'panguipulli' });
    const q = await t.ir({ tipo: 'facturacion', estado: 'facturada', tipoDocumento: 'factura', identificadorExterno: '1234' });
    const [fila] = t.almacen.listar().cotizaciones;
    expect(fila.facturacion).toEqual({ estado: 'facturada' });
    expect(valores(csvCotizaciones([fila]))).toMatchObject({
      Pagado: String(anticipo),
      Saldo: String(q.montos.total - anticipo),
      Operación: 'Nota de pedido generada',
      Facturación: 'Facturada',
    });
  });

  it('una fila sin datos de pago ni facturación sale en cero y pendiente', () => {
    // Aprobada: el saldo y la facturación solo se exportan en una venta (ver auditoria.test.ts).
    const fila = {
      numero: 1,
      estado: 'aprobada',
      fecha: '2026-10-01T12:00:00.000Z',
      fechaEmision: null,
      cliente: { ...clienteVacio(), nombre: 'Ana' },
      total: 119000,
      productos: '',
      nota: null,
    } as unknown as ResumenCotizacion;
    expect(valores(csvCotizaciones([fila]))).toMatchObject({
      Pagado: '0',
      Saldo: '119000',
      Operación: 'Sin nota de pedido',
      Facturación: 'Pendiente',
    });
  });
});

describe('papelera de borradores', () => {
  /** Borrador con una referencia del cliente, eliminado: queda en la papelera. */
  async function borradorEnPapelera() {
    const t = await setup();
    const plano = await guardarReferencia(t.dir, PDF, 'plano.pdf');
    await t.ir({ tipo: 'editar', items: [{ indice: 0, cambios: { referencias: [plano] } }] });
    await t.ir({ tipo: 'eliminar' });
    return { ...t, plano };
  }

  it('una revisión restaurada no abre una segunda revisión de la misma emitida', async () => {
    const t = await setup();
    const servicio = new Servicio(catalogo, { interpretar: vi.fn() }, t.almacen);
    const ir = async (accion: Record<string, unknown>, q: { id: string; actualizada: string }) =>
      servicio.ejecutar({ ...accion, id: q.id, actualizada: q.actualizada } as never);
    const leer = (id: string) => t.almacen.transaccion((u) => u.obtener(id)!);
    const original = await t.ir({ tipo: 'emitir' });
    const revision = (await ir({ tipo: 'editar', cantidades: [{ indice: 0, cantidad: 3 }] }, original)).cotizacion;
    expect(revision.origen).toBe(original.numero);
    // Sin otra revisión abierta, vuelve como revisión de su original.
    await ir({ tipo: 'eliminar' }, revision);
    const devuelta = await ir({ tipo: 'restaurar_borrador' }, revision);
    expect(devuelta.cotizacion.origen).toBe(original.numero);
    expect(devuelta.avisos).toEqual([]);
    // Con otra revisión abierta mientras estaba en la papelera, vuelve como cotización nueva.
    await ir({ tipo: 'eliminar' }, devuelta.cotizacion);
    const otra = (await ir({ tipo: 'editar', cantidades: [{ indice: 0, cantidad: 7 }] }, await leer(original.id)))
      .cotizacion;
    const restaurada = await ir({ tipo: 'restaurar_borrador' }, devuelta.cotizacion);
    const aviso = `La cotización N° ${original.numero} ya tiene otra revisión en borrador: este borrador sigue como cotización nueva.`;
    expect(restaurada.cotizacion.origen).toBeNull();
    expect(restaurada.avisos).toEqual([aviso]);
    expect(restaurada.cotizacion.historial.at(-1)).toEqual({ rol: 'asistente', texto: aviso });
    const abiertas = t.db().prepare("SELECT id FROM cotizaciones WHERE origen_id = ? AND estado = 'borrador'");
    expect(abiertas.all(original.id)).toEqual([{ id: otra.id }]);
    // Emitidas las dos, solo una revisa la original.
    const nueva = (await ir({ tipo: 'emitir' }, restaurada.cotizacion)).cotizacion;
    const revisada = (await ir({ tipo: 'emitir' }, await leer(otra.id))).cotizacion;
    expect([nueva.origen, revisada.origen]).toEqual([null, original.numero]);
    expect((await leer(original.id)).reemplazadaPor).toBe(revisada.numero);
  });

  it('una revisión restaurada de una emitida que ya se anuló vuelve como cotización nueva', async () => {
    const t = await setup();
    const servicio = new Servicio(catalogo, { interpretar: vi.fn() }, t.almacen);
    const ir = async (accion: Record<string, unknown>, q: { id: string; actualizada: string }) =>
      servicio.ejecutar({ ...accion, id: q.id, actualizada: q.actualizada } as never);
    const original = await t.ir({ tipo: 'emitir' });
    const revision = (await ir({ tipo: 'editar', cantidades: [{ indice: 0, cantidad: 3 }] }, original)).cotizacion;
    await ir({ tipo: 'eliminar' }, revision);
    await t.ir({ tipo: 'anular', motivo: 'El cliente desistió' });
    const restaurada = await ir({ tipo: 'restaurar_borrador' }, revision);
    expect(restaurada.cotizacion.origen).toBeNull();
    expect(restaurada.avisos).toEqual([
      `La cotización N° ${original.numero} ya no está vigente: este borrador sigue como cotización nueva.`,
    ]);
  });

  it('una entrada ilegible no detiene la protección de las referencias de las demás', async () => {
    const t = await borradorEnPapelera();
    expect(t.almacen.archivosReferencia()).toEqual(new Set([t.plano.archivo]));
    const insertar = t.db().prepare("INSERT INTO papelera VALUES ('borrador', ?, ?, ?)");
    insertar.run('roto', '{no es json', new Date().toISOString());
    insertar.run('incompleto', JSON.stringify({ id: 'incompleto' }), new Date().toISOString());
    expect(t.almacen.archivosReferencia()).toEqual(new Set([t.plano.archivo]));
  });

  it('se vacía solo de lo eliminado antes del plazo y que no cambió desde que se listó', async () => {
    const t = await borradorEnPapelera();
    const insertar = t.db().prepare('INSERT INTO papelera VALUES (?, ?, ?, ?)');
    insertar.run('borrador', 'antiguo', '{}', new Date(Date.now() - 40 * DIA).toISOString());
    insertar.run('producto', 'IA-9', '{}', new Date(Date.now() - 31 * DIA).toISOString());
    const antiguas = t.almacen.papeleraAntigua(30);
    expect(antiguas.map((e) => e.id)).toEqual(['antiguo', 'IA-9']);
    // Se restauró y se volvió a eliminar después de listar: es otra eliminación y no se borra.
    t.db().prepare("UPDATE papelera SET eliminada = ? WHERE id = 'antiguo'").run(new Date().toISOString());
    expect(await t.almacen.vaciarPapelera(antiguas)).toBe(1);
    const quedan = (t.db().prepare('SELECT id FROM papelera ORDER BY id').all() as { id: string }[]).map((e) => e.id);
    expect(quedan).toEqual(['antiguo', t.actual().id].sort());
  });

  it('npm run limpiar-borradores lista la papelera vencida y con --confirmar la vacía y libera sus referencias', async () => {
    const t = await borradorEnPapelera();
    t.db().prepare('UPDATE papelera SET eliminada = ?').run(new Date(Date.now() - 31 * DIA).toISOString());
    const antiguo = new Date(Date.now() - 40 * DIA);
    await utimes(join(t.dir, 'referencias', t.plano.archivo), antiguo, antiguo);
    const limpiar = (...extra: string[]) => {
      const env: NodeJS.ProcessEnv = { ...process.env, NELTUME_DATA_DIR: t.dir };
      delete env.NELTUME_DB_PATH;
      return promisify(execFile)(resolve('node_modules/.bin/tsx'), ['scripts/limpiar-borradores.ts', '--dias', '30', ...extra], { env });
    };
    const listado = (await limpiar()).stdout;
    expect(listado).toContain(`borrador  ${t.actual().id}  Ana Soto  1 ítem(s)`);
    expect(listado).toContain('1 entrada(s) de la papelera se eliminarían');
    // Sin --confirmar, la referencia sigue protegida por el borrador en la papelera.
    expect(listado).toContain('No hay referencias del cliente sin uso.');
    expect(t.db().prepare('SELECT COUNT(*) AS n FROM papelera').get()).toEqual({ n: 1 });

    const confirmado = (await limpiar('--confirmar')).stdout;
    expect(confirmado).toContain('Se eliminaron 1 entrada(s) de la papelera.');
    expect(confirmado).toContain('Se eliminaron 1 referencia(s) sin uso.');
    expect(t.db().prepare('SELECT COUNT(*) AS n FROM papelera').get()).toEqual({ n: 0 });
    expect(await readdir(join(t.dir, 'referencias'))).toEqual([]);
  }, 30_000);
});
