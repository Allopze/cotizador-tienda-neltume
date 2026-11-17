package cl.puertasneltume.cotizador.diseno

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cl.puertasneltume.cotizador.nucleo.modelo.EstadoCotizacion
import cl.puertasneltume.cotizador.nucleo.reglas.PASOS
import cl.puertasneltume.cotizador.nucleo.reglas.etiquetaEstado
import cl.puertasneltume.cotizador.nucleo.reglas.pesos
import kotlin.math.roundToLong

// --- Láminas ------------------------------------------------------------------------------------------------

/** Lámina blanca con borde suave y sombra leve: la «forma del taller» de la web (panel, radio 16). */
@Composable
fun Hoja(
    modifier: Modifier = Modifier,
    relleno: PaddingValues = PaddingValues(16.dp),
    color: Color = Neltume.colores.superficie,
    contenido: @Composable ColumnScope.() -> Unit,
) {
    val c = Neltume.colores
    Column(
        modifier
            .shadow(if (c.oscuro) 0.dp else 1.dp, Radios.xl, ambientColor = Color(0x14000000), spotColor = Color(0x14000000))
            .clip(Radios.xl)
            .background(color)
            .border(1.dp, c.linea, Radios.xl)
            .padding(relleno),
        content = contenido,
    )
}

/** Lámina tonal (hundida) para grupos dentro de una hoja, sin cajas anidadas con borde. */
@Composable
fun Bandeja(modifier: Modifier = Modifier, relleno: PaddingValues = PaddingValues(14.dp), contenido: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.clip(Radios.lg).background(Neltume.colores.panel).padding(relleno),
        content = contenido,
    )
}

// --- Botones ------------------------------------------------------------------------------------------------

private val ALTO_BOTON = 48.dp

/** Se hunde 1 dp al tocarlo, como la web. */
@Composable
private fun Modifier.hundir(interaccion: MutableInteractionSource): Modifier {
    val presionado by interaccion.collectIsPressedAsState()
    val desplazamiento by animateFloatAsState(if (presionado) 1f else 0f, tween(Movimiento.TOQUE), label = "hundir")
    return graphicsLayer { translationY = desplazamiento * density }
}

@Composable
private fun ContenidoBoton(texto: String, icono: ImageVector?, cargando: Boolean, colorCarga: Color) {
    if (cargando) {
        CircularProgressIndicator(Modifier.size(18.dp), color = colorCarga, strokeWidth = 2.dp)
        Spacer(Modifier.width(10.dp))
    } else if (icono != null) {
        Icon(icono, contentDescription = null, Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
    }
    Text(texto, maxLines = 1, overflow = TextOverflow.Ellipsis)
}

/** Acción principal: verde lleno. */
@Composable
fun BotonPrincipal(
    texto: String,
    alPulsar: () -> Unit,
    modifier: Modifier = Modifier,
    icono: ImageVector? = null,
    habilitado: Boolean = true,
    cargando: Boolean = false,
    peligro: Boolean = false,
) {
    val c = Neltume.colores
    val interaccion = remember { MutableInteractionSource() }
    Button(
        onClick = alPulsar,
        modifier = modifier.heightIn(min = ALTO_BOTON).hundir(interaccion),
        enabled = habilitado && !cargando,
        shape = Radios.lg,
        interactionSource = interaccion,
        colors = ButtonDefaults.buttonColors(
            containerColor = if (peligro) c.peligro else c.verde,
            contentColor = if (peligro) (if (c.oscuro) c.bosque else Color.White) else c.sobreVerde,
            disabledContainerColor = (if (peligro) c.peligro else c.verde).copy(alpha = 0.42f),
            disabledContentColor = c.sobreVerde.copy(alpha = 0.9f),
        ),
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
    ) { ContenidoBoton(texto, icono, cargando, c.sobreVerde) }
}

/** Acción secundaria: lámina blanca con borde. */
@Composable
fun BotonSecundario(
    texto: String,
    alPulsar: () -> Unit,
    modifier: Modifier = Modifier,
    icono: ImageVector? = null,
    habilitado: Boolean = true,
    cargando: Boolean = false,
    peligro: Boolean = false,
) {
    val c = Neltume.colores
    val interaccion = remember { MutableInteractionSource() }
    OutlinedButton(
        onClick = alPulsar,
        modifier = modifier.heightIn(min = ALTO_BOTON).hundir(interaccion),
        enabled = habilitado && !cargando,
        shape = Radios.lg,
        interactionSource = interaccion,
        border = BorderStroke(1.dp, if (peligro) c.peligro.copy(alpha = 0.5f) else c.lineaMedia),
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = c.superficie,
            contentColor = if (peligro) c.peligro else c.tinta,
            disabledContentColor = c.tinta.copy(alpha = 0.42f),
        ),
        contentPadding = PaddingValues(horizontal = 18.dp, vertical = 12.dp),
    ) { ContenidoBoton(texto, icono, cargando, c.tinta) }
}

