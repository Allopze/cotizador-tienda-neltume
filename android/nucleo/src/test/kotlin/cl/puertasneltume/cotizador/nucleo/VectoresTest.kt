package cl.puertasneltume.cotizador.nucleo

import cl.puertasneltume.cotizador.nucleo.api.JsonNeltume
import cl.puertasneltume.cotizador.nucleo.modelo.CambiosCotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.Cotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.EstadoCotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.EstadoOperativo
import cl.puertasneltume.cotizador.nucleo.modelo.Facturacion
import cl.puertasneltume.cotizador.nucleo.modelo.Producto
import cl.puertasneltume.cotizador.nucleo.modelo.ReceptorFacturacion
import cl.puertasneltume.cotizador.nucleo.modelo.ResumenCotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.TipoDocumento
import cl.puertasneltume.cotizador.nucleo.modelo.TipoMedida
import cl.puertasneltume.cotizador.nucleo.modelo.TramoDescuento
import cl.puertasneltume.cotizador.nucleo.reglas.Anulable
import cl.puertasneltume.cotizador.nucleo.reglas.CampoMedida
import cl.puertasneltume.cotizador.nucleo.reglas.Fechas
import cl.puertasneltume.cotizador.nucleo.reglas.autoria
import cl.puertasneltume.cotizador.nucleo.reglas.avancePedido
import cl.puertasneltume.cotizador.nucleo.reglas.decimalCampo
import cl.puertasneltume.cotizador.nucleo.reglas.describirProducto
import cl.puertasneltume.cotizador.nucleo.reglas.descripcionFlete
import cl.puertasneltume.cotizador.nucleo.reglas.dimensionesEnMilimetros
import cl.puertasneltume.cotizador.nucleo.reglas.errorMargenTexto
import cl.puertasneltume.cotizador.nucleo.reglas.errorTramos
import cl.puertasneltume.cotizador.nucleo.reglas.estadoPago
import cl.puertasneltume.cotizador.nucleo.reglas.etiquetaDocumentoFacturacion
import cl.puertasneltume.cotizador.nucleo.reglas.etiquetaEvento
import cl.puertasneltume.cotizador.nucleo.reglas.etiquetaFacturacion
import cl.puertasneltume.cotizador.nucleo.reglas.faltanDatosFactura
import cl.puertasneltume.cotizador.nucleo.reglas.interpretarCifra
import cl.puertasneltume.cotizador.nucleo.reglas.leerMedida
import cl.puertasneltume.cotizador.nucleo.reglas.leerPesos
import cl.puertasneltume.cotizador.nucleo.reglas.leerPorcentaje
import cl.puertasneltume.cotizador.nucleo.reglas.leerPorcentajeConSigno
import cl.puertasneltume.cotizador.nucleo.reglas.medidaProducto
import cl.puertasneltume.cotizador.nucleo.reglas.medidaReferencia
import cl.puertasneltume.cotizador.nucleo.reglas.metrosTexto
import cl.puertasneltume.cotizador.nucleo.reglas.nombreProducto
import cl.puertasneltume.cotizador.nucleo.reglas.normalizarRut
import cl.puertasneltume.cotizador.nucleo.reglas.numeroCotizacion
import cl.puertasneltume.cotizador.nucleo.reglas.pct
import cl.puertasneltume.cotizador.nucleo.reglas.pesos
import cl.puertasneltume.cotizador.nucleo.reglas.plural
import cl.puertasneltume.cotizador.nucleo.reglas.porcentaje
import cl.puertasneltume.cotizador.nucleo.reglas.porcentajeIva
import cl.puertasneltume.cotizador.nucleo.reglas.preguntasPendientes
import cl.puertasneltume.cotizador.nucleo.reglas.puedeAnular
import cl.puertasneltume.cotizador.nucleo.reglas.resumenCambios
import cl.puertasneltume.cotizador.nucleo.reglas.resumenTexto
import cl.puertasneltume.cotizador.nucleo.reglas.retrocesoOperativo
import cl.puertasneltume.cotizador.nucleo.reglas.sinMedida
import cl.puertasneltume.cotizador.nucleo.reglas.tamanoReferencia
import cl.puertasneltume.cotizador.nucleo.reglas.textoCopiarFactura
import cl.puertasneltume.cotizador.nucleo.reglas.textoTramo
import cl.puertasneltume.cotizador.nucleo.reglas.validez
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.fail

