package cl.puertasneltume.cotizador.cotizar

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import cl.puertasneltume.cotizador.diseno.Aviso
import cl.puertasneltume.cotizador.diseno.BotonSecundario
import cl.puertasneltume.cotizador.diseno.BotonTexto
import cl.puertasneltume.cotizador.diseno.FormaGlobo
import cl.puertasneltume.cotizador.diseno.FormaGloboAsistente
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Newsreader
import cl.puertasneltume.cotizador.diseno.PildoraEstado
import cl.puertasneltume.cotizador.diseno.PuntosEspera
import cl.puertasneltume.cotizador.diseno.Radios
import cl.puertasneltume.cotizador.diseno.TonoAviso
import cl.puertasneltume.cotizador.nucleo.modelo.Cotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.EstadoCotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.Mensaje
import cl.puertasneltume.cotizador.nucleo.reglas.CampoMedida
import cl.puertasneltume.cotizador.nucleo.reglas.Fechas
import cl.puertasneltume.cotizador.nucleo.reglas.Limites
import cl.puertasneltume.cotizador.nucleo.reglas.NumerosCL
import cl.puertasneltume.cotizador.nucleo.reglas.PreguntaPendiente
import cl.puertasneltume.cotizador.nucleo.reglas.SIN_CLIENTE
import cl.puertasneltume.cotizador.nucleo.reglas.esEditable
import cl.puertasneltume.cotizador.nucleo.reglas.etiquetaEstado
import cl.puertasneltume.cotizador.nucleo.reglas.leerMedida
import cl.puertasneltume.cotizador.nucleo.reglas.metrosTexto
import cl.puertasneltume.cotizador.nucleo.reglas.numeroCotizacion
import cl.puertasneltume.cotizador.nucleo.reglas.pesos
import cl.puertasneltume.cotizador.nucleo.reglas.plural
import cl.puertasneltume.cotizador.nucleo.reglas.preguntasPendientes
import kotlinx.coroutines.delay

const val EJEMPLO = "Cotiza 3 Huilo Huilo en oregón de 80 × 2,10 para Juan Pérez, Temuco"
private const val SIN_ASISTENTE = "El asistente no está configurado. Pide a quien administra el cotizador que lo active."
private const val MAX_BOTONES = 10

