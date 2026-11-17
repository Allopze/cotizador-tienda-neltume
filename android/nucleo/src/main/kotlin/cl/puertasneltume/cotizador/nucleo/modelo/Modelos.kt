package cl.puertasneltume.cotizador.nucleo.modelo

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

// Formas de las respuestas del servidor. Espejo de src/negocio/estado.ts, src/catalogo/tipos.ts,
// src/negocio/precios.ts y src/app/contrato.ts. Los montos son pesos enteros (Long); las medidas, metros (Double).
// Todo campo opcional en el servidor tiene un valor por omisión aquí: una respuesta de una versión anterior o
// posterior del servidor se sigue leyendo (los campos desconocidos se ignoran).

@Serializable
enum class EstadoCotizacion {
    @SerialName("borrador") BORRADOR,
    @SerialName("emitida") EMITIDA,
    @SerialName("aprobada") APROBADA,
    @SerialName("reemplazada") REEMPLAZADA,
    @SerialName("anulada") ANULADA,
}

@Serializable
enum class EstadoComercial {
    @SerialName("pendiente") PENDIENTE,
    @SerialName("enviada") ENVIADA,
    @SerialName("seguimiento") SEGUIMIENTO,
    @SerialName("aprobada") APROBADA,
    @SerialName("rechazada") RECHAZADA,
    @SerialName("vendida") VENDIDA,
}

@Serializable
enum class EstadoOperativo {
    @SerialName("sin_pedido") SIN_PEDIDO,
    @SerialName("anticipo_pagado") ANTICIPO_PAGADO,
    @SerialName("pedido_generado") PEDIDO_GENERADO,
    @SerialName("en_produccion") EN_PRODUCCION,
    @SerialName("saldo_pendiente") SALDO_PENDIENTE,
    @SerialName("pagada") PAGADA,
    @SerialName("lista_despacho") LISTA_DESPACHO,
    @SerialName("despachada") DESPACHADA,
    @SerialName("completada") COMPLETADA,
    ;

    /** El valor que viaja en la API. */
    val clave: String get() = name.lowercase()
}

@Serializable
enum class Fabrica {
    @SerialName("panguipulli") PANGUIPULLI,
    @SerialName("santiago") SANTIAGO,
    ;

    val clave: String get() = name.lowercase()
}

@Serializable
enum class TipoMedida {
    @SerialName("hoja") HOJA,
    @SerialName("vano") VANO,
    @SerialName("no_especificado") NO_ESPECIFICADO,
    ;

    val clave: String get() = name.lowercase()
}

@Serializable
enum class TipoDocumento {
    @SerialName("boleta") BOLETA,
    @SerialName("factura") FACTURA,
    ;

    val clave: String get() = name.lowercase()
}

@Serializable
data class Mensaje(val rol: String, val texto: String) {
    val esUsuario: Boolean get() = rol == "usuario"
}

@Serializable
data class Cliente(
    val nombre: String? = null,
    val rut: String? = null,
    val giro: String? = null,
    val telefono: String? = null,
    val direccion: String? = null,
    val comuna: String? = null,
    val proyecto: String? = null,
) {
    fun valor(campo: CampoCliente): String? = when (campo) {
        CampoCliente.NOMBRE -> nombre
        CampoCliente.RUT -> rut
        CampoCliente.GIRO -> giro
        CampoCliente.TELEFONO -> telefono
        CampoCliente.DIRECCION -> direccion
        CampoCliente.COMUNA -> comuna
        CampoCliente.PROYECTO -> proyecto
    }
}

enum class CampoCliente(val clave: String) {
    NOMBRE("nombre"), RUT("rut"), GIRO("giro"), TELEFONO("telefono"), DIRECCION("direccion"), COMUNA("comuna"),
    PROYECTO("proyecto");

    companion object {
        fun de(clave: String) = entries.firstOrNull { it.clave == clave }
    }
}

