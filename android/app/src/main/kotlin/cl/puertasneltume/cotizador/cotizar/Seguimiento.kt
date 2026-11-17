package cl.puertasneltume.cotizador.cotizar

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import cl.puertasneltume.cotizador.comun.LocalAvisos
import cl.puertasneltume.cotizador.comun.LocalContenedor
import cl.puertasneltume.cotizador.comun.copiar
import cl.puertasneltume.cotizador.diseno.Aviso
import cl.puertasneltume.cotizador.diseno.Bandeja
import cl.puertasneltume.cotizador.diseno.BotonPrincipal
import cl.puertasneltume.cotizador.diseno.BotonSecundario
import cl.puertasneltume.cotizador.diseno.BotonTexto
import cl.puertasneltume.cotizador.diseno.Campo
import cl.puertasneltume.cotizador.diseno.CampoPesos
import cl.puertasneltume.cotizador.diseno.ChipFiltro
import cl.puertasneltume.cotizador.diseno.Divisor
import cl.puertasneltume.cotizador.diseno.Hoja
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.LineaPasos
import cl.puertasneltume.cotizador.diseno.Movimiento
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Pildora
import cl.puertasneltume.cotizador.diseno.Radios
import cl.puertasneltume.cotizador.diseno.Rotulo
import cl.puertasneltume.cotizador.diseno.TituloSeccion
import cl.puertasneltume.cotizador.diseno.TonoAviso
import cl.puertasneltume.cotizador.nucleo.api.Acciones
import cl.puertasneltume.cotizador.nucleo.api.texto
import cl.puertasneltume.cotizador.nucleo.modelo.Cotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.EstadoComercial
import cl.puertasneltume.cotizador.nucleo.modelo.EstadoCotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.EstadoOperativo
import cl.puertasneltume.cotizador.nucleo.modelo.Fabrica
import cl.puertasneltume.cotizador.nucleo.modelo.NotaPedido
import cl.puertasneltume.cotizador.nucleo.modelo.ReceptorFacturacion
import cl.puertasneltume.cotizador.nucleo.modelo.TipoDocumento
import cl.puertasneltume.cotizador.nucleo.reglas.EtapaProduccion
import cl.puertasneltume.cotizador.nucleo.reglas.FABRICAS
import cl.puertasneltume.cotizador.nucleo.reglas.Fechas
import cl.puertasneltume.cotizador.nucleo.reglas.Limites
import cl.puertasneltume.cotizador.nucleo.reglas.PASOS
import cl.puertasneltume.cotizador.nucleo.reglas.aPesos
import cl.puertasneltume.cotizador.nucleo.reglas.anticipoMinimo
import cl.puertasneltume.cotizador.nucleo.reglas.avancePedido
import cl.puertasneltume.cotizador.nucleo.reglas.correoValido
import cl.puertasneltume.cotizador.nucleo.reglas.descripcionLinea
import cl.puertasneltume.cotizador.nucleo.reglas.esLibre
import cl.puertasneltume.cotizador.nucleo.reglas.etapaProduccion
import cl.puertasneltume.cotizador.nucleo.reglas.etiquetaComercial
import cl.puertasneltume.cotizador.nucleo.reglas.etiquetaDocumentoFacturacion
import cl.puertasneltume.cotizador.nucleo.reglas.etiquetaFacturacion
import cl.puertasneltume.cotizador.nucleo.reglas.etiquetaOperativo
import cl.puertasneltume.cotizador.nucleo.reglas.fabricaDeNota
import cl.puertasneltume.cotizador.nucleo.reglas.faltanDatosFactura
import cl.puertasneltume.cotizador.nucleo.reglas.leerPesos
import cl.puertasneltume.cotizador.nucleo.reglas.nombreFabrica
import cl.puertasneltume.cotizador.nucleo.reglas.nombreProducto
import cl.puertasneltume.cotizador.nucleo.reglas.normalizarRut
import cl.puertasneltume.cotizador.nucleo.reglas.numeroCotizacion
import cl.puertasneltume.cotizador.nucleo.reglas.numeroNota
import cl.puertasneltume.cotizador.nucleo.reglas.operacionDe
import cl.puertasneltume.cotizador.nucleo.reglas.ordenarNotas
import cl.puertasneltume.cotizador.nucleo.reglas.pagoAnulable
import cl.puertasneltume.cotizador.nucleo.reglas.pesos
import cl.puertasneltume.cotizador.nucleo.reglas.plural
import cl.puertasneltume.cotizador.nucleo.reglas.porcentaje
import cl.puertasneltume.cotizador.nucleo.reglas.rangoFechaOperacion
import cl.puertasneltume.cotizador.nucleo.reglas.receptorDesdeCliente
import cl.puertasneltume.cotizador.nucleo.reglas.receptorTieneContenido
import cl.puertasneltume.cotizador.nucleo.reglas.retrocesoOperativo
import cl.puertasneltume.cotizador.nucleo.reglas.sinTransportista
import cl.puertasneltume.cotizador.nucleo.reglas.textoCopiarFactura
import cl.puertasneltume.cotizador.nucleo.reglas.totalPagado
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import kotlin.math.roundToInt

private data class Siguiente(val titulo: String, val detalle: String, val etiqueta: String?, val accion: (() -> Unit)?)

