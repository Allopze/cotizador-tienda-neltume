package cl.puertasneltume.cotizador.cotizar

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cl.puertasneltume.cotizador.Contenedor
import cl.puertasneltume.cotizador.comun.idNuevo
import cl.puertasneltume.cotizador.nucleo.api.Acciones
import cl.puertasneltume.cotizador.nucleo.api.Cambios
import cl.puertasneltume.cotizador.nucleo.api.Crudo
import cl.puertasneltume.cotizador.nucleo.api.FalloApi
import cl.puertasneltume.cotizador.nucleo.api.SesionVencida
import cl.puertasneltume.cotizador.nucleo.api.texto
import cl.puertasneltume.cotizador.nucleo.modelo.ConfirmarAprobacion
import cl.puertasneltume.cotizador.nucleo.modelo.ConfirmarNumero
import cl.puertasneltume.cotizador.nucleo.modelo.Cotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.EstadoCotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.Fabrica
import cl.puertasneltume.cotizador.nucleo.modelo.Mensaje
import cl.puertasneltume.cotizador.nucleo.modelo.OpcionCotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.ReferenciaItem
import cl.puertasneltume.cotizador.nucleo.modelo.Resultado
import cl.puertasneltume.cotizador.nucleo.modelo.TipoMedida
import cl.puertasneltume.cotizador.nucleo.reglas.Anulable
import cl.puertasneltume.cotizador.nucleo.reglas.Fechas
import cl.puertasneltume.cotizador.nucleo.reglas.HistorialEdicion
import cl.puertasneltume.cotizador.nucleo.reglas.Instantanea
import cl.puertasneltume.cotizador.nucleo.reglas.PreguntaPendiente
import cl.puertasneltume.cotizador.nucleo.reglas.cuerpoRestaurarGeneral
import cl.puertasneltume.cotizador.nucleo.reglas.esEditable
import cl.puertasneltume.cotizador.nucleo.reglas.instantaneaDe
import cl.puertasneltume.cotizador.nucleo.reglas.nombreFabrica
import cl.puertasneltume.cotizador.nucleo.reglas.numeroCotizacion
import cl.puertasneltume.cotizador.nucleo.reglas.pedidoGenerado
import cl.puertasneltume.cotizador.nucleo.reglas.pesos
import cl.puertasneltume.cotizador.nucleo.reglas.puedeAnular
import cl.puertasneltume.cotizador.nucleo.reglas.respuesta
import cl.puertasneltume.cotizador.nucleo.reglas.resumenCambios
import cl.puertasneltume.cotizador.nucleo.reglas.vencida
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/** El cotizador de la sesión: lo comparten Cotizar, el visor de documentos y las demás pantallas. */
val LocalCotizador = androidx.compose.runtime.staticCompositionLocalOf<CotizadorViewModel> { error("Falta el cotizador") }

/** Lo que está haciendo el cotizador (deshabilita lo demás mientras dura). */
enum class Operacion { CHAT, EDITAR, EMITIR, APROBAR, DUPLICAR, ELIMINAR, FLUJO, CARGAR }

/** Niveles de razonamiento del asistente, como en la web (Rápido… Máximo). */
val NIVELES_RAZONAMIENTO = listOf("no" to "Rápido", "low" to "Poco", "medium" to "Medio", "high" to "Alto", "max" to "Máximo")

data class Razonamiento(val modelo: String, val predeterminado: String, val nivel: String)

/** Varias cotizaciones coinciden con lo pedido por chat: la persona elige. */
data class Seleccion(val mensaje: String, val contextoId: String?, val opciones: List<OpcionCotizacion>, val totales: Map<String, Long> = emptyMap())

/** Ítems que acaban de cambiar (se resaltan) y el texto breve del cambio. */
data class CambioVisual(val id: String, val indices: Set<Int>, val total: Boolean, val texto: String, val marca: Long = System.nanoTime())

data class DatosAprobacion(
    val despacho: JsonObject?,
    val facturacion: JsonObject?,
)

/** Diálogos que un flujo abre y espera (precios que cambiaron, cotización vencida, confirmar por chat…). */
sealed interface Dialogo {
    data class Confirmacion(
        val titulo: String,
        val mensaje: String,
        val aceptar: String,
        val detalles: List<String> = emptyList(),
        val peligro: Boolean = false,
        val respuesta: CompletableDeferred<Boolean> = CompletableDeferred(),
    ) : Dialogo

    data class Aprobacion(
        val q: Cotizacion?,
        val numero: Int?,
        val vence: String?,
        val vencida: Boolean,
        val respuesta: CompletableDeferred<DatosAprobacion?> = CompletableDeferred(),
    ) : Dialogo

    data class Emision(val q: Cotizacion, val numeroManual: Boolean, val respuesta: CompletableDeferred<Int?> = CompletableDeferred()) : Dialogo

    data class Anulacion(val q: Cotizacion, val pagado: Long, val respuesta: CompletableDeferred<String?> = CompletableDeferred()) : Dialogo
}

sealed interface Efecto {
    data class Aviso(val texto: String, val accion: String? = null, val largo: Boolean = false, val alAccion: () -> Unit = {}) : Efecto
    data object MostrarCotizacion : Efecto
    data object MostrarPedido : Efecto
    data class Documento(val archivo: String, val detalle: String? = null) : Efecto
    data class Anuncio(val texto: String) : Efecto
    data class IrAlFinal(val indice: Int) : Efecto
}

