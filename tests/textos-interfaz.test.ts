import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ajustesPredeterminados } from '../src/asistente/ajustes';
import { PreciosDescuentos, type Negocio } from '../src/app/ajustes/configuracion-negocio';
import { ConfiguracionIA } from '../src/app/configuracion-ia';
import { resumenCambios } from '../src/app/formato';
import type { CambiosCotizacion } from '../src/app/contrato';
import { REGLAS } from '../src/negocio/precios';

const sinCambios: CambiosCotizacion = { agregados: [], quitados: [], modificados: [], cliente: [] };

describe('resumen de cambios del chat', () => {
  it('se lee como frase y no repite dos descripciones casi iguales', () => {
    const texto = resumenCambios({
      ...sinCambios,
      agregados: [{ descripcion: 'MARCO PINO OREGON 2X4 PULG KIT' }],
      modificados: [
        {
          antes: { descripcion: 'MARCO PINO OREGON (sin cantidad)' },
          despues: { descripcion: 'MARCO PINO OREGON 2X4 (sin cantidad)' },
        },
      ],
      cliente: ['nombre', 'comuna'],
    } as CambiosCotizacion);
    expect(texto).toBe(
      'Se agregó Marco Pino Oregón 2X4 Pulg Kit · Se actualizó Marco Pino Oregón 2X4 (sin cantidad) · ' +
        'Se actualizó el cliente (nombre y comuna)',
    );
    expect(texto).not.toContain('→');
  });

  it('sin cambios no hay texto', () => {
    expect(resumenCambios(undefined)).toBe('');
    expect(resumenCambios(sinCambios)).toBe('');
  });
});

/** Archivos de la interfaz (src/app), con su texto. */
function archivosInterfaz(dir = 'src/app'): [string, string][] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) return archivosInterfaz(ruta);
    return /\.tsx?$/.test(e.name) ? [[ruta, readFileSync(ruta, 'utf8')] as [string, string]] : [];
  });
}
const coincidencias = (archivos: [string, string][], prohibido: RegExp) =>
  archivos.filter(([, texto]) => prohibido.test(texto)).map(([ruta]) => ruta);

// Plan 4.5 (U7): la vendedora ve «ganancia», «número de cotización», «sin IVA» y frases claras. Los nombres
// internos (margen, correlativo, precioNeto) no cambian; el PDF y el resumen para el cliente conservan «Neto».
describe('jerga técnica en pantalla', () => {
  const interfaz = archivosInterfaz();
  const PROHIBIDOS_INTERFAZ: RegExp[] = [
    /Margen (especial|de la línea|estándar|aplicado)/,
    /(Restaurar|Usar el) margen/,
    /MÁRGENES POR CATEGORÍA/,
    /neto \+ margen/,
    /modificado manualmente/,
    /correlativo/i,
    /Normalizado desde/,
    /posible coincidencia/,
    /Fábrica \{pesos/,
    /→\s*cliente \{pesos/,
    /TOTAL NETO|Total neto|<span>Neto<\/span>/,
    /Precio base neto|[Pp]recio unitario neto|[Pp]recio neto para/,
    /neto (unitario )?de referencia/,
    /se guarda neto/,
    /\} neto`/,
    /Vista técnica \(JSON\)/,
  ];
  it.each(PROHIBIDOS_INTERFAZ.map((r) => [String(r), r] as const))('src/app no muestra %s', (_, prohibido) => {
    expect(coincidencias(interfaz, prohibido)).toEqual([]);
  });

  // Mensajes del servidor y del chat que la vendedora lee tal cual.
  const mensajes = ['src/servidor/servicio.ts', 'src/asistente/flete.ts', 'src/negocio/starken.ts', 'src/negocio/cifras.ts']
    .map((ruta) => [ruta, readFileSync(ruta, 'utf8')] as [string, string]);
  const PROHIBIDOS_MENSAJES: RegExp[] = [
    /[`'](El )?[Mm]argen (especial|de |debe)/,
    /no usa margen|fuera del margen|según margen/,
    /'margen especial de la cotización'/,
    / neto c\/u|precio neto \(sin IVA\)|valor neto del flete|monto neto entero|\} neto\)/,
  ];
  it.each(PROHIBIDOS_MENSAJES.map((r) => [String(r), r] as const))('los mensajes no dicen %s', (_, prohibido) => {
    expect(coincidencias(mensajes, prohibido)).toEqual([]);
  });
});