/**
 * Seguimiento del pedido (seguimiento-operacion.tsx): los ocho pasos, el pago recibido, la «Siguiente acción», las
 * notas por fábrica, los pagos, la facturación y las notas internas. En una emitida: esperar la aprobación.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SeccionSeguimiento(vm: CotizadorViewModel, q: Cotizacion, ocupado: Boolean) {
    val c = Neltume.colores
    val api = LocalContenedor.current.api
    val aprobada = q.estado == EstadoCotizacion.APROBADA
    val notas = ordenarNotas(q.notas)
    val vigentes = notas.filter { !it.anulada }
    val varias = vigentes.size > 1
    val pagado = totalPagado(q)
    val total = q.montos.total
    val saldo = (total - pagado).coerceAtLeast(0)
    val porcentajePagado = if (total > 0) pagado * 100.0 / total else 0.0
    val minimo = anticipoMinimo(total)
    val operacion = operacionDe(q)
    val comercial = q.estadoComercial ?: if (q.estado == EstadoCotizacion.EMITIDA) EstadoComercial.ENVIADA else EstadoComercial.PENDIENTE
    var reparto by remember { mutableStateOf<Boolean?>(null) }
    var retroceder by remember { mutableStateOf(false) }
    var envios by remember(q.id) { mutableStateOf<List<JsonObject>>(emptyList()) }
    LaunchedEffect(q.id, q.notas.size) {
        if (q.notas.isNotEmpty()) envios = runCatching {
            (api.obtenerJson("api/integracion/envios", mapOf("cotizacion" to q.id))["envios"] as? JsonArray)?.map { it as JsonObject }
        }.getOrNull().orEmpty()
    }

    fun operar(paso: String, titulo: String, efecto: String, aceptar: String, nota: NotaPedido? = null) =
        vm.confirmarYFlujo(titulo, efecto, aceptar) { Acciones.operacion(it.id, it.actualizada, paso, if (varias) nota?.fabrica else null) }

    fun pasoProduccion(nota: NotaPedido): Pair<String, () -> Unit>? {
        val fabrica = fabricaDeNota(nota)
        val en = if (varias) " en $fabrica" else ""
        return when (etapaProduccion(nota)) {
            EtapaProduccion.PENDIENTE -> "Iniciar producción$en" to {
                operar(
                    "iniciar_produccion",
                    "¿Iniciar producción$en?",
                    if (varias) "La nota de pedido ${numeroNota(nota.numero, nota.fabrica)} pasa a «En producción»: queda registrado que el pedido entró a la fábrica de $fabrica."
                    else "La operación pasa a «En producción»: queda registrado que el pedido entró a fábrica.",
                    "Iniciar producción$en",
                    nota,
                )
            }
            EtapaProduccion.EN_PRODUCCION -> {
                val ultima = vigentes.all { it === nota || etapaProduccion(it) == EtapaProduccion.TERMINADA }
                "Marcar producción terminada$en" to {
                    operar(
                        "produccion_terminada",
                        "¿Producción terminada$en?",
                        when {
                            !ultima -> "Queda registrado que $fabrica terminó su parte. El pedido pasa a despacho cuando terminen todas las fábricas."
                            pagado < total -> "Queda registrado que fábrica terminó el pedido; faltan ${pesos(saldo)} para poder despacharlo."
                            else -> "Queda registrado que fábrica terminó el pedido; ya está pagado y puede prepararse el despacho."
                        },
                        "Marcar producción terminada$en",
                        nota,
                    )
                }
            }
            EtapaProduccion.TERMINADA -> null
        }
    }

    val lineasReparto = q.montos.lineas.filter { it.indice != null && !esLibre(q.solicitudes.getOrNull(it.indice!!)) }
    val todasAsignadas = lineasReparto.all { q.solicitudes.getOrNull(it.indice!!)?.fabrica != null }
    val asignadas = lineasReparto.mapNotNull { q.solicitudes.getOrNull(it.indice!!)?.fabrica }.toSet()
    val textoGenerar = if (todasAsignadas && asignadas.size == 1) "Generar nota de pedido" else "Generar notas de pedido"
    val pedirVista = remember { androidx.compose.foundation.relocation.BringIntoViewRequester() }
    val foco = remember { androidx.compose.ui.focus.FocusRequester() }
    val alcance = rememberCoroutineScope()
    val irAPago: () -> Unit = {
        alcance.launch {
            pedirVista.bringIntoView()
            runCatching { foco.requestFocus() }
        }
    }
    val siguiente: Siguiente? = when {
        !aprobada -> null
        vigentes.isEmpty() -> if (pagado < minimo)
            Siguiente("Registrar anticipo", "La nota de pedido se habilita al registrar ${pesos(minimo)} (${Limites.ANTICIPO_TEXTO}).", "Ir a pagos", irAPago)
        else Siguiente(
            textoGenerar,
            if (todasAsignadas) "El anticipo está registrado. Prepara el documento de cada fábrica con sus ítems."
            else "El anticipo está registrado. Elige la fábrica de cada ítem y prepara el documento de cada una.",
            textoGenerar,
        ) { reparto = true }
        pagado < minimo -> Siguiente("Completar anticipo", "La producción requiere al menos ${pesos(minimo)} pagado.", "Ir a pagos", irAPago)
        else -> when (operacion) {
            EstadoOperativo.PEDIDO_GENERADO, EstadoOperativo.EN_PRODUCCION -> {
                val nota = vigentes.firstOrNull { etapaProduccion(it) == EtapaProduccion.PENDIENTE }
                    ?: vigentes.firstOrNull { etapaProduccion(it) == EtapaProduccion.EN_PRODUCCION }
                val paso = nota?.let { pasoProduccion(it) }
                if (nota == null || paso == null) Siguiente("Revisar la producción", "Revisa el avance de cada nota de pedido.", null, null)
                else {
                    val iniciar = etapaProduccion(nota) == EtapaProduccion.PENDIENTE
                    val otra = if (varias) vigentes.firstOrNull { it !== nota && etapaProduccion(it) == EtapaProduccion.EN_PRODUCCION } else null
                    Siguiente(
                        if (iniciar) paso.first else "Cerrar producción${if (varias) " en ${fabricaDeNota(nota)}" else ""}",
                        if (iniciar) "${otra?.let { "${fabricaDeNota(it)} ya está fabricando su nota (N° ${it.numero}). " } ?: ""}La nota de pedido ${numeroNota(nota.numero, nota.fabrica)} ya está generada. Registra el inicio cuando pase a fábrica."
                        else "Confirma que ${if (varias) fabricaDeNota(nota) else "fábrica"} terminó ${if (varias) "su parte" else "el pedido"}.",
                        paso.first,
                        paso.second,
                    )
                }
            }
            EstadoOperativo.SALDO_PENDIENTE -> Siguiente("Registrar saldo", "Faltan ${pesos(saldo)} para continuar con el despacho.", "Ir a pagos", irAPago)
            EstadoOperativo.PAGADA -> if (pagado >= total) Siguiente("Preparar despacho", "El pedido está pagado. Indica que está listo para despacho.", "Marcar lista para despacho") {
                operar("lista_despacho", "¿Lista para despacho?", "El pedido queda «Lista para despacho» y desde ahí sus pagos ya no se pueden anular.", "Marcar lista para despacho")
            } else Siguiente("Registrar saldo", "Faltan ${pesos(saldo)} para continuar con el despacho.", "Ir a pagos", irAPago)
            EstadoOperativo.LISTA_DESPACHO -> if (sinTransportista(q.despacho?.transporte))
                Siguiente("Indicar transportista", "Completa el transportista en Despacho antes de registrar la salida.", null, null)
            else Siguiente("Registrar despacho", "El pedido está listo y tiene transportista asignado.", "Registrar despacho") {
                operar("despachada", "¿Registrar el despacho?", "Queda registrada la salida con ${q.despacho?.transporte}; los datos de despacho ya no se podrán editar.", "Registrar despacho")
            }
            EstadoOperativo.DESPACHADA -> Siguiente("Completar operación", "Confirma el cierre del pedido despachado.", "Completar operación") {
                operar("completada", "¿Completar la operación?", "La operación queda «Completada»; solo faltará registrar la facturación si aún no está.", "Completar operación")
            }
            EstadoOperativo.COMPLETADA -> if (q.facturacion?.facturada == true)
                Siguiente("Operación completada", "El pedido y su facturación están registrados.", null, null)
            else Siguiente("Registrar facturación", "El pedido está completo; falta registrar la factura o boleta.", null, null)
            else -> Siguiente("Revisar el siguiente paso", "Revisa pagos, producción y despacho para continuar.", null, null)
        }
    }
    val previo = retrocesoOperativo(q)
    val produciendo = aprobada && pagado >= minimo && (operacion == EstadoOperativo.PEDIDO_GENERADO || operacion == EstadoOperativo.EN_PRODUCCION)

    Hoja {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (aprobada) "Seguimiento del pedido" else "Esperando la aprobación del cliente",
                style = MaterialTheme.typography.headlineSmall,
                color = c.tinta,
                modifier = Modifier.weight(1f),
            )
            if (aprobada || pagado > 0) Pildora("${porcentaje(porcentajePagado)} pagado", c.tonal, c.tintaSuave)
        }
        Spacer(Modifier.height(14.dp))
        val avance = avancePedido(q)
        LineaPasos(avance.hechos, avance.actual)
        Spacer(Modifier.height(6.dp))
        Text(
            if (avance.actual >= PASOS.size) "Pedido completo" else "Paso ${avance.actual + 1} de ${PASOS.size}: ${PASOS[avance.actual]}",
            style = MaterialTheme.typography.bodyMedium,
            color = c.tinta,
        )
        if (aprobada) {
            Spacer(Modifier.height(14.dp))
            Bandeja {
                Rotulo("Pago recibido")
                Text("${pesos(pagado)} de ${pesos(total)}", style = MaterialTheme.typography.headlineSmall, color = c.tinta)
                Spacer(Modifier.height(8.dp))
                BarraProgreso(porcentajePagado.toFloat() / 100f)
                Spacer(Modifier.height(6.dp))
                Text("${porcentaje(porcentajePagado)} pagado · ${pesos(saldo)} pendiente", style = MaterialTheme.typography.bodySmall, color = c.apagado)
            }
            siguiente?.let { s ->
                Spacer(Modifier.height(12.dp))
                Column(Modifier.fillMaxWidth().clip(Radios.lg).border(1.dp, c.verde.copy(alpha = 0.35f), Radios.lg).padding(16.dp)) {
                    Rotulo("Siguiente acción", color = c.verde)
                    Text(s.titulo, style = MaterialTheme.typography.headlineSmall, color = c.tinta)
                    Text(s.detalle, style = MaterialTheme.typography.bodyMedium, color = c.tintaSuave)
                    if (s.accion != null && s.etiqueta != null) {
                        Spacer(Modifier.height(10.dp))
                        BotonPrincipal(s.etiqueta, s.accion, Modifier.fillMaxWidth(), habilitado = !ocupado)
                    }
                    if (previo != null) BotonTexto("Volver al paso anterior", { retroceder = true }, icono = Iconos.Volver, habilitado = !ocupado)
                }
            }
        }
        if (aprobada && notas.isNotEmpty()) {
            Spacer(Modifier.height(16.dp))
            Text(if (notas.size > 1) "Notas de pedido" else "Nota de pedido", style = MaterialTheme.typography.titleMedium, color = c.tinta)
            notas.forEach { n ->
                val envio = if (n.anulada) null else envios.firstOrNull { it.texto("fabrica") == n.fabrica?.clave }
                val textoEnvio = when (envio?.texto("estado")) {
                    "entregado" -> "Enviada a fábrica"
                    "fallido" -> "No llegó a la fábrica"
                    "pendiente" -> "Pendiente de envío"
                    else -> null
                }
                val paso = if (produciendo && varias && !n.anulada) pasoProduccion(n) else null
                Column(Modifier.padding(vertical = 8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(n.fabrica?.let { "Fábrica ${nombreFabrica[it]}" } ?: "Sin fábrica asignada", style = MaterialTheme.typography.titleSmall, color = c.tinta)
                            Text("N° ${n.numero} · ${plural(n.montos.lineas.size, "ítem")}", style = MaterialTheme.typography.bodySmall, color = c.apagado)
                        }
                        Pildora(if (n.anulada) "Anulada" else etapaProduccion(n).etiqueta, if (n.anulada) c.peligroVelo else c.tonal, if (n.anulada) c.peligro else c.tintaSuave)
                    }
                    if (textoEnvio != null) Pildora(
                        textoEnvio,
                        if (envio?.texto("estado") == "fallido") c.peligroVelo else c.verdePalido,
                        if (envio?.texto("estado") == "fallido") c.peligro else c.verde,
                        Modifier.padding(top = 6.dp),
                        icono = Iconos.Fabrica,
                    )
                    if (paso != null) BotonSecundario(paso.first, paso.second, Modifier.padding(top = 6.dp), habilitado = !ocupado)
                }
            }
        }
        if (notas.isEmpty() && lineasReparto.isNotEmpty()) {
            Spacer(Modifier.height(16.dp))
            Text("Fábricas", style = MaterialTheme.typography.titleMedium, color = c.tinta)
            val partes = FABRICAS.mapNotNull { f ->
                val n = lineasReparto.count { q.solicitudes[it.indice!!].fabrica == f }
                if (n > 0) "${nombreFabrica[f]}: ${plural(n, "ítem")}" else null
            }.toMutableList()
            val sin = lineasReparto.count { q.solicitudes[it.indice!!].fabrica == null }
            if (sin > 0) partes += "${if (partes.isNotEmpty()) "sin" else "Sin"} fábrica: ${plural(sin, "ítem")}"
            Text("${partes.joinToString(" · ")}. Cada fábrica recibe su propia nota de pedido con sus ítems.", style = MaterialTheme.typography.bodySmall, color = c.apagado)
            BotonSecundario("Repartir entre fábricas", { reparto = false }, Modifier.padding(top = 6.dp), icono = Iconos.Fabrica, habilitado = !ocupado)
        }
        Spacer(Modifier.height(14.dp))
        Divisor()
        Spacer(Modifier.height(10.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Pildora("Comercial: ${etiquetaComercial.getValue(comercial)}", c.tonal, c.tintaSuave)
            Pildora("Operación: ${etiquetaOperativo.getValue(operacion)}", c.tonal, c.tintaSuave)
            if (aprobada) Pildora(etiquetaFacturacion(q.facturacion), c.tonal, c.tintaSuave)
            if (aprobada) etiquetaDocumentoFacturacion(q.facturacion?.estado, q.facturacion?.documento, q.facturacion?.tipo, q.facturacion?.receptor)?.let {
                Pildora(it, c.tonal, c.tintaSuave)
            }
        }
        if (aprobada && notas.isEmpty() && q.pagos.isEmpty() && q.facturacion?.facturada != true) {
            Spacer(Modifier.height(10.dp))
            BotonSecundario("Deshacer aprobación", {
                vm.confirmarYFlujo(
                    "¿Deshacer la aprobación?",
                    "La cotización ${numeroCotizacion(q.numero)} vuelve a «Emitida»: podrás modificarla o registrar la aprobación de nuevo.",
                    "Deshacer aprobación",
                ) { Acciones.simple("desaprobar", it.id, it.actualizada) }
            }, habilitado = !ocupado, icono = Iconos.Deshacer)
            Text("Disponible mientras no haya pagos, nota de pedido ni factura.", style = MaterialTheme.typography.bodySmall, color = c.apagado)
        }
        if (q.estado == EstadoCotizacion.EMITIDA) {
            Spacer(Modifier.height(10.dp))
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (comercial != EstadoComercial.SEGUIMIENTO) BotonSecundario("Marcar seguimiento", {
                    vm.flujo({ Acciones.comercial(it.id, it.actualizada, "seguimiento") })
                }, Modifier.fillMaxWidth(), habilitado = !ocupado)
                BotonSecundario("Marcar rechazada", {
                    vm.confirmarYFlujo(
                        "¿Marcar como rechazada?",
                        "La cotización ${numeroCotizacion(q.numero)} queda anulada por rechazo del cliente: no se podrá aprobar ni editar y su número no se reutiliza.",
                        "Marcar rechazada",
                        peligro = true,
                    ) { Acciones.comercial(it.id, it.actualizada, "rechazada") }
                }, Modifier.fillMaxWidth(), habilitado = !ocupado, peligro = true)
            }
            Text("Los pagos se registran cuando el cliente aprueba la cotización.", style = MaterialTheme.typography.bodySmall, color = c.apagado, modifier = Modifier.padding(top = 6.dp))
        }
        if (aprobada) Pagos(vm, q, saldo, ocupado, pedirVista, foco)
        if (aprobada) Facturacion(vm, q, ocupado)
        NotasInternas(vm, q, ocupado)
    }
    reparto?.let { generar -> HojaReparto(q, generar, ocupado, vm) { reparto = null } }
    if (retroceder && previo != null) DialogoRetroceso(previo.desde, previo.hasta, { retroceder = false }) { motivo ->
        retroceder = false
        vm.flujo({ Acciones.retrocederOperacion(it.id, it.actualizada, motivo) })
    }
}

@Composable
private fun BarraProgreso(fraccion: Float) {
    val c = Neltume.colores
    val animada by animateFloatAsState(fraccion.coerceIn(0f, 1f), tween(Movimiento.TOTAL, easing = Movimiento.salida), label = "pago")
    Box(
        Modifier
            .fillMaxWidth()
            .height(8.dp)
            .clip(Radios.pildora)
            .background(c.lineaMedia)
            .semantics { progressBarRangeInfo = ProgressBarRangeInfo(fraccion, 0f..1f) },
    ) {
        Box(Modifier.fillMaxWidth(animada).fillMaxHeight().clip(Radios.pildora).background(c.verde))
    }
}

// --- Pagos ----------------------------------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Pagos(
    vm: CotizadorViewModel,
    q: Cotizacion,
    saldo: Long,
    ocupado: Boolean,
    pedirVista: androidx.compose.foundation.relocation.BringIntoViewRequester,
    foco: androidx.compose.ui.focus.FocusRequester,
) {
    val c = Neltume.colores
    val rango = rangoFechaOperacion(q.fechaAprobacion)
    var monto by remember(q.id) { mutableStateOf("") }
    var fecha by remember(q.id) { mutableStateOf(rango.max) }
    var observacion by remember(q.id) { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var calendario by remember { mutableStateOf(false) }
    var anular by remember { mutableStateOf<cl.puertasneltume.cotizador.nucleo.modelo.Pago?>(null) }
    Spacer(Modifier.height(16.dp))
    Text("Pagos", style = MaterialTheme.typography.titleMedium, color = c.tinta)
    if (saldo <= 0) Text("Pagado en su totalidad: ${pesos(totalPagado(q))} de ${pesos(q.montos.total)}.", style = MaterialTheme.typography.bodyMedium, color = c.verde)
    else Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        CampoPesos(
            monto,
            { monto = it; error = null },
            "Monto recibido (máx. ${pesos(saldo)})",
            Modifier.bringIntoViewRequester(pedirVista),
            error = error,
            habilitado = !ocupado,
            foco = foco,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            BotonSecundario("Fecha: ${Fechas.chilena(fecha)}", { calendario = true }, Modifier.weight(1f), icono = Iconos.Calendario, habilitado = !ocupado)
            BotonTexto("Saldo completo", { monto = saldo.toString() }, habilitado = !ocupado)
        }
        Campo(observacion, { observacion = it }, "Observación", ayuda = "Transferencia, anticipo…", largoMaximo = 500, habilitado = !ocupado)
        BotonPrincipal("Registrar pago", {
            val n = leerPesos(monto).aPesos()
            error = when {
                n == null -> "Escribe un monto en pesos, sin decimales."
                n <= 0 -> "Escribe un monto mayor que cero."
                n > saldo -> "Máximo ${pesos(saldo)}."
                else -> null
            }
            if (error == null) vm.flujo({ Acciones.pago(it.id, it.actualizada, n!!, fecha, observacion) }, "Pago de ${pesos(n!!)} registrado.") { ok ->
                if (ok) {
                    monto = ""
                    observacion = ""
                }
            }
        }, Modifier.fillMaxWidth(), habilitado = !ocupado && monto.isNotBlank(), icono = Iconos.Billetera)
    }
    q.pagos.forEach { p ->
        Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(pesos(p.monto), style = MaterialTheme.typography.titleSmall, color = c.tinta)
                Text("${Fechas.larga(p.fecha)}${p.observacion?.let { " · $it" } ?: ""}", style = MaterialTheme.typography.bodySmall, color = c.apagado)
            }
            if (pagoAnulable(q)) BotonTexto("Anular", { anular = p }, peligro = true, habilitado = !ocupado)
        }
    }
    if (calendario) SelectorFecha(fecha, rango.min, rango.max, { calendario = false }) { fecha = it; calendario = false }
    anular?.let { p ->
        val restante = totalPagado(q) - p.monto
        val minimo = anticipoMinimo(q.montos.total)
        val frena = q.notas.isNotEmpty() && q.estadoOperativo in setOf(EstadoOperativo.PEDIDO_GENERADO, EstadoOperativo.EN_PRODUCCION) && restante < minimo
        DialogoMotivo(
            "¿Anular el pago de ${pesos(p.monto)}?",
            "Del ${Fechas.larga(p.fecha)}. Queda en la actividad con el motivo.",
            if (frena) "${if (q.notas.size > 1) "Las notas de pedido ya están generadas" else "La nota de pedido ya está generada"} y quedarían ${pesos(restante)} pagados, menos del ${Limites.ANTICIPO_TEXTO} (${pesos(minimo)}): la producción no podrá ${if (q.estadoOperativo == EstadoOperativo.PEDIDO_GENERADO) "iniciarse" else "terminarse"} hasta volver a registrar el anticipo." else null,
            "Anular pago",
            obligatorio = false,
            alCerrar = { anular = null },
        ) { motivo ->
            anular = null
            vm.flujo({ Acciones.anularPago(it.id, it.actualizada, p.id, motivo) }, "Pago de ${pesos(p.monto)} anulado.")
        }
    }
}

/** Calendario limitado al rango permitido (desde la aprobación hasta hoy). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SelectorFecha(actual: String, min: String?, max: String, alCerrar: () -> Unit, alElegir: (String) -> Unit) {
    val aMillis = { f: String -> LocalDate.parse(f).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() }
    val estado = rememberDatePickerState(
        initialSelectedDateMillis = aMillis(actual),
        selectableDates = object : SelectableDates {
            override fun isSelectableDate(utcTimeMillis: Long): Boolean {
                val dia = Instant.ofEpochMilli(utcTimeMillis).atZone(ZoneOffset.UTC).toLocalDate().toString()
                return (min == null || dia >= min) && dia <= max
            }
        },
    )
    DatePickerDialog(
        onDismissRequest = alCerrar,
        confirmButton = {
            BotonTexto("Elegir", {
                estado.selectedDateMillis?.let { alElegir(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString()) }
            })
        },
        dismissButton = { BotonTexto("Cancelar", alCerrar) },
    ) { DatePicker(estado) }
}

/** Pide un motivo (obligatorio u opcional) antes de una acción que queda en la actividad. */
@Composable
fun DialogoMotivo(titulo: String, mensaje: String, advertencia: String?, aceptar: String, obligatorio: Boolean, alCerrar: () -> Unit, alAceptar: (String?) -> Unit) {
    val c = Neltume.colores
    var motivo by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = alCerrar,
        shape = Radios.hoja,
        containerColor = c.superficie,
        title = { Text(titulo, style = MaterialTheme.typography.headlineSmall, color = c.tinta) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(mensaje, style = MaterialTheme.typography.bodyMedium, color = c.tintaSuave)
                advertencia?.let { Aviso(it, tono = TonoAviso.ATENCION) }
                Campo(motivo, { motivo = it }, if (obligatorio) "Motivo" else "Motivo (opcional)", lineas = 2, largoMaximo = 500)
            }
        },
        confirmButton = { BotonPrincipal(aceptar, { alAceptar(motivo.trim().ifEmpty { null }) }, habilitado = !obligatorio || motivo.isNotBlank(), peligro = true) },
        dismissButton = { BotonSecundario("Cancelar", alCerrar) },
    )
}

