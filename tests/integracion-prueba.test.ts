import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seccionesVisibles } from '../src/app/ajustes/secciones';
import { codigoPrueba, fechaPrueba, textoConfiguracion, textoDireccion, textoResultadoPrueba } from '../src/app/ajustes/conexion';
import { fechaHoraChile } from '../src/negocio/vigencia';
import { abrirBaseDatos, cerrarBaseDatos } from '../src/servidor/base-datos';
import { chromiumPath } from '../src/servidor/chromium';
import { ErrorPdf } from '../src/servidor/errores';
import { configuracionFabrica, detalleConfiguracion, secretoFabrica } from '../src/servidor/integracion-configuracion';
import { mensajePruebaSchema } from '../src/servidor/integracion-contrato';
import { firmar, verificarFirma } from '../src/servidor/integracion-firma';
import { guardarPrueba, leerPdfPrueba, listarPruebas, motivoPdfInvalido, PRUEBAS_CONSERVADAS } from '../src/servidor/integracion-prueba';
import { enviarPrueba, diagnosticarRespuesta, PLAZO_PRUEBA_MS } from '../src/servidor/integracion-prueba-envio';
import { nuevoTope, recibirPrueba, type OpcionesRecepcion } from '../src/servidor/integracion-prueba-recepcion';
import { pruebasAntiguas, purgarPruebas } from '../src/servidor/limpieza';

// La prueba de conexión con la fábrica (docs/integracion-fabrica.md, «Prueba de conexión»): lo que la tienda recibe de la
// fábrica (ruta firmada, sin sesión), lo que envía desde Ajustes y la persistencia de ambos. La fábrica se simula con
// `fetch`; el PDF real (Chromium + pdfjs) se prueba en su propio bloque.

const pdfReal = vi.hoisted(() => ({ activo: false, falla: null as Error | null }));
vi.mock('../src/servidor/pdf', async (original) => {
  const real = await original<typeof import('../src/servidor/pdf')>();
  return {
    ...real,
    generarPdf: vi.fn(async (directorio: string, archivo: string, html: string, ...resto: unknown[]) => {
      if (pdfReal.falla) throw pdfReal.falla;
      if (pdfReal.activo) return (real.generarPdf as (...a: unknown[]) => Promise<void>)(directorio, archivo, html, ...resto);
      await mkdir(join(directorio, 'pdf'), { recursive: true });
      await writeFile(join(directorio, 'pdf', archivo), pdfMinimo(), { flag: 'wx' });
    }),
  };
});

const SECRETO = 'secreto-de-prueba-compartido-con-fabrica-0123456789';
const URL_FABRICA = 'https://fabrica-panguipulli.test';
const ENV = { NELTUME_FABRICA_PANGUIPULLI_URL: URL_FABRICA, NELTUME_FABRICA_PANGUIPULLI_SECRETO: SECRETO };
const RUTA = '/api/integrations/neltume/connection-tests';
const AHORA = new Date('2026-10-25T15:00:00.000Z');
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** Un PDF mínimo pero íntegro: cabecera, tres objetos, tabla xref con sus desplazamientos exactos y cola. */
function pdfMinimo(relleno = 0) {
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>${' '.repeat(relleno)}`,
  ];
  let texto = '%PDF-1.4\n';
  const desplazamientos = objetos.map((o, i) => {
    const d = texto.length;
    texto += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return d;
  });
  const xref = texto.length;
  texto += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${desplazamientos.map((d) => `${String(d).padStart(10, '0')} 00000 n \n`).join('')}`;
  texto += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(texto, 'latin1');
}

/** Un PDF íntegro de exactamente `bytes` bytes (el largo de `startxref` cambia con el relleno: se ajusta). */
function pdfDeTamano(bytes: number) {
  let relleno = bytes - pdfMinimo().length;
  for (let i = 0; i < 10; i++) {
    const pdf = pdfMinimo(relleno);
    if (pdf.length === bytes) return pdf;
    relleno -= pdf.length - bytes;
  }
  throw new Error(`No se pudo armar un PDF de ${bytes} bytes.`);
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  pdfReal.activo = false;
  pdfReal.falla = null;
});
afterAll(async () => (await import('../src/servidor/pdf')).cerrarNavegadorPdf());

