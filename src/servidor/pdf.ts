import { chromium } from 'playwright';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Cotizacion } from '../negocio/estado';
import type { Montos } from '../negocio/precios';
import { pesos, porcentajeIva } from '../negocio/precios';
import { chromiumPath } from './chromium';
const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export async function plantilla(
  q: Cotizacion,
  numero: number,
  montos: Montos,
  nota = false,
  fecha = new Date().toISOString(),
) {
  const logo = await readFile(join(process.cwd(), 'public/logo-neltume.svg'));
  const titulo = nota ? `NOTA DE PEDIDO N° ${numero}` : `COTIZACIÓN N° ${numero}`;
  const c = q.cliente;
  const campos: [string, string | null][] = nota
    ? [
        ['Nombre', c.nombre],
        ['Rut', c.rut],
        ['Giro', null],
        ['Dirección', c.direccion],
        ['Dirección de Despacho', null],
        ['Ciudad / Comuna', c.comuna],
        ['Medio de Transporte', null],
        ['Contacto Teléfono', c.telefono],
      ]
    : [
        ['Nombre', c.nombre],
        ['Proyecto', c.proyecto],
        ['Ciudad / Comuna', c.comuna],
        ...(c.rut ? [['RUT', c.rut] as [string, string]] : []),
        ...(c.telefono ? [['Teléfono', c.telefono] as [string, string]] : []),
      ];
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${titulo}</title><style>
    @page{size:A4;margin:18mm 15mm}*{box-sizing:border-box}body{font:11px Arial,sans-serif;color:#242a24;margin:0;background:#fff}header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #324536;padding-bottom:22px}header img{width:145px;max-height:75px}h1{font:19px Georgia,serif;margin:0 0 10px}header div{text-align:right}section{margin:23px 0;display:grid;grid-template-columns:1fr 1fr;gap:12px 25px}section div{min-height:15px}b{font-weight:600}table{width:100%;border-collapse:collapse;font-size:10px}thead{display:table-header-group}th{text-align:left;border-top:1px solid #324536;border-bottom:1px solid #324536;padding:10px 5px;font-size:8px}td{padding:12px 5px;border-bottom:1px solid #deded6;vertical-align:top}tr{break-inside:avoid}.num{text-align:right;white-space:nowrap}.codigo{white-space:nowrap;font-size:8px}.totales{width:255px;margin:24px 0 28px auto;break-inside:avoid}.totales p{display:flex;justify-content:space-between}.total{border-top:2px solid #324536;padding-top:12px;font-size:15px}footer{font-size:10px;border-top:1px solid #aaa;padding-top:16px;line-height:1.6;break-inside:avoid}footer p{margin:3px 0}
    </style></head><body><header><img alt="Neltume" src="data:image/svg+xml;base64,${logo.toString('base64')}"><div><h1>${titulo}</h1><span>FECHA: ${new Date(fecha).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })}</span>${nota ? `<p>Ref. cotización N° ${q.numero}</p>` : ''}</div></header>
    <section>${campos.map(([k, v]) => `<div><b>${k}:</b> ${esc(v)}</div>`).join('')}</section>
    <table><thead><tr>${nota ? '' : '<th>ITEM</th>'}<th>CÓDIGO</th><th>DESCRIPCIÓN${nota ? ' PRODUCTO' : ''}</th><th class="num">CANT.</th><th class="num">PRECIO UNIT.</th><th class="num">TOTAL</th></tr></thead><tbody>
    ${montos.lineas.map((l, i) => `<tr>${nota ? '' : `<td>${i + 1}</td>`}<td class="codigo">${esc(l.producto.codigo)}</td><td>${esc(l.producto.descripcion)}</td><td class="num">${l.cantidad}</td><td class="num">${pesos(l.precioUnitario)}</td><td class="num">${pesos(l.total)}</td></tr>`).join('')}</tbody></table>
    <div class="totales"><p><span>SUBTOTAL</span><b>${pesos(montos.neto)}</b></p><p><span>${nota ? 'TOTAL I.V.A.' : 'I.V.A.'} ${porcentajeIva()}</span><b>${pesos(montos.iva)}</b></p><p class="total"><span>TOTAL</span><b>${pesos(montos.total)}</b></p></div>
    <footer>${nota ? '<p><b>GRACIAS</b></p>' : '<p>Valores puestos en fábrica.</p><p>Flete por despacho pendiente: valor según unidades de compra.</p><p>Cotización válida por 10 días hábiles.</p>'}<p>Para preguntas referentes a esta cotización contactarnos a: Neltume.co@gmail.com</p></footer></body></html>`;
}
export async function generarPdf(directorio: string, archivo: string, html: string) {
  await mkdir(join(directorio, 'pdf'), { recursive: true });
  const temporal = join(directorio, 'pdf', `.${randomUUID()}.pdf`);
  const browser = await chromium.launch({ headless: true, executablePath: chromiumPath() });
  try {
    const page = await browser.newPage();
    await page.route('**/*', (route) => route.abort());
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({ path: temporal, format: 'A4', printBackground: true, preferCSSPageSize: true });
    await rename(temporal, join(directorio, 'pdf', archivo));
  } finally {
    await browser.close();
    await rm(temporal, { force: true });
  }
}
