import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ajustesPredeterminados } from '../src/asistente/ajustes';
import { ConfiguracionIA, claveQuitable, type EstadoAjustes } from '../src/app/configuracion-ia';

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