data class EstadoCotizador(
    val cargando: Boolean = true,
    val cotizacion: Cotizacion? = null,
    val charla: List<Mensaje> = emptyList(),
    val enCurso: Operacion? = null,
    val guardando: String? = null,
    val seleccion: Seleccion? = null,
    val nota: String? = null,
    val avisosLocales: List<String> = emptyList(),
    val cambio: CambioVisual? = null,
    val configurado: Boolean = true,
    val razonamiento: Razonamiento? = null,
    val puedeDeshacer: Boolean = false,
    val puedeRehacer: Boolean = false,
    val textoConservado: Boolean = false,
    val dialogo: Dialogo? = null,
    val inicioEspera: Long? = null,
) {
    val ocupado: Boolean get() = enCurso != null
}

/**
 * El cotizador: la cotización abierta, el chat con el asistente y todas sus acciones. Es la lógica de
 * src/app/cotizador.tsx con los mismos mensajes; vive mientras la app está abierta (no por pantalla).
 */
@OptIn(FlowPreview::class)
class CotizadorViewModel(private val c: Contenedor) : ViewModel() {
    private val api = c.api
    private val _estado = MutableStateFlow(EstadoCotizador())
    val estado: StateFlow<EstadoCotizador> = _estado.asStateFlow()

    /** Texto del mensaje en preparación. */
    private val _mensaje = MutableStateFlow("")
    val mensaje: StateFlow<String> = _mensaje.asStateFlow()

    private val efectos = Channel<Efecto>(Channel.BUFFERED)
    val efecto = efectos.receiveAsFlow()

    /** JSON de las solicitudes tal como llegaron (deshacer las devuelve así). */
    private var solicitudesCrudas: JsonArray = JsonArray(emptyList())
    private var historial = HistorialEdicion()
    private var idPendiente: String? = null
    private var primerProducto: String? = null
    private var duplicadoPendiente: Pair<String, String>? = null
    private var tareaChat: Job? = null
    private var ultimaRecarga = 0L

    val q: Cotizacion? get() = _estado.value.cotizacion

    init {
        viewModelScope.launch { restaurar() }
        viewModelScope.launch {
            _mensaje.debounce(400).collect { c.preferencias.guardarBorrador(it, q?.id) }
        }
        leerAjustes()
    }

    private fun avisar(texto: String, accion: String? = null, largo: Boolean = false, alAccion: () -> Unit = {}) {
        efectos.trySend(Efecto.Aviso(texto, accion, largo, alAccion))
    }

    // --- Carga ------------------------------------------------------------------------------------------------

    /** Al iniciar: el texto que quedó escrito y la cotización abierta (como el sessionStorage de la web). */
    private suspend fun restaurar() {
        val (texto, idBorrador) = c.preferencias.borrador()
        if (texto.isNotBlank()) _mensaje.value = texto
        val id = idBorrador ?: c.preferencias.abierta()
        if (id != null) try {
            mostrarCruda(api.detalleCrudo(id).let { Crudo(it.valor.cotizacion, it.json["cotizacion"]!!.jsonObject) }, vaciarHistorial = true)
        } catch (e: FalloApi) {
            if (e !is SesionVencida) avisar("No se pudo reabrir la cotización.")
        }
        _estado.update { it.copy(cargando = false) }
    }

    private fun leerAjustes() = viewModelScope.launch {
        runCatching { api.obtenerJson("api/ajustes") }.onSuccess { a ->
            val configurado = (a["asistenteConfigurado"] as? JsonPrimitive)?.booleanOrNull ?: true
            val r = a["razonamiento"] as? JsonObject
            val razonamiento = r?.let {
                val modelo = it.texto("modelo") ?: return@let null
                val predeterminado = it.texto("predeterminado") ?: "no"
                Razonamiento(modelo, predeterminado, c.preferencias.razonamiento(modelo) ?: predeterminado)
            }
            _estado.update { it.copy(configurado = configurado, razonamiento = razonamiento) }
        }
    }

    fun elegirRazonamiento(nivel: String) {
        val r = _estado.value.razonamiento ?: return
        _estado.update { it.copy(razonamiento = r.copy(nivel = nivel)) }
        viewModelScope.launch { c.preferencias.guardarRazonamiento(r.modelo, nivel) }
    }

    private fun mostrarCruda(crudo: Crudo<Cotizacion>, vaciarHistorial: Boolean) {
        val cot = crudo.valor
        solicitudesCrudas = crudo.json["solicitudes"]?.jsonArray ?: JsonArray(emptyList())
        if (vaciarHistorial) historial = HistorialEdicion.vacio(cot.id)
        _estado.update { it.copy(cotizacion = cot).conHistorial() }
        viewModelScope.launch { c.preferencias.guardarAbierta(cot.id) }
    }

    private fun EstadoCotizador.conHistorial() =
        copy(puedeDeshacer = historial.puedeDeshacer(cotizacion), puedeRehacer = historial.puedeRehacer(cotizacion))

    /** Abre una cotización (desde Historial, Clientes o una opción del chat). */
    fun abrir(id: String, mostrar: Boolean = true) = viewModelScope.launch {
        if (q?.id == id) {
            recargar(forzar = true)
            if (mostrar) efectos.send(Efecto.MostrarCotizacion)
            return@launch
        }
        _estado.update { it.copy(enCurso = Operacion.CARGAR) }
        try {
            abrirPorId(id)
            if (mostrar) efectos.send(Efecto.MostrarCotizacion)
        } catch (e: FalloApi) {
            fallo(e, null)
        } finally {
            _estado.update { it.copy(enCurso = null) }
        }
    }

