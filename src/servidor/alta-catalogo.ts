import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { atributosProductoSchema } from '../asistente/esquemas';
import type { LLM, ContextoAltaProducto } from '../asistente/llm';
import { descripcion } from '../catalogo/importar';
import type { Familia, Producto } from '../catalogo/tipos';
import { normalizarMedida } from '../catalogo/resolver';
import { interpretarCifra } from '../negocio/cifras';
import { REGLAS } from '../negocio/precios';
import { ErrorUsuarioCatalogo } from './errores';
import { RepositorioCatalogoSqlite } from './repositorio-catalogo';

const borradorSchema = atributosProductoSchema
  .extend({ precioNeto: z.number().positive().nullable(), avisoPrecio: z.string().nullable().optional() })
  .strict();
const productoSchema = z
  .object({
    codigo: z.string().min(1),
    modelo: z.string().min(1),
    familia: z.enum(['PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA']),
    tipo: z.string().nullable(),
    madera: z.string().min(1),
    medida: z.string().min(1),
    anchoMin: z.number().nullable(),
    anchoMax: z.number().nullable(),
    largo: z.number().positive(),
    precioNeto: z.number().positive(),
    descripcion: z.string().min(1),
    filaOrigen: z.number().int(),
  })
  .strict();
const mensajesSchema = z.array(
  z.object({ rol: z.enum(['usuario', 'asistente']), texto: z.string() }).strict(),
);
const respuestaSchema = z
  .object({ name: z.literal('proponer_producto'), input: atributosProductoSchema })
  .strict();
type AtributosProducto = z.infer<typeof atributosProductoSchema>;
type BorradorProducto = AtributosProducto & { precioNeto: number | null; avisoPrecio?: string | null };
type MensajeAlta = { rol: 'usuario' | 'asistente'; texto: string };
type FilaPendiente = {
  id: string;
  version: number;
  version_catalogo: string;
  borrador_json: string;
  mensajes_json: string;
  propuesta_json: string | null;
  expira: string;
  user_id: string | null;
};

const BORRADOR_VACIO: BorradorProducto = {
  modelo: null,
  familia: null,
  madera: null,
  tipo: null,
  medida: null,
  anchoMin: null,
  anchoMax: null,
  largo: null,
  precioNeto: null,
};
const TTL_MS = 60 * 60 * 1000;
const LIMITE_HISTORIAL = 20;

function leerJson<T>(valor: string, esquema: z.ZodType<T>): T {
  let json: unknown;
  try {
    json = JSON.parse(valor);
  } catch {
    throw new ErrorUsuarioCatalogo('La propuesta guardada ya no es válida. Inicia otra vez el alta.');
  }
  const parsed = esquema.safeParse(json);
  if (!parsed.success)
    throw new ErrorUsuarioCatalogo('La propuesta guardada ya no es válida. Inicia otra vez el alta.');
  return parsed.data;
}

