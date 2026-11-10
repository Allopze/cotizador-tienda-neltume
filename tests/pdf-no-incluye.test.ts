// «No incluye» del PDF según lo que la cotización sí cobra (auditoría 2026-11, N-26).
import { describe, expect, it } from 'vitest';
import type { Linea } from '../src/negocio/precios';
import { textoNoIncluye } from '../src/servidor/pdf';

const linea = (modelo: string, extra: Partial<Linea> = {}) =>
  ({ producto: { modelo, descripcion: modelo }, descripcionDocumento: null, observaciones: null, ...extra }) as unknown as Linea;

describe('textoNoIncluye', () => {
  it('sin líneas especiales lista todas las exclusiones habituales', () => {
    expect(textoNoIncluye([linea('RANCO')])).toBe(
      'No se considera: instalación, pintura, barniz, protecciones metálicas, vidrios ni estructura para correderas. No se consideran elementos no indicados en la cotización.',
    );
  });
  it('no excluye lo que la cotización cobra: instalación y una puerta vidriada', () => {
    const texto = textoNoIncluye([linea('Instalación en obra'), linea('RANCO', { descripcionDocumento: 'Ranco vidriada' })]);
    expect(texto).not.toMatch(/instalación|vidrios/);
    expect(texto).toContain('pintura, barniz, protecciones metálicas ni estructura para correderas');
  });
});