/** Acción discreta: solo texto verde. */
@Composable
fun BotonTexto(
    texto: String,
    alPulsar: () -> Unit,
    modifier: Modifier = Modifier,
    icono: ImageVector? = null,
    habilitado: Boolean = true,
    peligro: Boolean = false,
) {
    val c = Neltume.colores
    TextButton(
        onClick = alPulsar,
        modifier = modifier.heightIn(min = 44.dp),
        enabled = habilitado,
        shape = Radios.lg,
        colors = ButtonDefaults.textButtonColors(contentColor = if (peligro) c.peligro else c.verde),
    ) { ContenidoBoton(texto, icono, false, c.verde) }
}

/** Botón de solo ícono, con nombre accesible. */
@Composable
fun BotonIcono(
    icono: ImageVector,
    descripcion: String,
    alPulsar: () -> Unit,
    modifier: Modifier = Modifier,
    habilitado: Boolean = true,
    tono: Color = Neltume.colores.tintaSuave,
    fondo: Color = Color.Transparent,
) {
    Box(
        modifier
            .size(44.dp)
            .clip(CircleShape)
            .background(fondo)
            .clickable(enabled = habilitado, onClick = alPulsar)
            .semantics { contentDescription = descripcion },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icono, contentDescription = null, tint = if (habilitado) tono else tono.copy(alpha = 0.35f), modifier = Modifier.size(20.dp))
    }
}

// --- Píldoras -----------------------------------------------------------------------------------------------

/** Píldora de estado de una cotización (cotizacion.css: velo + texto del mismo tono + borde). */
@Composable
fun PildoraEstado(estado: EstadoCotizacion, modifier: Modifier = Modifier, vencida: Boolean = false) {
    val c = Neltume.colores
    val (fondo, texto) = when {
        vencida -> c.ambarFondo to c.ambarTexto
        estado == EstadoCotizacion.EMITIDA -> c.pizarraVelo to c.pizarra
        estado == EstadoCotizacion.APROBADA -> c.verdeVelo to c.verde
        estado == EstadoCotizacion.REEMPLAZADA -> c.calidoVelo to c.calidoTexto
        estado == EstadoCotizacion.ANULADA -> c.peligroVelo to c.peligro
        else -> c.tonalFuerte to c.tintaSuave
    }
    Pildora(if (vencida) "Vencida" else etiquetaEstado.getValue(estado), fondo, texto, modifier)
}

@Composable
fun Pildora(texto: String, fondo: Color, color: Color, modifier: Modifier = Modifier, icono: ImageVector? = null) {
    Row(
        modifier
            .clip(Radios.pildora)
            .background(fondo)
            .border(1.dp, color.copy(alpha = 0.24f), Radios.pildora)
            .padding(horizontal = 10.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icono != null) {
            Icon(icono, null, tint = color, modifier = Modifier.size(13.dp))
            Spacer(Modifier.width(5.dp))
        }
        Text(texto, style = MaterialTheme.typography.labelMedium, color = color, maxLines = 1)
    }
}