@Serializable
data class Producto(
    val codigo: String,
    val modelo: String,
    val familia: String,
    val tipo: String? = null,
    val madera: String,
    val medida: String = "",
    val anchoMin: Double? = null,
    val anchoMax: Double? = null,
    val altoMin: Double? = null,
    val altoMax: Double? = null,
    val largo: Double = 0.0,
    val precioNeto: Double = 0.0,
    val descripcion: String = "",
    val filaOrigen: Int = 0,
)

@Serializable
data class DescuentoItem(val tipo: String, val valor: Double) {
    val esPorcentaje: Boolean get() = tipo == "porcentaje"
}

@Serializable
data class ReferenciaItem(
    val archivo: String,
    val nombre: String,
    val tipo: String,
    val tamano: Long = 0,
    val fecha: String = "",
) {
    val esImagen: Boolean get() = tipo.startsWith("image/")
}

@Serializable
data class Personalizado(val familia: String)

@Serializable
data class SolicitudItem(
    val id: String? = null,
    val modelo: String? = null,
    val madera: String? = null,
    val ancho: Double? = null,
    val alto: Double? = null,
    val medida: String? = null,
    val cantidad: Int? = null,
    val precioUnitario: Long? = null,
    val margen: Double? = null,
    val tipoMedida: TipoMedida? = null,
    val medidaPorDefecto: Boolean = false,
    val descripcion: String? = null,
    val observaciones: String? = null,
    val modeloOriginal: String? = null,
    val coincidenciaModelo: String? = null,
    val fuente: String? = null,
    val personalizado: Personalizado? = null,
    val costoFabrica: Double? = null,
    val referencias: List<ReferenciaItem> = emptyList(),
    val descuento: DescuentoItem? = null,
    val fabrica: Fabrica? = null,
)

@Serializable
data class Linea(
    val producto: Producto,
    val cantidad: Int,
    val precioUnitario: Long,
    val precioFabrica: Double? = null,
    val margen: Double? = null,
    val precioCliente: Long? = null,
    val margenPersonalizado: Boolean = false,
    val tipoMedida: TipoMedida? = null,
    val observaciones: String? = null,
    val descripcionDocumento: String? = null,
    val precioUnitarioPersonalizado: Long? = null,
    val descuentoItem: DescuentoItem? = null,
    val descuentoUnitario: Long? = null,
    val total: Long,
    val indice: Int? = null,
    val anchoSolicitado: Double? = null,
    val altoSolicitado: Double? = null,
    val medidaSolicitada: String? = null,
)

@Serializable
data class Montos(
    val lineas: List<Linea> = emptyList(),
    val subtotal: Long = 0,
    val descuentoPorcentaje: Double = 0.0,
    val descuento: Long = 0,
    val flete: Long = 0,
    val neto: Long = 0,
    val iva: Long = 0,
    val total: Long = 0,
)

@Serializable
data class TramoDescuento(val desdePuertas: Int, val porcentaje: Double)

@Serializable
data class ReglasComerciales(
    val ajuste: Double = 0.25,
    val iva: Double = 0.19,
    val vigenciaDiasHabiles: Int = 10,
    val descuentoMaximo: Double = 50.0,
    val descuentosPorCantidad: List<TramoDescuento>? = null,
    val margenes: Map<String, Double>? = null,
)

/** Motivo por el que un ítem quedó pendiente (`Rechazo` del resolvedor del catálogo). */
@Serializable
data class Rechazo(
    val tipo: String,
    val campos: List<String> = emptyList(),
    /** Lista de opciones o, en `faltan_datos`, un objeto campo → opciones. */
    val disponibles: JsonElement? = null,
    val valor: JsonElement? = null,
    val sugerido: String? = null,
    val familia: String? = null,
    val campo: String? = null,
    val rango: Rango? = null,
    val ancho: Double? = null,
    val alto: Double? = null,
)

@Serializable
data class Rango(val min: Double, val max: Double)

@Serializable
data class Incompleto(val indice: Int, val rechazo: Rechazo, val pregunta: String = "")

@Serializable
data class Despacho(
    val direccion: String? = null,
    val transporte: String? = null,
    val entregaComprometida: String? = null,
    val destino: String? = null,
    val valor: Long? = null,
    val huella: String? = null,
)

