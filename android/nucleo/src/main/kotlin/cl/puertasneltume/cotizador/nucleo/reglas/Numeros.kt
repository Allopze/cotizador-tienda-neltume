package cl.puertasneltume.cotizador.nucleo.reglas

import java.math.BigDecimal
import java.math.RoundingMode
import kotlin.math.abs
import kotlin.math.floor

/**
 * Números en formato chileno, igual que `Intl.NumberFormat('es-CL')` de la web: punto de miles (también en cuatro
 * cifras: «1.500»), coma decimal y redondeo «half-expand» sobre la representación decimal más corta del número.
 * No se usa el `Locale` del teléfono: sus datos regionales cambian entre versiones de Android.
 */
object NumerosCL {
    fun formatear(n: Double, minimoDecimales: Int = 0, maximoDecimales: Int = 0, agrupar: Boolean = true): String {
        if (n.isNaN()) return "NaN"
        if (n.isInfinite()) return if (n > 0) "∞" else "-∞"
        var decimal = BigDecimal(jsTexto(n)).setScale(maximoDecimales, RoundingMode.HALF_UP)
        decimal = decimal.stripTrailingZeros()
        if (decimal.scale() < minimoDecimales) decimal = decimal.setScale(minimoDecimales)
        if (decimal.scale() < 0) decimal = decimal.setScale(0)
        val negativo = decimal.signum() < 0
        val texto = decimal.abs().toPlainString()
        val entero = texto.substringBefore('.')
        val fraccion = texto.substringAfter('.', "")
        val conMiles = if (agrupar) agruparMiles(entero) else entero
        return (if (negativo) "-" else "") + conMiles + (if (fraccion.isNotEmpty()) ",$fraccion" else "")
    }

    fun agruparMiles(entero: String): String {
        if (entero.length <= 3) return entero
        val sb = StringBuilder()
        val primero = entero.length % 3
        if (primero > 0) sb.append(entero, 0, primero)
        var i = primero
        while (i < entero.length) {
            if (sb.isNotEmpty()) sb.append('.')
            sb.append(entero, i, i + 3)
            i += 3
        }
        return sb.toString()
    }
}

/**
 * Texto de un número como `String(n)` de JavaScript: 2 → «2», 0.8 → «0.8». Basta para las medidas y porcentajes de
 * la app (sin notación científica: los valores van de milésimas a miles de millones).
 */
fun jsTexto(n: Double): String {
    if (n == floor(n) && abs(n) < 1e15) return n.toLong().toString()
    return BigDecimal(n.toString()).stripTrailingZeros().toPlainString()
}

/** «$1.547.768» (`pesos` de src/negocio/precios.ts). */
fun pesos(n: Long): String = "$" + NumerosCL.formatear(n.toDouble())

fun pesos(n: Double): String = "$" + NumerosCL.formatear(n)

/** «19 %», «2,5 %» (`porcentaje`). */
fun porcentaje(n: Double): String = NumerosCL.formatear(n, maximoDecimales = 2) + " %"

/** «19 %» desde la fracción 0,19 (`porcentajeIva`). */
fun porcentajeIva(iva: Double = REGLAS_IVA): String = NumerosCL.formatear(iva * 100, maximoDecimales = 2) + " %"

/** «19%»: el IVA sin espacio, como lo muestra el panel (`iva` de src/app/formato.ts). */
fun ivaTexto(iva: Double? = null): String = porcentajeIva(iva ?: REGLAS_IVA).replace(Regex("""\s+%"""), "%")

/** Porcentaje sin espacio («2,5%», `pct`). */
fun pct(n: Double): String = porcentaje(n).replace(Regex("""\s+%"""), "%")

/** «0,835», «2,40»: metros con dos o tres decimales (`metrosTexto` de src/catalogo/escalones.ts). */
fun metrosTexto(n: Double): String = NumerosCL.formatear(n, minimoDecimales = 2, maximoDecimales = 3)

/** Número para un campo editable, con coma decimal y sin miles: 0.8 → «0,8» (`decimalCampo`). */
fun decimalCampo(n: Double): String = NumerosCL.formatear(n, maximoDecimales = 4, agrupar = false)

/** IVA de las reglas iniciales (`REGLAS.iva`). */
const val REGLAS_IVA = 0.19
