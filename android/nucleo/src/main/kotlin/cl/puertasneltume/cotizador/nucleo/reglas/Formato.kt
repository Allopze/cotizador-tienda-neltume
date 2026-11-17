package cl.puertasneltume.cotizador.nucleo.reglas

import cl.puertasneltume.cotizador.nucleo.modelo.CambiosCotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.CampoCliente
import cl.puertasneltume.cotizador.nucleo.modelo.Cotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.EstadoCotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.Linea
import cl.puertasneltume.cotizador.nucleo.modelo.ResumenCotizacion
import java.text.Normalizer
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// Textos y formatos compartidos por todas las vistas (src/app/formato.ts): una sola forma de decir cada cosa.

const val SIN_NUMERO = "Sin número"
const val SIN_CLIENTE = "Cliente sin nombre"

/** plural(1, "ítem") → «1 ítem»; plural(2, "registro") → «2 registros». */
fun plural(n: Int, singular: String, varios: String = "${singular}s") = "$n ${if (n == 1) singular else varios}"

fun numeroCotizacion(numero: Int?) = if (numero != null && numero != 0) "N° $numero" else SIN_NUMERO

/** «Válida hasta el 12 de septiembre de 2026» o «Validez: 10 días hábiles». */
fun validez(q: Cotizacion?): String {
    val vence = q?.vence
    return if (!vence.isNullOrEmpty()) "Válida hasta el ${Fechas.larga(vence)}"
    else "Validez: ${q?.reglas?.vigenciaDiasHabiles ?: 10} días hábiles"
}

/** «Sin pagos», «Pago 50 %» o «Pagada»; null fuera de emitidas y aprobadas. */
fun estadoPago(r: ResumenCotizacion): String? {
    if (r.estado != EstadoCotizacion.EMITIDA && r.estado != EstadoCotizacion.APROBADA) return null
    val pagado = r.pagado ?: 0
    if (pagado <= 0) return "Sin pagos"
    if (r.total > 0 && pagado >= r.total) return "Pagada"
    return "Pago ${min(99, max(1, Math.round(r.porcentajePagado ?: 0.0).toInt()))} %"
}

private val MINUSCULAS = setOf("de", "del", "en", "con", "y", "la", "el")
private val ACENTOS = listOf(Regex("""\bOregon\b""") to "Oregón", Regex("""\bRauli\b""") to "Raulí")
private val ES_CL = java.util.Locale.forLanguageTag("es-CL")

/**
 * «HUILO HUILO PINO OREGON 0,80 A 0,85 MT X 2,1 MT» → «Huilo Huilo Pino Oregón 0,80 a 0,85 m × 2,1 m». Lo que no
 * viene en mayúsculas (productos agregados a mano) se deja como está.
 */
fun nombreProducto(s: String): String {
    if (s.contains(", ")) return s.split(", ").joinToString(", ") { nombreProducto(it) }
    val base = s.replace(Regex("""\([^)]*\)"""), "")
    if (base != base.uppercase(ES_CL)) return s
    var previo = ""
    val partes = Regex("""(\s+)""").let { re ->
        val lista = mutableListOf<String>()
        var i = 0
        re.findAll(s).forEach { m ->
            lista += s.substring(i, m.range.first)
            lista += m.value
            i = m.range.last + 1
        }
        lista += s.substring(i)
        lista
    }
    val texto = partes.mapIndexed { i, t ->
        if (t.isBlank()) return@mapIndexed t
        val numeroAntes = previo.any { it.isDigit() }
        val medidaAntes = numeroAntes || previo == "MT" || previo == "MTS"
        previo = t
        when {
            t.any { it.isDigit() } || !t.any { it.isLetter() } || t != t.uppercase(ES_CL) -> t
            t == "MT" || t == "MTS" -> "m"
            t == "X" && medidaAntes -> "×"
            t == "A" && numeroAntes -> "a"
            else -> {
                val bajo = t.lowercase(ES_CL)
                if (i > 0 && bajo in MINUSCULAS) bajo else bajo.replaceFirstChar { it.titlecase(ES_CL) }
            }
        }
    }.joinToString("")
    return ACENTOS.fold(texto) { acc, (re, bien) -> acc.replace(re, bien) }
}

