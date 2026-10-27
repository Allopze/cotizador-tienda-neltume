// Tipos de la API de `Servicio`: las acciones que recibe y lo que responde. Viven aparte para que los módulos que
// arman una acción (chat.ts, edicion.ts) los usen sin importar el servicio completo.
import type { Cliente, Familia, ReferenciaItem, SolicitudItem } from '../catalogo/tipos';
import type { Cotizacion, Despacho, Fabrica, Mensaje } from '../negocio/estado';
import type { TarifaStarkenAplicada } from '../negocio/starken';
import type { OpcionCotizacion } from './referencias';

export type Accion =
  /** Solo pruebas: la interfaz crea el borrador con el primer mensaje del chat. */
  | { tipo: 'nueva'; nuevoId?: string }
  | {
      tipo: 'chat';
      id?: string;
      /** Versión de la cotización `id` que ve la persona; obligatoria desde la API si hay `id`. */
      actualizada?: string;
      mensaje: string;
      objetivoId?: string;
      objetivoActualizada?: string;
      /**
       * Id que la interfaz propone para el borrador nuevo. Si la persona cancela la espera y reenvía,
       * el servidor reconoce que ese mensaje ya se procesó en vez de crear un duplicado.
       */
      nuevoId?: string;
      /** Intercambio previo que no generó borrador (preguntas, aprobaciones); solo contexto para la IA. */
      contexto?: Mensaje[];
    }
  | { tipo: 'quitar'; id: string; actualizada: string; indice: number }
  | { tipo: 'reordenar'; id: string; actualizada: string; desde: number; hasta: number }
  | { tipo: 'restaurar_borrador'; id: string; actualizada: string }
  | { tipo: 'desaprobar'; id: string; actualizada: string }
  /** Recupera un PDF perdido; el de una nota se indica con su fábrica (sin ella, la única nota). */
  | { tipo: 'regenerar_pdf'; id: string; actualizada: string; documento: 'cotizacion' | 'nota'; fabrica?: Fabrica }
  | { tipo: 'retroceder_operacion'; id: string; actualizada: string; motivo: string }
  | { tipo: 'restaurar_items'; id: string; actualizada: string; items: SolicitudItem[] }
  | {
      tipo: 'agregar_producto';
      id?: string;
      actualizada?: string;
      codigo: string;
      cantidad: number;
      ancho?: number;
      alto?: number;
      tipoMedida?: 'hoja' | 'vano' | 'no_especificado';
    }
  /** Producto fuera de catálogo con su precio y, opcionalmente, las referencias que entregó el cliente. */
  | {
      tipo: 'agregar_personalizado';
      id?: string;
      actualizada?: string;
      item: ProductoPersonalizado;
    }
  | { tipo: 'emitir'; id: string; actualizada: string; numero?: number }
  | {
      tipo: 'aprobar';
      id: string;
      actualizada: string;
      confirmarVencida?: boolean;
      despacho?: Partial<Despacho>;
    }
  /**
   * Copia la cotización en un borrador nuevo. `nuevoId` lo propone la interfaz: si la persona reintenta tras un
   * timeout, el servidor devuelve la copia que ya creó en vez de duplicarla (auditoría BUG-047).
   */
  | { tipo: 'duplicar'; id: string; nuevoId?: string }
  | { tipo: 'eliminar'; id: string; actualizada: string }
  | { tipo: 'anular'; id: string; actualizada: string; motivo?: string }
  | {
      tipo: 'editar';
      id: string;
      actualizada: string;
      cliente?: Partial<Cliente>;
      cantidades?: { indice: number; cantidad: number }[];
      items?: {
        indice: number;
        cambios: Partial<Pick<SolicitudItem, 'modelo' | 'madera' | 'ancho' | 'alto' | 'medida' | 'precioUnitario' | 'margen' | 'tipoMedida' | 'descripcion' | 'observaciones' | 'referencias' | 'descuento' | 'personalizado' | 'costoFabrica'>>;
      }[];
      /** Fija el descuento (%) a mano: deja de seguir al descuento por cantidad. */
      descuento?: number;
      /** Vuelve al descuento por cantidad que corresponde a las puertas de la cotización. */
      descuentoAutomatico?: true;
      flete?: number;
      /**
       * Línea de flete del detalle: lo que se indique reemplaza su descripción, cantidad o unitario y el flete
       * pasa a ser cantidad × unitario; null la quita (flete $0). Tiene prioridad sobre `flete` y `despacho.valor`.
       */
      fleteLinea?: { descripcion?: string | null; cantidad?: number; unitario?: number } | null;
      /** Margen especial de toda la cotización (fracción); null vuelve al margen de cada categoría. */
      margenCotizacion?: number | null;
      observaciones?: string | null;
      despacho?: Partial<Despacho> | null;
      /** Tarifa de Starken elegida por la persona: el valor de despacho debe ser su neto y la actividad la registra. */
      tarifaStarken?: TarifaStarkenAplicada;
    }
  | { tipo: 'pago'; id: string; actualizada: string; monto: number; fecha?: string; observacion?: string | null }
  /** Quita un pago registrado por error mientras la operación no llegue a «Lista para despacho». */
  | { tipo: 'anular_pago'; id: string; actualizada: string; pagoId: string; motivo?: string }
  /** Datos logísticos de una cotización aprobada; el valor del flete queda fijo desde la emisión. */
  | { tipo: 'despacho'; id: string; actualizada: string; despacho: Partial<Despacho> }
  | { tipo: 'comentario'; id: string; actualizada: string; texto: string }
  | { tipo: 'comercial'; id: string; actualizada: string; estado: 'seguimiento' | 'rechazada' }
  /**
   * Genera las notas de pedido, una por fábrica, con las líneas asignadas a cada una. `asignaciones` fija antes la
   * fábrica de esos ítems; `fabrica` recibe los que siguen sin asignar. Sin fábrica para algún ítem, no se genera nada.
   */
  | { tipo: 'generar_nota'; id: string; actualizada: string; fabrica?: Fabrica; asignaciones?: AsignacionFabrica[] }
  /** Asigna (o quita, con null) la fábrica de cada ítem. No crea una revisión: la cotización del cliente no cambia. */
  | { tipo: 'asignar_fabricas'; id: string; actualizada: string; asignaciones: AsignacionFabrica[] }
  /**
   * Cambia el número de la cotización emitida o de una de sus notas (la de `fabrica`) y vuelve a generar su PDF; al
   * cambiar el de la cotización, también los de sus notas, que la nombran.
   */
  | { tipo: 'cambiar_numero'; id: string; actualizada: string; documento: 'cotizacion' | 'nota'; fabrica?: Fabrica; numero: number }
  /** Los pasos de producción se registran por fábrica (`fabrica`); sin ella, en todas las notas que corresponda. */
  | { tipo: 'operacion'; id: string; actualizada: string; paso: 'iniciar_produccion' | 'produccion_terminada' | 'lista_despacho' | 'despachada' | 'completada'; fabrica?: Fabrica; despacho?: Partial<Despacho> }
  | { tipo: 'facturacion'; id: string; actualizada: string; estado: 'pendiente' | 'facturada'; tipoDocumento?: 'factura' | 'boleta' | null; identificadorExterno?: string | null; fecha?: string | null };

