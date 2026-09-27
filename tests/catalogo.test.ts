import { describe, it, expect } from 'vitest';
import { access } from 'node:fs/promises';
import { importar } from '../src/catalogo/importar';
import { resolverItem } from '../src/catalogo/resolver';
import { cotizar } from '../src/negocio/precios';
import type { SolicitudItem, Producto } from '../src/catalogo/tipos';
export const solicitud = (s: Partial<SolicitudItem>): SolicitudItem => ({
  modelo: null,
  madera: null,
  ancho: null,
  alto: null,
  medida: null,
  cantidad: null,
  ...s,
});
const referencias: [SolicitudItem, string, number, number, number][] = [
  [
    solicitud({ modelo: 'Molco', madera: 'raulí', ancho: 80, alto: 2, cantidad: 3 }),
    'MOL-R-3-A',
    419400.2595,
    524250,
    1572750,
  ],
  [
    solicitud({ modelo: 'Marco', madera: 'raulí', medida: '4', alto: 2.1, cantidad: 3 }),
    'MAR-R-2X4-B',
    108619.5189,
    135774,
    407322,
  ],
  [
    solicitud({ modelo: 'Endolado', madera: 'oregón', medida: '12x2', alto: 300, cantidad: 6 }),
    'ENDO-O-12X2-M',
    16259.3777,
    20324,
    121944,
  ],
  [
    solicitud({ modelo: 'Molco', madera: 'pino oregón', ancho: 0.85, alto: 2, cantidad: 1 }),
    'MOL-O-3-A',
    114099.7899,
    142625,
    142625,
  ],
  [
    solicitud({ modelo: 'Los Lagos', madera: 'pino', ancho: 0.7, alto: 2.2, cantidad: 2 }),
    'LLAG-O-2-C',
    148425.2247,
    185532,
    371064,
  ],
  [
    solicitud({ modelo: 'Yelcho', madera: 'raulí', ancho: 1.45, alto: 2.6, cantidad: 1 }),
    'YEL-R-9-G',
    712481.7106,
    890602,
    890602,
  ],
  [
    solicitud({ modelo: 'Guardapolvo', madera: 'mara', medida: '6 x 4.5', alto: 3, cantidad: 10 }),
    'GUARD-M-6X4,5-P',
    49245.5664,
    61557,
    615570,
  ],
  [
    solicitud({ modelo: 'Piezas T', madera: 'lenga', medida: '2x6', alto: 2.6, cantidad: 4 }),
    'PT-L-2X6-G',
    80278.1772,
    100348,
    401392,
  ],
];
describe('Flujo secuencial sobre la planilla real', () => {
  it('importa → corrige → resuelve → cotiza todos los valores de referencia y rechazos', async () => {
    const ruta = process.env.NELTUME_PLANILLA ?? 'datos-privados/COTIZADOR_2026.xlsx';
    try {
      await access(ruta);
    } catch {
      throw new Error(
        `Falta la planilla real: ${ruta}. Ubícala en datos-privados/ o configura NELTUME_PLANILLA. Esta prueba no usa un catálogo ficticio.`,
      );
    }
    const r = await importar(ruta);
    expect(r.catalogo.productos).toHaveLength(8772);
    expect(r.conteos).toEqual({ PUERTA: 8316, MARCO: 128, PIEZAS_T: 112, MOLDURA: 216 });
    expect(r.incidencias.filter((i) => i.accion === 'correccion')).toHaveLength(29);
    expect(r.incidencias.filter((i) => i.accion === 'exclusion')).toHaveLength(0);
    expect(r.incidencias.map((i) => i.fila)).toEqual([
      1193,
      ...Array.from({ length: 28 }, (_, i) => 7883 + i),
    ]);
    expect(r.erroresPlantilla).toHaveLength(3);
    expect(r.erroresPlantilla.join(' ')).toMatch(/P25.*C8:C32.*Q8/);
    expect(Object.keys(r.catalogo).sort()).toEqual(['fecha', 'fuente', 'productos', 'sha256']);
    const permitidos = [
      'codigo',
      'modelo',
      'familia',
      'tipo',
      'madera',
      'medida',
      'anchoMin',
      'anchoMax',
      'largo',
      'precioNeto',
      'descripcion',
      'filaOrigen',
    ].sort();
    for (const p of r.catalogo.productos) expect(Object.keys(p).sort()).toEqual(permitidos);
    expect(new Set(r.catalogo.productos.map((p) => p.codigo)).size).toBe(8772);
    expect(
      new Set(r.catalogo.productos.map((p) => `${p.modelo}|${p.madera}|${p.medida}|${p.largo}`)).size,
    ).toBe(8772);
    expect(r.logo?.length).toBeGreaterThan(100);
    const items: { producto: Producto; cantidad: number }[] = [];
    for (const [s, codigo, neto, unitario, total] of referencias) {
      const res = resolverItem(r.catalogo, s);
      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error(JSON.stringify(res));
      expect(res.producto.codigo).toBe(codigo);
      expect(res.producto.precioNeto).toBe(neto);
      const linea = cotizar([res]).lineas[0];
      expect(linea.precioUnitario).toBe(unitario);
      expect(linea.total).toBe(total);
      items.push(res);
    }
    const total = cotizar(items);
    expect([total.neto, total.iva, total.total]).toEqual([4523269, 859421, 5382690]);
    const base = solicitud({ modelo: 'Molco', madera: 'oregón', ancho: 0.8, alto: 2, cantidad: 1 });
    const casos: [Partial<SolicitudItem>, string][] = [
      [{ modelo: 'Neltume', madera: null, ancho: null, alto: null }, 'faltan_datos'],
      [{ modelo: 'los ríos' }, 'modelo_desconocido'],
      [{ madera: 'roble' }, 'madera_desconocida'],
      [{ ancho: 0.67 }, 'medida_no_disponible'],
      [{ ancho: 1.6 }, 'medida_no_disponible'],
      [{ alto: 2.05 }, 'medida_no_disponible'],
      [{ modelo: 'Piezas T', medida: '2x4', alto: 3 }, 'medida_no_disponible'],
      [{ cantidad: 0 }, 'cantidad_invalida'],
      [{ cantidad: 1.5 }, 'cantidad_invalida'],
    ];
    for (const [patch, tipo] of casos) {
      const res = resolverItem(r.catalogo, { ...base, ...patch });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.rechazo.tipo).toBe(tipo);
        expect(res.rechazo.disponibles).toBeDefined();
      }
    }
    const faltan = resolverItem(r.catalogo, {
      ...base,
      modelo: 'Neltume',
      madera: null,
      ancho: null,
      alto: null,
    });
    if (!faltan.ok && faltan.rechazo.tipo === 'faltan_datos')
      expect(faltan.rechazo.campos).toEqual(['madera', 'ancho', 'alto']);
    expect(resolverItem(r.catalogo, { ...base, alto: 2.005 }).ok).toBe(true);
    expect(resolverItem(r.catalogo, { ...base, alto: 2.0051 }).ok).toBe(false);
    expect(resolverItem(r.catalogo, { ...base, modelo: 'Puñir' }).ok).toBe(true);
    expect(resolverItem(r.catalogo, { ...base, ancho: 0.850001 }).ok).toBe(false);
  });
});
