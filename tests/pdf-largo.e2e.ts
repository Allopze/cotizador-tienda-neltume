import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { test, expect } from './fixtures-e2e';
import { accion, rut } from './api-e2e';
import { DIR_E2E, iniciarSesion } from './login-e2e';

// Revisión del PDF de una cotización larga: 25 ítems con nombres y descripciones largas y observaciones extensas.
// Cada página se dibuja a PNG con pdfjs-dist y @napi-rs/canvas (la copia que trae pdfjs) para revisarla a ojo en
// test-results/, y el texto de cada página, con su posición, comprueba que los totales y las firmas no queden
// partidos entre dos páginas ni encima del pie «Página N de M».

const LARGA =
  'Puerta de dos hojas con rebaje perimetral, junquillo moldurado a mano, travesaño intermedio y tablero de doble ' +
  'cara en madera seleccionada, terminación natural con sellador al agua y protección UV para exterior sombreado';

interface Linea {
  texto: string;
  /** Desde arriba de la página, en puntos. */
  y: number;
  /** Borde derecho del texto, en puntos desde la izquierda. */
  derecha: number;
}

test('una cotización de 25 ítems con descripciones largas no corta los totales ni las firmas', async ({ page }) => {
  test.setTimeout(120_000);
  await iniciarSesion(page);
  let q = await accion(page.request, {
    tipo: 'agregar_personalizado',
    item: {
      nombre: `Ítem 1 · ${LARGA.slice(0, 120)}`, familia: 'PUERTA', madera: 'Raulí', descripcion: LARGA.slice(0, 300),
      ancho: 0.9, alto: 2.1, tipoMedida: 'hoja', cantidad: 1, precioUnitario: 150_000, observaciones: LARGA,
    },
  });
  for (let i = 2; i <= 25; i++)
    q = await accion(page.request, {
      tipo: 'agregar_personalizado',
      id: q.id,
      actualizada: q.actualizada,
      item: {
        nombre: `Ítem ${i} · ${LARGA.slice(0, 120)}`, familia: 'PUERTA', madera: 'Raulí', descripcion: LARGA.slice(0, 300),
        ancho: 0.9, alto: 2.1, tipoMedida: 'hoja', cantidad: (i % 4) + 1, precioUnitario: 100_000 + i * 1_000,
        observaciones: i % 3 ? null : LARGA,
      },
    });
  q = await accion(page.request, {
    tipo: 'editar', id: q.id, actualizada: q.actualizada,
    cliente: { nombre: 'Constructora de Prueba con un Nombre Bastante Largo SpA', rut: rut('76999888'), giro: 'Construcción', telefono: '+56 9 1111 2222', direccion: 'Camino a Coñaripe km 12, parcela 4', comuna: 'Panguipulli', proyecto: 'Hostería del lago, segunda etapa' },
    observaciones: `${LARGA}. ${LARGA}. ${LARGA}.`,
    flete: 85_000,
  });
  const emitida = await accion(page.request, { tipo: 'emitir', id: q.id, actualizada: q.actualizada });
  expect(emitida.numero).toBeGreaterThan(0);

  const tarea = getDocument({ data: new Uint8Array(await readFile(`${DIR_E2E}/pdf/cotizacion-${emitida.numero}.pdf`)), useSystemFonts: true });
  const doc = await tarea.promise;
  expect(doc.numPages, 'con 25 ítems el documento ocupa varias páginas').toBeGreaterThan(1);
  await mkdir('test-results/pdf-largo', { recursive: true });
  const paginas: { lineas: Linea[]; alto: number; ancho: number }[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const pagina = await doc.getPage(p);
    const vista = pagina.getViewport({ scale: 1 });
    const contenido = await pagina.getTextContent();
    const lineas = contenido.items
      .filter((i) => 'str' in i && i.str.trim())
      .map((i) => {
        const item = i as { str: string; transform: number[]; width: number };
        return { texto: item.str.trim(), y: vista.height - item.transform[5], derecha: item.transform[4] + item.width };
      });
    paginas.push({ lineas, alto: vista.height, ancho: vista.width });
    // PNG de la página, para la revisión visual.
    const escala = vista.clone({ scale: 1.5 });
    const lienzo = createCanvas(Math.ceil(escala.width), Math.ceil(escala.height));
    await pagina.render({ canvas: lienzo as unknown as HTMLCanvasElement, viewport: escala }).promise;
    const png = await lienzo.encode('png');
    expect(png.length, `página ${p} dibujada`).toBeGreaterThan(10_000);
    await writeFile(`test-results/pdf-largo/pagina-${p}.png`, png);
  }
  await tarea.destroy();

  const dondeEsta = (texto: string | RegExp) =>
    paginas.flatMap((pg, i) =>
      pg.lineas.filter((l) => (typeof texto === 'string' ? l.texto === texto : texto.test(l.texto))).map((l) => ({ pagina: i, ...l })),
    );
  // Los 25 ítems están, cada uno con su línea de código, y numerados del 1 al 26 (la 26 es el flete). La cotización
  // no repite la medida aparte.
  expect(dondeEsta('ESPECIAL')).toHaveLength(25);
  expect(dondeEsta(/^Medida solicitada/)).toHaveLength(0);
  expect(dondeEsta('26')).toHaveLength(1);

  // Totales: subtotal, IVA y total en una misma página.
  const totales = ['Subtotal', 'Total'].map((t) => dondeEsta(t));
  for (const t of totales) expect(t.length).toBeGreaterThanOrEqual(1);
  const paginaTotales = totales[1].at(-1)!.pagina;
  expect(totales[0].at(-1)!.pagina, 'subtotal y total en la misma página').toBe(paginaTotales);
  const iva = dondeEsta(/^IVA /);
  expect(iva.at(-1)?.pagina, 'el IVA junto al total').toBe(paginaTotales);

  // Firmas: el título y los tres rótulos juntos.
  const firmas = [/^Para aceptar esta cotización$/, /^Nombre y RUT$/, /^Firma$/, /^Fecha$/].map((t) => dondeEsta(t));
  for (const [i, f] of firmas.entries()) expect(f.length, `rótulo de firma ${i}`).toBeGreaterThanOrEqual(1);
  const paginaFirmas = firmas[0].at(-1)!.pagina;
  for (const f of firmas) expect(f.at(-1)!.pagina, 'firmas en una sola página').toBe(paginaFirmas);
  expect(paginaFirmas, 'las firmas van después de los totales').toBeGreaterThanOrEqual(paginaTotales);

  // Nada del contenido baja hasta el pie «Página N de M» ni se sale de la hoja.
  for (const [i, pg] of paginas.entries()) {
    const yPie = Math.min(...pg.lineas.filter((l) => /^Página/.test(l.texto)).map((l) => l.y));
    // El pie es una línea: los datos de Neltume y «Página N de M».
    const pie = pg.lineas.filter((l) => Math.abs(l.y - yPie) < 4);
    expect(Number.isFinite(yPie), `pie de la página ${i + 1}`).toBe(true);
    for (const l of pg.lineas) {
      expect(l.y, `«${l.texto}» dentro de la página ${i + 1}`).toBeGreaterThan(0);
      // Los montos alineados a la derecha no se cortan contra el borde de la hoja (margen de 15 mm ≈ 42 pt).
      expect(l.derecha, `«${l.texto}» dentro del margen derecho de la página ${i + 1}`).toBeLessThanOrEqual(pg.ancho - 30);
      if (!pie.includes(l)) expect(l.y, `«${l.texto}» sobre el pie de la página ${i + 1}`).toBeLessThan(yPie - 4);
    }
  }
});