@Serializable
data class Pago(
    val id: String,
    val fecha: String,
    val monto: Long,
    val observacion: String? = null,
    val usuario: String? = null,
)

@Serializable
data class ComentarioInterno(
    val id: String,
    val fecha: String,
    val texto: String,
    val usuario: String? = null,
)

@Serializable
data class ReceptorFacturacion(
    val razonSocial: String? = null,
    val rut: String? = null,
    val giro: String? = null,
    val direccion: String? = null,
    val comuna: String? = null,
    val correo: String? = null,
)

@Serializable
data class Facturacion(
    val estado: String = "pendiente",
    val documento: TipoDocumento? = null,
    val receptor: ReceptorFacturacion? = null,
    val tipo: TipoDocumento? = null,
    val identificadorExterno: String? = null,
    val fecha: String? = null,
) {
    val facturada: Boolean get() = estado == "facturada"
}

@Serializable
data class NotaPedido(
    val numero: Int,
    val fabrica: Fabrica? = null,
    val pdf: String = "",
    val montos: Montos = Montos(),
    val fecha: String = "",
    val despacho: Despacho = Despacho(),
    val observaciones: String? = null,
    val anulada: Boolean = false,
    val inicioProduccion: String? = null,
    val terminoProduccion: String? = null,
)

@Serializable
data class Cotizacion(
    val id: String,
    val numero: Int? = null,
    val estado: EstadoCotizacion,
    val cliente: Cliente = Cliente(),
    val solicitudes: List<SolicitudItem> = emptyList(),
    val montos: Montos = Montos(),
    val incompletos: List<Incompleto> = emptyList(),
    val historial: List<Mensaje> = emptyList(),
    val creada: String = "",
    val actualizada: String,
    val pdf: String? = null,
    val fechaEmision: String? = null,
    val origen: Int? = null,
    val origenId: String? = null,
    val vence: String? = null,
    val descuento: Double = 0.0,
    val descuentoManual: Boolean? = null,
    val flete: Long = 0,
    val fleteDescripcion: String? = null,
    val fleteCantidad: Int? = null,
    val margenCotizacion: Double? = null,
    val observaciones: String? = null,
    val despacho: Despacho? = null,
    val reglas: ReglasComerciales? = null,
    val creadaPor: String? = null,
    val emitidaPor: String? = null,
    val aprobadaPor: String? = null,
    val fechaAprobacion: String? = null,
    val anuladaPor: String? = null,
    val fechaAnulacion: String? = null,
    val motivoAnulacion: String? = null,
    val reemplazadaPor: Int? = null,
    val versionCatalogo: String? = null,
    val notas: List<NotaPedido> = emptyList(),
    val estadoComercial: EstadoComercial? = null,
    val estadoOperativo: EstadoOperativo? = null,
    val pagos: List<Pago> = emptyList(),
    val comentariosInternos: List<ComentarioInterno> = emptyList(),
    val facturacion: Facturacion? = null,
)

@Serializable
data class NotaResumen(
    val numero: Int,
    val fabrica: Fabrica? = null,
    val pdf: String = "",
    val fecha: String = "",
    val anulada: Boolean = false,
)

@Serializable
data class FacturacionResumen(
    val estado: String = "pendiente",
    val documento: TipoDocumento? = null,
    val tipo: TipoDocumento? = null,
    val receptor: ReceptorFacturacion? = null,
)

