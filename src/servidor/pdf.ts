import { chromium, type Browser, type Page } from 'playwright';
import { constants } from 'node:fs';
import type Database from 'better-sqlite3';
import { copyFile, chmod, link, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { etiquetaDescuento } from '../negocio/descuento-cantidad';
import type { Cotizacion, Despacho } from '../negocio/estado';
import { CODIGO_FLETE, cantidadFlete, descripcionFlete, sinTransportista, unitarioFlete } from '../negocio/estado';
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
  montos: Montos;
  fecha: string;
  /** Solo cotización: último día de validez YYYY-MM-DD. */
  vence?: string | null;
  /** Cotización: quien emite. Nota: quien aprueba. */
  autor?: string | null;
  despacho?: Despacho | null;
  reglas?: ReglasComerciales;
  observaciones?: string | null;
  /** Documento anulado: se imprime con una marca visible y la fecha y el motivo de la anulación. */
  anulada?: { fecha: string | null; motivo: string | null; por: string | null } | null;
}

const fechaDocumento = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });

export async function plantilla(q: Cotizacion, doc: DocumentoPdf, db: Database.Database = abrirBaseDatos()) {
  const nota = doc.tipo === 'nota';
  const { numero, montos, fecha } = doc;
  const reglas = doc.reglas ?? q.reglas ?? REGLAS;
  const titulo = nota ? `NOTA DE PEDIDO N° ${numero}` : `COTIZACIÓN N° ${numero}`;
  const c = q.cliente;
  type Campo = [string, string | null];
  const si = (etiqueta: string, valor: string | null | undefined): Campo[] =>
    valor ? [[etiqueta, valor]] : [];
  // Columnas explícitas: la identidad del cliente se lee junta y, en la nota, el despacho queda aparte.
  const columnas: [Campo[], Campo[]] = nota
    ? [
        [
          ['Nombre', c.nombre],
          ['RUT', c.rut],
          ['Giro', c.giro],
          ['Dirección', c.direccion],
          ['Ciudad / Comuna', c.comuna],
          ['Teléfono', c.telefono],
        ],
        [
          ['Dirección de despacho', doc.despacho?.direccion ?? null],
          // Un «Otro» guardado antes de que se exigiera el nombre no se imprime.
          ['Medio de transporte', sinTransportista(doc.despacho?.transporte) ? null : doc.despacho!.transporte!.trim()],
          ...si('Proyecto', c.proyecto),
        ],
      ]
    : [
        [['Nombre', c.nombre], ...si('RUT', c.rut), ...si('Giro', c.giro), ...si('Teléfono', c.telefono)],
        [['Proyecto', c.proyecto], ...si('Dirección', c.direccion), ['Ciudad / Comuna', c.comuna]],
      ];
  const encabezados = nota ? ['Cliente', 'Despacho'] : null;
  const metadatos: Campo[] = [
    ['Fecha', fechaDocumento(fecha)],
    ...(nota
      ? si('Ref. cotización', `N° ${q.numero}`)
      : si('Revisión de la cotización', q.origen ? `N° ${q.origen}` : null)),
    ...(nota
      ? [...si('Aprobada por', doc.autor), ...si('Cotización emitida por', q.emitidaPor)]
      : si('Emitida por', doc.autor)),
  ];
  const campo = ([k, v]: Campo) => `<div><b>${k}:</b> ${esc(v)}</div>`;
  const fila = (etiqueta: string, valor: string, clase = '') =>
    `<p${clase ? ` class="${clase}"` : ''}><span>${etiqueta}</span><b>${valor}</b></p>`;
  // El flete va como línea del detalle, así que el subtotal lo incluye; el descuento sigue siendo solo de productos.
  // Con descuentos especiales por ítem, primero lo que habría costado sin ellos y cuánto se ahorra.
  const { ahorro, subtotalOriginal } = resumenDescuentosItems(montos);
  const totales = [
    ...(ahorro
      ? [
          fila('SUBTOTAL ORIGINAL', pesos(subtotalOriginal + montos.flete), 'original'),
          fila('AHORRO DESC. ESPECIALES', `−${pesos(ahorro)}`, 'ahorro'),
        ]
      : []),
    fila('SUBTOTAL', pesos(montos.subtotal + montos.flete)),
    ...(montos.descuento
      ? [
          fila(
            `${etiquetaDescuento({ descuento: q.descuento, descuentoManual: q.descuentoManual, reglas }, { corta: true }).toUpperCase()} ${porcentaje(montos.descuentoPorcentaje)}${montos.flete ? ' SOBRE PRODUCTOS' : ''}`,
            `−${pesos(montos.descuento)}`,
          ),
        ]
      : []),
    ...(montos.descuento ? [fila('NETO', pesos(montos.neto))] : []),
    fila(`I.V.A. ${porcentajeIva(reglas.iva)}`, pesos(montos.iva)),
    fila('TOTAL', pesos(montos.total), 'total'),
  ].join('');
  const validez = doc.vence
    ? `Cotización válida hasta el ${fechaChilena(doc.vence)} (${reglas.vigenciaDiasHabiles} días hábiles).`
    : `Cotización válida por ${reglas.vigenciaDiasHabiles} días hábiles.`;
  const empresa = datosEmpresa(db);
  // El logo va como referencia: el HTML que se guarda como snapshot de cada documento no repite el SVG en base64.
  const logo = registrarLogo(await logoVigente(db));
  const observaciones = doc.observaciones ?? q.observaciones;
  const datosNeltume = [
    empresa.nombre && `<b>${esc(empresa.nombre)}</b>`,
    empresa.rut && `RUT ${esc(empresa.rut)}`,
    empresa.direccion && esc(empresa.direccion),
    [empresa.telefono && `Tel. ${esc(empresa.telefono)}`, empresa.web && esc(empresa.web)]
      .filter(Boolean)
      .join(' · '),
  ].filter(Boolean);
  const anulacion = doc.anulada
    ? `<div class="anulada-marca" aria-hidden="true">ANULADA</div><p class="anulada-aviso">${nota ? 'NOTA DE PEDIDO ANULADA' : 'COTIZACIÓN ANULADA'}${doc.anulada.fecha ? ` el ${fechaDocumento(doc.anulada.fecha)}` : ''}${doc.anulada.por ? ` por ${esc(doc.anulada.por)}` : ''}${doc.anulada.motivo ? `. Motivo: ${esc(doc.anulada.motivo)}` : ''}. No es válida${nota ? ' para fábrica' : ''}.</p>`
    : '';
  const firma = (rotulo: string) => `<div class="firma"><span></span>${rotulo}</div>`;
  const condiciones = [
    validez,
    ...(empresa.datosBancarios ? [`<b>Datos para transferencia:</b> ${esc(empresa.datosBancarios)}`] : []),
    'No se considera: Instalación, pintura, barniz, protecciones metálicas, vidrios ni estructura para correderas.',
    'No se consideran elementos no indicados en la cotización.',
    'Valores puestos en fábrica.',
    // Con el flete en el detalle, «consultar el despacho» contradiría el documento.
    ...(montos.flete ? [] : ['Consultar valor despacho.']),
    ...(empresa.plazoEntrega ? [`<b>Plazo de entrega:</b> ${esc(empresa.plazoEntrega)}`] : []),
    ...(empresa.condicionesPago ? [esc(empresa.condicionesPago)] : []),
  ];
  // La cotización cierra con la aceptación seguida de sus condiciones; la nota, con lo que fábrica
  // completa a mano: entrega comprometida, observaciones y recepción.
  const bloqueCondiciones = `<div class="bloque"><h2>Condiciones</h2>${condiciones.map((p) => `<p>${p}</p>`).join('')}</div>`;
  const cierre = nota
    ? `<div class="bloque"><h2>Para fábrica</h2><div class="linea"><b>Entrega comprometida:</b><span>${esc(doc.despacho?.entregaComprometida)}</span></div><div class="observaciones"><b>Observaciones:</b>${observaciones ? `<p>${esc(observaciones)}</p>` : ''}</div>${doc.anulada ? '' : `<div class="firmas">${firma('Aprobado por Neltume')}${firma('Recibido por fábrica')}</div>`}</div>`
    : `${observaciones ? `<div class="bloque"><h2>Observaciones</h2><p>${esc(observaciones)}</p></div>` : ''}${doc.anulada ? '' : `<div class="bloque"><h2>Aceptación del cliente</h2><div class="firmas">${firma('Nombre y RUT')}${firma('Firma')}${firma('Fecha')}</div></div>`}${bloqueCondiciones}`;
  // El cliente no ve datos internos; la nota agrega la referencia de catálogo para que fábrica sepa el producto base.
  // Un producto fuera de catálogo no tiene referencia de catálogo: fábrica ve las referencias que entregó el cliente.
  const referenciaFabrica = (l: Linea) => {
    if (l.producto.codigo !== CODIGO_PERSONALIZADO)
      return `Referencia de catálogo: ${l.producto.codigo} · ${medidaReferencia(l.producto)}`;
    const referencias = l.indice === null ? [] : (q.solicitudes[l.indice]?.referencias ?? []);
    return `Producto personalizado, fuera de catálogo${referencias.length ? ` · Referencias del cliente: ${referencias.map((r) => r.nombre).join(', ')}` : ''}`;
  };
  const descripcion = (l: Linea) => {
    // El nombre ya lleva la medida pedida; solo una descripción escrita a mano necesita repetirla aparte.
    const tipoMedidaExplicita = l.tipoMedida === 'hoja' || l.tipoMedida === 'vano';
    const pedida = l.descripcionDocumento || tipoMedidaExplicita ? medidaPedida(l) : null;
    const tipo = l.tipoMedida === 'hoja' || l.tipoMedida === 'vano' ? `medida de ${l.tipoMedida}` : null;
    const detalles = [
      pedida ? `Medida solicitada: ${pedida}` : tipo && `${tipo[0].toUpperCase()}${tipo.slice(1)}`,
      nota && referenciaFabrica(l),
      l.observaciones && `Observación: ${l.observaciones}`,
    ];
    return `${esc(descripcionLegible(descripcionLinea(l)))}${detalles.map((d) => (d ? `<br><small>${esc(d)}</small>` : '')).join('')}${conDescuentoItem(l) && l.descuentoItem ? `<br><small class="descuento-item">Descuento especial ${esc(textoDescuentoItem(l.descuentoItem))}: −${pesos(l.descuentoUnitario!)} c/u · Ahorro ${pesos(ahorroLinea(l))}</small>` : ''}`;
  };
  // Con descuento especial, el precio original queda tachado sobre el rebajado (unitario y total de la línea).
  const conOriginal = (l: Linea, original: number, final: number) =>
    conDescuentoItem(l) ? `<s class="original">${pesos(original)}</s><br><b>${pesos(final)}</b>` : pesos(final);
  // En la nota, un pedido especial sin costo de fábrica va «Por definir», en su lugar del pedido, y no suma.
  const porDefinir = nota
    ? q.montos.lineas.filter(
        (l) =>
          l.indice != null &&
          !!q.solicitudes[l.indice]?.personalizado &&
          !montos.lineas.some((m) => m.indice === l.indice),
      )
    : [];
  const filas = [
    ...montos.lineas.map((l) => ({ l, definida: true })),
    ...porDefinir.map((l) => ({ l, definida: false })),
  ].sort((a, b) => (a.l.indice ?? 0) - (b.l.indice ?? 0));
  const filaProducto = ({ l, definida }: (typeof filas)[number], i: number) =>
    `<tr><td>${i + 1}</td><td class="codigo">${esc(l.producto.codigo)}</td><td>${descripcion(l)}</td><td class="num">${l.cantidad}</td>${
      definida
        ? `<td class="num">${conOriginal(l, l.precioUnitario, precioConDescuento(l))}</td><td class="num">${conOriginal(l, l.cantidad * l.precioUnitario, l.total)}</td>`
        : '<td class="num">Por definir</td><td class="num">Por definir</td>'
    }${nota ? '<td class="check"><i></i></td>' : ''}</tr>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${titulo}</title><style>
    @page{size:A4;margin:16mm 15mm 20mm}*{box-sizing:border-box}body{font:11px Arial,sans-serif;color:#242a24;margin:0;background:#fff}b{font-weight:600}
    header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:2px solid #324536;padding-bottom:20px}header img{display:block;height:120px;width:auto}header>div:last-child{text-align:right}h1{font:700 20px Arial,sans-serif;letter-spacing:.03em;margin:4px 0 12px;color:#1c241e}header p{margin:4px 0 0}.empresa{font-size:10px;line-height:1.5;margin-top:10px;color:#3d443d}
    section{margin:22px 0;display:grid;grid-template-columns:1fr 1fr;gap:0 25px}section div div{min-height:15px;margin-bottom:11px}h2{font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:#324536;margin:0 0 10px;padding-bottom:5px;border-bottom:1px solid #deded6}
    table{width:100%;border-collapse:collapse;font-size:10px}thead{display:table-header-group}th{text-align:left;border-top:1px solid #324536;border-bottom:1px solid #324536;padding:10px 5px;font-size:9px}td{padding:11px 5px;border-bottom:1px solid #deded6;vertical-align:baseline}td small{font-size:9px;color:#4a524a}tr{break-inside:avoid}.num{text-align:right;white-space:nowrap}.codigo{white-space:nowrap;font-size:9px}.check{width:34px;text-align:center}.check i{display:inline-block;width:11px;height:11px;border:1px solid #324536;vertical-align:-2px}
    .totales{width:255px;margin:20px 0 24px auto;break-inside:avoid}.totales p{display:flex;justify-content:space-between;margin:9px 0}.total{border-top:2px solid #324536;padding-top:12px;font-size:15px}.totales .original b{font-weight:400}.totales .ahorro,.descuento-item{color:#8a5a37}s.original{color:#6b716b;font-size:9px}
    footer{font-size:10px;border-top:1px solid #aaa;padding-top:16px;line-height:1.6}.bloque{break-inside:avoid;margin-bottom:18px}.bloque p{margin:2px 0}.firmas{display:flex;gap:28px;margin-top:34px}.firma{flex:1;font-size:9px;color:#4a524a}.firma span{display:block;border-top:1px solid #242a24;margin-bottom:4px}.linea{display:flex;gap:8px;align-items:baseline;margin-bottom:12px}.linea span{flex:1;border-bottom:1px solid #9a9f98;height:12px}.observaciones{border:1px solid #9a9f98;min-height:64px;padding:6px 8px}.contacto{color:#4a524a}
    .anulada-marca{position:fixed;top:40%;left:0;right:0;text-align:center;font:bold 110px Arial,sans-serif;color:rgba(170,30,30,.16);transform:rotate(-28deg);pointer-events:none;z-index:10}.anulada-aviso{border:2px solid #aa1e1e;color:#aa1e1e;padding:8px 10px;margin:14px 0 0;font-weight:600}.por-definir{font-size:9px;color:#4a524a;text-align:right;margin:-12px 0 20px}
    </style></head><body>${anulacion}<header><div><img alt="Neltume" src="${logo}">${datosNeltume.length ? `<div class="empresa">${datosNeltume.map((d) => `<div>${d}</div>`).join('')}</div>` : ''}</div><div><h1>${titulo}</h1>${metadatos.map(([k, v]) => `<p><b>${k}:</b> ${esc(v)}</p>`).join('')}</div></header>
    <section>${columnas.map((col, i) => `<div>${encabezados ? `<h2>${encabezados[i]}</h2>` : ''}${col.map(campo).join('')}</div>`).join('')}</section>
    <table><thead><tr><th>ITEM</th><th>CÓDIGO</th><th>DESCRIPCIÓN</th><th class="num">CANT.</th><th class="num">PRECIO UNIT.</th><th class="num">TOTAL</th>${nota ? '<th class="check">LISTO</th>' : ''}</tr></thead><tbody>
    ${filas.map(filaProducto).join('')}${montos.flete ? `<tr><td>${filas.length + 1}</td><td class="codigo">${CODIGO_FLETE}</td><td>${esc(descripcionFlete(q))}</td><td class="num">${cantidadFlete(q)}</td><td class="num">${pesos(unitarioFlete(q))}</td><td class="num">${pesos(montos.flete)}</td>${nota ? '<td class="check"></td>' : ''}</tr>` : ''}</tbody></table>
    <div class="totales">${totales}</div>${porDefinir.length ? '<p class="por-definir">Las líneas «Por definir» son pedidos especiales sin costo de fábrica: no están en el total.</p>' : ''}
    <footer>${cierre}<p class="contacto">Para preguntas referentes a esta ${nota ? 'nota de pedido' : 'cotización'} contactarnos a: ${esc(empresa.correo)}</p></footer></body></html>`;
}

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
  const documento = await inyectarLogo(html, opciones.logoDe && (await logoVigente(opciones.logoDe)));
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
    await page.pdf({
      path: temporal,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      // Numeración en el margen inferior: en documentos largos cada hoja dice cuántas son.
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="width:100%;padding:0 15mm;font:8px Arial,sans-serif;color:#6b716b;text-align:right">Página <span class="pageNumber"></span> de <span class="totalPages"></span></div>',
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
