package cl.puertasneltume.cotizador.nucleo.reglas

import cl.puertasneltume.cotizador.nucleo.modelo.Cotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.EstadoCotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.EstadoOperativo
import cl.puertasneltume.cotizador.nucleo.modelo.ResumenCotizacion

/** El recorrido de un pedido (src/negocio/pasos.ts). */
val PASOS = listOf("Borrador", "Emitida", "Aprobada", "Anticipo", "Notas", "Producción", "Despacho", "Facturada")

data class AvancePedido(val hechos: List<Boolean>, val actual: Int)

private val EN_PRODUCCION = setOf(
    EstadoOperativo.SALDO_PENDIENTE,
    EstadoOperativo.PAGADA,
    EstadoOperativo.LISTA_DESPACHO,
    EstadoOperativo.DESPACHADA,
    EstadoOperativo.COMPLETADA,
)

fun avancePedido(
    estado: EstadoCotizacion,
    operacion: EstadoOperativo,
    notas: Int,
    pagado: Long,
    total: Long,
    facturada: Boolean,
): AvancePedido {
    val aprobada = estado == EstadoCotizacion.APROBADA
    val hechos = listOf(
        estado != EstadoCotizacion.BORRADOR,
        estado != EstadoCotizacion.BORRADOR && estado != EstadoCotizacion.ANULADA && estado != EstadoCotizacion.REEMPLAZADA,
        aprobada,
        aprobada && total > 0 && pagado >= anticipoMinimo(total),
        aprobada && notas > 0,
        aprobada && operacion in EN_PRODUCCION,
        aprobada && (operacion == EstadoOperativo.DESPACHADA || operacion == EstadoOperativo.COMPLETADA),
        aprobada && facturada,
    )
    val sin = hechos.indexOfFirst { !it }
    return AvancePedido(hechos, if (sin == -1) PASOS.size else sin)
}

fun avancePedido(q: Cotizacion) = avancePedido(
    q.estado,
    operacionDe(q),
    q.notas.count { !it.anulada },
    totalPagado(q),
    q.montos.total,
    q.facturacion?.facturada == true,
)

fun avancePedido(r: ResumenCotizacion) = avancePedido(
    r.estado,
    r.estadoOperativo ?: if (r.notas.isNotEmpty()) EstadoOperativo.PEDIDO_GENERADO else EstadoOperativo.SIN_PEDIDO,
    r.notas.count { !it.anulada },
    r.pagado ?: 0,
    r.total,
    r.facturacion?.estado == "facturada",
)