const dirs: string[] = [];
async function baseTemporal() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-prueba-conexion-'));
  dirs.push(dir);
  const ruta = join(dir, 'cotizador.sqlite');
  const db = abrirBaseDatos(ruta);
  return { dir, ruta, db };
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    cerrarBaseDatos(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

interface FilaPrueba {
  id: number;
  direccion: string;
  fabrica: string;
  evento_id: string;
  clave_idempotencia: string;
  fecha: string;
  resultado: string;
  http: number | null;
  codigo: string | null;
  detalle: string | null;
  latencia_ms: number | null;
  actor: string | null;
  archivo: string;
  bytes: number;
  sha256: string;
  cuerpo_sha256: string | null;
  pdf: Buffer | null;
}
const filas = (db: ReturnType<typeof abrirBaseDatos>) =>
  db.prepare('SELECT * FROM integracion_pruebas ORDER BY id').all() as FilaPrueba[];

// ── Recepción ────────────────────────────────────────────────────────────────────────────────────────────────

interface Sobre {
  schemaVersion: unknown;
  eventType: unknown;
  eventId: string;
  source: unknown;
  factoryCode: unknown;
  issuedAt: unknown;
  document: Record<string, unknown>;
  [extra: string]: unknown;
}

/** El cuerpo que enviaría la fábrica, con `cambios` encima. */
function cuerpoFabrica(cambios: Partial<Sobre> = {}, pdf: Buffer = pdfMinimo()): Sobre {
  const eventId = cambios.eventId ?? randomUUID();
  return {
    schemaVersion: '1.0',
    eventType: 'connection.test',
    eventId,
    source: 'neltume-factory',
    factoryCode: 'PANGUIPULLI',
    issuedAt: AHORA.toISOString(),
    document: {
      filename: `prueba-conexion-${eventId.slice(0, 8)}.pdf`,
      mimeType: 'application/pdf',
      contentBase64: pdf.toString('base64'),
      sha256: sha(pdf),
    },
    ...cambios,
  };
}

interface OpcionesPeticion {
  secreto?: string;
  /** Instante con que se firma. */
  firmadoEn?: Date;
  cabeceras?: Record<string, string | null>;
  /** Bytes que viajan, si no son los del cuerpo firmado. */
  bytes?: Buffer;
  /** Bytes que se firman, si no son JSON de `cuerpo` (p. ej. un cuerpo que no es JSON). */
  firmar?: Buffer;
  metodo?: string;
}

/** La solicitud firmada de la fábrica a la tienda. */
function peticion(cuerpo: Sobre, o: OpcionesPeticion = {}) {
  const firmados = o.firmar ?? Buffer.from(JSON.stringify(cuerpo));
  const cabeceras: Record<string, string> = {
    host: '127.0.0.1:3001',
    'content-type': 'application/json',
    'x-idempotency-key': `neltume-factory:connection-test:${cuerpo.eventId}`,
    ...Object.fromEntries(
      Object.entries(firmar(o.secreto ?? SECRETO, firmados, (o.firmadoEn ?? AHORA).getTime())).map(([k, v]) => [k.toLowerCase(), v]),
    ),
  };
  for (const [k, v] of Object.entries(o.cabeceras ?? {})) {
    if (v === null) delete cabeceras[k];
    else cabeceras[k] = v;
  }
  return new Request(`http://127.0.0.1:3001${RUTA}`, { method: o.metodo ?? 'POST', headers: cabeceras, body: new Uint8Array(o.bytes ?? firmados) });
}

async function montarRecepcion(
  env: Record<string, string | undefined> = { NELTUME_FABRICA_PANGUIPULLI_SECRETO: SECRETO },
  extra: Partial<OpcionesRecepcion> = {},
) {
  const t = await baseTemporal();
  // Cada prueba lleva su propio tope de rechazos anotados: el del proceso se comparte entre todas.
  const tope = nuevoTope();
  const recibir = (req: Request) => recibirPrueba(req, { env, db: t.db, ahora: () => AHORA, tope, ...extra });
  return { ...t, recibir, tope };
}

/** La solicitud de la fábrica con un cuerpo que llega como flujo (y no de una vez), como en un servidor de verdad. */
function peticionConFlujo(cuerpo: ReadableStream<Uint8Array>, cabeceras: Record<string, string> = {}) {
  return new Request(`http://127.0.0.1:3001${RUTA}`, {
    method: 'POST',
    headers: {
      host: '127.0.0.1:3001',
      'content-type': 'application/json',
      'x-neltume-timestamp': String(Math.floor(AHORA.getTime() / 1000)),
      'x-neltume-signature': `v1=${'0'.repeat(64)}`,
      ...cabeceras,
    },
    body: cuerpo,
    duplex: 'half',
  } as RequestInit);
}
/** Un flujo que entrega un trozo y después se queda callado (nunca termina). */
const flujoColgado = () => new ReadableStream<Uint8Array>({ start: (c) => c.enqueue(new Uint8Array(16).fill(0x20)) });
const error = async (r: Response) => ((await r.json()) as { error: { code: string; message: string } }).error;

describe('Prueba de conexión: lo que la tienda recibe de la fábrica', () => {
  it('guarda el PDF y recién entonces responde 201 con la app que contesta', async () => {
    const t = await montarRecepcion();
    const pdf = pdfMinimo();
    const cuerpo = cuerpoFabrica({}, pdf);
    const r = await t.recibir(peticion(cuerpo));
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ status: 'accepted', eventId: cuerpo.eventId, receiver: 'neltume-store', receivedAt: AHORA.toISOString() });
    expect(r.headers.get('cache-control')).toBe('no-store');
    const [fila, ...otras] = filas(t.db);
    expect(otras).toEqual([]);
    expect(fila).toMatchObject({
      direccion: 'recibida',
      fabrica: 'panguipulli',
      evento_id: cuerpo.eventId,
      clave_idempotencia: `neltume-factory:connection-test:${cuerpo.eventId}`,
      fecha: AHORA.toISOString(),
      resultado: 'recibida',
      archivo: `prueba-conexion-${cuerpo.eventId.slice(0, 8)}.pdf`,
      bytes: pdf.length,
      sha256: sha(pdf),
      actor: null,
    });
    expect(fila.pdf!.equals(pdf)).toBe(true);
    // Lo que se audita no incluye el secreto.
    expect(JSON.stringify({ ...fila, pdf: null })).not.toContain(SECRETO);
  });

  it('el mismo mensaje otra vez es un duplicado (200) y no crea otra fila; con otro contenido es un conflicto (409)', async () => {
    const t = await montarRecepcion();
    const cuerpo = cuerpoFabrica();
    expect((await t.recibir(peticion(cuerpo))).status).toBe(201);
    const otra = await t.recibir(peticion(cuerpo));
    expect(otra.status).toBe(200);
    expect(await otra.json()).toMatchObject({ status: 'duplicate', eventId: cuerpo.eventId, receiver: 'neltume-store', receivedAt: AHORA.toISOString() });
    expect(filas(t.db)).toHaveLength(1);

    const conflicto = await t.recibir(peticion({ ...cuerpo, issuedAt: '2026-10-25T15:00:01.000Z' }));
    expect(conflicto.status).toBe(409);
    expect((await error(conflicto)).code).toBe('idempotency_conflict');
    expect(filas(t.db)).toHaveLength(1);
  });

  describe('firma: 401 sin tocar la base ni decir por qué', () => {
    const casos: [string, (c: Sobre) => OpcionesPeticion][] = [
      ['con otro secreto', () => ({ secreto: 'otro-secreto-de-prueba-que-no-es-el-de-la-fabrica-123' })],
      ['con un timestamp 301 s en el pasado', () => ({ firmadoEn: new Date(AHORA.getTime() - 301_000) })],
      ['con un timestamp 301 s en el futuro', () => ({ firmadoEn: new Date(AHORA.getTime() + 301_000) })],
      ['sin cabecera de firma', () => ({ cabeceras: { 'x-neltume-signature': null } })],
      ['sin cabecera de timestamp', () => ({ cabeceras: { 'x-neltume-timestamp': null } })],
      ['con un cuerpo distinto del firmado', (c) => ({ bytes: Buffer.from(JSON.stringify({ ...c, factoryCode: 'SANTIAGO' })) })],
      ['con una firma que no es hexadecimal', () => ({ cabeceras: { 'x-neltume-signature': 'v1=zzzz' } })],
    ];
    for (const [nombre, armar] of casos)
      it(nombre, async () => {
        const t = await montarRecepcion();
        const cuerpo = cuerpoFabrica();
        const r = await t.recibir(peticion(cuerpo, armar(cuerpo)));
        expect(r.status).toBe(401);
        expect(await error(r)).toEqual({ code: 'invalid_signature', message: 'Firma o timestamp inválidos.' });
        expect(filas(t.db)).toEqual([]);
      });

    it('con 300 s de diferencia todavía vale', async () => {
      const t = await montarRecepcion();
      expect((await t.recibir(peticion(cuerpoFabrica(), { firmadoEn: new Date(AHORA.getTime() - 300_000) }))).status).toBe(201);
    });

    it('una firma válida entre varias separadas por coma vale (rotación del secreto)', async () => {
      const t = await montarRecepcion();
      const cuerpo = cuerpoFabrica();
      const buena = firmar(SECRETO, Buffer.from(JSON.stringify(cuerpo)), AHORA.getTime())['X-Neltume-Signature'];
      const r = await t.recibir(peticion(cuerpo, { cabeceras: { 'x-neltume-signature': `v1=${'0'.repeat(64)},${buena}` } }));
      expect(r.status).toBe(201);
    });

    const sinSecreto = (i: number) => ({ secreto: `secreto-incorrecto-numero-${i}-de-bastantes-caracteres` });

    it('quien no tiene el secreto no llena la base ni el registro: los rechazos no guardan nada y se anotan con tope', async () => {
      const t = await montarRecepcion();
      for (let i = 0; i < 60; i++) await t.recibir(peticion(cuerpoFabrica(), sinSecreto(i)));
      expect(filas(t.db)).toEqual([]);
      // 20 anotadas y un aviso de que se omiten las siguientes: 21 líneas, no 60.
      const lineas = vi.mocked(console.warn).mock.calls.map((c) => String(c[0]));
      expect(lineas).toHaveLength(21);
      expect(lineas.slice(0, 20).every((l) => l.includes('401 invalid_signature (firma_invalida)'))).toBe(true);
      expect(lineas[20]).toMatch(/hay más rechazos por minuto de los que se anotan/);
      expect(JSON.stringify(lineas)).not.toContain(SECRETO);
    });

    it('el ruido sin firma no esconde el rechazo de un mensaje bien firmado: cada grupo tiene su cupo', async () => {
      const t = await montarRecepcion();
      for (let i = 0; i < 30; i++) await t.recibir(peticion(cuerpoFabrica(), sinSecreto(i)));
      vi.mocked(console.warn).mockClear();
      const r = await t.recibir(peticion(cuerpoFabrica({ factoryCode: 'SANTIAGO' })));
      expect(r.status).toBe(422);
      expect(vi.mocked(console.warn).mock.calls.map((c) => String(c[0]))).toEqual([
        '[integracion] prueba de conexión rechazada: 422 destination_mismatch (La fábrica del mensaje no es la del secreto que lo firmó.)',
      ]);
      // Y lo firmado tiene su propio tope (60 por minuto).
      vi.mocked(console.warn).mockClear();
      for (let i = 0; i < 70; i++) await t.recibir(peticion(cuerpoFabrica({ factoryCode: 'SANTIAGO' })));
      expect(vi.mocked(console.warn).mock.calls).toHaveLength(60);
    });

    it('cada minuto se reabre el cupo de líneas de registro', async () => {
      const t = await baseTemporal();
      const tope = nuevoTope();
      let reloj = AHORA.getTime();
      const recibir = (req: Request) =>
        recibirPrueba(req, { env: { NELTUME_FABRICA_PANGUIPULLI_SECRETO: SECRETO }, db: t.db, ahora: () => new Date(reloj), tope });
      for (let i = 0; i < 25; i++) await recibir(peticion(cuerpoFabrica(), sinSecreto(i)));
      expect(vi.mocked(console.warn).mock.calls).toHaveLength(21);
      reloj += 59_000;
      await recibir(peticion(cuerpoFabrica(), sinSecreto(99)));
      expect(vi.mocked(console.warn).mock.calls).toHaveLength(21);
      reloj += 2_000;
      await recibir(peticion(cuerpoFabrica(), sinSecreto(100)));
      expect(vi.mocked(console.warn).mock.calls).toHaveLength(22);
    });

    it('con una firma inválida responde 401 aunque el cuerpo ni siquiera sea JSON: la firma va antes que el JSON', async () => {
      const t = await montarRecepcion();
      const r = await t.recibir(peticion(cuerpoFabrica(), { firmar: Buffer.from('esto no es json'), ...sinSecreto(1) }));
      expect(r.status).toBe(401);
      expect((await error(r)).code).toBe('invalid_signature');
    });
  });

  describe('antes de la firma', () => {
    it('503 not_configured con Retry-After si no hay secreto (o es demasiado corto)', async () => {
      for (const env of [{}, { NELTUME_FABRICA_PANGUIPULLI_SECRETO: 'corto' }, { NELTUME_FABRICA_PANGUIPULLI_SECRETO: '  ' }]) {
        const t = await montarRecepcion(env);
        const r = await t.recibir(peticion(cuerpoFabrica()));
        expect(r.status).toBe(503);
        expect(r.headers.get('retry-after')).toBe('300');
        expect((await error(r)).code).toBe('not_configured');
        expect(filas(t.db)).toEqual([]);
      }
    });

    it('para recibir basta el secreto: no hace falta la URL de la fábrica', async () => {
      const t = await montarRecepcion({ NELTUME_FABRICA_PANGUIPULLI_SECRETO: SECRETO });
      expect(configuracionFabrica('panguipulli', { NELTUME_FABRICA_PANGUIPULLI_SECRETO: SECRETO })).toBeNull();
      expect((await t.recibir(peticion(cuerpoFabrica()))).status).toBe(201);
    });

    it('415 si el Content-Type no es JSON', async () => {
      const t = await montarRecepcion();
      const r = await t.recibir(peticion(cuerpoFabrica(), { cabeceras: { 'content-type': 'text/plain' } }));
      expect(r.status).toBe(415);
      expect((await error(r)).code).toBe('unsupported_media_type');
      const conCharset = await t.recibir(peticion(cuerpoFabrica(), { cabeceras: { 'content-type': 'application/json; charset=utf-8' } }));
      expect(conCharset.status).toBe(201);
    });

    it('413 si el cuerpo pasa de 2 MiB, también leído sin Content-Length, y antes de mirar la firma', async () => {
      const t = await montarRecepcion();
      const grande = Buffer.alloc(2 * 1024 * 1024 + 1, 0x20);
      const leido = await t.recibir(peticion(cuerpoFabrica(), { firmar: grande, secreto: 'otro-secreto-de-prueba-que-no-es-el-de-la-fabrica-123' }));
      expect(leido.status).toBe(413);
      expect((await error(leido)).code).toBe('payload_too_large');
      const declarado = await t.recibir(peticion(cuerpoFabrica(), { cabeceras: { 'content-length': String(3 * 1024 * 1024) } }));
      expect(declarado.status).toBe(413);
      const justo = Buffer.alloc(2 * 1024 * 1024, 0x20);
      // En el tope exacto sigue leyendo (y falla después, por no ser JSON).
      expect((await t.recibir(peticion(cuerpoFabrica(), { firmar: justo }))).status).toBe(400);
      expect(filas(t.db)).toEqual([]);
    });

    it('el tope declarado es de 2 MiB exactos: 2 MiB pasa y un byte más es 413', async () => {
      const t = await montarRecepcion();
      expect((await t.recibir(peticion(cuerpoFabrica(), { cabeceras: { 'content-length': String(2 * 1024 * 1024) } }))).status).toBe(201);
      const pasado = await t.recibir(peticion(cuerpoFabrica(), { cabeceras: { 'content-length': String(2 * 1024 * 1024 + 1) } }));
      expect(pasado.status).toBe(413);
    });

    it('deja de leer en cuanto pasa el tope: no consume el resto de un cuerpo enorme', async () => {
      const t = await montarRecepcion();
      let entregados = 0;
      const trozo = new Uint8Array(64 * 1024).fill(0x20);
      const flujo = new ReadableStream<Uint8Array>({
        pull(c) {
          entregados++;
          c.enqueue(trozo);
          if (entregados >= 1000) c.close();
        },
      });
      const r = await t.recibir(peticionConFlujo(flujo));
      expect(r.status).toBe(413);
      // 2 MiB son 32 trozos de 64 KiB; el flujo puede adelantarse un par, pero no seguir hasta los 1000.
      expect(entregados).toBeLessThan(40);
    });

    it('una subida que se corta a medias responde 400 y se anota, en vez de lanzar una excepción', async () => {
      const t = await montarRecepcion();
      const flujo = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array(1000).fill(0x20));
          setTimeout(() => c.error(Object.assign(new Error('aborted'), { code: 'ECONNRESET' })), 5);
        },
      });
      const r = await t.recibir(peticionConFlujo(flujo));
      expect(r.status).toBe(400);
      expect(await error(r)).toEqual({ code: 'schema_invalid', message: 'El cuerpo llegó incompleto.' });
      expect(vi.mocked(console.warn).mock.calls.map((c) => String(c[0]))).toEqual([
        '[integracion] prueba de conexión rechazada: 400 schema_invalid (conexión cortada)',
      ]);
      expect(filas(t.db)).toEqual([]);
    });

    it('un cuerpo que no termina de llegar a tiempo responde 408 y no queda retenido', async () => {
      const t = await montarRecepcion(undefined, { plazoLecturaMs: 40 });
      const desde = Date.now();
      const r = await t.recibir(peticionConFlujo(flujoColgado()));
      expect(r.status).toBe(408);
      expect((await error(r)).code).toBe('request_timeout');
      expect(Date.now() - desde).toBeLessThan(2000);
      // Con el cuerpo completo dentro del plazo sigue funcionando.
      expect((await t.recibir(peticion(cuerpoFabrica()))).status).toBe(201);
    });

    it('no lee más de 8 cuerpos a la vez: el noveno recibe 429 con Retry-After y después todo vuelve a funcionar', async () => {
      const t = await montarRecepcion(undefined, { plazoLecturaMs: 200 });
      const lentas = Array.from({ length: 8 }, () => t.recibir(peticionConFlujo(flujoColgado())));
      const noveno = await t.recibir(peticionConFlujo(flujoColgado()));
      expect(noveno.status).toBe(429);
      expect(noveno.headers.get('retry-after')).toBe('5');
      expect((await error(noveno)).code).toBe('too_many_requests');
      expect((await Promise.all(lentas)).map((r) => r.status)).toEqual(Array(8).fill(408));
      // Los cupos se liberaron: otra solicitud, y también la siguiente tanda, entran.
      expect((await t.recibir(peticion(cuerpoFabrica()))).status).toBe(201);
      const otra = Array.from({ length: 8 }, () => t.recibir(peticionConFlujo(flujoColgado())));
      expect((await Promise.all(otra)).every((r) => r.status === 408)).toBe(true);
    });

    it('403 si el Host no está permitido', async () => {
      const t = await montarRecepcion();
      const r = await t.recibir(peticion(cuerpoFabrica(), { cabeceras: { host: 'malicioso.example' } }));
      expect(r.status).toBe(403);
      expect((await error(r)).code).toBe('host_not_allowed');
    });
  });

  describe('después de la firma', () => {
    it('400 schema_invalid si el cuerpo no es JSON', async () => {
      const t = await montarRecepcion();
      const r = await t.recibir(peticion(cuerpoFabrica(), { firmar: Buffer.from('esto no es json') }));
      expect(r.status).toBe(400);
      expect((await error(r)).code).toBe('schema_invalid');
    });

    it('422 unsupported_schema_version, antes que el resto del esquema', async () => {
      const t = await montarRecepcion();
      const r = await t.recibir(peticion({ schemaVersion: '2.0', cualquier: 'cosa' } as unknown as Sobre));
      expect(r.status).toBe(422);
      expect((await error(r)).code).toBe('unsupported_schema_version');
    });

    const invalidos: [string, Partial<Sobre> | ((c: Sobre) => Sobre)][] = [
      ['un campo desconocido', { extra: 1 }],
      ['el source de la propia tienda (un mensaje capturado en el otro sentido)', { source: 'neltume-store' }],
      ['otro source', { source: 'otra-app' }],
      ['otro eventType', { eventType: 'order.ready' }],
      ['sin document', (c) => ({ ...c, document: undefined as never })],
      ['un eventId que no es UUID', { eventId: 'no-es-un-uuid' }],
      ['un UUID en mayúsculas', { eventId: randomUUID().toUpperCase() }],
      ['un issuedAt que no es ISO', { issuedAt: '25/10/2026' }],
      ['un issuedAt sin Z', { issuedAt: '2026-10-25T15:00:00' }],
      ['un factoryCode de más de 40 caracteres', { factoryCode: 'P'.repeat(41) }],
      ['un nombre de archivo con espacios', (c) => ({ ...c, document: { ...c.document, filename: 'mi prueba.pdf' } })],
      ['un nombre de archivo sin .pdf', (c) => ({ ...c, document: { ...c.document, filename: 'prueba.txt' } })],
      ['un nombre de archivo con ruta', (c) => ({ ...c, document: { ...c.document, filename: '../prueba.pdf' } })],
      ['otro mimeType', (c) => ({ ...c, document: { ...c.document, mimeType: 'text/html' } })],
      ['un sha256 con mayúsculas', (c) => ({ ...c, document: { ...c.document, sha256: String(c.document.sha256).toUpperCase() } })],
      ['un campo desconocido dentro de document', (c) => ({ ...c, document: { ...c.document, extra: true } })],
      ['un pedido (order) en vez de una prueba', { order: {}, documents: {} }],
    ];
    for (const [nombre, cambio] of invalidos)
      it(`400 schema_invalid con ${nombre}`, async () => {
        const t = await montarRecepcion();
        const base = cuerpoFabrica();
        const cuerpo = typeof cambio === 'function' ? cambio(base) : { ...base, ...cambio };
        const r = await t.recibir(peticion(cuerpo, { cabeceras: { 'x-idempotency-key': `neltume-factory:connection-test:${cuerpo.eventId}` } }));
        expect(r.status).toBe(400);
        const e = await error(r);
        expect(e.code).toBe('schema_invalid');
        // Dice qué campo falló, nunca su valor.
        expect(e.message).not.toContain('no-es-un-uuid');
        expect(filas(t.db)).toEqual([]);
      });

    it('400 schema_invalid si la X-Idempotency-Key falta, no es de la fábrica o no corresponde al eventId', async () => {
      const t = await montarRecepcion();
      const cuerpo = cuerpoFabrica();
      for (const clave of [null, `neltume-store:connection-test:${cuerpo.eventId}`, `neltume-factory:connection-test:${randomUUID()}`, `neltume-factory:${cuerpo.eventId}`]) {
        const r = await t.recibir(peticion(cuerpo, { cabeceras: { 'x-idempotency-key': clave } }));
        expect(r.status, String(clave)).toBe(400);
        expect((await error(r)).code).toBe('schema_invalid');
      }
      expect(filas(t.db)).toEqual([]);
    });

    it('cada rechazo deja una línea en el registro, sin el cuerpo, sin valores y sin el secreto', async () => {
      const t = await montarRecepcion();
      await t.recibir(peticion(cuerpoFabrica({ factoryCode: 'SANTIAGO' })));
      await t.recibir(peticion(cuerpoFabrica({ extra: 'valor-secreto-del-cuerpo' })));
      await t.recibir(peticion(cuerpoFabrica(), { cabeceras: { 'content-type': 'text/plain; charset=utf-8' } }));
      const lineas = vi.mocked(console.warn).mock.calls.map((c) => String(c[0]));
      expect(lineas).toEqual([
        '[integracion] prueba de conexión rechazada: 422 destination_mismatch (La fábrica del mensaje no es la del secreto que lo firmó.)',
        '[integracion] prueba de conexión rechazada: 400 schema_invalid (El cuerpo no cumple el esquema (raíz: unrecognized_keys).)',
        '[integracion] prueba de conexión rechazada: 415 unsupported_media_type (text/plain)',
      ]);
      expect(lineas.join('\n')).not.toMatch(/valor-secreto|SANTIAGO|JVBER/);
      expect(lineas.join('\n')).not.toContain(SECRETO);
    });

    it('la clave de idempotencia se revisa antes que el factoryCode: 400, no 422', async () => {
      const t = await montarRecepcion();
      const r = await t.recibir(peticion(cuerpoFabrica({ factoryCode: 'SANTIAGO' }), { cabeceras: { 'x-idempotency-key': 'otra-clave' } }));
      expect(r.status).toBe(400);
      expect((await error(r)).code).toBe('schema_invalid');
    });

    it('422 destination_mismatch si el factoryCode no es la fábrica cuyo secreto firmó', async () => {
      const t = await montarRecepcion();
      for (const factoryCode of ['SANTIAGO', 'panguipulli', 'OTRA']) {
        const r = await t.recibir(peticion(cuerpoFabrica({ factoryCode })));
        expect(r.status, factoryCode).toBe(422);
        expect((await error(r)).code).toBe('destination_mismatch');
      }
      expect(filas(t.db)).toEqual([]);
    });

    it('413 payload_too_large si el PDF decodificado pasa de 1 MiB; en 1 MiB exacto pasa', async () => {
      const t = await montarRecepcion();
      const justo = pdfDeTamano(1024 * 1024);
      expect((await t.recibir(peticion(cuerpoFabrica({}, justo)))).status).toBe(201);
      const grande = pdfDeTamano(1024 * 1024 + 1);
      const r = await t.recibir(peticion(cuerpoFabrica({}, grande)));
      expect(r.status).toBe(413);
      expect((await error(r)).code).toBe('payload_too_large');
      expect(filas(t.db)).toHaveLength(1);
      // El tamaño se revisa antes que el sha256: un PDF enorme con otro hash también es 413.
      const conOtroHash = cuerpoFabrica({}, grande);
      conOtroHash.document = { ...conOtroHash.document, sha256: sha(Buffer.from('otra cosa')) };
      expect((await t.recibir(peticion(conOtroHash))).status).toBe(413);
    });

    describe('422 document_invalid', () => {
      const casos: [string, (pdf: Buffer, c: Sobre) => Sobre][] = [
        ['base64 con saltos de línea', (pdf, c) => ({ ...c, document: { ...c.document, contentBase64: pdf.toString('base64').replace(/(.{60})/g, '$1\n') } })],
        ['base64 sin relleno', (pdf, c) => ({ ...c, document: { ...c.document, contentBase64: pdf.toString('base64').replace(/=+$/, '') + '!' } })],
        ['base64 con caracteres de otro alfabeto', (pdf, c) => ({ ...c, document: { ...c.document, contentBase64: pdf.toString('base64url') + '_-' } })],
        ['sha256 que no coincide', (_, c) => ({ ...c, document: { ...c.document, sha256: sha(Buffer.from('otra cosa')) } })],
        ['un archivo que no es PDF', (_, c) => {
          const falso = Buffer.from('<html><body>no soy un pdf, pero tengo el largo suficiente para pasar</body></html>');
          return { ...c, document: { ...c.document, contentBase64: falso.toString('base64'), sha256: sha(falso) } };
        }],
        ['un PDF cortado (sin %%EOF)', (pdf, c) => {
          const cortado = pdf.subarray(0, pdf.length - 20);
          return { ...c, document: { ...c.document, contentBase64: cortado.toString('base64'), sha256: sha(cortado) } };
        }],
        ['un PDF cuyo startxref apunta a cualquier parte', (pdf, c) => {
          const roto = Buffer.from(pdf.toString('latin1').replace(/startxref\n\d+/, 'startxref\n12'), 'latin1');
          return { ...c, document: { ...c.document, contentBase64: roto.toString('base64'), sha256: sha(roto) } };
        }],
      ];
      for (const [nombre, armar] of casos)
        it(nombre, async () => {
          const t = await montarRecepcion();
          const pdf = pdfMinimo();
          const r = await t.recibir(peticion(armar(pdf, cuerpoFabrica({}, pdf))));
          expect(r.status).toBe(422);
          expect((await error(r)).code).toBe('document_invalid');
          expect(filas(t.db)).toEqual([]);
        });
    });
  });

  it('solo conserva el PDF de las últimas 20 por dirección y deja las filas como auditoría', async () => {
    const t = await montarRecepcion();
    const ids: string[] = [];
    for (let i = 0; i < PRUEBAS_CONSERVADAS + 3; i++) {
      const cuerpo = cuerpoFabrica();
      ids.push(cuerpo.eventId);
      expect((await t.recibir(peticion(cuerpo))).status).toBe(201);
    }
    const todas = filas(t.db);
    expect(todas).toHaveLength(PRUEBAS_CONSERVADAS + 3);
    expect(todas.filter((f) => f.pdf).map((f) => f.evento_id)).toEqual(ids.slice(3));
    expect(todas.slice(0, 3).every((f) => f.pdf === null && f.bytes > 0 && f.sha256)).toBe(true);
    const lista = listarPruebas(t.db, 'panguipulli');
    expect(lista).toHaveLength(PRUEBAS_CONSERVADAS);
    expect(lista.every((p) => p.tienePdf && p.direccion === 'recibida')).toBe(true);
    expect(lista[0].eventoId).toBe(ids.at(-1));
    // Lo enviado cuenta aparte: no desplaza lo recibido.
    guardarPrueba(t.db, { direccion: 'enviada', fabrica: 'panguipulli', eventoId: randomUUID(), clave: 'x', fecha: AHORA, resultado: 'aceptada', archivo: 'p.pdf', pdf: pdfMinimo(), sha256: 'a' });
    expect(filas(t.db).filter((f) => f.direccion === 'recibida' && f.pdf)).toHaveLength(PRUEBAS_CONSERVADAS);
  });

  it('una prueba recibida no toca cotizaciones ni la bandeja de pedidos', async () => {
    const t = await montarRecepcion();
    await t.recibir(peticion(cuerpoFabrica()));
    for (const tabla of ['cotizaciones', 'integracion_envios', 'notas_pedido'])
      expect((t.db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get() as { n: number }).n, tabla).toBe(0);
  });

  it('la ruta solo acepta POST: lo demás responde 405 con Allow', async () => {
    const ruta = await import('../src/app/api/integrations/neltume/connection-tests/route');
    for (const metodo of ['GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const) {
      const r = await ruta[metodo]();
      expect(r.status, metodo).toBe(405);
      expect(r.headers.get('allow')).toBe('POST');
      expect((await error(r)).code).toBe('method_not_allowed');
    }
  });
});

