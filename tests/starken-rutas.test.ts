import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrarEsquemaAutenticacion } from '../src/servidor/autenticacion-config';
import { clienteVacio, type Catalogo, type Producto } from '../src/catalogo/tipos';

// Las rutas de Starken con sesiones reales de Better Auth: sin sesión, sin rol de administración y con cuerpos
// inválidos; que el origen venga de la lista de Starken; y la ida y vuelta cotizar → aplicar con la tarifa firmada.

vi.mock('../src/servidor/pdf', () => ({
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

const clave = 'clave-de-prueba-segura-123';
const origen = 'http://127.0.0.1:3000';
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
const paqueteVacio = {
  PUERTA: { kg: null, espesorCm: null },
  MARCO: { kg: null, espesorCm: null },
  MOLDURA: { kg: null, espesorCm: null },
  PIEZAS_T: { kg: null, espesorCm: null },
};
const configuracionCompleta = (nombre = 'SANTIAGO', codigoCiudad = 1) => ({
  origen: { codigoCiudad, nombre },
  paquete: { ...paqueteVacio, PUERTA: { kg: 25, espesorCm: 4.5 } },
});

let directorio: string | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (directorio) await rm(directorio, { recursive: true, force: true });
  directorio = undefined;
});

async function montar() {
  directorio = await mkdtemp(join(tmpdir(), 'cotizador-starken-rutas-'));
  vi.stubEnv('BETTER_AUTH_SECRET', 'vitest-secret-0123456789abcdef-0123456789');
  vi.stubEnv('BETTER_AUTH_URL', origen);
  vi.stubEnv('NELTUME_DATA_DIR', directorio);
  vi.stubEnv('NELTUME_DB_PATH', join(directorio, 'cotizador.sqlite'));
  vi.stubEnv('NELTUME_TEST_MODE', '1');
  vi.stubEnv('NELTUME_STARKEN', 'fijo');
  const { abrirBaseDatos, cerrarBaseDatos } = await import('../src/servidor/base-datos');
  const db = abrirBaseDatos();
  await migrarEsquemaAutenticacion(db);
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
        headers: { origin: origen, 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.20' },
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
  const peticion = (
    ruta: string,
    opciones: { cookie?: string; cuerpo?: unknown; tipo?: string; origen?: string } = {},
  ) => {
    const { cookie, cuerpo, tipo = 'application/json' } = opciones;
    const conCuerpo = 'cuerpo' in opciones;
    return new Request(`${origen}${ruta}`, {
      method: conCuerpo ? 'POST' : 'GET',
      headers: {
        host: '127.0.0.1:3000',
        origin: opciones.origen ?? origen,
        ...(cookie ? { cookie } : {}),
        ...(conCuerpo ? { 'content-type': tipo } : {}),
      },
      ...(conCuerpo ? { body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) } : {}),
    });
  };
  const rutas = {
    ajustes: await import('../src/app/api/starken/route'),
    ciudades: await import('../src/app/api/starken/ciudades/route'),
    cotizar: await import('../src/app/api/starken/cotizar/route'),
    accion: await import('../src/app/api/accion/route'),
  };
  const { leerConfiguracionStarken } = await import('../src/servidor/starken-configuracion');
  return {
    db,
    usuario,
    admin,
    peticion,
    rutas,
    configuracion: () => leerConfiguracionStarken(db),
    cerrar: () => cerrarBaseDatos(),
  };
}

describe('rutas de Starken: sesión y rol', () => {
  it('sin sesión ninguna ruta responde 401', async () => {
    const m = await montar();
    try {
      for (const r of [
        await m.rutas.ajustes.GET(m.peticion('/api/starken')),
        await m.rutas.ajustes.POST(m.peticion('/api/starken', { cuerpo: configuracionCompleta() })),
        await m.rutas.ciudades.GET(m.peticion('/api/starken/ciudades?tipo=destino')),
        await m.rutas.cotizar.POST(
          m.peticion('/api/starken/cotizar', { cuerpo: { id: crypto.randomUUID() } }),
        ),
      ])
        expect(r.status).toBe(401);
    } finally {
      m.cerrar();
    }
  });

  it('una cuenta sin rol de administración puede ver, pero no guardar: 403 y nada cambia', async () => {
    const m = await montar();
    try {
      const lectura = await m.rutas.ajustes.GET(m.peticion('/api/starken', { cookie: m.usuario }));
      expect(lectura.status).toBe(200);
      const estado = await lectura.json();
      expect(estado).toMatchObject({ disponible: true, puedeEditar: false });
      // Nada de credenciales hacia el navegador.
      expect(JSON.stringify(estado)).not.toMatch(/e2e-clave|e2e-rut|clave|123456/);

      const escritura = await m.rutas.ajustes.POST(
        m.peticion('/api/starken', { cookie: m.usuario, cuerpo: configuracionCompleta() }),
      );
      expect(escritura.status).toBe(403);
      expect(m.configuracion()).toEqual({ origen: null, paquete: paqueteVacio });
      // Tampoco con un cuerpo inválido: primero se decide el permiso.
      const invalida = await m.rutas.ajustes.POST(
        m.peticion('/api/starken', { cookie: m.usuario, cuerpo: '{' }),
      );
      expect(invalida.status).toBe(403);
    } finally {
      m.cerrar();
    }
  });

  it('la escritura desde otro origen se rechaza aunque sea administración', async () => {
    const m = await montar();
    try {
      const r = await m.rutas.ajustes.POST(
        m.peticion('/api/starken', {
          cookie: m.admin,
          cuerpo: configuracionCompleta(),
          origen: 'http://evil.test',
        }),
      );
      expect(r.status).toBe(403);
      expect(m.configuracion().origen).toBeNull();
    } finally {
      m.cerrar();
    }
  });
});

describe('guardar los ajustes de Starken', () => {
  const guardar = (m: Awaited<ReturnType<typeof montar>>, cuerpo: unknown, tipo?: string) =>
    m.rutas.ajustes.POST(m.peticion('/api/starken', { cookie: m.admin, cuerpo, ...(tipo ? { tipo } : {}) }));

  it('rechaza con 400 los cuerpos inválidos, con un mensaje claro, y no toca lo guardado', async () => {
    const m = await montar();
    try {
      await guardar(m, configuracionCompleta());
      const guardada = m.configuracion();
      const casos: [unknown, string][] = [
        ['{', 'Solicitud inválida.'],
        [{}, 'Configuración incompleta o inválida'],
        [{ origen: null }, 'Configuración incompleta o inválida'],
        [{ origen: null, paquete: {} }, 'Configuración incompleta o inválida'],
        [{ ...configuracionCompleta(), extra: true }, 'Configuración incompleta o inválida'],
        [
          { origen: null, paquete: { ...paqueteVacio, PUERTA: { kg: -5, espesorCm: 4 } } },
          'Puertas: El peso por unidad debe ser mayor que cero.',
        ],
        [
          { origen: null, paquete: { ...paqueteVacio, MARCO: { kg: 3, espesorCm: 999 } } },
          'Marcos: El espesor no puede superar 300 cm.',
        ],
        [
          { origen: null, paquete: { ...paqueteVacio, MOLDURA: { kg: 3, espesorCm: null } } },
          'Molduras: Completa el peso y el espesor, o deja ambos vacíos.',
        ],
        [configuracionCompleta('X', 0), 'El código de la ciudad de origen no es válido.'],
      ];
      for (const [cuerpo, mensaje] of casos) {
        const r = await guardar(m, cuerpo);
        expect(r.status, JSON.stringify(cuerpo)).toBe(400);
        expect(((await r.json()) as { error: string }).error).toContain(mensaje);
      }
      expect((await guardar(m, '{}', 'text/plain')).status).toBe(415);
      // Un origen que Starken no conoce.
      const desconocido = await guardar(m, configuracionCompleta('X', 77));
      expect(desconocido.status).toBe(400);
      expect(((await desconocido.json()) as { error: string }).error).toContain(
        'no está entre las ciudades de Starken',
      );
      expect(m.configuracion()).toEqual(guardada);
    } finally {
      m.cerrar();
    }
  });

  it('el nombre del origen sale de la lista de Starken y el ya guardado no se pisa con el del navegador', async () => {
    const m = await montar();
    try {
      const primera = await guardar(m, configuracionCompleta('NOMBRE INVENTADO'));
      expect(primera.status).toBe(200);
      expect(((await primera.json()) as { configuracion: { origen: unknown } }).configuracion.origen).toEqual(
        {
          codigoCiudad: 1,
          nombre: 'SANTIAGO',
        },
      );
      expect(m.configuracion().origen).toEqual({ codigoCiudad: 1, nombre: 'SANTIAGO' });
      // Mismo código con otro nombre: se conserva la entrada guardada.
      await guardar(m, configuracionCompleta('OTRO NOMBRE'));
      expect(m.configuracion().origen?.nombre).toBe('SANTIAGO');
      // Cambiar de ciudad toma el nombre oficial de la nueva.
      await guardar(m, configuracionCompleta('lo que sea', 2));
      expect(m.configuracion().origen).toEqual({ codigoCiudad: 2, nombre: 'TEMUCO' });
      expect(m.configuracion().paquete.PUERTA).toEqual({ kg: 25, espesorCm: 4.5 });
    } finally {
      m.cerrar();
    }
  });

  it('sin Starken configurado se pueden guardar los pesos, pero no un origen nuevo', async () => {
    const m = await montar();
    try {
      vi.stubEnv('NELTUME_STARKEN', '');
      const estado = (await (
        await m.rutas.ajustes.GET(m.peticion('/api/starken', { cookie: m.admin }))
      ).json()) as {
        disponible: boolean;
        mensaje: string;
      };
      expect(estado).toMatchObject({ disponible: false, mensaje: 'Starken no está configurado' });
      const sinOrigen = await guardar(m, { ...configuracionCompleta(), origen: null });
      expect(sinOrigen.status).toBe(200);
      expect(m.configuracion().paquete.PUERTA).toEqual({ kg: 25, espesorCm: 4.5 });
      const conOrigen = await guardar(m, configuracionCompleta());
      expect(conOrigen.status).toBe(503);
      expect(await conOrigen.json()).toMatchObject({
        codigo: 'starken_no_configurado',
        error: 'Starken no está configurado',
      });
    } finally {
      m.cerrar();
    }
  });
});

describe('ciudades y cotización de Starken', () => {
  it('las ciudades las puede pedir cualquier sesión; un tipo desconocido es 400 y sin Starken, 503', async () => {
    const m = await montar();
    try {
      const destino = await m.rutas.ciudades.GET(
        m.peticion('/api/starken/ciudades?tipo=destino', { cookie: m.usuario }),
      );
      expect(destino.status).toBe(200);
      const { ciudades } = (await destino.json()) as { ciudades: { codigoCiudad: number; nombre: string }[] };
      expect(ciudades.find((c) => c.codigoCiudad === 2)?.nombre).toBe('TEMUCO');
      const origenes = await m.rutas.ciudades.GET(
        m.peticion('/api/starken/ciudades?tipo=origen', { cookie: m.usuario }),
      );
      expect(((await origenes.json()) as { ciudades: unknown[] }).ciudades).toHaveLength(3);
      for (const url of ['/api/starken/ciudades', '/api/starken/ciudades?tipo=otro'])
        expect((await m.rutas.ciudades.GET(m.peticion(url, { cookie: m.usuario }))).status).toBe(400);
      vi.stubEnv('NELTUME_STARKEN', '');
      const sin = await m.rutas.ciudades.GET(
        m.peticion('/api/starken/ciudades?tipo=destino', { cookie: m.usuario }),
      );
      expect(sin.status).toBe(503);
      expect(await sin.json()).toMatchObject({ codigo: 'starken_no_configurado' });
    } finally {
      m.cerrar();
    }
  });

  it('cotizar valida el cuerpo, pide la cotización y entrega las tarifas firmadas; aplicar exige esa firma', async () => {
    const m = await montar();
    try {
      const { Servicio } = await import('../src/servidor/servicio');
      const { Almacen } = await import('../src/servidor/almacen');
      const llm = {
        interpretar: vi.fn().mockResolvedValue({
          name: 'actualizar_cotizacion',
          input: {
            items: [
              { modelo: 'MOLCO', madera: 'PINO OREGON', ancho: 0.82, alto: 2, medida: null, cantidad: 3 },
            ],
            cliente: { ...clienteVacio(), nombre: 'Juan Pérez', comuna: 'Temuco' },
          },
        }),
      };
      const servicio = new Servicio(catalogo(), llm, new Almacen(), {
        nombre: 'Paula',
        email: 'paula@neltume.cl',
      });
      const q = (await servicio.ejecutar({ tipo: 'chat', mensaje: 'Cotiza' })).cotizacion;
      const cotizar = (cuerpo: unknown) =>
        m.rutas.cotizar.POST(m.peticion('/api/starken/cotizar', { cookie: m.usuario, cuerpo }));

      expect((await cotizar({ id: 'no-es-uuid' })).status).toBe(400);
      expect((await cotizar({ id: q.id, extra: 1 })).status).toBe(400);
      expect((await cotizar({ id: q.id, codigoCiudad: -3 })).status).toBe(400);
      expect((await cotizar('{')).status).toBe(400);
      expect((await cotizar({ id: crypto.randomUUID() })).status).toBe(404);
      // Sin origen en Ajustes no hay envío que cotizar.
      const sinPesos = await cotizar({ id: q.id });
      expect(sinPesos.status).toBe(400);
      expect(await sinPesos.json()).toMatchObject({ codigo: 'starken_sin_parametros' });

      await m.rutas.ajustes.POST(
        m.peticion('/api/starken', { cookie: m.admin, cuerpo: configuracionCompleta() }),
      );
      const respuesta = await cotizar({ id: q.id });
      expect(respuesta.status).toBe(200);
      const texto = await respuesta.text();
      // Ni credenciales ni nada del entorno en la respuesta.
      expect(texto).not.toMatch(/e2e-clave|e2e-rut|123456/);
      const r = JSON.parse(texto) as {
        estado: string;
        destino: { codigoCiudad: number; nombre: string };
        tarifas: {
          tipoEntrega: string;
          servicio: string;
          dias: number;
          costoTotal: number;
          neto: number;
          vence: string;
          firma: string;
        }[];
      };
      expect(r.estado).toBe('tarifas');
      expect(r.destino).toEqual({ codigoCiudad: 2, nombre: 'TEMUCO' });
      expect(r.tarifas.map((t) => [t.tipoEntrega, t.neto])).toEqual([
        ['AGENCIA', 75000],
        ['DOMICILIO', 85000],
      ]);
      for (const t of r.tarifas) {
        expect(t.firma).toMatch(/^[\w-]{43}$/);
        expect(Date.parse(t.vence)).toBeGreaterThan(Date.now());
      }

      // La acción exige la firma ya en el esquema de la ruta…
      const [domicilio] = r.tarifas.filter((t) => t.tipoEntrega === 'DOMICILIO');
      const aplicada = {
        tipoEntrega: domicilio.tipoEntrega,
        servicio: domicilio.servicio,
        dias: domicilio.dias,
        costoTotal: domicilio.costoTotal,
        ciudadDestino: r.destino.nombre,
        codigoCiudadDestino: r.destino.codigoCiudad,
        vence: domicilio.vence,
        firma: domicilio.firma,
      };
      const editar = (tarifaStarken: unknown) =>
        m.rutas.accion.POST(
          m.peticion('/api/accion', {
            cookie: m.usuario,
            cuerpo: {
              tipo: 'editar',
              id: q.id,
              actualizada: q.actualizada,
              despacho: { transporte: 'Starken', valor: domicilio.neto },
              tarifaStarken,
            },
          }),
        );
      // (JSON no lleva las propiedades undefined: la petición va sin firma.)
      expect((await editar({ ...aplicada, firma: undefined })).status).toBe(400);
      expect((await editar({ ...aplicada, firma: 'x' })).status).toBe(400);
      expect((await editar({ ...aplicada, otro: 1 })).status).toBe(400);
      // …y el servicio, que el costo sea el firmado.
      const aplicar = (tarifaStarken: typeof aplicada) =>
        servicio.ejecutar({
          tipo: 'editar',
          id: q.id,
          actualizada: q.actualizada,
          despacho: { transporte: 'Starken', valor: domicilio.neto },
          tarifaStarken,
        });
      await expect(aplicar({ ...aplicada, costoTotal: 11900 })).rejects.toThrow(
        'La tarifa de Starken no es válida para esta cotización',
      );
      expect(new Almacen().obtener(q.id)?.flete).toBe(0);
      // La tarifa auténtica se aplica y queda en la actividad.
      const editada = (await aplicar(aplicada)).cotizacion;
      expect(editada.flete).toBe(85000);
      expect(
        new Almacen()
          .eventos(q.id)
          .some((e) =>
            e.detalle?.includes('Tarifa Starken aplicada: Domicilio · 3 días · $101.150 IVA incl.'),
          ),
      ).toBe(true);
    } finally {
      m.cerrar();
    }
  });
});
