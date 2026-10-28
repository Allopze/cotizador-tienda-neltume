import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Catalogo, Producto } from '../src/catalogo/tipos';
import { CORRELATIVOS_NOTA, type Cotizacion } from '../src/negocio/estado';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { guardarReferencia } from '../src/servidor/archivos-referencia';
import { chromiumPath } from '../src/servidor/chromium';
import type { FilaEnvio } from '../src/servidor/integracion-bandeja';
import { reintentarEnvio } from '../src/servidor/integracion-bandeja';
import { configuracionFabrica } from '../src/servidor/integracion-configuracion';
import { mensajeSchema, type MensajeFabrica } from '../src/servidor/integracion-contrato';
import { esperaReintento, esperarIntegracion, MAX_INTENTOS, procesarPendientes } from '../src/servidor/integracion-envio';
import { firmar, verificarFirma } from '../src/servidor/integracion-firma';
import { Servicio } from '../src/servidor/servicio';

// La integración con la fábrica de Panguipulli, de punta a punta: la nota de pedido se genera como siempre, el envío
// queda en la bandeja en la misma transacción y sale solo, firmado, a una fábrica simulada (fetch). La plantilla de
// los PDF es la real; la impresión se simula escribiendo el HTML en el archivo, salvo en el bloque con Chromium.

const pdfReal = vi.hoisted(() => ({ activo: false }));
vi.mock('../src/servidor/pdf', async (original) => {
  const real = await original<typeof import('../src/servidor/pdf')>();
  return {
    ...real,
    prepararPdf: vi.fn(async () => {}),
    generarPdf: vi.fn(async (directorio: string, archivo: string, html: string, ...resto: unknown[]) => {
      if (pdfReal.activo) return (real.generarPdf as (...a: unknown[]) => Promise<void>)(directorio, archivo, html, ...resto);
      const { mkdir: crear, writeFile: escribir } = await import('node:fs/promises');
      await crear(join(directorio, 'pdf'), { recursive: true });
      await escribir(join(directorio, 'pdf', archivo), `%PDF-simulado\n${html}`, { flag: 'wx' });
    }),
  };
});

const SECRETO = 'secreto-de-prueba-compartido-con-fabrica-0123456789';
const URL_FABRICA = 'https://fabrica-panguipulli.test';

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
  descripcion: 'MOLCO PINO OREGON 0,80 A 0,85 MT X 2 MT',
  filaOrigen: 4,
};
const marco: Producto = {
  codigo: 'MAR-O-2X4-A',
  modelo: 'MARCO',
  familia: 'MARCO',
  tipo: null,
  madera: 'PINO OREGON',
  medida: '2X4',
  anchoMin: null,
  anchoMax: null,
  largo: 2.1,
  precioNeto: 20_000,
  descripcion: 'MARCO PINO OREGON 2X4 2,1 MT',
  filaOrigen: 6,
};
const cozcoz: Producto = { ...molco, codigo: 'COZC-PP-080-220', modelo: 'COZ COZ', madera: 'PREPINTADA', precioNeto: 50_000, descripcion: 'COZ COZ PREPINTADA', filaOrigen: 5 };
const catalogo: Catalogo = { fuente: 'test', sha256: 'test', fecha: '2026-01-01', productos: [molco, marco, cozcoz] };
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
const admin = { nombre: 'Paula', email: 'paula@neltume.cl', admin: true };

interface Solicitud {
  url: string;
  metodo: string;
  cabeceras: Record<string, string>;
  cuerpo: Buffer;
}
/** Fábrica simulada: guarda cada solicitud y responde lo que diga `responder` (por omisión, la acepta). */
function fabricaSimulada() {
  const solicitudes: Solicitud[] = [];
  let responder = (s: Solicitud): Response | Promise<Response> =>
    s.metodo === 'PUT'
      ? new Response(null, { status: 201 })
      : Response.json({ status: 'accepted', eventId: (JSON.parse(s.cuerpo.toString()) as MensajeFabrica).eventId, factoryOrderId: 'F-1' }, { status: 202 });
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const s: Solicitud = {
      url,
      metodo: init.method!,
      cabeceras: Object.fromEntries(Object.entries(init.headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])),
      cuerpo: Buffer.from(init.body as Uint8Array),
    };
    solicitudes.push(s);
    // Como el fetch real: el plazo (AbortSignal.timeout) corta una fábrica que no responde.
    const senal = init.signal!;
    return Promise.race([
      responder(s),
      new Promise<never>((_, rechazar) => {
        if (senal.aborted) rechazar(senal.reason);
        senal.addEventListener('abort', () => rechazar(senal.reason));
      }),
    ]);
  });
  return {
    fetch,
    solicitudes,
    pedidos: () => solicitudes.filter((s) => s.metodo === 'POST').map((s) => mensajeSchema.parse(JSON.parse(s.cuerpo.toString()))),
    responder: (fn: typeof responder) => (responder = fn),
  };
}

