package cl.puertasneltume.cotizador.nucleo.reglas

import cl.puertasneltume.cotizador.nucleo.modelo.Cotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.EstadoComercial
import cl.puertasneltume.cotizador.nucleo.modelo.EstadoCotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.EstadoOperativo
import cl.puertasneltume.cotizador.nucleo.modelo.Fabrica
import cl.puertasneltume.cotizador.nucleo.modelo.Facturacion
import cl.puertasneltume.cotizador.nucleo.modelo.NotaPedido
import cl.puertasneltume.cotizador.nucleo.modelo.SolicitudItem
import kotlin.math.ceil
import kotlin.math.roundToLong

// Reglas del ciclo de una cotización que comparten servidor y pantalla (src/negocio/estado.ts).

val etiquetaEstado = mapOf(
    EstadoCotizacion.BORRADOR to "Borrador",
    EstadoCotizacion.EMITIDA to "Emitida",
    EstadoCotizacion.APROBADA to "Aprobada",
    EstadoCotizacion.REEMPLAZADA to "Reemplazada",
    EstadoCotizacion.ANULADA to "Anulada",
)

val etiquetaComercial = mapOf(
    EstadoComercial.PENDIENTE to "Pendiente",
    EstadoComercial.ENVIADA to "Enviada",
    EstadoComercial.SEGUIMIENTO to "En seguimiento",
    EstadoComercial.APROBADA to "Aprobada",
    EstadoComercial.RECHAZADA to "Rechazada / cancelada",
    EstadoComercial.VENDIDA to "Vendida",
)

val etiquetaOperativo = mapOf(
    EstadoOperativo.SIN_PEDIDO to "Sin nota de pedido",
    EstadoOperativo.ANTICIPO_PAGADO to "${Limites.ANTICIPO_TEXTO} pagado",
    EstadoOperativo.PEDIDO_GENERADO to "Nota de pedido generada",
    EstadoOperativo.EN_PRODUCCION to "En producción",
    EstadoOperativo.SALDO_PENDIENTE to "Saldo pendiente",
    EstadoOperativo.PAGADA to "100 % pagado",
    EstadoOperativo.LISTA_DESPACHO to "Lista para despacho",
    EstadoOperativo.DESPACHADA to "Despachada",
    EstadoOperativo.COMPLETADA to "Completada",
)

private val etiquetasEvento = mapOf(
    "creada" to "Creada",
    "revision" to "Revisión creada",
    "duplicada" to "Duplicada",
    "modificada" to "Modificada",
    "emitida" to "Emitida",
    "aprobada" to "Aprobada",
    "anulada" to "Anulada",
    "reemplazada" to "Reemplazada",
    "desvinculada" to "Queda como cotización nueva",
    "pago_registrado" to "Pago registrado",
    "pago_anulado" to "Pago anulado",
    "despacho_actualizado" to "Despacho actualizado",
    "comentario" to "Comentario interno",
    "seguimiento" to "Seguimiento actualizado",
    "produccion" to "Producción iniciada",
    "produccion_terminada" to "Producción terminada",
    "nota_generada" to "Nota de pedido generada",
    "fabricas" to "Fábricas asignadas",
    "numero_cambiado" to "Número cambiado",
    "despachada" to "Despachada",
    "lista_despacho" to "Lista para despacho",
    "completada" to "Completada",
    "facturacion_actualizada" to "Datos de facturación actualizados",
    "facturada" to "Facturación actualizada",
)

/** Etiqueta de un evento de la actividad; un tipo nuevo del servidor se muestra tal cual. */
fun etiquetaEvento(tipo: String) = etiquetasEvento[tipo] ?: tipo.replace('_', ' ').replaceFirstChar { it.uppercase() }

/** Paso anterior de cada estado operativo (`PASO_ANTERIOR`). */
val PASO_ANTERIOR = mapOf(
    EstadoOperativo.COMPLETADA to EstadoOperativo.DESPACHADA,
    EstadoOperativo.DESPACHADA to EstadoOperativo.LISTA_DESPACHO,
    EstadoOperativo.LISTA_DESPACHO to EstadoOperativo.PAGADA,
    EstadoOperativo.PAGADA to EstadoOperativo.EN_PRODUCCION,
    EstadoOperativo.SALDO_PENDIENTE to EstadoOperativo.EN_PRODUCCION,
    EstadoOperativo.EN_PRODUCCION to EstadoOperativo.PEDIDO_GENERADO,
)

val FABRICAS = listOf(Fabrica.PANGUIPULLI, Fabrica.SANTIAGO)
val nombreFabrica = mapOf(Fabrica.PANGUIPULLI to "Panguipulli", Fabrica.SANTIAGO to "Santiago")
val productosFabrica = mapOf(
    Fabrica.PANGUIPULLI to "Puertas sólidas",
    Fabrica.SANTIAGO to "Puertas enchapadas y prepintadas",
)

/** «Pendiente de facturación» o «Facturada · Factura N° 123». */
fun etiquetaFacturacion(f: Facturacion?): String {
    if (f?.facturada != true) return "Pendiente de facturación"
    val documento = if (f.tipo?.clave == "boleta") "Boleta" else "Factura"
    return "Facturada · $documento${if (!f.identificadorExterno.isNullOrEmpty()) " N° ${f.identificadorExterno}" else ""}"
}

