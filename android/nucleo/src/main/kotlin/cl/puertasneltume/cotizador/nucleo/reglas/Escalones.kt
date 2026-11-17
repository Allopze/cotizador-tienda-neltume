package cl.puertasneltume.cotizador.nucleo.reglas

import cl.puertasneltume.cotizador.nucleo.modelo.Producto
import cl.puertasneltume.cotizador.nucleo.modelo.TipoMedida
import kotlin.math.roundToLong

// Medidas de catálogo y descripciones (src/catalogo/escalones.ts y src/negocio/medidas.ts).

data class Escalon(val min: Double, val max: Double, val exacto: Boolean)

enum class AjusteMedida { EXACTO, RANGO, SIGUIENTE }

private const val HOLGURA = 0.005
const val LARGO_PIEZA = 3.0

private fun rango(min: Double?, max: Double?): Escalon? =
    if (min != null && max != null && min <= max + 1e-9) Escalon(min, max, max - min < 1e-9) else null

/** Rango de ancho o de alto del producto, o valor exacto (el alto cae al `largo`). */
fun escalon(p: Producto, campo: CampoMedida): Escalon? = when (campo) {
    CampoMedida.ANCHO -> rango(p.anchoMin, p.anchoMax)
    CampoMedida.ALTO -> rango(p.altoMin, p.altoMax) ?: Escalon(p.largo, p.largo, true)
}

fun vieneEnKit(familia: String) = familia == "MARCO" || familia == "PIEZAS_T"

fun esSetDeMarco(familia: String, tipo: String?) =
    familia == "MARCO" && Regex("""^SET\b""", RegexOption.IGNORE_CASE).containsMatchIn(tipo ?: "")

fun esKit(p: Producto) = vieneEnKit(p.familia) && (p.largo < LARGO_PIEZA || esSetDeMarco(p.familia, p.tipo))

private fun coma(n: Double) = jsTexto((n * 10000).roundToLong() / 10000.0).replace('.', ',')

/**
 * Descripción en el formato de la planilla («HUILO HUILO PINO OREGON 0,8 A 0,85 MT X 2,1 MT»). Con medidas pedidas,
 * esas medidas («… 0,80 MT X 2,10 MT»).
 */
fun describirProducto(p: Producto, ancho: Double? = null, alto: Double? = null): String {
    val madera = if (p.madera == "RAULI") "RAULÍ" else p.madera
    val anchoCatalogo = p.medida.split(" A ").joinToString(" A ") { v ->
        val n = numeroJs(v.replace(',', '.'))
        if (n.isFinite()) coma(if (n > 10) n / 100 else n) else v
    }
    val anchoTexto = if (ancho != null) metrosTexto(ancho) else anchoCatalogo
    val base = "${p.modelo.uppercase()} $madera ${if (p.familia == "PUERTA") anchoTexto else p.medida}"
    val altoMin = p.altoMin ?: p.largo
    val altoMax = p.altoMax ?: p.largo
    val altoTexto = when {
        alto != null -> metrosTexto(alto)
        altoMin == altoMax -> coma(p.largo)
        else -> "${coma(altoMin)} A ${coma(altoMax)}"
    }
    val largo = if (alto != null) metrosTexto(alto) else coma(p.largo)
    return when {
        p.familia == "PUERTA" -> "$base MT X $altoTexto MT"
        p.familia == "MOLDURA" -> "$base CM X $largo MT"
        esSetDeMarco(p.familia, p.tipo) -> "$base MM SET X $largo MT"
        esKit(p) -> "$base PULG KIT"
        else -> "$base PULG X $largo MT"
    }
}

private fun holgura(e: Escalon) = if (e.exacto) HOLGURA else 0.0

/** Nunca se baja de escalón: una medida pedida menor que la referencia significa que se usó la siguiente. */
fun ajusteMedida(valor: Double, p: Producto, campo: CampoMedida): AjusteMedida? {
    val e = escalon(p, campo) ?: return null
    if (valor < e.min - holgura(e) - 1e-9) return AjusteMedida.SIGUIENTE
    return if (e.exacto) AjusteMedida.EXACTO else AjusteMedida.RANGO
}

/** «0,90–0,95 × 2,40 m» o «2,60 m». */
fun medidaReferencia(p: Producto): String {
    fun texto(e: Escalon?) = e?.let { if (it.exacto) metrosTexto(it.min) else "${metrosTexto(it.min)}–${metrosTexto(it.max)}" }
    return listOfNotNull(texto(escalon(p, CampoMedida.ANCHO)), texto(escalon(p, CampoMedida.ALTO))).joinToString(" × ") + " m"
}

fun sufijoTipoMedida(tipo: TipoMedida?) = when (tipo) {
    TipoMedida.HOJA -> " (Hoja)"
    TipoMedida.VANO -> " (Vano)"
    else -> ""
}

private fun milimetros(m: Double) = (m * 1000).let { Math.round(it) }.toString()

/** «800 × 2100 mm (Hoja)». */
fun dimensionesEnMilimetros(ancho: Double?, alto: Double?, tipo: TipoMedida? = null): String? {
    if (ancho == null && alto == null) return null
    val medidas = if (ancho != null && alto != null) "${milimetros(ancho)} × ${milimetros(alto)} mm"
    else "${milimetros(ancho ?: alto!!)} mm"
    return medidas + sufijoTipoMedida(tipo)
}

/** Puertas con una medida pedida cuyo significado (hoja o vano) falta aclarar antes de emitir. */
fun indicesMedidaSinTipo(q: cl.puertasneltume.cotizador.nucleo.modelo.Cotizacion): List<Int> {
    val incompletos = q.incompletos.map { it.indice }.toSet()
    return q.montos.lineas.mapNotNull { linea ->
        val indice = linea.indice ?: return@mapNotNull null
        if (indice in incompletos || linea.producto.familia != "PUERTA") return@mapNotNull null
        if (q.solicitudes.getOrNull(indice)?.medidaPorDefecto == true) return@mapNotNull null
        if (linea.anchoSolicitado == null && linea.altoSolicitado == null) return@mapNotNull null
        val tipo = q.solicitudes.getOrNull(indice)?.tipoMedida ?: linea.tipoMedida
        if (tipo == TipoMedida.HOJA || tipo == TipoMedida.VANO) null else indice
    }
}