/** La conversación con el asistente y el mensaje en preparación. */
@Composable
fun PanelChat(vm: CotizadorViewModel, e: EstadoCotizador, acciones: AccionesCotizar) {
    val c = Neltume.colores
    val q = e.cotizacion
    val mensaje by vm.mensaje.collectAsStateWithLifecycle()
    val bloqueada = q != null && !esEditable(q) && q.estado != EstadoCotizacion.APROBADA
    val mensajes = q?.historial ?: e.charla
    val preguntas = if (q?.estado == EstadoCotizacion.BORRADOR) preguntasPendientes(q) else emptyList()
    val preguntaAbierta = q == null || (q.estado == EstadoCotizacion.BORRADOR && q.incompletos.isNotEmpty())
    val deshabilitado = e.ocupado || bloqueada || e.cargando || e.seleccion != null || !e.configurado
    val conConversacion = mensajes.isNotEmpty() || (q?.solicitudes?.isNotEmpty() == true)
    val lista = rememberLazyListState()
    val totalElementos = mensajes.size + (if (e.ocupado && e.enCurso == Operacion.CHAT) 1 else 0) + (if (e.seleccion != null) 2 else 0) +
        (if (e.nota != null) 1 else 0) + e.avisosLocales.size
    LaunchedEffect(totalElementos, q?.id) {
        if (totalElementos > 0) lista.animateScrollToItem(lista.layoutInfo.totalItemsCount.coerceAtLeast(1) - 1)
    }

    Column(Modifier.fillMaxSize().imePadding()) {
        LazyColumn(
            Modifier.weight(1f).fillMaxWidth(),
            state = lista,
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (!conConversacion && !e.cargando) item(key = "bienvenida") {
                Bienvenida(habilitado = !deshabilitado, usarEjemplo = { vm.escribir(EJEMPLO) }, ayuda = acciones.ayuda, agregar = acciones.agregarProducto)
            }
            itemsIndexed(mensajes, key = { i, _ -> "m$i-${q?.id}" }) { i, m ->
                val ultima = !m.esUsuario && i == mensajes.lastIndex
                val conPreguntas = ultima && preguntas.isNotEmpty()
                Globo(
                    m,
                    texto = if (conPreguntas) sinPreguntas(m.texto, q!!) else m.texto,
                    elegir = if (ultima && !conPreguntas && !deshabilitado && preguntaAbierta) vm::responderOpcion else null,
                    vivo = ultima,
                ) {
                    if (conPreguntas) PreguntasChat(q!!, preguntas, editable = !e.ocupado && !bloqueada, guardando = e.guardando) { p, v ->
                        vm.responderPregunta(p, v)
                    }
                }
            }
            if (q?.estado == EstadoCotizacion.EMITIDA && esEditable(q)) item(key = "estado") {
                GloboLocal(
                    "${numeroCotizacion(q.numero)} emitida${q.fechaEmision?.let { " el ${Fechas.larga(it)}" } ?: ""}. Si escribes un cambio, se creará una revisión (una versión nueva en borrador que la reemplazará al emitirla) y este PDF se conserva.",
                )
            }
            if (e.avisosLocales.isNotEmpty()) item(key = "avisos") { GloboLocal(e.avisosLocales.joinToString("\n")) }
            e.nota?.let { item(key = "nota") { GloboLocal(it) } }
            e.seleccion?.let { s ->
                item(key = "sel-msg") { Globo(Mensaje("usuario", s.mensaje), s.mensaje, null, false) {} }
                item(key = "sel") { Seleccion(s, !e.ocupado, vm) }
            }
            if (e.enCurso == Operacion.CHAT) item(key = "espera") { Espera(e.inicioEspera, vm::cancelar) }
        }
        if (!e.configurado) Aviso(SIN_ASISTENTE, Modifier.padding(horizontal = 16.dp), TonoAviso.ATENCION)
        if (q?.estado == EstadoCotizacion.APROBADA)
            Text(
                "Esta cotización está aprobada y no se modifica: duplícala si necesitas una nueva versión. Por chat puedes repartir sus ítems entre las fábricas o cambiar su número o el de sus notas de pedido.",
                style = MaterialTheme.typography.bodySmall,
                color = c.apagado,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
            )
        if (bloqueada && q != null) {
            Column(Modifier.fillMaxWidth().padding(16.dp).clip(Radios.lg).background(c.panel).padding(14.dp)) {
                Text(
                    "Esta cotización está ${etiquetaEstado.getValue(q.estado).lowercase()} y no admite cambios." +
                        if (q.estado == EstadoCotizacion.REEMPLAZADA && q.reemplazadaPor != null) " Modifica la N° ${q.reemplazadaPor}." else "",
                    style = MaterialTheme.typography.bodyMedium,
                    color = c.tinta,
                )
                Spacer(Modifier.size(10.dp))
                BotonSecundario("Duplicar como cotización nueva", acciones.duplicar, habilitado = !e.ocupado, icono = Iconos.Duplicar)
            }
        } else Compositor(
            texto = mensaje,
            alCambiar = vm::escribir,
            habilitado = !deshabilitado,
            ocupado = e.enCurso == Operacion.CHAT,
            textoConservado = e.textoConservado,
            razonamiento = e.razonamiento?.takeIf { e.configurado },
            pista = when {
                !e.configurado -> "El chat no está disponible por ahora."
                q?.estado == EstadoCotizacion.APROBADA -> "Repartir ítems entre fábricas o cambiar un número…"
                e.seleccion != null -> "Elige una de las cotizaciones de arriba."
                q?.estado == EstadoCotizacion.EMITIDA -> "Escribe un cambio: se creará una revisión de la ${numeroCotizacion(q.numero)}."
                else -> "Escribe el pedido o agrega un detalle…"
            },
            alEnviar = vm::enviar,
            alCancelar = vm::cancelar,
            alBorrar = { vm.escribir("") },
            alElegirRazonamiento = vm::elegirRazonamiento,
        )
    }
}