    private suspend fun abrirPorId(id: String) {
        val d = api.detalleCrudo(id)
        _estado.update { it.copy(seleccion = null, nota = null, avisosLocales = emptyList(), charla = emptyList(), configurado = d.valor.asistenteConfigurado) }
        idPendiente = null
        mostrarCruda(Crudo(d.valor.cotizacion, d.json["cotizacion"]!!.jsonObject), vaciarHistorial = true)
    }

    /** Relee la cotización abierta. Sin `forzar` no la toca durante una operación ni más de una vez cada 5 s. */
    fun recargar(forzar: Boolean = false) = viewModelScope.launch {
        val actual = q ?: return@launch
        if (!forzar && (_estado.value.ocupado || System.currentTimeMillis() - ultimaRecarga < 5000)) return@launch
        ultimaRecarga = System.currentTimeMillis()
        runCatching { api.detalleCrudo(actual.id) }.onSuccess { d ->
            val nueva = d.valor.cotizacion
            if (q?.id != nueva.id) return@onSuccess
            if (q?.actualizada != nueva.actualizada) historial = HistorialEdicion.vacio(nueva.id)
            mostrarCruda(Crudo(nueva, d.json["cotizacion"]!!.jsonObject), vaciarHistorial = false)
        }
    }

    /** «Nueva cotización»: limpia la pantalla; el borrador se crea con el primer pedido. */
    fun nueva() {
        if (_estado.value.ocupado) return
        historial = HistorialEdicion()
        solicitudesCrudas = JsonArray(emptyList())
        idPendiente = null
        _estado.update {
            it.copy(cotizacion = null, charla = emptyList(), seleccion = null, nota = null, avisosLocales = emptyList(), cambio = null, textoConservado = false)
                .conHistorial()
        }
        viewModelScope.launch { c.preferencias.guardarAbierta(null) }
        efectos.trySend(Efecto.MostrarPedido)
    }

    fun escribir(texto: String) {
        _mensaje.value = texto.take(cl.puertasneltume.cotizador.nucleo.reglas.Limites.LARGO_MENSAJE)
        if (_estado.value.textoConservado && texto.isEmpty()) _estado.update { it.copy(textoConservado = false) }
    }

    /** Un chip de opción del asistente agrega «campo valor» al mensaje, sin enviarlo. */
    fun responderOpcion(respuesta: String) {
        val m = _mensaje.value.trim()
        _mensaje.value = if (m.isNotEmpty()) "$m; $respuesta" else respuesta
        _estado.update { it.copy(textoConservado = false) }
    }

    // --- Respuestas y errores ---------------------------------------------------------------------------------

    /** Aplica un resultado: cotización nueva (puede ser otra: revisión o duplicado), avisos y cambios. */
    private fun recibir(crudo: Crudo<Resultado>, previa: Cotizacion? = q, anunciar: Boolean = false, sinHistorial: Boolean = false) {
        val d = crudo.valor
        val nueva = d.cotizacion
        if (d.efimera) {
            // Sin pedido todavía: se muestra el intercambio sin abrir un borrador vacío.
            _estado.update { it.copy(cotizacion = null, charla = (it.charla + nueva.historial.takeLast(2)).takeLast(12)) }
            if (d.avisos.isNotEmpty()) avisar(d.avisos.joinToString(" "))
            nueva.historial.lastOrNull()?.takeIf { anunciar && !it.esUsuario }?.let { efectos.trySend(Efecto.Anuncio(it.texto)) }
            return
        }
        val crudas = crudo.solicitudes ?: JsonArray(emptyList())
        val cambio = if (!d.eliminada) {
            val anteriores = if (previa?.id == nueva.id) solicitudesCrudas else JsonArray(emptyList())
            val indices = crudas.indices.filter { crudas[it] != anteriores.getOrNull(it) }.toSet()
            val cantidades = indices.mapNotNull { i ->
                val antes = previa?.solicitudes?.getOrNull(i)?.cantidad
                val despues = nueva.solicitudes.getOrNull(i)?.cantidad
                if (antes != null && despues != null && antes != despues) "Cantidad: $antes → $despues" else null
            }
            val total = previa != null && previa.montos.total != nueva.montos.total
            if (indices.isNotEmpty() || total) CambioVisual(
                nueva.id,
                indices,
                total,
                (cantidades + (if (total) "Total actualizado: ${pesos(nueva.montos.total)}" else "Pedido actualizado")).joinToString(" · "),
            ) else null
        } else null

        if (d.eliminada) {
            historial = HistorialEdicion()
            solicitudesCrudas = JsonArray(emptyList())
            _estado.update { it.copy(cotizacion = null, nota = null, avisosLocales = emptyList(), charla = emptyList()).conHistorial() }
            viewModelScope.launch { c.preferencias.guardarAbierta(null) }
        } else {
            val antes = previa?.let { instantaneaDe(it, if (it.id == nueva.id) solicitudesCrudas else JsonArray(emptyList())) }
            val despues = instantaneaDe(nueva, crudas)
            historial = when {
                previa == null || previa.id != nueva.id -> HistorialEdicion.vacio(nueva.id)
                sinHistorial || antes == despues -> historial.conVersion(nueva)
                else -> historial.registrar(antes!!, previa.id, previa.actualizada, nueva)
            }
            solicitudesCrudas = crudas
            _estado.update { it.copy(cotizacion = nueva, charla = emptyList(), cambio = cambio ?: it.cambio).conHistorial() }
            viewModelScope.launch { c.preferencias.guardarAbierta(nueva.id) }
            if (nueva.estado == EstadoCotizacion.APROBADA) efectos.trySend(Efecto.MostrarCotizacion)
        }
        if (d.avisos.isNotEmpty()) avisar(d.avisos.joinToString(" "), largo = true)
        val nuevos = if (anunciar || d.eliminada) emptyList() else d.avisos.filter { a -> nueva.historial.none { it.texto == a } }
        if (nuevos.isNotEmpty()) _estado.update { e ->
            e.copy(avisosLocales = (e.avisosLocales.filter { it !in nuevos } + nuevos).takeLast(3))
        }
        if (previa != null && !d.eliminada && previa.id != nueva.id && previa.estado == EstadoCotizacion.EMITIDA && nueva.origen == previa.numero)
            avisar("Se abrió la revisión de la N° ${previa.numero}; el PDF emitido se conserva.")
        val cambios = resumenCambios(d.cambios)
        _estado.update { it.copy(nota = if (cambios.isNotEmpty()) "$cambios." else null) }
        val ultimo = nueva.historial.lastOrNull()
        if (anunciar && ultimo != null && !ultimo.esUsuario)
            efectos.trySend(Efecto.Anuncio(if (cambios.isNotEmpty()) "${ultimo.texto} $cambios" else ultimo.texto))
        d.archivo?.let { archivo ->
            efectos.trySend(
                Efecto.Documento(
                    archivo,
                    if (d.archivos.size > 1) "Se generaron ${d.archivos.size} notas de pedido, una por fábrica: todas quedan en Documentos." else null,
                ),
            )
        }
    }

