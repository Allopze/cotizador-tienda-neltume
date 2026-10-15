import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { abrirXlsx, descomprimirXlsx, ErrorXlsx, LIMITES_DESCOMPRESION } from '../src/catalogo/xlsx';
import { xlsxBytes } from './fixture-xlsx';

// Topes de descompresión del .xlsx (src/catalogo/xlsx.ts, `descomprimirXlsx`): se miden por el índice del zip antes
// de inflar nada. La ruta de importación prueba los topes reales de 100 y 200 MB declarando tamaños falsos
// (tests/importar-catalogo.test.ts); aquí se prueban los bordes con topes chicos, las partes guardadas sin
// comprimir y la parte que declara menos de lo que trae.

/** Cambia el tamaño descomprimido que declara `nombre` en el directorio central del zip. */
function declararTamano(zip: Uint8Array, nombre: string, bytes: number) {
  const copia = zip.slice();
  const v = new DataView(copia.buffer);
  for (let o = 0; o + 46 <= copia.length; o++) {
    if (v.getUint32(o, true) !== 0x02014b50) continue;
    const largo = v.getUint16(o + 28, true);
    if (new TextDecoder().decode(copia.subarray(o + 46, o + 46 + largo)) !== nombre) continue;
    v.setUint32(o + 24, bytes, true);
    return copia;
  }
  throw new Error(`El zip no trae ${nombre}`);
}

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function guardar(bytes: Uint8Array) {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-xlsx-topes-'));
  dirs.push(dir);
  const ruta = join(dir, 'libro.xlsx');
  await writeFile(ruta, bytes);
  return ruta;
}

const texto = (n: number) => strToU8('x'.repeat(n));

describe('topes de descompresión del xlsx', () => {
  it('los topes son 100 MB por parte y 200 MB en total', () => {
    expect(LIMITES_DESCOMPRESION).toEqual({ entrada: 100 * 1024 * 1024, total: 200 * 1024 * 1024 });
  });

  it('una parte justo en el tope pasa; un byte más se rechaza nombrando la parte', () => {
    const limites = { entrada: 1000, total: 10_000 };
    const justo = zipSync({ 'xl/a.xml': texto(1000) });
    expect(descomprimirXlsx(justo, limites)['xl/a.xml']).toHaveLength(1000);
    const pasada = zipSync({ 'xl/a.xml': texto(1001) });
    expect(() => descomprimirXlsx(pasada, limites)).toThrow(ErrorXlsx);
    expect(() => descomprimirXlsx(pasada, limites)).toThrow(/una parte del libro descomprimida supera .*: xl\/a\.xml$/);
  });

  it('suma todas las partes: cada una bajo su tope, juntas sobre el total, se rechaza', () => {
    const limites = { entrada: 1000, total: 2500 };
    const bajo = zipSync({ 'a.xml': texto(900), 'b.xml': texto(900), 'c.xml': texto(700) });
    expect(Object.keys(descomprimirXlsx(bajo, limites)).sort()).toEqual(['a.xml', 'b.xml', 'c.xml']);
    const sobre = zipSync({ 'a.xml': texto(900), 'b.xml': texto(900), 'c.xml': texto(701) });
    expect(() => descomprimirXlsx(sobre, limites)).toThrow(/el libro descomprimido supera/);
  });

  it('el nombre de una parte enorme se recorta en el mensaje', () => {
    const nombre = `xl/${'n'.repeat(300)}.xml`;
    const zip = zipSync({ [nombre]: texto(2000) });
    const error = (() => {
      try {
        descomprimirXlsx(zip, { entrada: 1000, total: 10_000 });
      } catch (e) {
        return e as Error;
      }
    })();
    expect(error).toBeInstanceOf(ErrorXlsx);
    expect(error!.message.endsWith(nombre.slice(0, 80))).toBe(true);
    expect(error!.message).not.toContain(nombre);
  });

  it('una parte guardada sin comprimir se mide por lo que trae, aunque declare menos', () => {
    // Sin compresión (método 0), fflate copia los bytes que trae el archivo: el tamaño declarado no cuenta.
    const guardada = zipSync({ 'xl/a.xml': [texto(5000), { level: 0 }] });
    const mentirosa = declararTamano(guardada, 'xl/a.xml', 10);
    const limites = { entrada: 1000, total: 10_000 };
    expect(() => descomprimirXlsx(mentirosa, limites)).toThrow(/una parte del libro descomprimida supera/);
    // Con un tope que la admite, se lee completa: lo declarado no la recorta.
    expect(descomprimirXlsx(mentirosa, { entrada: 5000, total: 10_000 })['xl/a.xml']).toHaveLength(5000);
  });

  it('una parte comprimida que declara menos de lo que trae queda truncada: su XML falla, nunca ocupa más', async () => {
    const libro = xlsxBytes({ HOJA: { B2: 'MOLCO', C2: 100 } });
    const real = unzipSync(libro)['xl/worksheets/sheet1.xml'].length;
    const mentiroso = declararTamano(libro, 'xl/worksheets/sheet1.xml', 40);
    // Se infla en un búfer del tamaño declarado.
    expect(descomprimirXlsx(mentiroso)['xl/worksheets/sheet1.xml']).toHaveLength(40);
    expect(real).toBeGreaterThan(40);
    const x = await abrirXlsx(await guardar(mentiroso));
    expect(() => x.leer('HOJA', () => true)).toThrow(ErrorXlsx);
    expect(() => x.leer('HOJA', () => true)).toThrow(/la hoja HOJA no se puede leer/);
    // El mismo libro sin tocar se lee.
    const sano = await abrirXlsx(await guardar(libro));
    expect(sano.leer('HOJA', () => true).get('B2')).toEqual({ valor: 'MOLCO' });
  });

  it('un archivo que no es zip es un ErrorXlsx, no un error interno', () => {
    expect(() => descomprimirXlsx(strToU8('no soy un zip'))).toThrow(ErrorXlsx);
    expect(() => descomprimirXlsx(strToU8('no soy un zip'))).toThrow(/no es un archivo comprimido \.xlsx válido/);
  });
});