@Composable
private fun DialogoRetroceso(desde: String, hasta: String, alCerrar: () -> Unit, alAceptar: (String) -> Unit) =
    DialogoMotivo(
        "¿Volver al paso anterior?",
        "La operación pasa de «$desde» a «$hasta». El motivo queda en la actividad.",
        null,
        "Volver al paso anterior",
        obligatorio = true,
        alCerrar = alCerrar,
    ) { alAceptar(it ?: "") }

// --- Reparto entre fábricas -----------------------------------------------------------------------------------

/** Elegir la fábrica de cada ítem; con `generar`, además se generan las notas (una por fábrica). */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun HojaReparto(q: Cotizacion, generar: Boolean, ocupado: Boolean, vm: CotizadorViewModel, alCerrar: () -> Unit) {
    val c = Neltume.colores
    val lineas = q.montos.lineas.filter { it.indice != null && !esLibre(q.solicitudes.getOrNull(it.indice!!)) }
    var elegidas by remember { mutableStateOf(lineas.associate { it.indice!! to q.solicitudes[it.indice!!].fabrica }) }
    var error by remember { mutableStateOf<String?>(null) }
    ModalBottomSheet(alCerrar, sheetState = rememberModalBottomSheetState(true), containerColor = c.superficie) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).navigationBarsPadding().padding(bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            TituloSeccion(if (generar) "¿Generar las notas de pedido?" else "Repartir entre fábricas")
            Text(
                if (generar) "Se genera una nota de pedido por fábrica, cada una con sus ítems a precio de fábrica. Cada fábrica asigna su siguiente N° de nota (no se reutiliza)."
                else "Elige qué fábrica hace cada ítem. Puedes cambiarlo hasta generar las notas de pedido.",
                style = MaterialTheme.typography.bodyMedium,
                color = c.tintaSuave,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FABRICAS.forEach { f -> BotonSecundario("Todo a ${nombreFabrica[f]}", { elegidas = elegidas.mapValues { f }; error = null }, Modifier.weight(1f)) }
            }
            lineas.forEach { l ->
                val i = l.indice!!
                Column(Modifier.fillMaxWidth().clip(Radios.lg).background(c.panel).padding(12.dp)) {
                    Text("${l.cantidad} × ${nombreProducto(descripcionLinea(l))}", style = MaterialTheme.typography.titleSmall, color = c.tinta)
                    Text(l.producto.codigo, style = MaterialTheme.typography.bodySmall, color = c.apagado)
                    Spacer(Modifier.height(6.dp))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FABRICAS.forEach { f ->
                            ChipFiltro(nombreFabrica.getValue(f), elegidas[i] == f, { elegidas = elegidas + (i to f); error = null })
                        }
                    }
                }
            }
            error?.let { Aviso(it, tono = TonoAviso.PELIGRO) }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                BotonSecundario("Cancelar", alCerrar, Modifier.weight(1f))
                BotonPrincipal(if (generar) "Generar" else "Guardar reparto", {
                    val sin = lineas.filter { elegidas[it.indice!!] == null }
                    if (generar && sin.isNotEmpty()) {
                        error = "Elige la fábrica de ${if (sin.size == 1) "un ítem" else "${sin.size} ítems"}: ${sin.joinToString(", ") { nombreProducto(descripcionLinea(it)) }}."
                        return@BotonPrincipal
                    }
                    val cambios = lineas.filter { elegidas[it.indice!!] != q.solicitudes[it.indice!!].fabrica }.associate { it.indice!! to elegidas[it.indice!!] }
                    alCerrar()
                    if (generar) vm.flujo({ Acciones.generarNota(it.id, it.actualizada, cambios.ifEmpty { null }) })
                    else if (cambios.isNotEmpty()) vm.flujo({ Acciones.asignarFabricas(it.id, it.actualizada, cambios) }, "Fábricas asignadas.")
                }, Modifier.weight(1f), habilitado = !ocupado)
            }
        }
    }
}