const dirs: string[] = [];
let fabrica: ReturnType<typeof fabricaSimulada>;
beforeEach(() => {
  fabrica = fabricaSimulada();
  vi.stubGlobal('fetch', fabrica.fetch);
  vi.stubEnv('NELTUME_FABRICA_PANGUIPULLI_URL', URL_FABRICA);
  vi.stubEnv('NELTUME_FABRICA_PANGUIPULLI_SECRETO', SECRETO);
});
afterEach(async () => {
  for (const dir of dirs) await esperarIntegracion(dir);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});
afterAll(async () => (await import('../src/servidor/pdf')).cerrarNavegadorPdf());

/**
 * Cotización aprobada con anticipo: Molco 2 u. (820 × 2000 hoja, con observación y descripción escrita), un marco,
 * una puerta especial sin costo de fábrica con una foto del cliente (va «Por definir») y una Coz Coz para Santiago.
 */
async function preparar({ conSantiago = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-integracion-'));
  dirs.push(dir);
  const almacen = new Almacen(dir);
  const llm = { interpretar: vi.fn(() => Promise.reject(new Error('Sin IA en esta prueba.'))) };
  const servicio = new Servicio(catalogo, llm, almacen, admin);
  const foto = await guardarReferencia(dir, PNG, 'foto-puerta-cliente.png');
  let q = (await servicio.ejecutar({ tipo: 'agregar_producto', codigo: molco.codigo, cantidad: 2, ancho: 0.82, alto: 2, tipoMedida: 'hoja' })).cotizacion;
  const ir = async (accion: Record<string, unknown>) => {
    q = (await servicio.ejecutar({ ...accion, id: q.id, actualizada: q.actualizada } as never)).cotizacion;
    return q;
  };
  await ir({ tipo: 'agregar_producto', codigo: marco.codigo, cantidad: 3 });
  await ir({
    tipo: 'agregar_personalizado',
    item: {
      nombre: 'Puerta según diseño cliente',
      familia: 'PUERTA',
      madera: 'Roble',
      ancho: 0.9,
      alto: 2.1,
      tipoMedida: 'vano',
      cantidad: 1,
      precioUnitario: 345_000,
      observaciones: 'Copiar el tallado de la foto',
      referencias: [foto],
    },
  });
  if (conSantiago) await ir({ tipo: 'agregar_producto', codigo: cozcoz.codigo, cantidad: 1, ancho: 0.8, alto: 2, tipoMedida: 'hoja' });
  await ir({
    tipo: 'editar',
    cliente: { nombre: 'Constructora Ejemplo SpA', rut: '76.543.210-3', giro: 'Construcción', telefono: '+56 9 1111 2222', direccion: 'Av. Siempre Viva 123', comuna: 'Valdivia', proyecto: 'Edificio Los Robles' },
    items: [{ indice: 0, cambios: { observaciones: 'Bisagras a la derecha', descripcion: 'Puerta Molco oregón, panel liso' } }],
    observaciones: 'Entregar en obra, coordinar con el jefe de obra.',
  });
  const aprobada = async () => {
    await ir({ tipo: 'emitir' });
    await ir({ tipo: 'aprobar', despacho: { direccion: 'Camino a Niebla km 3', transporte: 'Starken', entregaComprometida: '15 de noviembre' } });
    return ir({ tipo: 'pago', monto: Math.ceil(q.montos.total / 2) });
  };
  const asignaciones = [
    { indice: 0, fabrica: 'panguipulli' },
    { indice: 1, fabrica: 'panguipulli' },
    { indice: 2, fabrica: 'panguipulli' },
    ...(conSantiago ? [{ indice: 3, fabrica: 'santiago' }] : []),
  ];
  const generar = async (lista = asignaciones) => {
    await ir({ tipo: 'generar_nota', asignaciones: lista });
    await esperarIntegracion(dir);
    return q;
  };
  const db = () => almacen.baseDatos();
  const envios = () => db().prepare('SELECT * FROM integracion_envios ORDER BY id').all() as FilaEnvio[];
  return { dir, almacen, servicio, ir, aprobada, generar, envios, db, actual: () => q, foto };
}
const nota = (q: Cotizacion, f: string) => q.notas.find((n) => n.fabrica === f)!;
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

describe('Integración con la fábrica de Panguipulli', () => {
  it('Santiago: una nota solo de Santiago no se encola ni se envía', async () => {
    const t = await preparar();
    await t.aprobada();
    const q = await t.generar([0, 1, 2, 3].map((indice) => ({ indice, fabrica: 'santiago' })));
    expect(q.notas.map((n) => n.fabrica)).toEqual(['santiago']);
    expect(t.envios()).toEqual([]);
    expect(fabrica.fetch).not.toHaveBeenCalled();
    // Ni definiendo variables para Santiago: la fábrica no está integrada.
    vi.stubEnv('NELTUME_FABRICA_SANTIAGO_URL', URL_FABRICA);
    vi.stubEnv('NELTUME_FABRICA_SANTIAGO_SECRETO', SECRETO);
    expect(configuracionFabrica('santiago')).toBeNull();
  });

  it('Panguipulli: la nota se encola en la misma transacción y se envía sola, firmada, con ambos documentos', async () => {
    const t = await preparar();
    await t.aprobada();
    const q = await t.generar();
    // El flujo comercial es el de siempre: dos notas, cada una con su correlativo.
    expect(q.notas.map((n) => [n.fabrica, n.numero])).toEqual([
      ['panguipulli', CORRELATIVOS_NOTA.panguipulli],
      ['santiago', CORRELATIVOS_NOTA.santiago],
    ]);
    const [envio, ...otros] = t.envios();
    expect(otros).toEqual([]);
    expect(envio).toMatchObject({ fabrica: 'panguipulli', revision: 1, evento: 'order.ready', estado: 'entregado', intentos: 1, ultimo_status: 202 });
    // Primero la foto del cliente (adjunto por sha256) y después el pedido.
    expect(fabrica.solicitudes.map((s) => `${s.metodo} ${s.url}`)).toEqual([
      `PUT ${URL_FABRICA}/api/integrations/neltume/attachments/${sha(PNG)}`,
      `POST ${URL_FABRICA}/api/integrations/neltume/orders`,
    ]);
    const post = fabrica.solicitudes[1];
    expect(post.cabeceras['content-type']).toBe('application/json');
    expect(post.cabeceras['x-idempotency-key']).toBe(`neltume-store:${q.id}:PANGUIPULLI:1`);
    const [m] = fabrica.pedidos();
    expect(m).toMatchObject({
      schemaVersion: '1.0',
      eventType: 'order.ready',
      eventId: envio.evento_id,
      source: 'neltume-store',
      sourceOrderId: q.id,
      sourceOrderRevision: 1,
      destinationFactoryCode: 'PANGUIPULLI',
      order: { orderNumber: String(CORRELATIVOS_NOTA.panguipulli), quoteNumber: q.numero },
    });
    // Documento A: el PDF de la nota de pedido, byte a byte. Documento B: la orden de trabajo de la misma nota.
    const comercial = await readFile(join(t.dir, 'pdf', nota(q, 'panguipulli').pdf));
    expect(Buffer.from(m.documents!.commercial.contentBase64, 'base64').equals(comercial)).toBe(true);
    expect(m.documents!.commercial).toMatchObject({ filename: `nota-pedido-panguipulli-${CORRELATIVOS_NOTA.panguipulli}-comercial.pdf`, sha256: sha(comercial) });
    const produccion = Buffer.from(m.documents!.production.contentBase64, 'base64');
    expect(m.documents!.production.sha256).toBe(sha(produccion));
    expect(produccion.toString()).toContain('Orden de trabajo');
    expect(produccion.toString()).toContain(`N.º ${CORRELATIVOS_NOTA.panguipulli}`);
  });

  it('una cotización preliminar, emitida o aprobada sin nota no se envía', async () => {
    const t = await preparar();
    expect(t.actual().estado).toBe('borrador');
    await t.ir({ tipo: 'emitir' });
    await t.ir({ tipo: 'aprobar' });
    await t.ir({ tipo: 'pago', monto: Math.ceil(t.actual().montos.total / 2) });
    await esperarIntegracion(t.dir);
    expect(t.envios()).toEqual([]);
    expect(fabrica.fetch).not.toHaveBeenCalled();
  });

  it('documento comercial: la nota de siempre, con precios de fábrica y totales', async () => {
    const t = await preparar();
    await t.aprobada();
    const q = await t.generar();
    const n = nota(q, 'panguipulli');
    const html = (await readFile(join(t.dir, 'pdf', n.pdf), 'utf8')).replace(/\s+/g, ' ');
    expect(html).toContain('Nota de pedido');
    expect(html).toContain('Precio fábrica');
    expect(html).toContain('$100.000');
    expect(html).toContain('Por definir');
    const [m] = fabrica.pedidos();
    // Lo comercial estructurado coincide con la nota: precios de fábrica, el especial sin costo «Por definir».
    expect(m.order!.commercial).toEqual({
      currency: 'CLP',
      basis: 'factory_price_net',
      lines: [
        { lineNumber: 1, unitPrice: 100_000, lineTotal: 200_000 },
        { lineNumber: 2, unitPrice: 20_000, lineTotal: 60_000 },
        { lineNumber: 3, unitPrice: null, lineTotal: null },
      ],
      subtotal: n.montos.subtotal,
      discount: 0,
      net: n.montos.neto,
      vatRate: 0.19,
      vat: n.montos.iva,
      total: n.montos.total,
    });
    expect(n.montos.subtotal).toBe(260_000);
  });

  it('orden de trabajo: sin precios, totales, IVA ni descuentos en el contenido', async () => {
    const t = await preparar();
    await t.aprobada();
    await t.generar();
    const [m] = fabrica.pedidos();
    const texto = Buffer.from(m.documents!.production.contentBase64, 'base64').toString();
    for (const prohibido of ['$', 'Precio', 'precio fábrica', 'Total', 'IVA', 'Neto', 'Subtotal', 'Descuento', 'Por definir', '100.000', '345.000'])
      expect(texto, prohibido).not.toContain(prohibido);
    // Pero sí todo lo de producción.
    for (const necesario of ['Puerta Molco oregón, panel liso', 'Bisagras a la derecha', 'Copiar el tallado de la foto', 'Camino a Niebla km 3', '15 de noviembre', 'Entregar en obra'])
      expect(texto, necesario).toContain(necesario);
    // La foto del cliente va como imagen en las observaciones, con su ítem; no por su nombre. Se imprime desde el
    // directorio de datos.
    expect(texto).toMatch(/<div class="imagenes-item"><p class="k">Ítem 3 · Puerta según diseño cliente · Roble<\/p><div><img class="ref" src="neltume-referencia:[0-9a-f]{64}\.png" alt=""><\/div>/);
    expect(texto).not.toContain('foto-puerta-cliente.png');
    const { generarPdf } = await import('../src/servidor/pdf');
    const orden = vi.mocked(generarPdf).mock.calls.find((c) => c[2].includes('<p class="tipo">Orden de trabajo</p>'));
    expect(orden?.[4]).toMatchObject({ referenciasDe: t.dir });
  });

  it('transfiere todos los productos de su fábrica con sus especificaciones, como los imprime la nota', async () => {
    const t = await preparar();
    await t.aprobada();
    const q = await t.generar();
    const [m] = fabrica.pedidos();
    const o = m.order!;
    // Del cliente solo viaja la obra (los demás datos personales quedan en el PDF comercial); tampoco las cuentas.
    expect(o.customer).toEqual({
      name: null,
      taxId: null,
      businessActivity: null,
      phone: null,
      address: null,
      commune: null,
      project: 'Edificio Los Robles',
    });
    expect([o.approvedBy, o.issuedBy]).toEqual([null, null]);
    expect(JSON.stringify(m)).not.toMatch(/76\.543\.210-3|1111 2222|Siempre Viva|Constructora Ejemplo/);
    expect(o.delivery).toEqual({ address: 'Camino a Niebla km 3', carrier: 'Starken', destination: null, committedDelivery: '15 de noviembre' });
    expect(o.notes).toBe('Entregar en obra, coordinar con el jefe de obra.');
    expect(o.relatedOrders).toEqual([{ factoryCode: 'SANTIAGO', orderNumber: String(CORRELATIVOS_NOTA.santiago), itemCount: 1 }]);
    // Los tres ítems de Panguipulli (también el especial sin costo); la Coz Coz va solo en la nota de Santiago.
    expect(o.items).toHaveLength(3);
    expect(o.items[0]).toEqual({
      lineNumber: 1,
      sourceItemIndex: 0,
      productCode: 'MOL-O-3-A',
      catalogReference: 'MOL-O-3-A · 0,80–0,85 × 2,00 m',
      isCustom: false,
      family: 'PUERTA',
      model: 'MOLCO',
      wood: 'PINO OREGON',
      productType: 'PUERTA PANEL',
      description: 'Puerta Molco oregón, panel liso',
      descriptionEdited: true,
      quantity: 2,
      dimensions: { widthMm: 820, heightMm: 2000, lengthMm: null, section: null, measureType: 'hoja', requested: '820 × 2000 mm (Hoja)' },
      observations: 'Bisagras a la derecha',
      references: [],
    });
    expect(o.items[1]).toMatchObject({ lineNumber: 2, productCode: 'MAR-O-2X4-A', family: 'MARCO', quantity: 3, dimensions: { widthMm: null, heightMm: null, lengthMm: 2100, section: '2X4' } });
    expect(o.items[2]).toMatchObject({
      lineNumber: 3,
      sourceItemIndex: 2,
      productCode: 'ESPECIAL',
      catalogReference: null,
      isCustom: true,
      model: 'Puerta según diseño cliente',
      wood: 'Roble',
      quantity: 1,
      dimensions: { widthMm: 900, heightMm: 2100, measureType: 'vano' },
      observations: 'Copiar el tallado de la foto',
      references: [{ attachmentId: sha(PNG), filename: 'foto-puerta-cliente.png', mimeType: 'image/png', sizeBytes: PNG.length }],
    });
    // La foto llegó entera como adjunto, con su sha256 como nombre.
    expect(fabrica.solicitudes[0].cuerpo.equals(Buffer.from(PNG))).toBe(true);
    expect(fabrica.solicitudes[0].cabeceras['content-type']).toBe('image/png');
    expect(q.solicitudes[3].fabrica).toBe('santiago');
  });

  it('un fallo pasajero deja el envío pendiente con espera exponencial y la nota se genera igual', async () => {
    const t = await preparar();
    await t.aprobada();
    fabrica.responder(() => new Response('caída', { status: 503 }));
    const antes = Date.now();
    const q = await t.generar();
    expect(q.notas).toHaveLength(2);
    expect(q.estadoOperativo).toBe('pedido_generado');
    const [e] = t.envios();
    expect(e).toMatchObject({ estado: 'pendiente', intentos: 1, ultimo_status: 503, entregado: null });
    expect(e.ultimo_error).toMatch(/503/);
    const espera = Date.parse(e.proximo_intento) - antes;
    expect(espera).toBeGreaterThanOrEqual(0.8 * 30_000);
    expect(espera).toBeLessThan(1.2 * 30_000 + 5_000);
    // Antes de tiempo no se reintenta.
    expect(await procesarPendientes({ directorio: t.dir, db: t.db() })).toBe(0);
    expect(esperaReintento(1, () => 0.5)).toBe(30_000);
    expect(esperaReintento(5, () => 0.5)).toBe(480_000);
    expect(esperaReintento(40, () => 0.5)).toBe(6 * 3_600_000);
    // Una caída de red cuenta igual: pendiente, sin perder el pedido.
    t.db().prepare("UPDATE integracion_envios SET proximo_intento = '2000-01-01T00:00:00.000Z'").run();
    fabrica.responder(() => Promise.reject(new TypeError('fetch failed')));
    await procesarPendientes({ directorio: t.dir, db: t.db() });
    expect(t.envios()[0]).toMatchObject({ estado: 'pendiente', intentos: 2, ultimo_status: null });
    expect(t.envios()[0].ultimo_error).toMatch(/No se pudo conectar/);
  });

  it('reintenta lo pendiente con el mismo evento y la misma clave, y queda entregado al confirmar', async () => {
    const t = await preparar();
    await t.aprobada();
    fabrica.responder((s) => new Response(null, { status: s.metodo === 'PUT' ? 201 : 502 }));
    await t.generar();
    const [primero] = t.envios();
    expect(primero).toMatchObject({ estado: 'pendiente', ultimo_status: 502 });
    fabrica.responder((s) => (s.metodo === 'PUT' ? new Response(null, { status: 200 }) : Response.json({ status: 'accepted', eventId: primero.evento_id }, { status: 201 })));
    const despues = new Date(Date.parse(primero.proximo_intento) + 1);
    expect(await procesarPendientes({ directorio: t.dir, db: t.db(), ahora: () => despues })).toBe(1);
    const [e] = t.envios();
    expect(e).toMatchObject({ estado: 'entregado', intentos: 2, ultimo_status: 201, ultimo_error: null });
    const posts = fabrica.solicitudes.filter((s) => s.metodo === 'POST');
    expect(posts).toHaveLength(2);
    expect(new Set(posts.map((s) => s.cabeceras['x-idempotency-key']))).toEqual(new Set([primero.clave_idempotencia]));
    expect(new Set(fabrica.pedidos().map((m) => m.eventId))).toEqual(new Set([primero.evento_id]));
    // La orden de trabajo se imprimió una vez: el reintento manda los mismos bytes.
    const [a, b] = fabrica.pedidos();
    expect(a.documents!.production.sha256).toBe(b.documents!.production.sha256);
    // Ya entregado, otra pasada no vuelve a enviarlo.
    expect(await procesarPendientes({ directorio: t.dir, db: t.db(), ahora: () => new Date(despues.getTime() + 86_400_000) })).toBe(0);
  });

  it('sin duplicados: repetir la nota, dos pasadas a la vez y un «duplicate» de la fábrica', async () => {
    const t = await preparar();
    await t.aprobada();
    let soltar!: () => void;
    const retenida = new Promise<void>((r) => (soltar = r));
    fabrica.responder(async (s) => {
      if (s.metodo === 'PUT') return new Response(null, { status: 201 });
      await retenida;
      return Response.json({ status: 'duplicate', eventId: (JSON.parse(s.cuerpo.toString()) as MensajeFabrica).eventId }, { status: 200 });
    });
    const generar = t.ir({ tipo: 'generar_nota', asignaciones: [0, 1, 2, 3].map((indice) => ({ indice, fabrica: indice === 3 ? 'santiago' : 'panguipulli' })) });
    await generar;
    // Mientras la primera pasada espera a la fábrica, otra no toma el mismo envío.
    await vi.waitFor(() => expect(fabrica.solicitudes.filter((s) => s.metodo === 'POST')).toHaveLength(1));
    expect(await procesarPendientes({ directorio: t.dir, db: t.db() })).toBe(0);
    soltar();
    await esperarIntegracion(t.dir);
    // Pedir la nota otra vez devuelve la misma y no encola nada.
    await t.ir({ tipo: 'generar_nota' });
    await esperarIntegracion(t.dir);
    expect(t.envios()).toHaveLength(1);
    expect(t.envios()[0]).toMatchObject({ estado: 'entregado', revision: 1 });
    expect(fabrica.solicitudes.filter((s) => s.metodo === 'POST')).toHaveLength(1);
    // La clave es estable por pedido y revisión, y única en la bandeja.
    expect(() =>
      t.db().prepare("INSERT INTO integracion_envios (cotizacion_id, fabrica, revision, evento, evento_id, clave_idempotencia, contenido, estado, proximo_intento, creado) SELECT cotizacion_id, fabrica, 2, evento, 'otro', clave_idempotencia, contenido, 'pendiente', creado, creado FROM integracion_envios").run(),
    ).toThrow(/UNIQUE/);
  });

  it('firma HMAC-SHA256 sobre el timestamp y los bytes del cuerpo, que la fábrica puede verificar', async () => {
    const t = await preparar();
    await t.aprobada();
    await t.generar();
    for (const s of fabrica.solicitudes) {
      const cabeceras = { timestamp: s.cabeceras['x-neltume-timestamp'], firma: s.cabeceras['x-neltume-signature'] };
      expect(cabeceras.firma).toMatch(/^v1=[0-9a-f]{64}$/);
      expect(Math.abs(Number(cabeceras.timestamp) - Date.now() / 1000)).toBeLessThan(60);
      expect(verificarFirma([SECRETO], cabeceras, s.cuerpo)).toEqual({ ok: true });
      // Otro secreto, un byte cambiado o un timestamp viejo no pasan.
      expect(verificarFirma(['otro-secreto-que-no-es-el-compartido-xx'], cabeceras, s.cuerpo)).toEqual({ ok: false, motivo: 'firma_invalida' });
      const alterado = Buffer.from(s.cuerpo);
      alterado[alterado.length - 2] ^= 1;
      expect(verificarFirma([SECRETO], cabeceras, alterado)).toEqual({ ok: false, motivo: 'firma_invalida' });
      expect(verificarFirma([SECRETO], cabeceras, s.cuerpo, Date.now() + 600_000)).toEqual({ ok: false, motivo: 'fuera_de_plazo' });
      // El secreto nunca viaja.
      expect(s.cuerpo.includes(SECRETO)).toBe(false);
      expect(JSON.stringify(s.cabeceras)).not.toContain(SECRETO);
    }
    // Vector fijo, para comprobar la implementación de la fábrica con los mismos datos.
    const vector = firmar('clave-de-ejemplo-de-32-caracteres!!', Buffer.from('{"a":1}'), 1_700_000_000_000);
    expect(vector).toEqual({
      'X-Neltume-Timestamp': '1700000000',
      'X-Neltume-Signature': 'v1=b0803f898b2ee4c6ca49b967fce6ecac5066ef75f4c37f9785b92a47269b7552',
    });
    expect(verificarFirma(['viejo-secreto-rotado-0000000000000000', 'clave-de-ejemplo-de-32-caracteres!!'], { timestamp: '1700000000', firma: vector['X-Neltume-Signature'] }, Buffer.from('{"a":1}'), 1_700_000_100_000)).toEqual({ ok: true });
  });

  it('errores permanentes y confirmaciones inválidas: no se reintenta en vano ni se marca entregado sin confirmar', async () => {
    const t = await preparar({ conSantiago: false });
    await t.aprobada();
    // 2xx sin confirmar el evento: no está entregado.
    fabrica.responder((s) => (s.metodo === 'PUT' ? new Response(null, { status: 201 }) : Response.json({ ok: true })));
    await t.generar();
    expect(t.envios()[0]).toMatchObject({ estado: 'pendiente', intentos: 1, ultimo_status: 200 });
    expect(t.envios()[0].ultimo_error).toMatch(/sin confirmar/);
    // 422: la fábrica rechazó el contenido; repetirlo daría lo mismo.
    fabrica.responder((s) => (s.metodo === 'PUT' ? new Response(null, { status: 201 }) : Response.json({ error: { code: 'invalid_item', message: 'items[2].quantity' } }, { status: 422 })));
    t.db().prepare("UPDATE integracion_envios SET proximo_intento = '2000-01-01T00:00:00.000Z'").run();
    await procesarPendientes({ directorio: t.dir, db: t.db() });
    expect(t.envios()[0]).toMatchObject({ estado: 'fallido', intentos: 2, ultimo_status: 422 });
    expect(t.envios()[0].ultimo_error).toContain('invalid_item');
    expect(await procesarPendientes({ directorio: t.dir, db: t.db(), ahora: () => new Date(Date.now() + 864e5) })).toBe(0);
    // Se puede volver a poner en cola a mano (npm run integracion -- reintentar).
    fabrica.responder((s) => (s.metodo === 'PUT' ? new Response(null, { status: 201 }) : Response.json({ status: 'accepted', eventId: (JSON.parse(s.cuerpo.toString()) as MensajeFabrica).eventId })));
    expect(reintentarEnvio(t.db(), t.envios()[0].id)).toBe(true);
    await procesarPendientes({ directorio: t.dir, db: t.db() });
    expect(t.envios()[0]).toMatchObject({ estado: 'entregado' });
    // Un error pasajero tampoco se repite para siempre.
    expect(MAX_INTENTOS).toBeGreaterThan(5);
  });

  it('compatible con el flujo actual: sin configuración nada cambia, y con la fábrica caída la nota no espera', async () => {
    vi.unstubAllEnvs();
    const sin = await preparar();
    await sin.aprobada();
    const q = await sin.generar();
    expect(q.notas).toHaveLength(2);
    expect(sin.envios()).toEqual([]);
    expect(fabrica.fetch).not.toHaveBeenCalled();
    // Con la integración, una fábrica que no responde no demora la nota: el envío corre aparte. La fábrica queda
    // retenida hasta después de que la nota ya se generó y guardó.
    vi.stubEnv('NELTUME_FABRICA_PANGUIPULLI_URL', URL_FABRICA);
    vi.stubEnv('NELTUME_FABRICA_PANGUIPULLI_SECRETO', SECRETO);
    const con = await preparar();
    await con.aprobada();
    let soltar!: () => void;
    const retenida = new Promise<void>((r) => (soltar = r));
    fabrica.responder(async (s) => {
      await retenida;
      return s.metodo === 'PUT' ? new Response(null, { status: 201 }) : new Response(null, { status: 503 });
    });
    const generada = await con.ir({ tipo: 'generar_nota', asignaciones: [0, 1, 2, 3].map((indice) => ({ indice, fabrica: indice === 3 ? 'santiago' : 'panguipulli' })) });
    expect(generada.notas).toHaveLength(2);
    expect(con.almacen.obtener(generada.id)!.notas).toHaveLength(2);
    await vi.waitFor(() => expect(fabrica.fetch).toHaveBeenCalled());
    // La nota ya respondió y el envío sigue en curso, sin intentos contados.
    expect(con.envios()[0]).toMatchObject({ estado: 'pendiente', intentos: 0 });
    expect(con.envios()[0].en_curso_hasta).not.toBeNull();
    soltar();
    await esperarIntegracion(con.dir);
    expect(con.envios()[0]).toMatchObject({ estado: 'pendiente', intentos: 1, ultimo_status: 503, en_curso_hasta: null });
  });

  it('control de versiones: cambiar el número envía la revisión 2 y anular avisa con order.cancelled', async () => {
    const t = await preparar();
    await t.aprobada();
    fabrica.responder(() => new Response(null, { status: 503 }));
    const q = await t.generar();
    const n = nota(q, 'panguipulli');
    // Una revisión nueva reemplaza la que todavía no salía: la fábrica recibe solo el pedido vigente.
    await t.ir({ tipo: 'cambiar_numero', documento: 'nota', fabrica: 'panguipulli', numero: n.numero + 10 });
    await esperarIntegracion(t.dir);
    let [r1, r2] = t.envios();
    expect(r1).toMatchObject({ revision: 1, estado: 'reemplazado' });
    expect(r2).toMatchObject({ revision: 2, evento: 'order.ready', estado: 'pendiente' });
    expect(JSON.parse(r2.contenido).order.orderNumber).toBe(String(n.numero + 10));
    expect(r2.clave_idempotencia).toBe(`neltume-store:${q.id}:PANGUIPULLI:2`);
    fabrica.responder((s) => (s.metodo === 'PUT' ? new Response(null, { status: 201 }) : Response.json({ status: 'accepted', eventId: (JSON.parse(s.cuerpo.toString()) as MensajeFabrica).eventId })));
    await procesarPendientes({ directorio: t.dir, db: t.db(), ahora: () => new Date(Date.parse(r2.proximo_intento) + 1) });
    [r1, r2] = t.envios();
    expect(r2.estado).toBe('entregado');
    const ultimo = fabrica.pedidos().at(-1)!;
    expect(ultimo).toMatchObject({ sourceOrderRevision: 2, order: { orderNumber: String(n.numero + 10) } });
    // El PDF comercial enviado es el reimpreso con el número nuevo.
    const reimpresa = nota(t.actual(), 'panguipulli');
    expect(Buffer.from(ultimo.documents!.commercial.contentBase64, 'base64').equals(await readFile(join(t.dir, 'pdf', reimpresa.pdf)))).toBe(true);
    // Anular la cotización avisa a la fábrica con la revisión siguiente.
    await t.ir({ tipo: 'anular', motivo: 'El cliente desistió' });
    await esperarIntegracion(t.dir);
    const r3 = t.envios().at(-1)!;
    expect(r3).toMatchObject({ revision: 3, evento: 'order.cancelled', estado: 'entregado' });
    expect(fabrica.pedidos().at(-1)).toMatchObject({
      eventType: 'order.cancelled',
      sourceOrderRevision: 3,
      cancellation: { orderNumber: String(n.numero + 10), cancelledBy: null, reason: 'El cliente desistió' },
    });
    expect(fabrica.pedidos().at(-1)!.documents).toBeUndefined();
  });

  it('corregir el pedido después de generar la nota envía la revisión 2 con la cantidad nueva y el PDF reimpreso', async () => {
    const t = await preparar();
    await t.aprobada();
    const q = await t.generar();
    await esperarIntegracion(t.dir);
    const n = nota(q, 'panguipulli');
    const indice = n.montos.lineas[0].indice!;
    await t.ir({ tipo: 'editar_pedido', items: [{ indice, cambios: { cantidad: 7 } }] });
    await esperarIntegracion(t.dir);
    const r2 = t.envios().at(-1)!;
    expect(r2).toMatchObject({ revision: 2, evento: 'order.ready', estado: 'entregado' });
    const ultimo = fabrica.pedidos().at(-1)!;
    expect(ultimo).toMatchObject({ sourceOrderRevision: 2, order: { orderNumber: String(n.numero) } });
    expect(ultimo.order!.items.find((i) => i.sourceItemIndex === indice)!.quantity).toBe(7);
    const reimpresa = nota(t.actual(), 'panguipulli');
    expect(reimpresa.pdf).not.toBe(n.pdf);
    expect(Buffer.from(ultimo.documents!.commercial.contentBase64, 'base64').equals(await readFile(join(t.dir, 'pdf', reimpresa.pdf)))).toBe(true);
  });

  it('un pedido anterior a la integración no se envía al renumerarlo ni al anularlo', async () => {
    vi.unstubAllEnvs();
    const t = await preparar();
    await t.aprobada();
    const q = await t.generar();
    vi.stubEnv('NELTUME_FABRICA_PANGUIPULLI_URL', URL_FABRICA);
    vi.stubEnv('NELTUME_FABRICA_PANGUIPULLI_SECRETO', SECRETO);
    await t.ir({ tipo: 'cambiar_numero', documento: 'nota', fabrica: 'panguipulli', numero: nota(q, 'panguipulli').numero + 5 });
    await t.ir({ tipo: 'anular' });
    await esperarIntegracion(t.dir);
    expect(t.envios()).toEqual([]);
    expect(fabrica.fetch).not.toHaveBeenCalled();
  });

  it('un archivo de referencia que falta deja el envío fallido sin mandar un pedido incompleto', async () => {
    const t = await preparar({ conSantiago: false });
    await t.aprobada();
    await rm(join(t.dir, 'referencias', t.foto.archivo));
    await t.generar();
    expect(t.envios()[0]).toMatchObject({ estado: 'fallido', intentos: 1 });
    expect(t.envios()[0].ultimo_error).toMatch(/Falta el archivo de referencia/);
    expect(fabrica.solicitudes.filter((s) => s.metodo === 'POST')).toEqual([]);
  });
});

describe.skipIf(!chromiumPath())('Integración: PDF reales (Chromium + pdfjs-dist)', () => {
  beforeEach(() => {
    pdfReal.activo = true;
  });
  afterEach(() => {
    pdfReal.activo = false;
  });
  async function textoPdf(bytes: Uint8Array) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const carga = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
    const documento = await carga.promise;
    const paginas: string[] = [];
    for (let n = 1; n <= documento.numPages; n++)
      paginas.push((await (await documento.getPage(n)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' '));
    await carga.destroy();
    return paginas.join('\n').replace(/\s+/g, ' ');
  }

  it('el PDF comercial trae los precios de fábrica y el operativo no trae ninguno', async () => {
    const t = await preparar();
    await t.aprobada();
    await t.generar();
    const [m] = fabrica.pedidos();
    const comercial = await textoPdf(Buffer.from(m.documents!.commercial.contentBase64, 'base64'));
    const produccion = await textoPdf(Buffer.from(m.documents!.production.contentBase64, 'base64'));
    expect(comercial).toContain('Precio fábrica');
    expect(comercial).toMatch(/\$\s?100\.000/);
    expect(comercial).toContain('IVA');
    expect(produccion).toContain('Orden de trabajo');
    expect(produccion).toContain('Bisagras a la derecha');
    expect(produccion).not.toMatch(/\$|Precio|IVA|Total|Neto|Subtotal|100\.000|200\.000|260\.000/);
    // La orden de trabajo quedó guardada aparte de los documentos que se descargan.
    const archivo = JSON.parse(t.envios()[0].contenido).documents.production.archivo;
    await expect(readFile(join(t.dir, 'integracion', 'pdf', archivo))).resolves.toBeInstanceOf(Buffer);
  }, 60_000);
});
