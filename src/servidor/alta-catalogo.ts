import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { atributosProductoSchema } from '../asistente/esquemas';
import type { LLM, ContextoAltaProducto } from '../asistente/llm';
import { descripcion } from '../catalogo/importar';
import type { Familia, Producto } from '../catalogo/tipos';
import { RepositorioCatalogoSqlite } from './repositorio-catalogo';

const borradorSchema = atributosProductoSchema.extend({ precioNeto: z.number().positive().nullable() }).strict();
const productoSchema = z.object({
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
}).strict();
const mensajesSchema = z.array(z.object({ rol: z.enum(['usuario', 'asistente']), texto: z.string() }).strict());
const respuestaSchema = z.object({ name: z.literal('proponer_producto'), input: atributosProductoSchema }).strict();
type AtributosProducto = z.infer<typeof atributosProductoSchema>;
type BorradorProducto = AtributosProducto & { precioNeto: number | null };
type MensajeAlta = { rol: 'usuario' | 'asistente'; texto: string };
type FilaPendiente = {
  id: string;
  version: number;
  version_catalogo: string;
  borrador_json: string;
  mensajes_json: string;
  propuesta_json: string | null;
  expira: string;
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
  if (!parsed.success) throw new ErrorUsuarioCatalogo('La propuesta guardada ya no es válida. Inicia otra vez el alta.');
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

/** Solo toma montos vinculados a una expresión de precio o al signo monetario. */
export function extraerPrecioNeto(texto: string): number | null {
  const patrones = [
    /\bprecio(?:\s+(?:unitario(?:\s+neto)?|neto(?:\s+unitario)?))?\b(?:\s+(?:es|de|a|por))?\s*:?\s*\$?\s*([\d][\d., ]*)(?:\s*(mil|k))?(?=\s|$|[,;.!])/i,
    /\bneto(?:\s+unitario)?\b(?:\s+(?:es|de|a|por))?\s*:?\s*\$?\s*([\d][\d., ]*)(?:\s*(mil|k))?(?=\s|$|[,;.!])/i,
    /\$\s*([\d][\d., ]*)(?:\s*(mil|k))?(?=\s|$|[,;.!])/i,
    /\b(?:cuesta|vale|sale)\s+\$?([\d][\d., ]*)(?:\s*(mil|k))?(?=\s|$|[,;.!])/i,
  ];
  for (const patron of patrones) {
    const match = texto.match(patron);
    if (!match) continue;
    let cifra = match[1].replace(/\s/g, '').replace(/[.,]+$/, '');
    if (cifra.includes('.') && cifra.includes(',')) cifra = cifra.replace(/\./g, '').replace(',', '.');
    else if (cifra.includes(',')) cifra = cifra.replace(',', '.');
    else if (cifra.includes('.')) cifra = cifra.replace(/\./g, '');
    const base = Number(cifra);
    const precio = match[2] ? base * 1000 : base;
    // La palabra precio/neto o verbos como «vale» también marcan montos pequeños sin $.
    const tieneMarcadorClaro =
      match[0].includes('$') ||
      !!match[2] ||
      /\b(?:precio|neto|cuesta|vale|sale)\b/i.test(match[0]);
    if (
      Number.isFinite(precio) &&
      precio > 0 &&
      precio <= 100_000_000 &&
      (precio >= 1000 || tieneMarcadorClaro)
    )
      return precio;
  }
  return null;
}

function ocultarPrecios(texto: string) {
  let seguro = texto.replace(/\$\s*[\d][\d., ]*(?:\s*(?:mil|k))?/gi, '[precio indicado]');
  const patrones = [
    /\bprecio(?:\s+(?:unitario(?:\s+neto)?|neto(?:\s+unitario)?))?\b(?:\s+(?:es|de|a|por))?\s*:?\s*[\d][\d., ]*(?:\s*(?:mil|k))?/gi,
    /\bneto(?:\s+unitario)?\b(?:\s+(?:es|de|a|por))?\s*:?\s*[\d][\d., ]*(?:\s*(?:mil|k))?/gi,
    /\b(?:cuesta|vale|sale)\s+[\d][\d., ]*(?:\s*(?:mil|k))?/gi,
  ];
  for (const patron of patrones) {
    seguro = seguro.replace(patron, (coincidencia) =>
      extraerPrecioNeto(coincidencia) === null ? coincidencia : '[precio indicado]',
    );
  }
  return seguro;
}

export class ErrorUsuarioCatalogo extends Error {}

export class ServicioAltaCatalogo {
  constructor(
    private db: Database.Database,
    private catalogo: RepositorioCatalogoSqlite,
    private llm: LLM,
  ) {}

  private limpiarExpirados() {
    this.db.prepare('DELETE FROM productos_pendientes WHERE expira <= ?').run(new Date().toISOString());
  }

  private nuevo(): FilaPendiente {
    const versionCatalogo = this.catalogo.version;
    if (!versionCatalogo) throw new ErrorUsuarioCatalogo('Carga un catálogo antes de agregar productos.');
    const id = randomUUID();
    const expira = new Date(Date.now() + TTL_MS).toISOString();
    this.db
      .prepare(`
        INSERT INTO productos_pendientes (
          id, version, version_catalogo, borrador_json, mensajes_json, propuesta_json, actualizada, expira
        ) VALUES (?, 0, ?, ?, '[]', NULL, ?, ?)
      `)
      .run(id, versionCatalogo, JSON.stringify(BORRADOR_VACIO), new Date().toISOString(), expira);
    return this.leerPendiente(id)!;
  }

  private leerPendiente(id: string) {
    return this.db.prepare('SELECT * FROM productos_pendientes WHERE id = ?').get(id) as FilaPendiente | undefined;
  }

  private guardar(
    fila: FilaPendiente,
    borrador: BorradorProducto,
    mensajes: MensajeAlta[],
    propuesta: Producto | null,
  ) {
    const actualizado = this.db
      .prepare(`
        UPDATE productos_pendientes SET
          version = version + 1,
          borrador_json = ?,
          mensajes_json = ?,
          propuesta_json = ?,
          actualizada = ?,
          expira = ?
        WHERE id = ? AND version = ?
      `)
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
      throw new ErrorUsuarioCatalogo('Esta conversación cambió en otra solicitud. Vuelve a enviar el último mensaje.');
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
        (borrador.anchoMin <= 0 || borrador.anchoMin > 4 ||
          borrador.anchoMax === null || borrador.anchoMax < borrador.anchoMin || borrador.anchoMax > 4)
      )
        return 'El rango de ancho no es válido. Indica, por ejemplo, de 0,80 a 0,85 m.';
    } else if (borrador.familia && borrador.medida) {
      const medida = borrador.medida.replace(/[×*]/g, 'X').replace(/\s/g, '').replace(/\./g, ',');
      if (!/^\d+(?:,\d+)?X\d+(?:,\d+)?$/i.test(medida))
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
        : borrador.medida!.replace(/[×*]/g, 'X').replace(/\s/g, '').replace(/\./g, ',').toUpperCase();
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

  async mensaje(id: string | undefined, texto: string) {
    this.limpiarExpirados();
    const fila = id ? this.leerPendiente(id) : this.nuevo();
    if (!fila) throw new ErrorUsuarioCatalogo('La conversación de alta expiró. Inicia otra vez.');
    if (fila.expira <= new Date().toISOString()) {
      this.db.prepare('DELETE FROM productos_pendientes WHERE id = ?').run(fila.id);
      throw new ErrorUsuarioCatalogo('La conversación de alta expiró. Inicia otra vez.');
    }
    if (this.catalogo.version !== fila.version_catalogo)
      throw new ErrorUsuarioCatalogo('El catálogo cambió durante el alta. Inicia una propuesta nueva.');
    if (!this.llm.interpretarProducto)
      throw new ErrorUsuarioCatalogo('El asistente actual no tiene habilitada el alta de productos.');

    const borradorPrevio = leerJson(fila.borrador_json, borradorSchema);
    const historialPrevio = leerJson(fila.mensajes_json, mensajesSchema);
    const historial = [...historialPrevio, { rol: 'usuario' as const, texto }];
    const precioMensaje = extraerPrecioNeto(texto);
    const precioNeto = precioMensaje ?? borradorPrevio.precioNeto;
    const contexto: ContextoAltaProducto = {
      mensaje: ocultarPrecios(texto),
      historial: historial.slice(-12).map((mensaje) => ({ ...mensaje, texto: ocultarPrecios(mensaje.texto) })),
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
    let borrador: BorradorProducto = { ...borradorPrevio, precioNeto };
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
      };
    }

    let propuesta: Producto | null = null;
    let respuesta: string;
    if (!parsed.success) {
      respuesta = 'No pude identificar todos los datos. Describe el producto y agrega el precio neto unitario explícitamente.';
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
          } else {
            respuesta = 'Revisa la propuesta y confirma si quieres agregarla al catálogo.';
          }
        }
      }
    }
    historial.push({ rol: 'asistente', texto: respuesta });
    this.guardar(fila, borrador, historial, propuesta);
    return {
      id: fila.id,
      mensajes: historial.slice(-LIMITE_HISTORIAL),
      pregunta: respuesta,
      propuesta,
    };
  }

  confirmar(id: string) {
    const fila = this.leerPendiente(id);
    if (!fila) throw new ErrorUsuarioCatalogo('La propuesta expiró o ya fue confirmada.');
    if (fila.expira <= new Date().toISOString()) {
      this.db.prepare('DELETE FROM productos_pendientes WHERE id = ?').run(id);
      throw new ErrorUsuarioCatalogo('La propuesta expiró. Inicia otra vez el alta.');
    }
    if (!fila.propuesta_json) throw new ErrorUsuarioCatalogo('Completa los datos y revisa la propuesta antes de guardarla.');
    const producto = leerJson(fila.propuesta_json, productoSchema);
    this.catalogo.agregarProductoManual(producto, fila.version_catalogo, id);
    return producto;
  }

  cancelar(id: string) {
    this.db.prepare('DELETE FROM productos_pendientes WHERE id = ?').run(id);
  }
}
