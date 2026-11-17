package cl.puertasneltume.cotizador.nucleo.reglas

import cl.puertasneltume.cotizador.nucleo.api.Acciones
import cl.puertasneltume.cotizador.nucleo.modelo.Cliente
import cl.puertasneltume.cotizador.nucleo.modelo.Cotizacion
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlin.math.roundToLong

// Deshacer y rehacer de la web (src/app/cotizador.tsx): instantáneas de los ítems y de los datos generales, hasta 30,
// que se reenvían con `editar` (lo general) y `restaurar_items` (los ítems, tal como los guardó el servidor).

const val MAX_ACCIONES_HISTORIAL = 30

data class DatosGenerales(
    val cliente: Cliente,
    val descuento: Double,
    val descuentoManual: Boolean,
    val flete: Long,
    val fleteCantidad: Int,
    val fleteDescripcion: String?,
    val margenCotizacion: Double?,
    val observaciones: String?,
)

data class Instantanea(val solicitudes: JsonArray, val general: DatosGenerales)

fun instantaneaDe(q: Cotizacion, solicitudes: JsonArray) = Instantanea(
    solicitudes,
    DatosGenerales(
        cliente = q.cliente,
        descuento = q.descuento,
        descuentoManual = q.descuentoManual == true,
        flete = q.flete,
        fleteCantidad = q.fleteCantidad?.takeIf { it > 0 } ?: 1,
        fleteDescripcion = q.fleteDescripcion,
        margenCotizacion = q.margenCotizacion,
        observaciones = q.observaciones,
    ),
)

/** Pilas de una cotización y la versión con la que valen: si otra persona la cambió, se vacían. */
data class HistorialEdicion(
    val id: String? = null,
    val version: String? = null,
    val deshacer: List<Instantanea> = emptyList(),
    val rehacer: List<Instantanea> = emptyList(),
) {
    fun puedeDeshacer(q: Cotizacion?) = q != null && id == q.id && version == q.actualizada && deshacer.isNotEmpty()
    fun puedeRehacer(q: Cotizacion?) = q != null && id == q.id && version == q.actualizada && rehacer.isNotEmpty()

    /** Registra un cambio hecho a mano: la instantánea anterior va a «deshacer» y «rehacer» se vacía. */
    fun registrar(anterior: Instantanea, anteriorId: String, anteriorVersion: String, siguiente: Cotizacion): HistorialEdicion {
        val base = if (id == anteriorId) this else HistorialEdicion(anteriorId, anteriorVersion)
        return HistorialEdicion(siguiente.id, siguiente.actualizada, (base.deshacer + anterior).takeLast(MAX_ACCIONES_HISTORIAL), emptyList())
    }

    /** La cotización cambió sin cambiar lo que se deshace (o lo cambió deshacer): solo avanza la versión. */
    fun conVersion(q: Cotizacion) = if (id == q.id) copy(version = q.actualizada) else this

    /** Tras aplicar deshacer o rehacer: mueve la instantánea entre pilas. */
    fun aplicado(deshacerHecho: Boolean, actual: Instantanea, version: String?) = if (deshacerHecho)
        copy(version = version, deshacer = deshacer.dropLast(1), rehacer = (rehacer + actual).takeLast(MAX_ACCIONES_HISTORIAL))
    else copy(version = version, deshacer = (deshacer + actual).takeLast(MAX_ACCIONES_HISTORIAL), rehacer = rehacer.dropLast(1))

    companion object {
        fun vacio(id: String?) = HistorialEdicion(id)
    }
}

/** Cuerpo de `editar` que devuelve los datos generales a como estaban. */
fun cuerpoRestaurarGeneral(id: String, actualizada: String, g: DatosGenerales): JsonObject = Acciones.editar(id, actualizada) {
    CampoClienteLista.forEach { campo -> cliente(campo, g.cliente.valorDe(campo)) }
    if (g.descuentoManual) descuento(g.descuento) else descuentoAutomatico()
    if (g.flete > 0) fleteLinea(g.fleteDescripcion ?: "", g.fleteCantidad, (g.flete.toDouble() / g.fleteCantidad).roundToLong())
    else quitarFlete()
    margenCotizacion(g.margenCotizacion)
    observaciones(g.observaciones)
}

private val CampoClienteLista = listOf("nombre", "rut", "giro", "telefono", "direccion", "comuna", "proyecto")

private fun Cliente.valorDe(campo: String) = when (campo) {
    "nombre" -> nombre
    "rut" -> rut
    "giro" -> giro
    "telefono" -> telefono
    "direccion" -> direccion
    "comuna" -> comuna
    else -> proyecto
}