// --- Facturación ----------------------------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Facturacion(vm: CotizadorViewModel, q: Cotizacion, ocupado: Boolean) {
    val c = Neltume.colores
    val avisos = LocalAvisos.current
    val portapapeles = LocalClipboard.current
    val contexto = LocalContext.current
    val alcance = rememberCoroutineScope()
    val f = q.facturacion
    Spacer(Modifier.height(16.dp))
    Text("Facturación", style = MaterialTheme.typography.titleMedium, color = c.tinta)
    if (f?.facturada == true) {
        Text("${etiquetaFacturacion(f)}${f.fecha?.let { " · ${Fechas.larga(it)}" } ?: ""}", style = MaterialTheme.typography.bodyMedium, color = c.verde)
        if (receptorTieneContenido(f.receptor)) BotonTexto("Copiar datos para facturar", {
            alcance.launch { copiar(portapapeles, contexto, textoCopiarFactura(f.receptor)); avisos.mostrar("Datos copiados para facturar.") }
        }, icono = Iconos.Copiar)
        BotonSecundario("Volver a pendiente", { vm.flujo({ Acciones.facturacion(it.id, it.actualizada, "pendiente") }) }, habilitado = !ocupado)
        return
    }
    val rango = rangoFechaOperacion(q.fechaAprobacion)
    var documento by remember(q.id, q.actualizada) { mutableStateOf(f?.documento) }
    var receptor by remember(q.id, q.actualizada) { mutableStateOf(f?.receptor ?: receptorDesdeCliente(q.cliente)) }
    var errores by remember { mutableStateOf(mapOf<String, String>()) }
    var tipo by remember(q.id) { mutableStateOf(if (f?.documento == TipoDocumento.BOLETA) TipoDocumento.BOLETA else TipoDocumento.FACTURA) }
    var numero by remember(q.id) { mutableStateOf("") }
    var fecha by remember(q.id) { mutableStateOf(rango.max) }
    var calendario by remember { mutableStateOf(false) }
    val cambios = documento != f?.documento || (documento == TipoDocumento.FACTURA && receptor != (f?.receptor ?: ReceptorFacturacion()))
    Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Rotulo("Documento que pidió el cliente")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ChipFiltro("Aún no sabe", documento == null, { documento = null })
            ChipFiltro("Boleta", documento == TipoDocumento.BOLETA, { documento = TipoDocumento.BOLETA; tipo = TipoDocumento.BOLETA })
            ChipFiltro("Factura", documento == TipoDocumento.FACTURA, { documento = TipoDocumento.FACTURA; tipo = TipoDocumento.FACTURA })
        }
        if (documento == TipoDocumento.FACTURA) CamposReceptor(receptor, errores) { receptor = it }
        val faltan = faltanDatosFactura(if (documento == TipoDocumento.FACTURA) receptor else f?.receptor)
        if ((documento == TipoDocumento.FACTURA || tipo == TipoDocumento.FACTURA) && faltan.isNotEmpty())
            Aviso("Faltan datos para facturar: ${faltan.joinToString(", ")}.", tono = TonoAviso.ATENCION)
        if (cambios) BotonPrincipal("Guardar datos de facturación", {
            val e = mutableMapOf<String, String>()
            if (documento == TipoDocumento.FACTURA) {
                receptor.rut?.takeIf { it.isNotBlank() }?.let { if (normalizarRut(it) == null) e["rut"] = "El RUT no es válido. Revísalo." }
                receptor.correo?.takeIf { it.isNotBlank() }?.let { if (!correoValido(it)) e["correo"] = "El correo no es válido." }
            }
            errores = e
            if (e.isEmpty()) vm.flujo({ Acciones.datosFacturacion(it.id, it.actualizada, documento, if (documento == TipoDocumento.FACTURA) receptor else null) }, "Datos de facturación guardados.")
        }, Modifier.fillMaxWidth(), habilitado = !ocupado)
        if (documento == TipoDocumento.FACTURA && receptorTieneContenido(receptor)) BotonTexto("Copiar datos para facturar", {
            alcance.launch { copiar(portapapeles, contexto, textoCopiarFactura(receptor)); avisos.mostrar("Datos copiados para facturar.") }
        }, icono = Iconos.Copiar)
        Divisor()
        Rotulo("Marcar como facturada")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ChipFiltro("Factura", tipo == TipoDocumento.FACTURA, { tipo = TipoDocumento.FACTURA })
            ChipFiltro("Boleta", tipo == TipoDocumento.BOLETA, { tipo = TipoDocumento.BOLETA })
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Campo(numero, { numero = it }, "N° del documento", Modifier.weight(1f), teclado = KeyboardType.Text, largoMaximo = 60)
            BotonSecundario(Fechas.chilena(fecha), { calendario = true }, Modifier.padding(top = 6.dp), icono = Iconos.Calendario)
        }
        BotonSecundario("Marcar como facturada", {
            val pedida = f?.documento
            val accion = { vm.flujo({ Acciones.facturacion(it.id, it.actualizada, "facturada", tipo, numero, fecha) }, "Facturación registrada.") }
            if (pedida != null && pedida != tipo) vm.confirmarYFlujo(
                "¿Registrar ${if (tipo == TipoDocumento.BOLETA) "boleta" else "factura"}?",
                "El cliente pidió ${if (pedida == TipoDocumento.BOLETA) "boleta" else "factura"}. ¿Registrar de todos modos ${if (tipo == TipoDocumento.BOLETA) "una boleta" else "una factura"}?",
                "Registrar de todos modos",
            ) { Acciones.facturacion(it.id, it.actualizada, "facturada", tipo, numero, fecha) }
            else accion()
        }, Modifier.fillMaxWidth(), icono = Iconos.Recibo, habilitado = !ocupado && (tipo == TipoDocumento.BOLETA || faltanDatosFactura(f?.receptor).isEmpty()))
        if (tipo == TipoDocumento.FACTURA && faltanDatosFactura(f?.receptor).isNotEmpty())
            Text("Guarda los datos del receptor para poder registrar la factura.", style = MaterialTheme.typography.bodySmall, color = c.apagado)
    }
    if (calendario) SelectorFecha(fecha, rango.min, rango.max, { calendario = false }) { fecha = it; calendario = false }
}

