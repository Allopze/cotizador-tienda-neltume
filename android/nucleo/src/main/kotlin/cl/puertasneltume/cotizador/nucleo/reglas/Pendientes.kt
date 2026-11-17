package cl.puertasneltume.cotizador.nucleo.reglas

import cl.puertasneltume.cotizador.nucleo.modelo.Cotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.Rechazo
import cl.puertasneltume.cotizador.nucleo.modelo.SolicitudItem
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.text.Normalizer
import kotlin.math.abs

// Preguntas de los ítems pendientes (src/negocio/pendientes.ts). La app las responde con una edición directa, sin
// pasar por la IA: cada opción ya es un valor válido del campo.

enum class CampoPendiente(val clave: String, val etiqueta: String) {
    MODELO("modelo", "Modelo"),
    MADERA("madera", "Madera"),
    ANCHO("ancho", "Ancho"),
    ALTO("alto", "Alto o largo"),
    MEDIDA("medida", "Sección o escuadría"),
    CANTIDAD("cantidad", "Cantidad"),
    ;

    companion object {
        fun de(clave: String) = entries.firstOrNull { it.clave == clave }
    }
}

/** Una opción: texto, número (metros, cantidad) o una acción («intercambiar», «precioUnitario», «descuento»). */
data class OpcionPendiente(val etiqueta: String, val valor: Any, val sugerencia: String? = null)

data class Entrada(val min: Double, val max: Double, val paso: Double, val unidad: String?, val familia: String? = null)

data class PrefillAlta(
    val familia: String?,
    val modelo: String?,
    val madera: String?,
    val medida: String?,
    val anchoMin: Double?,
    val anchoMax: Double?,
    val largo: Double?,
)

data class PreguntaPendiente(
    val clave: String,
    val indices: List<Int>,
    val campo: CampoPendiente?,
    val etiqueta: String?,
    val texto: String,
    val detalle: String?,
    val opciones: List<OpcionPendiente>,
    val entrada: Entrada?,
    val alta: PrefillAlta?,
    val fueraDeLista: Boolean = false,
    val modeloNuevo: Boolean = false,
    val intercambio: Pair<Double, Double>? = null,
)

const val INTERCAMBIAR = "intercambiar"
private const val EXPLICA_ESCUADRIA = "Escuadría: grosor por ancho de la pieza."
private val CANTIDAD = Entrada(1.0, 10000.0, 1.0, null)

/** «HUILO HUILO» → «HUILOHUILO»: sin tildes, mayúsculas, solo letras y números (`normalizarCatalogo`). */
fun normalizarCatalogo(s: String) = Normalizer.normalize(s, Normalizer.Form.NFD)
    .replace(Regex("""[̀-ͯ]"""), "").uppercase().replace(Regex("[^A-Z0-9]"), "")

/** Forma canónica de una escuadría: «6 x 4.5» → «6X4,5» (`normalizarMedida`). */
fun normalizarMedida(s: String) = s.uppercase()
    .replace(Regex("[×*]"), "X")
    .replace(Regex("""\s"""), "")
    .replace(Regex("""PULGADAS?|PULG\.?|["”″]|''"""), "")
    .replace(Regex("""(\d)(?:MM|CM)\.?(?=X|$)"""), "$1")
    .replace(".", ",")

/** Clave que ignora el orden de los factores: «4x2» y «2X4» son la misma pieza. */
fun claveEscuadria(s: String): String {
    val m = normalizarMedida(s)
    val factores = m.split("X")
    if (factores.size != 2 || !factores.all { Regex("""^\d+(?:,\d+)?$""").matches(it) }) return m
    return factores.sortedBy { it.replace(',', '.').toDouble() }.joinToString("X")
}