/** «N° 12 · Panguipulli». */
fun numeroNota(numero: Int, fabrica: Fabrica?) = "N° $numero${if (fabrica != null) " · ${nombreFabrica[fabrica]}" else ""}"

/** «N° 577 · Panguipulli y N° 59 · Santiago». */
fun numerosNotas(notas: List<Pair<Int, Fabrica?>>): String {
    val textos = notas.map { numeroNota(it.first, it.second) }
    return if (textos.size > 1) "${textos.dropLast(1).joinToString(", ")} y ${textos.last()}" else textos.firstOrNull() ?: ""
}

fun textoNotas(notas: List<Pair<Int, Fabrica?>>) =
    "${if (notas.size > 1) "las notas de pedido" else "la nota de pedido"} ${numerosNotas(notas)}"

/** Las notas en el orden de las fábricas; una sin fábrica va primero. */
fun ordenarNotas(notas: List<NotaPedido>) =
    notas.sortedBy { n -> n.fabrica?.let { FABRICAS.indexOf(it) + 1 } ?: 0 }

enum class EtapaProduccion(val etiqueta: String) {
    PENDIENTE("Sin iniciar"), EN_PRODUCCION("En producción"), TERMINADA("Producción terminada")
}

fun etapaProduccion(n: NotaPedido) = when {
    n.terminoProduccion != null -> EtapaProduccion.TERMINADA
    n.inicioProduccion != null -> EtapaProduccion.EN_PRODUCCION
    else -> EtapaProduccion.PENDIENTE
}

fun fabricaDeNota(n: NotaPedido) = n.fabrica?.let { nombreFabrica[it] } ?: "la fábrica"

/** La mitad del total, redondeada hacia arriba. */
fun anticipoMinimo(total: Long): Long = ceil(total * Limites.ANTICIPO_MINIMO).toLong()

/** «Otro» solo indica que falta el nombre del transportista. */
fun sinTransportista(transporte: String?) = transporte.isNullOrBlank() || transporte.trim().lowercase() == "otro"

const val CODIGO_FLETE = "FLETE"

fun cantidadFlete(q: Cotizacion) = q.fleteCantidad?.takeIf { it > 0 } ?: 1

fun unitarioFlete(q: Cotizacion): Long = (q.flete.toDouble() / cantidadFlete(q)).roundToLong()

/** La descripción escrita o «Flete / despacho a Temuco · Starken». */
fun descripcionFlete(q: Cotizacion): String {
    q.fleteDescripcion?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
    val destino = q.despacho?.destino?.trim()?.takeIf { it.isNotEmpty() }
    val transporte = q.despacho?.transporte
    return listOfNotNull(
        "Flete / despacho${if (destino != null) " a $destino" else ""}",
        transporte?.trim()?.takeIf { !sinTransportista(transporte) },
    ).joinToString(" · ")
}

fun operacionDe(q: Cotizacion): EstadoOperativo =
    q.estadoOperativo ?: if (q.notas.isNotEmpty()) EstadoOperativo.PEDIDO_GENERADO else EstadoOperativo.SIN_PEDIDO

fun totalPagado(q: Cotizacion): Long = q.pagos.sumOf { it.monto }

fun operacionPorProduccion(notas: List<NotaPedido>, pagado: Long, total: Long): EstadoOperativo {
    val vigentes = notas.filter { !it.anulada }
    if (vigentes.isNotEmpty() && vigentes.all { it.terminoProduccion != null })
        return if (pagado < total) EstadoOperativo.SALDO_PENDIENTE else EstadoOperativo.PAGADA
    return if (vigentes.any { it.inicioProduccion != null }) EstadoOperativo.EN_PRODUCCION else EstadoOperativo.PEDIDO_GENERADO
}

private val ETAPAS_PRODUCCION = setOf(
    EstadoOperativo.PEDIDO_GENERADO,
    EstadoOperativo.EN_PRODUCCION,
    EstadoOperativo.SALDO_PENDIENTE,
    EstadoOperativo.PAGADA,
)

data class UltimoPaso(val nota: NotaPedido, val termino: Boolean, val fecha: String)

/** El último inicio o término de producción registrado, o null. */
fun ultimoPasoProduccion(notas: List<NotaPedido>): UltimoPaso? {
    var ultimo: UltimoPaso? = null
    for (nota in notas) {
        if (nota.anulada) continue
        val (termino, fecha) = when {
            nota.terminoProduccion != null -> true to nota.terminoProduccion
            nota.inicioProduccion != null -> false to nota.inicioProduccion
            else -> continue
        }
        if (ultimo == null || fecha >= ultimo.fecha) ultimo = UltimoPaso(nota, termino, fecha)
    }
    return ultimo
}

/** Paso de producción que deshace el retroceso: la fábrica y el campo (`inicioProduccion` o `terminoProduccion`). */
data class NotaRetroceso(val fabrica: Fabrica?, val campo: String)