/** Las preguntas estructuradas no se repiten en el texto de la respuesta: se responden ahí mismo. */
private fun sinPreguntas(texto: String, q: Cotizacion): String {
    val preguntas = q.incompletos.flatMap { it.pregunta.split('\n') }.toSet()
    return texto.split('\n').filter { it !in preguntas }.joinToString("\n").replace(Regex("\n{3,}"), "\n\n").trim()
}

@Composable
private fun Bienvenida(habilitado: Boolean, usarEjemplo: () -> Unit, ayuda: () -> Unit, agregar: () -> Unit) {
    val c = Neltume.colores
    Column(Modifier.fillMaxWidth().padding(top = 12.dp)) {
        Text("Cuéntame el pedido", style = MaterialTheme.typography.headlineMedium, color = c.tinta)
        Spacer(Modifier.size(6.dp))
        Text(
            "Empecemos con una puerta. Indica el modelo, la madera, las medidas y la cantidad. También puedes incluir los datos del cliente.",
            style = MaterialTheme.typography.bodyMedium,
            color = c.tintaSuave,
        )
        Spacer(Modifier.size(16.dp))
        Column(
            Modifier
                .fillMaxWidth()
                .clip(Radios.xl)
                .background(c.superficie)
                .border(1.dp, c.linea, Radios.xl)
                .clickable(enabled = habilitado, onClick = usarEjemplo)
                .padding(16.dp),
        ) {
            Text("USAR ESTE EJEMPLO", style = MaterialTheme.typography.labelSmall, color = c.verde)
            Spacer(Modifier.size(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("“3 Huilo Huilo en oregón de 80 × 2,10 para Juan Pérez, Temuco”", style = MaterialTheme.typography.bodyLarge.copy(fontFamily = Newsreader), color = c.tinta, modifier = Modifier.weight(1f))
                Icon(Iconos.Derecha, null, tint = c.verde)
            }
        }
        Spacer(Modifier.size(12.dp))
        BotonSecundario("Agregar producto del catálogo", agregar, Modifier.fillMaxWidth(), icono = Iconos.Mas, habilitado = habilitado)
        Spacer(Modifier.size(8.dp))
        BotonTexto("¿Primera vez? Mira cómo funciona el cotizador", ayuda, icono = Iconos.Ayuda)
    }
}

/** Burbuja de un mensaje: la persona a la derecha, el asistente a la izquierda con su disco «N». */
@Composable
private fun Globo(m: Mensaje, texto: String, elegir: ((String) -> Unit)?, vivo: Boolean, extra: @Composable () -> Unit) {
    val c = Neltume.colores
    if (m.esUsuario) {
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
            Text(
                texto,
                modifier = Modifier
                    .widthIn(max = 320.dp)
                    .clip(FormaGlobo)
                    .background(c.verdeVelo)
                    .padding(horizontal = 14.dp, vertical = 10.dp)
                    .semantics { contentDescription = "Tú: $texto" },
                style = MaterialTheme.typography.bodyMedium,
                color = c.tinta,
            )
        }
        return
    }
    Row(Modifier.fillMaxWidth().animateContentSize()) {
        DiscoN()
        Spacer(Modifier.width(8.dp))
        Column(
            Modifier
                .weight(1f, fill = false)
                .clip(FormaGloboAsistente)
                .background(c.superficie)
                .border(1.dp, c.linea, FormaGloboAsistente)
                .padding(horizontal = 14.dp, vertical = 10.dp)
                .let { if (vivo) it.semantics { liveRegion = LiveRegionMode.Polite } else it },
        ) {
            if (texto.isNotBlank()) TextoMensaje(texto, elegir)
            extra()
        }
    }
}

@Composable
private fun DiscoN() {
    val c = Neltume.colores
    Box(Modifier.size(28.dp).clip(CircleShape).background(c.bosque), contentAlignment = Alignment.Center) {
        Text("N", style = MaterialTheme.typography.labelLarge.copy(fontFamily = Newsreader, fontWeight = FontWeight.W600), color = c.bosqueTinta)
    }
}