/** Chip de filtro: seleccionado se llena de tinta (como los filtros del historial). */
@Composable
fun ChipFiltro(texto: String, seleccionado: Boolean, alPulsar: () -> Unit, modifier: Modifier = Modifier, contador: Int? = null) {
    val c = Neltume.colores
    val fondo by animateColorAsState(if (seleccionado) c.tinta else c.superficie, tween(Movimiento.RAPIDO), label = "chip")
    val tinta by animateColorAsState(if (seleccionado) c.papel else c.tinta, tween(Movimiento.RAPIDO), label = "chipTexto")
    Row(
        modifier
            .heightIn(min = 40.dp)
            .clip(Radios.pildora)
            .background(fondo)
            .border(1.dp, if (seleccionado) c.tinta else c.lineaMedia, Radios.pildora)
            .clickable(onClick = alPulsar)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(texto, style = MaterialTheme.typography.labelMedium.copy(fontSize = 14.sp), color = tinta)
        if (contador != null) {
            Spacer(Modifier.width(6.dp))
            Text("$contador", style = MaterialTheme.typography.labelSmall, color = tinta.copy(alpha = 0.7f))
        }
    }
}

// --- Firmas del taller --------------------------------------------------------------------------------------

/** Regla de carpintero bajo los títulos: trazo largo cada 40 dp y corto cada 8 dp. */
@Composable
fun ReglaCarpintero(modifier: Modifier = Modifier) {
    val c = Neltume.colores
    Canvas(modifier.fillMaxWidth().height(10.dp)) {
        val ancho = size.width
        drawLine(c.lineaMedia, Offset(0f, 0f), Offset(ancho, 0f), 1.dp.toPx())
        val corto = 8.dp.toPx()
        var x = 0f
        var i = 0
        while (x <= ancho) {
            val largo = i % 5 == 0
            drawLine(
                if (largo) c.lineaMedia else c.linea,
                Offset(x, 0f),
                Offset(x, if (largo) 10.dp.toPx() else 5.dp.toPx()),
                1.dp.toPx(),
            )
            x += corto
            i++
        }
    }
}

/** Veta de la barra lateral: bosque con anillos y líneas de madera muy tenues. */
fun Modifier.veta(colores: ColoresNeltume): Modifier = drawBehind {
    drawRect(colores.bosque)
    val anillos = 16.dp.toPx()
    var r = anillos
    val centro = Offset(size.width * 0.15f, size.height * 1.1f)
    val limite = size.width + size.height
    while (r < limite) {
        drawCircle(Color.White.copy(alpha = 0.022f), r, centro, style = Stroke(1.dp.toPx()))
        r += anillos
    }
    val paso = 24.dp.toPx()
    var x = -size.height
    while (x < size.width) {
        drawLine(Color.Black.copy(alpha = 0.13f), Offset(x, size.height), Offset(x + size.height * 0.12f, 0f), 1.dp.toPx())
        x += paso
    }
}

/** Colores de las maderas (globals.css). */
fun colorMadera(madera: String?): Color {
    val m = (madera ?: "").uppercase()
    return when {
        "OREGON" in m || "OREGÓN" in m -> Color(0xFFD9AD74)
        "LENGA" in m -> Color(0xFFCF9474)
        "MARA" in m -> Color(0xFF7D3A27)
        "RAUL" in m -> Color(0xFFA8654C)
        "FINGER" in m || "PINO" in m -> Color(0xFFE2C38F)
        "PREPINT" in m -> Color(0xFFEDEBE4)
        else -> Color(0xFFC9B79C)
    }
}

