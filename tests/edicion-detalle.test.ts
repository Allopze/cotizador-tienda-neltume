import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CotizacionPanel, datosClienteAnterior, esOtroTransportista, type AccionesPanel } from '../src/app/cotizacion-panel';
import { medidasAlta } from '../src/app/alta-producto';
import { errorMedida, leerMedida } from '../src/app/formato';
import type { Rechazo } from '../src/catalogo/resolver';
import type { Catalogo, Cliente, Producto, SolicitudItem } from '../src/catalogo/tipos';
import type { Cotizacion } from '../src/negocio/estado';
import { preguntasPendientes } from '../src/negocio/pendientes';
import { familiaEspecial, familiaItem, productoPersonalizado } from '../src/negocio/personalizados';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { Servicio } from '../src/servidor/servicio';

vi.mock('../src/servidor/pdf', () => ({
  prepararPdf: vi.fn(async () => {}),
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

const puerta: Producto = {
  codigo: 'HUI-M-3-A', modelo: 'Huilo Huilo', familia: 'PUERTA', tipo: 'PUERTA SÓLIDA', madera: 'MARA',
  medida: '0,80 A 0,85', anchoMin: 0.8, anchoMax: 0.85, altoMin: 2.3, altoMax: 2.4, largo: 2.35,
  precioNeto: 100_000, descripcion: 'HUILO HUILO MARA 0,80 A 0,85 MT X 2,30 A 2,40 MT', filaOrigen: 7,
};
/** Accesorio de más de 3 m: el catálogo los tiene y la pantalla los mostraba como «Agregar alto o largo». */
const moldura: Producto = {
  codigo: 'GUA-O-1X4-36', modelo: 'Guardapolvo', familia: 'MOLDURA', tipo: null, madera: 'PINO OREGON',
  medida: '1X4', anchoMin: null, anchoMax: null, largo: 3.6, precioNeto: 12_000,
  descripcion: 'GUARDAPOLVO PINO OREGON 1X4 3,60 MT', filaOrigen: 9,
};
const catalogo: Catalogo = {
  fuente: 'test.xlsx', sha256: 'catalogo-test', fecha: '2026-01-01T00:00:00.000Z', productos: [puerta, moldura],
};
const item = (s: Partial<SolicitudItem>): SolicitudItem => ({
  modelo: 'Huilo Huilo', madera: 'MARA', ancho: 0.82, alto: 2.35, medida: null, cantidad: 1, ...s,
});

async function servicio() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-edicion-detalle-'));
  dirs.push(dir);
  const llm = { interpretar: vi.fn() };
  return { dir, llm, servicio: new Servicio(catalogo, llm, new Almacen(dir)) };
}

const acciones = (): AccionesPanel => ({
  emitir: vi.fn(), aprobar: vi.fn(), quitar: vi.fn(), duplicar: vi.fn(), eliminar: vi.fn(), anular: vi.fn(),
  editar: vi.fn(async () => true), reordenar: vi.fn(async () => true), deshacer: vi.fn(async () => true),
  rehacer: vi.fn(async () => true), puedeDeshacer: false, puedeRehacer: false, despacho: vi.fn(async () => true),
  anularPago: vi.fn(async () => true), descargar: vi.fn(), copiar: vi.fn(), flujo: vi.fn(async () => true),
});
const panel = (actual: Cotizacion) =>
  renderToStaticMarkup(
    createElement(CotizacionPanel, {
      asistente: false, actual, enCurso: null, guardando: null, descargando: null, acciones: acciones(),
      tituloRef: { current: null }, agregarProducto: () => {}, cambioVisual: null, mostrarCotizacion: () => {},
      cargando: false,
    }),
  );
/** HTML de la celda Unitario del ítem `i`. */
const unitario = (html: string, i: number) =>
  html.match(new RegExp(`<tr id="producto-${i}"[\\s\\S]*?<td class="celda-monto" data-etiqueta="Unitario">([\\s\\S]*?)</td>`))![1];

describe('leer una medida escrita (una sola función, con la familia)', () => {
  it('acepta coma, punto, centímetros y milímetros, con o sin unidad', () => {
    for (const texto of ['80', '0,80', '0.80', '0,8', '80 cm', '80cm', '800 mm', '0,80 m', ' 80 CM '])
      expect(leerMedida(texto, 'PUERTA', 'ancho'), texto).toBe(0.8);
    for (const texto of ['2,10', '2.1', '210', '210 cm', '2100 mm', '2.100 mm', '2,10 mts.'])
      expect(leerMedida(texto, 'PUERTA'), texto).toBe(2.1);
  });

  it('el largo de un accesorio llega a 6 m; el de una puerta, a 3 m; el ancho siempre es de puerta', () => {
    for (const familia of ['MOLDURA', 'MARCO', 'PIEZAS_T'])
      for (const texto of ['3,6', '3.60', '360', '360 cm', '3600 mm']) expect(leerMedida(texto, familia), texto).toBe(3.6);
    expect(leerMedida('6', 'MOLDURA')).toBe(6);
    expect(leerMedida('6,1', 'MOLDURA')).toBeNull();
    expect(leerMedida('3,6', 'PUERTA')).toBeNull();
    expect(leerMedida('3,6', 'MOLDURA', 'ancho')).toBeNull();
  });

  it('lo vacío, ilegible o fuera de rango es null: nunca se guarda vacío en silencio', () => {
    for (const texto of ['', '  ', 'ochenta', '80 pulgadas', '0,8,1', '0,1', '-0,8', '1e2', '80 cm cm'])
      expect(leerMedida(texto, 'PUERTA', 'ancho'), texto).toBeNull();
  });

  it('el mensaje dice el rango de la familia y cómo escribirla', () => {
    expect(errorMedida('alto', 'MOLDURA')).toBe(
      'Indica un largo entre 0,3 y 6 m: en metros (3,60), centímetros (360 cm) o milímetros (3600 mm).',
    );
    expect(errorMedida('alto', 'PUERTA')).toContain('un alto entre 0,3 y 3 m');
    expect(errorMedida('ancho', 'MOLDURA')).toContain('un ancho entre 0,3 y 3 m');
  });
});

describe('Catálogo → Agregar producto lee las medidas con el mismo lector', () => {
  const vacio = { familia: 'PUERTA', anchoMin: '', anchoMax: '', largo: '' };
  it('acepta centímetros y milímetros con unidad, y «3600» en un accesorio son 3,6 m', () => {
    expect(medidasAlta({ ...vacio, anchoMin: '80 cm', anchoMax: '850 mm', largo: '2100 mm' })).toEqual({
      anchoMin: 0.8,
      anchoMax: 0.85,
      largo: 2.1,
      errores: {},
    });
    for (const largo of ['3600 mm', '3600', '360 cm', '3,6'])
      expect(medidasAlta({ ...vacio, familia: 'MOLDURA', largo }), largo).toEqual({
        anchoMin: null,
        anchoMax: null,
        largo: 3.6,
        errores: {},
      });
  });
  it('lo vacío pide el dato; lo ilegible o fuera de rango dice el rango de la familia', () => {
    expect(medidasAlta(vacio).errores).toEqual({
      anchoMin: 'Escribe el ancho mínimo.',
      anchoMax: 'Escribe el ancho máximo.',
      largo: 'Escribe el alto.',
    });
    const r = medidasAlta({ ...vacio, anchoMin: '4', anchoMax: 'ochenta', largo: '3,6' });
    expect(r.errores).toEqual({
      anchoMin: errorMedida('ancho', 'PUERTA'),
      anchoMax: errorMedida('ancho', 'PUERTA'),
      largo: errorMedida('alto', 'PUERTA'),
    });
    expect(medidasAlta({ ...vacio, familia: 'MARCO', largo: '7' }).errores).toEqual({
      largo: errorMedida('alto', 'MARCO'),
    });
  });
});

describe('rango de 6 m de los accesorios en la pantalla', () => {
  it('la familia de un ítem sale del pedido especial, del producto cotizado o del rechazo y su nombre', () => {
    const s = item({ modelo: 'Guardapolvo', ancho: null, medida: '1X4', alto: 3.6 });
    expect(familiaItem(item({ personalizado: { familia: 'MOLDURA' } }), { familia: 'PUERTA' })).toBe('MOLDURA');
    expect(familiaItem(item({}), { familia: 'MARCO' })).toBe('MARCO');
    expect(familiaItem(s, null, { tipo: 'medida_implausible', campo: 'alto', valor: 9, disponibles: [] })).toBe('MOLDURA');
    expect(familiaItem(item({}))).toBe('PUERTA');
    expect(familiaEspecial(null, s)).toBe('MOLDURA');
  });

  it('un pedido especial de moldura de 3,6 m se valoriza (antes quedaba sin largo)', async () => {
    const r = productoPersonalizado(item({ modelo: 'Cornisa', ancho: null, alto: 3.6, precioUnitario: 20_000 }), 'MOLDURA');
    expect(r).toMatchObject({ ok: true, alto: 3.6, ancho: null });
    expect(productoPersonalizado(item({ ancho: null, alto: 3.6, precioUnitario: 20_000 }), 'PUERTA')).toEqual({
      ok: false, campos: ['alto'],
    });
    const { servicio: s } = await servicio();
    const { cotizacion } = await s.ejecutar({
      tipo: 'agregar_personalizado',
      item: { nombre: 'Cornisa', familia: 'MOLDURA', madera: 'Roble', descripcion: null, ancho: null, alto: 3.6,
        cantidad: 2, precioUnitario: 20_000, observaciones: null },
    });
    expect(cotizacion.incompletos).toEqual([]);
    expect(cotizacion.montos.lineas[0].altoSolicitado).toBe(3.6);
  });

  it('el detalle muestra el largo de 3,6 m de una moldura del catálogo, no «Agregar alto o largo»', async () => {
    const { servicio: s } = await servicio();
    const { cotizacion } = await s.ejecutar({ tipo: 'agregar_producto', codigo: moldura.codigo, cantidad: 2, alto: 3.6 });
    expect(cotizacion.incompletos).toEqual([]);
    const html = panel(cotizacion);
    expect(html).toContain('aria-label="Editar alto / largo (m): 3,6"');
    expect(html).toContain('<span>3,60</span>');
    expect(html).not.toContain('Agregar alto o largo');
  });

  it('una pregunta de largo de un accesorio admite hasta 6 m y lleva la familia para leer lo escrito', () => {
    const implausible: Rechazo = { tipo: 'medida_implausible', campo: 'alto', valor: 9, disponibles: [] };
    const [accesorio] = preguntasPendientes({
      solicitudes: [item({ modelo: 'Guardapolvo', ancho: null, medida: '1X4', alto: 9 })],
      incompletos: [{ indice: 0, rechazo: implausible, pregunta: '' }],
    });
    expect(accesorio.entrada).toMatchObject({ min: 0.3, max: 6, unidad: 'm', familia: 'MOLDURA' });
    const [dePuerta] = preguntasPendientes({
      solicitudes: [item({ alto: 9 })],
      incompletos: [{ indice: 0, rechazo: implausible, pregunta: '' }],
    });
    expect(dePuerta.entrada).toMatchObject({ min: 0.3, max: 3, familia: 'PUERTA' });
  });

  it('el alta desde un pendiente precarga el largo de 3,6 m de un accesorio y sugiere el de otro ítem en cm', () => {
    const [p] = preguntasPendientes({
      solicitudes: [item({ modelo: 'Guardapolvo', ancho: null, medida: '1X4', alto: 3.6 })],
      incompletos: [{
        indice: 0,
        rechazo: { tipo: 'medida_no_disponible', campo: 'medida', valor: '1X4', disponibles: [], familia: 'MOLDURA' },
        pregunta: '',
      }],
    });
    expect(p.alta).toMatchObject({ familia: 'MOLDURA', largo: 3.6 });
    // Otro ítem con el largo en centímetros (360): con el tope de puertas se leía como 0,36 m.
    const [largo] = preguntasPendientes({
      solicitudes: [
        item({ modelo: 'Guardapolvo', ancho: null, medida: '1X4', alto: 360 }),
        item({ modelo: 'Guardapolvo', ancho: null, medida: '1X4', alto: null }),
      ],
      incompletos: [{
        indice: 1,
        rechazo: { tipo: 'medida_no_disponible', campo: 'alto', valor: 0, disponibles: [], familia: 'MOLDURA', rango: { min: 2.4, max: 3.6 } },
        pregunta: '',
      }],
    });
    expect(largo.opciones).toEqual([{ etiqueta: '3,60 m', valor: 3.6, sugerencia: 'Como el ítem 1' }]);
  });
});

describe('ítem pendiente por precio o descuento: se corrige en la celda Unitario', () => {
  const pendiente = async (cambios: Partial<SolicitudItem>) => {
    const { servicio: s } = await servicio();
    let q = (await s.ejecutar({ tipo: 'agregar_producto', codigo: puerta.codigo, cantidad: 1, ancho: 0.82, alto: 2.35 }))
      .cotizacion;
    // Como lo deja deshacer o el chat: el precio o el descuento quedan fuera de regla y el ítem, pendiente.
    q = (await s.ejecutar({
      tipo: 'restaurar_items', id: q.id, actualizada: q.actualizada, items: [{ ...q.solicitudes[0], ...cambios }],
    })).cotizacion;
    expect(q.montos.lineas).toHaveLength(0);
    return q;
  };

  it('un precio fuera de rango se edita en la misma celda (antes mostraba «—»)', async () => {
    const html = unitario(panel(await pendiente({ precioUnitario: 40_000 })), 0);
    expect(html).toContain('aria-label="Editar precio unitario: 40000"');
    expect(html).toContain('$40.000');
    expect(html).not.toContain('—');
  });

  it('un descuento que supera el precio se corrige ahí mismo, con su tipo', async () => {
    const html = unitario(panel(await pendiente({ descuento: { tipo: 'monto', valor: 155_001 } })), 0);
    expect(html).toContain('aria-label="Editar descuento especial del ítem: 155001"');
    expect(html).toContain('Descuento $155.001 c/u');
    // Sin precio fijado a mano, el precio también se puede fijar desde la celda.
    expect(html).toContain('Precio de catálogo');
  });
});

describe('transportista y cliente', () => {
  it('«Otro» no es el nombre de un transportista', () => {
    for (const t of ['Otro', ' otro ', 'OTRO']) expect(esOtroTransportista(t)).toBe(true);
    for (const t of ['Starken', 'Otro Express', '', null]) expect(esOtroTransportista(t)).toBe(false);
  });

  it('elegir un cliente anterior completa sus datos sin borrar lo que no trae', () => {
    const anterior: Omit<Cliente, 'proyecto'> = {
      nombre: 'Constructora Sur', rut: '76.543.210-3', giro: null, telefono: '+56 9 1234 5678',
      direccion: 'Los Aromos 12', comuna: 'Temuco',
    };
    expect(datosClienteAnterior(anterior)).toEqual({
      nombre: 'Constructora Sur', rut: '76.543.210-3', telefono: '+56 9 1234 5678', direccion: 'Los Aromos 12',
      comuna: 'Temuco',
    });
  });
});
