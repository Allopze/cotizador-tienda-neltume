import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrarEsquemaAutenticacion } from '../src/servidor/autenticacion-config';
import type { Catalogo, Producto } from '../src/catalogo/tipos';
import type { Cotizacion } from '../src/negocio/estado';

// Plan de trabajo (docs/revision-2026-10-11.md §4) por la ruta /api/accion, con sesiones reales de Better Auth
// como en starken-rutas.test.ts: 1.2 (clave de IA ilegible) y 3.4 (número manual solo para administración).

vi.mock('../src/servidor/pdf', () => ({
  prepararPdf: vi.fn(async () => {}),
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

const clave = 'clave-de-prueba-segura-123';
const origen = 'http://127.0.0.1:3000';
const SECRETO = 'vitest-secret-0123456789abcdef-0123456789';
const OTRO_SECRETO = 'otro-secreto-de-otro-despliegue-0123456789';
const puerta: Producto = {
  codigo: 'MOL-O-3-A',
  modelo: 'MOLCO',
  familia: 'PUERTA',
  tipo: 'PUERTA PANEL',
  madera: 'PINO OREGON',
  medida: '0,80 A 0,85',
  anchoMin: 0.8,
  anchoMax: 0.85,
  largo: 2,
  precioNeto: 100000,
  descripcion: 'MOLCO',
  filaOrigen: 4,
};
const catalogo = (): Catalogo => ({
  fuente: 'test',
  sha256: 'test',
  fecha: '2026-01-01',
  productos: [puerta],
});

let directorio: string | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (directorio) await rm(directorio, { recursive: true, force: true });
  directorio = undefined;
});

async function montar() {
  directorio = await mkdtemp(join(tmpdir(), 'cotizador-plan-rutas-'));
  vi.stubEnv('BETTER_AUTH_SECRET', SECRETO);
  vi.stubEnv('BETTER_AUTH_URL', origen);
  vi.stubEnv('NELTUME_DATA_DIR', directorio);
  vi.stubEnv('NELTUME_DB_PATH', join(directorio, 'cotizador.sqlite'));
  vi.stubEnv('NELTUME_TEST_MODE', '1');
  // Sin el LLM fijo de las E2E: el chat crea el adaptador real con la clave guardada.
  vi.stubEnv('NELTUME_LLM', '');
  vi.stubEnv('CMD_API_KEY', '');
  const { abrirBaseDatos, cerrarBaseDatos } = await import('../src/servidor/base-datos');
  const db = abrirBaseDatos();
  await migrarEsquemaAutenticacion(db);
  const { guardarCatalogo } = await import('../src/servidor/repositorio-catalogo');
  guardarCatalogo(db, catalogo());
  const { auth } = await import('../src/servidor/autenticacion');
  const contexto = await auth.$context;
  const cuenta = async (email: string, role: 'user' | 'admin') => {
    const user = await contexto.internalAdapter.createUser(
      { email, name: 'Persona de prueba', emailVerified: true, role },
      { method: 'admin' },
    );
    await contexto.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: await contexto.password.hash(clave),
    });
    const login = await auth.handler(
      new Request(`${origen}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { origin: origen, 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.21' },
        body: JSON.stringify({ email, password: clave }),
      }),
    );
    expect(login.ok).toBe(true);
    return login.headers
      .getSetCookie()
      .map((c) => c.split(';', 1)[0])
      .join('; ');
  };
  const usuario = await cuenta('persona@neltume.test', 'user');
  const admin = await cuenta('admin@neltume.test', 'admin');
  const peticion = (ruta: string, opciones: { cookie: string; cuerpo?: unknown }) =>
    new Request(`${origen}${ruta}`, {
      method: 'cuerpo' in opciones ? 'POST' : 'GET',
      headers: {
        host: '127.0.0.1:3000',
        origin: origen,
        cookie: opciones.cookie,
        ...('cuerpo' in opciones ? { 'content-type': 'application/json' } : {}),
      },
      ...('cuerpo' in opciones ? { body: JSON.stringify(opciones.cuerpo) } : {}),
    });
  const accion = await import('../src/app/api/accion/route');
  const ajustes = await import('../src/app/api/ajustes/route');
  type Respuesta = { cotizacion: Cotizacion; error?: string; codigo?: string; archivo?: string };
  const post = async (cookie: string, cuerpo: Record<string, unknown>) => {
    const r = await accion.POST(peticion('/api/accion', { cookie, cuerpo }));
    return { status: r.status, cuerpo: (await r.json()) as Respuesta };
  };
  /** Una acción sobre la cotización `q` con su versión vigente; devuelve la respuesta y la cotización nueva. */
  const sobre = (cookie: string, q: Cotizacion, extra: Record<string, unknown>) =>
    post(cookie, { ...extra, id: q.id, actualizada: q.actualizada });
  const iaModulo = await import('../src/servidor/ajustes-ia');
  return {
    db,
    usuario,
    admin,
    peticion,
    accion,
    ajustes,
    post,
    sobre,
    ia: iaModulo,
    cerrar: () => cerrarBaseDatos(),
  };
}

describe('1.2 · clave de IA cifrada con otro BETTER_AUTH_SECRET', () => {
  it('emitir, editar y registrar un pago funcionan; el chat responde 503 y Ajustes la muestra ilegible', async () => {
    const m = await montar();
    try {
      // La fila se cifró en otro despliegue: con el secreto de este, no se puede descifrar.
      vi.stubEnv('BETTER_AUTH_SECRET', OTRO_SECRETO);
      m.ia.guardarClaveCommandCode('sk-de-otro-despliegue', m.db);
      expect(m.ia.estadoClaveCommandCode(m.db)).toEqual({ configurada: true, fuente: 'ajustes' });
      vi.stubEnv('BETTER_AUTH_SECRET', SECRETO);
      expect(m.ia.estadoClaveCommandCode(m.db)).toEqual({ configurada: false, fuente: 'ilegible' });

      const creada = await m.post(m.usuario, {
        tipo: 'agregar_producto',
        codigo: 'MOL-O-3-A',
        cantidad: 2,
        tipoMedida: 'hoja',
      });
      expect(creada.status).toBe(200);
      let q = creada.cuerpo.cotizacion;
      const editada = await m.sobre(m.usuario, q, { tipo: 'editar', cliente: { nombre: 'Ana Soto' } });
      expect(editada.status).toBe(200);
      q = editada.cuerpo.cotizacion;
      expect(q.cliente.nombre).toBe('Ana Soto');
      const emitida = await m.sobre(m.usuario, q, { tipo: 'emitir' });
      expect(emitida.status).toBe(200);
      q = emitida.cuerpo.cotizacion;
      expect(q).toMatchObject({ estado: 'emitida', numero: 323 });
      const aprobada = await m.sobre(m.usuario, q, { tipo: 'aprobar' });
      expect(aprobada.status).toBe(200);
      q = aprobada.cuerpo.cotizacion;
      const pago = await m.sobre(m.usuario, q, { tipo: 'pago', monto: 1000 });
      expect(pago.status).toBe(200);
      expect(pago.cuerpo.cotizacion.pagos).toHaveLength(1);

      // El chat sí necesita la clave: 503 con un mensaje que dice qué hacer, y no crea nada.
      const chat = await m.post(m.usuario, { tipo: 'chat', mensaje: 'cotiza 2 molco 82x200' });
      expect(chat.status).toBe(503);
      expect(chat.cuerpo).toEqual({
        error: 'La clave de IA guardada ya no se puede leer. Vuelve a ingresarla en Ajustes.',
        codigo: 'ia_clave_ilegible',
      });
      expect(m.db.prepare('SELECT COUNT(*) AS n FROM cotizaciones').get()).toEqual({ n: 1 });

      // Ajustes y el cotizador lo informan en vez de decir «clave configurada».
      const estado = (await (
        await m.ajustes.GET(m.peticion('/api/ajustes', { cookie: m.admin }))
      ).json()) as Record<string, unknown>;
      expect(estado).toMatchObject({
        commandcodeClave: false,
        commandcodeClaveFuente: 'ilegible',
        asistenteConfigurado: false,
      });
      const detalle = (await (
        await m.accion.GET(m.peticion(`/api/accion?id=${q.id}`, { cookie: m.usuario }))
      ).json()) as Record<string, unknown>;
      expect(detalle.asistenteConfigurado).toBe(false);
    } finally {
      m.cerrar();
    }
  });
});

describe('3.4 · número de cotización elegido a mano', () => {
  it('sin rol admin la ruta responde 403 y no emite; admin puede, con un salto de hasta 1000 sobre el último', async () => {
    const m = await montar();
    try {
      let q = (
        await m.post(m.usuario, {
          tipo: 'agregar_producto',
          codigo: 'MOL-O-3-A',
          cantidad: 2,
          tipoMedida: 'hoja',
        })
      ).cuerpo.cotizacion;
      const sinRol = await m.sobre(m.usuario, q, { tipo: 'emitir', numero: 400 });
      expect(sinRol.status).toBe(403);
      expect(m.db.prepare('SELECT estado, numero FROM cotizaciones WHERE id = ?').get(q.id)).toEqual({
        estado: 'borrador',
        numero: null,
      });
      expect(m.db.prepare('SELECT siguiente_cotizacion AS n FROM correlativos').get()).toEqual({ n: 323 });

      // El último usado es 322: 1323 salta más de 1000 y se rechaza con un 409 propio, sin gastar números.
      const salto = await m.sobre(m.admin, q, { tipo: 'emitir', numero: 1323 });
      expect(salto.status).toBe(409);
      expect(salto.cuerpo).toMatchObject({ codigo: 'numero_invalido' });
      expect(salto.cuerpo.error).toContain('no superar 1322');
      expect(m.db.prepare('SELECT siguiente_cotizacion AS n FROM correlativos').get()).toEqual({ n: 323 });

      const elegido = await m.sobre(m.admin, q, { tipo: 'emitir', numero: 1322 });
      expect(elegido.status).toBe(200);
      q = elegido.cuerpo.cotizacion;
      expect(q.numero).toBe(1322);
      // Sin número, cualquier cuenta emite con el siguiente.
      const otra = (
        await m.post(m.usuario, {
          tipo: 'agregar_producto',
          codigo: 'MOL-O-3-A',
          cantidad: 1,
          tipoMedida: 'hoja',
        })
      ).cuerpo.cotizacion;
      const siguiente = await m.sobre(m.usuario, otra, { tipo: 'emitir' });
      expect(siguiente.status).toBe(200);
      expect(siguiente.cuerpo.cotizacion.numero).toBe(1323);
      // Regenerar un PDF también es de administración.
      expect((await m.sobre(m.usuario, q, { tipo: 'regenerar_pdf', documento: 'cotizacion' })).status).toBe(
        403,
      );
    } finally {
      m.cerrar();
    }
  });
});

describe('#24 y #32 · número manual: último número y tope; 403 con código y sin caché', () => {
  it('GET ?numeracion=1 da el último número y el tope solo a administración; el 403 es como los demás errores', async () => {
    const m = await montar();
    try {
      const numeracion = async (cookie: string) => {
        const r = await m.accion.GET(m.peticion('/api/accion?numeracion=1', { cookie }));
        return { status: r.status, cache: r.headers.get('cache-control'), cuerpo: await r.json() };
      };
      // Sin rol admin: 403 con código y sin caché, igual en el GET y en el POST del número manual.
      expect(await numeracion(m.usuario)).toEqual({
        status: 403,
        cache: 'no-store',
        cuerpo: { error: 'Esta acción requiere una cuenta administradora.', codigo: 'sin_permiso' },
      });
      const q = (
        await m.post(m.usuario, { tipo: 'agregar_producto', codigo: 'MOL-O-3-A', cantidad: 1, tipoMedida: 'hoja' })
      ).cuerpo.cotizacion;
      const r = await m.accion.POST(
        m.peticion('/api/accion', { cookie: m.usuario, cuerpo: { tipo: 'emitir', numero: 400, id: q.id, actualizada: q.actualizada } }),
      );
      expect(r.status).toBe(403);
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(await r.json()).toEqual({ error: 'Esta acción requiere una cuenta administradora.', codigo: 'sin_permiso' });

      // Administración: el último usado (322), el siguiente y el tope de +1.000, sin gastar números.
      expect(await numeracion(m.admin)).toEqual({
        status: 200,
        cache: 'no-store',
        cuerpo: { ultimo: 322, siguiente: 323, tope: 1322 },
      });
      expect(m.db.prepare('SELECT siguiente_cotizacion AS n FROM correlativos').get()).toEqual({ n: 323 });
      // Tras emitir con el tope, el rango avanza desde ahí.
      expect((await m.sobre(m.admin, q, { tipo: 'emitir', numero: 1322 })).status).toBe(200);
      expect((await numeracion(m.admin)).cuerpo).toEqual({ ultimo: 1322, siguiente: 1323, tope: 2322 });
      const invalido = await m.accion.GET(m.peticion('/api/accion?numeracion=si', { cookie: m.admin }));
      expect(invalido.status).toBe(400);
    } finally {
      m.cerrar();
    }
  });
});

describe('#38 · diagnóstico del chat (I5)', () => {
  const chat = (cuerpo: unknown) =>
    Response.json({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            tool_calls: [{ type: 'function', function: { name: 'responder', arguments: JSON.stringify(cuerpo) } }],
          },
        },
      ],
    });
  /** El principal está mal escrito (404 con cuerpo); el respaldo responde. */
  const proveedor = () =>
    vi.fn<typeof fetch>(async (_url, opciones) => {
      const { model } = JSON.parse(String(opciones?.body)) as { model: string };
      if (model === 'deepseek/mal-escrito')
        return new Response('{"error":{"message":"No endpoints found for deepseek/mal-escrito."}}', {
          status: 404,
        });
      return chat({ texto: '¿Qué madera necesitas?' });
    });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('la respuesta trae el modelo que respondió y si fue el respaldo; el 4xx queda en el registro', async () => {
    const m = await montar();
    try {
      m.ia.guardarClaveCommandCode('sk-de-prueba', m.db);
      m.ia.guardarAjustesIA({ commandcode: { modelo: 'deepseek/mal-escrito', respaldo: 'Qwen/Qwen3.7-Flash' } }, m.db);
      vi.stubGlobal('fetch', proveedor());
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'info').mockImplementation(() => {});
      const r = await m.accion.POST(
        m.peticion('/api/accion', { cookie: m.usuario, cuerpo: { tipo: 'chat', mensaje: 'cotiza una puerta' } }),
      );
      expect(r.status).toBe(200);
      const cuerpo = (await r.json()) as { diagnostico: { modelo: string; respaldo: boolean; ms: number } };
      expect(cuerpo.diagnostico).toEqual({ modelo: 'Qwen/Qwen3.7-Flash', respaldo: true, ms: expect.any(Number) });
      expect(warn).toHaveBeenCalledWith(
        '[asistente] respaldo',
        expect.objectContaining({ tecnico: expect.stringContaining('No endpoints found for deepseek/mal-escrito') }),
      );

      // Sin respaldo, el error llega a la vendedora sin el detalle, que sí queda en el registro del servidor.
      m.ia.guardarAjustesIA({ commandcode: { modelo: 'deepseek/mal-escrito', respaldo: null } }, m.db);
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const fallida = await m.accion.POST(
        m.peticion('/api/accion', { cookie: m.usuario, cuerpo: { tipo: 'chat', mensaje: 'cotiza una puerta' } }),
      );
      expect(fallida.status).toBe(502);
      const texto = await fallida.text();
      expect(texto).toContain('ia_configuracion');
      expect(texto).not.toContain('No endpoints');
      expect(error.mock.calls.flat().join(' ')).toMatch(
        /ia_configuracion: HTTP 404: .*No endpoints found for deepseek\/mal-escrito/,
      );
    } finally {
      m.cerrar();
    }
  });
});
