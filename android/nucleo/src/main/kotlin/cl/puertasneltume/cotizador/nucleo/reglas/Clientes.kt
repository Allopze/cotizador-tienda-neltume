package cl.puertasneltume.cotizador.nucleo.reglas

import cl.puertasneltume.cotizador.nucleo.modelo.Cliente
import cl.puertasneltume.cotizador.nucleo.modelo.ReceptorFacturacion
import cl.puertasneltume.cotizador.nucleo.modelo.TipoDocumento

// RUT, correo y datos de facturación (src/negocio/cliente.ts y facturacion.ts).

/** Dígito verificador módulo 11. */
fun digitoVerificador(cuerpo: String): String {
    var suma = 0
    var factor = 2
    for (i in cuerpo.length - 1 downTo 0) {
        suma += cuerpo[i].digitToInt() * factor
        factor = if (factor == 7) 2 else factor + 1
    }
    val dv = 11 - (suma % 11)
    return when (dv) {
        11 -> "0"
        10 -> "K"
        else -> dv.toString()
    }
}

/** «12.345.678-5» si el dígito verificador es válido; null si no. */
fun normalizarRut(texto: String): String? {
    val compacto = texto.replace(Regex("""[.\s‐-]"""), "").uppercase()
    val m = Regex("""^(\d{1,9})([\dK])$""").find(compacto) ?: return null
    val cuerpo = m.groupValues[1].replace(Regex("""^0+(?=\d)"""), "")
    if (digitoVerificador(cuerpo) != m.groupValues[2]) return null
    return "${NumerosCL.agruparMiles(cuerpo)}-${m.groupValues[2]}"
}

fun rutCompacto(rut: String?) = (rut ?: "").replace(Regex("""[^0-9kK]"""), "").lowercase()

fun correoValido(texto: String) = Regex("""^[^\s@]+@[^\s@]+\.[^\s@]+$""").matches(texto.trim())

fun receptorTieneContenido(r: ReceptorFacturacion?) = r != null &&
    listOf(r.razonSocial, r.rut, r.giro, r.direccion, r.comuna, r.correo).any { !it.isNullOrBlank() }

/** Razón social, RUT válido, giro y dirección: lo obligatorio para una factura. */
fun faltanDatosFactura(r: ReceptorFacturacion?): List<String> = buildList {
    if (r?.razonSocial.isNullOrBlank()) add("razón social")
    if (r?.rut.isNullOrBlank() || normalizarRut(r!!.rut!!) == null) add("RUT válido")
    if (r?.giro.isNullOrBlank()) add("giro")
    if (r?.direccion.isNullOrBlank()) add("dirección")
}

fun receptorDesdeCliente(c: Cliente, correo: String? = null) =
    ReceptorFacturacion(c.nombre, c.rut, c.giro, c.direccion, c.comuna, correo)

/** Texto plano, un campo por línea, para pegar en el facturador. */
fun textoCopiarFactura(r: ReceptorFacturacion?): String {
    if (r == null) return ""
    return listOf(
        "Razón social" to r.razonSocial,
        "RUT" to r.rut?.let { normalizarRut(it) ?: it },
        "Giro" to r.giro,
        "Dirección" to r.direccion,
        "Comuna" to r.comuna,
        "Correo" to r.correo,
    ).filter { !it.second.isNullOrBlank() }.joinToString("\n") { "${it.first}: ${it.second!!.trim()}" }
}

/** «Boleta», «Factura a Constructora X (76.…)» o «Factura (faltan datos del receptor)». */
fun etiquetaDocumentoFacturacion(
    estado: String?,
    documento: TipoDocumento?,
    tipo: TipoDocumento?,
    receptor: ReceptorFacturacion?,
): String? {
    val doc = documento ?: tipo ?: return null
    if (doc == TipoDocumento.BOLETA) return "Boleta"
    if (!receptor?.razonSocial.isNullOrEmpty())
        return "Factura a ${receptor!!.razonSocial}${if (!receptor.rut.isNullOrEmpty()) " (${receptor.rut})" else ""}"
    return if (estado == "facturada") "Factura" else "Factura (faltan datos del receptor)"
}

// --- Referencias del cliente --------------------------------------------------------------------------------

const val MAX_BYTES_REFERENCIA = 10L * 1024 * 1024
const val MAX_REFERENCIAS_ITEM = 10
val TIPOS_REFERENCIA = mapOf(
    "image/jpeg" to "jpg",
    "image/png" to "png",
    "image/webp" to "webp",
    "application/pdf" to "pdf",
)

fun etiquetaTipoReferencia(tipo: String) =
    if (tipo == "application/pdf") "Documento PDF" else "Imagen ${(TIPOS_REFERENCIA[tipo] ?: "").uppercase()}"
