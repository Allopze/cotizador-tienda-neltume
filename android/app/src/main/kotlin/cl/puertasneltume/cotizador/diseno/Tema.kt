package cl.puertasneltume.cotizador.diseno

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import cl.puertasneltume.cotizador.R

/**
 * Colores de la tienda: los tokens de src/app/globals.css (rediseño «forma del taller, verde de la tienda»). El tema
 * oscuro sale del bosque de la barra lateral.
 */
@Immutable
data class ColoresNeltume(
    val tinta: Color,
    val tintaSuave: Color,
    val apagado: Color,
    val papel: Color,
    val superficie: Color,
    val panel: Color,
    val tonal: Color,
    val tonalFuerte: Color,
    val linea: Color,
    val lineaSuave: Color,
    val lineaMedia: Color,
    val lineaFuerte: Color,
    val verde: Color,
    val verdeHover: Color,
    val sobreVerde: Color,
    val verdeVelo: Color,
    val verdePalido: Color,
    val calido: Color,
    val calidoTexto: Color,
    val calidoVelo: Color,
    val pizarra: Color,
    val pizarraVelo: Color,
    val ambarFondo: Color,
    val ambarTexto: Color,
    val pendiente: Color,
    val peligro: Color,
    val peligroVelo: Color,
    val bosque: Color,
    val bosque2: Color,
    val bosqueTinta: Color,
    val velo: Color,
    val oscuro: Boolean,
)

val ColoresClaros = ColoresNeltume(
    tinta = Color(0xFF1D2B24),
    tintaSuave = Color(0xFF4A5249),
    apagado = Color(0xFF5F665C),
    papel = Color(0xFFFAFAF6),
    superficie = Color(0xFFFFFFFF),
    panel = Color(0xFFF6F7F1),
    tonal = Color(0xFFF2F3EC),
    tonalFuerte = Color(0xFFE9EBE2),
    linea = Color(0xFFDEDFD5),
    lineaSuave = Color(0xFFE8EBE1),
    lineaMedia = Color(0xFFCDD0C4),
    lineaFuerte = Color(0xFF878E7F),
    verde = Color(0xFF2D4938),
    verdeHover = Color(0xFF1C3325),
    sobreVerde = Color(0xFFFFFFFF),
    verdeVelo = Color(0xFFE5ECE3),
    verdePalido = Color(0xFFEEF0E8),
    calido = Color(0xFFAA714D),
    calidoTexto = Color(0xFF83512E),
    calidoVelo = Color(0xFFF5E9DE),
    pizarra = Color(0xFF3D5A6C),
    pizarraVelo = Color(0xFFE3EBF0),
    ambarFondo = Color(0xFFFBEFD6),
    ambarTexto = Color(0xFF5E4312),
    pendiente = Color(0xFF8A6420),
    peligro = Color(0xFF963C32),
    peligroVelo = Color(0xFFF7E3DF),
    bosque = Color(0xFF17241C),
    bosque2 = Color(0xFF203127),
    bosqueTinta = Color(0xFFE4E8DE),
    velo = Color(0x6B17241C),
    oscuro = false,
)

val ColoresOscuros = ColoresNeltume(
    tinta = Color(0xFFE4E8DE),
    tintaSuave = Color(0xFFC3CBBF),
    apagado = Color(0xFFA2AD9F),
    papel = Color(0xFF111B15),
    superficie = Color(0xFF17241C),
    panel = Color(0xFF1B2A21),
    tonal = Color(0xFF203127),
    tonalFuerte = Color(0xFF283C30),
    linea = Color(0xFF2C4134),
    lineaSuave = Color(0xFF243629),
    lineaMedia = Color(0xFF3A5244),
    lineaFuerte = Color(0xFF6F8475),
    verde = Color(0xFFA6CBB1),
    verdeHover = Color(0xFFBFDCC7),
    sobreVerde = Color(0xFF0F2318),
    verdeVelo = Color(0xFF243F2E),
    verdePalido = Color(0xFF1D3326),
    calido = Color(0xFFD6A07B),
    calidoTexto = Color(0xFFE6B48F),
    calidoVelo = Color(0xFF3A2A1E),
    pizarra = Color(0xFFA9C6D8),
    pizarraVelo = Color(0xFF213440),
    ambarFondo = Color(0xFF3A2F17),
    ambarTexto = Color(0xFFF0D293),
    pendiente = Color(0xFFE2BC6E),
    peligro = Color(0xFFF0A196),
    peligroVelo = Color(0xFF3E2320),
    bosque = Color(0xFF0C140F),
    bosque2 = Color(0xFF15211A),
    bosqueTinta = Color(0xFFE4E8DE),
    velo = Color(0x99050A07),
    oscuro = true,
)

val LocalColores = staticCompositionLocalOf { ColoresClaros }

/** Acceso corto: `Neltume.colores.verde`. */
object Neltume {
    val colores: ColoresNeltume @Composable get() = LocalColores.current
}

// --- Tipografía ---------------------------------------------------------------------------------------------

private fun sans(peso: Int) = Font(
    R.font.host_grotesk,
    weight = FontWeight(peso),
    variationSettings = FontVariation.Settings(FontVariation.weight(peso)),
)

private fun serif(peso: Int) = Font(
    R.font.newsreader,
    weight = FontWeight(peso),
    variationSettings = FontVariation.Settings(FontVariation.weight(peso)),
)

/** Host Grotesk con el guion corregido: el de la web y los PDF. */
val HostGrotesk = FontFamily(sans(400), sans(500), sans(600), sans(700))

/** Newsreader: títulos y el total, como en la web. */
val Newsreader = FontFamily(serif(400), serif(500), serif(600))