// ── Persistencia y limpieza ───────────────────────────────────────────────────────────────────────────────────

describe('Prueba de conexión: persistencia', () => {
  it('la tabla guarda un año las filas, con o sin PDF', async () => {
    const { db } = await baseTemporal();
    const nueva = (fecha: Date) => guardarPrueba(db, { direccion: 'enviada', fabrica: 'panguipulli', eventoId: randomUUID(), clave: randomUUID(), fecha, resultado: 'aceptada', archivo: 'p.pdf', pdf: pdfMinimo(), sha256: 'a' });
    nueva(new Date(AHORA.getTime() - 366 * 86_400_000));
    nueva(new Date(AHORA.getTime() - 364 * 86_400_000));
    nueva(AHORA);
    expect(pruebasAntiguas(db, AHORA).cantidad).toBe(1);
    expect(purgarPruebas(db, AHORA)).toBe(1);
    expect(filas(db)).toHaveLength(2);
  });

  it('el PDF se conserva por fábrica y por dirección: una no desplaza a la otra', async () => {
    const { db } = await baseTemporal();
    let n = 0;
    const nueva = (fabrica: 'panguipulli' | 'santiago', direccion: 'enviada' | 'recibida') =>
      guardarPrueba(db, { direccion, fabrica, eventoId: randomUUID(), clave: `clave-${n++}`, fecha: AHORA, resultado: 'aceptada', archivo: 'p.pdf', pdf: pdfMinimo(), sha256: 'a' });
    for (let i = 0; i < PRUEBAS_CONSERVADAS + 1; i++) nueva('panguipulli', 'enviada');
    for (let i = 0; i < 5; i++) nueva('santiago', 'enviada');
    for (let i = 0; i < 3; i++) nueva('panguipulli', 'recibida');
    const conPdf = (fabrica: string, direccion: string) =>
      (db.prepare('SELECT COUNT(*) AS n FROM integracion_pruebas WHERE fabrica = ? AND direccion = ? AND pdf IS NOT NULL').get(fabrica, direccion) as { n: number }).n;
    expect(conPdf('panguipulli', 'enviada')).toBe(PRUEBAS_CONSERVADAS);
    expect(conPdf('santiago', 'enviada')).toBe(5);
    expect(conPdf('panguipulli', 'recibida')).toBe(3);
    expect(listarPruebas(db, 'santiago')).toHaveLength(5);
  });

  it('leerPdfPrueba solo devuelve lo que todavía conserva el PDF', async () => {
    const { db } = await baseTemporal();
    const pdf = pdfMinimo();
    const id = guardarPrueba(db, { direccion: 'recibida', fabrica: 'panguipulli', eventoId: randomUUID(), clave: 'a', fecha: AHORA, resultado: 'recibida', archivo: 'a.pdf', pdf, sha256: sha(pdf) });
    expect(leerPdfPrueba(db, id)?.pdf.equals(pdf)).toBe(true);
    db.prepare('UPDATE integracion_pruebas SET pdf = NULL WHERE id = ?').run(id);
    expect(leerPdfPrueba(db, id)).toBeUndefined();
    expect(leerPdfPrueba(db, 999)).toBeUndefined();
  });

  it('no admite dos recibidas con la misma clave de idempotencia ni una dirección desconocida', async () => {
    const { db } = await baseTemporal();
    const base = { fabrica: 'panguipulli' as const, eventoId: randomUUID(), clave: 'misma', fecha: AHORA, resultado: 'recibida' as const, archivo: 'a.pdf', pdf: pdfMinimo(), sha256: 'a' };
    guardarPrueba(db, { ...base, direccion: 'recibida' });
    expect(() => guardarPrueba(db, { ...base, direccion: 'recibida' })).toThrow(/UNIQUE/);
    expect(() => guardarPrueba(db, { ...base, direccion: 'otra' as never })).toThrow(/CHECK/);
  });
});

