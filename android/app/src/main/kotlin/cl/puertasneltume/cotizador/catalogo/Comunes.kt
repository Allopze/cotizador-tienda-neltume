package cl.puertasneltume.cotizador.catalogo

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import cl.puertasneltume.cotizador.Contenedor
import cl.puertasneltume.cotizador.cotizar.DialogoConfirmacion
import cl.puertasneltume.cotizador.diseno.Aviso
import cl.puertasneltume.cotizador.diseno.BotonTexto
import cl.puertasneltume.cotizador.diseno.ChipFiltro
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Radios
import cl.puertasneltume.cotizador.diseno.Rotulo
import cl.puertasneltume.cotizador.diseno.TonoAviso
import cl.puertasneltume.cotizador.nucleo.modelo.Producto
import cl.puertasneltume.cotizador.nucleo.modelo.ReglasComerciales
import cl.puertasneltume.cotizador.nucleo.reglas.NumerosCL
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.json.JsonObject
import java.text.Normalizer
import java.util.Locale

// Piezas que comparten las secciones del catálogo.

/** Familias del catálogo con su nombre visible: las claves internas («PIEZAS_T») no se muestran (src/catalogo/familias.ts). */
internal val FAMILIAS_CATALOGO = listOf("PUERTA" to "Puerta", "MARCO" to "Marco", "PIEZAS_T" to "Piezas T", "MOLDURA" to "Moldura")

internal fun etiquetaFamilia(familia: String) = FAMILIAS_CATALOGO.firstOrNull { it.first == familia }?.second ?: familia

internal val ES_CL: Locale = Locale.forLanguageTag("es-CL")

/** «1.234»: cantidades como `Intl.NumberFormat('es-CL')`. */
internal fun cantidad(n: Int) = NumerosCL.formatear(n.toDouble())

/** Sin tildes y en mayúsculas, para comparar lo escrito con los nombres del catálogo. */
internal fun plana(s: String) = Normalizer.normalize(s, Normalizer.Form.NFD).replace(Regex("[\\u0300-\\u036f]"), "").uppercase()

/** `POST /api/catalogo` con la respuesta tipada; `larga` para el alta con el asistente (espera hasta 130 s). */
internal suspend fun <T> Contenedor.pedirCatalogo(estrategia: DeserializationStrategy<T>, cuerpo: JsonObject, larga: Boolean = false): T =
    http.enviar(estrategia, "api/catalogo", cuerpo, largo = larga)

/** Ancho cómodo de lectura en tablet: el contenido se centra y el resto queda de margen. */
private val ANCHO_LECTURA = 760.dp

/** Margen lateral para que el contenido no pase del ancho de lectura (16 dp en el teléfono). */
@Composable
internal fun ConMargenLateral(contenido: @Composable (lado: Dp) -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val lado = maxOf(16.dp, (maxWidth - ANCHO_LECTURA) / 2)
        contenido(lado)
    }
}

/** «Texto con **negrita**»: lo que la web marca con <strong>. */
internal fun conNegrita(texto: String): AnnotatedString = buildAnnotatedString {
    texto.split("**").forEachIndexed { i, parte ->
        if (i % 2 == 1) withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(parte) } else append(parte)
    }
}

/** Párrafo de introducción de cada sección (`catalog-modal-intro`). */
@Composable
internal fun Introduccion(texto: String, modifier: Modifier = Modifier) {
    Text(conNegrita(texto), modifier, style = MaterialTheme.typography.bodyMedium, color = Neltume.colores.tintaSuave)
}

/** Texto apagado, como `muted` en la web. */
@Composable
internal fun Apagado(texto: String, modifier: Modifier = Modifier) {
    Text(texto, modifier, style = MaterialTheme.typography.bodySmall, color = Neltume.colores.apagado)
}

