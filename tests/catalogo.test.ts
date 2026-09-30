import { describe, it, expect } from 'vitest';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { ErrorImportacion, importar } from '../src/catalogo/importar';
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
      [{ ancho: 0.55 }, 'medida_no_disponible'],
      [{ ancho: 1.6 }, 'medida_no_disponible'],
      [{ alto: 2.7 }, 'medida_no_disponible'],
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
    // Entre dos escalones del catálogo se cotiza el siguiente hacia arriba.
    const especiales: [Partial<SolicitudItem>, string][] = [
      [{ ancho: 0.67 }, 'MOL-O-2-A'],
      [{ alto: 2.05 }, 'MOL-O-3-B'],
      [{ modelo: 'Huilo Huilo', madera: 'Mara', ancho: 83.5, alto: 236, cantidad: 3 }, 'HUIL-M-3-E'],
    ];
    for (const [patch, codigo] of especiales) {
      const res = resolverItem(r.catalogo, { ...base, ...patch });
      expect(res.ok && res.producto.codigo).toBe(codigo);
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
    // ±0,005 m es la misma medida exacta; pasado ese margen ya es la siguiente del catálogo.
    const ajuste = (patch: Partial<SolicitudItem>) => {
      const res = resolverItem(r.catalogo, { ...base, ...patch });
      return res.ok && [res.producto.codigo, res.ajusteAncho, res.ajusteAlto];
    };
    expect(ajuste({ alto: 2.005 })).toEqual(['MOL-O-3-A', 'rango', 'exacto']);
    expect(ajuste({ alto: 2.0051 })).toEqual(['MOL-O-3-B', 'rango', 'siguiente']);
    expect(resolverItem(r.catalogo, { ...base, modelo: 'Puñir' }).ok).toBe(true);
    expect(ajuste({ ancho: 0.850001 })).toEqual(['MOL-O-4-A', 'siguiente', 'exacto']);
  });
});

/** Copia de la planilla real con la hoja Precio modificada, en un directorio temporal. */
async function planillaModificada(ruta: string, cambiar: (hoja: string) => string) {
  const zip = unzipSync(await readFile(ruta));
  const libro = strFromU8(zip['xl/workbook.xml']);
  const relaciones = strFromU8(zip['xl/_rels/workbook.xml.rels']);
  const id = libro.match(/<sheet[^>]*name="Precio"[^>]*r:id="([^"]+)"/)![1];
  const destino = relaciones
    .match(new RegExp(`<Relationship[^>]*Id="${id}"[^>]*>`))![0]
    .match(/Target="([^"]+)"/)![1];
  const hoja = `xl/${destino.replace(/^\/?xl\//, '')}`;
  zip[hoja] = strToU8(cambiar(strFromU8(zip[hoja])));
  const dir = await mkdtemp(join(tmpdir(), 'neltume-planilla-'));
  const salida = join(dir, 'planilla.xlsx');
  await writeFile(salida, zipSync(zip));
  return { salida, limpiar: () => rm(dir, { recursive: true, force: true }) };
}

/** Copia la fila 500 de Precio como fila 9000, opcionalmente con otro precio neto (O) y bruto (P). */
const duplicarFila = (precio?: number) => (hoja: string) => {
  let fila = hoja.match(/<row r="500"[^>]*>.*?<\/row>/)![0].replace(/([" ][A-Z]*)500"/g, '$19000"');
  if (precio !== undefined)
    fila = fila
      .replace(/(<c r="O9000"[^>]*>)<v>[^<]*<\/v>/, `$1<v>${precio}</v>`)
      .replace(/(<c r="P9000"[^>]*>)(?:<f>[^<]*<\/f>)?<v>[^<]*<\/v>/, `$1<v>${precio * 1.19}</v>`);
  return hoja.replace('</sheetData>', `${fila}</sheetData>`);
};

describe('Importación de planillas inválidas', () => {
  const ruta = process.env.NELTUME_PLANILLA ?? 'datos-privados/COTIZADOR_2026.xlsx';

  it('rechaza una planilla con la mayoría de los precios vacíos', async () => {
    const { salida, limpiar } = await planillaModificada(ruta, (hoja) =>
      hoja.replace(/<c r="O(\d+)"([^>]*)>(.*?)<\/c>/g, (c, fila: string, atributos: string) =>
        Number(fila) >= 200 ? `<c r="O${fila}"${atributos.replace(/ t="[^"]*"/, '')}/>` : c,
      ),
    );
    try {
      await expect(importar(salida)).rejects.toThrow(ErrorImportacion);
      await expect(importar(salida)).rejects.toThrow(/filas de Precio tienen datos incompletos/);
    } finally {
      await limpiar();
    }
  });

  it('rechaza un producto repetido con otro precio y acepta uno repetido idéntico', async () => {
    const conflicto = await planillaModificada(ruta, duplicarFila(200000));
    const identico = await planillaModificada(ruta, duplicarFila());
    try {
      await expect(importar(conflicto.salida)).rejects.toThrow(/precios distintos.*filas 500 y 9000/);
      const r = await importar(identico.salida);
      expect(r.catalogo.productos).toHaveLength(8772);
      expect(r.incidencias.filter((i) => i.accion === 'exclusion').map((i) => i.fila)).toEqual([9000]);
    } finally {
      await conflicto.limpiar();
      await identico.limpiar();
    }
  });
});