/** Muestra de madera: rectángulo de 18 × 12 con veta (madera.tsx). */
@Composable
fun MuestraMadera(madera: String?, modifier: Modifier = Modifier) {
    val color = colorMadera(madera)
    Canvas(modifier.size(18.dp, 12.dp)) {
        drawRoundRect(color, cornerRadius = CornerRadius(2.dp.toPx()))
        val y = size.height
        for (i in 1..3) {
            val alto = y * i / 4f
            drawLine(Color.Black.copy(alpha = 0.12f), Offset(0f, alto), Offset(size.width, alto + 1.dp.toPx() * (i % 2)), 0.6.dp.toPx())
        }
        drawRoundRect(Color.Black.copy(alpha = 0.18f), cornerRadius = CornerRadius(2.dp.toPx()), style = Stroke(0.6.dp.toPx()))
    }
}

/** Línea de los ocho pasos del pedido; el tramo hecho se llena de izquierda a derecha al aparecer. */
@Composable
fun LineaPasos(hechos: List<Boolean>, actual: Int, modifier: Modifier = Modifier, compacta: Boolean = false) {
    val c = Neltume.colores
    val avance = remember { Animatable(0f) }
    LaunchedEffect(actual) { avance.animateTo(actual.toFloat(), tween(420 + 70 * actual, easing = Movimiento.salida)) }
    val descripcion = if (actual >= PASOS.size) "Pedido completo" else "Paso ${actual + 1} de ${PASOS.size}: ${PASOS[actual]}"
    Canvas(
        modifier
            .fillMaxWidth()
            .height(if (compacta) 6.dp else 26.dp)
            .semantics { contentDescription = descripcion },
    ) {
        val n = PASOS.size
        if (compacta) {
            val hueco = 3.dp.toPx()
            val ancho = (size.width - hueco * (n - 1)) / n
            for (i in 0 until n) {
                val lleno = i < avance.value.roundToLong()
                drawRoundRect(
                    if (lleno) c.verde else c.lineaMedia,
                    topLeft = Offset(i * (ancho + hueco), 0f),
                    size = Size(ancho, size.height),
                    cornerRadius = CornerRadius(size.height / 2),
                )
            }
            return@Canvas
        }
        val radio = 11.dp.toPx()
        val paso = (size.width - radio * 2) / (n - 1)
        val y = size.height / 2
        drawLine(c.lineaMedia, Offset(radio, y), Offset(size.width - radio, y), 2.dp.toPx())
        val hasta = (avance.value.coerceAtMost((n - 1).toFloat())) * paso
        drawLine(c.verde, Offset(radio, y), Offset(radio + hasta, y), 2.dp.toPx())
        for (i in 0 until n) {
            val centro = Offset(radio + i * paso, y)
            when {
                hechos.getOrElse(i) { false } && i < avance.value + 0.5f -> {
                    drawCircle(c.verde, radio, centro)
                    val s = radio * 0.45f
                    drawLine(c.sobreVerde, Offset(centro.x - s, centro.y), Offset(centro.x - s * 0.25f, centro.y + s * 0.7f), 2.dp.toPx())
                    drawLine(c.sobreVerde, Offset(centro.x - s * 0.25f, centro.y + s * 0.7f), Offset(centro.x + s, centro.y - s * 0.6f), 2.dp.toPx())
                }
                i == actual -> {
                    drawCircle(c.verde.copy(alpha = 0.12f), radio + 4.dp.toPx(), centro)
                    drawCircle(c.superficie, radio, centro)
                    drawCircle(c.verde, radio, centro, style = Stroke(2.dp.toPx()))
                    drawCircle(c.verde, 4.dp.toPx(), centro)
                }
                else -> {
                    drawCircle(c.superficie, radio, centro)
                    drawCircle(c.lineaMedia, radio, centro, style = Stroke(1.5.dp.toPx()))
                }
            }
        }
    }
}

/** El total sube contando hasta su valor (450 ms), como en la web; con animaciones apagadas, salta. */
@Composable
fun TotalAnimado(monto: Long, modifier: Modifier = Modifier, estilo: TextStyle = MaterialTheme.typography.headlineMedium) {
    val animado = remember { Animatable(monto.toFloat()) }
    LaunchedEffect(monto) { animado.animateTo(monto.toFloat(), tween(Movimiento.TOTAL, easing = Movimiento.salida)) }
    Text(
        pesos(animado.value.roundToLong()),
        modifier.semantics { contentDescription = pesos(monto) },
        style = estilo,
        color = Neltume.colores.tinta,
        maxLines = 1,
    )
}

