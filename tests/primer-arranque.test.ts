import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { montarInstalacion } from './sesion-prueba';

// O5 / 5.6: sin cuentas, la primera se crea desde la página de inicio de sesión con un código de un solo uso que el
// servidor escribe en su registro (en disco solo queda el hash). Sin el código, o con cuentas, no se crea nada.

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await desmontar?.();
  desmontar = undefined;
});

/** Captura lo que el servidor escribe en su registro y devuelve el último código anunciado. */
function capturarRegistro() {
  const lineas: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void lineas.push(args.join(' ')));
  return {
    lineas,
    ultimoCodigo: () => {
      const codigos = lineas.join('\n').match(/Código de un solo uso: ([A-Z0-9-]+)/g) ?? [];
      return codigos.at(-1)?.split(': ')[1] ?? '';
    },
  };
}

async function montar() {
  const instalacion = await montarInstalacion('primer-arranque');
  desmontar = instalacion.desmontar;
  const ruta = await import('../src/app/api/primer-arranque/route');
  const modulo = await import('../src/servidor/primer-arranque');
  const crear = (json: unknown) => ruta.POST(instalacion.peticion('/api/primer-arranque', { json }));
  const cuentas = () => (instalacion.db.prepare('SELECT email, role FROM "user"').all() as { email: string; role: string }[]);
  const archivo = join(instalacion.directorio, modulo.ARCHIVO_CODIGO);
  return { ...instalacion, ruta, modulo, crear, cuentas, archivo };
}

const datos = (codigo: string, email = 'ana@neltume.test') => ({
  codigo,
  nombre: 'Ana',
  email,
  password: 'clave-de-ana-segura',
});

describe('Primer arranque sin cuentas', () => {
  it('anuncia un código en el registro, guarda solo su hash y crea la primera cuenta administradora', async () => {
    const registro = capturarRegistro();
    const { ruta, peticion, crear, cuentas, archivo, db } = await montar();

    const estado = await ruta.GET(peticion('/api/primer-arranque'));
    expect(estado.status).toBe(200);
    expect((await estado.json()).pendiente).toBe(true);
    const codigo = registro.ultimoCodigo();
    expect(codigo).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const guardado = readFileSync(archivo, 'utf8');
    expect(guardado).not.toContain(codigo);
    expect(guardado).not.toContain(codigo.replaceAll('-', ''));

    // Sin código, con uno inventado o con datos incompletos no se crea nada.
    expect((await crear({ nombre: 'Ana', email: 'ana@neltume.test', password: 'clave-de-ana-segura' })).status).toBe(400);
    expect((await crear(datos('AAAA-BBBB-CCCC'))).status).toBe(403);
    expect(cuentas()).toEqual([]);

    // El código se acepta sin guiones y en minúsculas.
    const creada = await crear(datos(codigo.replaceAll('-', '').toLowerCase()));
    expect(creada.status).toBe(201);
    expect(cuentas()).toEqual([{ email: 'ana@neltume.test', role: 'admin' }]);
    expect(existsSync(archivo)).toBe(false);
    expect(db.prepare('SELECT actor, objetivo, accion FROM auditoria_cuentas').all()).toEqual([
      { actor: 'primer arranque', objetivo: 'ana@neltume.test', accion: 'crear-primera' },
    ]);

    // Con una cuenta la ruta deja de existir, incluso con el mismo código.
    expect((await crear(datos(codigo, 'intrusa@neltume.test'))).status).toBe(404);
    expect((await ruta.GET(peticion('/api/primer-arranque'))).status).toBe(404);
    expect(cuentas()).toHaveLength(1);
  });

  it('con cuentas existentes responde 404 y no genera código', async () => {
    const registro = capturarRegistro();
    const { ruta, peticion, crear, cuenta, cuentas, archivo, modulo } = await montar();
    await cuenta('admin@neltume.test');
    expect((await ruta.GET(peticion('/api/primer-arranque'))).status).toBe(404);
    expect((await crear(datos('AAAA-BBBB-CCCC', 'otra@neltume.test'))).status).toBe(404);
    expect(modulo.asegurarCodigoPrimerArranque({ renovar: true })).toBeNull();
    expect(existsSync(archivo)).toBe(false);
    expect(registro.ultimoCodigo()).toBe('');
    expect(cuentas()).toHaveLength(1);
  });

  it('un código vencido no sirve', async () => {
    const registro = capturarRegistro();
    const { modulo, crear, cuentas } = await montar();
    modulo.asegurarCodigoPrimerArranque({ ahora: new Date(Date.now() - modulo.VIGENCIA_CODIGO_MS - 1000) });
    const vencido = registro.ultimoCodigo();
    expect((await crear(datos(vencido))).status).toBe(403);
    expect(cuentas()).toEqual([]);
  });

  it('tras demasiados intentos fallidos el código se reemplaza por uno nuevo en el registro', async () => {
    const registro = capturarRegistro();
    const { modulo, crear, cuentas } = await montar();
    modulo.asegurarCodigoPrimerArranque();
    const original = registro.ultimoCodigo();
    for (let i = 0; i < modulo.MAX_INTENTOS_CODIGO; i++) expect((await crear(datos('ZZZZ-ZZZZ-ZZZZ'))).status).toBe(403);
    expect((await crear(datos(original))).status).toBe(403);
    const nuevo = registro.ultimoCodigo();
    expect(nuevo).not.toBe(original);
    expect((await crear(datos(nuevo))).status).toBe(201);
    expect(cuentas()).toHaveLength(1);
  });

  it('dos envíos simultáneos con el código crean una sola cuenta', async () => {
    const registro = capturarRegistro();
    const { modulo, crear, cuentas } = await montar();
    modulo.asegurarCodigoPrimerArranque();
    const codigo = registro.ultimoCodigo();
    const estados = (
      await Promise.all([crear(datos(codigo, 'a@neltume.test')), crear(datos(codigo, 'b@neltume.test'))])
    ).map((r) => r.status);
    expect(estados.sort()).toEqual([201, 404]);
    expect(cuentas()).toHaveLength(1);
  });

  it('al iniciar el contenedor (renovar) el código anterior deja de valer', async () => {
    const registro = capturarRegistro();
    const { modulo, crear } = await montar();
    modulo.asegurarCodigoPrimerArranque();
    const anterior = registro.ultimoCodigo();
    expect(modulo.asegurarCodigoPrimerArranque()?.generado).toBe(false);
    modulo.asegurarCodigoPrimerArranque({ renovar: true });
    expect(registro.ultimoCodigo()).not.toBe(anterior);
    expect((await crear(datos(anterior))).status).toBe(403);
  });
});
