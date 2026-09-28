import { chromium, type Browser, type Page } from 'playwright';
import { chmod, link, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Cotizacion, Despacho } from '../negocio/estado';
import type { Linea, Montos } from '../negocio/precios';
import { pesos, porcentaje, porcentajeIva, REGLAS } from '../negocio/precios';
import { fechaChilena } from '../negocio/vigencia';
import { chromiumPath } from './chromium';
import { datosEmpresa } from './empresa';
import { ErrorPdf } from './errores';

/** Plazo total para lanzar Chromium, cargar la plantilla e imprimir. */
export const PLAZO_PDF_MS = 30_000;

const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const decimal = (n: number) => n.toFixed(2).replace('.', ',');

/** Medida exacta pedida, que la fábrica necesita aunque el producto cubra un rango. */
export function medidaPedida(l: Linea): string | null {
  if (l.producto.familia === 'PUERTA') {
    if (l.anchoSolicitado === null && l.altoSolicitado === null) return null;
    return `${l.anchoSolicitado === null ? '—' : decimal(l.anchoSolicitado)} × ${l.altoSolicitado === null ? '—' : decimal(l.altoSolicitado)} m`;
  }
  if (!l.medidaSolicitada && l.altoSolicitado === null) return null;
  return `${l.medidaSolicitada ?? l.producto.medida} × ${l.altoSolicitado === null ? '—' : decimal(l.altoSolicitado)} m`;
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
  /** Documento anulado: se imprime con una marca visible y la fecha y el motivo de la anulación. */
  anulada?: { fecha: string | null; motivo: string | null; por: string | null } | null;
}