    /** Errores como los maneja la web (`fallo`): abre lo que corresponde, recarga en conflictos y avisa. */
    private suspend fun fallo(e: FalloApi, actual: Cotizacion? = q, pendiente: String? = null) {
        if (e is SesionVencida) return // La hoja de sesión vencida ya se mostró; lo escrito se conserva.
        val id = e.dato("id")
        when (e.codigo) {
            "mensaje_procesado" -> if (id != null) {
                idPendiente = null
                _mensaje.value = ""
                avisar(e.message ?: "")
                runCatching { abrirPorId(id) }
                return
            }
            "revision_abierta" -> if (id != null) {
                avisar("${e.message} Se abrió la revisión en curso.")
                runCatching { abrirPorId(id) }
                return
            }
            "ocupado" -> {
                avisar(e.message ?: "", if (actual != null) "Actualizar" else null) { recargar(forzar = true) }
                return
            }
        }
        if (e.codigo == "version_obsoleta")
            avisar("La cotización cambió mientras la tenías abierta. Se cargó la versión actual: revísala y vuelve a intentarlo.", largo = true)
        else avisar(e.message ?: "No se pudo completar la operación.", largo = true)
        if (e.status == 409 && actual != null) recargar(forzar = true)
    }

    /** Ejecuta una acción sobre la cotización abierta con su versión, y aplica el resultado. */
    private suspend fun ejecutar(op: Operacion, cuerpo: JsonObject, previa: Cotizacion? = q, campo: String? = null): Boolean {
        _estado.update { it.copy(enCurso = op, guardando = campo) }
        return try {
            recibir(api.accionCruda(cuerpo), previa)
            true
        } catch (e: FalloApi) {
            fallo(e, previa)
            false
        } finally {
            _estado.update { it.copy(enCurso = null, guardando = null) }
        }
    }

    private fun lanzar(bloque: suspend () -> Unit) {
        if (_estado.value.ocupado) return
        viewModelScope.launch { bloque() }
    }

    // --- Chat -------------------------------------------------------------------------------------------------

    fun enviar() {
        val texto = _mensaje.value
        val e = _estado.value
        val actual = e.cotizacion
        val bloqueada = actual != null && !esEditable(actual) && actual.estado != EstadoCotizacion.APROBADA
        if (texto.isBlank() || e.ocupado || bloqueada || !e.configurado || e.seleccion != null) return
        if (actual == null && idPendiente == null) idPendiente = idNuevo()
        val nuevoId = if (actual == null) idPendiente else null
        _estado.update { it.copy(enCurso = Operacion.CHAT, nota = null, avisosLocales = emptyList(), inicioEspera = System.currentTimeMillis()) }
        tareaChat = viewModelScope.launch {
            try {
                val crudo = api.accionCruda(
                    Acciones.chat(
                        mensaje = texto,
                        id = actual?.id,
                        actualizada = actual?.actualizada,
                        nuevoId = nuevoId,
                        razonamiento = _estado.value.razonamiento?.nivel,
                        contexto = _estado.value.charla,
                    ),
                    larga = true,
                )
                val d = crudo.valor
                idPendiente = null
                d.diagnostico?.let { diag ->
                    c.preferencias.guardarDiagnostico(
                        buildJsonObject {
                            put("modelo", diag.modelo)
                            put("respaldo", diag.respaldo)
                            put("ms", diag.ms)
                            put("fecha", Fechas.ahora().toString())
                        }.toString(),
                    )
                }
                _mensaje.value = ""
                _estado.update { it.copy(textoConservado = false) }
                if (d.seleccion.isNotEmpty()) {
                    _estado.update { it.copy(seleccion = Seleccion(texto, actual?.id, d.seleccion)) }
                    efectos.send(Efecto.Anuncio("Encontré varias cotizaciones que podrían ser. Elige cuál quieres modificar."))
                    cargarTotales()
                    return@launch
                }
                _estado.update { it.copy(seleccion = null) }
                responder(crudo, actual)
            } catch (x: FalloApi) {
                if (x.codigo != "red") idPendiente = null
                if (x.codigo == "red") avisar(x.message ?: "", "Reintentar", largo = true) { enviar() }
                else fallo(x, actual, nuevoId)
            } finally {
                tareaChat = null
                _estado.update { it.copy(enCurso = null, inicioEspera = null) }
            }
        }
    }