/** Espera de una carga, con su texto («Cargando catálogo…»). */
@Composable
internal fun Cargando(texto: String, modifier: Modifier = Modifier) {
    val c = Neltume.colores
    Row(modifier.fillMaxWidth().padding(vertical = 24.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(Modifier.size(20.dp), color = c.verde, strokeWidth = 2.dp)
        Spacer(Modifier.width(10.dp))
        Text(texto, style = MaterialTheme.typography.bodyMedium, color = c.apagado)
    }
}

/** Error de carga con «Reintentar», como en la web. */
@Composable
internal fun ErrorReintento(texto: String, alReintentar: () -> Unit, modifier: Modifier = Modifier) {
    Aviso(texto, modifier, TonoAviso.PELIGRO, accion = { BotonTexto("Reintentar", alReintentar, peligro = true) })
}

/** Selector del tipo de producto: una píldora por familia (`SelectorFamilia` de la web). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun SelectorFamilia(
    valor: String,
    alElegir: (String) -> Unit,
    modifier: Modifier = Modifier,
    etiqueta: String = "Tipo de producto",
    error: String? = null,
    habilitado: Boolean = true,
) {
    val c = Neltume.colores
    Column(modifier) {
        Rotulo(etiqueta, color = if (error != null) c.peligro else c.apagado)
        Spacer(Modifier.height(6.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            FAMILIAS_CATALOGO.forEach { (f, nombre) ->
                ChipFiltro(
                    nombre,
                    valor == f,
                    { if (habilitado) alElegir(f) },
                    Modifier
                        .alpha(if (habilitado) 1f else 0.5f)
                        .semantics {
                            role = Role.RadioButton
                            selected = valor == f
                        },
                )
            }
        }
        if (error != null) Text(error, Modifier.padding(top = 4.dp), style = MaterialTheme.typography.bodySmall, color = c.peligro)
    }
}

/** Bloque plegable (`<details>` de la web): título con flecha y el contenido debajo. */
@Composable
internal fun Desplegable(
    titulo: String,
    modifier: Modifier = Modifier,
    inicial: Boolean = false,
    contenido: @Composable ColumnScope.() -> Unit,
) {
    val c = Neltume.colores
    var abierto by rememberSaveable { mutableStateOf(inicial) }
    val giro by animateFloatAsState(if (abierto) 180f else 0f, label = "flecha")
    Column(modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp)
                .clip(Radios.md)
                .clickable { abierto = !abierto }
                .semantics {
                    role = Role.Button
                    heading()
                    stateDescription = if (abierto) "Desplegado" else "Plegado"
                }
                .padding(horizontal = 4.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(titulo, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, color = c.tinta)
            Icon(Iconos.Abajo, null, tint = c.apagado, modifier = Modifier.size(18.dp).rotate(giro))
        }
        AnimatedVisibility(abierto) {
            Column(Modifier.fillMaxWidth().padding(top = 4.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp), content = contenido)
        }
    }
}

/** Casilla con su texto; toda la fila responde al toque. */
@Composable
internal fun Casilla(texto: AnnotatedString, marcada: Boolean, alCambiar: (Boolean) -> Unit, modifier: Modifier = Modifier, habilitada: Boolean = true) {
    val c = Neltume.colores
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clip(Radios.md)
            .toggleable(marcada, enabled = habilitada, role = Role.Checkbox, onValueChange = alCambiar),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(
            marcada,
            onCheckedChange = null,
            enabled = habilitada,
            colors = CheckboxDefaults.colors(checkedColor = c.verde, checkmarkColor = c.sobreVerde, uncheckedColor = c.lineaFuerte),
        )
        Spacer(Modifier.width(10.dp))
        Text(texto, style = MaterialTheme.typography.bodyMedium, color = c.tinta)
    }
}

/** Lista con viñetas para los detalles de la vista previa. */
@Composable
internal fun Vineta(texto: String) {
    Text("• $texto", style = MaterialTheme.typography.bodySmall, color = Neltume.colores.tintaSuave)
}