describe('motivoPdfInvalido', () => {
  it('acepta un PDF íntegro y rechaza lo que no lo es', () => {
    const pdf = pdfMinimo();
    expect(motivoPdfInvalido(pdf)).toBeNull();
    // Con basura al final, como dejan algunos generadores, mientras el %%EOF esté en el último kilobyte.
    expect(motivoPdfInvalido(Buffer.concat([pdf, Buffer.from('\n\n\n')]))).toBeNull();
    expect(motivoPdfInvalido(Buffer.alloc(0))).toMatch(/%PDF-/);
    expect(motivoPdfInvalido(Buffer.from('%PDF-1.4 solo la cabecera'))).toMatch(/%PDF-|EOF/);
    expect(motivoPdfInvalido(pdf.subarray(0, pdf.length - 8))).toMatch(/EOF/);
    expect(motivoPdfInvalido(Buffer.from(pdf.toString('latin1').replace('startxref', 'startxrfe'), 'latin1'))).toMatch(/startxref/);
    expect(motivoPdfInvalido(Buffer.from(pdf.toString('latin1').replace(/startxref\n\d+/, 'startxref\n99999999'), 'latin1'))).toMatch(/fuera/);
    expect(motivoPdfInvalido(Buffer.from(pdf.toString('latin1').replace(/startxref\n\d+/, 'startxref\n12'), 'latin1'))).toMatch(/tabla de referencias/);
  });

  it('acepta un PDF cuyo startxref apunta a un flujo de referencias (un objeto)', () => {
    const cuerpo = '%PDF-1.5\n1 0 obj\n<< /Type /Catalog >>\nendobj\n2 0 obj\n<< /Type /XRef /Size 3 /W [1 2 1] /Length 0 >>\nstream\n\nendstream\nendobj\n';
    const pdf = Buffer.from(`${cuerpo}startxref\n${cuerpo.indexOf('2 0 obj')}\n%%EOF\n`, 'latin1');
    expect(motivoPdfInvalido(pdf)).toBeNull();
    // Un objeto cualquiera no es una tabla de referencias.
    const otro = Buffer.from(`${cuerpo.replace('/Type /XRef', '/Type /Pages')}startxref\n${cuerpo.indexOf('2 0 obj')}\n%%EOF\n`, 'latin1');
    expect(motivoPdfInvalido(otro)).toMatch(/tabla de referencias/);
  });
});