    /** Corta la espera del asistente. El servidor pudo alcanzar a procesarlo: se ofrece actualizar. */
    fun cancelar() {
        val tarea = tareaChat ?: return
        tarea.cancel()
        val actual = q
        val pendiente = idPendiente
        avisar("Se canceló la espera; si el asistente alcanzó a responder, verás el cambio al actualizar.", "Actualizar", largo = true) {
            if (actual != null) recargar(forzar = true)
            else if (pendiente != null) viewModelScope.launch {
                try {
                    abrirPorId(pendiente)
                    _mensaje.value = ""
                } catch (e: FalloApi) {
                    if (e.status == 404) avisar("El mensaje no alcanzó a crear una cotización. Puedes reenviarlo.")
                    else fallo(e, null)
                }
            }
        }
    }

    private suspend fun cargarTotales() {
        val s = _estado.value.seleccion ?: return
        for (o in s.opciones) runCatching { api.detalle(o.id) }.onSuccess { d ->
            _estado.update { e -> e.copy(seleccion = e.seleccion?.let { it.copy(totales = it.totales + (o.id to d.cotizacion.montos.total)) }) }
        }
    }

    private suspend fun responder(crudo: Crudo<Resultado>, previa: Cotizacion?) {
        recibir(crudo, previa, anunciar = true)
        val d = crudo.valor
        d.confirmar?.let { aprobarDesdeChat(it, d.cotizacion, d.efimera) }
        d.confirmarNumero?.let { cambiarNumeroDesdeChat(it, d.cotizacion) }
    }

    fun elegirReferencia(opcion: OpcionCotizacion) {
        val pendiente = _estado.value.seleccion ?: return
        if (_estado.value.ocupado) return
        val previa = q
        _estado.update { it.copy(enCurso = Operacion.CHAT, seleccion = null, inicioEspera = System.currentTimeMillis()) }
        tareaChat = viewModelScope.launch {
            try {
                val conContexto = pendiente.contextoId != null && previa?.id == pendiente.contextoId
                val crudo = api.accionCruda(
                    Acciones.chat(
                        mensaje = pendiente.mensaje,
                        id = if (conContexto) previa?.id else null,
                        actualizada = if (conContexto) previa?.actualizada else null,
                        objetivoId = opcion.id,
                        objetivoActualizada = opcion.actualizada,
                        razonamiento = _estado.value.razonamiento?.nivel,
                    ),
                    larga = true,
                )
                if (crudo.valor.seleccion.isNotEmpty()) {
                    _estado.update { it.copy(seleccion = pendiente.copy(opciones = crudo.valor.seleccion)) }
                    return@launch
                }
                responder(crudo, previa)
            } catch (e: FalloApi) {
                _estado.update { it.copy(seleccion = pendiente) }
                _mensaje.value = pendiente.mensaje
                fallo(e, previa)
            } finally {
                tareaChat = null
                _estado.update { it.copy(enCurso = null, inicioEspera = null) }
            }
        }
    }

    /** «Ninguna de estas»: el pedido se trata como una cotización nueva y el texto vuelve al mensaje. */
    fun descartarSeleccion() {
        val s = _estado.value.seleccion ?: return
        if (_estado.value.ocupado) return
        _mensaje.value = s.mensaje
        historial = HistorialEdicion()
        _estado.update { it.copy(seleccion = null, cotizacion = null, nota = null, avisosLocales = emptyList(), charla = emptyList()).conHistorial() }
    }

    private suspend fun aprobarDesdeChat(cf: ConfirmarAprobacion, conversacion: Cotizacion, efimera: Boolean) {
        if (cf.id != conversacion.id) avisar("Abriendo cotización N° ${cf.numero}.")
        val ok = aprobarCon(
            cf.id,
            cf.numero,
            cf.actualizada,
            cf.vence,
            cf.vencida,
            if (cf.id == conversacion.id) conversacion else null,
        )
        if (!ok) {
            if (efimera) _estado.update { it.copy(charla = it.charla + Mensaje("asistente", "Aprobación cancelada.")) }
            else _estado.update { it.copy(nota = "Aprobación cancelada.") }
            efectos.send(Efecto.Anuncio("Aprobación cancelada."))
        }
    }

