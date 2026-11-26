import { porcentajeIva } from '../negocio/precios';

/*
 * Fragmentos de la cotización al cliente (docs/estilo-documentos-v1.md, §5): la primera columna no lleva número, los
 * importes son netos y cada valor lleva «+ IVA» debajo. La nota de pedido y la orden de trabajo no pasan por aquí: la
 * fábrica las lee (§8), así que su tabla y sus totales siguen en `pdf.ts`. Son funciones puras: reciben el HTML ya
 * armado de cada celda y devuelven HTML o CSS.
 */

/** Una fila de producto ya impresa: el HTML de la celda de producto y los importes con su formato. */
export interface FilaCotizacion {
  producto: string;
  cantidad: number;
  /** Precio unitario; con descuento especial, el original tachado encima del rebajado. */
  unitario: string;
  /** Total de la línea, con el mismo formato que el unitario. */
  total: string;
}

/** Línea «+ IVA» bajo cada valor de la cotización: va con el estilo `.iva` de `ESTILOS_COTIZACION`. */
const MAS_IVA = '<span class="iva">+ IVA</span>';

/** Fila de la cotización: sin número (un guion) y con «+ IVA» bajo el unitario y bajo el total. */
const fila = (f: FilaCotizacion) =>
  `<tr><td class="n">-</td><td class="prod">${f.producto}</td><td class="r cant">${f.cantidad}</td><td class="r unit">${f.unitario}${MAS_IVA}</td><td class="r tot">${f.total}${MAS_IVA}</td></tr>`;

/**
 * Tabla de la cotización. `flete`, si lo hay, va como última fila: es una línea más del detalle. Las filas de la
 * cotización siempre tienen precio (los «Por definir» son solo de la nota), así que cada importe lleva su «+ IVA».
 */
export function tablaCotizacion(filas: FilaCotizacion[], flete: FilaCotizacion | null) {
  const cuerpo = [...filas, ...(flete ? [flete] : [])].map(fila).join('');
  return `<table><thead><tr><th class="n"></th><th class="prod">Producto</th><th class="r cant">Cant.</th><th class="r unit">Precio unit. neto</th><th class="r tot">Total neto</th></tr></thead><tbody>${cuerpo}</tbody></table>`;
}

/** Nota bajo la tabla: todos los valores son netos. La tasa es la de Ajustes, la misma que usa el desglose. */
export const notaTabla = (iva: number) =>
  `<p class="nota-tabla">Todos los valores indicados son netos y no incluyen IVA (${porcentajeIva(iva)}).</p>`;

/** Lo que va bajo la tabla de la cotización: la nota de netos y el desglose, juntos para que la nota no quede sola al inicio de una página. */
export const trasTabla = (iva: number, desglose: string) => `<div class="tras-tabla">${notaTabla(iva)}${desglose}</div>`;

/** Fila «Valores» del bloque de obra: qué significan las cifras de la cotización y con qué tasa de IVA. */
export const valoresNetos = (iva: number) => `Netos, + IVA ${porcentajeIva(iva)}`;

/**
 * Subtotal del desglose de la cotización. Sin descuentos es el neto, así que se llama «Neto»; con un descuento
 * especial o general, el monto de antes del descuento se llama «Subtotal» para que no haya dos «Neto».
 */
export const etiquetaSubtotal = (conDescuentos: boolean) => (conDescuentos ? 'Subtotal' : 'Neto');

/** IVA del desglose de la cotización, con su tasa: «IVA (19 %)». La nota de pedido conserva «IVA 19 %» (§8.3). */
export const etiquetaIva = (iva: number) => `IVA (${porcentajeIva(iva)})`;

/**
 * Estilos de la cotización: se agregan a los comunes solo en la cotización. Cada fila se alinea arriba: el valor y la
 * cantidad van en la línea del nombre, y el «+ IVA» bajo el valor cae en la línea del código, sin agregar altura.
 */
export const ESTILOS_COTIZACION = `
.cotizacion td{vertical-align:top}
.cotizacion .iva{display:block;margin-top:.6mm;font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;font-size:6.8pt;font-weight:400;line-height:1.35;color:var(--muted)}
.cotizacion .nota-tabla{margin-top:1.8mm;font-size:8.2pt;color:var(--muted)}
.tras-tabla{break-inside:avoid}
`;