/** Nota local del asistente (estado de la emitida, avisos de una edición, resumen de cambios). */
@Composable
private fun GloboLocal(texto: String) {
    val c = Neltume.colores
    Row(Modifier.fillMaxWidth()) {
        DiscoN()
        Spacer(Modifier.width(8.dp))
        Text(
            texto,
            Modifier.clip(FormaGloboAsistente).background(c.panel).padding(horizontal = 14.dp, vertical = 10.dp),
            style = MaterialTheme.typography.bodySmall,
            color = c.tintaSuave,
        )
    }
}

private val LISTA = Regex("""^(.*?)\s*(Opciones disponibles|Opciones|Modelos disponibles|Maderas disponibles):\s*(.+?)\.?$""")
private val RESTO = Regex("""\s+y (\d+) más \(revisa «Catálogo»\)$""")

private fun campoDe(pregunta: String, tipo: String) = when (tipo) {
    "Modelos disponibles" -> "modelo"
    "Maderas disponibles" -> "madera"
    else -> Regex("""^¿Qué (.+?) necesitas""").find(pregunta)?.groupValues?.get(1)
        ?: Regex(""" de ([^.]+?)\.$""").find(pregunta)?.groupValues?.get(1) ?: ""
}

/**
 * Texto de un mensaje. Con `elegir`, las listas «Opciones: a, b, c.» se muestran como chips que agregan la respuesta
 * al mensaje en preparación (texto-mensaje.tsx); sin él, las opciones se separan con «·».
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TextoMensaje(texto: String, elegir: ((String) -> Unit)?) {
    val c = Neltume.colores
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        texto.split('\n').forEach { linea ->
            val m = LISTA.find(linea)
            if (m == null) {
                if (linea.isNotBlank()) Text(linea, style = MaterialTheme.typography.bodyMedium, color = c.tinta)
                return@forEach
            }
            val (pregunta, tipo, lista) = m.destructured
            val resto = RESTO.find(lista)
            val opciones = lista.replace(RESTO, "").split(", ").filter { it.isNotEmpty() }
            if (elegir == null || (opciones.size == 1 && opciones[0].startsWith("Entero entre"))) {
                Text(
                    "${if (pregunta.isNotEmpty()) "$pregunta " else ""}$tipo: ${opciones.joinToString(" · ")}${resto?.let { " y ${it.groupValues[1]} más en «Catálogo»" } ?: ""}.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = c.tinta,
                )
                return@forEach
            }
            val campo = campoDe(pregunta, tipo)
            Text(pregunta.ifEmpty { "$tipo:" }, style = MaterialTheme.typography.bodyMedium, color = c.tinta)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                opciones.forEach { o ->
                    ChipOpcion(o, if (campo.isNotEmpty()) "Responder $campo: $o" else "Responder $o") {
                        elegir(if (campo.isNotEmpty()) "$campo $o" else o)
                    }
                }
                if (resto != null) Text("y ${resto.groupValues[1]} más en «Catálogo»", style = MaterialTheme.typography.bodySmall, color = c.apagado, modifier = Modifier.align(Alignment.CenterVertically))
            }
        }
    }
}

@Composable
private fun ChipOpcion(texto: String, descripcion: String, sugerencia: String? = null, habilitado: Boolean = true, alPulsar: () -> Unit) {
    val c = Neltume.colores
    Column(
        Modifier
            .heightIn(min = 40.dp)
            .clip(Radios.pildora)
            .background(if (sugerencia != null) c.verdeVelo else c.superficie)
            .border(1.dp, if (sugerencia != null) c.verde.copy(alpha = 0.4f) else c.lineaMedia, Radios.pildora)
            .clickable(enabled = habilitado, onClick = alPulsar)
            .semantics { contentDescription = descripcion }
            .padding(horizontal = 14.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(texto, style = MaterialTheme.typography.labelMedium.copy(fontSize = 14.sp), color = if (habilitado) c.tinta else c.apagado)
        if (sugerencia != null) Text(sugerencia, style = MaterialTheme.typography.labelSmall, color = c.verde)
    }
}

/** Preguntas de los ítems pendientes: botones, menú o campo; cada respuesta se guarda al instante. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PreguntasChat(q: Cotizacion, preguntas: List<PreguntaPendiente>, editable: Boolean, guardando: String?, responder: (PreguntaPendiente, Any) -> Unit) {
    val c = Neltume.colores
    Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(
            "Faltan datos en ${plural(q.incompletos.size, "producto")}. Elige una opción o escríbelo en tu próximo mensaje.",
            style = MaterialTheme.typography.bodySmall,
            color = c.apagado,
        )
        preguntas.forEach { p ->
            val ocupada = guardando == "pendiente.${p.clave}"
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(p.texto + if (ocupada) " · Guardando…" else "", style = MaterialTheme.typography.titleSmall, color = c.tinta)
                p.detalle?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = c.tintaSuave) }
                if (p.opciones.size > MAX_BOTONES) MenuOpciones(p, editable && !ocupada) { responder(p, it) }
                else if (p.opciones.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    p.opciones.forEach { o ->
                        ChipOpcion(o.etiqueta, "${o.etiqueta}${o.sugerencia?.let { " (${it.lowercase()})" } ?: ""} · ${p.texto}", o.sugerencia, editable && !ocupada) { responder(p, o.valor) }
                    }
                }
                p.entrada?.let { EntradaPregunta(p, editable && !ocupada) { v -> responder(p, v) } }
            }
        }
    }
}

@Composable
private fun MenuOpciones(p: PreguntaPendiente, habilitado: Boolean, elegir: (Any) -> Unit) {
    var abierto by remember { mutableStateOf(false) }
    Box {
        BotonSecundario("Elegir ${p.etiqueta?.lowercase() ?: "opción"} (${p.opciones.size})", { abierto = true }, habilitado = habilitado, icono = Iconos.Abajo)
        DropdownMenu(abierto, { abierto = false }, Modifier.heightIn(max = 360.dp)) {
            p.opciones.forEach { o ->
                DropdownMenuItem(text = { Text(o.etiqueta + (o.sugerencia?.let { " · $it" } ?: "")) }, onClick = {
                    abierto = false
                    elegir(o.valor)
                })
            }
        }
    }
}

@Composable
private fun EntradaPregunta(p: PreguntaPendiente, habilitado: Boolean, responder: (Any) -> Unit) {
    val e = p.entrada!!
    val enMetros = e.unidad == "m"
    var texto by remember(p.clave) { mutableStateOf("") }
    var error by remember(p.clave) { mutableStateOf<String?>(null) }
    val rango = if (enMetros) "entre ${metrosTexto(e.min)} y ${metrosTexto(e.max)} m"
    else "entre ${e.min.toInt()} y ${NumerosCL.agruparMiles(e.max.toInt().toString())}"
    fun aplicar() {
        val valor: Double? = if (enMetros) leerMedida(texto, e.familia ?: "PUERTA", if (p.campo?.clave == "ancho") CampoMedida.ANCHO else CampoMedida.ALTO)
        else texto.trim().replace(',', '.').toDoubleOrNull()
        val valido = valor != null && valor.isFinite() && (enMetros || valor == Math.floor(valor)) && valor >= e.min - 1e-9 && valor <= e.max + 1e-9
        if (!valido) {
            error = if (enMetros) "Indica una medida $rango: en metros (${metrosTexto(e.min)}) o con «cm» o «mm» (${Math.round(e.min * 100)} cm)."
            else "Indica un número entero $rango."
            return
        }
        error = null
        responder(if (enMetros) valor!! else valor!!.toInt())
        texto = ""
    }
    Row(verticalAlignment = Alignment.Top) {
        cl.puertasneltume.cotizador.diseno.Campo(
            texto,
            { texto = it; error = null },
            if (enMetros) "${metrosTexto(e.min)}–${metrosTexto(e.max)} m" else "Cantidad",
            Modifier.weight(1f),
            error = error,
            teclado = if (enMetros) KeyboardType.Decimal else KeyboardType.Number,
            accionIme = androidx.compose.ui.text.input.ImeAction.Done,
            alAccion = ::aplicar,
            habilitado = habilitado,
        )
        Spacer(Modifier.width(8.dp))
        BotonSecundario("Aplicar", ::aplicar, Modifier.padding(top = 6.dp), habilitado = habilitado && texto.isNotBlank())
    }
}

/** Varias cotizaciones coinciden: tarjetas para elegir (con su total) o «Ninguna de estas». */
@Composable
private fun Seleccion(s: Seleccion, habilitado: Boolean, vm: CotizadorViewModel) {
    val c = Neltume.colores
    Row(Modifier.fillMaxWidth()) {
        DiscoN()
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Encontré varias cotizaciones que podrían ser. Elige cuál quieres modificar:", style = MaterialTheme.typography.bodyMedium, color = c.tinta)
            s.opciones.forEach { o ->
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(Radios.lg)
                        .background(c.superficie)
                        .border(1.dp, c.linea, Radios.lg)
                        .clickable(enabled = habilitado) { vm.elegirReferencia(o) }
                        .padding(12.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("${numeroCotizacion(o.numero)} · ${o.cliente.ifEmpty { SIN_CLIENTE }}", style = MaterialTheme.typography.titleSmall, color = c.tinta, modifier = Modifier.weight(1f))
                        PildoraEstado(o.estado)
                    }
                    val detalle = listOfNotNull(o.fecha.takeIf { it.isNotEmpty() }?.let { Fechas.corta(it) }, o.proyecto, o.comuna, o.detalle.takeIf { it.isNotEmpty() })
                    Text(detalle.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = c.apagado)
                    s.totales[o.id]?.let { Text(pesos(it), style = MaterialTheme.typography.titleSmall, color = c.verde) }
                }
            }
            BotonTexto("Ninguna de estas · es una cotización nueva", vm::descartarSeleccion, habilitado = habilitado)
        }
    }
}