// ── Envío ────────────────────────────────────────────────────────────────────────────────────────────────────

interface Capturada {
  url: string;
  metodo: string;
  cabeceras: Record<string, string>;
  cuerpo: Buffer;
  init: RequestInit;
}
type Responder = (s: Capturada) => Response | Promise<Response>;

const aceptar =
  (cambios: Record<string, unknown> = {}, status = 201): Responder =>
  (s) =>
    Response.json(
      { status: 'accepted', eventId: (JSON.parse(s.cuerpo.toString()) as { eventId: string }).eventId, receiver: 'neltume-factory', receivedAt: new Date().toISOString(), ...cambios },
      { status },
    );

/** La fábrica simulada: guarda cada solicitud y responde lo que diga `responder`. */
function fabricaSimulada(responder: Responder = aceptar()) {
  const solicitudes: Capturada[] = [];
  let actual = responder;
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const s: Capturada = {
      url,
      metodo: init.method!,
      cabeceras: Object.fromEntries(Object.entries(init.headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])),
      cuerpo: Buffer.from(init.body as Uint8Array),
      init,
    };
    solicitudes.push(s);
    return actual(s);
  });
  return { fetch, solicitudes, responder: (r: Responder) => (actual = r) };
}

async function montarEnvio(responder?: Responder) {
  const t = await baseTemporal();
  const fabrica = fabricaSimulada(responder);
  const enviar = (opciones: { env?: Record<string, string | undefined>; actor?: string; ahora?: () => Date } = {}) =>
    enviarPrueba('panguipulli', opciones.actor ?? 'paula@neltume.cl', {
      directorio: t.dir,
      db: t.db,
      env: opciones.env ?? ENV,
      fetch: fabrica.fetch as unknown as typeof fetch,
      ahora: opciones.ahora,
    });
  return { ...t, fabrica, enviar };
}