data class Retroceso(val desde: String, val hasta: String, val destino: EstadoOperativo, val nota: NotaRetroceso? = null)

/** Lo que anuncia «Volver al paso anterior», o null si no hay a dónde volver. */
fun retrocesoOperativo(q: Cotizacion): Retroceso? {
    if (q.estado != EstadoCotizacion.APROBADA) return null
    val actual = operacionDe(q)
    val ultimo = if (actual in ETAPAS_PRODUCCION) ultimoPasoProduccion(q.notas) else null
    if (ultimo != null && (actual == EstadoOperativo.EN_PRODUCCION || ultimo.termino)) {
        val notas = q.notas.map {
            if (it === ultimo.nota) {
                if (ultimo.termino) it.copy(terminoProduccion = null) else it.copy(inicioProduccion = null)
            } else it
        }
        val destino = operacionPorProduccion(notas, totalPagado(q), q.montos.total)
        val fabrica = fabricaDeNota(ultimo.nota)
        val una = q.notas.count { !it.anulada } == 1
        val desde = if (una) etiquetaOperativo.getValue(actual) else "${etapaProduccion(ultimo.nota).etiqueta} en $fabrica"
        val hasta = if (una) etiquetaOperativo.getValue(destino)
        else "${if (ultimo.termino) EtapaProduccion.EN_PRODUCCION.etiqueta else EtapaProduccion.PENDIENTE.etiqueta} en $fabrica"
        val campo = if (ultimo.termino) "terminoProduccion" else "inicioProduccion"
        return Retroceso(desde, hasta, destino, NotaRetroceso(ultimo.nota.fabrica, campo))
    }
    val destino = PASO_ANTERIOR[actual] ?: return null
    return Retroceso(etiquetaOperativo.getValue(actual), etiquetaOperativo.getValue(destino), destino)
}

/** Un pago se anula mientras la operación no llegue a «Lista para despacho». */
fun pagoAnulable(q: Cotizacion) = q.estado == EstadoCotizacion.APROBADA &&
    q.estadoOperativo !in setOf(EstadoOperativo.LISTA_DESPACHO, EstadoOperativo.DESPACHADA, EstadoOperativo.COMPLETADA)

sealed interface Anulable {
    data class Si(val pagado: Long) : Anulable
    data class No(val motivo: String) : Anulable
}

/** ¿Se puede anular? (`puedeAnular`; el servidor aplica la misma regla). */
fun puedeAnular(q: Cotizacion): Anulable = when {
    q.estado == EstadoCotizacion.ANULADA -> Anulable.No("La cotización N° ${q.numero} ya está anulada.")
    q.estado == EstadoCotizacion.BORRADOR -> Anulable.No("Un borrador no se anula: elimínalo.")
    q.estado == EstadoCotizacion.REEMPLAZADA ->
        Anulable.No("La cotización N° ${q.numero} fue reemplazada y ya no está vigente.")
    q.estadoOperativo == EstadoOperativo.DESPACHADA || q.estadoOperativo == EstadoOperativo.COMPLETADA ||
        q.facturacion?.facturada == true ->
        Anulable.No("No se puede anular una cotización despachada, completada o facturada.")
    else -> Anulable.Si(totalPagado(q))
}

data class RangoFecha(val min: String?, val max: String)

/** Días que admite la fecha de un pago o una factura: desde la aprobación hasta hoy. */
fun rangoFechaOperacion(aprobacion: String?) = RangoFecha(aprobacion?.let { Fechas.local(it) }, Fechas.hoy())

fun despachoEditable(q: Cotizacion) = q.estado == EstadoCotizacion.APROBADA &&
    q.estadoOperativo !in setOf(EstadoOperativo.DESPACHADA, EstadoOperativo.COMPLETADA)

/** Solo un borrador admite cambios directos; editar una emitida crea (o reutiliza) su revisión. */
fun esEditable(q: Cotizacion) = q.estado == EstadoCotizacion.BORRADOR || q.estado == EstadoCotizacion.EMITIDA

/** Aprobada con al menos una nota vigente: sus ítems se corrigen con `editar_pedido`. */
fun pedidoGenerado(q: Cotizacion) = q.estado == EstadoCotizacion.APROBADA && q.notas.any { !it.anulada }

fun esPersonalizado(s: SolicitudItem?) = s?.personalizado != null

/** Ítem libre: nombre, cantidad y precio; no va a fábrica. */
fun esLibre(s: SolicitudItem?) = s?.personalizado?.familia == "OTRO"

/** El ítem de una aprobada con notas que todavía se puede corregir. */
fun itemCorregible(q: Cotizacion, indice: Int): Boolean {
    val s = q.solicitudes.getOrNull(indice) ?: return false
    if (!pedidoGenerado(q)) return false
    if (esLibre(s)) return true
    val nota = q.notas.firstOrNull { !it.anulada && it.fabrica != null && it.fabrica == s.fabrica }
    return nota != null && nota.inicioProduccion == null
}

/** Solo una emitida puede estar «vencida». */
fun vencida(q: Cotizacion) = q.estado == EstadoCotizacion.EMITIDA && Fechas.vencida(q.vence)