    private suspend fun cambiarNumeroDesdeChat(cn: ConfirmarNumero, conversacion: Cotizacion) {
        val documento = if (cn.documento == "cotizacion") "la cotización N° ${cn.actual}"
        else "la nota de pedido N° ${cn.actual}${cn.fabrica?.let { " de ${nombreFabrica[it]}" } ?: ""}"
        val nuevo = cl.puertasneltume.cotizador.nucleo.reglas.NumerosCL.agruparMiles(cn.numero.toString())
        val ok = confirmar(
            "¿Cambiar el número de $documento?",
            "Pasa a ser la N° $nuevo. Su PDF se vuelve a generar con el número nuevo y el cambio queda en la actividad.",
            "Cambiar a N° $nuevo",
        )
        if (!ok) {
            _estado.update { it.copy(nota = "Cambio de número cancelado.") }
            return
        }
        ejecutar(Operacion.FLUJO, Acciones.cambiarNumero(cn.id, cn.actualizada, cn.documento, cn.numero, cn.fabrica), conversacion)
    }

    // --- Diálogos ---------------------------------------------------------------------------------------------

    private suspend fun confirmar(titulo: String, mensaje: String, aceptar: String, detalles: List<String> = emptyList(), peligro: Boolean = false): Boolean {
        val d = Dialogo.Confirmacion(titulo, mensaje, aceptar, detalles, peligro)
        _estado.update { it.copy(dialogo = d) }
        return try {
            d.respuesta.await()
        } finally {
            _estado.update { if (it.dialogo === d) it.copy(dialogo = null) else it }
        }
    }

    private suspend fun <T> pedir(d: Dialogo, respuesta: CompletableDeferred<T>): T {
        _estado.update { it.copy(dialogo = d) }
        return try {
            respuesta.await()
        } finally {
            _estado.update { if (it.dialogo === d) it.copy(dialogo = null) else it }
        }
    }

    /** La pantalla cierra un diálogo de confirmación. */
    fun responderConfirmacion(d: Dialogo.Confirmacion, ok: Boolean) = d.respuesta.complete(ok)

    // --- Ediciones --------------------------------------------------------------------------------------------

    /**
     * Guarda un cambio del panel. Con la nota de pedido generada, el cambio corrige el pedido (`editar_pedido`), con
     * solo los datos que la pantalla deja editar en ese estado.
     */
    fun editar(campo: String, cambios: Cambios.() -> Unit, alTerminar: (Boolean) -> Unit = {}) {
        val actual = q ?: return
        if (_estado.value.ocupado) return
        viewModelScope.launch {
            val cuerpo = Acciones.editar(actual.id, actual.actualizada, cambios)
            val final = if (pedidoGenerado(actual)) aPedido(cuerpo, actual) else cuerpo
            alTerminar(ejecutar(Operacion.EDITAR, final, actual, campo))
        }
    }

    /** Convierte un `editar` en `editar_pedido` (cantidades como cambios de ítem). */
    private fun aPedido(cuerpo: JsonObject, actual: Cotizacion): JsonObject {
        val items = mutableListOf<Pair<Int, JsonObject>>()
        (cuerpo["cantidades"] as? JsonArray)?.forEach { el ->
            val o = el.jsonObject
            items += (o["indice"] as JsonPrimitive).content.toInt() to buildJsonObject { put("cantidad", o["cantidad"]!!) }
        }
        (cuerpo["items"] as? JsonArray)?.forEach { el ->
            val o = el.jsonObject
            items += (o["indice"] as JsonPrimitive).content.toInt() to o["cambios"]!!.jsonObject
        }
        return Acciones.editarPedido(actual.id, actual.actualizada, items)
    }

    /** Responde una pregunta pendiente con una edición directa (no pasa por la IA). */
    fun responderPregunta(p: PreguntaPendiente, valor: Any) = editar("pendiente.${p.clave}", { respuesta(p, valor) })

    fun quitar(indice: Int, conAviso: Boolean = true) = lanzar {
        val actual = q ?: return@lanzar
        if (ejecutar(Operacion.EDITAR, Acciones.quitar(actual.id, actual.actualizada, indice), actual) && conAviso)
            avisar("Ítem quitado.", "Deshacer") { deshacer() }
    }

    fun reordenar(desde: Int, hasta: Int) = lanzar {
        val actual = q ?: return@lanzar
        ejecutar(Operacion.EDITAR, Acciones.reordenar(actual.id, actual.actualizada, desde, hasta), actual)
    }

    fun duplicarLinea(indice: Int) = lanzar {
        val actual = q ?: return@lanzar
        ejecutar(Operacion.EDITAR, Acciones.duplicarItem(actual.id, actual.actualizada, indice), actual)
    }

    fun deshacer() = aplicarHistorial(true)
    fun rehacer() = aplicarHistorial(false)

    private fun aplicarHistorial(deshacer: Boolean) = lanzar {
        val actual = q ?: return@lanzar
        val h = historial
        if (h.id != actual.id || h.version != actual.actualizada) return@lanzar
        val objetivo: Instantanea = (if (deshacer) h.deshacer else h.rehacer).lastOrNull() ?: return@lanzar
        val guardado = instantaneaDe(actual, solicitudesCrudas)
        val cambiaGeneral = objetivo.general != guardado.general
        val cambianItems = objetivo.solicitudes != guardado.solicitudes
        _estado.update { it.copy(enCurso = Operacion.EDITAR) }
        var vigente = actual
        try {
            if (cambiaGeneral) {
                val d = api.accionCruda(cuerpoRestaurarGeneral(vigente.id, vigente.actualizada, objetivo.general))
                recibir(d, vigente, sinHistorial = true)
                vigente = d.valor.cotizacion
            }
            if (cambianItems || !cambiaGeneral) {
                val d = api.accionCruda(Acciones.restaurarItems(vigente.id, vigente.actualizada, objetivo.solicitudes))
                recibir(d, vigente, sinHistorial = true)
            }
            historial = historial.aplicado(deshacer, guardado, historial.version)
            _estado.update { it.conHistorial() }
        } catch (e: FalloApi) {
            fallo(e, vigente)
        } finally {
            _estado.update { it.copy(enCurso = null) }
        }
    }

