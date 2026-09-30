import { chromium, type Browser, type Page } from 'playwright';
import { chmod, link, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Cotizacion, Despacho } from '../negocio/estado';
import type { Linea, Montos } from '../negocio/precios';
import { pesos, porcentaje, porcentajeIva, REGLAS, type ReglasComerciales } from '../negocio/precios';
import { fechaChilena } from '../negocio/vigencia';
import { medidaReferencia, metrosTexto } from '../catalogo/escalones';
import { chromiumPath } from './chromium';
import { datosEmpresa } from './empresa';
import { abrirBaseDatos } from './base-datos';
import { ErrorPdf } from './errores';

/** Plazo total para lanzar Chromium, cargar la plantilla e imprimir. */
export const PLAZO_PDF_MS = 30_000;

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
    if (l.anchoSolicitado === null && l.altoSolicitado === null) return null;
    return `${l.anchoSolicitado === null ? '—' : metrosTexto(l.anchoSolicitado)} × ${l.altoSolicitado === null ? '—' : metrosTexto(l.altoSolicitado)} m`;
  }
  if (!l.medidaSolicitada && l.altoSolicitado === null) return null;
  const medida = escuadria(l.medidaSolicitada ?? l.producto.medida, l.producto.familia);
  return `${medida} × ${l.altoSolicitado === null ? '—' : metrosTexto(l.altoSolicitado)} m`;
}

const MINUSCULAS = new Set(['a', 'de', 'del', 'y', 'kit']);
const UNIDADES: Record<string, string> = { mt: 'm', mts: 'm', cm: 'cm', pulg: 'pulg.' };

/**
 * Las descripciones de la planilla vienen en mayúsculas; en el documento se leen mejor con mayúscula
 * inicial y unidades normalizadas. Las escritas a mano (con minúsculas) se respetan tal cual. El nombre
 * canónico «Huilo Huilo» no cuenta como minúsculas: el importador lo deja así dentro de una descripción en mayúsculas.
 */
