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

/** El libro no se puede leer como .xlsx: zip dañado o demasiado grande, XML o referencias inválidas. */
export class ErrorXlsx extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorXlsx';
  }
}
/** El archivo no es un zip sino un documento compuesto de Office (CFB): un .xlsx con contraseña o un .xls. */
export class ErrorXlsxCompuesto extends ErrorXlsx {
  constructor(readonly protegido: boolean) {
    super(protegido ? 'el libro está cifrado con contraseña' : 'el libro es un Excel antiguo (.xls)');
    this.name = 'ErrorXlsxCompuesto';
  }
}
const FIRMA_CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
/** Un .xlsx con contraseña de apertura se guarda como CFB con un flujo «EncryptionInfo» (nombre en UTF-16LE). */
const ENCRYPTION_INFO = Buffer.from('EncryptionInfo', 'utf16le');
function rechazarCompuesto(bytes: Uint8Array) {
  if (bytes.length < FIRMA_CFB.length || FIRMA_CFB.some((b, i) => bytes[i] !== b)) return;
  throw new ErrorXlsxCompuesto(
    Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(ENCRYPTION_INFO),
  );
}
const detalle = (error: unknown) => (error instanceof Error ? error.message : 'formato desconocido');

/** Topes de lo descomprimido: una planilla real ocupa pocos MB; un zip que se infla a gigabytes se rechaza. */
export const LIMITES_DESCOMPRESION = { total: 200 * 1024 * 1024, entrada: 100 * 1024 * 1024 };
const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

/**
 * Descomprime el libro sin pasar de los topes. Antes de inflar nada se recorre el índice del zip y se mide
 * cada parte por el tamaño que declara. Ese tamaño no puede mentir hacia arriba: fflate infla cada parte en un
 * búfer de exactamente ese largo y no lo agranda, así que una parte que declara menos de lo que trae queda
 * truncada (y su XML falla al leerse), nunca ocupa más memoria que la declarada.
 */
export function descomprimirXlsx(bytes: Uint8Array, limites = LIMITES_DESCOMPRESION) {
  rechazarCompuesto(bytes);
  let total = 0;
  try {
    unzipSync(bytes, {
      filter: (f) => {
        // Sin comprimir ocupa lo que trae el archivo; comprimida, lo que declara.
        const tamano = f.compression === 0 ? f.size : f.originalSize;
        if (tamano > limites.entrada)
          throw new ErrorXlsx(
            `una parte del libro descomprimida supera ${mb(limites.entrada)}: ${f.name.slice(0, 80)}`,
          );
        total += tamano;
        if (total > limites.total) throw new ErrorXlsx(`el libro descomprimido supera ${mb(limites.total)}`);
        return false;
      },
    });
    return unzipSync(bytes);
  } catch (error) {
    if (error instanceof ErrorXlsx) throw error;
    throw new ErrorXlsx(`no es un archivo comprimido .xlsx válido: ${detalle(error)}`);
  }
}

export async function abrirXlsx(ruta: string) {
  const bytes = await readFile(ruta);
  const zip = descomprimirXlsx(bytes);
  const xml = (ruta: string) => {
    if (!zip[ruta]) throw new ErrorXlsx(`falta ${ruta} en la planilla`);
    return strFromU8(zip[ruta]);
  };
  /** Lee un XML del libro; un error de formato o de referencias dentro de él es un libro inválido. */
  const analizar = (que: string, leer: () => void) => {
    try {
      leer();
    } catch (error) {
      if (error instanceof ErrorXlsx) throw error;
      throw new ErrorXlsx(`${que} no se puede leer: ${detalle(error)}`);
    }
  };
  const relaciones = new Map<string, string>();
  const rp = new SaxesParser();
  rp.on('opentag', (t) => {
    if (t.name === 'Relationship') relaciones.set(String(t.attributes.Id), String(t.attributes.Target));
  });
  analizar('xl/_rels/workbook.xml.rels', () => rp.write(xml('xl/_rels/workbook.xml.rels')).close());
  const hojas = new Map<string, string>();
  const wp = new SaxesParser();
  wp.on('opentag', (t) => {
    if (t.name !== 'sheet') return;
    const nombre = String(t.attributes.name),
      target = relaciones.get(String(t.attributes['r:id']));
    if (!target) throw new ErrorXlsx(`la hoja ${nombre} no tiene relación en workbook.xml.rels`);
    hojas.set(nombre, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  });
  analizar('xl/workbook.xml', () => wp.write(xml('xl/workbook.xml')).close());
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
    analizar(`el texto compartido ${i}`, () => p.write(strings[i] ?? '<si/>').close());
    return out;
  }
  function leer(nombre: string, permitir: (col: string, fila: number) => boolean): Hoja {
    const ruta = hojas.get(nombre);
    if (!ruta) throw new ErrorXlsx(`falta la hoja ${nombre}`);
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
        if (t.attributes.r && !m) throw new ErrorXlsx(`referencia de celda inválida en la hoja ${nombre}`);
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
    analizar(`la hoja ${nombre}`, () => p.write(xml(ruta)).close());
    return resultado;
  }
  return { bytes, zip, hojas: [...hojas.keys()], leer };
}
export type Xlsx = Awaited<ReturnType<typeof abrirXlsx>>;