    // --- Productos --------------------------------------------------------------------------------------------

    /**
     * Agrega un producto del catálogo. El primero lleva un id propuesto: un reintento no abre dos borradores. Lanza el
     * error para que el diálogo lo muestre y conserve lo elegido.
     */
    suspend fun agregarProducto(codigo: String, cantidad: Int, ancho: Double?, alto: Double?, tipoMedida: TipoMedida?, seguir: Boolean) =
        agregarItem(seguir) { id, actualizada, nuevoId ->
            Acciones.agregarProducto(codigo, cantidad, ancho, alto, tipoMedida, id, actualizada, nuevoId)
        }

    suspend fun agregarPersonalizado(
        nombre: String,
        familia: String,
        madera: String,
        descripcion: String?,
        ancho: Double?,
        alto: Double?,
        tipoMedida: TipoMedida,
        cantidad: Int,
        precioUnitario: Long,
        observaciones: String?,
        referencias: List<ReferenciaItem>,
    ) = agregarItem(false) { id, actualizada, nuevoId ->
        Acciones.agregarPersonalizado(nombre, familia, madera, descripcion, ancho, alto, tipoMedida, cantidad, precioUnitario, observaciones, referencias, id, actualizada, nuevoId)
    }

    private suspend fun agregarItem(seguir: Boolean, cuerpo: (String?, String?, String?) -> JsonObject) {
        if (_estado.value.ocupado) throw FalloApi("Espera a que termine la operación en curso.", 0, "ocupado")
        val actual = q
        if (actual == null && primerProducto == null) primerProducto = idNuevo()
        _estado.update { it.copy(enCurso = Operacion.EDITAR) }
        try {
            val d = api.accionCruda(cuerpo(actual?.id, actual?.actualizada, if (actual == null) primerProducto else null))
            primerProducto = null
            recibir(d, actual)
            if (!seguir) {
                efectos.send(Efecto.MostrarCotizacion)
                avisar("Producto agregado al pedido.")
            }
            efectos.send(Efecto.IrAlFinal(d.valor.cotizacion.solicitudes.lastIndex))
        } catch (e: FalloApi) {
            fallo(e, actual)
            throw e
        } finally {
            _estado.update { it.copy(enCurso = null) }
        }
    }

    // --- Ciclo de la cotización -------------------------------------------------------------------------------

    fun emitir(admin: Boolean) = lanzar {
        val actual = q ?: return@lanzar
        val d = Dialogo.Emision(actual, admin)
        val numero: Int? = pedir(d, d.respuesta).also { if (it == CANCELADO) return@lanzar }
        _estado.update { it.copy(enCurso = Operacion.EMITIR) }
        try {
            try {
                recibir(api.accionCruda(Acciones.emitir(actual.id, actual.actualizada, numero?.takeIf { it > 0 })), actual)
            } catch (e: FalloApi) {
                if (e.codigo != "precios_cambiaron") throw e
                // El catálogo cambió: el servidor ya guardó los montos nuevos en el borrador y no emitió.
                val vigente = api.detalleCrudo(actual.id).let { Crudo(it.valor.cotizacion, it.json["cotizacion"]!!.jsonObject) }
                mostrarCruda(vigente, vaciarHistorial = true)
                val avisos = (e.detalle?.get("avisos") as? JsonArray)?.map { (it as JsonPrimitive).content }.orEmpty()
                val ok = confirmar(
                    "Los precios cambiaron",
                    "${e.message}\n\nNuevo total: ${pesos(vigente.valor.montos.total)} (IVA incluido).",
                    "Emitir con los montos actualizados",
                    avisos,
                )
                if (!ok) return@lanzar
                val v = vigente.valor
                recibir(api.accionCruda(Acciones.emitir(v.id, v.actualizada, numero?.takeIf { it > 0 })), v)
            }
        } catch (e: FalloApi) {
            fallo(e, actual)
        } finally {
            _estado.update { it.copy(enCurso = null) }
        }
    }

    fun aprobar() = lanzar {
        val actual = q ?: return@lanzar
        aprobarCon(actual.id, actual.numero, actual.actualizada, actual.vence, vencida(actual), actual)
    }