/** Partes del HTML dentro y fuera del bloque «Avanzado» (un solo `<details>`, sin otros anidados). */
function partesAvanzado(html: string) {
  const inicio = html.indexOf('<details class="ajustes-avanzado"');
  expect(inicio).toBeGreaterThan(-1);
  const fin = html.indexOf('</details>', inicio) + '</details>'.length;
  return { dentro: html.slice(inicio, fin), fuera: html.slice(0, inicio) + html.slice(fin) };
}

// Plan 4.6: lo que puede romper el cotizador con un toque queda plegado en «Avanzado», con su advertencia.
describe('Ajustes: sección «Avanzado»', () => {
  it('el modelo, la clave y «Probar modelo» van en Avanzado; el estado del asistente queda a la vista', () => {
    const html = renderToStaticMarkup(
      createElement(ConfiguracionIA, {
        estado: {
          ajustes: ajustesPredeterminados(),
          commandcodeClave: true,
          commandcodeClaveFuente: 'ajustes',
          asistenteConfigurado: true,
          puedeEditar: true,
        },
        errorCarga: '',
        reintentar: () => {},
        guardado: () => {},
        avisar: () => 0,
      }),
    );
    const { dentro, fuera } = partesAvanzado(html);
    for (const texto of ['Probar modelo', 'Quitar clave', 'Nueva clave API', 'Modelo del asistente', 'gastar saldo'])
      expect(dentro).toContain(texto);
    expect(fuera).not.toMatch(/Probar modelo|Quitar clave|Nueva clave API/);
    expect(fuera).toContain('El asistente tiene su clave API configurada');
    // Con la clave funcionando, «Avanzado» empieza plegado.
    expect(dentro).not.toMatch(/^<details[^>]* open/);
  });

  it('sin clave, «Avanzado» empieza abierto: ahí se escribe', () => {
    const html = renderToStaticMarkup(
      createElement(ConfiguracionIA, {
        estado: {
          ajustes: ajustesPredeterminados(),
          commandcodeClave: false,
          commandcodeClaveFuente: 'ninguna',
          asistenteConfigurado: false,
          puedeEditar: true,
        },
        errorCarga: '',
        reintentar: () => {},
        guardado: () => {},
        avisar: () => 0,
      }),
    );
    expect(partesAvanzado(html).dentro).toMatch(/^<details[^>]* open/);
  });

  it('IVA y ganancias por categoría van en Avanzado; el descuento máximo y por cantidad, a la vista', () => {
    const negocio: Negocio = {
      estado: {
        configuracion: {
          empresa: {
            nombre: null, rut: null, direccion: null, telefono: null, correo: 'ventas@neltume.cl', web: null,
            condicionesPago: null, plazoEntrega: null, datosBancarios: null, logoSvg: null,
          },
          reglas: {
            ajuste: REGLAS.ajuste, iva: 0.19, vigenciaDiasHabiles: 10, descuentoMaximo: 50,
            descuentosPorCantidad: [], margenes: { puertas_solidas_oregon: 0.85 },
          },
          transportistas: [],
        },
        puedeEditar: true,
      },
      error: '',
      reintentar: () => {},
      guardar: async () => {
        throw new Error('no se guarda en esta prueba');
      },
    };
    const html = renderToStaticMarkup(createElement(PreciosDescuentos, { negocio, avisar: () => 0 }));
    const { dentro, fuera } = partesAvanzado(html);
    for (const texto of ['IVA (%)', 'GANANCIA SOBRE EL COSTO DE FÁBRICA', 'Puertas sólidas Pino Oregón (%)', 'IVA 1,9'])
      expect(dentro).toContain(texto);
    expect(fuera).not.toMatch(/IVA \(%\)|Pino Oregón/);
    expect(fuera).toContain('Descuento máximo (%)');
    expect(fuera).toContain('DESCUENTO POR CANTIDAD');
  });
});
