import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { avisoSesionExpirada, campoDelError } from '../src/app/login/mensajes';
import { describirDispositivo } from '../src/servidor/dispositivo';

// #22, #29 y #35: aviso del login según la pantalla de origen, mensaje propio para los 52x de Cloudflare, y
// formularios con mensajes propios ligados al campo.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** Carga solicitud.ts con un `window` y un `fetch` simulados (el módulo corre en el navegador). */
async function solicitudEn(ruta: string, respuesta?: Response) {
  const replace = vi.fn();
  vi.stubGlobal('window', { location: { pathname: ruta, replace } });
  if (respuesta) vi.stubGlobal('fetch', vi.fn(async () => respuesta));
  const modulo = await import('../src/app/solicitud');
  return { ...modulo, replace };
}

describe('#22 Login tras vencer la sesión', () => {
  it('el borrador solo se promete si se llegó desde el cotizador', () => {
    expect(avisoSesionExpirada('cotizador')).toMatch(/tu borrador se conservó/);
    for (const desde of ['historial', 'catalogo', 'ajustes', null])
      expect(avisoSesionExpirada(desde)).toBe('Tu sesión expiró. Vuelve a ingresar para continuar.');
  });

  it('solicitud.ts agrega la pantalla de origen al redirigir', async () => {
    const { pantallaDeRuta, urlSesionExpirada, esPantallaLogin } = await solicitudEn('/historial');
    expect(pantallaDeRuta('/')).toBe('cotizador');
    expect(pantallaDeRuta('/historial')).toBe('historial');
    expect(pantallaDeRuta('/catalogo/importar')).toBe('catalogo');
    expect(pantallaDeRuta('/otra-cosa')).toBeNull();
    expect(urlSesionExpirada('/')).toBe('/login?motivo=sesion&desde=cotizador');
    expect(urlSesionExpirada('/ajustes')).toBe('/login?motivo=sesion&desde=ajustes');
    expect(urlSesionExpirada('/desconocida')).toBe('/login?motivo=sesion');
    expect(esPantallaLogin('historial')).toBe(true);
    expect(esPantallaLogin('https://malicioso.test')).toBe(false);
    expect(esPantallaLogin('toString')).toBe(false);
  });

  it('un 401 sin oyentes redirige al login con la pantalla de origen', async () => {
    const { pedirJSON, replace } = await solicitudEn('/historial', new Response('{}', { status: 401 }));
    await expect(pedirJSON('/api/accion')).rejects.toThrow(/sesión expiró/);
    expect(replace).toHaveBeenCalledWith('/login?motivo=sesion&desde=historial');
  });

  it('el login no usa el aviso fijo y vuelve a la pantalla de origen', () => {
    const fuente = readFileSync(join(process.cwd(), 'src/app/login/login-form.tsx'), 'utf8');
    expect(fuente).not.toMatch(/tu borrador se conservó/);
    expect(fuente).toMatch(/avisoSesionExpirada\(origen\)/);
    expect(fuente).toMatch(/PANTALLAS_LOGIN\[origen\]/);
  });
});

describe('#29 Errores 52x de Cloudflare', () => {
  it.each([522, 523, 524])('el %i tiene un mensaje propio, no el genérico del servidor', async (status) => {
    const html = new Response('<html>Cloudflare</html>', { status, headers: { 'content-type': 'text/html' } });
    const { pedirJSON, MENSAJES } = await solicitudEn('/', html);
    await expect(pedirJSON('/api/accion')).rejects.toThrow(MENSAJES.lento);
    expect(MENSAJES.lento).toMatch(/^El servidor tardó demasiado en responder/);
  });

  it('el 500 sigue con el mensaje del servidor', async () => {
    const { pedirJSON } = await solicitudEn('/', new Response('', { status: 500 }));
    await expect(pedirJSON('/api/accion')).rejects.toThrow(/error 500/);
  });
});

describe('#35 Formularios con mensajes propios', () => {
  it('el error del servidor en la primera cuenta va al campo que corresponde', () => {
    expect(campoDelError(403, 'El código no es válido o ya venció.')).toBe('codigo');
    expect(campoDelError(400, 'Ingresa el código del registro del servidor.')).toBe('codigo');
    expect(campoDelError(400, 'Ingresa tu nombre.')).toBe('nombre');
    expect(campoDelError(400, 'Ingresa un correo válido.')).toBe('correo');
    expect(campoDelError(400, 'La contraseña debe tener al menos 8 caracteres.')).toBe('clave');
    expect(campoDelError(500, 'El cotizador tuvo un problema (error 500).')).toBeNull();
  });

  it.each([
    'src/app/login/login-form.tsx',
    'src/app/login/primera-cuenta.tsx',
    'src/app/cambiar-clave.tsx',
    'src/app/ajustes/crear-usuario.tsx',
  ])('%s usa noValidate y liga el error al campo', (archivo) => {
    const fuente = readFileSync(join(process.cwd(), archivo), 'utf8');
    expect(fuente).toMatch(/noValidate/);
    expect(fuente).toMatch(/useErrorCampo/);
    expect(fuente).toMatch(/errores\.atributos\(/);
    // Sin un mensaje suelto con un id fijo que no apunta al campo que falló.
    expect(fuente).not.toMatch(/id="(login|primera-cuenta)-error"/);
  });
});

describe('Descripción del dispositivo', () => {
  it('reconoce navegadores y sistemas comunes', () => {
    expect(
      describirDispositivo(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0',
      ),
    ).toBe('Edge en Windows');
    expect(
      describirDispositivo('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36'),
    ).toBe('Chrome en Android');
    expect(describirDispositivo('Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe(
      'Firefox en macOS',
    );
    expect(describirDispositivo('curl/8.0')).toBeNull();
    expect(describirDispositivo(null)).toBeNull();
  });
});
