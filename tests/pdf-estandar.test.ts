import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Catalogo, Producto } from '../src/catalogo/tipos';
import { clienteVacio } from '../src/catalogo/tipos';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { chromiumPath } from '../src/servidor/chromium';
import { prepararEnvio } from '../src/servidor/integracion-pedido';
import { cerrarNavegadorPdf, generarPdf, plantillaPruebaConexion } from '../src/servidor/pdf';
import { Servicio } from '../src/servidor/servicio';

// Conformidad con el estilo común de los documentos (docs/estilo-documentos-v1.md), comprobada sobre los PDF de
// verdad (Chromium + pdfjs-dist), no sobre el HTML. La fábrica lee la nota de pedido con pdfjs, por fragmentos de texto
// y posiciones: las «anclas de lectura» del documento son lo que esta prueba protege. Sin Chrome o Chromium en el
// equipo, la prueba se omite.

const LONGITUD = 14; // Con tantas líneas la nota pasa de una página y repite el encabezado de la tabla.
const ESPECIALES = 1; // Pedidos especiales sin costo de fábrica entre ellas (la séptima línea).
// El primer ítem lleva una descripción larga: la fila crece y la cantidad, que va al centro, se aleja de la referencia.
const DESCRIPCION_LARGA =
  'Puerta Molco de pino oregón con panel liso, terminación natural, bisagras reforzadas y cerradura de embutir incluida en la entrega a obra. Se entrega con marco, tapajuntas y herrajes de acero inoxidable; revisar las medidas en obra antes de fabricar y confirmar el sentido de apertura.';
// Con la dirección configurada, los datos de Neltume del pie no caben en una línea.
const DIRECCION = 'Panguipulli, Región de Los Ríos, Chile';
const MODELOS = [
  'MOLCO',
  'HUILO',
  'RANCO',
  'PALENA',
  'ENCO',
  'FUY',
  'YELCHO',
  'COCHAMO',
  'ENSENADA',
  'RUPANCO',
  'PETROHUE',
  'CALAFQUEN',
];
const puertas: Producto[] = MODELOS.map((modelo, i) => ({
  codigo: `${modelo.slice(0, 3)}-O-3-A`,
  modelo,
  familia: 'PUERTA',
  tipo: 'PUERTA PANEL',
  madera: 'PINO OREGON',
  medida: '0,80 A 0,85',
  anchoMin: 0.8,
  anchoMax: 0.85,
  largo: 2,
  precioNeto: 90_000 + i * 7_500,
  descripcion: `${modelo} PINO OREGON 0,80 A 0,85 MT X 2 MT`,
  filaOrigen: 4 + i,
}));
const marco: Producto = {
  ...puertas[0],
  codigo: 'MAR-O-2X4-B',
  modelo: 'MARCO',
  familia: 'MARCO',
  tipo: 'MARCO',
  medida: '2X4',
  anchoMin: null,
  anchoMax: null,
  largo: 2.1,
  precioNeto: 38_000,
  descripcion: 'MARCO PINO OREGON 2X4 X 2,10 MT',
};
const catalogo: Catalogo = {
  fuente: 'test',
  sha256: 'test',
  fecha: '2026-01-01',
  productos: [...puertas, marco],
};

interface Fragmento {
  s: string;
  x: number;
  /** Línea base, medida desde el borde superior de la hoja. */
  y: number;
  /** Final del texto en x. */
  fin: number;
  tam: number;
}
interface Leido {
  paginas: Fragmento[][];
  fuentes: string[];
  ancho: number;
  bytes: number;
}