/** Fila del historial. */
@Serializable
data class ResumenCotizacion(
    val id: String,
    val numero: Int? = null,
    val estado: EstadoCotizacion,
    val cliente: Cliente = Cliente(),
    val subtotal: Long = 0,
    val descuento: Double = 0.0,
    val descuentoMonto: Long = 0,
    val flete: Long = 0,
    val neto: Long = 0,
    val iva: Long = 0,
    val total: Long = 0,
    val items: Int = 0,
    val pendientes: Int = 0,
    val productos: String = "",
    val creada: String = "",
    val actualizada: String = "",
    val fecha: String = "",
    val fechaEmision: String? = null,
    val vence: String? = null,
    val vencida: Boolean = false,
    val origen: Int? = null,
    val reemplazadaPor: Int? = null,
    val pdf: String? = null,
    val creadaPor: String? = null,
    val emitidaPor: String? = null,
    val aprobadaPor: String? = null,
    val anuladaPor: String? = null,
    val fechaAnulacion: String? = null,
    val notas: List<NotaResumen> = emptyList(),
    val estadoComercial: EstadoComercial? = null,
    val estadoOperativo: EstadoOperativo? = null,
    val pagado: Long? = null,
    val saldoPendiente: Long? = null,
    val porcentajePagado: Double? = null,
    val pagos: Int? = null,
    val facturacion: FacturacionResumen? = null,
)

@Serializable
data class EventoCotizacion(
    val fecha: String,
    val usuario: String? = null,
    val tipo: String,
    val detalle: String? = null,
)

@Serializable
data class OpcionCotizacion(
    val id: String,
    val actualizada: String,
    val numero: Int? = null,
    val estado: EstadoCotizacion,
    val cliente: String = "",
    val proyecto: String? = null,
    val comuna: String? = null,
    val fecha: String = "",
    val detalle: String = "",
)

@Serializable
data class ConfirmarAprobacion(
    val id: String,
    val numero: Int,
    val actualizada: String,
    val vence: String? = null,
    val vencida: Boolean = false,
)

@Serializable
data class ConfirmarNumero(
    val id: String,
    val actualizada: String,
    val documento: String,
    val fabrica: Fabrica? = null,
    val actual: Int,
    val numero: Int,
)

@Serializable
data class ItemCambio(val indice: Int, val descripcion: String)

@Serializable
data class ItemModificado(val antes: ItemCambio, val despues: ItemCambio)

@Serializable
data class CambiosCotizacion(
    val agregados: List<ItemCambio> = emptyList(),
    val quitados: List<ItemCambio> = emptyList(),
    val modificados: List<ItemModificado> = emptyList(),
    val cliente: List<String> = emptyList(),
)

@Serializable
data class Diagnostico(val modelo: String? = null, val respaldo: Boolean = false, val ms: Long? = null)

/** Respuesta de toda acción de `POST /api/accion`. */
@Serializable
data class Resultado(
    val cotizacion: Cotizacion,
    val archivo: String? = null,
    val archivos: List<String> = emptyList(),
    val seleccion: List<OpcionCotizacion> = emptyList(),
    val confirmar: ConfirmarAprobacion? = null,
    val confirmarNumero: ConfirmarNumero? = null,
    val avisos: List<String> = emptyList(),
    val cambios: CambiosCotizacion? = null,
    val eliminada: Boolean = false,
    val efimera: Boolean = false,
    val diagnostico: Diagnostico? = null,
)

@Serializable
data class Listado(
    val cotizaciones: List<ResumenCotizacion> = emptyList(),
    val total: Int = 0,
    val pagina: Int = 1,
    val porPagina: Int = 30,
    val asistenteConfigurado: Boolean = false,
)

/** Borrador eliminado tal como lo lista la papelera (`BorradorEnPapelera` en src/servidor/almacen.ts): sin estado ni montos. */
@Serializable
data class BorradorEnPapelera(
    val id: String,
    /** Versión guardada: `restaurar_borrador` la exige. */
    val actualizada: String,
    val eliminada: String = "",
    val creada: String = "",
    val creadaPor: String? = null,
    val cliente: Cliente = Cliente(),
    val items: Int = 0,
    val productos: String = "",
    /** Número de la cotización emitida que revisaba; null si era una cotización nueva. */
    val origen: Int? = null,
    val total: Long = 0,
)

@Serializable
data class Papelera(
    val borradores: List<BorradorEnPapelera> = emptyList(),
    val total: Int = 0,
    val pagina: Int = 1,
    val porPagina: Int = 30,
    val plazoDias: Int = 30,
)

