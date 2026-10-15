import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { falloCompartir } from '../src/app/compartir';
import {
  ACCIONES_CUENTA,
  faltaOtraAdministradora,
  fechaHoraCuenta,
  textoAccionCuenta,
} from '../src/app/ajustes/cuentas';
import { campoDelError, CLAVE_PRIMERA_CUENTA, validarPrimeraCuenta } from '../src/app/login/mensajes';
import { abrirBaseDatos, cerrarBaseDatos } from '../src/servidor/base-datos';
import {
  registrarCambioCuenta,
  registrarInicioSesion,
  ultimosCambiosCuentas,
  type AccionCuenta,
} from '../src/servidor/auditoria-cuentas';

// Pantalla, al nivel de la lógica (sin navegador): qué se avisa cuando compartir el PDF se cancela o se rechaza, el
// formulario de la primera cuenta, el registro de cambios de Ajustes → Usuarios y el aviso de una sola
// administradora. El recorrido con la hoja de compartir simulada está en tests/movil.e2e.ts.

describe('compartir el PDF', () => {
  const abortado = new DOMException('Share canceled', 'AbortError');
  const noPermitido = new DOMException('Must be handling a user gesture', 'NotAllowedError');

  it('si la persona cierra la hoja de compartir no se avisa nada, esté o no listo el PDF', () => {
    expect(falloCompartir(abortado, false)).toEqual({ tipo: 'nada' });
    expect(falloCompartir(abortado, true)).toEqual({ tipo: 'nada' });
  });

  it('un rechazo por falta de toque tras descargar el PDF ofrece compartir de nuevo', () => {
    expect(falloCompartir(noPermitido, false)).toEqual({
      tipo: 'otro_toque',
      texto: 'El PDF está listo para compartir.',
    });
  });

  it('un segundo rechazo con el PDF ya listo, u otro error, explica que lo descargue', () => {
    const explica = {
      tipo: 'error',
      texto: 'No se pudo compartir el PDF. Descárgalo y envíalo desde tus archivos.',
    };
    expect(falloCompartir(noPermitido, true)).toEqual(explica);
    expect(falloCompartir(new DOMException('No se pudo leer', 'DataError'), false)).toEqual(explica);
    expect(falloCompartir(new TypeError('files no admitido'), false)).toEqual(explica);
    // Solo el DOMException del navegador cuenta como cancelación: un Error con ese nombre no se calla.
    expect(falloCompartir(Object.assign(new Error('x'), { name: 'AbortError' }), false)).toEqual(explica);
  });
});

describe('la primera cuenta', () => {
  const datos = {
    codigo: 'ABCD-1234',
    nombre: 'Paula Soto',
    email: 'paula@neltume.cl',
    password: 'clave-segura-1',
    repetida: 'clave-segura-1',
  };

  it('un formulario completo se envía', () => {
    expect(validarPrimeraCuenta(datos)).toBeNull();
    // El correo se recorta como lo hace el servidor.
    expect(validarPrimeraCuenta({ ...datos, email: '  paula@neltume.cl ' })).toBeNull();
  });

  it('cada problema va al campo que lo causa, en el orden del formulario', () => {
    const campo = (cambios: Partial<typeof datos>) => validarPrimeraCuenta({ ...datos, ...cambios })?.campo;
    expect(campo({ codigo: '   ' })).toBe('codigo');
    expect(campo({ nombre: '' })).toBe('nombre');
    expect(campo({ email: '' })).toBe('correo');
    expect(campo({ email: 'paula@neltume' })).toBe('correo');
    expect(campo({ password: 'corta', repetida: 'corta' })).toBe('clave');
    expect(campo({ repetida: 'otra-clave-1' })).toBe('repetida');
    // Con todo vacío se señala el primero.
    expect(validarPrimeraCuenta({ codigo: '', nombre: '', email: '', password: '', repetida: '' })).toEqual({
      campo: 'codigo',
      mensaje: 'Pega el código que aparece en el registro del servidor.',
    });
  });

  it('la contraseña admite de 8 a 128 caracteres, como Better Auth', () => {
    expect(CLAVE_PRIMERA_CUENTA).toEqual({ minimo: 8, maximo: 128 });
    const clave = (n: number) => validarPrimeraCuenta({ ...datos, password: 'x'.repeat(n), repetida: 'x'.repeat(n) });
    expect(clave(7)).toEqual({ campo: 'clave', mensaje: 'La contraseña debe tener entre 8 y 128 caracteres.' });
    expect(clave(8)).toBeNull();
    expect(clave(128)).toBeNull();
    expect(clave(129)?.campo).toBe('clave');
  });

  it('el error del servidor vuelve al mismo campo que la validación propia', () => {
    expect(campoDelError(403, 'El código no es válido o ya venció.')).toBe(validarPrimeraCuenta({ ...datos, codigo: '' })!.campo);
    expect(campoDelError(400, 'La contraseña debe tener al menos 8 caracteres.')).toBe(
      validarPrimeraCuenta({ ...datos, password: 'x' })!.campo,
    );
  });
});

describe('registro de cambios de las cuentas', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      cerrarBaseDatos(join(dir, 'cotizador.sqlite'));
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('cada movimiento que registra el servidor se lee en español; uno desconocido se muestra tal cual', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'neltume-cuentas-'));
    dirs.push(dir);
    const db = abrirBaseDatos(join(dir, 'cotizador.sqlite'));
    const acciones = Object.keys(ACCIONES_CUENTA) as AccionCuenta[];
    for (const accion of acciones)
      registrarCambioCuenta({ actor: 'admin@neltume.test', objetivo: 'persona@neltume.test', accion }, db);
    registrarInicioSesion(db, { correo: 'persona@neltume.test', correcto: false, detalle: 'Chrome en macOS · 192.0.2.1' });
    const textos = ultimosCambiosCuentas(50, db).map((c) => textoAccionCuenta(c.accion));
    expect(textos).toHaveLength(acciones.length + 1);
    for (const texto of textos) expect(acciones).not.toContain(texto);
    expect(textos[0]).toBe('Intento fallido de inicio de sesión');
    expect(textoAccionCuenta('crear-primera')).toBe('Creó la primera cuenta');
    expect(textoAccionCuenta('fusionar')).toBe('fusionar');
  });

  it('la fecha se muestra en la hora de Chile: un cambio a las 21:30 no aparece al día siguiente', () => {
    // 00:30 UTC del jueves 15 son las 21:30 del miércoles 14 en Chile (UTC−3).
    const texto = fechaHoraCuenta('2026-10-15T00:30:00.000Z');
    expect(texto).toMatch(/^14 oct 2026/);
    expect(texto).toMatch(/09:30|21:30/);
    expect(texto).not.toMatch(/15 oct/);
  });
});

describe('aviso de una sola administradora', () => {
  const admin = (activo = true) => ({ rol: 'admin', activo });
  it('avisa con menos de dos administradoras activas; las desactivadas y las sin permisos no cuentan', () => {
    expect(faltaOtraAdministradora([admin()])).toBe(true);
    expect(faltaOtraAdministradora([admin(), admin(false)])).toBe(true);
    expect(faltaOtraAdministradora([admin(), { rol: 'user', activo: true }])).toBe(true);
    expect(faltaOtraAdministradora([admin(), admin()])).toBe(false);
    expect(faltaOtraAdministradora([admin(), admin(), admin(false)])).toBe(false);
  });
});