/** Mientras responde el asistente: los tres puntos y, pasados 6 s, cuánto lleva y cómo seguir sin esperar. */
@Composable
private fun Espera(inicio: Long?, cancelar: () -> Unit) {
    val c = Neltume.colores
    var segundos by remember { mutableLongStateOf(0L) }
    LaunchedEffect(inicio) {
        while (true) {
            segundos = ((System.currentTimeMillis() - (inicio ?: System.currentTimeMillis())) / 1000)
            delay(1000)
        }
    }
    AnimatedVisibility(true, enter = fadeIn() + slideInVertically { it / 3 }) {
        Row(Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }) {
            DiscoN()
            Spacer(Modifier.width(8.dp))
            Column(Modifier.clip(FormaGloboAsistente).background(c.panel).padding(horizontal = 14.dp, vertical = 12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Preparando los detalles", style = MaterialTheme.typography.bodyMedium, color = c.tintaSuave)
                    Spacer(Modifier.width(8.dp))
                    PuntosEspera()
                }
                if (segundos >= 6) {
                    Spacer(Modifier.size(6.dp))
                    Text(
                        "$segundos s. Si prefieres no esperar, usa «Cancelar» y sigue en la cotización con «Agregar producto».",
                        style = MaterialTheme.typography.bodySmall,
                        color = c.apagado,
                    )
                }
                BotonTexto("Cancelar", cancelar, icono = Iconos.Detener)
            }
        }
    }
}