@Serializable
data class Detalle(
    val cotizacion: Cotizacion,
    val eventos: List<EventoCotizacion> = emptyList(),
    val asistenteConfigurado: Boolean = false,
)

@Serializable
data class NotasNumeracion(val panguipulli: Int? = null, val santiago: Int? = null)

@Serializable
data class Numeracion(
    val ultimo: Int? = null,
    val siguiente: Int,
    val tope: Int,
    val notas: JsonObject? = null,
)

@Serializable
data class Vendedoras(val vendedoras: List<String> = emptyList())

// --- Catálogo ---------------------------------------------------------------------------------------------

@Serializable
data class ProductoConsulta(
    val codigo: String,
    val modelo: String,
    val familia: String,
    val tipo: String? = null,
    val madera: String,
    val medida: String = "",
    val largo: Double = 0.0,
    val anchoMin: Double? = null,
    val anchoMax: Double? = null,
    val altoMin: Double? = null,
    val altoMax: Double? = null,
    val descripcion: String = "",
    val unitario: Long = 0,
    val manual: Boolean = false,
)

@Serializable
data class GrupoConsulta(
    val modelo: String,
    val madera: String,
    val familia: String,
    val total: Int,
    val anchoMin: Double? = null,
    val anchoMax: Double? = null,
    val altoMin: Double = 0.0,
    val altoMax: Double = 0.0,
)

@Serializable
data class RespuestaConsulta(
    val total: Int = 0,
    val productos: List<ProductoConsulta> = emptyList(),
    val interpretacion: String? = null,
    val sugerencia: String? = null,
    val grupos: List<GrupoConsulta> = emptyList(),
)

// --- Clientes ---------------------------------------------------------------------------------------------

@Serializable
data class ClienteRegistrado(
    val id: String,
    val nombre: String,
    val rut: String? = null,
    val giro: String? = null,
    val telefono: String? = null,
    val direccion: String? = null,
    val comuna: String? = null,
    val correo: String? = null,
    val notas: String? = null,
    val documentoHabitual: TipoDocumento? = null,
    val receptorFacturacion: ReceptorFacturacion? = null,
    val creado: String = "",
    val actualizado: String = "",
    val creadoPor: String? = null,
    val actualizadoPor: String? = null,
)

// --- Sesión y cuentas ---------------------------------------------------------------------------------------

@Serializable
data class UsuarioSesion(
    val id: String = "",
    val email: String = "",
    val name: String = "",
    val role: String? = null,
)

@Serializable
data class SesionActual(val user: UsuarioSesion? = null)

@Serializable
data class SesionCuenta(
    val id: String,
    val creada: String = "",
    val vence: String = "",
    val dispositivo: String? = null,
    val ip: String? = null,
    val actual: Boolean = false,
)

@Serializable
data class Sesiones(val sesiones: List<SesionCuenta> = emptyList(), val cerradaActual: Boolean = false)

@Serializable
data class EstadoPrimerArranque(val pendiente: Boolean = false, val vence: String? = null)

/** Cotización de un cliente en el directorio. */
@Serializable
data class CotizacionDeCliente(
    val id: String,
    val numero: Int? = null,
    val estado: EstadoCotizacion,
    val actualizada: String = "",
    val proyecto: String? = null,
    val total: Long = 0,
)

/**
 * Cliente del directorio o de las sugerencias: puede estar registrado (frecuente, con `id`) o salir solo de
 * cotizaciones anteriores (sin `id`).
 */
@Serializable
data class ClienteDirectorio(
    val id: String? = null,
    val nombre: String? = null,
    val rut: String? = null,
    val giro: String? = null,
    val telefono: String? = null,
    val direccion: String? = null,
    val comuna: String? = null,
    val registrado: Boolean = false,
    val correo: String? = null,
    val documentoHabitual: TipoDocumento? = null,
    val receptorFacturacion: ReceptorFacturacion? = null,
    val notas: String? = null,
    val actualizado: String? = null,
    val cantidad: Int = 0,
    val cotizaciones: List<CotizacionDeCliente> = emptyList(),
)
