package cl.puertasneltume.cotizador.nucleo.reglas

import kotlin.math.abs
import kotlin.math.roundToLong

// Lectura de cifras escritas por personas (src/negocio/cifras.ts). Devuelven Double.NaN donde la web da NaN.

/** `Number(texto)` de JavaScript para los casos que aparecen aquí: vacío es 0; lo no numérico, NaN. */
internal fun numeroJs(texto: String): Double {
    val t = texto.trim()
    if (t.isEmpty()) return 0.0
    return if (Regex("""^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$""").matches(t)) t.toDouble() else Double.NaN
}

/**
 * Cifra con separadores chilenos: el punto separa miles y la coma decimales, pero una coma seguida de exactamente
 * tres dígitos también es de miles: «45,990» = 45990, «45,99» = 45,99. Si aparecen ambos, el último es el decimal.
 */
fun interpretarCifra(cifra: String): Double {
    val c = cifra.replace(Regex("""\s"""), "")
    // En pesos no hay centavos: «350.00» es $350.000 con un cero de menos (auditoría BUG-035).
    if (Regex("""^\d{1,3}(?:\.\d{3})*\.0{1,2}$""").matches(c))
        return numeroJs(c.substring(0, c.lastIndexOf('.')).replace(".", "")) * 1000
    val miles = { grupos: List<String> -> grupos.drop(1).all { it.length == 3 } }
    if (c.contains('.') && c.contains(',')) {
        val decimal = if (c.lastIndexOf('.') > c.lastIndexOf(',')) '.' else ','
        val otro = if (decimal == '.') ',' else '.'
        return numeroJs(c.split(otro).joinToString("").replaceFirst(decimal, '.'))
    }
    for (sep in listOf(',', '.')) {
        if (!c.contains(sep)) continue
        val grupos = c.split(sep)
        if (miles(grupos)) return numeroJs(grupos.joinToString(""))
        return if (grupos.size == 2) numeroJs(grupos.joinToString(".")) else Double.NaN
    }
    return numeroJs(c)
}

/** Monto en pesos escrito con o sin «$», puntos de miles o espacios: «$15.000» → 15000. Vacío es 0. */
fun leerPesos(texto: String): Double {
    val limpio = texto.replace(Regex("""[$\s]"""), "")
    return if (limpio.isEmpty()) 0.0 else interpretarCifra(limpio)
}

/** Porcentaje con coma o punto decimal: «2,5», «2.5» y «2,5 %» → 2.5. Vacío es 0. */
fun leerPorcentaje(texto: String): Double {
    val limpio = texto.replace(Regex("""[%\s]"""), "").replaceFirst(',', '.')
    if (limpio.isEmpty()) return 0.0
    return if (Regex("""^\d+(?:\.\d+)?$""").matches(limpio)) limpio.toDouble() else Double.NaN
}

/** Porcentaje con signo opcional («-10», «−10,5 %»). Sin ningún dígito no es un número: NaN, nunca 0. */
fun leerPorcentajeConSigno(texto: String): Double {
    val limpio = texto.trim()
    val negativo = limpio.startsWith("-") || limpio.startsWith("−")
    val cuerpo = if (negativo) limpio.substring(1) else limpio
    if (!cuerpo.any { it.isDigit() }) return Double.NaN
    val n = leerPorcentaje(cuerpo)
    return if (negativo) -n else n
}

/** Hasta dos decimales, tolerando el error binario (2,3 × 100 = 229,999…). */
fun conDosDecimales(n: Double): Boolean = n.isFinite() && abs(Math.round(n * 100).toDouble() - n * 100) < 1e-6

/** Redondea a centésimas. */
fun aCentesimas(n: Double): Double = Math.round(n * 100) / 100.0

/** Margen (fracción) a cuatro decimales. */
fun redondearMargen(margen: Double): Double = Math.round(margen * 10000) / 10000.0 + 0.0

/** 42 → 0,42. */
fun porcentajeAMargen(porcentaje: Double): Double = redondearMargen(porcentaje / 100)

/** 0,07 → 7 (sin ruido binario). */
fun margenAPorcentaje(margen: Double): Double = Math.round(margen * 10000) / 100.0 + 0.0

/** Mensaje de error de una ganancia escrita en porcentaje (−50 %…500 %, dos decimales), o null. */
fun errorMargenTexto(texto: String): String? {
    val n = leerPorcentajeConSigno(texto)
    if (n.isNaN()) return "Escribe un número."
    if (n < Limites.MARGEN_MIN * 100 || n > Limites.MARGEN_MAX * 100)
        return "La ganancia debe estar entre ${jsTexto(Limites.MARGEN_MIN * 100)} y ${jsTexto(Limites.MARGEN_MAX * 100)} %."
    if (!conDosDecimales(n)) return "Usa como máximo dos decimales."
    return null
}

/** ¿Es un entero seguro de pesos? */
fun Double.aPesos(): Long? = if (isFinite() && this == Math.floor(this) && abs(this) < 9.0e15) roundToLong() else null
