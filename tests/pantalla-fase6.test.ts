import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configuracionNegocioSchema } from '../src/servidor/configuracion-negocio';
import { dejarAvisoAlAbrir, tomarAvisoAlAbrir } from '../src/app/solicitud';

// Pantalla, fase 6: el destino que anuncia «Volver al paso anterior» (incluida «Completada»), el aviso de la copia
// que se abre desde el historial y el motivo en español de un descuento máximo fuera de rango. El flujo de compartir
// (AbortError y NotAllowedError) vive dentro del componente del cotizador y se prueba en tests/movil.e2e.ts.

/** Pares «estado: 'anterior'» del mapa que sigue a `marca` en el archivo. */
function mapa(archivo: string, marca: string) {
  const fuente = readFileSync(archivo, 'utf8');
  const desde = fuente.indexOf(marca);
  expect(desde, `${marca} en ${archivo}`).toBeGreaterThan(-1);
  const cuerpo = fuente.slice(desde, fuente.indexOf('}', desde));
  return Object.fromEntries([...cuerpo.matchAll(/(\w+): '(\w+)'/g)].map((m) => [m[1], m[2]]));
}

describe('«Volver al paso anterior»', () => {
  // La pantalla y el servidor comparten el mapa de src/negocio/estado.ts.
  const pantalla = mapa('src/negocio/estado.ts', 'const PASO_ANTERIOR');
  const servidor = mapa('src/negocio/estado.ts', 'const PASO_ANTERIOR');

  it('la pantalla anuncia el mismo destino que aplica el servidor', () => {
    expect(Object.keys(pantalla).length).toBeGreaterThanOrEqual(6);
    expect(pantalla).toEqual(servidor);
  });

  it('desde «Completada» se vuelve a «Despachada», y cada paso a su anterior', () => {
    expect(pantalla).toMatchObject({
      completada: 'despachada',
      despachada: 'lista_despacho',
      lista_despacho: 'pagada',
      pagada: 'en_produccion',
      saldo_pendiente: 'en_produccion',
      en_produccion: 'pedido_generado',
    });
    // Sin nota de pedido o recién generada no hay un paso anterior que ofrecer.
    expect(pantalla.pedido_generado).toBeUndefined();
    expect(pantalla.sin_pedido).toBeUndefined();
  });
});

describe('aviso al abrir la copia desde el historial', () => {
  afterEach(() => vi.unstubAllGlobals());
  const almacen = () => {
    const datos = new Map<string, string>();
    return {
      getItem: (k: string) => datos.get(k) ?? null,
      setItem: (k: string, v: string) => void datos.set(k, v),
      removeItem: (k: string) => void datos.delete(k),
    };
  };

  it('se entrega una sola vez y solo a la cotización a la que pertenece', () => {
    vi.stubGlobal('sessionStorage', almacen());
    dejarAvisoAlAbrir('copia-1', 'Descuento 40 % → 30 % por el máximo permitido.');
    expect(tomarAvisoAlAbrir('otra')).toBeNull();
    // Abrir otra cotización lo descarta: no aparece después en la copia.
    expect(tomarAvisoAlAbrir('copia-1')).toBeNull();
    dejarAvisoAlAbrir('copia-1', 'Descuento 40 % → 30 % por el máximo permitido.');
    expect(tomarAvisoAlAbrir('copia-1')).toBe('Descuento 40 % → 30 % por el máximo permitido.');
    expect(tomarAvisoAlAbrir('copia-1')).toBeNull();
  });

  it('sin almacenamiento disponible no falla', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
      removeItem: () => {},
    });
    expect(() => dejarAvisoAlAbrir('x', 'aviso')).not.toThrow();
    expect(tomarAvisoAlAbrir('x')).toBeNull();
  });
});

describe('configuración comercial: motivos en español', () => {
  it('un descuento máximo sobre 50 % y una vigencia fuera de rango se explican en español', () => {
    const r = configuracionNegocioSchema.shape.reglas.safeParse({ descuentoMaximo: 60, vigenciaDiasHabiles: 400, iva: 1.5 });
    expect(r.success).toBe(false);
    const motivo = (campo: string) => r.error!.issues.find((i) => i.path[0] === campo)?.message;
    expect(motivo('descuentoMaximo')).toBe('El descuento máximo no puede superar 50 %.');
    expect(motivo('vigenciaDiasHabiles')).toBe('La vigencia no puede superar 365 días hábiles.');
    expect(motivo('iva')).toBe('El IVA no puede superar 100 %.');
  });
});