/**
 * Paridad con la web: cada caso de vectores.json (generado por tests/vectores-movil.test.ts con las funciones
 * TypeScript) debe dar lo mismo con la función portada. Si falla, la regla cambió en la web y hay que portarla.
 */
class VectoresTest {
    private val vectores: JsonObject = JsonNeltume.parseToJsonElement(
        javaClass.getResource("/vectores/vectores.json")!!.readText(),
    ).jsonObject

    private fun JsonElement.texto() = (this as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull
    private fun JsonElement.doble() = (this as? JsonPrimitive)?.takeIf { it !is JsonNull }?.doubleOrNull
    private fun JsonElement.largo() = (this as? JsonPrimitive)?.takeIf { it !is JsonNull }?.longOrNull
    private fun JsonElement.entero() = (this as? JsonPrimitive)?.takeIf { it !is JsonNull }?.intOrNull
    private inline fun <reified T> JsonElement.como(): T = JsonNeltume.decodeFromJsonElement(this)

    /** Un Double en el mismo formato JSON que JavaScript (NaN como texto, enteros sin «.0»). */
    private fun num(d: Double?): JsonElement = when {
        d == null -> JsonNull
        d.isNaN() -> JsonPrimitive("NaN")
        d == Math.floor(d) && kotlin.math.abs(d) < 1e15 -> JsonPrimitive(d.toLong())
        else -> JsonPrimitive(d)
    }

    private fun txt(s: String?): JsonElement = if (s == null) JsonNull else JsonPrimitive(s)

    private fun cotizacionDe(e: JsonElement): Cotizacion = e.como()

    private val funciones: Map<String, (JsonArray) -> JsonElement> = mapOf(
        "pesos" to { a -> txt(pesos(a[0].largo()!!)) },
        "porcentaje" to { a -> txt(porcentaje(a[0].doble()!!)) },
        "porcentajeIva" to { a -> txt(porcentajeIva(a[0].doble()!!)) },
        "pct" to { a -> txt(pct(a[0].doble()!!)) },
        "metrosTexto" to { a -> txt(metrosTexto(a[0].doble()!!)) },
        "decimalCampo" to { a -> txt(decimalCampo(a[0].doble()!!)) },
        "fechaCorta" to { a -> txt(Fechas.corta(a[0].texto()!!)) },
        "fechaLarga" to { a -> txt(Fechas.larga(a[0].texto()!!)) },
        "mesAnio" to { a -> txt(Fechas.mesAnio(a[0].texto()!!)) },
        "fechaLocal" to { a -> txt(Fechas.local(a[0].texto()!!)) },
        "interpretarCifra" to { a -> num(interpretarCifra(a[0].texto()!!)) },
        "leerPesos" to { a -> num(leerPesos(a[0].texto()!!)) },
        "leerPorcentaje" to { a -> num(leerPorcentaje(a[0].texto()!!)) },
        "leerPorcentajeConSigno" to { a -> num(leerPorcentajeConSigno(a[0].texto()!!)) },
        "errorMargenTexto" to { a -> txt(errorMargenTexto(a[0].texto()!!)) },
        "leerMedida" to { a ->
            val campo = if (a[2].texto() == "ancho") CampoMedida.ANCHO else CampoMedida.ALTO
            num(leerMedida(a[0].texto()!!, a[1].texto()!!, campo))
        },
        "normalizarRut" to { a -> txt(normalizarRut(a[0].texto()!!)) },
        "nombreProducto" to { a -> txt(nombreProducto(a[0].texto()!!)) },
        "sinMedida" to { a -> txt(sinMedida(a[0].texto()!!)) },
        "medidaProducto" to { a ->
            val p: Producto = a[0].como()
            txt(medidaProducto(p.familia, p.medida, p.largo, p.anchoMin, p.anchoMax, p.altoMin, p.altoMax))
        },
        "describirProducto" to { a ->
            val p: Producto = a[0].como()
            val pedidas = a.getOrNull(1)?.jsonObject
            txt(describirProducto(p, pedidas?.get("ancho")?.doble(), pedidas?.get("alto")?.doble()))
        },
        "medidaReferencia" to { a -> txt(medidaReferencia(a[0].como())) },
        "dimensionesEnMilimetros" to { a ->
            val tipo = a.getOrNull(2)?.texto()?.let { t -> TipoMedida.entries.first { it.clave == t } }
            txt(dimensionesEnMilimetros(a[0].doble(), a[1].doble(), tipo))
        },
        "plural" to { a ->
            txt(if (a.size > 2) plural(a[0].entero()!!, a[1].texto()!!, a[2].texto()!!) else plural(a[0].entero()!!, a[1].texto()!!))
        },
        "numeroCotizacion" to { a -> txt(numeroCotizacion(a[0].entero())) },
        "estadoPago" to { a ->
            val o = a[0].jsonObject
            txt(estadoPago(ResumenCotizacion(
                id = "x",
                estado = o["estado"]!!.como<EstadoCotizacion>(),
                pagado = o["pagado"]?.largo(),
                total = o["total"]!!.largo()!!,
                porcentajePagado = o["porcentajePagado"]?.doble(),
            )))
        },
        "autoria" to { a ->
            val o = a[0].jsonObject
            txt(autoria(o["creadaPor"]?.texto(), o["emitidaPor"]?.texto(), o["aprobadaPor"]?.texto(), o["anuladaPor"]?.texto()))
        },
        "resumenCambios" to { a -> txt(resumenCambios(a.getOrNull(0)?.takeIf { it !is JsonNull }?.como<CambiosCotizacion>())) },
        "avancePedido" to { a ->
            val o = a[0].jsonObject
            val r = avancePedido(
                o["estado"]!!.como<EstadoCotizacion>(),
                o["operacion"]!!.como<EstadoOperativo>(),
                o["notas"]!!.entero()!!,
                o["pagado"]!!.largo()!!,
                o["total"]!!.largo()!!,
                o["facturada"]!!.jsonPrimitive.booleanOrNull!!,
            )
            buildJsonObject {
                put("hechos", buildJsonArray { r.hechos.forEach { add(JsonPrimitive(it)) } })
                put("actual", r.actual)
            }
        },
        "puedeAnular" to { a ->
            when (val r = puedeAnular(cotizacionDe(a[0]))) {
                is Anulable.Si -> buildJsonObject {
                    put("ok", true)
                    put("pagado", r.pagado)
                }
                is Anulable.No -> buildJsonObject {
                    put("ok", false)
                    put("motivo", r.motivo)
                }
            }
        },
        "retrocesoOperativo" to { a ->
            val r = retrocesoOperativo(cotizacionDe(a[0]))
            if (r == null) JsonNull else buildJsonObject {
                put("desde", r.desde)
                put("hasta", r.hasta)
                put("destino", r.destino.clave)
                put("nota", r.nota?.let {
                    buildJsonObject {
                        put("fabrica", it.fabrica?.clave)
                        put("campo", it.campo)
                    }
                } ?: JsonNull)
            }
        },
        "descripcionFlete" to { a -> txt(descripcionFlete(cotizacionDe(a[0]))) },
        "etiquetaFacturacion" to { a -> txt(etiquetaFacturacion(a.getOrNull(0)?.takeIf { it !is JsonNull }?.como<Facturacion>())) },
        "etiquetaEvento" to { a -> txt(etiquetaEvento(a[0].texto()!!)) },
        "textoCopiarFactura" to { a -> txt(textoCopiarFactura(a[0].takeIf { it !is JsonNull }?.como<ReceptorFacturacion>())) },
        "faltanDatosFactura" to { a ->
            buildJsonArray { faltanDatosFactura(a[0].takeIf { it !is JsonNull }?.como()).forEach { add(JsonPrimitive(it)) } }
        },
        "etiquetaDocumentoFacturacion" to { a ->
            val o = a[0].jsonObject
            txt(etiquetaDocumentoFacturacion(
                o["estado"]?.texto(),
                o["documento"]?.takeIf { it !is JsonNull }?.como<TipoDocumento>(),
                o["tipo"]?.takeIf { it !is JsonNull }?.como<TipoDocumento>(),
                o["receptor"]?.takeIf { it !is JsonNull }?.como<ReceptorFacturacion>(),
            ))
        },
        "textoTramo" to { a -> txt(textoTramo(a[0].como())) },
        "errorTramos" to { a ->
            txt(errorTramos(JsonNeltume.decodeFromJsonElement(ListSerializer(TramoDescuento.serializer()), a[0]), a[1].doble()!!))
        },
        "tamanoReferencia" to { a -> txt(tamanoReferencia(a[0].largo()!!)) },
        "validez" to { a -> txt(validez(a[0].takeIf { it !is JsonNull }?.let { cotizacionDe(it) })) },
        "resumenTexto" to { a -> txt(resumenTexto(cotizacionDe(a[0]))) },
        "preguntasPendientes" to { a ->
            val o = a[0].jsonObject
            val q = Cotizacion(
                id = "x",
                estado = EstadoCotizacion.BORRADOR,
                actualizada = "",
                solicitudes = o["solicitudes"]!!.como(),
                incompletos = o["incompletos"]!!.como(),
            )
            buildJsonArray {
                preguntasPendientes(q).forEach { p ->
                    add(buildJsonObject {
                        put("clave", p.clave)
                        put("indices", buildJsonArray { p.indices.forEach { add(JsonPrimitive(it)) } })
                        put("campo", p.campo?.clave)
                        put("etiqueta", p.etiqueta)
                        put("texto", p.texto)
                        put("detalle", p.detalle)
                        put("opciones", buildJsonArray {
                            p.opciones.forEach { op ->
                                add(buildJsonObject {
                                    put("etiqueta", op.etiqueta)
                                    put("valor", (op.valor as? Number)?.let { num(it.toDouble()) } ?: JsonPrimitive(op.valor.toString()))
                                    if (op.sugerencia != null) put("sugerencia", op.sugerencia)
                                })
                            }
                        })
                        put("entrada", p.entrada?.let { e ->
                            buildJsonObject {
                                put("min", num(e.min))
                                put("max", num(e.max))
                                put("paso", num(e.paso))
                                put("unidad", e.unidad)
                                if (e.familia != null) put("familia", e.familia)
                            }
                        } ?: JsonNull)
                        p.intercambio?.let { (ancho, alto) ->
                            put("intercambio", buildJsonObject {
                                put("ancho", num(ancho))
                                put("alto", num(alto))
                            })
                        }
                        if (p.fueraDeLista) put("motivo", "fuera_de_lista")
                        put("modeloNuevo", p.modeloNuevo)
                        put("alta", p.alta?.let { al ->
                            buildJsonObject {
                                put("familia", al.familia)
                                put("modelo", al.modelo)
                                put("madera", al.madera)
                                put("medida", al.medida)
                                put("anchoMin", num(al.anchoMin))
                                put("anchoMax", num(al.anchoMax))
                                put("largo", num(al.largo))
                            }
                        } ?: JsonNull)
                    })
                }
            }
        },
    )

    @Test
    fun todasLasFuncionesTienenSuVersionKotlin() {
        val sinPortar = vectores.keys - funciones.keys
        assertEquals(emptySet(), sinPortar, "Funciones de la web sin su versión Kotlin")
    }

    @Test
    fun cadaCasoDaLoMismoQueEnLaWeb() {
        val fallas = mutableListOf<String>()
        for ((nombre, casos) in vectores) {
            val f = funciones[nombre] ?: continue
            for (caso in casos.jsonArray) {
                val entrada = caso.jsonObject["entrada"]!!.jsonArray
                val esperado = caso.jsonObject["salida"]!!
                val obtenido = try {
                    f(entrada)
                } catch (e: Exception) {
                    JsonPrimitive("💥 ${e::class.simpleName}: ${e.message}")
                }
                if (!igual(esperado, obtenido))
                    fallas += "$nombre(${entrada.toString().take(160)})\n    web:    $esperado\n    kotlin: $obtenido"
            }
        }
        if (fallas.isNotEmpty()) fail("${fallas.size} casos distintos:\n" + fallas.joinToString("\n"))
    }

    /** Igualdad JSON tolerante a 0.8 vs 0.80 en números. */
    private fun igual(a: JsonElement, b: JsonElement): Boolean = when {
        a is JsonPrimitive && b is JsonPrimitive && !a.isString && !b.isString && a !is JsonNull && b !is JsonNull ->
            a.doubleOrNull == b.doubleOrNull || a.content == b.content
        a is JsonObject && b is JsonObject -> a.keys == b.keys && a.keys.all { igual(a[it]!!, b[it]!!) }
        a is JsonArray && b is JsonArray -> a.size == b.size && a.indices.all { igual(a[it], b[it]) }
        else -> a == b
    }
}