export async function plantilla(q: Cotizacion, doc: DocumentoPdf) {
  const nota = doc.tipo === 'nota';
  const { numero, montos, fecha } = doc;
  const logo = await readFile(join(process.cwd(), 'public/logo-neltume.svg'));
  const titulo = nota ? `NOTA DE PEDIDO N° ${numero}` : `COTIZACIÓN N° ${numero}`;
  const c = q.cliente;
  const campos: [string, string | null][] = nota
    ? [
        ['Nombre', c.nombre],
        ['Rut', c.rut],
        ['Giro', c.giro],
        ['Dirección', c.direccion],
        ['Dirección de Despacho', doc.despacho?.direccion ?? null],
        ['Ciudad / Comuna', c.comuna],
        ['Medio de Transporte', doc.despacho?.transporte ?? null],
        ['Contacto Teléfono', c.telefono],
        ...(doc.autor ? [['Aprobada por', doc.autor] as [string, string]] : []),
        ...(q.emitidaPor ? [['Cotización emitida por', q.emitidaPor] as [string, string]] : []),
      ]
    : [
        ['Nombre', c.nombre],
        ['Proyecto', c.proyecto],
        ['Ciudad / Comuna', c.comuna],
        ...(c.rut ? [['RUT', c.rut] as [string, string]] : []),
        ...(c.giro ? [['Giro', c.giro] as [string, string]] : []),
        ...(c.direccion ? [['Dirección', c.direccion] as [string, string]] : []),
        ...(c.telefono ? [['Teléfono', c.telefono] as [string, string]] : []),
        ...(doc.autor ? [['Emitida por', doc.autor] as [string, string]] : []),
      ];
  const referencia = nota
    ? `<p>Ref. cotización N° ${q.numero}</p>`
    : q.origen
      ? `<p>Revisión de la cotización N° ${q.origen}</p>`
      : '';
  const fila = (etiqueta: string, valor: string, clase = '') =>
    `<p${clase ? ` class="${clase}"` : ''}><span>${etiqueta}</span><b>${valor}</b></p>`;
  const totales = [
    fila('SUBTOTAL', pesos(montos.subtotal)),
    ...(montos.descuento
      ? [fila(`DESCUENTO ${porcentaje(montos.descuentoPorcentaje)}`, `−${pesos(montos.descuento)}`)]
      : []),
    ...(montos.flete ? [fila('FLETE', pesos(montos.flete))] : []),
    ...(montos.descuento || montos.flete ? [fila('NETO', pesos(montos.neto))] : []),
    fila(`${nota ? 'TOTAL I.V.A.' : 'I.V.A.'} ${porcentajeIva()}`, pesos(montos.iva)),
    fila('TOTAL', pesos(montos.total), 'total'),
  ].join('');
  const validez = doc.vence
    ? `Cotización válida hasta el ${fechaChilena(doc.vence)} (${REGLAS.vigenciaDiasHabiles} días hábiles).`
    : `Cotización válida por ${REGLAS.vigenciaDiasHabiles} días hábiles.`;
  const empresa = datosEmpresa();
  const datosNeltume = [
    empresa.nombre && `<b>${esc(empresa.nombre)}</b>`,
    empresa.rut && `RUT ${esc(empresa.rut)}`,
    empresa.direccion && esc(empresa.direccion),
    [empresa.telefono && `Tel. ${esc(empresa.telefono)}`, empresa.web && esc(empresa.web)]
      .filter(Boolean)
      .join(' · '),
  ].filter(Boolean);
  const anulacion = doc.anulada
    ? `<div class="anulada-marca" aria-hidden="true">ANULADA</div><p class="anulada-aviso">${nota ? 'NOTA DE PEDIDO ANULADA' : 'COTIZACIÓN ANULADA'}${doc.anulada.fecha ? ` el ${new Date(doc.anulada.fecha).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })}` : ''}${doc.anulada.por ? ` por ${esc(doc.anulada.por)}` : ''}${doc.anulada.motivo ? `. Motivo: ${esc(doc.anulada.motivo)}` : ''}. No es válida${nota ? ' para fábrica' : ''}.</p>`
    : '';
  const pie = nota
    ? '<p><b>GRACIAS</b></p>'
    : `<p>Valores puestos en fábrica.</p><p>${montos.flete ? `Incluye flete por ${pesos(montos.flete)} neto.` : 'Flete por despacho pendiente: valor según unidades de compra.'}</p><p>${validez}</p>`;
  const descripcion = (l: Linea) => {
    const pedida = medidaPedida(l);
    return `${esc(l.producto.descripcion)}${pedida ? `<br><small>Medida solicitada: ${esc(pedida)}</small>` : ''}`;
  };
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${titulo}</title><style>
    @page{size:A4;margin:18mm 15mm}*{box-sizing:border-box}body{font:11px Arial,sans-serif;color:#242a24;margin:0;background:#fff}header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #324536;padding-bottom:22px}header img{width:145px;max-height:75px}h1{font:19px Georgia,serif;margin:0 0 10px}header>div:last-child{text-align:right}section{margin:23px 0;display:grid;grid-template-columns:1fr 1fr;gap:12px 25px}section div{min-height:15px}b{font-weight:600}table{width:100%;border-collapse:collapse;font-size:10px}thead{display:table-header-group}th{text-align:left;border-top:1px solid #324536;border-bottom:1px solid #324536;padding:10px 5px;font-size:8px}td{padding:12px 5px;border-bottom:1px solid #deded6;vertical-align:top}td small{font-size:9px;color:#4a524a}tr{break-inside:avoid}.num{text-align:right;white-space:nowrap}.codigo{white-space:nowrap;font-size:8px}.totales{width:255px;margin:24px 0 28px auto;break-inside:avoid}.totales p{display:flex;justify-content:space-between}.total{border-top:2px solid #324536;padding-top:12px;font-size:15px}footer{font-size:10px;border-top:1px solid #aaa;padding-top:16px;line-height:1.6;break-inside:avoid}footer p{margin:3px 0}.empresa{text-align:left;font-size:9px;line-height:1.5;margin-top:8px;color:#4a524a}.anulada-marca{position:fixed;top:40%;left:0;right:0;text-align:center;font:bold 110px Arial,sans-serif;color:rgba(170,30,30,.16);transform:rotate(-28deg);pointer-events:none;z-index:10}.anulada-aviso{border:2px solid #aa1e1e;color:#aa1e1e;padding:8px 10px;margin:14px 0 0;font-weight:600}
    </style></head><body>${anulacion}<header><div><img alt="Neltume" src="data:image/svg+xml;base64,${logo.toString('base64')}">${datosNeltume.length ? `<div class="empresa">${datosNeltume.map((d) => `<div>${d}</div>`).join('')}</div>` : ''}</div><div><h1>${titulo}</h1><span>FECHA: ${new Date(fecha).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })}</span>${referencia}</div></header>
    <section>${campos.map(([k, v]) => `<div><b>${k}:</b> ${esc(v)}</div>`).join('')}</section>
    <table><thead><tr>${nota ? '' : '<th>ITEM</th>'}<th>CÓDIGO</th><th>DESCRIPCIÓN${nota ? ' PRODUCTO' : ''}</th><th class="num">CANT.</th><th class="num">PRECIO UNIT.</th><th class="num">TOTAL</th></tr></thead><tbody>
    ${montos.lineas.map((l, i) => `<tr>${nota ? '' : `<td>${i + 1}</td>`}<td class="codigo">${esc(l.producto.codigo)}</td><td>${descripcion(l)}</td><td class="num">${l.cantidad}</td><td class="num">${pesos(l.precioUnitario)}</td><td class="num">${pesos(l.total)}</td></tr>`).join('')}${montos.flete ? `<tr>${nota ? '' : `<td>${montos.lineas.length + 1}</td>`}<td class="codigo">FLETE</td><td>Flete por despacho</td><td class="num">1</td><td class="num">${pesos(montos.flete)}</td><td class="num">${pesos(montos.flete)}</td></tr>` : ''}</tbody></table>
    <div class="totales">${totales}</div>
    <footer>${pie}<p>Para preguntas referentes a esta ${nota ? 'nota de pedido' : 'cotización'} contactarnos a: ${esc(empresa.correo)}</p></footer></body></html>`;
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
    await page.pdf({ path: temporal, format: 'A4', printBackground: true, preferCSSPageSize: true });
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