describe('Prueba de conexión: lo que la tienda envía a la fábrica', () => {
  it('envía un PDF firmado a la ruta de pruebas y guarda lo enviado con su resultado', async () => {
    const t = await montarEnvio(aceptar({ receivedAt: AHORA.toISOString() }));
    const spy = vi.spyOn(AbortSignal, 'timeout');
    const r = await t.enviar({ ahora: () => AHORA });
    expect(r).toMatchObject({ resultado: 'aceptada', http: 201, codigo: null, aviso: null });
    expect(r.mensaje).toMatch(/^Aceptada en \d+ ms$/);

    const [s, ...otras] = t.fabrica.solicitudes;
    expect(otras).toEqual([]);
    expect(s.url).toBe(`${URL_FABRICA}${RUTA}`);
    expect(s.metodo).toBe('POST');
    expect(s.cabeceras['content-type']).toBe('application/json');
    expect(s.cabeceras['x-idempotency-key']).toBe(`neltume-store:connection-test:${r.eventoId}`);
    // Un intento, sin seguir redirecciones y con plazo de 15 s.
    expect(s.init.redirect).toBe('error');
    expect(spy).toHaveBeenCalledWith(15_000);
    expect(PLAZO_PRUEBA_MS).toBe(15_000);
    // Firmado con el secreto compartido, sobre los bytes que viajan.
    expect(verificarFirma([SECRETO], { timestamp: s.cabeceras['x-neltume-timestamp'], firma: s.cabeceras['x-neltume-signature'] }, s.cuerpo, AHORA.getTime())).toEqual({ ok: true });
    expect(verificarFirma(['otro-secreto-de-prueba-que-no-es-el-de-la-fabrica-123'], { timestamp: s.cabeceras['x-neltume-timestamp'], firma: s.cabeceras['x-neltume-signature'] }, s.cuerpo, AHORA.getTime()).ok).toBe(false);

    const mensaje = mensajePruebaSchema('neltume-store').parse(JSON.parse(s.cuerpo.toString()));
    expect(mensaje).toMatchObject({ schemaVersion: '1.0', eventType: 'connection.test', eventId: r.eventoId, source: 'neltume-store', factoryCode: 'PANGUIPULLI', issuedAt: AHORA.toISOString() });
    expect(mensaje.document.filename).toBe(`prueba-conexion-${r.eventoId.slice(0, 8)}.pdf`);
    const pdf = Buffer.from(mensaje.document.contentBase64, 'base64');
    expect(mensaje.document.sha256).toBe(sha(pdf));
    expect(motivoPdfInvalido(pdf)).toBeNull();
    // No lleva datos de clientes ni importes: solo el sobre y el documento.
    expect(Object.keys(JSON.parse(s.cuerpo.toString())).sort()).toEqual(['document', 'eventId', 'eventType', 'factoryCode', 'issuedAt', 'schemaVersion', 'source']);

    const [fila, ...demas] = filas(t.db);
    expect(demas).toEqual([]);
    expect(fila).toMatchObject({ id: r.id, direccion: 'enviada', fabrica: 'panguipulli', evento_id: r.eventoId, resultado: 'aceptada', http: 201, codigo: null, actor: 'paula@neltume.cl', archivo: mensaje.document.filename, sha256: mensaje.document.sha256 });
    expect(fila.latencia_ms).toBe(r.latenciaMs);
    expect(fila.pdf!.equals(pdf)).toBe(true);
    // El secreto no queda en la base ni en el registro del servidor.
    expect(JSON.stringify({ ...fila, pdf: null })).not.toContain(SECRETO);
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(SECRETO);
    expect(JSON.stringify(r)).not.toContain(SECRETO);
  });

  it('no deja el PDF impreso en disco', async () => {
    const t = await montarEnvio();
    await t.enviar();
    const { readdir } = await import('node:fs/promises');
    expect(await readdir(join(t.dir, 'integracion', 'pruebas', 'pdf'))).toEqual([]);
  });

  it('cada pulsación es otra prueba: otro eventId y otra clave', async () => {
    const t = await montarEnvio();
    const a = await t.enviar();
    const b = await t.enviar();
    expect(a.eventoId).not.toBe(b.eventoId);
    expect(new Set(t.fabrica.solicitudes.map((s) => s.cabeceras['x-idempotency-key'])).size).toBe(2);
  });

  it('un 200 duplicate se informa como duplicada', async () => {
    const t = await montarEnvio(aceptar({ status: 'duplicate' }, 200));
    const r = await t.enviar();
    expect(r).toMatchObject({ resultado: 'duplicada', http: 200 });
    expect(r.mensaje).toMatch(/^Duplicada en \d+ ms: la otra app ya la tenía$/);
  });

  describe('respuestas de error: el mismo diagnóstico que la fábrica', () => {
    const error = (code: string) => JSON.stringify({ error: { code, message: 'detalle que no se muestra' } });
    const casos: [number, string | null, string][] = [
      [401, 'invalid_signature', 'La otra app rechazó la firma: el secreto no coincide o los relojes difieren en más de 5 minutos'],
      [403, null, 'La otra app rechazó el acceso (403): revisa el Host permitido o el acceso por Cloudflare'],
      [404, null, 'La otra app aún no tiene esta ruta (versión sin desplegar)'],
      [405, null, 'La otra app aún no tiene esta ruta (versión sin desplegar)'],
      [503, 'not_configured', 'La otra app no tiene configurada la integración'],
      [400, 'schema_invalid', 'schema_invalid'],
      [409, 'idempotency_conflict', 'idempotency_conflict'],
      [413, 'payload_too_large', 'payload_too_large'],
      [415, 'unsupported_media_type', 'unsupported_media_type'],
      [422, 'document_invalid', 'document_invalid'],
      [422, 'destination_mismatch', 'destination_mismatch'],
      [422, 'unsupported_schema_version', 'unsupported_schema_version'],
      [429, null, 'La otra app respondió 429'],
      [500, 'internal', 'La otra app respondió 500'],
      [503, null, 'La otra app respondió 503'],
      [502, null, 'La otra app respondió 502'],
      [400, null, 'La otra app respondió 400'],
    ];
    for (const [status, code, texto] of casos)
      it(`${status}${code ? ` ${code}` : ''}: «${texto}»`, async () => {
        const t = await montarEnvio(() => new Response(code ? error(code) : '<html>proxy</html>', { status }));
        const r = await t.enviar();
        expect(r).toMatchObject({ resultado: 'rechazada', http: status, codigo: code, mensaje: texto, aviso: null });
        expect(diagnosticarRespuesta({ http: status, codigo: code })).toBe(texto);
        const [fila] = filas(t.db);
        expect(fila).toMatchObject({ direccion: 'enviada', resultado: 'rechazada', http: status, codigo: code, detalle: texto, actor: 'paula@neltume.cl' });
        // Se guardó lo que se envió, aunque la otra app lo rechazó.
        expect(fila.pdf).not.toBeNull();
      });

    it('un error que trae un código larguísimo o con otra forma no revienta', async () => {
      const t = await montarEnvio(() => new Response(JSON.stringify({ error: { code: 'x'.repeat(500) } }), { status: 422 }));
      expect(await t.enviar()).toMatchObject({ resultado: 'rechazada', http: 422, mensaje: 'La otra app respondió 422' });
    });
  });

  describe('un 2xx que no es de la fábrica cuenta como fallo', () => {
    const casos: [string, Responder][] = [
      ['receiver distinto (la propia tienda)', aceptar({ receiver: 'neltume-store' })],
      ['sin receiver', (s) => Response.json({ status: 'accepted', eventId: (JSON.parse(s.cuerpo.toString()) as { eventId: string }).eventId }, { status: 201 })],
      ['eventId distinto', aceptar({ eventId: randomUUID() })],
      ['sin eventId', () => Response.json({ status: 'accepted', receiver: 'neltume-factory' }, { status: 201 })],
      ['status desconocido', aceptar({ status: 'queued' })],
      ['cuerpo que no es JSON', () => new Response('<html>otra página</html>', { status: 200 })],
      ['cuerpo vacío', () => new Response(null, { status: 204 })],
    ];
    for (const [nombre, responder] of casos)
      it(nombre, async () => {
        const t = await montarEnvio(responder);
        const r = await t.enviar();
        expect(r).toMatchObject({ resultado: 'rechazada', codigo: 'otra_aplicacion', mensaje: 'Respondió otra aplicación' });
        expect(filas(t.db)[0]).toMatchObject({ resultado: 'rechazada', codigo: 'otra_aplicacion' });
      });
  });

  describe('sin respuesta', () => {
    it('red, DNS o TLS: «No se pudo conectar con la otra app» con la causa', async () => {
      const t = await montarEnvio();
      t.fabrica.fetch.mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo ENOTFOUND fabrica'), { code: 'ENOTFOUND' }) }));
      const r = await t.enviar();
      expect(r).toMatchObject({ resultado: 'sin_respuesta', http: null, codigo: null, mensaje: 'No se pudo conectar con la otra app: ENOTFOUND' });
      expect(filas(t.db)[0]).toMatchObject({ resultado: 'sin_respuesta', http: null, detalle: r.mensaje });
      expect(filas(t.db)[0].pdf).not.toBeNull();
    });

    it('plazo agotado', async () => {
      const t = await montarEnvio();
      t.fabrica.fetch.mockRejectedValueOnce(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
      expect((await t.enviar()).mensaje).toBe('No se pudo conectar con la otra app: sin respuesta en 15 s');
    });

    it('un 2xx cuyo cuerpo no termina de llegar es plazo agotado, no «otra aplicación»', async () => {
      const t = await montarEnvio();
      vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.timeout(30));
      t.fabrica.responder((s) => {
        const senal = s.init.signal as AbortSignal;
        const cuerpo = new ReadableStream<Uint8Array>({
          start(c) {
            const cortar = () => c.error(senal.reason);
            if (senal.aborted) cortar();
            else senal.addEventListener('abort', cortar);
          },
        });
        return new Response(cuerpo, { status: 201 });
      });
      const r = await t.enviar();
      expect(r).toMatchObject({ resultado: 'sin_respuesta', http: 201, codigo: null, mensaje: 'No se pudo conectar con la otra app: sin respuesta en 15 s' });
      expect(filas(t.db)[0]).toMatchObject({ resultado: 'sin_respuesta', http: 201 });
    });

    it('un 2xx cuyo cuerpo se corta (no por el plazo) es un cuerpo ilegible: «Respondió otra aplicación»', async () => {
      const t = await montarEnvio(() => new Response(new ReadableStream<Uint8Array>({ start: (c) => c.error(new Error('terminated')) }), { status: 201 }));
      expect(await t.enviar()).toMatchObject({ resultado: 'rechazada', http: 201, codigo: 'otra_aplicacion', mensaje: 'Respondió otra aplicación' });
    });

    it('redirección rechazada (Cloudflare Access): lo dice', async () => {
      const t = await montarEnvio();
      t.fabrica.fetch.mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'), { cause: new Error('unexpected redirect') }));
      expect((await t.enviar()).mensaje).toBe('No se pudo conectar: redirección inesperada (¿Cloudflare Access?)');
    });

    it('una fábrica que no contesta se corta con la señal de plazo de la solicitud', async () => {
      const t = await montarEnvio();
      // El plazo real es de 15 s: aquí se acorta, pero es la misma señal que recibe fetch.
      const plazo = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.timeout(30));
      t.fabrica.responder(
        (s) =>
          new Promise<Response>((_, rechazar) => {
            const senal = s.init.signal as AbortSignal;
            senal.addEventListener('abort', () => rechazar(senal.reason));
          }),
      );
      const r = await t.enviar();
      expect(plazo).toHaveBeenCalledWith(15_000);
      expect(r).toMatchObject({ resultado: 'sin_respuesta', http: null, mensaje: 'No se pudo conectar con la otra app: sin respuesta en 15 s' });
    });
  });

  describe('relojes', () => {
    const conReloj = (desfaseMs: number) => aceptar({ receivedAt: new Date(Date.now() + desfaseMs).toISOString() });
    it('avisa, sin fallar, si receivedAt difiere más de 60 s', async () => {
      const t = await montarEnvio(conReloj(120_000));
      const r = await t.enviar();
      expect(r.resultado).toBe('aceptada');
      expect(r.aviso).toMatch(/^Los relojes de las dos apps difieren unos 1(19|20|21) s \(la firma admite hasta 300 s\)\.$/);
    });
    it('también si la otra app va atrasada', async () => {
      expect((await (await montarEnvio(conReloj(-90_000))).enviar()).aviso).toMatch(/difieren unos (89|90|91) s/);
    });
    it('no avisa con 30 s de diferencia ni si receivedAt no viene', async () => {
      expect((await (await montarEnvio(conReloj(30_000))).enviar()).aviso).toBeNull();
      expect((await (await montarEnvio(aceptar({ receivedAt: undefined }))).enviar()).aviso).toBeNull();
    });
  });

  describe('sin enviar nada', () => {
    const sinNada = async (t: Awaited<ReturnType<typeof montarEnvio>>) => {
      expect(t.fabrica.fetch).not.toHaveBeenCalled();
      expect(filas(t.db)).toEqual([]);
    };
    const casos: [string, Record<string, string | undefined>, RegExp][] = [
      ['sin URL ni secreto', {}, /^Falta configurar la URL de la fábrica \(NELTUME_FABRICA_PANGUIPULLI_URL\) y el secreto compartido \(NELTUME_FABRICA_PANGUIPULLI_SECRETO\)\.$/],
      ['sin URL', { NELTUME_FABRICA_PANGUIPULLI_SECRETO: SECRETO }, /^Falta configurar la URL de la fábrica \(NELTUME_FABRICA_PANGUIPULLI_URL\)\.$/],
      ['sin secreto', { NELTUME_FABRICA_PANGUIPULLI_URL: URL_FABRICA }, /^Falta configurar el secreto compartido \(NELTUME_FABRICA_PANGUIPULLI_SECRETO\)\.$/],
      ['con un secreto corto', { ...ENV, NELTUME_FABRICA_PANGUIPULLI_SECRETO: 'corto' }, /secreto compartido \(NELTUME_FABRICA_PANGUIPULLI_SECRETO, al menos 32 caracteres\)/],
      ['con una URL HTTP que no es local', { ...ENV, NELTUME_FABRICA_PANGUIPULLI_URL: 'http://fabrica.example.cl' }, /URL de la fábrica \(NELTUME_FABRICA_PANGUIPULLI_URL, debe ser HTTPS\)/],
    ];
    for (const [nombre, env, mensaje] of casos)
      it(`${nombre}: «Falta configurar …», con el nombre de la variable y nunca su valor`, async () => {
        const t = await montarEnvio();
        const e = await t.enviar({ env }).catch((x) => x);
        expect(e).toMatchObject({ codigo: 'incompleta', status: 409 });
        expect(e.message).toMatch(mensaje);
        expect(e.message).not.toContain(SECRETO);
        await sinNada(t);
      });

    it('HTTP local sí sirve (desarrollo)', async () => {
      const t = await montarEnvio();
      for (const url of ['http://localhost:3000', 'http://127.0.0.1:3001', 'http://[::1]:3000']) {
        await t.enviar({ env: { ...ENV, NELTUME_FABRICA_PANGUIPULLI_URL: url } });
        expect(t.fabrica.solicitudes.at(-1)!.url).toBe(`${url}${RUTA}`);
      }
    });

    it('una fábrica sin integración (Santiago) no se prueba', async () => {
      const t = await montarEnvio();
      await expect(enviarPrueba('santiago', 'paula@neltume.cl', { directorio: t.dir, db: t.db, env: { ...ENV, NELTUME_FABRICA_SANTIAGO_URL: URL_FABRICA, NELTUME_FABRICA_SANTIAGO_SECRETO: SECRETO }, fetch: t.fabrica.fetch as never })).rejects.toThrow('no tiene integración');
      await sinNada(t);
    });

    it('si Chromium no imprime, no se envía nada, se dice y la siguiente prueba funciona', async () => {
      const t = await montarEnvio();
      pdfReal.falla = new ErrorPdf('Chromium no terminó prueba.pdf en 30000 ms.');
      const e = await t.enviar().catch((x) => x);
      expect(e).toMatchObject({ codigo: 'pdf_no_disponible', status: 503 });
      expect(e.message).toMatch(/^No se pudo generar el PDF de prueba: Chromium no terminó prueba\.pdf en 30000 ms\.\. Revisa que Chromium funcione/);
      await sinNada(t);
      pdfReal.falla = null;
      expect((await t.enviar()).resultado).toBe('aceptada');
    });

    it('una sola prueba a la vez', async () => {
      const t = await montarEnvio();
      let soltar!: () => void;
      const espera = new Promise<void>((r) => (soltar = r));
      t.fabrica.responder(async (s) => {
        await espera;
        return aceptar()(s);
      });
      const primera = t.enviar();
      const segunda = await t.enviar().catch((x) => x);
      expect(segunda).toMatchObject({ codigo: 'ocupado', status: 409 });
      soltar();
      expect((await primera).resultado).toBe('aceptada');
      expect(t.fabrica.solicitudes).toHaveLength(1);
      expect((await t.enviar()).resultado).toBe('aceptada');
    });
  });

  it('solo conserva el PDF de las últimas 20 enviadas', async () => {
    const t = await montarEnvio();
    for (let i = 0; i < PRUEBAS_CONSERVADAS + 2; i++) await t.enviar();
    const todas = filas(t.db);
    expect(todas).toHaveLength(PRUEBAS_CONSERVADAS + 2);
    expect(todas.filter((f) => f.pdf)).toHaveLength(PRUEBAS_CONSERVADAS);
    expect(todas.slice(0, 2).every((f) => f.pdf === null && f.actor === 'paula@neltume.cl')).toBe(true);
  });
});

