import { describe, expect, it } from 'vitest';
import { planoFrase, ubicacionesFrase, ubicarFrase } from '../src/asistente/frases';

describe('planoFrase', () => {
  it('pega la «x» solo entre cifras', () => {
    expect(planoFrase('2 Molco dúplex lenga 80 x 200')).toBe('2 molco duplex lenga 80x200');
    expect(planoFrase('3 Molco lenga 80×210')).toBe(planoFrase('3 molco lenga 80 x 210'));
    expect(planoFrase('0,80 * 2,10 y 70 por 200')).toBe('0,80x2,10 y 70x200');
    expect(planoFrase('marco tipo x 2')).toBe('marco tipo x 2');
  });
  it('los asteriscos de la negrita de WhatsApp no se vuelven «x»', () => {
    expect(planoFrase('*2 molco lenga 83x236*')).toBe('2 molco lenga 83x236');
    expect(planoFrase('*2 Molco lenga 80 * 200*')).toBe('2 molco lenga 80x200');
  });
});

describe('ubicar una frase', () => {
  it('ignora tildes, puntuación, «×» y el conector «en», con palabras enteras', () => {
    const texto = 'Cotiza 3 Molco en lenga 80 × 200; 2 Toledo raulí';
    const tramo = ubicarFrase(texto, '3 molco lenga 80x200');
    expect(tramo && texto.slice(...tramo)).toBe('3 Molco en lenga 80 × 200');
    // Una frase cortada no calza dentro de otra cifra.
    expect(ubicarFrase(texto, '3 molco lenga 80x20')).toBeNull();
    expect(ubicarFrase('2 Molcos lenga', '2 molco lenga')).toBeNull();
  });
  it('repetida vale la primera aparición libre; si todas están tomadas, la primera', () => {
    const texto = '2 Molco lenga 80x200\n2 Molco lenga 80x200';
    const todas = ubicacionesFrase(texto, '2 molco lenga 80x200');
    expect(todas).toEqual([
      [0, 20],
      [21, 41],
    ]);
    expect(ubicarFrase(texto, '2 molco lenga 80x200')).toEqual([0, 20]);
    expect(ubicarFrase(texto, '2 molco lenga 80x200', [[0, 20]])).toEqual([21, 41]);
    expect(ubicarFrase(texto, '2 molco lenga 80x200', todas)).toEqual([0, 20]);
  });
  it('ubica la frase dentro de la negrita de WhatsApp', () => {
    const texto = '*2 molco lenga 83x236*\n*2 Molco raulí 80 * 200*';
    let tramo = ubicarFrase(texto, '2 molco lenga 83x236');
    expect(tramo && texto.slice(...tramo)).toBe('2 molco lenga 83x236');
    tramo = ubicarFrase(texto, '2 molco rauli 80x200');
    expect(tramo && texto.slice(...tramo)).toBe('2 Molco raulí 80 * 200');
  });
  it('una unidad pegada a la última cifra cierra la frase («83x236cm»); otras letras pegadas, no', () => {
    for (const unidad of ['cm', 'mm', 'm', 'mt', 'mts', 'CM']) {
      const texto = `cotiza 2 molco lenga 83x236${unidad}, gracias`;
      const tramo = ubicarFrase(texto, '2 molco lenga 83x236');
      expect(tramo && texto.slice(...tramo), unidad).toBe('2 molco lenga 83x236');
    }
    expect(ubicarFrase('2 molco lenga 83x236cmx', '2 molco lenga 83x236')).toBeNull();
    expect(ubicarFrase('2 molco lenga 83x236abc', '2 molco lenga 83x236')).toBeNull();
    expect(ubicarFrase('2 molco lenga 83x2361', '2 molco lenga 83x236')).toBeNull();
    // Solo tras una cifra: «2 molcos» no es «2 molco» más una unidad.
    expect(ubicarFrase('2 molcom lenga', '2 molco')).toBeNull();
  });
  it('las posiciones valen en el texto recibido aunque traiga acentos sueltos', () => {
    const texto = 'cliente Raúl ´ Pérez: 2 Molco lenga 80x200';
    const tramo = ubicarFrase(texto, '2 molco lenga 80x200');
    expect(tramo && texto.slice(...tramo)).toBe('2 Molco lenga 80x200');
  });
});