/** «Calafquén Pino Oregón 1,00 a 1,05 m × 2 m» → «Calafquén Pino Oregón». */
fun sinMedida(s: String) = s.replace(Regex("""\s+\d[\s\S]*$"""), "").ifEmpty { s }

private fun largoTexto(n: Double) = NumerosCL.formatear(n, maximoDecimales = 2) + " m"

/** Medida de un producto: rango de ancho × alto en puertas, escuadría × largo en el resto. */
fun medidaProducto(
    familia: String,
    medida: String,
    largo: Double,
    anchoMin: Double?,
    anchoMax: Double?,
    altoMin: Double?,
    altoMax: Double?,
): String {
    if (familia != "PUERTA") return "$medida × ${largoTexto(largo)}"
    val ancho = if (anchoMin != null && anchoMax != null) "${largoTexto(anchoMin)}–${largoTexto(anchoMax)}"
    else medida.replace(" A ", "–")
    val alto = if (altoMin != null && altoMax != null && altoMin != altoMax) "${largoTexto(altoMin)}–${largoTexto(altoMax)}"
    else largoTexto(largo)
    return "$ancho × $alto"
}

private val DIVISOR_UNIDAD = mapOf(
    "m" to 1.0, "mt" to 1.0, "mts" to 1.0, "metro" to 1.0, "metros" to 1.0,
    "cm" to 100.0, "cms" to 100.0, "centimetro" to 100.0, "centimetros" to 100.0,
    "mm" to 1000.0, "milimetro" to 1000.0, "milimetros" to 1000.0,
)

/**
 * Lee una medida como se escribe: «80», «0,80», «0.80», «80 cm», «2100 mm», «2.100 mm» o «3,6 m». Sin unidad, como
 * en el chat: hasta 10 son metros y lo demás centímetros o milímetros según el tope de la familia. Devuelve metros;
 * null si está vacía, no se entiende o queda fuera del rango.
 */
fun leerMedida(texto: String, familia: String, campo: CampoMedida = CampoMedida.ALTO): Double? {
    val limpio = Normalizer.normalize(texto.trim().lowercase(), Normalizer.Form.NFD).replace(Regex("""[̀-ͯ]"""), "")
    val partes = Regex("""^(\d+(?:[.,]\d+)*)\s*([a-z]+)?\.?$""").find(limpio) ?: return null
    val cifra = partes.groupValues[1]
    val unidad = partes.groupValues[2].ifEmpty { null }
    val divisor = if (unidad != null) DIVISOR_UNIDAD[unidad] ?: return null else 1.0
    val miles = divisor > 1 && Regex("""^\d{1,3}(\.\d{3})+$""").matches(cifra)
    val numero = if (miles) cifra.replace(".", "") else cifra.replaceFirst(',', '.')
    if (!Regex("""^\d+(\.\d+)?$""").matches(numero)) return null
    val n = numero.toDouble()
    val rango = Limites.rangoCampoMedida(campo, familia)
    val valor = (if (unidad != null) n / divisor else metros(n, if (campo == CampoMedida.ANCHO) "PUERTA" else familia))
        ?: return null
    if (!valor.isFinite()) return null
    val redondeado = Math.round(valor * 10_000) / 10_000.0
    return if (redondeado >= rango.min - 1e-9 && redondeado <= rango.max + 1e-9) redondeado else null
}

val ETIQUETA_CAMPO = linkedMapOf(
    CampoCliente.NOMBRE to "Cliente",
    CampoCliente.RUT to "RUT",
    CampoCliente.GIRO to "Giro",
    CampoCliente.TELEFONO to "Teléfono",
    CampoCliente.DIRECCION to "Dirección",
    CampoCliente.COMUNA to "Ciudad / comuna",
    CampoCliente.PROYECTO to "Proyecto",
)