    /** Aprobar con despacho y facturación; si el servidor dice que venció, se confirma y se reintenta. */
    private suspend fun aprobarCon(id: String, numero: Int?, actualizada: String, vence: String?, venc: Boolean, conversacion: Cotizacion?): Boolean {
        val d = Dialogo.Aprobacion(conversacion, numero, vence, venc)
        val datos = pedir(d, d.respuesta) ?: return false
        _estado.update { it.copy(enCurso = Operacion.APROBAR) }
        try {
            try {
                recibir(api.accionCruda(Acciones.aprobar(id, actualizada, venc, datos.despacho, datos.facturacion)))
            } catch (e: FalloApi) {
                if (e.codigo != "cotizacion_vencida") throw e
                val v = e.dato("vence")
                val ok = confirmar(
                    "La cotización está vencida",
                    "${e.message}${if (v != null) " Venció el ${Fechas.corta(v)}." else ""} ¿Aprobarla de todos modos con los valores emitidos?",
                    "Aprobar de todos modos",
                )
                if (!ok) return false
                recibir(api.accionCruda(Acciones.aprobar(id, actualizada, true, datos.despacho, datos.facturacion)))
            }
            return true
        } catch (e: FalloApi) {
            fallo(e)
            return false
        } finally {
            _estado.update { it.copy(enCurso = null) }
        }
    }

    fun duplicar(id: String = q?.id ?: "", numero: Int? = q?.numero) = lanzar {
        if (id.isEmpty()) return@lanzar
        if (duplicadoPendiente?.first != id) duplicadoPendiente = id to idNuevo()
        _estado.update { it.copy(enCurso = Operacion.DUPLICAR) }
        try {
            val d = api.accionCruda(Acciones.duplicar(id, duplicadoPendiente!!.second))
            duplicadoPendiente = null
            recibir(d, null)
            _estado.update { it.copy(seleccion = null) }
            efectos.send(Efecto.MostrarCotizacion)
            avisar("Se creó un borrador nuevo a partir de ${if (numero != null) "la N° $numero" else "la cotización"}.")
        } catch (e: FalloApi) {
            fallo(e, null)
        } finally {
            _estado.update { it.copy(enCurso = null) }
        }
    }

    fun eliminar() = lanzar {
        val actual = q ?: return@lanzar
        val ok = confirmar(
            "Eliminar borrador",
            "¿Eliminar este borrador${actual.cliente.nombre?.let { " de $it" } ?: ""}? Sale del historial con su conversación y sus ítems, y pasa a la papelera: puedes deshacerlo desde el aviso o restaurarlo en Historial → Papelera.",
            "Eliminar borrador",
            peligro = true,
        )
        if (ok && ejecutar(Operacion.ELIMINAR, Acciones.simple("eliminar", actual.id, actual.actualizada), actual))
            avisar("Borrador eliminado: quedó en la papelera.", "Deshacer") { restaurarBorrador(actual.id, actual.actualizada) }
    }

    fun restaurarBorrador(id: String, actualizada: String) = lanzar {
        if (ejecutar(Operacion.ELIMINAR, Acciones.simple("restaurar_borrador", id, actualizada), null)) {
            _estado.update { it.copy(seleccion = null) }
            efectos.send(Efecto.MostrarCotizacion)
            avisar("Borrador restaurado.")
        }
    }

    fun anular() = lanzar {
        val actual = q ?: return@lanzar
        when (val r = puedeAnular(actual)) {
            is Anulable.No -> avisar(r.motivo, largo = true)
            is Anulable.Si -> {
                val d = Dialogo.Anulacion(actual, r.pagado)
                val motivo = pedir(d, d.respuesta) ?: return@lanzar
                if (ejecutar(Operacion.FLUJO, Acciones.anular(actual.id, actual.actualizada, motivo.takeIf { it != SIN_MOTIVO }), actual))
                    avisar("Cotización ${numeroCotizacion(actual.numero)} anulada.")
            }
        }
    }

    /** Acciones del seguimiento (pago, nota, producción, despacho, facturación…) con la versión vigente. */
    fun flujo(cuerpo: (Cotizacion) -> JsonObject, exito: String? = null, alTerminar: (Boolean) -> Unit = {}) = lanzar {
        val actual = q ?: return@lanzar
        val ok = ejecutar(Operacion.FLUJO, cuerpo(actual), actual)
        if (ok && exito != null) avisar(exito)
        alTerminar(ok)
    }

    /** Confirmación genérica desde la pantalla (anular pago, generar nota, pasos de la operación). */
    fun confirmarYFlujo(titulo: String, mensaje: String, aceptar: String, peligro: Boolean = false, exito: String? = null, cuerpo: (Cotizacion) -> JsonObject) = lanzar {
        if (!confirmar(titulo, mensaje, aceptar, peligro = peligro)) return@lanzar
        val actual = q ?: return@lanzar
        if (ejecutar(Operacion.FLUJO, cuerpo(actual), actual) && exito != null) avisar(exito)
    }

    /** Regenera un PDF que ya no está en el servidor (solo administración). */
    fun regenerarPdf(documento: String, fabrica: Fabrica?) = lanzar {
        val actual = q ?: return@lanzar
        val ok = confirmar(
            "Regenerar PDF",
            "El archivo ya no está en el servidor. Se vuelve a generar con los mismos datos con que se emitió y queda «PDF regenerado» en la actividad.",
            "Regenerar PDF",
        )
        if (ok) ejecutar(Operacion.FLUJO, Acciones.regenerarPdf(actual.id, actual.actualizada, documento, fabrica), actual)
    }

    override fun onCleared() {
        tareaChat?.cancel()
    }

    companion object {
        /** Diálogo de emisión cerrado sin emitir (distinto de «sin número manual», que es null). */
        const val CANCELADO = -1
        /** Anulación confirmada sin motivo escrito. */
        const val SIN_MOTIVO = "\u0000"
    }
}
