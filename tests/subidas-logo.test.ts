import { afterEach, describe, expect, it } from 'vitest';
import { MAX_BYTES_REFERENCIA } from '../src/negocio/personalizados';
import { montarInstalacion, ORIGEN } from './sesion-prueba';

// G1 y G2: la subida de referencias exige Content-Length y lee con tope (no confía en lo declarado), y el logo
// administrable se sirve con CSP y validación de Host.

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => {
  await desmontar?.();
  desmontar = undefined;
});

async function montar() {
  const instalacion = await montarInstalacion('subidas');
  desmontar = instalacion.desmontar;
  const { cookie } = await instalacion.cuenta('admin@neltume.test');
  const { POST } = await import('../src/app/api/referencias/route');
  return { cookie, POST };
}

/** Un formulario multipart serializado: bytes y su content-type con el boundary. */
async function formulario(archivo: Uint8Array<ArrayBuffer>, nombre = 'foto.png') {
  const form = new FormData();
  form.set('archivo', new File([archivo], nombre, { type: 'image/png' }));
  const serializado = new Request(ORIGEN, { method: 'POST', body: form });
  return { bytes: new Uint8Array(await serializado.arrayBuffer()), tipo: serializado.headers.get('content-type')! };
}

const subir = (cookie: string, cuerpo: BodyInit, cabeceras: Record<string, string>) =>
  new Request(`${ORIGEN}/api/referencias`, {
    method: 'POST',
    headers: { host: '127.0.0.1:3000', origin: ORIGEN, cookie, ...cabeceras },
    body: cuerpo,
    duplex: 'half',
  } as RequestInit);

/** Cuerpo enviado por partes (sin largo conocido), como un envío chunked. */
function porPartes(bytes: Uint8Array, parte = 1024 * 1024) {
  let posicion = 0;
  return new ReadableStream<Uint8Array>({
    pull(control) {
      if (posicion >= bytes.length) return control.close();
      control.enqueue(bytes.slice(posicion, posicion + parte));
      posicion += parte;
    },
  });
}

describe('Subida de referencias del cliente', () => {
  it('guarda una imagen que declara su tamaño', async () => {
    const { cookie, POST } = await montar();
    const { bytes, tipo } = await formulario(PNG);
    const respuesta = await POST(
      subir(cookie, bytes, { 'content-type': tipo, 'content-length': String(bytes.length) }),
    );
    expect(respuesta.status).toBe(200);
    expect((await respuesta.json()).referencia.tipo).toBe('image/png');
  });

  it('rechaza un cuerpo sin Content-Length (envío por partes) sin leerlo', async () => {
    const { cookie, POST } = await montar();
    const { bytes, tipo } = await formulario(PNG);
    const respuesta = await POST(subir(cookie, porPartes(bytes), { 'content-type': tipo }));
    expect(respuesta.status).toBe(411);
    expect((await respuesta.json()).codigo).toBe('archivo_invalido');
  });

  it('corta la lectura si el cuerpo supera el tope aunque declare un tamaño pequeño', async () => {
    const { cookie, POST } = await montar();
    const grande = new Uint8Array(MAX_BYTES_REFERENCIA + 512 * 1024);
    grande.set(PNG);
    const { bytes, tipo } = await formulario(grande);
    const respuesta = await POST(
      subir(cookie, porPartes(bytes), { 'content-type': tipo, 'content-length': '2048' }),
    );
    expect(respuesta.status).toBe(413);
  });

  it('rechaza de entrada un Content-Length mayor que el tope', async () => {
    const { cookie, POST } = await montar();
    const respuesta = await POST(
      subir(cookie, porPartes(PNG), {
        'content-type': 'multipart/form-data; boundary=x',
        'content-length': String(MAX_BYTES_REFERENCIA * 2),
      }),
    );
    expect(respuesta.status).toBe(413);
  });
});

describe('Logo administrable', () => {
  it('es público pero se sirve con CSP con sandbox, nosniff y Host validado', async () => {
    const instalacion = await montarInstalacion('logo');
    desmontar = instalacion.desmontar;
    const { GET } = await import('../src/app/api/logo/route');
    const respuesta = await GET(instalacion.peticion('/api/logo'));
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get('content-type')).toMatch(/^image\/svg\+xml/);
    expect(respuesta.headers.get('content-security-policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    expect(respuesta.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await respuesta.text()).toMatch(/<svg/);

    const ajeno = await GET(
      new Request(`${ORIGEN}/api/logo`, { headers: { host: 'malicioso.example' } }),
    );
    expect(ajeno.status).toBe(403);
  });
});