async function leer(ruta: string): Promise<Leido> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const archivo = await readFile(ruta);
  const carga = pdfjs.getDocument({ data: new Uint8Array(archivo), useSystemFonts: false });
  const documento = await carga.promise;
  const paginas: Fragmento[][] = [];
  const fuentes = new Set<string>();
  let ancho = 0;
  for (let n = 1; n <= documento.numPages; n++) {
    const pagina = await documento.getPage(n);
    const vista = pagina.getViewport({ scale: 1 });
    ancho = vista.width;
    const contenido = await pagina.getTextContent();
    const items = contenido.items.flatMap((i) =>
      'str' in i && i.str.trim()
        ? [
            {
              s: i.str,
              x: i.transform[4],
              y: vista.height - i.transform[5],
              fin: i.transform[4] + i.width,
              tam: Math.hypot(i.transform[0], i.transform[1]),
            },
          ]
        : [],
    );
    // Orden de lectura: de arriba abajo y, en una misma línea (±3 pt), de izquierda a derecha.
    const lineas: Fragmento[][] = [];
    for (const f of [...items].sort((a, b) => a.y - b.y)) {
      const linea = lineas.find((l) => Math.abs(l[0].y - f.y) <= 3);
      if (linea) linea.push(f);
      else lineas.push([f]);
    }
    paginas.push(lineas.flatMap((l) => l.sort((a, b) => a.x - b.x)));
    const ops = await pagina.getOperatorList();
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] !== pdfjs.OPS.setFont) continue;
      const fuente = await new Promise<{ name: string; isType3Font?: boolean }>((resolver) =>
        pagina.commonObjs.get(ops.argsArray[i][0], resolver),
      );
      fuentes.add(`${fuente.name.replace(/^[A-Z]+\+/, '')}${fuente.isType3Font ? ' (Type3)' : ''}`);
    }
  }
  await carga.destroy();
  return { paginas, fuentes: [...fuentes].sort(), ancho, bytes: archivo.length };
}

const MONTO = /^\$\d{1,3}(\.\d{3})*$/;
const SOLO_DIGITOS = /^\d{1,4}$/;
const FECHA_LARGA = /^\d{1,2} de [a-záéíóú]+ de \d{4}$/;
const FUENTES_DEL_ESTANDAR =
  /^(Fraunces-Medium|InstrumentSans-Regular|InstrumentSans-SemiBold|JetBrainsMono-Regular)$/;
/** Cómo se escribe el número de un documento: «N.º 577». */
const NUMERO = /^N\.º\s*(\d+)$/;

const todos = (l: Leido) => l.paginas.flat();
const misma = (a: Fragmento, b: Fragmento) => Math.abs(a.y - b.y) <= 3;
/** Lo que queda a la derecha de `etiqueta` en su línea, unido: el valor que lee la fábrica. */
const aLaDerecha = (frags: Fragmento[], etiqueta: Fragmento) =>
  frags
    .filter((f) => f !== etiqueta && misma(f, etiqueta) && f.x > etiqueta.x)
    .sort((a, b) => a.x - b.x)
    .map((f) => f.s)
    .join(' ');
const exacto = (frags: Fragmento[], texto: string) => frags.find((f) => f.s === texto);

// No necesita Chromium: se comprueba siempre.
it('las fuentes de pdf-recursos son byte a byte las del estándar (las mismas que usa la fábrica)', async () => {
  const lista = JSON.parse(await readFile(join(process.cwd(), 'docs/estilo-documentos-tokens.json'), 'utf8'))
    .fuentes as { archivo: string; sha256: string }[];
  expect(lista.length).toBe(4);
  for (const { archivo, sha256 } of lista) {
    const contenido = await readFile(join(process.cwd(), 'src/servidor/pdf-recursos/fuentes', archivo));
    expect(createHash('sha256').update(contenido).digest('hex'), archivo).toBe(sha256);
  }
});

