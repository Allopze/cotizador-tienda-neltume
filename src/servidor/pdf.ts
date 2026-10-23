import { chromium, type Browser, type Page } from 'playwright';
import { constants, readFileSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { copyFile, chmod, link, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { etiquetaDescuento } from '../negocio/descuento-cantidad';
import type { Cotizacion, Despacho, Fabrica } from '../negocio/estado';
import { CODIGO_FLETE, cantidadFlete, descripcionFlete, nombreFabrica, sinTransportista, unitarioFlete } from '../negocio/estado';
import type { Linea, Montos } from '../negocio/precios';
import {
  ahorroLinea,
  conDescuentoItem,
  descripcionLinea,
  pesos,
  porcentaje,
  porcentajeIva,
  precioConDescuento,
  REGLAS,
  resumenDescuentosItems,
  textoDescuentoItem,
  type ReglasComerciales,
} from '../negocio/precios';
import { fechaChilena } from '../negocio/vigencia';
import { dimensionesEnMilimetros, sufijoTipoMedida } from '../negocio/medidas';
import { medidaReferencia, metrosTexto } from '../catalogo/escalones';
import { metros } from '../catalogo/resolver';
import { CODIGO_PERSONALIZADO } from '../negocio/personalizados';
import { chromiumPath } from './chromium';
import { datosEmpresa } from './empresa';
import { abrirBaseDatos } from './base-datos';
import { ErrorPdf } from './errores';

/** Plazo total para lanzar Chromium, cargar la plantilla e imprimir. */
const PLAZO_PDF_MS = 30_000;

const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const UNIDAD_ESCUADRIA: Partial<Record<Linea['producto']['familia'], string>> = {
  MARCO: 'pulg.',
  PIEZAS_T: 'pulg.',
  MOLDURA: 'cm',
};

/** Escuadría legible: «2X4» → «2x4 pulg.» según la familia. */
function escuadria(medida: string, familia: Linea['producto']['familia']) {
  if (!/^\d+(,\d+)?X\d+(,\d+)?$/i.test(medida)) return medida;
  const unidad = UNIDAD_ESCUADRIA[familia];
  return `${medida.toLowerCase()}${unidad ? ` ${unidad}` : ''}`;
}

/** Medida exacta pedida, que la fábrica necesita aunque el producto cubra un rango. */
export function medidaPedida(l: Linea): string | null {
  if (l.producto.familia === 'PUERTA') {
    return dimensionesEnMilimetros(l.anchoSolicitado, l.altoSolicitado, l.tipoMedida);
  }
  if (!l.medidaSolicitada && l.altoSolicitado === null) return null;
  const medida = escuadria(l.medidaSolicitada ?? l.producto.medida, l.producto.familia);
  return `${medida} × ${l.altoSolicitado === null ? '—' : metrosTexto(l.altoSolicitado)} m${sufijoTipoMedida(l.tipoMedida)}`;
}

const MINUSCULAS = new Set(['a', 'de', 'del', 'y', 'kit']);
const UNIDADES: Record<string, string> = { mt: 'm', mts: 'm', cm: 'cm', pulg: 'pulg.' };

/**
 * Las descripciones de la planilla vienen en mayúsculas; en el documento se leen mejor con mayúscula
 * inicial y unidades normalizadas. Las escritas a mano (con minúsculas) se respetan tal cual.
 */
export function descripcionLegible(texto: string) {
  if (/\p{Ll}/u.test(texto)) return texto;
  return texto
    .toLowerCase()
    .split(/\s+/)
    .map((p, i) => {
      if (p === 'x') return '×';
      if (UNIDADES[p]) return UNIDADES[p];
      if (/^\d/.test(p) || (i > 0 && MINUSCULAS.has(p))) return p;
      return p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join(' ');
}

export interface DocumentoPdf {
  tipo: 'cotizacion' | 'nota';
  numero: number;
  /** Solo nota: fábrica de destino; falta en las generadas antes de separar las fábricas. */
  fabrica?: Fabrica;
  montos: Montos;
  fecha: string;
  /** Solo cotización: último día de validez YYYY-MM-DD. */
  vence?: string | null;
  /** Cotización: quien emite. Nota: quien aprueba. */
  autor?: string | null;
  despacho?: Despacho | null;
  reglas?: ReglasComerciales;
  observaciones?: string | null;
  /** Solo nota: las otras notas de la misma cotización (una por fábrica), para que cada fábrica sepa de la otra. */
  otrasNotas?: { fabrica?: Fabrica; numero: number; items: number }[];
  /** Documento anulado: se imprime con una marca visible y la fecha y el motivo de la anulación. */
  anulada?: { fecha: string | null; motivo: string | null; por: string | null } | null;
}

const fechaDocumento = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });
/** «23 de octubre de 2026»: fecha del encabezado. Una fecha sin hora (YYYY-MM-DD) se toma tal cual. */
const fechaLarga = (fecha: string) =>
  new Date(/^\d{4}-\d{2}-\d{2}$/.test(fecha) ? `${fecha}T12:00:00.000Z` : fecha).toLocaleDateString('es-CL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Santiago',
  });

/** Recursos de los PDF: fuentes y dibujos de los modelos (ver scripts/dibujos/generar.sh). */
const RECURSOS = join(/* turbopackIgnore: true */ process.cwd(), 'src/servidor/pdf-recursos');
interface Dibujo {
  archivo: string;
  /** Tamaño del PNG en píxeles. */
  px: [number, number];
  /** Dónde está la hoja dentro del dibujo, como fracción del ancho y del alto: sus cotas van en la nota. */
  hoja: { izq: number; der: number; arriba: number; abajo: number } | null;
}
let dibujos: Map<string, Dibujo> | null = null;
/** Dibujos por modelo del catálogo (normalizado). Sin el manifiesto, ninguno: las puertas usan el esquema genérico. */
function dibujosModelos() {
  if (!dibujos) {
    dibujos = new Map();
    try {
      const manifiesto = JSON.parse(readFileSync(join(RECURSOS, 'dibujos', 'dibujos.json'), 'utf8')) as Record<string, Dibujo>;
      for (const [modelo, d] of Object.entries(manifiesto)) dibujos.set(normalizarModelo(modelo), d);
    } catch {
      // Sin dibujos el documento se imprime igual, con el esquema genérico de puerta.
    }
  }
  return dibujos;
}
const normalizarModelo = (m: string) =>
  m
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
/** Hoja del esquema genérico de puerta (en el mismo lienzo de 455 × 900 que los dibujos del catálogo). */
const GENERICO: Dibujo = { archivo: '', px: [455, 900], hoja: { izq: 0.14, der: 0.86, arriba: 0.07, abajo: 0.985 } };
/** Esquema genérico para una puerta sin modelo 3D: marco, hoja y manilla, con el mismo trazo que los dibujos. */
const trazoGenerico = () =>
  `<g class="generico"><path d="M14 890V14H441V890"/><rect x="${0.14 * 455}" y="${0.07 * 900}" width="${0.72 * 455}" height="${0.915 * 900}"/><path d="M${0.86 * 455 - 40} 470v70"/></g>`;

/**
 * Dibujo de la línea: el del modelo si hay uno (una puerta del catálogo o el marco), el esquema genérico para otra
 * puerta (también un pedido especial de puerta) y ninguno para molduras, piezas T y accesorios especiales.
 */
function dibujoDe(l: Linea): Dibujo | null {
  const familia = l.producto.familia;
  if (familia !== 'PUERTA' && familia !== 'MARCO') return null;
  const propio = l.producto.codigo === CODIGO_PERSONALIZADO ? null : dibujosModelos().get(normalizarModelo(familia === 'MARCO' ? 'MARCO' : l.producto.modelo));
  return propio ?? (familia === 'PUERTA' ? GENERICO : null);
}
/** Imagen del dibujo: la referencia `neltume-dibujo:` se reemplaza por el PNG al imprimir (ver `inyectarRecursos`). */
const imagenDibujo = (d: Dibujo) =>
  d.archivo
    ? `<image href="neltume-dibujo:${d.archivo}" x="0" y="0" width="${d.px[0]}" height="${d.px[1]}"/>`
    : trazoGenerico();
/** Dibujo de la línea en la cotización, sin cotas. */
const dibujoCotizacion = (d: Dibujo | null) =>
  d ? `<svg class="dibujo" viewBox="0 0 ${d.px[0]} ${d.px[1]}" aria-hidden="true">${imagenDibujo(d)}</svg>` : '';
/**
 * Plano de la línea en la nota: el dibujo con las cotas de la medida pedida (en mm), cuando es una puerta con ancho y
 * alto. Las cotas van sobre la hoja del dibujo.
 */
function planoNota(d: Dibujo | null, l: Linea) {
  if (!d) return '';
  const [w, h] = d.px;
  const ancho = l.producto.familia === 'PUERTA' ? l.anchoSolicitado : null;
  const alto = l.producto.familia === 'PUERTA' ? l.altoSolicitado : null;
  if (!d.hoja || ancho === null || alto === null)
    return `<svg class="plano" viewBox="0 0 ${w} ${h}" aria-hidden="true">${imagenDibujo(d)}</svg>`;
  const mm = (m: number) => Math.round((metros(m, 'PUERTA') ?? m) * 1000);
  const x0 = d.hoja.izq * w, x1 = d.hoja.der * w, y0 = d.hoja.arriba * h, y1 = d.hoja.abajo * h;
  const xv = w + 40, yh = h + 40, t = 16;
  return `<svg class="plano" viewBox="0 0 ${w + 205} ${h + 190}" aria-hidden="true">${imagenDibujo(d)}<path class="cota" d="M${x0} ${yh}H${x1}M${x0} ${yh - t}V${yh + t}M${x1} ${yh - t}V${yh + t}M${xv} ${y0}V${y1}M${xv - t} ${y0}H${xv + t}M${xv - t} ${y1}H${xv + t}"/><text x="${(x0 + x1) / 2}" y="${yh + 145}" text-anchor="middle">${mm(ancho)}</text><text x="${xv + 125}" y="${(y0 + y1) / 2}" text-anchor="middle" transform="rotate(-90 ${xv + 125} ${(y0 + y1) / 2})">${mm(alto)}</text></svg>`;
}

export async function plantilla(q: Cotizacion, doc: DocumentoPdf, db: Database.Database = abrirBaseDatos()) {
  const nota = doc.tipo === 'nota';
  const { numero, montos, fecha } = doc;
  const reglas = doc.reglas ?? q.reglas ?? REGLAS;
  const tipo = nota ? 'Nota de pedido' : 'Cotización';
  const c = q.cliente;
  const empresa = datosEmpresa(db);
  // El logo va como referencia: el HTML que se guarda como snapshot de cada documento no repite el SVG en base64.
  const logo = registrarLogo(await logoVigente(db));
  const observaciones = doc.observaciones ?? q.observaciones;
  type Campo = [string, string | null | undefined];
  const datos = (campos: Campo[]) => {
    const conValor = campos.filter(([, v]) => v);
    return conValor.length
      ? `<dl class="datos">${conValor.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`
      : '';
  };
  const parte = (etiqueta: string, titulo: string, campos: Campo[]) =>
    `<div class="parte"><p class="k">${etiqueta}</p><h2>${esc(titulo)}</h2>${datos(campos)}</div>`;
  const meta = (campos: Campo[]) =>
    `<dl class="meta">${campos
      .filter(([, v]) => v)
      .map(([k, v]) => `<div><dt class="k">${k}</dt><dd>${esc(v)}</dd></div>`)
      .join('')}</dl>`;
  const transporte = sinTransportista(doc.despacho?.transporte) ? null : doc.despacho!.transporte!.trim();

  // Encabezado: el número es lo que se busca; los datos de Neltume van al pie de cada página.
  const fabrica = nota && doc.fabrica ? `<p class="fabrica"><b>Fábrica ${nombreFabrica[doc.fabrica]}</b></p>` : '';
  const cabecera = `<header class="cab"><img alt="Neltume" src="${logo}"><div><p class="tipo">${tipo}</p><h1>N° ${numero}</h1>${fabrica}${meta(
    nota
      ? [
          ['Fecha', fechaLarga(fecha)],
          ['Cotización', q.numero !== null ? `N° ${q.numero}` : null],
          ['Aprobada por', doc.autor],
          ['Emitida por', q.emitidaPor],
        ]
      : [
          ['Fecha', fechaLarga(fecha)],
          ['Válida hasta', doc.vence ? fechaLarga(doc.vence) : null],
          ['Revisión de', q.origen ? `N° ${q.origen}` : null],
          ['Emitida por', doc.autor],
        ],
  )}</div></header>`;
  // Cada fábrica sabe que la cotización tiene otra nota, y cuál.
  const otras = (doc.otrasNotas ?? []).map(
    (o) => `${o.fabrica ? nombreFabrica[o.fabrica] : 'otra fábrica'}, <b>N° ${o.numero}</b>, con ${o.items} ítem${o.items === 1 ? '' : 's'}`,
  );
  const avisoOtras = nota && otras.length
    ? `<p class="otras">La cotización N° ${q.numero} tiene ${otras.length + 1} notas de pedido. ${otras.length > 1 ? 'Las otras van' : 'La otra va'} a ${otras.join(' y ')}.</p>`
    : '';
  const partes = nota
    ? `<section class="partes">${parte('Cliente', c.nombre || 'Sin nombre', [
        ['RUT', c.rut],
        ['Giro', c.giro],
        ['Dirección', [c.direccion, c.comuna].filter(Boolean).join(', ')],
        ['Teléfono', c.telefono],
      ])}${parte('Despacho', c.proyecto || doc.despacho?.destino || 'Despacho', [
        ['Dirección de despacho', doc.despacho?.direccion],
        ['Transporte', transporte ?? 'Por confirmar'],
        ['Destino', c.proyecto ? doc.despacho?.destino : null],
        ['Entrega', doc.despacho?.entregaComprometida || 'Por comprometer'],
      ])}</section>`
    : `<section class="partes">${parte('Cliente', c.nombre || 'Sin nombre', [
        ['RUT', c.rut],
        ['Giro', c.giro],
        ['Teléfono', c.telefono],
      ])}${parte('Obra', c.proyecto || c.comuna || 'Sin indicar', [
        ['Dirección', c.direccion],
        ['Comuna', c.proyecto ? c.comuna : null],
        ['Despacho', montos.flete ? 'Incluido en esta cotización' : 'Se cotiza aparte'],
      ])}</section>`;

  // El cliente no ve datos internos; la nota agrega la referencia de catálogo para que fábrica sepa el producto base.
  // Un producto fuera de catálogo no tiene referencia de catálogo: fábrica ve las referencias que entregó el cliente.
  const referenciaFabrica = (l: Linea) => {
    if (l.producto.codigo !== CODIGO_PERSONALIZADO)
      return `Referencia de catálogo: ${l.producto.codigo} · ${medidaReferencia(l.producto)}`;
    const referencias = l.indice === null ? [] : (q.solicitudes[l.indice]?.referencias ?? []);
    return `Producto personalizado, fuera de catálogo${referencias.length ? ` · Referencias del cliente: ${referencias.map((r) => r.nombre).join(', ')}` : ''}`;
  };
  const producto = (l: Linea) => {
    // Hoja o vano es un dato para fábrica: la cotización no lo nombra (el vano, el hueco del muro, confundía al
    // cliente) y solo la nota de pedido lo dice. En el panel se sigue viendo mientras se edita.
    const tipoMedida = nota ? l.tipoMedida : null;
    // El nombre ya lleva la medida pedida; solo una descripción escrita a mano necesita repetirla aparte.
    const tipoMedidaExplicita = tipoMedida === 'hoja' || tipoMedida === 'vano';
    const pedida = l.descripcionDocumento || tipoMedidaExplicita ? medidaPedida({ ...l, tipoMedida }) : null;
    const tipoTexto = tipoMedidaExplicita ? `medida de ${tipoMedida}` : null;
    const detalles = [
      pedida ? `Medida solicitada: ${pedida}` : tipoTexto && `${tipoTexto[0].toUpperCase()}${tipoTexto.slice(1)}`,
      l.observaciones && `Observación: ${l.observaciones}`,
    ];
    return `<b>${esc(descripcionLegible(descripcionLinea(l)))}</b>${detalles.map((d) => (d ? `<span${d.startsWith('Medida') ? ' class="medida"' : ''}>${esc(d)}</span>` : '')).join('')}${
      conDescuentoItem(l) && l.descuentoItem
        ? `<span class="descuento-item">Descuento especial ${esc(textoDescuentoItem(l.descuentoItem))}: −${pesos(l.descuentoUnitario!)} c/u · Ahorro ${pesos(ahorroLinea(l))}</span>`
        : ''
    }<span class="cod">${esc(nota ? referenciaFabrica(l) : l.producto.codigo)}</span>`;
  };
  // Con descuento especial, el precio original queda tachado sobre el rebajado (unitario y total de la línea).
  const conOriginal = (l: Linea, original: number, final: number) =>
    conDescuentoItem(l) ? `<s class="original">${pesos(original)}</s> <span>${pesos(final)}</span>` : pesos(final);
  // En la nota, un pedido especial sin costo de fábrica va «Por definir», en su lugar del pedido, y no suma. Solo los
  // de su fábrica: los de la otra van en su propia nota (uno sin fábrica es de una nota anterior a separarlas).
  const porDefinir = nota
    ? q.montos.lineas.filter(
        (l) =>
          l.indice != null &&
          !!q.solicitudes[l.indice]?.personalizado &&
          (!doc.fabrica || (q.solicitudes[l.indice].fabrica ?? doc.fabrica) === doc.fabrica) &&
          !montos.lineas.some((m) => m.indice === l.indice),
      )
    : [];
  const filas = [
    ...montos.lineas.map((l) => ({ l, definida: true })),
    ...porDefinir.map((l) => ({ l, definida: false })),
  ].sort((a, b) => (a.l.indice ?? 0) - (b.l.indice ?? 0));
  const filaProducto = ({ l, definida }: (typeof filas)[number], i: number) => {
    const dibujo = dibujoDe(l);
    const precios = definida
      ? `<td class="r unit">${conOriginal(l, l.precioUnitario, precioConDescuento(l))}</td><td class="r tot">${conOriginal(l, l.cantidad * l.precioUnitario, l.total)}</td>`
      : '<td class="r unit">Por definir</td><td class="r tot">Por definir</td>';
    return nota
      ? `<tr><td class="n">${i + 1}</td><td class="plano-c">${planoNota(dibujo, l)}</td><td class="prod">${producto(l)}</td><td class="r cant">${l.cantidad}</td>${precios}<td class="listo"><i></i></td></tr>`
      : `<tr><td class="n">${i + 1}</td><td><div class="prod${dibujo ? '' : ' sin-dibujo'}">${dibujoCotizacion(dibujo)}<div>${producto(l)}</div></div></td><td class="r cant">${l.cantidad}</td>${precios}</tr>`;
  };
  const filaFlete = montos.flete
    ? `<tr><td class="n">${filas.length + 1}</td><td><div class="prod sin-dibujo"><div><b>${esc(descripcionFlete(q))}</b><span class="cod">${CODIGO_FLETE}</span></div></div></td><td class="r cant">${cantidadFlete(q)}</td><td class="r unit">${pesos(unitarioFlete(q))}</td><td class="r tot">${pesos(montos.flete)}</td></tr>`
    : '';
  const tabla = nota
    ? `<table><thead><tr><th class="n">N°</th><th class="plano-c">Plano</th><th>Producto</th><th class="r cant">Cant.</th><th class="r unit">Precio fábrica</th><th class="r tot">Total</th><th class="listo">Listo</th></tr></thead><tbody>${filas.map(filaProducto).join('')}</tbody></table>`
    : `<table><thead><tr><th class="n">N°</th><th>Producto</th><th class="r cant">Cant.</th><th class="r unit">Precio unitario</th><th class="r tot">Total</th></tr></thead><tbody>${filas.map(filaProducto).join('')}${filaFlete}</tbody></table>`;

  // El flete va como línea del detalle, así que el subtotal lo incluye; el descuento sigue siendo solo de productos.
  // Con descuentos especiales por ítem, primero lo que habría costado sin ellos y cuánto se ahorra.
  const { ahorro, subtotalOriginal } = resumenDescuentosItems(montos);
  const fila = (etiqueta: string, valor: string, clase = '') =>
    `<div${clase ? ` class="${clase}"` : ''}><dt>${etiqueta}</dt><dd>${valor}</dd></div>`;
  const totales = [
    ...(ahorro
      ? [
          fila('Subtotal original', pesos(subtotalOriginal + montos.flete), 'original'),
          fila('Ahorro desc. especiales', `−${pesos(ahorro)}`, 'ahorro'),
        ]
      : []),
    fila(nota ? 'Neto' : 'Subtotal', pesos(montos.subtotal + montos.flete)),
    ...(montos.descuento
      ? [
          fila(
            `${etiquetaDescuento({ descuento: q.descuento, descuentoManual: q.descuentoManual, reglas }, { corta: true })} ${porcentaje(montos.descuentoPorcentaje)}${montos.flete ? ' sobre productos' : ''}`,
            `−${pesos(montos.descuento)}`,
          ),
          fila('Neto', pesos(montos.neto)),
        ]
      : []),
    fila(`IVA ${porcentajeIva(reglas.iva)}`, pesos(montos.iva)),
    fila('Total', pesos(montos.total), 'total'),
  ].join('');
  const valores = nota
    ? 'Valores a precio de fábrica, sin la ganancia de venta. Las cotas del plano son la medida pedida de cada puerta, en milímetros (de hoja o de vano, como indica la línea).'
    : 'Valores en pesos chilenos, puestos en fábrica.';
  const cierreTotales = `<section class="cierre"><p class="valores">${valores}${porDefinir.length ? '<br><br>Las líneas «Por definir» son pedidos especiales sin costo de fábrica: no están en el total.' : ''}</p><dl class="totales">${totales}</dl></section>`;

  const anulacion = doc.anulada
    ? `<div class="anulada-marca" aria-hidden="true">ANULADA</div><p class="anulada-aviso">${nota ? 'NOTA DE PEDIDO ANULADA' : 'COTIZACIÓN ANULADA'}${doc.anulada.fecha ? ` el ${fechaDocumento(doc.anulada.fecha)}` : ''}${doc.anulada.por ? ` por ${esc(doc.anulada.por)}` : ''}${doc.anulada.motivo ? `. Motivo: ${esc(doc.anulada.motivo)}` : ''}. No es válida${nota ? ' para fábrica' : ''}.</p>`
    : '';
  const firma = (rotulo: string) => `<div class="firma">${rotulo}</div>`;
  const validez = doc.vence
    ? `Cotización válida hasta el ${fechaChilena(doc.vence)} (${reglas.vigenciaDiasHabiles} días hábiles).`
    : `Cotización válida por ${reglas.vigenciaDiasHabiles} días hábiles.`;
  const condicion = (titulo: string, texto: string) => `<div><b>${titulo}</b><p>${texto}</p></div>`;
  const condiciones = [
    condicion('Validez', validez),
    condicion(
      'No incluye',
      'No se considera: Instalación, pintura, barniz, protecciones metálicas, vidrios ni estructura para correderas. No se consideran elementos no indicados en la cotización.',
    ),
    // Con el flete en el detalle, «consultar el despacho» contradiría el documento.
    ...(montos.flete ? [] : [condicion('Despacho', 'Consultar valor despacho.')]),
    ...(empresa.plazoEntrega ? [condicion('Plazo de entrega', esc(empresa.plazoEntrega))] : []),
    ...(empresa.condicionesPago ? [condicion('Pago', esc(empresa.condicionesPago))] : []),
    ...(empresa.datosBancarios ? [condicion('Datos para transferencia', esc(empresa.datosBancarios))] : []),
  ];
  // La cotización cierra con sus observaciones, cómo aceptarla y las condiciones; la nota, con lo que fábrica
  // completa a mano: entrega comprometida, observaciones y recepción.
  const cierre = nota
    ? `<section class="fab"><h2>Para fábrica</h2><div class="linea"><b>Entrega comprometida</b><span>${esc(doc.despacho?.entregaComprometida)}</span></div><div class="obs"><b>Observaciones</b><div>${observaciones ? esc(observaciones) : ''}</div></div>${doc.anulada ? '' : `<div class="firmas">${firma('Aprobado por Neltume')}${firma(`Recibido por fábrica${doc.fabrica ? ` ${nombreFabrica[doc.fabrica]}` : ''}`)}</div>`}</section>`
    : `${observaciones ? `<section class="observaciones"><h2>Observaciones</h2><p>${esc(observaciones)}</p></section>` : ''}<section class="condiciones"><h2>Condiciones</h2><div class="cond">${condiciones.join('')}</div></section>${
        doc.anulada
          ? ''
          : `<section class="aceptar"><h2>Para aceptar esta cotización</h2><p>Responde este correo${empresa.telefono ? ` o escríbenos al ${esc(empresa.telefono)}` : ''} indicando el N° ${numero}. Si prefieres, fírmala y envíanos una foto.</p><div class="firmas">${firma('Nombre y RUT')}${firma('Firma')}${firma('Fecha')}</div></section>`
      }`;
  // Datos de Neltume al pie de cada página, junto al número de página (ver `generarPdf`): también a quién preguntar.
  const pie = [empresa.nombre, empresa.rut && `RUT ${empresa.rut}`, empresa.direccion, empresa.telefono && `Tel. ${empresa.telefono}`, empresa.correo, empresa.web]
    .filter(Boolean)
    .join(' · ');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="neltume-pie" content="${esc(pie)}"><title>${tipo} N° ${numero}${nota && doc.fabrica ? ` · ${nombreFabrica[doc.fabrica]}` : ''} · Neltume</title><style>${ESTILOS}</style></head><body class="${nota ? 'nota' : 'cotizacion'}">${anulacion}${cabecera}${avisoOtras}${partes}${tabla}${cierreTotales}${cierre}</body></html>`;
}

/**
 * Estilos de los documentos, con el sistema de la aplicación: Newsreader en títulos y cifras grandes, Host Grotesk en
 * el texto. Las fuentes van como referencia `neltume-fuente:` y se incrustan al imprimir: el servidor imprime sin red.
 */
const ESTILOS = `
/* El guion de este Host Grotesk es más corto que el original, que se leía como raya en códigos y RUT (ver
   scripts/fuentes-pdf.py). */
@font-face{font-family:'Host Grotesk';src:url(neltume-fuente:host-grotesk.woff2) format('woff2');font-weight:300 800}
@font-face{font-family:'Newsreader';src:url(neltume-fuente:newsreader.woff2) format('woff2');font-weight:200 800}
@page{size:A4;margin:14mm 14mm 17mm}
:root{--ink:#1d2b24;--green:#2d4938;--muted:#58615a;--line:#dcddd3;--soft:#f2f3ec}
*{box-sizing:border-box}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font:400 9.2pt/1.45 'Host Grotesk',Helvetica,Arial,sans-serif;color:var(--ink);font-variant-numeric:tabular-nums;font-feature-settings:'calt' 0;background:#fff}
h1,h2,h3,p,dl,dd{margin:0}b{font-weight:500}
.k{font-size:7.3pt;color:var(--muted);letter-spacing:.01em}
.cab{display:grid;grid-template-columns:1fr auto;align-items:end;gap:10mm;padding-bottom:4.5mm;border-bottom:.7pt solid var(--green)}
.cab img{height:17mm;width:auto;display:block}
.cab .tipo{font:400 11pt 'Newsreader',Georgia,serif;color:var(--muted);text-align:right}
.cab h1{font:400 29pt/.92 'Newsreader',Georgia,serif;letter-spacing:-.022em;text-align:right;margin-top:1mm}
.fabrica{text-align:right;margin-top:2.5mm}.fabrica b{background:var(--green);color:#fff;font-size:10pt;padding:1.2mm 3mm;letter-spacing:.01em}
.meta{display:grid;grid-auto-flow:column;gap:0 8mm;margin-top:3.5mm;justify-content:end;text-align:right}.meta dd{font-weight:500;font-size:8.8pt}
.otras{margin-top:2.5mm;padding:2.4mm 3.5mm;background:var(--soft);font-size:8.2pt}
.partes{display:grid;grid-template-columns:1.15fr 1fr;gap:12mm;padding:4mm 0 3mm}
.parte h2{font:400 15pt/1.1 'Newsreader',Georgia,serif;letter-spacing:-.012em;margin-top:1mm}
.datos{display:grid;grid-template-columns:auto 1fr;gap:.9mm 4mm;margin-top:2.6mm;font-size:8.6pt}.datos dt{color:var(--muted)}
table{width:100%;border-collapse:collapse}thead{display:table-header-group}
th{font-weight:500;font-size:7.3pt;color:var(--muted);text-align:left;padding:0 0 2mm;border-bottom:.7pt solid var(--ink)}
td{padding:1.3mm 0;border-bottom:.5pt solid var(--line);vertical-align:middle}tr{break-inside:avoid}
.r{text-align:right;white-space:nowrap}.n{width:6mm;color:var(--muted);font-size:8pt}.cant{width:13mm}td.cant{font-weight:500}.unit{width:27mm}.tot{width:29mm;font-weight:500}
div.prod{display:grid;grid-template-columns:10mm 1fr;gap:4mm;align-items:center}div.prod.sin-dibujo{grid-template-columns:1fr}div.prod.sin-dibujo>div{padding-left:14mm}
.dibujo{width:10mm;height:12.5mm;display:block}
.prod b{display:block;font-size:9.6pt}.prod span{display:block;color:var(--muted);font-size:8.2pt;line-height:1.35}.prod .medida{color:var(--ink);font-weight:500}.prod .cod{font-size:7.3pt;letter-spacing:.03em;margin-top:.6mm}
.prod .descuento-item{color:#8a5a37}s.original{color:var(--muted);font-size:8pt}
.plano-c{width:26mm}.plano{height:18mm;width:auto;display:block}
/* En la nota, el plano y la casilla «Listo» dejan menos ancho: los precios se acotan para que el producto no se corte. */
.nota .cant{width:11mm}.nota .unit{width:23mm}.nota .tot{width:24mm}.plano text{font:500 125px 'Host Grotesk',Helvetica,sans-serif;fill:var(--ink)}.plano .cota{stroke:var(--ink);stroke-width:3;fill:none}
.generico{fill:none;stroke:var(--green);stroke-width:6;stroke-linejoin:round;stroke-linecap:round}
td.prod{padding-left:3mm}.listo{width:11mm;text-align:center}.listo i{display:inline-block;width:4mm;height:4mm;border:.7pt solid var(--ink);vertical-align:middle}
.cierre{display:grid;grid-template-columns:1fr 68mm;gap:12mm;margin-top:3mm;align-items:start;break-inside:avoid}
.valores{font-size:8.2pt;color:var(--muted);max-width:80mm;padding-top:1.2mm}
.totales div{display:flex;justify-content:space-between;gap:4mm;padding:.9mm 0;font-size:9pt}.totales dt{color:var(--muted)}
.totales .original dd{color:var(--muted)}.totales .ahorro dd{color:#8a5a37}
.totales .total{border-top:.7pt solid var(--ink);margin-top:1.5mm;padding-top:2.4mm;align-items:baseline}
.totales .total dt{font:400 12pt 'Newsreader',Georgia,serif;color:var(--ink)}.totales .total dd{font:500 22pt/1 'Newsreader',Georgia,serif;letter-spacing:-.015em;color:var(--green)}
.observaciones,.condiciones{margin-top:3mm;break-inside:avoid}
.observaciones h2,.condiciones h2{font:400 12pt 'Newsreader',Georgia,serif;margin-bottom:1.8mm}.observaciones p{font-size:8.6pt;white-space:pre-line}
.cond{display:grid;grid-template-columns:repeat(3,1fr);gap:0 6mm;font-size:7.9pt}.cond div{padding:2mm 0;border-top:.5pt solid var(--line)}.cond b{display:block}.cond p{color:var(--muted)}
.aceptar{margin-top:3mm;padding:3mm 5mm 3.5mm;background:var(--soft);break-inside:avoid}.aceptar h2{font:400 14pt 'Newsreader',Georgia,serif;letter-spacing:-.01em}.aceptar>p{margin-top:1.2mm;font-size:8.8pt}
.firmas{display:grid;grid-template-columns:repeat(3,1fr);gap:7mm;margin-top:5mm}.fab .firmas{grid-template-columns:1fr 1fr;gap:10mm;margin-top:6mm}
.firma{border-top:.5pt solid var(--ink);padding-top:1.4mm;font-size:7.3pt;color:var(--muted)}
.fab{margin-top:3.5mm;padding:3.5mm 5mm 4mm;background:var(--soft);break-inside:avoid}.fab h2{font:400 14pt 'Newsreader',Georgia,serif;letter-spacing:-.01em}
.linea{display:flex;gap:3mm;align-items:baseline;margin-top:3mm;font-size:8.6pt}.linea b{white-space:nowrap}.linea span{flex:1;border-bottom:.5pt solid var(--muted);min-height:4mm}
.obs{margin-top:3mm;font-size:8.6pt}.obs div{margin-top:1.2mm;min-height:10mm;border:.5pt solid var(--muted);background:#fff;padding:1.5mm 2mm;white-space:pre-line}
.anulada-marca{position:fixed;top:40%;left:0;right:0;text-align:center;font:600 110px 'Host Grotesk',Helvetica,sans-serif;color:rgba(170,30,30,.16);transform:rotate(-28deg);pointer-events:none;z-index:10}
.anulada-aviso{border:.7pt solid #aa1e1e;color:#aa1e1e;padding:2.4mm 3.5mm;margin-bottom:3mm;font-weight:500}
`;

/**
 * Logo de los documentos. La plantilla escribe `src="neltume-logo:<sha256>"` en lugar del SVG en base64, y el SVG se
 * inyecta justo antes de imprimir. Así `documentos_snapshot` guarda unos pocos bytes por documento en vez del logo
 * completo (que con un logo administrable puede pesar cientos de KB por cada PDF emitido).
 *
 * Al emitir, la impresión usa exactamente el logo con que se armó la plantilla (lo recuerda este proceso). Al
 * regenerar un PDF desde su snapshot se usa el logo vigente: el guardado en Ajustes en ese momento o, si no hay, el
 * publicado (public/logo-neltume.svg). Si el logo no cambió, el documento regenerado es idéntico al emitido.
 */
const REFERENCIA_LOGO = /src="neltume-logo:([0-9a-f]{64})"/g;
const MAX_LOGOS_RECORDADOS = 16;
const logosRecordados = new Map<string, Buffer>();

/** SVG del logo vigente: el de la configuración del negocio o el publicado. */
async function logoVigente(db: Database.Database = abrirBaseDatos()): Promise<Buffer> {
  const svg = datosEmpresa(db).logoSvg;
  return svg ? Buffer.from(svg, 'utf8') : readFile(join(process.cwd(), 'public/logo-neltume.svg'));
}

/** Referencia `neltume-logo:<sha256>` del logo; el contenido queda en memoria para la impresión inmediata. */
export function referenciaLogo(contenido: Buffer) {
  return `neltume-logo:${createHash('sha256').update(contenido).digest('hex')}`;
}

function registrarLogo(contenido: Buffer) {
  const referencia = referenciaLogo(contenido);
  const hash = referencia.slice('neltume-logo:'.length);
  logosRecordados.delete(hash);
  logosRecordados.set(hash, contenido);
  while (logosRecordados.size > MAX_LOGOS_RECORDADOS) logosRecordados.delete(logosRecordados.keys().next().value!);
  return referencia;
}

/**
 * Reemplaza las referencias al logo por el SVG en base64. Con `logo`, usa ese (el vigente, al regenerar); sin él, el
 * recordado de la plantilla y, si este proceso no lo conoce, el vigente de la base activa.
 */
export async function inyectarLogo(html: string, logo?: Buffer): Promise<string> {
  const hashes = new Set([...html.matchAll(REFERENCIA_LOGO)].map((m) => m[1]));
  if (!hashes.size) return html;
  const contenidos = new Map<string, Buffer>();
  for (const hash of hashes) contenidos.set(hash, logo ?? logosRecordados.get(hash) ?? (await logoVigente()));
  return html.replace(
    REFERENCIA_LOGO,
    (_, hash: string) => `src="data:image/svg+xml;base64,${contenidos.get(hash)!.toString('base64')}"`,
  );
}

/**
 * Quita el logo en base64 de un HTML guardado antes de usar referencias (la limpieza compacta los snapshots
 * antiguos). Devuelve el mismo texto si no hay nada que compactar.
 */
export function compactarLogo(html: string) {
  return html.replace(
    /<img alt="Neltume" src="data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)">/g,
    (_, base64: string) => `<img alt="Neltume" src="${referenciaLogo(Buffer.from(base64, 'base64'))}">`,
  );
}

const RECURSO = /(src|href)="neltume-dibujo:([a-z0-9-]+\.png)"|url\(neltume-fuente:([a-z0-9-]+\.woff2)\)/g;
const recursosLeidos = new Map<string, string>();
/** Archivo de `pdf-recursos` en base64 (se lee una vez por proceso); null si no está. */
async function recursoBase64(ruta: string) {
  if (!recursosLeidos.has(ruta))
    try {
      recursosLeidos.set(ruta, (await readFile(join(RECURSOS, ruta))).toString('base64'));
    } catch {
      return null;
    }
  return recursosLeidos.get(ruta)!;
}

/**
 * Reemplaza las referencias a los dibujos de los modelos (`neltume-dibujo:`) y a las fuentes (`neltume-fuente:`) por
 * su contenido en base64, como el logo: el snapshot guarda solo las referencias y el servidor imprime sin red. Una
 * referencia cuyo archivo no está queda tal cual: el documento se imprime sin ese dibujo o con la fuente de respaldo.
 */
export async function inyectarRecursos(html: string): Promise<string> {
  const contenidos = new Map<string, string | null>();
  for (const m of html.matchAll(RECURSO)) {
    const ruta = m[2] ? `dibujos/${m[2]}` : `fuentes/${m[3]}`;
    if (!contenidos.has(ruta)) contenidos.set(ruta, await recursoBase64(ruta));
  }
  return html.replace(RECURSO, (todo, atributo: string | undefined, dibujo: string | undefined, fuente: string | undefined) => {
    const base64 = contenidos.get(dibujo ? `dibujos/${dibujo}` : `fuentes/${fuente}`);
    if (!base64) return todo;
    return dibujo ? `${atributo}="data:image/png;base64,${base64}"` : `url(data:font/woff2;base64,${base64})`;
  });
}

/**
 * Pie de cada página: los datos de Neltume que trae el documento (`<meta name="neltume-pie">`, ya escapados) y el número
 * de página. Un documento anterior (un snapshot sin esa marca) lleva solo el número, como se imprimió.
 */
function piePagina(html: string) {
  const datos = html.match(/<meta name="neltume-pie" content="([^"]*)">/)?.[1] ?? '';
  return `<div style="width:100%;padding:0 14mm;font:7px Helvetica,Arial,sans-serif;color:#58615a;display:flex;justify-content:space-between;gap:12px"><span>${datos}</span><span style="white-space:nowrap">Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`;
}

// Un solo Chromium reutilizado entre documentos: lanzarlo cuesta más que imprimir. Se cierra tras un
// rato sin uso y se descarta ante cualquier falla, para que el siguiente documento parta limpio.
const INACTIVIDAD_MS = 5 * 60_000;
let navegador: Promise<Browser> | null = null;
let enUso = 0;
let cierreInactivo: NodeJS.Timeout | undefined;

function obtenerNavegador(plazoMs: number) {
  if (!navegador) {
    const lanzado = chromium.launch({ headless: true, executablePath: chromiumPath(), timeout: plazoMs });
    navegador = lanzado;
    lanzado.then(
      (b) =>
        b.on?.('disconnected', () => {
          if (navegador === lanzado) navegador = null;
        }),
      () => {
        if (navegador === lanzado) navegador = null;
      },
    );
  }
  return navegador;
}

/** Causa original para el registro técnico: solo la primera línea, sin el registro de llamadas de Playwright. */
const causa = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).split('\n')[0].slice(0, 300);

/**
 * Comprueba que Chromium arranca y abre una página antes de reservar un número. Se llama fuera del
 * bloqueo del estado y con plazo total: un Chromium colgado no deja esperando a nadie.
 */
export async function prepararPdf(plazoMs = PLAZO_PDF_MS) {
  enUso++;
  clearTimeout(cierreInactivo);
  let temporizador: NodeJS.Timeout | undefined;
  let fallo = false;
  try {
    await Promise.race([
      // Si la página llega después del plazo, igual se cierra.
      obtenerNavegador(plazoMs)
        .then((browser) => browser.newPage())
        .then((page) => page.close().catch(() => {})),
      new Promise<never>((_, rechazar) => {
        temporizador = setTimeout(
          () => rechazar(new Error(`Chromium no abrió una página en ${plazoMs} ms.`)),
          plazoMs,
        );
      }),
    ]);
  } catch (error) {
    fallo = true;
    throw new ErrorPdf(`No se pudo preparar Chromium antes de reservar el documento: ${causa(error)}`);
  } finally {
    clearTimeout(temporizador);
    enUso--;
    // Un navegador que no abre páginas no se reutiliza.
    if (fallo && !enUso) await cerrarNavegadorPdf();
    else if (!enUso) programarCierre();
  }
}

/** Cierra el Chromium compartido (también al terminar los tests o al apagar el servidor). */
export async function cerrarNavegadorPdf() {
  clearTimeout(cierreInactivo);
  const actual = navegador;
  navegador = null;
  const browser = await actual?.catch(() => null);
  await browser?.close().catch(() => {});
}

function programarCierre() {
  clearTimeout(cierreInactivo);
  cierreInactivo = setTimeout(() => {
    if (!enUso) void cerrarNavegadorPdf();
  }, INACTIVIDAD_MS);
  cierreInactivo.unref?.();
}

/**
 * Genera el PDF con un plazo total, fuera del bloqueo del estado. Nunca sobrescribe un documento
 * existente (link falla con EEXIST) y deja el archivo solo legible por el proceso.
 */
export async function generarPdf(
  directorio: string,
  archivo: string,
  html: string,
  plazoMs = PLAZO_PDF_MS,
  opciones: { /** Imprime el logo vigente de esta base (al regenerar desde un snapshot). */ logoDe?: Database.Database } = {},
) {
  const carpeta = join(directorio, 'pdf');
  await mkdir(carpeta, { recursive: true, mode: 0o700 });
  await chmod(carpeta, 0o700);
  const temporal = join(carpeta, `.${randomUUID()}.pdf`);
  const documento = await inyectarRecursos(
    await inyectarLogo(html, opciones.logoDe && (await logoVigente(opciones.logoDe))),
  );
  let pagina: Page | undefined;
  let vencido = false;
  let temporizador: NodeJS.Timeout | undefined;
  enUso++;
  clearTimeout(cierreInactivo);
  const tarea = (async () => {
    const browser = await obtenerNavegador(plazoMs);
    if (vencido) return;
    const page = await browser.newPage();
    pagina = page;
    page.setDefaultTimeout(plazoMs);
    await page.route('**/*', (route) => route.abort());
    await page.setContent(documento, { waitUntil: 'load', timeout: plazoMs });
    // Las fuentes incrustadas se cargan aparte: se imprime recién con ellas, no con la de respaldo.
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: temporal,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      // Numeración en el margen inferior: en documentos largos cada hoja dice cuántas son.
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: piePagina(html),
    });
  })();
  let fallo = false;
  try {
    await Promise.race([
      tarea,
      new Promise<never>((_, rechazar) => {
        temporizador = setTimeout(() => {
          vencido = true;
          rechazar(new ErrorPdf(`Chromium no terminó ${archivo} en ${plazoMs} ms.`));
        }, plazoMs);
      }),
    ]);
    await chmod(temporal, 0o600);
    try {
      await link(temporal, join(carpeta, archivo));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new ErrorPdf(`Ya existe ${archivo}; no se sobrescribe un documento emitido.`);
      if (['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP'].includes((error as NodeJS.ErrnoException).code ?? ''))
        await copyFile(temporal, join(carpeta, archivo), constants.COPYFILE_EXCL);
      else throw error;
    }
  } catch (error) {
    fallo = !(error instanceof ErrorPdf && !vencido);
    throw error instanceof ErrorPdf
      ? error
      : new ErrorPdf(`Falló la generación de ${archivo}: ${causa(error)}`);
  } finally {
    clearTimeout(temporizador);
    enUso--;
    // Si venció el plazo, la tarea puede terminar después: su archivo temporal también se borra.
    void tarea.catch(() => {}).finally(() => rm(temporal, { force: true }).catch(() => {}));
    await pagina?.close().catch(() => {});
    // Un navegador colgado o caído no se reutiliza.
    if (fallo && !enUso) await cerrarNavegadorPdf();
    else if (!enUso) programarCierre();
    await rm(temporal, { force: true });
  }
}