// --- Notas internas -------------------------------------------------------------------------------------------

@Composable
private fun NotasInternas(vm: CotizadorViewModel, q: Cotizacion, ocupado: Boolean) {
    val c = Neltume.colores
    var texto by remember(q.id) { mutableStateOf("") }
    Spacer(Modifier.height(16.dp))
    Text("Notas internas", style = MaterialTheme.typography.titleMedium, color = c.tinta)
    Spacer(Modifier.height(8.dp))
    Campo(texto, { texto = it }, "Nota interna", lineas = 2, ayuda = "Seguimiento, acuerdos o instrucciones internas", largoMaximo = 2000, habilitado = !ocupado)
    BotonSecundario("Agregar nota", {
        vm.flujo({ Acciones.comentario(it.id, it.actualizada, texto) }) { if (it) texto = "" }
    }, Modifier.padding(top = 6.dp), habilitado = texto.isNotBlank() && !ocupado)
    q.comentariosInternos.forEach { n ->
        Column(Modifier.padding(top = 10.dp)) {
            Text("${Fechas.larga(n.fecha)} · ${n.usuario ?: "Equipo"}", style = MaterialTheme.typography.labelSmall, color = c.apagado)
            Text(n.texto, style = MaterialTheme.typography.bodyMedium, color = c.tinta)
        }
    }
}