describe.skipIf(!chromiumPath())('Conformidad con el estilo común de los documentos (PDF real)', () => {
  let dir = '';
  let cotizacion: Leido;
  let nota: Leido;
  let orden: Leido;
  let prueba: Leido;
  let numeroNota = 0;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'neltume-pdf-estandar-'));
    vi.stubEnv('NELTUME_EMPRESA_NOMBRE', 'Neltume.co');
    vi.stubEnv('NELTUME_EMPRESA_RUT', '77.235.175-5');
    vi.stubEnv('NELTUME_EMPRESA_DIRECCION', DIRECCION);
    vi.stubEnv('NELTUME_EMPRESA_TELEFONO', '+56938603334');
    vi.stubEnv('NELTUME_EMPRESA_WEB', 'www.puertasneltume.cl');
    vi.stubEnv('NELTUME_EMPRESA_CORREO', 'neltume.co@gmail.com');
    const almacen = new Almacen(dir);
    const llm = { interpretar: vi.fn().mockRejectedValue(new Error('Sin IA en este flujo.')) };
    const servicio = new Servicio(catalogo, llm as never, almacen, {
      nombre: 'Paula Soto',
      email: 'paula@neltume.cl',
      admin: true,
    } as never);
    let q = (
      await servicio.ejecutar({
        tipo: 'agregar_producto',
        codigo: puertas[0].codigo,
        cantidad: 2,
        ancho: 0.82,
        alto: 2,
        tipoMedida: 'hoja',
      } as never)
    ).cotizacion;
    const ir = async (accion: Record<string, unknown>) =>
      (q = (await servicio.ejecutar({ ...accion, id: q.id, actualizada: q.actualizada } as never))
        .cotizacion);
    for (let i = 1; i < LONGITUD; i++) {
      // Cada séptima línea es un pedido especial sin costo de fábrica («Por definir»); el resto, del catálogo.
      if (i % 7 === 0)
        await ir({
          tipo: 'agregar_personalizado',
          item: {
            nombre: `Puerta según diseño del cliente ${i}`,
            familia: 'PUERTA',
            madera: 'Roble',
            ancho: 0.9,
            alto: 2.1,
            tipoMedida: 'vano',
            cantidad: 1,
            precioUnitario: 300_000,
          },
        });
      else if (i % 5 === 0)
        await ir({ tipo: 'agregar_producto', codigo: marco.codigo, cantidad: 2 + (i % 4) });
      else
        await ir({
          tipo: 'agregar_producto',
          codigo: puertas[i % puertas.length].codigo,
          cantidad: 1 + (i % 3),
          ancho: 0.8 + (i % 5) * 0.01,
          alto: 2,
          tipoMedida: i % 2 ? 'hoja' : 'vano',
        });
    }
    await ir({
      tipo: 'editar',
      cliente: {
        ...clienteVacio(),
        nombre: 'Constructora Ejemplo SpA',
        rut: '76.543.210-3',
        telefono: '+56 9 1111 2222',
        direccion: 'Av. Siempre Viva 123',
        comuna: 'Valdivia',
        proyecto: 'Edificio Los Robles',
      },
      items: [{ indice: 0, cambios: { descripcion: DESCRIPCION_LARGA } }],
      observaciones: 'Entregar en obra.',
    });
    await ir({ tipo: 'emitir' });
    await ir({
      tipo: 'aprobar',
      despacho: {
        direccion: 'Camino a Niebla km 3',
        transporte: 'Starken',
        entregaComprometida: '15-11-2026',
      },
    });
    await ir({ tipo: 'pago', monto: Math.ceil(q.montos.total / 2) });
    await ir({
      tipo: 'generar_nota',
      asignaciones: q.montos.lineas.map((_, indice) => ({ indice, fabrica: 'panguipulli' })),
    });
    const nuestra = q.notas[0];
    numeroNota = nuestra.numero;
    const envio = await prepararEnvio(q, nuestra, { db: almacen.baseDatos() });
    await generarPdf(join(dir, 'ot'), 'orden.pdf', envio.htmlProduccion, undefined, {
      logoDe: almacen.baseDatos(),
    });
    const html = await plantillaPruebaConexion(
      {
        eventId: '3f9a12bc-0000-4000-8000-000000000000',
        fecha: new Date('2026-10-25T18:00:00Z'),
        emisor: 'Tienda',
        destino: 'Fábrica Panguipulli',
      },
      almacen.baseDatos(),
    );
    await generarPdf(join(dir, 'prueba'), 'prueba.pdf', html, undefined, { logoDe: almacen.baseDatos() });
    cotizacion = await leer(join(dir, 'pdf', q.pdf!));
    nota = await leer(join(dir, 'pdf', nuestra.pdf));
    orden = await leer(join(dir, 'ot', 'pdf', 'orden.pdf'));
    prueba = await leer(join(dir, 'prueba', 'pdf', 'prueba.pdf'));
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
  }, 180_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await cerrarNavegadorPdf();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('todos los documentos usan solo las fuentes del estándar, incrustadas y sin Type 3', () => {
    for (const documento of [cotizacion, nota, orden, prueba]) {
      expect(documento.fuentes.length).toBeGreaterThan(0);
      for (const fuente of documento.fuentes)
        expect(fuente, 'fuente fuera del estándar').toMatch(FUENTES_DEL_ESTANDAR);
    }
    // Los códigos que van solos en su línea (la cotización y el código de la prueba) van en mono; el resto, no.
    expect(cotizacion.fuentes).toContain('JetBrainsMono-Regular');
    expect(prueba.fuentes).toContain('JetBrainsMono-Regular');
    expect(nota.fuentes).not.toContain('JetBrainsMono-Regular');
  });

  it('los márgenes del estándar: 14 mm a cada lado', () => {
    const margen = (14 / 25.4) * 72;
    for (const documento of [cotizacion, nota, orden, prueba])
      for (const f of todos(documento).filter((f) => f.tam >= 7.5)) {
        expect(f.x, f.s).toBeGreaterThanOrEqual(margen - 1);
        expect(f.fin, f.s).toBeLessThanOrEqual(documento.ancho - margen + 1);
      }
  });

  it('el pie de cada página va a 7,5 pt; si los datos de Neltume no caben en una línea, el número queda en la última', () => {
    for (const documento of [cotizacion, nota, orden, prueba])
      documento.paginas.forEach((frags, i) => {
        const pagina = frags.find((f) => f.s === `Página ${i + 1} de ${documento.paginas.length}`);
        expect(pagina, `pie de la página ${i + 1}`).toBeDefined();
        expect(pagina!.tam).toBeCloseTo(7.5, 1);
        // Nada va más abajo que «Página n de m».
        expect(Math.max(...frags.map((f) => f.y)), `pie de la página ${i + 1}`).toBeLessThanOrEqual(
          pagina!.y + 1,
        );
      });
    // Con la dirección, los datos de la empresa llevan dos líneas: la primera queda sobre la del número de página.
    for (const documento of [cotizacion, nota, orden]) {
      const pagina = todos(documento).find((f) => f.s.startsWith('Página 1 de'))!;
      const datos = todos(documento).filter((f) => f.y > pagina.y - 14 && f.y < pagina.y - 4);
      expect(datos.map((f) => f.s).join(' ')).toContain(DIRECCION);
    }
  });

  it('el archivo no pasa de 5 MiB ni de 20 páginas (límites del lector de la fábrica)', () => {
    for (const documento of [cotizacion, nota, orden, prueba]) {
      expect(documento.bytes).toBeLessThanOrEqual(5 * 1024 * 1024);
      expect(documento.paginas.length).toBeLessThanOrEqual(20);
    }
  });

  describe('anclas de lectura de la nota de pedido (las lee la fábrica)', () => {
    it('«Nota de pedido» y su número: el número es el fragmento que sigue al tipo, sin texto de la columna izquierda entre los dos', () => {
      const frags = todos(nota);
      const i = frags.findIndex((f) => f.s === 'Nota de pedido');
      expect(i).toBeGreaterThanOrEqual(0);
      // La fábrica admite hasta 3 fragmentos entre el tipo y el número; el estándar no deja ninguno.
      expect(frags[i + 1].s.match(NUMERO)?.[1]).toBe(String(numeroNota));
      // Tipo sobre número, en dos líneas: el número está más abajo que el tipo.
      expect(frags[i + 1].y).toBeGreaterThan(frags[i].y);
    });

    it('una nota vigente no lleva el texto «ANULADA»', () => {
      expect(todos(nota).filter((f) => /ANULAD/i.test(f.s))).toEqual([]);
    });

    it('«Fábrica X», «Cotización» y «Despacho» son fragmentos exactos; el valor de los dos últimos va justo debajo', () => {
      const frags = todos(nota);
      expect(exacto(frags, 'Fábrica Panguipulli')).toBeDefined();
      for (const etiqueta of ['Cotización', 'Despacho']) {
        const e = exacto(frags, etiqueta)!;
        expect(e, etiqueta).toBeDefined();
        const debajo = frags
          .filter((f) => f.y > e.y + 3 && f.y < e.y + 24 && Math.abs(f.x - e.x) <= 15)
          .sort((a, b) => a.y - b.y)[0];
        expect(debajo, `valor bajo «${etiqueta}»`).toBeDefined();
      }
      expect(exacto(frags, 'Cotización')).toBeDefined();
    });

    it('la fecha en palabras es un fragmento entero y la primera sobre la tabla', () => {
      const frags = todos(nota);
      const encabezado = frags.find((f) => f.s === 'Cant.')!;
      const primera = frags.find((f) => FECHA_LARGA.test(f.s))!;
      expect(primera).toBeDefined();
      expect(primera.y).toBeLessThan(encabezado.y);
    });

    it('«Cant.» y «Precio fábrica» comparten línea; el encabezado repetido va en una sola línea por página', () => {
      expect(nota.paginas.length).toBeGreaterThan(1);
      let conEncabezado = 0;
      nota.paginas.forEach((frags) => {
        const cant = frags.filter((f) => f.s === 'Cant.');
        const precio = frags.filter((f) => f.s === 'Precio fábrica');
        expect(cant.length).toBeLessThanOrEqual(1);
        expect(precio.length).toBe(cant.length);
        if (cant.length) {
          conEncabezado++;
          expect(misma(cant[0], precio[0])).toBe(true);
          expect(frags.filter((f) => misma(f, cant[0]) && f.s === 'Total').length).toBe(1);
        }
      });
      expect(conEncabezado).toBe(nota.paginas.filter((p) => p.some((f) => f.s === 'Cant.')).length);
      expect(conEncabezado).toBeGreaterThan(1);
    });

    it('cada ítem: cantidad de solo dígitos a menos de 20 pt de «Cant.», y sus montos en la misma línea base', () => {
      let items = 0;
      nota.paginas.forEach((frags) => {
        const cant = frags.find((f) => f.s === 'Cant.');
        if (!cant) return;
        const filas = frags.filter(
          (f) => SOLO_DIGITOS.test(f.s) && f.y > cant.y && Math.abs(f.x - cant.x) < 20 && f.tam > 8.5,
        );
        for (const cantidad of filas) {
          items++;
          const linea = frags.filter((f) => misma(f, cantidad) && f.x > cantidad.x).map((f) => f.s);
          const montos = linea.filter((s) => MONTO.test(s));
          // Un pedido especial sin costo de fábrica va «Por definir» (dos veces); el resto, unitario y total.
          if (linea.includes('Por definir')) expect(linea.filter((s) => s === 'Por definir').length).toBe(2);
          else expect(montos.length, `montos de la línea de ${cantidad.s}`).toBeGreaterThanOrEqual(2);
        }
      });
      expect(items).toBe(LONGITUD);
    });

    it('«Referencia de catálogo: CÓDIGO» es un fragmento entero; el pedido especial no la lleva', () => {
      const frags = todos(nota);
      const referencias = frags.filter((f) => f.s.startsWith('Referencia de catálogo: '));
      expect(referencias.length).toBe(LONGITUD - ESPECIALES);
      for (const r of referencias) expect(r.s).toMatch(/^Referencia de catálogo: [A-Z0-9]+-[A-Z0-9-]+ · /);
      expect(frags.filter((f) => f.s === 'Producto personalizado, fuera de catálogo').length).toBe(
        ESPECIALES,
      );
    });

    it('descripción: sobre la cantidad, a la x de la referencia, solo va el nombre del ítem; la referencia queda cerca de la cantidad', () => {
      const referencias = todos(nota).filter((f) => f.s.startsWith('Referencia de catálogo: '));
      const xReferencia = referencias[0].x;
      let filas = 0;
      nota.paginas.forEach((frags) => {
        const cant = frags.find((f) => f.s === 'Cant.');
        if (!cant) return;
        const cantidades = frags.filter(
          (f) => SOLO_DIGITOS.test(f.s) && f.y > cant.y && Math.abs(f.x - cant.x) < 20 && f.tam > 8.5,
        );
        for (const cantidad of cantidades) {
          // Solo los ítems con referencia de catálogo (el especial no la lleva y la fábrica no lo lee).
          const referencia = frags.filter(
            (f) => f.s.startsWith('Referencia de catálogo: ') && f.y > cantidad.y,
          )[0];
          if (!referencia || referencia.y - cantidad.y > 60) continue;
          filas++;
          // Requisito del lector de la fábrica (F22): la cantidad a ≤ 120 pt sobre la referencia del ítem y por debajo de la
          // referencia del ítem anterior de la misma página.
          expect(referencia.y - cantidad.y, `referencia bajo la cantidad ${cantidad.s}`).toBeLessThanOrEqual(
            120,
          );
          const anterior = frags
            .filter((f) => f.s.startsWith('Referencia de catálogo: ') && f.y < cantidad.y)
            .pop();
          if (anterior)
            expect(cantidad.y, `cantidad ${cantidad.s} bajo la referencia anterior`).toBeGreaterThan(
              anterior.y,
            );
          // «El fragmento más alto a esa x, dentro de 20 pt sobre la cantidad» es el nombre del ítem (9,6 pt), no la
          // referencia del ítem anterior.
          const ventana = frags
            .filter((f) => Math.abs(f.x - xReferencia) <= 3 && f.y < cantidad.y && f.y >= cantidad.y - 20)
            .sort((a, b) => a.y - b.y);
          expect(ventana.length, `descripción sobre la cantidad ${cantidad.s}`).toBeGreaterThan(0);
          expect(ventana[0].tam).toBeGreaterThanOrEqual(9.5);
          expect(ventana.some((f) => f.s.startsWith('Referencia de catálogo: '))).toBe(false);
        }
      });
      expect(filas).toBe(LONGITUD - ESPECIALES);
    });

    it('Neto, Total, Entrega comprometida, Dirección de despacho y Transporte: el valor es todo lo que queda a la derecha', () => {
      const ultima = nota.paginas[nota.paginas.length - 1];
      const valor = (frags: Fragmento[], etiqueta: string) => {
        const e = frags.filter((f) => f.s === etiqueta).pop()!;
        expect(e, etiqueta).toBeDefined();
        return aLaDerecha(frags, e);
      };
      expect(valor(ultima, 'Neto')).toMatch(MONTO);
      expect(valor(ultima, 'Total')).toMatch(MONTO);
      expect(valor(ultima, 'Entrega comprometida')).toBe('15-11-2026');
      const primera = nota.paginas[0];
      expect(valor(primera, 'Dirección de despacho')).toBe('Camino a Niebla km 3');
      expect(valor(primera, 'Transporte')).toBe('Starken');
      // «Total» y su cifra grande comparten línea base (±3 pt), aunque la cifra sea de 22 pt y la etiqueta de 12.
      const total = ultima.filter((f) => f.s === 'Total').pop()!;
      const cifra = ultima.find((f) => MONTO.test(f.s) && misma(f, total) && f.x > total.x)!;
      expect(cifra.tam).toBeGreaterThan(total.tam);
    });
  });

  it('la orden de trabajo no lleva precios, ni datos del cliente, ni nombres del personal, y muestra su número', () => {
    const frags = todos(orden);
    const texto = frags.map((f) => f.s).join(' ');
    expect(texto).not.toMatch(/\$\s*\d/);
    expect(texto).not.toMatch(/Constructora Ejemplo|76\.543\.210-3|1111 2222|Paula|Aprobada por|Emitida por/);
    const i = frags.findIndex((f) => f.s === 'Orden de trabajo');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(frags[i + 1].s.match(NUMERO)?.[1]).toBe(String(numeroNota));
    // La obra y el despacho sí van.
    expect(texto).toContain('Edificio Los Robles');
    expect(texto).toContain('Camino a Niebla km 3');
  });

  it('la cotización y la prueba de conexión siguen el mismo encabezado: tipo, número y fecha en palabras', () => {
    for (const [documento, tipo] of [
      [cotizacion, 'Cotización'],
      [prueba, 'Prueba de conexión'],
    ] as const) {
      const frags = todos(documento);
      expect(exacto(frags, tipo), tipo).toBeDefined();
      expect(frags.some((f) => FECHA_LARGA.test(f.s)) || tipo === 'Prueba de conexión').toBe(true);
    }
    expect(todos(prueba).some((f) => f.s === 'PRUEBA')).toBe(true);
  });
});
