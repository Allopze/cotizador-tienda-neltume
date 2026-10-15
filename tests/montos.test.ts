import { describe, expect, it } from 'vitest';
import { montoEscrito, montosAmbiguos, montosDelTexto } from '../src/asistente/montos';

describe('montos seguidos de puntuación', () => {
  it('se leen aunque los siga un punto, una coma, dos puntos, un guion o el fin del texto', () => {
    expect(montosDelTexto('despacho $350.000.')).toEqual([350000]);
    expect(montosDelTexto('$350.000, y el resto igual')).toEqual([350000]);
    expect(montosDelTexto('a $450.000.-')).toEqual([450000]);
    expect(montosDelTexto('flete: 350000.')).toEqual([350000]);
    expect(montosDelTexto('flete (350000)')).toEqual([350000]);
    expect(montosDelTexto('flete $350.000; gracias')).toEqual([350000]);
    // Regla de pesos sin centavos: «$350.00» es $350.000 aunque cierre la frase.
    expect(montosDelTexto('despacho $350.00.')).toEqual([350000]);
  });
  it('con multiplicador, también al final de la frase', () => {
    expect(montosDelTexto('flete 380k.')).toEqual([380000]);
    expect(montosDelTexto('flete 350 mil.')).toEqual([350000]);
    expect(montosDelTexto('flete 30 lucas.')).toEqual([30000]);
    expect(montosDelTexto('1,5 millones.')).toEqual([1500000]);
  });
  it('lee cada monto de una lista separada por comas', () => {
    const lista = montosDelTexto('2 Molco a $120.000, 1 Toledo a $90.000');
    expect(lista).toContain(120000);
    expect(lista).toContain(90000);
    const dos = montosDelTexto('precio 450000, flete 30000');
    expect(dos).toContain(450000);
    expect(dos).toContain(30000);
    const pegados = montosDelTexto('120.000,90.000');
    expect(pegados).toContain(120000);
    expect(pegados).toContain(90000);
  });
  it('un monto con miles puede llevar centavos: «$120.000,00» es $120.000', () => {
    expect(montosDelTexto('precio $120.000,00')).toContain(120000);
  });
  it('un monto pegado a «c/u» o «x2» se lee completo, nunca cortado en el punto de miles', () => {
    expect(montosDelTexto('$1.250.000c/u')).toEqual([1250000]);
    expect(montosDelTexto('$1.200.000x2')).toContain(1200000);
    expect(montosDelTexto('$1.200.000x2')).not.toContain(1200);
    expect(montosDelTexto('$1.250.000c/u')).not.toContain(1250);
  });
  it('un monto pegado a la moneda, al IVA, a «neto» o a «cu» se lee igual que con un espacio', () => {
    expect(montosDelTexto('$35.000pesos')).toEqual([35000]);
    expect(montosDelTexto('$35.000clp')).toEqual([35000]);
    expect(montosDelTexto('$35.000iva')).toEqual([35000]);
    expect(montosDelTexto('flete $35.000neto')).toEqual([35000]);
    expect(montosDelTexto('flete $35.000netos')).toEqual([35000]);
    expect(montosDelTexto('precio 120.000cu')).toEqual([120000]);
    expect(montosDelTexto('flete 35milpesos')).toEqual([35000]);
    expect(montoEscrito(35000, ['flete $35.000neto'])).toEqual({ ok: true, valor: 35000 });
    // Otra palabra pegada a la cifra no es un monto: «3cuadros» no respalda $3.
    expect(montosDelTexto('3cuadros')).toEqual([]);
    expect(montosDelTexto('2puertas')).toEqual([]);
  });
  it('lo ambiguo sigue sin respaldar nada, aunque lo siga un punto', () => {
    expect(montosDelTexto('despacho $350.50.')).not.toContain(350);
    expect(montosAmbiguos('despacho $350.50.')).toEqual(['$350.50']);
  });
});

describe('montos en palabras', () => {
  it('lee los números en palabras con «mil» y «millón»', () => {
    expect(montosDelTexto('flete cien mil')).toEqual([100000]);
    expect(montosDelTexto('quinientos mil')).toEqual([500000]);
    expect(montosDelTexto('dos mil quinientos')).toEqual([2500]);
    expect(montosDelTexto('mil quinientos')).toEqual([1500]);
    expect(montosDelTexto('un millón quinientos mil')).toEqual([1500000]);
    expect(montosDelTexto('doscientos cincuenta mil + iva')).toEqual([250000]);
    expect(montosDelTexto('ciento veinte mil')).toEqual([120000]);
    expect(montosDelTexto('treinta y cinco mil')).toEqual([35000]);
    expect(montosDelTexto('flete un millón')).toEqual([1000000]);
    expect(montosDelTexto('medio millón')).toEqual([500000]);
    expect(montosDelTexto('un millón y medio')).toEqual([1500000]);
    expect(montosDelTexto('treinta lucas')).toEqual([30000]);
  });
  it('un «mil» suelto no agrega $1.000 a otro monto', () => {
    // Antes «cien mil» daba [1000] y «un millón quinientos mil» [1000000, 1000].
    for (const texto of [
      'flete cien mil',
      'quinientos mil',
      'dos mil quinientos',
      'mil quinientos',
      'un millón quinientos mil',
    ])
      expect(montosDelTexto(texto)).not.toContain(1000);
  });
  it('«mil» es $1.000 solo como monto: «mil pesos» sí, «cotiza mil puertas» no', () => {
    expect(montosDelTexto('mil pesos')).toEqual([1000]);
    expect(montosDelTexto('flete mil')).toEqual([1000]);
    expect(montosDelTexto('cotiza mil puertas')).toEqual([]);
    expect(montosDelTexto('quinientos mil más iva')).toEqual([500000]);
  });
  it('sin «mil», «millón» ni «lucas» una palabra no es un monto', () => {
    expect(montosDelTexto('dos puertas Molco')).toEqual([]);
    expect(montosDelTexto('cotiza un Molco')).toEqual([]);
  });
  it('«350 mil» con espacio duro o doble espacio es $350.000, sin un $1.000 de más', () => {
    expect(montosDelTexto('flete 350 mil')).toEqual([350000]);
    expect(montosDelTexto('flete 350  mil')).toEqual([350000]);
  });
});

describe('monto escrito', () => {
  it('respalda el monto que propone la IA si está escrito, también al final de la frase', () => {
    expect(montoEscrito(350000, ['despacho a Osorno $350.000.'])).toEqual({ ok: true, valor: 350000 });
    expect(montoEscrito(100000, ['flete cien mil'])).toEqual({ ok: true, valor: 100000 });
    expect(montoEscrito(350000, ['despacho $350.00.'])).toEqual({ ok: true, valor: 350000 });
    expect(montoEscrito(350, ['despacho $350.00.'])).toEqual({ ok: true, valor: 350000 });
  });
  it('no respalda un $1.000 que nadie escribió', () => {
    expect(montoEscrito(1000, ['flete cien mil'])).toEqual({ ok: false, ambiguo: null });
    expect(montoEscrito(1000, ['cotiza mil puertas Molco'])).toEqual({ ok: false, ambiguo: null });
  });
});