export function descripcionLegible(texto: string) {
  if (/\p{Ll}/u.test(texto.replaceAll('Huilo Huilo', ''))) return texto;
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

export async function plantilla(q: Cotizacion, doc: DocumentoPdf) {
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
          ['Medio de transporte', doc.despacho?.transporte ?? null],
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
  const totales = [
    fila('SUBTOTAL', pesos(montos.subtotal)),
    ...(montos.descuento
      ? [fila(`DESCUENTO ${porcentaje(montos.descuentoPorcentaje)}`, `−${pesos(montos.descuento)}`)]
      : []),
    ...(montos.flete ? [fila('FLETE', pesos(montos.flete))] : []),
    ...(montos.descuento || montos.flete ? [fila('NETO', pesos(montos.neto))] : []),
    fila(`I.V.A. ${porcentajeIva(reglas.iva)}`, pesos(montos.iva)),
    fila('TOTAL', pesos(montos.total), 'total'),
  ].join('');
  const validez = doc.vence
    ? `Cotización válida hasta el ${fechaChilena(doc.vence)} (${reglas.vigenciaDiasHabiles} días hábiles).`
    : `Cotización válida por ${reglas.vigenciaDiasHabiles} días hábiles.`;
  const empresa = datosEmpresa(abrirBaseDatos());
  const logo = empresa.logoSvg
    ? Buffer.from(empresa.logoSvg, 'utf8')
    : await readFile(join(process.cwd(), 'public/logo-neltume.svg'));
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
    'Valores puestos en fábrica.',
    montos.flete
      ? 'Incluye flete por despacho (detallado en los totales).'
      : 'Flete por despacho pendiente: valor según unidades de compra.',
    validez,
    ...[
      ['Forma de pago', empresa.condicionesPago],
      ['Plazo de entrega', empresa.plazoEntrega],
      ['Datos para transferencia', empresa.datosBancarios],
    ].flatMap(([k, v]) => (v ? [`<b>${k}:</b> ${esc(v)}`] : [])),
  ];
  // La cotización cierra con sus condiciones y la aceptación del cliente; la nota, con lo que fábrica
  // completa a mano: entrega comprometida, observaciones y recepción.
  const cierre = nota
    ? `<div class="bloque"><h2>Para fábrica</h2><div class="linea"><b>Entrega comprometida:</b><span>${esc(doc.despacho?.entregaComprometida)}</span></div><div class="observaciones"><b>Observaciones:</b>${observaciones ? `<p>${esc(observaciones)}</p>` : ''}</div>${doc.anulada ? '' : `<div class="firmas">${firma('Aprobado por Neltume')}${firma('Recibido por fábrica')}</div>`}</div>`
    : `<div class="bloque"><h2>Condiciones</h2>${condiciones.map((p) => `<p>${p}</p>`).join('')}</div>${observaciones ? `<div class="bloque"><h2>Observaciones</h2><p>${esc(observaciones)}</p></div>` : ''}${doc.anulada ? '' : `<div class="bloque"><h2>Aceptación del cliente</h2><div class="firmas">${firma('Nombre y RUT')}${firma('Firma')}${firma('Fecha')}</div></div>`}`;
  // El cliente no ve datos internos; la nota agrega la referencia de catálogo para que fábrica sepa el producto base.
  const descripcion = (l: Linea) => {
    const pedida = medidaPedida(l);
    const tipoMedida = l.tipoMedida === 'hoja' || l.tipoMedida === 'vano' ? ` · medida de ${l.tipoMedida}` : '';
    const detalles = [
      pedida && `Medida solicitada: ${pedida}${tipoMedida}`,
      nota && `Referencia de catálogo: ${l.producto.codigo} · ${medidaReferencia(l.producto)}`,
      l.observaciones && `Observación: ${l.observaciones}`,
    ];
    return `${esc(descripcionLegible(l.descripcionDocumento ?? l.producto.descripcion))}${detalles.map((d) => (d ? `<br><small>${esc(d)}</small>` : '')).join('')}`;
  };
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${titulo}</title><style>
    @page{size:A4;margin:16mm 15mm 20mm}*{box-sizing:border-box}body{font:11px Arial,sans-serif;color:#242a24;margin:0;background:#fff}b{font-weight:600}
    header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:2px solid #324536;padding-bottom:20px}header img{display:block;height:120px;width:auto}header>div:last-child{text-align:right}h1{font:700 20px Arial,sans-serif;letter-spacing:.03em;margin:4px 0 12px;color:#1c241e}header p{margin:4px 0 0}.empresa{font-size:10px;line-height:1.5;margin-top:10px;color:#3d443d}
    section{margin:22px 0;display:grid;grid-template-columns:1fr 1fr;gap:0 25px}section div div{min-height:15px;margin-bottom:11px}h2{font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:#324536;margin:0 0 10px;padding-bottom:5px;border-bottom:1px solid #deded6}
    table{width:100%;border-collapse:collapse;font-size:10px}thead{display:table-header-group}th{text-align:left;border-top:1px solid #324536;border-bottom:1px solid #324536;padding:10px 5px;font-size:9px}td{padding:11px 5px;border-bottom:1px solid #deded6;vertical-align:baseline}td small{font-size:9px;color:#4a524a}tr{break-inside:avoid}.num{text-align:right;white-space:nowrap}.codigo{white-space:nowrap;font-size:9px}.check{width:34px;text-align:center}.check i{display:inline-block;width:11px;height:11px;border:1px solid #324536;vertical-align:-2px}
    .totales{width:255px;margin:20px 0 24px auto;break-inside:avoid}.totales p{display:flex;justify-content:space-between;margin:9px 0}.total{border-top:2px solid #324536;padding-top:12px;font-size:15px}
    footer{font-size:10px;border-top:1px solid #aaa;padding-top:16px;line-height:1.6}.bloque{break-inside:avoid;margin-bottom:18px}.bloque p{margin:2px 0}.firmas{display:flex;gap:28px;margin-top:34px}.firma{flex:1;font-size:9px;color:#4a524a}.firma span{display:block;border-top:1px solid #242a24;margin-bottom:4px}.linea{display:flex;gap:8px;align-items:baseline;margin-bottom:12px}.linea span{flex:1;border-bottom:1px solid #9a9f98;height:12px}.observaciones{border:1px solid #9a9f98;min-height:64px;padding:6px 8px}.contacto{color:#4a524a}
    .anulada-marca{position:fixed;top:40%;left:0;right:0;text-align:center;font:bold 110px Arial,sans-serif;color:rgba(170,30,30,.16);transform:rotate(-28deg);pointer-events:none;z-index:10}.anulada-aviso{border:2px solid #aa1e1e;color:#aa1e1e;padding:8px 10px;margin:14px 0 0;font-weight:600}
    </style></head><body>${anulacion}<header><div><img alt="Neltume" src="data:image/svg+xml;base64,${logo.toString('base64')}">${datosNeltume.length ? `<div class="empresa">${datosNeltume.map((d) => `<div>${d}</div>`).join('')}</div>` : ''}</div><div><h1>${titulo}</h1>${metadatos.map(([k, v]) => `<p><b>${k}:</b> ${esc(v)}</p>`).join('')}</div></header>
    <section>${columnas.map((col, i) => `<div>${encabezados ? `<h2>${encabezados[i]}</h2>` : ''}${col.map(campo).join('')}</div>`).join('')}</section>
    <table><thead><tr><th>ITEM</th><th>CÓDIGO</th><th>DESCRIPCIÓN</th><th class="num">CANT.</th><th class="num">PRECIO UNIT.</th><th class="num">TOTAL</th>${nota ? '<th class="check">LISTO</th>' : ''}</tr></thead><tbody>
    ${montos.lineas.map((l, i) => `<tr><td>${i + 1}</td><td class="codigo">${esc(l.producto.codigo)}</td><td>${descripcion(l)}</td><td class="num">${l.cantidad}</td><td class="num">${pesos(l.precioUnitario)}</td><td class="num">${pesos(l.total)}</td>${nota ? '<td class="check"><i></i></td>' : ''}</tr>`).join('')}</tbody></table>
    <div class="totales">${totales}</div>
    <footer>${cierre}<p class="contacto">Para preguntas referentes a esta ${nota ? 'nota de pedido' : 'cotización'} contactarnos a: ${esc(empresa.correo)}</p></footer></body></html>`;
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
export async function generarPdf(directorio: string, archivo: string, html: string, plazoMs = PLAZO_PDF_MS) {
  const carpeta = join(directorio, 'pdf');
  await mkdir(carpeta, { recursive: true, mode: 0o700 });
  await chmod(carpeta, 0o700);
  const temporal = join(carpeta, `.${randomUUID()}.pdf`);
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
    await page.setContent(html, { waitUntil: 'load', timeout: plazoMs });
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
      throw error;
    }
  } catch (error) {
    fallo = !(error instanceof ErrorPdf && !vencido);
    throw error;
  } finally {
    clearTimeout(temporizador);
    enUso--;
    // Si venció el plazo, la tarea puede terminar después: su archivo temporal también se borra.
    void tarea.catch(() => {}).finally(() => rm(temporal, { force: true }).catch(() => {}));
    await pagina?.close().catch(() => {});
    // Un navegador colgado o caído no se reutiliza.
    if (fallo) await cerrarNavegadorPdf();
    else if (!enUso) programarCierre();
    await rm(temporal, { force: true });
  }
}