/** Tres puntos que laten mientras el asistente prepara la respuesta. */
@Composable
fun PuntosEspera(modifier: Modifier = Modifier, color: Color = Neltume.colores.apagado) {
    val transicion = rememberInfiniteTransition(label = "espera")
    Row(modifier.semantics { contentDescription = "Esperando respuesta" }, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        repeat(3) { i ->
            val alfa by transicion.animateFloat(
                initialValue = 0.25f,
                targetValue = 1f,
                animationSpec = infiniteRepeatable(tween(600, delayMillis = i * 160, easing = LinearEasing), RepeatMode.Reverse),
                label = "punto$i",
            )
            Box(Modifier.size(7.dp).graphicsLayer { alpha = alfa }.clip(CircleShape).background(color))
        }
    }
}

// --- Textos de pantalla -------------------------------------------------------------------------------------

/** Título de pantalla en serif con su regla de carpintero. */
@Composable
fun TituloPantalla(titulo: String, modifier: Modifier = Modifier, subtitulo: String? = null, accion: (@Composable RowScope.() -> Unit)? = null) {
    Column(modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(titulo, style = MaterialTheme.typography.headlineLarge, color = Neltume.colores.tinta, modifier = Modifier.semantics { heading() })
                if (subtitulo != null) Text(subtitulo, style = MaterialTheme.typography.bodySmall, color = Neltume.colores.apagado)
            }
            if (accion != null) Row(verticalAlignment = Alignment.CenterVertically, content = accion)
        }
        Spacer(Modifier.height(12.dp))
        ReglaCarpintero()
    }
}

/** Encabezado de una sección dentro de una hoja. */
@Composable
fun TituloSeccion(texto: String, modifier: Modifier = Modifier, detalle: String? = null) {
    Column(modifier) {
        Text(texto, style = MaterialTheme.typography.titleLarge, color = Neltume.colores.tinta, modifier = Modifier.semantics { heading() })
        if (detalle != null) Text(detalle, style = MaterialTheme.typography.bodySmall, color = Neltume.colores.apagado)
    }
}

/** Etiqueta pequeña sobre un dato («Total del pedido», «Pago recibido»). */
@Composable
fun Rotulo(texto: String, modifier: Modifier = Modifier, color: Color = Neltume.colores.apagado) {
    Text(texto, modifier, style = MaterialTheme.typography.labelMedium, color = color)
}

enum class TonoAviso { INFO, EXITO, ATENCION, PELIGRO }

/** Aviso en línea: información, éxito, atención o peligro. */
@Composable
fun Aviso(texto: String, modifier: Modifier = Modifier, tono: TonoAviso = TonoAviso.INFO, titulo: String? = null, accion: (@Composable () -> Unit)? = null) {
    val c = Neltume.colores
    val (fondo, color, icono) = when (tono) {
        TonoAviso.INFO -> Triple(c.pizarraVelo, c.pizarra, Iconos.Info)
        TonoAviso.EXITO -> Triple(c.verdeVelo, c.verde, Iconos.CirculoCheck)
        TonoAviso.ATENCION -> Triple(c.ambarFondo, c.ambarTexto, Iconos.Alerta)
        TonoAviso.PELIGRO -> Triple(c.peligroVelo, c.peligro, Iconos.Alerta)
    }
    Row(
        modifier.fillMaxWidth().clip(Radios.lg).background(fondo).padding(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(icono, null, tint = color, modifier = Modifier.padding(top = 2.dp).size(18.dp))
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            if (titulo != null) Text(titulo, style = MaterialTheme.typography.titleSmall, color = color)
            Text(texto, style = MaterialTheme.typography.bodySmall, color = if (tono == TonoAviso.INFO) c.tinta else color)
            if (accion != null) accion()
        }
    }
}

