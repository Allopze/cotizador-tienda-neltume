import { afterEach, describe, expect, it } from 'vitest';
import { CLAVE, montarInstalacion, ORIGEN } from './sesion-prueba';

// «Mi cuenta» → sesiones activas: lista solo las de la propia cuenta, sin tokens, y permite cerrar una o las demás.

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => {
  await desmontar?.();
  desmontar = undefined;
});

const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function montar() {
  const instalacion = await montarInstalacion('sesiones');
  desmontar = instalacion.desmontar;
  const ana = await instalacion.cuenta('ana@neltume.test');
  const bea = await instalacion.cuenta('bea@neltume.test');
  // Una segunda sesión de Ana, desde un iPhone.
  const login = await instalacion.auth.handler(
    new Request(`${ORIGEN}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { origin: ORIGEN, 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.9', 'user-agent': UA_IPHONE },
      body: JSON.stringify({ email: 'ana@neltume.test', password: CLAVE }),
    }),
  );
  expect(login.ok).toBe(true);
  const cookieTelefono = login.headers.getSetCookie().map((c) => c.split(';', 1)[0]).join('; ');
  const rutas = await import('../src/app/api/sesiones/route');
  const listar = async (cookie: string) => rutas.GET(instalacion.peticion('/api/sesiones', { cookie }));
  const accion = async (cookie: string, json: unknown) => rutas.POST(instalacion.peticion('/api/sesiones', { cookie, json }));
  return { ...instalacion, ana, bea, cookieTelefono, listar, accion };
}

interface Sesion {
  id: string;
  dispositivo: string | null;
  ip: string | null;
  actual: boolean;
}

describe('Sesiones de la propia cuenta', () => {
  it('lista solo las sesiones de la cuenta, marca la actual y no entrega tokens', async () => {
    const { ana, listar } = await montar();
    const respuesta = await listar(ana.cookie);
    expect(respuesta.status).toBe(200);
    const texto = await respuesta.text();
    expect(texto).not.toMatch(/token/i);
    const { sesiones } = JSON.parse(texto) as { sesiones: Sesion[] };
    expect(sesiones).toHaveLength(2);
    expect(sesiones[0].actual).toBe(true);
    expect(sesiones[1]).toMatchObject({ actual: false, dispositivo: 'Safari en iPhone', ip: '198.51.100.9' });
  });

  it('exige sesión', async () => {
    const { listar } = await montar();
    expect((await listar('')).status).toBe(401);
  });

  it('cierra otra sesión por su id, pero no la de otra cuenta', async () => {
    const { ana, bea, cookieTelefono, listar, accion } = await montar();
    const { sesiones } = (await (await listar(ana.cookie)).json()) as { sesiones: Sesion[] };
    const telefono = sesiones.find((s) => !s.actual)!;
    const deBea = ((await (await listar(bea.cookie)).json()) as { sesiones: Sesion[] }).sesiones[0];

    const ajena = await accion(ana.cookie, { accion: 'cerrar', id: deBea.id });
    expect(ajena.status).toBe(404);
    expect((await listar(bea.cookie)).status).toBe(200);

    const cerrar = await accion(ana.cookie, { accion: 'cerrar', id: telefono.id });
    expect(cerrar.status).toBe(200);
    expect(((await cerrar.json()) as { sesiones: Sesion[] }).sesiones.map((s) => s.id)).not.toContain(telefono.id);
    expect((await listar(cookieTelefono)).status).toBe(401);
  });

  it('«Cerrar las demás» deja solo la sesión actual', async () => {
    const { ana, bea, cookieTelefono, listar, accion } = await montar();
    const respuesta = await accion(ana.cookie, { accion: 'cerrar-demas' });
    expect(respuesta.status).toBe(200);
    const { sesiones } = (await respuesta.json()) as { sesiones: Sesion[] };
    expect(sesiones).toHaveLength(1);
    expect(sesiones[0].actual).toBe(true);
    expect((await listar(cookieTelefono)).status).toBe(401);
    // Las sesiones de otras cuentas no se tocan.
    expect((await listar(bea.cookie)).status).toBe(200);
  });
});
