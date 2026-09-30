import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolverItem } from '../src/catalogo/resolver';
import type { Catalogo, Producto, SolicitudItem } from '../src/catalogo/tipos';
import { cotizar, REGLAS } from '../src/negocio/precios';
import { referenciaCatalogo } from '../src/app/formato';
import { Servicio } from '../src/servidor/servicio';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';

vi.mock('../src/servidor/pdf', () => ({
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

const c = (n: number) => n.toFixed(2).replace('.', ',');
// Forma real de la planilla: anchos en rangos con huecos de 5 cm y altos en escalones exactos.
const huilo = [[0.7, 0.75], [0.8, 0.85], [0.9, 0.95]].flatMap(([min, max], i) =>
  [2.0, 2.1, 2.3, 2.4].map((largo, j): Producto => ({
    codigo: `HUIL-M-${i + 2}-${'ABDE'[j]}`, modelo: 'Huilo Huilo', familia: 'PUERTA', tipo: 'PUERTA SÓLIDA',
    madera: 'MARA', medida: `${c(min)} A ${c(max)}`, anchoMin: min, anchoMax: max, largo,
    precioNeto: 300_000 + i * 10_000 + j * 1_000,
    descripcion: `HUILO HUILO MARA ${c(min)} A ${c(max)} MT X ${largo} MT`, filaOrigen: 10 + i * 4 + j,
  })),
);
// Forma de la segunda planilla: altos en rangos y anchos exactos.
const calafquen = [0.7, 0.8, 0.9].flatMap((ancho, i) =>
  [[2.0, 2.2], [2.21, 2.4]].map(([altoMin, altoMax], j): Producto => ({
    codigo: `CALA-M-${i + 1}-${j + 1}`, modelo: 'Calafquén', familia: 'PUERTA', tipo: 'PUERTA SÓLIDA',
    madera: 'MARA', medida: c(ancho), anchoMin: ancho, anchoMax: ancho, altoMin, altoMax, largo: altoMax,
    precioNeto: 200_000 + i * 10_000 + j * 1_000,
    descripcion: `CALAFQUEN MARA ${c(ancho)} MT X ${c(altoMin)} A ${c(altoMax)} MT`, filaOrigen: 30 + i * 2 + j,
  })),
);
// Marco: kits bajo 3 m y una pieza lineal de 3 m (más barata); moldura: piezas de 1, 2 y 3 m.
const marco = [2.5, 2.6, 3.0].map((largo, i): Producto => ({
  codigo: `MAR-M-2X4-${'FGH'[i]}`, modelo: 'MARCO', familia: 'MARCO', tipo: null, madera: 'MARA',
  medida: '2X4', anchoMin: null, anchoMax: null, largo, precioNeto: largo < 3 ? 99_000 + i * 3_000 : 51_000,
  descripcion: `MARCO MARA 2X4 PULG ${largo < 3 ? 'KIT' : `X ${largo} MT`}`, filaOrigen: 40 + i,
}));
const moldura = [1, 2, 3].map((largo, i): Producto => ({
  codigo: `ENDO-M-6X1-${'HIJ'[i]}`, modelo: 'ENDOLADO', familia: 'MOLDURA', tipo: null, madera: 'MARA',
  medida: '6X1', anchoMin: null, anchoMax: null, largo, precioNeto: 5_000 + i * 2_000,
  descripcion: `ENDOLADO MARA 6X1 CM X ${largo} MT`, filaOrigen: 50 + i,
}));
const catalogo: Catalogo = {
  fuente: 'escalones.xlsx', sha256: 'escalones', fecha: '2026-01-01T00:00:00.000Z',
  productos: [...huilo, ...calafquen, ...marco, ...moldura],
};
const puerta = (modelo: string, ancho: number, alto: number) =>
  resolverItem(catalogo, { modelo, madera: 'Mara', ancho, alto, cantidad: 1 });
const elegido = (r: ReturnType<typeof resolverItem>) =>
  r.ok ? [r.producto.codigo, r.ajusteAncho, r.ajusteAlto] : r.rechazo;

describe('medidas especiales por escalones del catálogo', () => {
  it('usa el escalón que contiene la medida: exacta o dentro de rango', () => {
    expect(elegido(puerta('Huilo Huilo', 0.8, 2.1))).toEqual(['HUIL-M-3-B', 'rango', 'exacto']);
    expect(elegido(puerta('Huilo Huilo', 0.83, 2.3))).toEqual(['HUIL-M-3-D', 'rango', 'exacto']);
    expect(elegido(puerta('Huilo Huilo', 0.85, 2.403))).toEqual(['HUIL-M-3-E', 'rango', 'exacto']);
  });

  it('en el hueco entre escalones cotiza la siguiente medida hacia arriba', () => {
    expect(elegido(puerta('Huilo Huilo', 0.8, 2.36))).toEqual(['HUIL-M-3-E', 'rango', 'siguiente']);
    expect(elegido(puerta('Huilo Huilo', 0.8, 2.2))).toEqual(['HUIL-M-3-D', 'rango', 'siguiente']);
    expect(elegido(puerta('Huilo Huilo', 0.87, 2.4))).toEqual(['HUIL-M-4-E', 'siguiente', 'exacto']);
    expect(elegido(puerta('Huilo Huilo', 0.87, 2.36))).toEqual(['HUIL-M-4-E', 'siguiente', 'siguiente']);
  });

  it('resuelve el caso de aceptación 83,5 × 236 cm (medida vano) con 0,80–0,85 × 2,40', () => {
    const r = resolverItem(catalogo, { modelo: 'Huilo Huilo', madera: 'Mara', ancho: 83.5, alto: 236, cantidad: 3, tipoMedida: 'vano' });
    expect(r.ok && [r.producto.codigo, r.cantidad, r.anchoSolicitado, r.altoSolicitado, r.ajusteAncho, r.ajusteAlto])
      .toEqual(['HUIL-M-3-E', 3, 0.835, 2.36, 'rango', 'siguiente']);
  });

  it('aplica la misma regla a altos en rango y anchos exactos', () => {
    expect(elegido(puerta('Calafquén', 0.8, 2.36))).toEqual(['CALA-M-2-2', 'exacto', 'rango']);
    expect(elegido(puerta('Calafquén', 0.8, 2.205))).toEqual(['CALA-M-2-2', 'exacto', 'siguiente']);
    expect(elegido(puerta('Calafquén', 0.803, 2.0))).toEqual(['CALA-M-2-1', 'exacto', 'rango']);
    expect(elegido(puerta('Calafquén', 0.75, 2.1))).toEqual(['CALA-M-2-1', 'siguiente', 'rango']);
  });

  it('bajo el menor escalón o sobre el mayor no hay precio: nunca se extrapola', () => {
    const casos: [string, number, number, 'ancho' | 'alto'][] = [
      ['Huilo Huilo', 0.8, 1.95, 'alto'],
      ['Huilo Huilo', 0.8, 2.7, 'alto'],
      ['Huilo Huilo', 0.55, 2.1, 'ancho'],
      ['Huilo Huilo', 1.0, 2.1, 'ancho'],
      ['Calafquén', 0.8, 1.95, 'alto'],
      ['Calafquén', 0.8, 2.45, 'alto'],
      ['Calafquén', 0.65, 2.1, 'ancho'],
      ['Calafquén', 0.95, 2.1, 'ancho'],
    ];
    for (const [modelo, ancho, alto, campo] of casos)
      expect(puerta(modelo, ancho, alto)).toMatchObject({ ok: false, rechazo: { tipo: 'medida_no_disponible', campo } });
  });

  it('los largos de accesorios suben al siguiente escalón sin saltar de kit a pieza; la escuadría es exacta', () => {
    const accesorio = (modelo: string, medida: string, alto: number) =>
      resolverItem(catalogo, { modelo, madera: 'Mara', medida, alto, cantidad: 1 });
    const noDisponible = (campo: string) => ({ ok: false, rechazo: { tipo: 'medida_no_disponible', campo } });
    expect(elegido(accesorio('Marco', '2x4', 2.6))).toEqual(['MAR-M-2X4-G', null, 'exacto']);
    expect(elegido(accesorio('Marco', '2x4', 2.55))).toEqual(['MAR-M-2X4-G', null, 'siguiente']);
    expect(elegido(accesorio('Marco', '2x4', 3.0))).toEqual(['MAR-M-2X4-H', null, 'exacto']);
    // 2,8 m supera el kit mayor (2,6): la pieza lineal de 3 m es otro producto, no el siguiente kit.
    expect(accesorio('Marco', '2x4', 2.8)).toMatchObject(noDisponible('alto'));
    expect(accesorio('Marco', '2x4', 2.45)).toMatchObject(noDisponible('alto'));
    // Sobre 3 m ya es una medida implausible (RANGO_METROS): tampoco tiene precio.
    expect(accesorio('Marco', '2x4', 3.1)).toMatchObject({ ok: false, rechazo: { tipo: 'medida_implausible', campo: 'alto' } });
    expect(accesorio('Marco', '2x5', 2.6)).toMatchObject(noDisponible('medida'));
    expect(elegido(accesorio('Endolado', '6x1', 1.5))).toEqual(['ENDO-M-6X1-I', null, 'siguiente']);
    expect(elegido(accesorio('Endolado', '6x1', 2.5))).toEqual(['ENDO-M-6X1-J', null, 'siguiente']);
  });

  it('la referencia del panel indica cuándo se usó la siguiente medida del catálogo', () => {
    const linea = (ancho: number, alto: number) => {
      const r = puerta('Huilo Huilo', ancho, alto);
      if (!r.ok) throw new Error('sin resolver');
      return cotizar([{ producto: r.producto, cantidad: 1, anchoSolicitado: r.anchoSolicitado, altoSolicitado: r.altoSolicitado }], REGLAS).lineas[0];
    };
    expect(referenciaCatalogo(linea(0.8, 2.1))).toBe('Referencia HUIL-M-3-B · 0,80–0,85 m × 2,10 m');
    expect(referenciaCatalogo(linea(0.835, 2.36))).toBe(
      'Referencia HUIL-M-3-E · 0,80–0,85 m × 2,40 m · siguiente medida del catálogo en alto',
    );
    expect(referenciaCatalogo(linea(0.87, 2.36))).toBe(
      'Referencia HUIL-M-4-E · 0,90–0,95 m × 2,40 m · siguiente medida del catálogo en ancho y alto',
    );
  });
});

describe('aviso de medida especial en la cotización', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      cerrarAlmacen(join(dir, 'cotizador.sqlite'));
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('informa la referencia usada al resolver con la siguiente medida, sin repetirlo en ediciones ajenas', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'neltume-escalones-'));
    dirs.push(dir);
    const items: SolicitudItem[] = [
      { modelo: 'Huilo Huilo', madera: 'Mara', ancho: 83.5, alto: 236, medida: null, cantidad: 3, tipoMedida: 'vano' },
      { modelo: 'Huilo Huilo', madera: 'Mara', ancho: 0.8, alto: 2.1, medida: null, cantidad: 1 },
    ];
    const cliente = { nombre: null, rut: null, giro: null, telefono: null, direccion: null, comuna: null, proyecto: null };
    const llm = { interpretar: vi.fn().mockResolvedValue({ name: 'actualizar_cotizacion', input: { items, cliente } }) };
    const servicio = new Servicio(catalogo, llm, new Almacen(dir));
    const aviso =
      'Medida especial 0,835 × 2,36 m: se cotiza con la referencia HUIL-M-3-E (0,80–0,85 × 2,40 m), la siguiente medida del catálogo.';

    const chat = await servicio.ejecutar({ tipo: 'chat', mensaje: 'Cotiza 3 puertas Huilo Huilo en Mara de 83,5 x 236 medida vano y una de 80 x 210' });
    let q = chat.cotizacion;
    expect(chat.avisos).toEqual([aviso]);
    expect(q.historial.at(-1)?.texto).toContain(aviso);
    expect(q.montos.lineas.map((l) => l.producto.codigo)).toEqual(['HUIL-M-3-E', 'HUIL-M-3-B']);

    const otra = await servicio.ejecutar({ tipo: 'editar', id: q.id, actualizada: q.actualizada, cantidades: [{ indice: 0, cantidad: 4 }] });
    expect(otra.avisos).toBeUndefined();
    q = otra.cotizacion;

    const medida = await servicio.ejecutar({ tipo: 'editar', id: q.id, actualizada: q.actualizada, items: [{ indice: 1, cambios: { ancho: 0.87 } }] });
    expect(medida.avisos).toEqual([
      'Medida especial 0,87 × 2,10 m: se cotiza con la referencia HUIL-M-4-B (0,90–0,95 × 2,10 m), la siguiente medida del catálogo.',
    ]);
  });
});