/** Pantalla o sección vacía: ícono en un círculo tonal, título y una acción. */
@Composable
fun EstadoVacio(icono: ImageVector, titulo: String, texto: String, modifier: Modifier = Modifier, accion: (@Composable () -> Unit)? = null) {
    val c = Neltume.colores
    Column(modifier.fillMaxWidth().padding(vertical = 32.dp, horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(64.dp).clip(CircleShape).background(c.verdePalido), contentAlignment = Alignment.Center) {
            Icon(icono, null, tint = c.verde, modifier = Modifier.size(28.dp))
        }
        Spacer(Modifier.height(16.dp))
        Text(titulo, style = MaterialTheme.typography.headlineSmall, color = c.tinta)
        Spacer(Modifier.height(6.dp))
        Text(texto, style = MaterialTheme.typography.bodyMedium, color = c.apagado, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        if (accion != null) {
            Spacer(Modifier.height(18.dp))
            accion()
        }
    }
}

/** Iniciales en un círculo cálido (la cuenta). */
@Composable
fun Avatar(nombre: String, modifier: Modifier = Modifier, tamano: Dp = 36.dp) {
    val c = Neltume.colores
    val iniciales = nombre.split(' ').filter { it.isNotBlank() }.take(2).joinToString("") { it.first().uppercase() }.ifEmpty { "?" }
    Box(modifier.size(tamano).clip(CircleShape).background(c.calido.copy(alpha = 0.85f)), contentAlignment = Alignment.Center) {
        Text(iniciales, style = MaterialTheme.typography.labelLarge.copy(fontFamily = Newsreader, fontWeight = FontWeight.W600), color = c.bosque)
    }
}

/** Fila clicable de una lista de ajustes o secciones: ícono, título, detalle y flecha. */
@Composable
fun FilaNavegable(
    titulo: String,
    alPulsar: () -> Unit,
    modifier: Modifier = Modifier,
    detalle: String? = null,
    icono: ImageVector? = null,
    final: (@Composable () -> Unit)? = null,
) {
    val c = Neltume.colores
    Row(
        modifier.fillMaxWidth().heightIn(min = 56.dp).clip(Radios.lg).clickable(onClick = alPulsar).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icono != null) {
            Box(Modifier.size(36.dp).clip(Radios.md).background(c.verdePalido), contentAlignment = Alignment.Center) {
                Icon(icono, null, tint = c.verde, modifier = Modifier.size(18.dp))
            }
            Spacer(Modifier.width(12.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(titulo, style = MaterialTheme.typography.titleSmall, color = c.tinta)
            if (detalle != null) Text(detalle, style = MaterialTheme.typography.bodySmall, color = c.apagado, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (final != null) final() else Icon(Iconos.Derecha, null, tint = c.apagado, modifier = Modifier.size(18.dp))
    }
}

/** Línea divisoria suave. */
@Composable
fun Divisor(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(Neltume.colores.lineaSuave))
}

/** Dato con su rótulo en columna. */
@Composable
fun Dato(rotulo: String, valor: String, modifier: Modifier = Modifier, destacado: Boolean = false) {
    Column(modifier) {
        Rotulo(rotulo)
        Text(
            valor,
            style = if (destacado) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyMedium,
            color = Neltume.colores.tinta,
        )
    }
}

/** Superficie de un elemento elegible (tarjeta de lista). */
@Composable
fun Tarjeta(alPulsar: (() -> Unit)?, modifier: Modifier = Modifier, contenido: @Composable ColumnScope.() -> Unit) {
    val c = Neltume.colores
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = Radios.xl,
        color = c.superficie,
        border = BorderStroke(1.dp, c.linea),
        onClick = alPulsar ?: {},
        enabled = alPulsar != null,
    ) { Column(Modifier.padding(16.dp), content = contenido) }
}

internal val FormaGlobo = RoundedCornerShape(14.dp, 14.dp, 4.dp, 14.dp)
internal val FormaGloboAsistente = RoundedCornerShape(4.dp, 14.dp, 14.dp, 14.dp)