// ── Ajustes: configuración, textos y rutas ────────────────────────────────────────────────────────────────

describe('Prueba de conexión: configuración y textos de Ajustes', () => {
  it('detalleConfiguracion dice qué falta y coincide con configuracionFabrica; el secreto nunca aparece', () => {
    const casos: Record<string, string | undefined>[] = [
      {},
      { NELTUME_FABRICA_PANGUIPULLI_URL: URL_FABRICA },
      { NELTUME_FABRICA_PANGUIPULLI_SECRETO: SECRETO },
      ENV,
      { ...ENV, NELTUME_FABRICA_PANGUIPULLI_URL: 'http://fabrica.example.cl' },
      { ...ENV, NELTUME_FABRICA_PANGUIPULLI_URL: 'https://usuario:clave@fabrica.example.cl' },
      { ...ENV, NELTUME_FABRICA_PANGUIPULLI_SECRETO: 'corto' },
      { NELTUME_FABRICA_PANGUIPULLI_URL: '  ', NELTUME_FABRICA_PANGUIPULLI_SECRETO: '  ' },
    ];
    for (const env of casos) {
      const d = detalleConfiguracion('panguipulli', env);
      expect(d.completa, JSON.stringify(Object.keys(env))).toBe(configuracionFabrica('panguipulli', env) !== null);
      expect(d.falta === null).toBe(d.completa);
      expect(JSON.stringify(d)).not.toContain(SECRETO);
      expect(d.secretoValido).toBe(secretoFabrica('panguipulli', env) !== null);
    }
    expect(detalleConfiguracion('panguipulli', ENV)).toEqual({ urlPresente: true, secretoPresente: true, urlValida: true, secretoValido: true, completa: true, falta: null });
    expect(textoConfiguracion(detalleConfiguracion('panguipulli', {}))).toEqual({ url: 'Falta', secreto: 'Falta' });
    expect(textoConfiguracion(detalleConfiguracion('panguipulli', { ...ENV, NELTUME_FABRICA_PANGUIPULLI_URL: 'http://x.cl', NELTUME_FABRICA_PANGUIPULLI_SECRETO: 'corto' }))).toEqual({
      url: 'No sirve: debe ser HTTPS',
      secreto: 'No sirve: debe tener al menos 32 caracteres',
    });
    expect(textoConfiguracion(detalleConfiguracion('panguipulli', ENV))).toEqual({ url: 'Configurada', secreto: 'Configurado' });
    // Santiago no está integrado: nunca cuenta como configurada, aunque haya variables.
    expect(detalleConfiguracion('santiago', { NELTUME_FABRICA_SANTIAGO_URL: URL_FABRICA, NELTUME_FABRICA_SANTIAGO_SECRETO: SECRETO }).completa).toBe(false);
    expect(secretoFabrica('santiago', { NELTUME_FABRICA_SANTIAGO_SECRETO: SECRETO })).toBeNull();
  });

  it('las fechas van como dd-mm-aaaa hh:mm en la hora de Chile', () => {
    // Octubre de 2026: Chile en horario de verano (UTC−3); en invierno es UTC−4.
    expect(fechaHoraChile('2026-10-25T15:02:11.384Z')).toBe('25-10-2026 12:02');
    expect(fechaPrueba('2026-07-01T03:30:00.000Z')).toBe('30-06-2026 23:30');
    expect(fechaHoraChile('2026-01-01T03:05:00.000Z')).toBe('01-01-2026 00:05');
    expect(fechaHoraChile('2026-01-01T03:00:00.000Z')).not.toContain('24:');
    expect(fechaHoraChile('no es una fecha')).toBe('no es una fecha');
  });

  it('los textos de la lista dicen lo mismo que el diagnóstico', () => {
    expect(textoDireccion('enviada')).toBe('Enviada a la fábrica');
    expect(textoDireccion('recibida')).toBe('Recibida de la fábrica');
    expect(codigoPrueba('6f1c2a7e-3b9d-4c51-9a0e-2d7b8f41c6aa')).toBe('6f1c2a7e');
    expect(textoResultadoPrueba({ resultado: 'recibida', latenciaMs: null, detalle: null })).toBe('Recibida');
    expect(textoResultadoPrueba({ resultado: 'aceptada', latenciaMs: 412, detalle: 'Aceptada en 412 ms' })).toBe('Aceptada en 412 ms');
    expect(textoResultadoPrueba({ resultado: 'aceptada', latenciaMs: null, detalle: null })).toBe('Aceptada');
    expect(textoResultadoPrueba({ resultado: 'duplicada', latenciaMs: 5, detalle: null })).toBe('Duplicada: la otra app ya la tenía');
    expect(textoResultadoPrueba({ resultado: 'rechazada', latenciaMs: 5, detalle: 'document_invalid' })).toBe('document_invalid');
    expect(textoResultadoPrueba({ resultado: 'sin_respuesta', latenciaMs: 15000, detalle: null })).toBe('Sin respuesta');
  });

  it('«Conexión con la fábrica» es una sección solo para quien administra', () => {
    expect(seccionesVisibles(true).map((s) => s.id)).toContain('fabrica');
    expect(seccionesVisibles(false).map((s) => s.id)).not.toContain('fabrica');
  });
});

// ── Rutas de Ajustes con sesión ──────────────────────────────────────────────────────────────────────────────

