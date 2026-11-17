package cl.puertasneltume.cotizador.nucleo.reglas

import cl.puertasneltume.cotizador.nucleo.modelo.Producto
import kotlin.math.abs

/** Límites de las reglas comerciales (src/negocio/limites.ts). */
object Limites {
    const val DESCUENTO_MAXIMO = 50.0
    const val LARGO_OBSERVACION_ITEM = 1000
    const val MARGEN_MIN = -0.5
    const val MARGEN_MAX = 5.0
    const val AJUSTE_MIN = -0.5
    const val AJUSTE_MAX = 1.0
    const val ANTICIPO_MINIMO = 0.5
    const val ANTICIPO_TEXTO = "50 %"
    const val LARGO_MENSAJE = 6000
    const val AVISO_LARGO_MENSAJE = 5000
    const val CANTIDAD_MAXIMA = 10000

    data class RangoMedida(val min: Double, val max: Double)

    fun rangoMedidas(familia: String) = RangoMedida(0.3, if (familia == "PUERTA") 3.0 else 6.0)

    /** El ancho siempre con el rango de puertas; el alto o largo, con el de su familia. */
    fun rangoCampoMedida(campo: CampoMedida, familia: String) =
        rangoMedidas(if (campo == CampoMedida.ANCHO) "PUERTA" else familia)

    private fun coma(n: Double) = jsTexto(n).replace('.', ',')

    /** «entre 0,3 y 3 m». */
    fun textoRangoMedida(campo: CampoMedida, familia: String): String {
        val r = rangoCampoMedida(campo, familia)
        return "entre ${coma(r.min)} y ${coma(r.max)} m"
    }

    /** El único texto para una medida ilegible o fuera de rango. */
    fun errorMedida(campo: CampoMedida, familia: String): String {
        val rango = textoRangoMedida(campo, familia)
        if (campo == CampoMedida.ANCHO)
            return "Indica un ancho $rango: en metros (0,80), centímetros (80 cm) o milímetros (800 mm)."
        return if (familia == "PUERTA")
            "Indica un alto $rango: en metros (2,10), centímetros (210 cm) o milímetros (2100 mm)."
        else "Indica un largo $rango: en metros (3,60), centímetros (360 cm) o milímetros (3600 mm)."
    }

    /** «−50 % a 500 %». */
    const val RANGO_MARGEN = "−50 % a 500 %"

    data class RangoPrecio(val min: Double, val max: Double)

    fun rangoPrecio(costo: Double) = RangoPrecio(costo * (1 + MARGEN_MIN), costo * (1 + MARGEN_MAX))

    fun precioEnRango(precio: Double, costo: Double) = rangoPrecio(costo).let { precio >= it.min && precio <= it.max }

    fun bajoElCosto(precio: Double, costo: Double) = precio < costo

    fun descuentoValido(d: Double, maximo: Double = DESCUENTO_MAXIMO) =
        d.isFinite() && d >= 0 && d <= maximo && conDosDecimales(d)

    fun margenValido(m: Double) = m.isFinite() && m >= MARGEN_MIN && m <= MARGEN_MAX && conDosDecimales(m * 100)

    fun cantidadValida(n: Int?) = n != null && n in 1..CANTIDAD_MAXIMA
}

enum class CampoMedida { ANCHO, ALTO }

/**
 * Convierte a metros según la familia (`metros` de src/catalogo/resolver.ts): hasta 10 son metros; sobre eso,
 * centímetros hasta el tope de la familia y milímetros hasta mil veces el tope. null si queda fuera de rango.
 */
fun metros(n: Double, familia: String = "PUERTA"): Double? {
    if (!n.isFinite() || n <= 0) return null
    val rango = Limites.rangoMedidas(familia)
    val m = when {
        n <= 10 -> n
        n <= rango.max * 100 -> n / 100
        n <= rango.max * 1000 -> n / 1000
        else -> Double.NaN
    }
    return if (m >= rango.min - 1e-9 && m <= rango.max + 1e-9) m else null
}

/** Mismo producto de catálogo, comparado por código (`Producto` no trae id). */
internal fun Producto.mismo(otro: Producto) = codigo == otro.codigo

internal fun casiIgual(a: Double, b: Double) = abs(a - b) < 1e-9