/** Medida exacta pedida, con (Hoja) o (Vano) solo cuando se indicó. */
fun medidaPedida(l: Linea): String? {
    if (!l.medidaSolicitada.isNullOrEmpty())
        return "Escuadría ${l.medidaSolicitada}${if (l.altoSolicitado != null && l.altoSolicitado != 0.0) " · ${metrosTexto(l.altoSolicitado)} m" else ""}${sufijoTipoMedida(l.tipoMedida)}"
    return dimensionesEnMilimetros(l.anchoSolicitado, l.altoSolicitado, l.tipoMedida)
}

/** «Referencia HUIL-O-3 · 0,80–0,85 × 2,10 m · siguiente medida del catálogo en ancho». */
fun referenciaCatalogo(l: Linea): String {
    val siguiente = listOfNotNull(
        "ancho".takeIf { l.anchoSolicitado != null && ajusteMedida(l.anchoSolicitado, l.producto, CampoMedida.ANCHO) == AjusteMedida.SIGUIENTE },
        (if (l.producto.familia == "PUERTA") "alto" else "largo").takeIf {
            l.altoSolicitado != null && ajusteMedida(l.altoSolicitado, l.producto, CampoMedida.ALTO) == AjusteMedida.SIGUIENTE
        },
    )
    return "Referencia ${l.producto.codigo} · ${medidaReferencia(l.producto)}" +
        if (siguiente.isNotEmpty()) " · siguiente medida del catálogo en ${siguiente.joinToString(" y ")}" else ""
}

/** «Creada por Ana · emitida por Luis»; varios pasos seguidos de la misma persona se juntan. */
fun autoria(creadaPor: String?, emitidaPor: String?, aprobadaPor: String?, anuladaPor: String?): String {
    val pasos = listOf("creada" to creadaPor, "emitida" to emitidaPor, "aprobada" to aprobadaPor, "anulada" to anuladaPor)
    val grupos = mutableListOf<Pair<String, MutableList<String>>>()
    for ((paso, quien) in pasos) {
        if (quien.isNullOrEmpty()) continue
        val ultimo = grupos.lastOrNull()
        if (ultimo?.first == quien) ultimo.second += paso else grupos += quien to mutableListOf(paso)
    }
    val texto = grupos.joinToString(" · ") { (quien, p) ->
        "${p.dropLast(1).joinToString(", ")}${if (p.size > 1) " y " else ""}${p.last()} por $quien"
    }
    return texto.replaceFirstChar { it.uppercase() }
}

private val DATO_CLIENTE = mapOf(
    "nombre" to "nombre", "rut" to "RUT", "giro" to "giro", "telefono" to "teléfono", "direccion" to "dirección",
    "comuna" to "comuna", "proyecto" to "proyecto",
)

/** «a», «a y b», «a, b y c». */
fun enumerar(partes: List<String>) =
    if (partes.size < 2) partes.firstOrNull() ?: "" else "${partes.dropLast(1).joinToString(", ")} y ${partes.last()}"

/** «Se agregó Marco Pino Oregón · Se actualizó el cliente (RUT)». */
fun resumenCambios(c: CambiosCotizacion?): String {
    if (c == null) return ""
    return (
        c.agregados.map { "Se agregó ${nombreProducto(it.descripcion)}" } +
            c.quitados.map { "Se quitó ${nombreProducto(it.descripcion)}" } +
            c.modificados.map { "Se actualizó ${nombreProducto(it.despues.descripcion)}" } +
            (if (c.cliente.isNotEmpty()) listOf("Se actualizó el cliente (${enumerar(c.cliente.map { DATO_CLIENTE[it] ?: it })})") else emptyList())
        ).joinToString(" · ")
}