function normalizarNombre(valor: string) {
  return valor
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleUpperCase('es-CL')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const PALABRAS: Record<string, number> = {
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  veinte: 20,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
  cien: 100,
  ciento: 100,
  doscientos: 200,
  trescientos: 300,
  cuatrocientos: 400,
  quinientos: 500,
  seiscientos: 600,
  setecientos: 700,
  ochocientos: 800,
  novecientos: 900,
};
const sinTildes = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

export { interpretarCifra };

const MARCADOR =
  /\bprecio(?:\s+(?:unitario|neto|bruto))*|\bneto(?:\s+unitario)?|\bvalor(?:\s+(?:unitario|neto|bruto))*|\b(?:cuesta|vale|sale)\b|\$/gi;
const TOKEN = /\s*(\d{1,3}(?: \d{3})+(?![\d.,])|\d+(?:[.,]\d+)*|[a-zñ]+)/y;
const BRUTO =
  /^[\s,.;:-]*(?:\(?\s*(?:con\s+iva|iva\s+incl\w*|incluye\s+(?:el\s+)?iva|incluido\s+(?:el\s+)?iva|c\/\s*iva|bruto)\b)/i;
const NETO_EXPLICITO = /^[\s,.;:-]*(?:\(?\s*(?:\+\s*iva|mas\s+iva|sin\s+iva|neto|s\/\s*iva)\b)/i;

export interface PrecioIndicado {
  /** Precio neto unitario (convertido desde bruto si corresponde), con cuatro decimales como el catálogo. */
  neto: number;
  /** Monto tal como lo escribió la persona. */
  indicado: number;
  bruto: boolean;
  inicio: number;
  fin: number;
}

function montoDesde(t: string, desde: number): { valor: number; fin: number } | null {
  TOKEN.lastIndex = desde;
  let total = 0,
    actual = 0,
    fin = desde,
    numerico = false,
    m: RegExpExecArray | null;
  while ((m = TOKEN.exec(t))) {
    const tok = m[1];
    if (/^\d/.test(tok)) {
      // Dos cifras seguidas sin «mil» entre ellas no forman un solo monto.
      if (actual) break;
      actual += interpretarCifra(tok);
      numerico = true;
    } else if (tok === 'mil' || tok === 'k') {
      if (!numerico && !actual) actual = 1;
      total += actual * 1000;
      actual = 0;
    } else if (tok === 'millon' || tok === 'millones') {
      total = (total + (actual || 1)) * 1_000_000;
      actual = 0;
    } else if (tok === 'y' && actual) {
      continue;
    } else if (tok in PALABRAS) {
      actual += PALABRAS[tok];
      numerico = true;
    } else break;
    fin = TOKEN.lastIndex;
  }
  if (!numerico) return null;
  // «precio 2x4»: una cifra pegada a letras no es un monto.
  if (/^[a-z0-9]/.test(t.slice(fin))) return null;
  return { valor: total + actual, fin };
}

/**
 * Busca montos vinculados a una expresión de precio o al signo $. «+ IVA», «más IVA» o «neto» se
 * toman como neto; «IVA incluido», «con IVA» o «bruto» se convierten a neto dividiendo por 1 + IVA.
 */
export function buscarPrecios(texto: string): PrecioIndicado[] {
  const t = sinTildes(texto);
  const precios: PrecioIndicado[] = [];
  for (const marcador of t.matchAll(MARCADOR)) {
    const inicio = marcador.index!;
    const prefijo = t
      .slice(inicio + marcador[0].length)
      .match(/^\s*(?:(?:es|de|a|por|seria|sera|son)\s+)*[:=]?\s*\$?\s*/);
    const monto = montoDesde(t, inicio + marcador[0].length + (prefijo?.[0].length ?? 0));
    if (!monto || !Number.isFinite(monto.valor) || monto.valor <= 0 || monto.valor > 100_000_000) continue;
    if (precios.some((p) => inicio < p.fin)) continue;
    const despues = t.slice(monto.fin, monto.fin + 30);
    const bruto = /\bbruto\b/.test(marcador[0]) || (BRUTO.test(despues) && !NETO_EXPLICITO.test(despues));
    const neto = bruto ? Math.round((monto.valor / (1 + REGLAS.iva)) * 10000) / 10000 : monto.valor;
    const extra = (bruto ? despues.match(BRUTO) : despues.match(NETO_EXPLICITO))?.[0].length ?? 0;
    precios.push({ neto, indicado: monto.valor, bruto, inicio, fin: monto.fin + extra });
  }
  return precios;
}

/** Precio neto unitario del primer monto explícito del texto, o null. */
export function extraerPrecioNeto(texto: string): number | null {
  return buscarPrecios(texto)[0]?.neto ?? null;
}

const formatoPrecio = (n: number) =>
  '$' + new Intl.NumberFormat('es-CL', { maximumFractionDigits: 4 }).format(n);

function ocultarPrecios(texto: string) {
  let seguro = texto;
  for (const p of buscarPrecios(texto).reverse())
    seguro = `${seguro.slice(0, p.inicio)}[precio indicado]${seguro.slice(p.fin)}`;
  return seguro.replace(/\$\s*[\d][\d., ]*(?:\s*(?:mil|k))?/gi, '[precio indicado]');
}

const mediana = (valores: number[]) => {
  const v = [...valores].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

export { ErrorUsuarioCatalogo };

export class ServicioAltaCatalogo {
  constructor(
    private db: Database.Database,
    private catalogo: RepositorioCatalogoSqlite,
    private llm: LLM,
  ) {}

  private limpiarExpirados() {
    this.db.prepare('DELETE FROM productos_pendientes WHERE expira <= ?').run(new Date().toISOString());
  }

  private nuevo(usuarioId: string): FilaPendiente {
    const versionCatalogo = this.catalogo.version;
    if (!versionCatalogo) throw new ErrorUsuarioCatalogo('Carga un catálogo antes de agregar productos.');
    const id = randomUUID();
    const expira = new Date(Date.now() + TTL_MS).toISOString();
    this.db
      .prepare(
        `
        INSERT INTO productos_pendientes (
          id, version, version_catalogo, borrador_json, mensajes_json, propuesta_json, actualizada, expira, user_id
        ) VALUES (?, 0, ?, ?, '[]', NULL, ?, ?, ?)
      `,
      )
      .run(id, versionCatalogo, JSON.stringify(BORRADOR_VACIO), new Date().toISOString(), expira, usuarioId);
    return this.leerPendiente(id, usuarioId)!;
  }

  /** Cada propuesta pertenece a quien la inició: otra cuenta la ve como inexistente. */
  private leerPendiente(id: string, usuarioId: string) {
    return this.db
      .prepare('SELECT * FROM productos_pendientes WHERE id = ? AND user_id = ?')
      .get(id, usuarioId) as FilaPendiente | undefined;
  }

  private guardar(
    fila: FilaPendiente,
    borrador: BorradorProducto,
    mensajes: MensajeAlta[],
    propuesta: Producto | null,
  ) {
    const actualizado = this.db
      .prepare(
        `
        UPDATE productos_pendientes SET
          version = version + 1,
          borrador_json = ?,
          mensajes_json = ?,
          propuesta_json = ?,
          actualizada = ?,
          expira = ?
        WHERE id = ? AND version = ?
      `,
      )
      .run(
        JSON.stringify(borrador),
        JSON.stringify(mensajes.slice(-LIMITE_HISTORIAL)),
        propuesta ? JSON.stringify(propuesta) : null,
        new Date().toISOString(),
        new Date(Date.now() + TTL_MS).toISOString(),
        fila.id,
        fila.version,
      );
    if (!actualizado.changes)
      throw new ErrorUsuarioCatalogo(
        'Esta conversación cambió en otra solicitud. Vuelve a enviar el último mensaje.',
      );
  }

  private falta(borrador: BorradorProducto) {
    const faltan: string[] = [];
    if (!borrador.modelo) faltan.push('el nombre del modelo');
    if (!borrador.familia) faltan.push('si es puerta, marco, piezas T o moldura');
    if (!borrador.madera) faltan.push('la madera');
    if (borrador.familia === 'PUERTA') {
      if (borrador.anchoMin === null || borrador.anchoMax === null)
        faltan.push('el ancho mínimo y máximo (por ejemplo, 80 a 85 cm)');
      if (borrador.largo === null) faltan.push('el alto en metros');
    } else if (borrador.familia) {
      if (!borrador.medida) faltan.push('la medida o escuadría');
      if (borrador.largo === null) faltan.push('el largo en metros');
    }
    if (borrador.precioNeto === null) faltan.push('el precio neto unitario en pesos');
    return faltan;
  }

  private validar(borrador: BorradorProducto): string | null {
    if (borrador.familia === 'PUERTA') {
      if (
        borrador.anchoMin !== null &&
        (borrador.anchoMin <= 0 ||
          borrador.anchoMin > 4 ||
          borrador.anchoMax === null ||
          borrador.anchoMax < borrador.anchoMin ||
          borrador.anchoMax > 4)
      )
        return 'El rango de ancho no es válido. Indica, por ejemplo, de 0,80 a 0,85 m.';
    } else if (borrador.familia && borrador.medida) {
      const medida = normalizarMedida(borrador.medida);
      if (!/^\d+(?:,\d+)?X\d+(?:,\d+)?$/.test(medida))
        return 'La medida debe tener formato de escuadría, por ejemplo 2x4 o 6x4,5.';
    }
    if (borrador.largo !== null && (borrador.largo <= 0 || borrador.largo > 10))
      return 'El alto o largo debe ser mayor que cero y estar expresado en metros.';
    if (borrador.precioNeto !== null && (borrador.precioNeto <= 0 || borrador.precioNeto > 100_000_000))
      return 'El precio neto unitario debe ser mayor que $0 y no superar $100.000.000.';
    return null;
  }

  private construir(borrador: BorradorProducto): Producto {
    const familia = borrador.familia as Familia;
    const modeloEntrada = normalizarNombre(borrador.modelo!);
    const modelo = normalizarNombre(this.catalogo.resolverModelo(modeloEntrada));
    const maderaEntrada = normalizarNombre(borrador.madera!);
    const madera = normalizarNombre(this.catalogo.resolverMadera(maderaEntrada) ?? maderaEntrada);
    const medida =
      familia === 'PUERTA'
        ? `${borrador.anchoMin!.toFixed(2).replace('.', ',')} A ${borrador.anchoMax!.toFixed(2).replace('.', ',')}`
        : normalizarMedida(borrador.medida!);
    const producto: Producto = {
      codigo: `IA-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`,
      modelo,
      familia,
      tipo: borrador.tipo?.trim().toLocaleUpperCase('es-CL') || null,
      madera,
      medida,
      anchoMin: familia === 'PUERTA' ? borrador.anchoMin : null,
      anchoMax: familia === 'PUERTA' ? borrador.anchoMax : null,
      largo: borrador.largo!,
      precioNeto: borrador.precioNeto!,
      descripcion: '',
      filaOrigen: 0,
    };
    producto.descripcion = descripcion(producto);
    return producto;
  }

  async mensaje(id: string | undefined, texto: string, usuarioId: string) {
    this.limpiarExpirados();
    const fila = id ? this.leerPendiente(id, usuarioId) : this.nuevo(usuarioId);
    if (!fila) throw new ErrorUsuarioCatalogo('La conversación de alta expiró. Inicia otra vez.');
    if (fila.expira <= new Date().toISOString()) {
      this.db.prepare('DELETE FROM productos_pendientes WHERE id = ?').run(fila.id);
      throw new ErrorUsuarioCatalogo('La conversación de alta expiró. Inicia otra vez.');
    }
    if (!this.catalogo.mismaImportacion(fila.version_catalogo))
      throw new ErrorUsuarioCatalogo('El catálogo cambió durante el alta. Inicia una propuesta nueva.');
    if (!this.llm.interpretarProducto)
      throw new ErrorUsuarioCatalogo('El asistente actual no tiene habilitada el alta de productos.');

    const borradorPrevio = leerJson(fila.borrador_json, borradorSchema);
    const historialPrevio = leerJson(fila.mensajes_json, mensajesSchema);
    const historial = [...historialPrevio, { rol: 'usuario' as const, texto }];
    const precioMensaje = buscarPrecios(texto)[0];
    const precioNeto = precioMensaje?.neto ?? borradorPrevio.precioNeto;
    const avisoPrecio = precioMensaje
      ? precioMensaje.bruto
        ? `Convertí el precio con IVA ${formatoPrecio(precioMensaje.indicado)} a neto ${formatoPrecio(precioMensaje.neto)} (dividido por ${1 + REGLAS.iva}).`
        : null
      : (borradorPrevio.avisoPrecio ?? null);
    const contexto: ContextoAltaProducto = {
      mensaje: ocultarPrecios(texto),
      historial: historial
        .slice(-12)
        .map((mensaje) => ({ ...mensaje, texto: ocultarPrecios(mensaje.texto) })),
      borrador: {
        modelo: borradorPrevio.modelo,
        familia: borradorPrevio.familia,
        madera: borradorPrevio.madera,
        tipo: borradorPrevio.tipo,
        medida: borradorPrevio.medida,
        anchoMin: borradorPrevio.anchoMin,
        anchoMax: borradorPrevio.anchoMax,
        largo: borradorPrevio.largo,
      },
      modelos: this.catalogo.modelos(),
      maderas: this.catalogo.maderas(),
    };
    const salida = await this.llm.interpretarProducto(contexto);
    const parsed = respuestaSchema.safeParse(salida);
    let borrador: BorradorProducto = { ...borradorPrevio, precioNeto, avisoPrecio };
    if (parsed.success) {
      const entrada = parsed.data.input;
      borrador = {
        modelo: entrada.modelo ?? borrador.modelo,
        familia: entrada.familia ?? borrador.familia,
        madera: entrada.madera ?? borrador.madera,
        tipo: entrada.tipo ?? borrador.tipo,
        medida: entrada.medida ?? borrador.medida,
        anchoMin: entrada.anchoMin ?? borrador.anchoMin,
        anchoMax: entrada.anchoMax ?? borrador.anchoMax,
        largo: entrada.largo ?? borrador.largo,
        precioNeto,
        avisoPrecio,
      };
    }

    let propuesta: Producto | null = null;
    let superpuesto: Producto | null;
    let respuesta: string;
    const avisos: string[] = [];
    if (!parsed.success) {
      respuesta =
        'No pude identificar todos los datos. Describe el producto y agrega el precio neto unitario explícitamente.';
    } else {
      const invalido = this.validar(borrador);
      if (invalido) respuesta = invalido;
      else {
        const faltan = this.falta(borrador);
        if (faltan.length) respuesta = `Para preparar el producto necesito ${faltan.join(', ')}.`;
        else {
          propuesta = this.construir(borrador);
          const modeloPropuesto = propuesta.modelo;
          const familiaExistente = this.catalogo.familiaExistente(propuesta.modelo);
          const duplicado = this.catalogo.productoDuplicado(propuesta);
          if (familiaExistente && familiaExistente !== propuesta.familia) {
            propuesta = null;
            respuesta = `El modelo ${modeloPropuesto} ya pertenece a otra familia. Usa un nombre de modelo distinto.`;
          } else if (duplicado) {
            propuesta = null;
            respuesta = `Ya existe un producto con esos atributos (código ${duplicado.codigo}). No agregué otro.`;
          } else if ((superpuesto = this.catalogo.rangoSuperpuesto(propuesta))) {
            propuesta = null;
            respuesta = `El rango de ancho se superpone con ${superpuesto.codigo} (${superpuesto.medida}) del mismo modelo, madera y alto. Indica un rango que no se cruce.`;
          } else {
            respuesta = 'Revisa la propuesta y confirma si quieres agregarla al catálogo.';
            const referencia = this.catalogo.preciosReferencia(propuesta.modelo, propuesta.familia);
            if (referencia.length) {
              const m = mediana(referencia);
              if (propuesta.precioNeto > m * 3 || propuesta.precioNeto < m / 3)
                avisos.push(
                  `El precio ${formatoPrecio(propuesta.precioNeto)} está muy lejos de la mediana ${formatoPrecio(Math.round(m))} de ${this.catalogo.familiaExistente(propuesta.modelo) ? propuesta.modelo : `la familia ${propuesta.familia}`}. Revisa que sea neto y unitario.`,
                );
            }
          }
        }
      }
    }
    if (propuesta && borrador.avisoPrecio) avisos.unshift(borrador.avisoPrecio);
    if (avisos.length) respuesta = [...avisos, respuesta].join('\n\n');
    historial.push({ rol: 'asistente', texto: respuesta });
    this.guardar(fila, borrador, historial, propuesta);
    return {
      id: fila.id,
      mensajes: historial.slice(-LIMITE_HISTORIAL),
      pregunta: respuesta,
      propuesta,
      avisos,
    };
  }

  confirmar(id: string, usuarioId: string, autor: string | null = null) {
    const fila = this.leerPendiente(id, usuarioId);
    if (!fila) throw new ErrorUsuarioCatalogo('La propuesta expiró o ya fue confirmada.');
    if (fila.expira <= new Date().toISOString()) {
      this.db.prepare('DELETE FROM productos_pendientes WHERE id = ?').run(id);
      throw new ErrorUsuarioCatalogo('La propuesta expiró. Inicia otra vez el alta.');
    }
    if (!fila.propuesta_json)
      throw new ErrorUsuarioCatalogo('Completa los datos y revisa la propuesta antes de guardarla.');
    const producto = leerJson(fila.propuesta_json, productoSchema);
    this.catalogo.agregarProductoManual(producto, fila.version_catalogo, id, autor);
    return producto;
  }

  cancelar(id: string, usuarioId: string) {
    this.db.prepare('DELETE FROM productos_pendientes WHERE id = ? AND user_id = ?').run(id, usuarioId);
  }
}