/** El mensaje en preparación: campo de varias líneas, razonamiento, contador y el botón de enviar. */
@Composable
private fun Compositor(
    texto: String,
    alCambiar: (String) -> Unit,
    habilitado: Boolean,
    ocupado: Boolean,
    textoConservado: Boolean,
    razonamiento: Razonamiento?,
    pista: String,
    alEnviar: () -> Unit,
    alCancelar: () -> Unit,
    alBorrar: () -> Unit,
    alElegirRazonamiento: (String) -> Unit,
) {
    val c = Neltume.colores
    Column(
        Modifier
            .fillMaxWidth()
            .background(c.papel)
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        if (textoConservado) Aviso(
            "Este texto venía de la cotización anterior. Revísalo antes de enviarlo.",
            Modifier.padding(bottom = 8.dp),
            TonoAviso.ATENCION,
        ) { BotonTexto("Borrar texto", alBorrar) }
        Column(
            Modifier
                .fillMaxWidth()
                .clip(Radios.xl)
                .background(c.superficie)
                .border(1.dp, if (habilitado) c.lineaMedia else c.linea, Radios.xl),
        ) {
            TextField(
                value = texto,
                onValueChange = alCambiar,
                enabled = habilitado,
                placeholder = { Text(pista, color = c.apagado) },
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp, max = 180.dp).semantics { contentDescription = "Escribe tu pedido" },
                textStyle = MaterialTheme.typography.bodyLarge,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = c.superficie,
                    unfocusedContainerColor = c.superficie,
                    disabledContainerColor = c.superficie,
                    focusedIndicatorColor = c.superficie.copy(alpha = 0f),
                    unfocusedIndicatorColor = c.superficie.copy(alpha = 0f),
                    disabledIndicatorColor = c.superficie.copy(alpha = 0f),
                    cursorColor = c.verde,
                ),
            )
            Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                if (razonamiento != null) SelectorRazonamiento(razonamiento, !ocupado, alElegirRazonamiento)
                Spacer(Modifier.weight(1f))
                if (texto.length >= Limites.AVISO_LARGO_MENSAJE) Text(
                    "${NumerosCL.agruparMiles(texto.length.toString())} / 6.000",
                    style = MaterialTheme.typography.labelSmall,
                    color = if (texto.length >= Limites.LARGO_MENSAJE) c.peligro else c.apagado,
                    modifier = Modifier.padding(end = 8.dp),
                )
                if (ocupado) cl.puertasneltume.cotizador.diseno.BotonIcono(Iconos.Detener, "Cancelar", alCancelar, tono = c.peligro)
                else {
                    val puede = habilitado && texto.isNotBlank()
                    Box(
                        Modifier
                            .size(44.dp)
                            .clip(CircleShape)
                            .background(if (puede) c.verde else c.tonalFuerte)
                            .clickable(enabled = puede, onClick = alEnviar)
                            .semantics { contentDescription = "Enviar mensaje" },
                        contentAlignment = Alignment.Center,
                    ) { Icon(Iconos.Enviar, null, tint = if (puede) c.sobreVerde else c.apagado, modifier = Modifier.size(20.dp)) }
                }
            }
        }
    }
}