/** Resumen en texto plano para pegar en un correo o WhatsApp (`resumenTexto`). */
fun resumenTexto(q: Cotizacion): String {
    val c = q.cliente
    val lineas = q.montos.lineas.map { l ->
        val d = l.descuentoItem
        if (conDescuentoItem(l) && d != null)
            "• ${l.cantidad} × ${nombreProducto(descripcionLinea(l))} (${l.producto.codigo}): ${pesos(l.precioUnitario)} c/u, descuento especial ${textoDescuentoItem(d)} → ${pesos(precioConDescuento(l))} c/u = ${pesos(l.total)} (ahorro ${pesos(ahorroLinea(l))})"
        else "• ${l.cantidad} × ${nombreProducto(descripcionLinea(l))} (${l.producto.codigo}): ${pesos(l.precioUnitario)} c/u = ${pesos(l.total)}"
    }.toMutableList()
    val (ahorro, subtotalOriginal) = resumenDescuentosItems(q.montos)
    if (q.montos.flete != 0L)
        lineas += "• ${cantidadFlete(q)} × ${descripcionFlete(q)}: ${pesos(unitarioFlete(q))} c/u = ${pesos(q.montos.flete)}"
    val partes = mutableListOf(
        "Cotización ${numeroCotizacion(q.numero)}",
        "Cliente: ${c.nombre?.takeIf { it.isNotEmpty() } ?: SIN_CLIENTE}",
    )
    listOf("RUT" to c.rut, "Giro" to c.giro, "Comuna" to c.comuna, "Proyecto" to c.proyecto, "Teléfono" to c.telefono)
        .forEach { (k, v) -> if (!v.isNullOrEmpty()) partes += "$k: $v" }
    partes += ""
    partes += lineas
    if (q.incompletos.isNotEmpty())
        partes += "(${plural(q.incompletos.size, "ítem pendiente", "ítems pendientes")} sin valorizar)"
    partes += ""
    if (ahorro != 0L) {
        partes += "Subtotal original: ${pesos(subtotalOriginal + q.montos.flete)}"
        partes += "Ahorro por descuentos especiales: −${pesos(ahorro)}"
    }
    if (q.montos.descuento != 0L || ahorro != 0L) partes += "Subtotal: ${pesos(q.montos.subtotal + q.montos.flete)}"
    if (q.montos.descuento != 0L)
        partes += "${etiquetaDescuento(q)} ${pct(q.montos.descuentoPorcentaje)}${if (q.montos.flete != 0L) " sobre productos" else ""}: −${pesos(q.montos.descuento)}"
    partes += "Neto: ${pesos(q.montos.neto)}"
    partes += "IVA ${ivaTexto(q.reglas?.iva)}: ${pesos(q.montos.iva)}"
    partes += "Total: ${pesos(q.montos.total)}"
    partes += "Valores puestos en fábrica. ${validez(q)}."
    if (!q.observaciones.isNullOrEmpty()) {
        partes += ""
        partes += "Observaciones: ${q.observaciones}"
    }
    return partes.joinToString("\n")
}

/** Tamaño de una referencia: «320 KB», «2,4 MB». */
fun tamanoReferencia(bytes: Long): String {
    val f = { n: Double -> NumerosCL.formatear(n, maximoDecimales = 1) }
    return if (bytes < 1024 * 1024) "${f(max(1.0, (bytes / 1024.0).roundToInt().toDouble()))} KB"
    else "${f(bytes / 1024.0 / 1024.0)} MB"
}

/** Normaliza para buscar: sin tildes, minúsculas y espacios simples. */
fun plano(s: String?) = Normalizer.normalize(s ?: "", Normalizer.Form.NFD)
    .replace(Regex("""[̀-ͯ]"""), "").lowercase().replace(Regex("""\s+"""), " ").trim()

/** «Huilo Huilo»: nombre de modelo o madera en tipo título (`bonito` de src/asistente/preguntas.ts). */
fun bonito(s: String): String = s.lowercase(ES_CL)
    .replace(Regex("""(^|\s)\S""")) { it.value.uppercase(ES_CL) }
    .replaceFirst("Rauli", "Raulí")
    .replaceFirst("Oregon", "Oregón")