/** Aviso al salir con datos a medias (`AVISO_SALIDA` del catálogo web). */
internal const val AVISO_SALIDA = "Hay cambios sin guardar en la configuración del catálogo. ¿Salir de todos modos?"

/**
 * Pregunta antes de salir de una sección con cambios sin guardar: con Atrás del sistema y con la flecha de la
 * barra. Devuelve la acción para la flecha.
 */
@Composable
internal fun GuardiaSalida(sucio: Boolean, salir: () -> Unit): () -> Unit {
    var preguntar by rememberSaveable { mutableStateOf(false) }
    BackHandler(enabled = sucio) { preguntar = true }
    if (preguntar) {
        DialogoConfirmacion("Cambios sin guardar", AVISO_SALIDA, "Salir sin guardar", peligro = true) { ok ->
            preguntar = false
            if (ok) salir()
        }
    }
    return { if (sucio) preguntar = true else salir() }
}

// --- Ganancia por categoría (src/negocio/precios.ts) ---------------------------------------------------------

private val DIACRITICOS = Regex("[\\u0300-\\u036f]")
private fun textoNormalizado(s: String) = Normalizer.normalize(s, Normalizer.Form.NFD).replace(DIACRITICOS, "").uppercase()

/**
 * Categoría de ganancia de un producto de catálogo (`categoriaMargen`). El orden importa: «MARA ENCHAPADA» es
 * enchapada, jamás Mara sólida.
 */
internal fun categoriaGanancia(p: Producto): String {
    val contexto = textoNormalizado("${p.modelo} ${p.tipo ?: ""} ${p.madera} ${p.descripcion}")
    val madera = textoNormalizado(p.madera).replace(Regex("\\s+"), " ").trim()
    if (p.familia == "PUERTA") {
        if ("PREPINTAD" in contexto) return "puertas_prepintadas"
        if ("ENCHAPAD" in contexto) return if ("MARA" in madera) "puertas_enchapadas_mara" else "otros"
        if ("OREGON" in madera) return "puertas_solidas_oregon"
        if ("MARA" in madera || "LENGA" in madera) return "puertas_solidas_mara_lenga"
        if ("RAULI" in madera) return "puertas_solidas_rauli"
        return "otros"
    }
    if (p.familia == "MARCO" && "FINGER" in madera) {
        val enchapado = "ENCHAP" in contexto && !Regex("SIN\\s*ENCHAP|DESNUD").containsMatchIn(contexto)
        return if (enchapado) "marcos_finger_enchapados" else "marcos_finger_sin_enchape"
    }
    if (p.familia == "MARCO" && !Regex("ENCHAP|PREPINT").containsMatchIn(contexto)) {
        if ("OREGON" in madera) return "marcos_solidos_oregon"
        if ("LENGA" in madera) return "marcos_solidos_lenga"
    }
    if (p.familia == "MARCO" || p.familia == "MOLDURA" || p.familia == "PIEZAS_T")
        return if (Regex("ENCHAP|PREPINT|FINGER").containsMatchIn(contexto)) "otros" else "accesorios_madera_solida"
    return "otros"
}

/** Ganancia de la categoría según las reglas vigentes (`margenProducto`). */
internal fun gananciaProducto(p: Producto, reglas: ReglasComerciales): Double {
    val margenes = reglas.margenes ?: return reglas.ajuste
    return margenes[categoriaGanancia(p)] ?: margenes["otros"] ?: reglas.ajuste
}

/** Precio de venta sin IVA con la misma fórmula que la cotización (`precioConMargen`). */
internal fun precioVenta(costo: Double, ganancia: Double): Long =
    Math.round(costo * (10000 + Math.round(ganancia * 10000)) / 10000)

/** Relleno del contenido de una sección. */
internal fun relleno(lado: Dp, arriba: Dp = 8.dp, abajo: Dp = 32.dp) = PaddingValues(start = lado, end = lado, top = arriba, bottom = abajo)
