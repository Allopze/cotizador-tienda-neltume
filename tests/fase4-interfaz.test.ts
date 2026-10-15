import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CampoEditable } from '../src/app/campo-editable';
import { errorNumeroManual } from '../src/app/dialogos-cotizacion';
import { Encabezado } from '../src/app/encabezado';
import { sinExplicacionRepetida, RESUMEN_FUERA_DE_REGLA } from '../src/app/preguntas-pendientes';
import { preguntasPendientes, fueraDeRegla } from '../src/negocio/pendientes';
import type { SolicitudItem } from '../src/catalogo/tipos';
import type { Rechazo } from '../src/catalogo/resolver';

// Fase 4 del plan, en la interfaz: #24 (número manual), #26 (la explicación de un pendiente una sola vez) y
// #36 (accesibilidad).

describe('#24 · número manual en el diálogo de emisión', () => {
  const numeracion = { ultimo: 322, siguiente: 323, tope: 1322 };
  it('valida contra el último número y el tope antes de enviar', () => {
    expect(errorNumeroManual('', numeracion)).toBeNull();
    expect(errorNumeroManual('323', numeracion)).toBeNull();
    expect(errorNumeroManual('1322', numeracion)).toBeNull();
    expect(errorNumeroManual('322', numeracion)).toBe('El N° 322 ya se usó o quedó reservado: elige uno desde el 323.');
    expect(errorNumeroManual('1323', numeracion)).toBe(
      'El número puede saltar hasta 1.000 sobre el último: elige uno entre el 323 y el 1.322.',
    );
    expect(errorNumeroManual('12a', numeracion)).toBe('El número debe ser un entero positivo.');
    expect(errorNumeroManual('0', numeracion)).toBe('El número debe ser un entero positivo.');
  });
  it('sin la numeración (no llegó) solo exige un entero positivo: el servidor valida el rango', () => {
    expect(errorNumeroManual('1000000', null)).toBeNull();
    expect(errorNumeroManual('-4', null)).toBe('El número debe ser un entero positivo.');
  });
});

describe('#26 · la explicación de un precio fuera de regla, una sola vez en el detalle', () => {
  const PRECIO =
    'El precio $40.000 queda fuera del rango permitido (−50 % a 500 % sobre el costo $100.000). Corrígelo o quita el ítem.';
  const item: SolicitudItem = {
    modelo: 'MOLCO', madera: 'LENGA', ancho: 0.82, alto: 2, medida: null, cantidad: 1, tipoMedida: 'hoja', precioUnitario: 40_000,
  };
  const rechazo = { tipo: 'faltan_datos', campos: ['precio'], disponibles: {} } as unknown as Rechazo;
  const q = { solicitudes: [item], incompletos: [{ indice: 0, rechazo, pregunta: PRECIO }] };

  it('la pregunta del detalle conserva el título y el botón, sin repetir la explicación de la fila', () => {
    const preguntas = preguntasPendientes(q);
    // En el chat la pregunta va completa.
    expect(preguntas[0].detalle).toBe(PRECIO);
    const explicacion = fueraDeRegla(q, 0);
    expect(explicacion).toBe(PRECIO);
    const [enDetalle] = sinExplicacionRepetida(preguntas, explicacion);
    expect(enDetalle).toMatchObject({ texto: preguntas[0].texto, detalle: null, opciones: preguntas[0].opciones });
    // Sin precio fuera de regla, nada cambia.
    expect(sinExplicacionRepetida(preguntas, null)).toBe(preguntas);
  });

  it('el resumen del detalle y la pregunta no repiten la explicación que ya está bajo el producto', () => {
    const panel = readFileSync('src/app/cotizacion-panel.tsx', 'utf8');
    expect(RESUMEN_FUERA_DE_REGLA).not.toContain('$');
    // Una sola vez: la fila la muestra con `fueraDeRegla`, el resumen usa el texto corto.
    expect(panel.match(/fueraDeRegla\(actual, i\)/g)).toHaveLength(2);
    expect(panel).toContain('? RESUMEN_FUERA_DE_REGLA');
    expect(panel).toContain('sinExplicacionRepetida(preguntasItem, explicacionPrecio)');
  });
});

describe('#36 · accesibilidad', () => {
  it('los enlaces bloqueados del encabezado describen el motivo con un texto que se anuncia, no solo con title', () => {
    const html = renderToStaticMarkup(
      createElement(Encabezado, { email: 'a@b.cl', nombre: 'Ana', pantalla: 'historial', navegacionBloqueada: true }),
    );
    const ids = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((m) => m[1]);
    // Cuatro pantallas y «Cómo funciona», todos al mismo texto.
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(1);
    const id = ids[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(html).toMatch(new RegExp(`<span id="${id}" class="sr-only">Espera la respuesta del asistente o cancélala\\.</span>`));
    // Sin bloqueo, ni descripción ni texto oculto.
    const libre = renderToStaticMarkup(createElement(Encabezado, { email: 'a@b.cl', nombre: 'Ana', pantalla: 'historial' }));
    expect(libre).not.toContain('aria-describedby');
    expect(libre).not.toContain('Espera la respuesta');
  });

  it('un campo con sugerencias solo apunta (aria-controls) a la lista cuando existe', () => {
    const html = renderToStaticMarkup(
      createElement(CampoEditable, {
        etiqueta: 'Cliente',
        valor: '',
        editable: true,
        guardando: false,
        guardar: async () => true,
        sugerir: async () => [],
        abrirAlMontar: true,
      }),
    );
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('aria-controls');
  });

  it('a 520 px la regla de acciones de Usuarios no alcanza al registro de cambios', () => {
    const css = readFileSync('src/app/cotizacion.css', 'utf8');
    expect(css).toContain('.usuarios-admin .catalogo-lista td.celda-acciones,');
    expect(css).not.toContain('.usuarios-admin .catalogo-lista td:last-child');
  });
});