private fun Rechazo.lista(): List<String> = (disponibles as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: emptyList()
private fun Rechazo.listaDe(campo: String): List<String> =
    ((disponibles as? JsonObject)?.get(campo) as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: emptyList()
private fun Rechazo.valorTexto(): String = (valor as? JsonPrimitive)?.contentOrNull ?: ""
private fun Rechazo.valorNumero(): Double? = (valor as? JsonPrimitive)?.doubleOrNull

/** Familia de un pedido especial según su rechazo, su nombre o su forma (`familiaEspecial`). */
fun familiaEspecial(r: Rechazo?, s: SolicitudItem? = null): String {
    r?.familia?.let { return it }
    val nombre = (s?.modelo ?: "").lowercase()
    if (Regex("""\bmarcos?\b""").containsMatchIn(nombre)) return "MARCO"
    if (Regex("""\bpiezas?\s*t\b""").containsMatchIn(nombre)) return "PIEZAS_T"
    if (Regex("guardapolvo|pilastra|endolado|moldura|cornisa|junquillo|tapajunta").containsMatchIn(nombre)) return "MOLDURA"
    return if (s != null && s.ancho == null && s.medida != null) "MOLDURA" else "PUERTA"
}

/** La única regla de familia de un ítem (`familiaItem`, sin el catálogo). */
fun familiaItem(s: SolicitudItem, cotizado: String? = null, rechazo: Rechazo? = null): String =
    s.personalizado?.familia ?: cotizado ?: rechazo?.familia ?: familiaEspecial(null, s)

private fun familiaDe(campo: CampoMedida, familia: String) = if (campo == CampoMedida.ANCHO) "PUERTA" else familia

private fun medidaLibre(familia: String, campo: CampoMedida): Entrada {
    val r = Limites.rangoMedidas(familiaDe(campo, familia))
    return Entrada(r.min, r.max, 0.005, "m", familia)
}

private fun cifras(textos: List<String>) = textos.flatMap { t ->
    Regex("""\d+(?:[.,]\d+)?""").findAll(t).map { it.value.replace(',', '.').toDouble() }.filter { it.isFinite() }
}

private fun rangoDe(textos: List<String>, familia: String, campo: CampoMedida, rango: cl.puertasneltume.cotizador.nucleo.modelo.Rango? = null): Entrada {
    val libre = medidaLibre(familia, campo)
    if (rango != null) return libre.copy(min = rango.min, max = rango.max)
    val valores = cifras(textos).mapNotNull { metros(it, familiaDe(campo, familia)) }
    return if (valores.isNotEmpty()) libre.copy(min = valores.min(), max = valores.max()) else libre
}

private fun opcionesTexto(valores: List<String>, formato: (String) -> String = { it }) =
    valores.map { OpcionPendiente(formato(it), it) }

private fun opcionesFueraDeRegla(s: SolicitudItem?) = buildList {
    if (s?.precioUnitario != null && s.personalizado == null) add(OpcionPendiente("Quitar el precio fijado a mano", "precioUnitario"))
    if (s?.descuento != null) add(OpcionPendiente("Quitar el descuento del ítem", "descuento"))
}

private fun opcionesMetros(valores: List<String>) =
    cifras(valores).distinct().sorted().map { OpcionPendiente("${metrosTexto(it)} m", it) }

private fun sinLista(pregunta: String) = pregunta
    .replace(Regex("""\s*(Opciones disponibles|Opciones|Modelos disponibles|Maderas disponibles):[\s\S]*$"""), "")
    .trim().ifEmpty { null }

private data class Parte(
    val campo: CampoPendiente?,
    val familia: String,
    val detalle: String?,
    val opciones: List<OpcionPendiente>,
    val entrada: Entrada?,
    val agrupable: Boolean,
    val intercambio: Pair<Double, Double>? = null,
    val fueraDeLista: Boolean = false,
)

private fun partes(r: Rechazo, pregunta: String, s: SolicitudItem?): List<Parte> {
    val familia = if (s != null) familiaItem(s, null, r) else familiaEspecial(r)
    fun parte(
        campo: CampoPendiente?,
        opciones: List<OpcionPendiente>,
        entrada: Entrada?,
        agrupable: Boolean = false,
        detalle: String? = sinLista(pregunta),
        intercambio: Pair<Double, Double>? = null,
        fueraDeLista: Boolean = false,
    ) = Parte(campo, familia, detalle, opciones, entrada, agrupable, intercambio, fueraDeLista)

    return when (r.tipo) {
        "faltan_datos" -> r.campos.map { c ->
            val disponibles = r.listaDe(c)
            when (c) {
                "precio" -> parte(null, opcionesFueraDeRegla(s), null)
                "modelo" -> parte(CampoPendiente.MODELO, opcionesTexto(disponibles, ::bonito), null, true, null)
                "madera" -> parte(CampoPendiente.MADERA, opcionesTexto(disponibles, ::bonito), null, true, null)
                "medida" -> parte(CampoPendiente.MEDIDA, opcionesTexto(disponibles), null, true, EXPLICA_ESCUADRIA)
                "alto" -> parte(CampoPendiente.ALTO, opcionesMetros(disponibles), null, true, null)
                "ancho" -> parte(CampoPendiente.ANCHO, emptyList(), rangoDe(disponibles, familia, CampoMedida.ANCHO), true, null)
                else -> parte(CampoPendiente.CANTIDAD, emptyList(), CANTIDAD, true, null)
            }
        }
        "modelo_desconocido" -> listOf(parte(CampoPendiente.MODELO, opcionesTexto(r.lista(), ::bonito), null, true))
        "modelo_posible" -> listOf(
            parte(CampoPendiente.MODELO, listOf(OpcionPendiente("Confirmar ${bonito(r.sugerido ?: "")}", r.sugerido ?: "")), null),
        )
        "madera_desconocida", "madera_no_disponible" ->
            listOf(parte(CampoPendiente.MADERA, opcionesTexto(r.lista(), ::bonito), null, true))
        "medida_no_disponible" -> when {
            r.campo == "medida" -> listOf(parte(CampoPendiente.MEDIDA, opcionesTexto(r.lista()), null, true))
            familia == "PUERTA" -> {
                val explicacion = sinLista(pregunta)
                listOf(
                    parte(
                        null,
                        emptyList(),
                        null,
                        true,
                        "${if (explicacion != null) "$explicacion " else ""}No es un dato faltante: esa combinación no está en la lista de precios de fábrica. Puedes cotizarla como pedido especial.",
                        fueraDeLista = true,
                    ),
                )
            }
            else -> {
                val campo = if (r.campo == "ancho") CampoMedida.ANCHO else CampoMedida.ALTO
                val esAlto = r.campo == "alto"
                listOf(
                    parte(
                        if (esAlto) CampoPendiente.ALTO else CampoPendiente.ANCHO,
                        if (esAlto && r.rango == null) opcionesMetros(r.lista()) else emptyList(),
                        if (esAlto && r.rango == null) null else rangoDe(r.lista(), familia, campo, r.rango),
                        true,
                    ),
                )
            }
        }
        "medida_implausible" -> {
            val campo = if (r.campo == "ancho") CampoMedida.ANCHO else CampoMedida.ALTO
            listOf(parte(if (r.campo == "ancho") CampoPendiente.ANCHO else CampoPendiente.ALTO, emptyList(), medidaLibre(familia, campo), true))
        }
        "cantidad_invalida" -> listOf(parte(CampoPendiente.CANTIDAD, emptyList(), CANTIDAD, true))
        "medidas_invertidas" -> {
            val ancho = r.ancho ?: 0.0
            val alto = r.alto ?: 0.0
            listOf(
                parte(
                    null,
                    listOf(OpcionPendiente("Intercambiar: ${metrosTexto(alto)} m de ancho × ${metrosTexto(ancho)} m de alto", INTERCAMBIAR)),
                    null,
                    detalle = pregunta,
                    intercambio = alto to ancho,
                ),
            )
        }
        else -> listOf(parte(null, emptyList(), null, detalle = pregunta))
    }
}

private fun prefillAlta(s: SolicitudItem?, r: Rechazo?): PrefillAlta? {
    if (s == null || r == null) return null
    val familiaRechazo = familiaItem(s, null, r)
    val permite = r.tipo in setOf("modelo_desconocido", "modelo_posible", "madera_desconocida", "madera_no_disponible") ||
        (r.tipo == "medida_no_disponible" && (r.campo == "medida" || familiaRechazo != "PUERTA"))
    if (!permite) return null
    val familia = r.familia?.takeIf { it != "OTRO" }
    val ancho = if (familia == "PUERTA" && s.ancho != null) metros(s.ancho, "PUERTA") else null
    return PrefillAlta(
        familia = familia,
        modelo = if (r.tipo == "modelo_posible") r.valorTexto() else s.modelo,
        madera = s.madera,
        medida = if (familia == "PUERTA") null else s.medida,
        anchoMin = ancho,
        anchoMax = ancho,
        largo = if (s.alto != null) metros(s.alto, familia ?: familiaItem(s, null, r)) else null,
    )
}

private fun valorDe(s: SolicitudItem, campo: CampoPendiente): Any? = when (campo) {
    CampoPendiente.MODELO -> s.modelo
    CampoPendiente.MADERA -> s.madera
    CampoPendiente.ANCHO -> s.ancho
    CampoPendiente.ALTO -> s.alto
    CampoPendiente.MEDIDA -> s.medida
    CampoPendiente.CANTIDAD -> s.cantidad
}

private fun numero(v: Any) = when (v) {
    is Number -> v.toDouble()
    else -> numeroJs(v.toString())
}

private fun igual(campo: CampoPendiente, a: Any, b: Any, familia: String): Boolean = when (campo) {
    CampoPendiente.ANCHO, CampoPendiente.ALTO -> {
        val f = familiaDe(if (campo == CampoPendiente.ANCHO) CampoMedida.ANCHO else CampoMedida.ALTO, familia)
        abs((metros(numero(a), f) ?: numero(a)) - (metros(numero(b), f) ?: numero(b))) < 5e-4
    }
    CampoPendiente.MEDIDA -> claveEscuadria(a.toString()) == claveEscuadria(b.toString())
    else -> normalizarCatalogo(a.toString()) == normalizarCatalogo(b.toString())
}

private const val MAX_ITEMS_NOMBRADOS = 6

/** «el ítem 2», «los ítems 1, 3 y 4» o «12 ítems: 1, 2, 3, 4, 5 y 7 más». */
fun listaItems(indices: List<Int>): String {
    val n = indices.map { (it + 1).toString() }
    if (n.size == 1) return "el ítem ${n[0]}"
    if (n.size <= MAX_ITEMS_NOMBRADOS) return "los ítems ${n.dropLast(1).joinToString(", ")} y ${n.last()}"
    val primeros = MAX_ITEMS_NOMBRADOS - 1
    return "${n.size} ítems: ${n.take(primeros).joinToString(", ")} y ${n.size - primeros} más"
}

private fun sugerir(q: Cotizacion, indices: List<Int>, parte: Parte): List<OpcionPendiente> {
    val campo = parte.campo ?: return parte.opciones
    if (campo == CampoPendiente.CANTIDAD || campo == CampoPendiente.MODELO) return parte.opciones
    if (campo == CampoPendiente.MADERA && indices.any { q.solicitudes.getOrNull(it)?.madera != null }) return parte.opciones
    val primero = indices.min()
    val otros = q.solicitudes.mapIndexed { i, s -> i to valorDe(s, campo) }
        .filter { (i, v) -> i !in indices && v != null }
        .sortedBy { (i, _) -> if (i < primero) primero - i else 1000 + i }
    for ((i, valor) in otros) {
        val sugerencia = "Como el ítem ${i + 1}"
        if (parte.opciones.isNotEmpty()) {
            val opcion = parte.opciones.firstOrNull { igual(campo, it.valor, valor!!, parte.familia) }
            if (opcion != null) return listOf(opcion.copy(sugerencia = sugerencia)) + parte.opciones.filter { it !== opcion }
            continue
        }
        val m = metros(numero(valor!!), familiaDe(if (campo == CampoPendiente.ANCHO) CampoMedida.ANCHO else CampoMedida.ALTO, parte.familia))
        val e = parte.entrada
        if (e != null && m != null && m >= e.min - 1e-9 && m <= e.max + 1e-9)
            return listOf(OpcionPendiente("${metrosTexto(m)} m", m, sugerencia))
    }
    return parte.opciones
}

/** Nombre del campo para los ítems que lo comparten: «Alto» en puertas, «Largo» en el resto. */
fun etiquetaPendiente(campo: CampoPendiente, familias: List<String?>): String {
    if (campo != CampoPendiente.ALTO) return campo.etiqueta
    val distintas = familias.map { if (it == "PUERTA") "alto" else if (it != null) "largo" else null }.toSet()
    if (distintas.size != 1 || null in distintas) return campo.etiqueta
    return if ("alto" in distintas) "Alto" else "Largo"
}

fun preguntasPendientes(q: Cotizacion): List<PreguntaPendiente> {
    data class Grupo(val indices: MutableList<Int>, val parte: Parte, val familias: MutableList<String>, val orden: Int)
    val grupos = LinkedHashMap<String, Grupo>()
    val sueltas = mutableListOf<Triple<Int, Parte, Int>>()
    var orden = 0
    for (pendiente in q.incompletos) {
        for (parte in partes(pendiente.rechazo, pendiente.pregunta, q.solicitudes.getOrNull(pendiente.indice))) {
            if (parte.agrupable) {
                val clave = "${parte.campo?.clave}|${parte.detalle}|${parte.opciones.map { it.etiqueta to it.valor }}|${parte.entrada}"
                val g = grupos[clave]
                if (g != null) {
                    g.indices += pendiente.indice
                    g.familias += parte.familia
                } else grupos[clave] = Grupo(mutableListOf(pendiente.indice), parte, mutableListOf(parte.familia), orden++)
            } else sueltas += Triple(pendiente.indice, parte, orden++)
        }
    }
    val todas = (grupos.values.map { Triple(it.orden, it.indices.toList(), it.parte) to it.familias.toList() } +
        sueltas.map { (i, p, o) -> Triple(o, listOf(i), p) to listOf(p.familia) }).sortedBy { it.first.first }
    return todas.map { (t, familias) ->
        val (_, indices, parte) = t
        val sujeto = if (indices.size == 1) {
            val modelo = q.solicitudes.getOrNull(indices[0])?.modelo
            "${listaItems(indices)}${if (modelo != null) " (${bonito(modelo)})" else ""}"
        } else listaItems(indices)
        val etiqueta = parte.campo?.let { etiquetaPendiente(it, familias) }
        val texto = when {
            parte.fueraDeLista -> "Medida fuera de lista para $sujeto"
            etiqueta != null -> "$etiqueta para $sujeto"
            else -> "Revisa $sujeto"
        }
        val rechazo = if (indices.size == 1) q.incompletos.firstOrNull { it.indice == indices[0] }?.rechazo else null
        PreguntaPendiente(
            clave = "${parte.campo?.clave ?: "texto"}:${indices.joinToString(",")}",
            indices = indices,
            campo = parte.campo,
            etiqueta = etiqueta,
            texto = texto,
            detalle = parte.detalle,
            opciones = sugerir(q, indices, parte),
            entrada = parte.entrada,
            alta = if (indices.size == 1) prefillAlta(q.solicitudes.getOrNull(indices[0]), rechazo) else null,
            fueraDeLista = parte.fueraDeLista,
            modeloNuevo = rechazo?.tipo == "modelo_posible",
            intercambio = parte.intercambio,
        )
    }
}

/** Qué falta en un ítem pendiente («madera, alto o largo»); null si está completo. */
fun faltantesItem(q: Cotizacion, indice: Int): List<CampoPendiente>? {
    val p = q.incompletos.firstOrNull { it.indice == indice } ?: return null
    return partes(p.rechazo, p.pregunta, null).mapNotNull { it.campo }
}

/** Explicación de un ítem fuera de regla por precio o descuento; null si no. */
fun fueraDeRegla(q: Cotizacion, indice: Int): String? {
    val p = q.incompletos.firstOrNull { it.indice == indice } ?: return null
    return if (p.rechazo.tipo == "faltan_datos" && "precio" in p.rechazo.campos) p.pregunta else null
}

/** Los cambios de `editar` que responden la pregunta con `valor` en todos sus ítems (`cambiosRespuesta`). */
fun cl.puertasneltume.cotizador.nucleo.api.Cambios.respuesta(p: PreguntaPendiente, valor: Any) {
    if (p.campo == null && valor == INTERCAMBIAR && p.intercambio != null) {
        val (ancho, alto) = p.intercambio
        p.indices.forEach {
            itemNumero(it, "ancho", ancho)
            itemNumero(it, "alto", alto)
        }
        return
    }
    if (p.campo == null) {
        if (valor != "precioUnitario" && valor != "descuento") return
        p.indices.forEach { if (valor == "descuento") descuentoItem(it, null) else itemNumero(it, "precioUnitario", null) }
        return
    }
    when (p.campo) {
        CampoPendiente.CANTIDAD -> p.indices.forEach { cantidad(it, numero(valor).toInt()) }
        CampoPendiente.ANCHO, CampoPendiente.ALTO -> p.indices.forEach { itemNumero(it, p.campo.clave, numero(valor)) }
        else -> p.indices.forEach { itemTexto(it, p.campo.clave, valor.toString()) }
    }
}