describe('Prueba de conexión: rutas de Ajustes (solo administración)', () => {
  let desmontar: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await desmontar?.();
    desmontar = undefined;
  });

  async function montar(env: Record<string, string> = ENV) {
    const { montarInstalacion } = await import('./sesion-prueba');
    const instalacion = await montarInstalacion('conexion');
    desmontar = instalacion.desmontar;
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const fabrica = fabricaSimulada();
    vi.stubGlobal('fetch', fabrica.fetch);
    const estado = await import('../src/app/api/ajustes/conexion/route');
    const pdf = await import('../src/app/api/ajustes/conexion/pruebas/[id]/route');
    const admin = await instalacion.cuenta('admin@neltume.test', 'admin');
    const usuaria = await instalacion.cuenta('persona@neltume.test', 'user');
    return { ...instalacion, estado, pdf, fabrica, admin, usuaria };
  }
  afterEach(() => vi.unstubAllGlobals());

  it('GET: sin sesión 401, sin rol de administración 403, y a quien administra le dice qué hay sin mostrar el secreto', async () => {
    const t = await montar();
    expect((await t.estado.GET(t.peticion('/api/ajustes/conexion'))).status).toBe(401);
    expect((await t.estado.GET(t.peticion('/api/ajustes/conexion', { cookie: t.usuaria.cookie }))).status).toBe(403);
    const r = await t.estado.GET(t.peticion('/api/ajustes/conexion', { cookie: t.admin.cookie }));
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const texto = await r.text();
    expect(texto).not.toContain(SECRETO);
    expect(JSON.parse(texto)).toEqual({
      fabricas: [
        {
          fabrica: 'panguipulli',
          nombre: 'Panguipulli',
          configuracion: { urlPresente: true, secretoPresente: true, urlValida: true, secretoValido: true, completa: true, falta: null },
          pruebas: [],
        },
      ],
    });
  });

  it('POST: envía la prueba, responde el resultado con la lista y la deja guardada a nombre de quien la apretó', async () => {
    const t = await montar();
    const r = await t.estado.POST(t.peticion('/api/ajustes/conexion', { cookie: t.admin.cookie, json: { fabrica: 'panguipulli' } }));
    expect(r.status).toBe(200);
    const cuerpo = (await r.json()) as { prueba: { resultado: string; eventoId: string; mensaje: string }; pruebas: { id: number; direccion: string; eventoId: string; tienePdf: boolean }[] };
    expect(cuerpo.prueba).toMatchObject({ resultado: 'aceptada' });
    expect(cuerpo.pruebas).toHaveLength(1);
    expect(cuerpo.pruebas[0]).toMatchObject({ direccion: 'enviada', eventoId: cuerpo.prueba.eventoId, tienePdf: true });
    expect(JSON.stringify(cuerpo)).not.toContain(SECRETO);
    expect(t.fabrica.solicitudes).toHaveLength(1);
    expect((t.db.prepare('SELECT actor FROM integracion_pruebas').get() as { actor: string }).actor).toBe('admin@neltume.test');
  });

  it('POST: exige sesión de administración y mismo origen, y valida lo que pide', async () => {
    const t = await montar();
    const enviar = (opciones: Parameters<typeof t.peticion>[1]) => t.estado.POST(t.peticion('/api/ajustes/conexion', { json: { fabrica: 'panguipulli' }, ...opciones }));
    expect((await enviar({})).status).toBe(401);
    expect((await enviar({ cookie: t.usuaria.cookie })).status).toBe(403);
    expect((await enviar({ cookie: t.admin.cookie, cabeceras: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await enviar({ cookie: t.admin.cookie, cabeceras: { origin: 'https://otro.example' } })).status).toBe(403);
    expect((await enviar({ cookie: t.admin.cookie, json: { fabrica: 'santiago' } })).status).toBe(400);
    expect((await enviar({ cookie: t.admin.cookie, json: { fabrica: 'panguipulli', extra: 1 } })).status).toBe(400);
    expect((await enviar({ cookie: t.admin.cookie, json: {} })).status).toBe(400);
    expect(t.fabrica.solicitudes).toHaveLength(0);
  });

  it('POST: sin configuración responde 409 con «Falta configurar …» y no envía nada', async () => {
    const t = await montar({ NELTUME_FABRICA_PANGUIPULLI_URL: '', NELTUME_FABRICA_PANGUIPULLI_SECRETO: '' });
    const r = await t.estado.POST(t.peticion('/api/ajustes/conexion', { cookie: t.admin.cookie, json: { fabrica: 'panguipulli' } }));
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ codigo: 'incompleta', error: expect.stringMatching(/^Falta configurar la URL de la fábrica/) });
    expect(t.fabrica.solicitudes).toHaveLength(0);
  });

  it('POST: un rechazo de la fábrica es un resultado (200) con su diagnóstico, no un error del servidor', async () => {
    const t = await montar();
    t.fabrica.responder(() => Response.json({ error: { code: 'invalid_signature', message: 'x' } }, { status: 401 }));
    const r = await t.estado.POST(t.peticion('/api/ajustes/conexion', { cookie: t.admin.cookie, json: { fabrica: 'panguipulli' } }));
    expect(r.status).toBe(200);
    expect(((await r.json()) as { prueba: { mensaje: string } }).prueba.mensaje).toMatch(/^La otra app rechazó la firma/);
  });

  describe('Ver PDF', () => {
    it('sirve el PDF a quien administra, sin cachear y sin que el navegador adivine el tipo', async () => {
      const t = await montar();
      const enviada = (await (await t.estado.POST(t.peticion('/api/ajustes/conexion', { cookie: t.admin.cookie, json: { fabrica: 'panguipulli' } }))).json()) as { pruebas: { id: number }[] };
      const id = enviada.pruebas[0].id;
      const ver = (cookie?: string, ruta = String(id)) => t.pdf.GET(t.peticion(`/api/ajustes/conexion/pruebas/${ruta}`, { cookie }), { params: Promise.resolve({ id: ruta }) });
      const r = await ver(t.admin.cookie);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toBe('application/pdf');
      expect(r.headers.get('cache-control')).toBe('private, no-store');
      expect(r.headers.get('x-content-type-options')).toBe('nosniff');
      expect(r.headers.get('content-disposition')).toMatch(/^inline; filename="prueba-conexion-[0-9a-f]{8}\.pdf"$/);
      const bytes = Buffer.from(await r.arrayBuffer());
      expect(motivoPdfInvalido(bytes)).toBeNull();
      expect(bytes.equals((t.db.prepare('SELECT pdf FROM integracion_pruebas WHERE id = ?').get(id) as { pdf: Buffer }).pdf)).toBe(true);

      expect((await ver()).status).toBe(401);
      expect((await ver(t.usuaria.cookie)).status).toBe(403);
      for (const malo of ['999', '0', 'abc', '1.5', '-1', '1e3', '../1']) expect((await ver(t.admin.cookie, malo)).status, malo).toBe(404);
      t.db.prepare('UPDATE integracion_pruebas SET pdf = NULL WHERE id = ?').run(id);
      const sinPdf = await ver(t.admin.cookie);
      expect(sinPdf.status).toBe(404);
      expect(sinPdf.headers.get('cache-control')).toBe('no-store');
    });
  });
});

// ── PDF real: Chromium + pdfjs ───────────────────────────────────────────────────────────────────────────────

describe.skipIf(!chromiumPath())('Prueba de conexión: el PDF real (Chromium + pdfjs-dist)', () => {
  it('es de una página, lleva el rótulo, el código y la fecha de Chile, pasa la revisión y lo abre pdfjs', async () => {
    pdfReal.activo = true;
    const t = await montarEnvio();
    const r = await t.enviar({ ahora: () => new Date('2026-10-25T15:02:11.384Z') });
    expect(r.resultado).toBe('aceptada');
    const mensaje = mensajePruebaSchema('neltume-store').parse(JSON.parse(t.fabrica.solicitudes[0].cuerpo.toString()));
    const pdf = Buffer.from(mensaje.document.contentBase64, 'base64');
    expect(pdf.length).toBeLessThan(1024 * 1024);
    expect(motivoPdfInvalido(pdf)).toBeNull();

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const carga = pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: false });
    const doc = await carga.promise;
    expect(doc.numPages).toBe(1);
    const texto = (await (await doc.getPage(1)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ').replace(/\s+/g, ' ');
    expect(texto).toContain('PRUEBA DE CONEXIÓN — no es un pedido');
    expect(texto).toContain('Cotizador de la tienda Neltume');
    expect(texto).toContain('Fábrica Panguipulli');
    expect(texto).toContain('25-10-2026 12:02');
    expect(texto).toContain(codigoPrueba(r.eventoId));
    // Datos inventados y sin precios ni datos de clientes.
    expect(texto).not.toMatch(/\$|IVA|RUT|Total/i);
    await carga.destroy();
  });

  it('un PDF real de Chromium pasa la revisión de la tienda al recibirlo', async () => {
    pdfReal.activo = true;
    const t = await montarEnvio();
    await t.enviar();
    const mensaje = mensajePruebaSchema('neltume-store').parse(JSON.parse(t.fabrica.solicitudes[0].cuerpo.toString()));
    const pdf = Buffer.from(mensaje.document.contentBase64, 'base64');
    const recepcion = await montarRecepcion();
    const cuerpo = cuerpoFabrica({}, pdf);
    expect((await recepcion.recibir(peticion(cuerpo))).status).toBe(201);
    expect(leerPdfPrueba(recepcion.db, filas(recepcion.db)[0].id)?.pdf.equals(pdf)).toBe(true);
  });
});
