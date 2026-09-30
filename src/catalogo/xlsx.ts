// Lector selectivo: no materializa valores ni fórmulas de celdas no autorizadas.
// Evita cargar un Workbook completo con columnas de costos y márgenes.
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { SaxesParser } from 'saxes';
export interface Celda {
  valor: string | number | null;
  formula?: string;
}
export type Hoja = Map<string, Celda>;
const columna = (n: number) => {
  let s = '';
  for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
};
const indiceColumna = (s: string) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
export async function abrirXlsx(ruta: string) {
  const bytes = await readFile(ruta);
  const zip = unzipSync(bytes);
  const xml = (ruta: string) => {
    if (!zip[ruta]) throw new Error(`Falta ${ruta} en la planilla.`);
    return strFromU8(zip[ruta]);
  };
  const relaciones = new Map<string, string>();
  const rp = new SaxesParser();
  rp.on('opentag', (t) => {
    if (t.name === 'Relationship') relaciones.set(String(t.attributes.Id), String(t.attributes.Target));
  });
  rp.write(xml('xl/_rels/workbook.xml.rels')).close();
  const hojas = new Map<string, string>();
  const wp = new SaxesParser();
  wp.on('opentag', (t) => {
    if (t.name !== 'sheet') return;
    const nombre = String(t.attributes.name),
      target = relaciones.get(String(t.attributes['r:id']));
    if (!target) throw new Error(`La hoja ${nombre} no tiene relación en workbook.xml.rels.`);
    hojas.set(nombre, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  });
  wp.write(xml('xl/workbook.xml')).close();
  // Los shared strings solo se decodifican al solicitarlos desde una celda permitida.
  // Incluye <si/> autocerrados para no desplazar los índices.
  const strings: string[] = zip['xl/sharedStrings.xml']
    ? (xml('xl/sharedStrings.xml').match(/<si\b[^>]*\/>|<si\b[^>]*>[\s\S]*?<\/si>/g) ?? [])
    : [];
  function shared(i: number) {
    let out = '',
      dentro = false,
      fonetico = false;
    const p = new SaxesParser();
    p.on('opentag', (t) => {
      if (t.name === 'rPh') fonetico = true;
      else if (t.name === 't' && !fonetico) dentro = true;
    });
    p.on('text', (s) => {
      if (dentro) out += s;
    });
    p.on('closetag', (t) => {
      if (t.name === 't') dentro = false;
      else if (t.name === 'rPh') fonetico = false;
    });
    p.write(strings[i] ?? '<si/>').close();
    return out;
  }
  function leer(nombre: string, permitir: (col: string, fila: number) => boolean): Hoja {
    const ruta = hojas.get(nombre);
    if (!ruta) throw new Error(`Falta la hoja ${nombre}.`);
    const resultado: Hoja = new Map();
    // Fórmulas compartidas: las celdas dependientes solo traen el índice `si`; se guarda el texto
    // de la maestra únicamente si esa celda está permitida.
    const compartidas = new Map<string, string>();
    let fila = 0,
      col = 0,
      ref = '',
      tipo = '',
      valor = '',
      formula = '',
      compartida: string | null = null,
      captura = '',
      permitido = false;
    const p = new SaxesParser();
    p.on('opentag', (t) => {
      if (t.name === 'row') {
        fila = t.attributes.r ? Number(t.attributes.r) : fila + 1;
        col = 0;
      } else if (t.name === 'c') {
        // El atributo r es opcional en OOXML: si falta, la celda sigue a la anterior.
        const m = t.attributes.r ? /^([A-Z]+)(\d+)$/.exec(String(t.attributes.r)) : null;
        if (t.attributes.r && !m) throw new Error(`Referencia de celda inválida en ${nombre}.`);
        if (m) {
          col = indiceColumna(m[1]);
          fila = Number(m[2]);
        } else col++;
        ref = `${columna(col)}${fila}`;
        tipo = String(t.attributes.t ?? 'n');
        permitido = permitir(columna(col), fila);
        valor = '';
        formula = '';
        compartida = null;
        captura = '';
      } else if (permitido && ['v', 'f', 't'].includes(t.name)) {
        captura = t.name;
        if (t.name === 'f' && t.attributes.t === 'shared' && t.attributes.si != null)
          compartida = String(t.attributes.si);
      }
    });
    p.on('text', (s) => {
      if (permitido && captura) {
        if (captura === 'f') formula += s;
        else valor += s;
      }
    });
    p.on('closetag', (t) => {
      if (['v', 'f', 't'].includes(t.name)) captura = '';
      if (t.name !== 'c') return;
      if (permitido) {
        if (compartida !== null) {
          if (formula) compartidas.set(compartida, formula);
          else formula = compartidas.get(compartida) ?? '';
        }
        resultado.set(ref, {
          valor: !valor ? null : tipo === 's' ? shared(Number(valor)) : tipo === 'n' ? Number(valor) : valor,
          ...(formula ? { formula } : {}),
        });
      }
      permitido = false;
    });
    p.write(xml(ruta)).close();
    return resultado;
  }
  return { bytes, zip, hojas: [...hojas.keys()], leer };
}
export type Xlsx = Awaited<ReturnType<typeof abrirXlsx>>;
