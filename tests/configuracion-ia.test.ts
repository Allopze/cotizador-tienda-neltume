import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ajustesPredeterminados } from '../src/asistente/ajustes';
import { ConfiguracionIA, claveQuitable, textoDiagnostico, type EstadoAjustes } from '../src/app/configuracion-ia';
import { guardarDiagnosticoIA, leerDiagnosticoRespuesta, ultimoDiagnosticoIA } from '../src/app/diagnostico-ia';

const pantalla = (fuente: EstadoAjustes['commandcodeClaveFuente']) =>
  renderToStaticMarkup(
    createElement(ConfiguracionIA, {
      estado: {
        ajustes: ajustesPredeterminados(),
        commandcodeClave: fuente === 'ajustes' || fuente === 'entorno',
        commandcodeClaveFuente: fuente,
        asistenteConfigurado: fuente === 'ajustes' || fuente === 'entorno',
        puedeEditar: true,
      },
      errorCarga: '',
      reintentar: () => {},
      guardado: () => {},
      avisar: () => 0,
    }),
  );

describe('clave de la IA en Ajustes', () => {
  it('una clave guardada que ya no se puede leer se avisa y se puede quitar, no solo reemplazar', () => {
    const html = pantalla('ilegible');
    expect(html).toContain('La clave guardada ya no se puede leer. Vuelve a ingresarla aquí.');
    expect(html).toContain('Quitar clave');
  });

  it('el botón y la acción de quitar aceptan la misma clave: también la ilegible', () => {
    // quitarApiKey vuelve sin hacer nada si claveQuitable es falso: el botón no puede quedar sin efecto.
    expect(claveQuitable({ commandcodeClave: false, commandcodeClaveFuente: 'ilegible' })).toBe(true);
    expect(claveQuitable({ commandcodeClave: true, commandcodeClaveFuente: 'ajustes' })).toBe(true);
    expect(claveQuitable({ commandcodeClave: true, commandcodeClaveFuente: 'entorno' })).toBe(true);
    expect(claveQuitable({ commandcodeClave: false, commandcodeClaveFuente: 'ninguna' })).toBe(false);
  });

  it('sin clave no hay nada que quitar; con una clave legible sí', () => {
    expect(pantalla('ninguna')).not.toContain('Quitar clave');
    expect(pantalla('ajustes')).toContain('Quitar clave');
  });
});

describe('#38 · última respuesta del chat en Avanzado', () => {
  afterEach(() => vi.unstubAllGlobals());
  /** sessionStorage mínimo: las pruebas corren en Node. */
  const memoria = () => {
    const datos = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => datos.get(k) ?? null,
      setItem: (k: string, v: string) => void datos.set(k, v),
      removeItem: (k: string) => void datos.delete(k),
    });
    return datos;
  };

  it('guarda el diagnóstico de la respuesta del chat y lo lee en Ajustes', () => {
    memoria();
    expect(ultimoDiagnosticoIA()).toBeNull();
    guardarDiagnosticoIA({ cotizacion: {}, diagnostico: { modelo: 'Qwen/Qwen3.7-Flash', respaldo: true, ms: 3249.6 } });
    expect(ultimoDiagnosticoIA()).toEqual({
      modelo: 'Qwen/Qwen3.7-Flash',
      respaldo: true,
      ms: 3250,
      fecha: expect.any(String),
    });
    // Una respuesta sin diagnóstico (u otra acción) no borra el último.
    guardarDiagnosticoIA({ cotizacion: {} });
    expect(ultimoDiagnosticoIA()?.modelo).toBe('Qwen/Qwen3.7-Flash');
  });

  it('descarta diagnósticos con otra forma y no falla sin sessionStorage', () => {
    expect(leerDiagnosticoRespuesta({ diagnostico: { modelo: 1, respaldo: false, ms: 1 } })).toBeNull();
    expect(leerDiagnosticoRespuesta({ diagnostico: { modelo: 'x', respaldo: 'no', ms: 1 } })).toBeNull();
    expect(leerDiagnosticoRespuesta({ diagnostico: { modelo: 'x', respaldo: false, ms: -1 } })).toBeNull();
    expect(leerDiagnosticoRespuesta(null)).toBeNull();
    vi.stubGlobal('sessionStorage', undefined);
    expect(() => guardarDiagnosticoIA({ diagnostico: { modelo: 'x', respaldo: false, ms: 1 } })).not.toThrow();
    expect(ultimoDiagnosticoIA()).toBeNull();
  });

  it('muestra el modelo, si respondió el respaldo y la latencia', () => {
    const fecha = new Date(2026, 9, 14, 9, 5).toISOString();
    expect(textoDiagnostico(null)).toBe('Todavía no hay mensajes del chat en esta pestaña.');
    expect(textoDiagnostico({ modelo: 'deepseek/deepseek-v4.1-flash', respaldo: false, ms: 2400, fecha }, 'DeepSeek V4.1 Flash')).toMatch(
      /^09:05 · DeepSeek V4\.1 Flash \(deepseek\/deepseek-v4\.1-flash\) · 2,4 s$/,
    );
    expect(textoDiagnostico({ modelo: 'Qwen/Qwen3.7-Flash', respaldo: true, ms: 12345, fecha })).toContain(
      'Qwen/Qwen3.7-Flash · respondió el modelo de respaldo · 12,3 s',
    );
    expect(textoDiagnostico({ modelo: null, respaldo: false, ms: 80, fecha })).toContain('sin consultar a la IA');
  });

  it('Avanzado tiene el campo de la última respuesta', () => {
    expect(pantalla('ajustes')).toContain('Última respuesta del chat');
  });
});