/** Cifras tabulares en toda la app (montos alineados). */
private const val CIFRAS = "tnum"

private fun estilo(familia: FontFamily, tamano: Int, peso: Int, alto: Float, tracking: Float = 0f) = TextStyle(
    fontFamily = familia,
    fontSize = tamano.sp,
    fontWeight = FontWeight(peso),
    lineHeight = (tamano * alto).sp,
    letterSpacing = tracking.em,
    fontFeatureSettings = CIFRAS,
)

val TipografiaNeltume = Typography(
    displaySmall = estilo(Newsreader, 34, 500, 1.1f, -0.015f),
    headlineLarge = estilo(Newsreader, 30, 500, 1.12f, -0.015f),
    headlineMedium = estilo(Newsreader, 27, 500, 1.15f, -0.01f),
    headlineSmall = estilo(Newsreader, 22, 500, 1.2f),
    titleLarge = estilo(Newsreader, 21, 500, 1.25f),
    titleMedium = estilo(HostGrotesk, 16, 600, 1.4f),
    titleSmall = estilo(HostGrotesk, 14, 600, 1.4f),
    bodyLarge = estilo(HostGrotesk, 16, 400, 1.5f),
    bodyMedium = estilo(HostGrotesk, 15, 400, 1.5f),
    bodySmall = estilo(HostGrotesk, 13, 400, 1.45f),
    labelLarge = estilo(HostGrotesk, 15, 600, 1.3f),
    labelMedium = estilo(HostGrotesk, 13, 500, 1.3f, 0.01f),
    labelSmall = estilo(HostGrotesk, 12, 500, 1.3f, 0.02f),
)

/** Radios de la web: 3 / 6 / 8 / 12 / 16 y píldora. */
object Radios {
    val xs = RoundedCornerShape(3.dp)
    val sm = RoundedCornerShape(6.dp)
    val md = RoundedCornerShape(8.dp)
    val lg = RoundedCornerShape(12.dp)
    val xl = RoundedCornerShape(16.dp)
    val hoja = RoundedCornerShape(20.dp)
    val pildora = RoundedCornerShape(999.dp)
}

/** Movimiento de la web (globals.css): toque 100 ms, rápido 150, entrada 200, diálogo 280; salida «expo». */
object Movimiento {
    const val TOQUE = 100
    const val RAPIDO = 150
    const val ENTRADA = 200
    const val DIALOGO = 280
    const val TOTAL = 450
    const val RESALTE = 1100
    val salida = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)
    val entrada = CubicBezierEasing(0.4f, 0f, 1f, 1f)
}

@Composable
fun TemaNeltume(oscuro: Boolean = isSystemInDarkTheme(), contenido: @Composable () -> Unit) {
    val c = if (oscuro) ColoresOscuros else ColoresClaros
    val esquema = if (oscuro) darkColorScheme(
        primary = c.verde,
        onPrimary = c.sobreVerde,
        primaryContainer = c.verdeVelo,
        onPrimaryContainer = c.tinta,
        secondary = c.calido,
        onSecondary = c.bosque,
        secondaryContainer = c.tonalFuerte,
        onSecondaryContainer = c.tinta,
        tertiary = c.pizarra,
        background = c.papel,
        onBackground = c.tinta,
        surface = c.superficie,
        onSurface = c.tinta,
        surfaceVariant = c.tonal,
        onSurfaceVariant = c.tintaSuave,
        surfaceContainerLowest = c.papel,
        surfaceContainerLow = c.panel,
        surfaceContainer = c.superficie,
        surfaceContainerHigh = c.tonal,
        surfaceContainerHighest = c.tonalFuerte,
        outline = c.lineaFuerte,
        outlineVariant = c.linea,
        error = c.peligro,
        onError = c.bosque,
        errorContainer = c.peligroVelo,
        onErrorContainer = c.peligro,
        scrim = c.velo,
        inverseSurface = c.bosqueTinta,
        inverseOnSurface = c.bosque,
        inversePrimary = Color(0xFF2D4938),
    ) else lightColorScheme(
        primary = c.verde,
        onPrimary = c.sobreVerde,
        primaryContainer = c.verdeVelo,
        onPrimaryContainer = c.verdeHover,
        secondary = c.calido,
        onSecondary = Color.White,
        secondaryContainer = c.tonalFuerte,
        onSecondaryContainer = c.tinta,
        tertiary = c.pizarra,
        background = c.papel,
        onBackground = c.tinta,
        surface = c.superficie,
        onSurface = c.tinta,
        surfaceVariant = c.tonal,
        onSurfaceVariant = c.tintaSuave,
        surfaceContainerLowest = c.superficie,
        surfaceContainerLow = c.panel,
        surfaceContainer = c.superficie,
        surfaceContainerHigh = c.tonal,
        surfaceContainerHighest = c.tonalFuerte,
        outline = c.lineaFuerte,
        outlineVariant = c.linea,
        error = c.peligro,
        onError = Color.White,
        errorContainer = c.peligroVelo,
        onErrorContainer = c.peligro,
        scrim = c.velo,
        inverseSurface = c.bosque,
        inverseOnSurface = c.bosqueTinta,
        inversePrimary = Color(0xFFA6CBB1),
    )
    val formas = Shapes(
        extraSmall = Radios.sm,
        small = Radios.md,
        medium = Radios.lg,
        large = Radios.xl,
        extraLarge = Radios.hoja,
    )
    CompositionLocalProvider(LocalColores provides c) {
        MaterialTheme(colorScheme = esquema, typography = TipografiaNeltume, shapes = formas, content = contenido)
    }
}