/** Fábrica de un ítem (por su índice en la cotización); null la quita. */
export interface AsignacionFabrica {
  indice: number;
  fabrica: Fabrica | null;
}

/** Datos de un producto fuera de catálogo, tal como se escriben al agregarlo. Las medidas van en metros. */
export interface ProductoPersonalizado {
  nombre: string;
  familia: Familia;
  madera: string;
  descripcion?: string | null;
  ancho?: number | null;
  alto?: number | null;
  tipoMedida?: 'hoja' | 'vano' | 'no_especificado';
  cantidad: number;
  precioUnitario: number;
  observaciones?: string | null;
  referencias?: ReferenciaItem[];
}
export interface ItemCambio {
  indice: number;
  descripcion: string;
}
/** Diferencias de ítems y cliente respecto de la versión anterior, para mostrar en la interfaz. */
export interface CambiosCotizacion {
  agregados: ItemCambio[];
  quitados: ItemCambio[];
  modificados: { antes: ItemCambio; despues: ItemCambio }[];
  cliente: (keyof Cliente)[];
}
export interface Resultado {
  cotizacion: Cotizacion;
  archivo?: string;
  /** Al generar las notas de pedido: el PDF de cada una (`archivo` es el de la primera). */
  archivos?: string[];
  /** Opciones de cotización cuando la referencia del mensaje coincide con varios registros. */
  seleccion?: OpcionCotizacion[];
  /** Aprobación pedida por chat: la interfaz debe confirmarla con la acción explícita `aprobar`. */
  confirmar?: { id: string; numero: number; actualizada: string; vence: string | null; vencida: boolean };
  /** Cambio de número pedido por chat: la interfaz lo confirma con la acción explícita `cambiar_numero`. */
  confirmarNumero?: {
    id: string;
    actualizada: string;
    documento: 'cotizacion' | 'nota';
    fabrica?: Fabrica;
    actual: number;
    numero: number;
  };
  /** Avisos no bloqueantes: precios que cambiaron al emitir, RUT inválido, cantidades descartadas. */
  avisos?: string[];
  cambios?: CambiosCotizacion;
  /** Solo en `eliminar`: la cotización devuelta ya no existe. */
  eliminada?: true;
  /**
   * Respuesta sin pedido (pregunta, aprobación, mensaje sin productos ni cliente) desde una pantalla
   * nueva: no se guarda un borrador vacío; la cotización devuelta solo lleva el intercambio.
   */
  efimera?: true;
}
export interface UsuarioServicio {
  nombre: string;
  email: string;
  /** Cuenta administradora: la única que cambia números de documentos (también al pedirlo por chat). */
  admin?: boolean;
}
/**
 * De dónde sale un aviso del chat: la lectura por frase (`campo`, `palabra`), una cifra o un nombre que no está
 * escrito (`cifras`, `nombres`), un pedido sin registrar (`noRegistre`, `responder`) u otro (flete, precios…).
 */
export type CategoriaAviso = 'campo' | 'palabra' | 'cifras' | 'nombres' | 'noRegistre' | 'responder' | 'otros';
/** Lo que pasó en un mensaje del chat, para medir: qué herramienta usó la IA y qué avisó el servidor. */
export interface DiagnosticoTurno {
  /** Herramienta de la IA; 'directa' si no se consultó; null si la respuesta no se pudo usar. */
  herramienta: string | null;
  modelo?: string;
  respaldo?: boolean;
  avisos: { categoria: CategoriaAviso; texto: string }[];
}
