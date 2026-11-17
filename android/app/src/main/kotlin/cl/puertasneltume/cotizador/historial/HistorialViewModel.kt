package cl.puertasneltume.cotizador.historial

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cl.puertasneltume.cotizador.Contenedor
import cl.puertasneltume.cotizador.nucleo.api.Descarga
import cl.puertasneltume.cotizador.nucleo.api.FalloApi
import cl.puertasneltume.cotizador.nucleo.api.FiltrosHistorial
import cl.puertasneltume.cotizador.nucleo.modelo.EventoCotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.ResumenCotizacion
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull

/** Chips de estado del historial (historial.tsx, `FILTROS`). */
enum class FiltroEstado(val etiqueta: String, val ayuda: String? = null) {
    TODAS("Todas"),
    BORRADOR("Borradores"),
    EMITIDA("Emitidas"),
    APROBADA("Aprobadas"),
    REEMPLAZADA("Reemplazadas", "Cambiadas por una revisión emitida: se consultan, pero ya no se aprueban"),
    ANULADA("Anuladas", "Sin efecto (por ejemplo, rechazadas por el cliente): su número no se reutiliza"),
    VENCEN("Vencen pronto", "Emitidas que vencen en los próximos 7 días"),
    SALDO("Con saldo pendiente", "Aprobadas con pagos por completar"),
    POR_FACTURAR("Por facturar", "Aprobadas pendientes de facturación"),
    PAPELERA("Papelera", "Borradores eliminados: se pueden restaurar"),
}

data class EstadoHistorial(
    val filtro: FiltroEstado = FiltroEstado.TODAS,
    val q: String = "",
    val desde: String? = null,
    val hasta: String? = null,
    val comercial: Set<String> = emptySet(),
    val operativo: Set<String> = emptySet(),
    val vendedora: String? = null,
    val items: List<ResumenCotizacion> = emptyList(),
    val total: Int = 0,
    val pagina: Int = 1,
    val cargando: Boolean = true,
    val cargandoMas: Boolean = false,
    val recargando: Boolean = false,
    val error: String? = null,
    val vendedoras: List<String> = emptyList(),
    val partesCsv: Int? = null,
    val exportando: Boolean = false,
) {
    val filtros: FiltrosHistorial
        get() = FiltrosHistorial(
            q = q,
            estado = when (filtro) {
                FiltroEstado.BORRADOR -> "borrador"
                FiltroEstado.EMITIDA -> "emitida"
                FiltroEstado.APROBADA -> "aprobada"
                FiltroEstado.REEMPLAZADA -> "reemplazada"
                FiltroEstado.ANULADA -> "anulada"
                else -> null
            },
            vencenPronto = filtro == FiltroEstado.VENCEN,
            saldoPendiente = filtro == FiltroEstado.SALDO,
            porFacturar = filtro == FiltroEstado.POR_FACTURAR,
            desde = desde,
            hasta = hasta,
            comercial = comercial.toList(),
            operativo = operativo.toList(),
            vendedora = vendedora,
        )

    /** Filtros de la hoja (fechas, seguimiento, operación, vendedora) activos. */
    val filtrosHoja: Int get() = listOfNotNull(desde, hasta, vendedora).size + comercial.size + operativo.size

    val hayMas: Boolean get() = items.size < total
}

/** Historial: listado paginado (30 por página) con búsqueda y filtros; se relee al cambiar cualquier filtro. */
class HistorialViewModel(private val c: Contenedor) : ViewModel() {
    private val _estado = MutableStateFlow(EstadoHistorial())
    val estado: StateFlow<EstadoHistorial> = _estado.asStateFlow()
    private var carga: Job? = null

    init {
        cargar(espera = 0)
        viewModelScope.launch {
            runCatching { c.api.vendedoras() }.onSuccess { v -> _estado.update { it.copy(vendedoras = v) } }
        }
    }

    fun cambiar(espera: Long = 0, cambio: (EstadoHistorial) -> EstadoHistorial) {
        _estado.update(cambio)
        cargar(espera)
    }

    fun buscar(texto: String) = cambiar(300) { it.copy(q = texto) }

    fun limpiar() = cambiar { it.copy(q = "", desde = null, hasta = null, comercial = emptySet(), operativo = emptySet(), vendedora = null, filtro = FiltroEstado.TODAS) }

    fun recargar() {
        _estado.update { it.copy(recargando = true) }
        cargar(0)
    }

    private fun cargar(espera: Long) {
        carga?.cancel()
        carga = viewModelScope.launch {
            if (espera > 0) delay(espera)
            _estado.update { it.copy(cargando = it.items.isEmpty() || !it.recargando, error = null, partesCsv = null) }
            try {
                val d = c.api.listado(_estado.value.filtros, 1, POR_PAGINA)
                _estado.update { it.copy(items = d.cotizaciones, total = d.total, pagina = 1, cargando = false, recargando = false) }
            } catch (e: FalloApi) {
                _estado.update { it.copy(cargando = false, recargando = false, error = e.message) }
            }
        }
    }

    fun cargarMas() {
        val e = _estado.value
        if (!e.hayMas || e.cargandoMas || e.cargando) return
        viewModelScope.launch {
            _estado.update { it.copy(cargandoMas = true) }
            try {
                val d = c.api.listado(e.filtros, e.pagina + 1, POR_PAGINA)
                _estado.update { s ->
                    s.copy(
                        items = s.items + d.cotizaciones.filter { n -> s.items.none { it.id == n.id } },
                        total = d.total,
                        pagina = e.pagina + 1,
                        cargandoMas = false,
                    )
                }
            } catch (x: FalloApi) {
                _estado.update { it.copy(cargandoMas = false, error = x.message) }
            }
        }
    }

    /** Exporta a CSV; sobre 5.000 filas el servidor pide hacerlo por partes. */
    suspend fun exportar(parte: Int? = null): Descarga? {
        _estado.update { it.copy(exportando = true) }
        return try {
            c.api.exportarCsv(_estado.value.filtros, parte)
        } catch (e: FalloApi) {
            if (e.codigo == "exportacion_por_partes") {
                val partes = (e.detalle?.get("partes") as? JsonPrimitive)?.intOrNull
                _estado.update { it.copy(partesCsv = partes) }
                null
            } else throw e
        } finally {
            _estado.update { it.copy(exportando = false) }
        }
    }

    suspend fun actividad(id: String): List<EventoCotizacion> = c.api.detalle(id).eventos

    companion object {
        const val POR_PAGINA = 30
    }
}
