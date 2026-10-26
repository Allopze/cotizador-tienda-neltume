import { describe, expect, it } from 'vitest';
import { nombreDeDisposicion } from '../src/app/solicitud';
import { disposicionDescarga, nombreDescarga } from '../src/servidor/nombre-descarga';

describe('Nombre de descarga de los documentos (docs/estilo-documentos-v1.md, sección 7)', () => {
  it.each([
    ['cotizacion-323.pdf', 'Neltume - Cotización N.º 323.pdf'],
    // Un PDF que se volvió a generar lleva «-2» tras el número: se descarga con el de su documento.
    ['cotizacion-340-2.pdf', 'Neltume - Cotización N.º 340.pdf'],
    ['cotizacion-323-anulada.pdf', 'Neltume - Cotización N.º 323 (anulada).pdf'],
    ['cotizacion-323-2-anulada.pdf', 'Neltume - Cotización N.º 323 (anulada).pdf'],
    ['nota-pedido-panguipulli-577.pdf', 'Neltume - Nota de pedido N.º 577 Panguipulli.pdf'],
    ['nota-pedido-santiago-59-3.pdf', 'Neltume - Nota de pedido N.º 59 Santiago.pdf'],
    ['nota-pedido-panguipulli-577-anulada.pdf', 'Neltume - Nota de pedido N.º 577 Panguipulli (anulada).pdf'],
    // Las notas anteriores a separar las fábricas no la llevan en el nombre.
    ['nota-pedido-12.pdf', 'Neltume - Nota de pedido N.º 12.pdf'],
  ])('%s se descarga como «%s»', (archivo, esperado) => {
    expect(nombreDescarga(archivo)).toBe(esperado);
  });

  it('un nombre que no calza queda como está', () => {
    expect(nombreDescarga('prueba-conexion-3f9a12bc.pdf')).toBe('prueba-conexion-3f9a12bc.pdf');
  });

  it('la cabecera lleva el nombre completo en filename* y una versión ASCII en filename, y el cliente lo recupera', () => {
    const cabecera = disposicionDescarga('attachment', 'nota-pedido-panguipulli-577.pdf');
    expect(cabecera).toBe(
      `attachment; filename="Neltume - Nota de pedido N.o 577 Panguipulli.pdf"; filename*=UTF-8''Neltume%20-%20Nota%20de%20pedido%20N.%C2%BA%20577%20Panguipulli.pdf`,
    );
    // Es un valor de cabecera válido y el cliente recupera el nombre con «º».
    expect(() => new Headers({ 'Content-Disposition': cabecera })).not.toThrow();
    expect(nombreDeDisposicion(cabecera)).toBe('Neltume - Nota de pedido N.º 577 Panguipulli.pdf');
    expect(disposicionDescarga('inline', 'cotizacion-9.pdf')).toMatch(
      /^inline; filename="Neltume - Cotizacion N\.o 9\.pdf"; /,
    );
    // Los paréntesis de «(anulada)» van codificados: `filename*` no los admite tal cual.
    expect(disposicionDescarga('attachment', 'cotizacion-9-anulada.pdf')).toContain(
      "UTF-8''Neltume%20-%20Cotizaci%C3%B3n%20N.%C2%BA%209%20%28anulada%29.pdf",
    );
  });

  it('el cliente toma filename* si viene, y si no, filename; un filename* mal codificado cae al simple', () => {
    expect(nombreDeDisposicion('attachment; filename="cotizaciones-2026-10-25.csv"')).toBe(
      'cotizaciones-2026-10-25.csv',
    );
    expect(nombreDeDisposicion(`attachment; filename="a.pdf"; filename*=UTF-8''%E0%A4%A`)).toBe('a.pdf');
    expect(nombreDeDisposicion('attachment')).toBeNull();
    expect(nombreDeDisposicion(null)).toBeNull();
  });
});