@Composable
private fun SelectorRazonamiento(r: Razonamiento, habilitado: Boolean, elegir: (String) -> Unit) {
    val c = Neltume.colores
    var abierto by remember { mutableStateOf(false) }
    val etiqueta = NIVELES_RAZONAMIENTO.firstOrNull { it.first == r.nivel }?.second ?: "Rápido"
    Box {
        Row(
            Modifier
                .clip(Radios.pildora)
                .background(c.tonal)
                .clickable(enabled = habilitado) { abierto = true }
                .padding(horizontal = 12.dp, vertical = 8.dp)
                .semantics { contentDescription = "Razonamiento: $etiqueta" },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Iconos.Destellos, null, tint = c.tintaSuave, modifier = Modifier.size(15.dp))
            Spacer(Modifier.width(6.dp))
            Text("Razonamiento · $etiqueta", style = MaterialTheme.typography.labelMedium, color = c.tintaSuave)
        }
        DropdownMenu(abierto, { abierto = false }) {
            NIVELES_RAZONAMIENTO.forEach { (nivel, nombre) ->
                DropdownMenuItem(
                    text = { Text(nombre + if (nivel == r.predeterminado) " (predeterminado)" else "") },
                    onClick = {
                        abierto = false
                        elegir(nivel)
                    },
                    trailingIcon = { if (nivel == r.nivel) Icon(Iconos.Check, null, tint = c.verde) },
                )
            }
        }
    }
}
