package cl.puertasneltume.cotizador.nucleo.api

import cl.puertasneltume.cotizador.nucleo.modelo.DescuentoItem
import cl.puertasneltume.cotizador.nucleo.modelo.Fabrica
import cl.puertasneltume.cotizador.nucleo.modelo.Mensaje
import cl.puertasneltume.cotizador.nucleo.modelo.ReceptorFacturacion
import cl.puertasneltume.cotizador.nucleo.modelo.ReferenciaItem
import cl.puertasneltume.cotizador.nucleo.modelo.TipoDocumento
import cl.puertasneltume.cotizador.nucleo.modelo.TipoMedida
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/**
 * Cuerpos de `POST /api/accion`, uno por `tipo` del esquema Zod (src/servidor/esquema-accion.ts). Se arman como JSON
 * a mano para distinguir «sin cambio» (campo ausente) de un `null` explícito («quitar el precio», «quitar el flete»).
 * Las pruebas validan cada cuerpo contra el JSON Schema que exporta el servidor.
 */
object Acciones {
    private fun base(tipo: String, id: String?, actualizada: String?, resto: JsonObjectBuilder.() -> Unit = {}) =
        buildJsonObject {
            put("tipo", tipo)
            if (id != null) put("id", id)
            if (actualizada != null) put("actualizada", actualizada)
            resto()
        }

    /** Las acciones que solo necesitan la versión: `desaprobar`, `restaurar_borrador`, `eliminar`. */
    fun simple(tipo: String, id: String, actualizada: String) = base(tipo, id, actualizada)

    fun chat(
        mensaje: String,
        id: String? = null,
        actualizada: String? = null,
        nuevoId: String? = null,
        objetivoId: String? = null,
        objetivoActualizada: String? = null,
        razonamiento: String? = null,
        contexto: List<Mensaje> = emptyList(),
    ) = base("chat", id, actualizada) {
        put("mensaje", mensaje)
        if (nuevoId != null && id == null) put("nuevoId", nuevoId)
        if (objetivoId != null) {
            put("objetivoId", objetivoId)
            put("objetivoActualizada", objetivoActualizada)
        }
        if (razonamiento != null) put("razonamiento", razonamiento)
        if (contexto.isNotEmpty() && id == null)
            putJsonArray("contexto") {
                contexto.takeLast(12).forEach { m ->
                    addJsonObject {
                        put("rol", m.rol)
                        put("texto", m.texto)
                    }
                }
            }
    }

    fun agregarProducto(
        codigo: String,
        cantidad: Int,
        ancho: Double? = null,
        alto: Double? = null,
        tipoMedida: TipoMedida? = null,
        id: String? = null,
        actualizada: String? = null,
        nuevoId: String? = null,
    ) = base("agregar_producto", id, actualizada) {
        put("codigo", codigo)
        put("cantidad", cantidad)
        if (ancho != null) put("ancho", ancho)
        if (alto != null) put("alto", alto)
        if (tipoMedida != null) put("tipoMedida", tipoMedida.clave)
        if (id == null && nuevoId != null) put("nuevoId", nuevoId)
    }

    /** Producto fuera de catálogo; medidas en metros, precio neto unitario. */
    fun agregarPersonalizado(
        nombre: String,
        familia: String,
        madera: String,
        descripcion: String?,
        ancho: Double?,
        alto: Double?,
        tipoMedida: TipoMedida,
        cantidad: Int,
        precioUnitario: Long,
        observaciones: String?,
        referencias: List<ReferenciaItem>,
        id: String? = null,
        actualizada: String? = null,
        nuevoId: String? = null,
    ) = base("agregar_personalizado", id, actualizada) {
        putJsonObject("item") {
            put("nombre", nombre)
            put("familia", familia)
            put("madera", madera)
            put("descripcion", descripcion)
            put("ancho", ancho)
            put("alto", alto)
            put("tipoMedida", tipoMedida.clave)
            put("cantidad", cantidad)
            put("precioUnitario", precioUnitario)
            put("observaciones", observaciones)
            put("referencias", JsonNeltume.encodeToJsonElement(referencias))
        }
        if (id == null && nuevoId != null) put("nuevoId", nuevoId)
    }

    fun quitar(id: String, actualizada: String, indice: Int) = base("quitar", id, actualizada) { put("indice", indice) }

    fun reordenar(id: String, actualizada: String, desde: Int, hasta: Int) = base("reordenar", id, actualizada) {
        put("desde", desde)
        put("hasta", hasta)
    }

    fun duplicarItem(id: String, actualizada: String, indice: Int) =
        base("duplicar_item", id, actualizada) { put("indice", indice) }

    /** Vuelve a dejar los ítems como estaban (deshacer y rehacer). `items` son las solicitudes guardadas. */
    fun restaurarItems(id: String, actualizada: String, items: JsonArray) =
        base("restaurar_items", id, actualizada) { put("items", items) }

    fun emitir(id: String, actualizada: String, numero: Int? = null) = base("emitir", id, actualizada) {
        if (numero != null) put("numero", numero)
    }

    fun aprobar(
        id: String,
        actualizada: String,
        confirmarVencida: Boolean = false,
        despacho: JsonObject? = null,
        facturacion: JsonObject? = null,
    ) = base("aprobar", id, actualizada) {
        if (confirmarVencida) put("confirmarVencida", true)
        if (despacho != null) put("despacho", despacho)
        if (facturacion != null) put("facturacion", facturacion)
    }

    fun duplicar(id: String, nuevoId: String) = base("duplicar", id, null) { put("nuevoId", nuevoId) }

    fun anular(id: String, actualizada: String, motivo: String?) = base("anular", id, actualizada) {
        if (!motivo.isNullOrBlank()) put("motivo", motivo.trim())
    }

    fun regenerarPdf(id: String, actualizada: String, documento: String, fabrica: Fabrica?) =
        base("regenerar_pdf", id, actualizada) {
            put("documento", documento)
            if (fabrica != null) put("fabrica", fabrica.clave)
        }

    fun retrocederOperacion(id: String, actualizada: String, motivo: String) =
        base("retroceder_operacion", id, actualizada) { put("motivo", motivo.trim()) }

    fun editar(id: String, actualizada: String, cambios: Cambios.() -> Unit) =
        base("editar", id, actualizada) { Cambios(this).cambios() }

    /** Corrección de ítems de una aprobada con nota de pedido. */
    fun editarPedido(id: String, actualizada: String, items: List<Pair<Int, JsonObject>>) =
        base("editar_pedido", id, actualizada) {
            putJsonArray("items") {
                items.forEach { (indice, cambios) ->
                    addJsonObject {
                        put("indice", indice)
                        put("cambios", cambios)
                    }
                }
            }
        }

    fun pago(id: String, actualizada: String, monto: Long, fecha: String?, observacion: String?) =
        base("pago", id, actualizada) {
            put("monto", monto)
            if (fecha != null) put("fecha", fecha)
            if (!observacion.isNullOrBlank()) put("observacion", observacion.trim())
        }

    fun anularPago(id: String, actualizada: String, pagoId: String, motivo: String?) =
        base("anular_pago", id, actualizada) {
            put("pagoId", pagoId)
            if (!motivo.isNullOrBlank()) put("motivo", motivo.trim())
        }

    fun despacho(id: String, actualizada: String, despacho: JsonObject) =
        base("despacho", id, actualizada) { put("despacho", despacho) }

    fun comentario(id: String, actualizada: String, texto: String) =
        base("comentario", id, actualizada) { put("texto", texto.trim()) }

    /** `seguimiento` o `rechazada`. */
    fun comercial(id: String, actualizada: String, estado: String) =
        base("comercial", id, actualizada) { put("estado", estado) }

    fun generarNota(id: String, actualizada: String, asignaciones: Map<Int, Fabrica?>? = null) =
        base("generar_nota", id, actualizada) {
            if (!asignaciones.isNullOrEmpty()) put("asignaciones", asignacionesJson(asignaciones))
        }

    fun asignarFabricas(id: String, actualizada: String, asignaciones: Map<Int, Fabrica?>) =
        base("asignar_fabricas", id, actualizada) { put("asignaciones", asignacionesJson(asignaciones)) }

    private fun asignacionesJson(asignaciones: Map<Int, Fabrica?>) = buildJsonArray {
        asignaciones.toSortedMap().forEach { (indice, fabrica) ->
            addJsonObject {
                put("indice", indice)
                put("fabrica", fabrica?.clave)
            }
        }
    }

    /** `documento`: `cotizacion` o `nota` (con su `fabrica`). */
    fun cambiarNumero(id: String, actualizada: String, documento: String, numero: Int, fabrica: Fabrica?) =
        base("cambiar_numero", id, actualizada) {
            put("documento", documento)
            put("numero", numero)
            if (fabrica != null) put("fabrica", fabrica.clave)
        }

    /** `paso`: iniciar_produccion, produccion_terminada, lista_despacho, despachada o completada. */
    fun operacion(id: String, actualizada: String, paso: String, fabrica: Fabrica? = null, despacho: JsonObject? = null) =
        base("operacion", id, actualizada) {
            put("paso", paso)
            if (fabrica != null) put("fabrica", fabrica.clave)
            if (despacho != null) put("despacho", despacho)
        }

    fun facturacion(
        id: String,
        actualizada: String,
        estado: String,
        tipoDocumento: TipoDocumento? = null,
        identificadorExterno: String? = null,
        fecha: String? = null,
    ) = base("facturacion", id, actualizada) {
        put("estado", estado)
        if (tipoDocumento != null) put("tipoDocumento", tipoDocumento.clave)
        if (!identificadorExterno.isNullOrBlank()) put("identificadorExterno", identificadorExterno.trim())
        if (fecha != null) put("fecha", fecha)
    }

    fun datosFacturacion(id: String, actualizada: String, documento: TipoDocumento?, receptor: ReceptorFacturacion?) =
        base("datos_facturacion", id, actualizada) {
            put("documento", documento?.clave)
            if (receptor != null) put("receptor", receptorJson(receptor))
        }

    fun receptorJson(r: ReceptorFacturacion) = buildJsonObject {
        put("razonSocial", r.razonSocial)
        put("rut", r.rut)
        put("giro", r.giro)
        put("direccion", r.direccion)
        put("comuna", r.comuna)
        put("correo", r.correo)
    }

    fun despachoJson(
        direccion: String?,
        transporte: String?,
        entregaComprometida: String? = null,
        destino: String? = null,
    ) = buildJsonObject {
        put("direccion", direccion?.trim()?.ifEmpty { null })
        put("transporte", transporte?.trim()?.ifEmpty { null })
        put("entregaComprometida", entregaComprometida?.trim()?.ifEmpty { null })
        if (destino != null) put("destino", destino.trim().ifEmpty { null })
    }
}

/**
 * Cambios de la acción `editar` (`CambiosEdicion` de src/app/contrato.ts). Cada función agrega solo lo que se
 * cambia; un `null` explícito significa «quitar» o «volver al valor del catálogo».
 */
class Cambios internal constructor(private val o: JsonObjectBuilder) {
    private val cliente = mutableMapOf<String, JsonElement>()
    private val items = mutableMapOf<Int, MutableMap<String, JsonElement>>()
    private val cantidades = mutableMapOf<Int, Int>()

    fun cliente(campo: String, valor: String?) {
        cliente[campo] = JsonPrimitive(valor?.trim()?.ifEmpty { null })
        o.put("cliente", JsonObject(cliente))
    }

    fun cantidad(indice: Int, cantidad: Int) {
        cantidades[indice] = cantidad
        o.put("cantidades", buildJsonArray {
            cantidades.toSortedMap().forEach { (i, c) ->
                addJsonObject {
                    put("indice", i)
                    put("cantidad", c)
                }
            }
        })
    }

    /** Un campo de un ítem (`modelo`, `madera`, `ancho`, `alto`, `medida`, `precioUnitario`, `margen`…). */
    fun item(indice: Int, campo: String, valor: JsonElement) {
        items.getOrPut(indice) { mutableMapOf() }[campo] = valor
        o.put("items", buildJsonArray {
            items.toSortedMap().forEach { (i, c) ->
                addJsonObject {
                    put("indice", i)
                    put("cambios", JsonObject(c))
                }
            }
        })
    }

    fun itemTexto(indice: Int, campo: String, valor: String?) =
        item(indice, campo, JsonPrimitive(valor?.trim()?.ifEmpty { null }))

    fun itemNumero(indice: Int, campo: String, valor: Number?) = item(indice, campo, JsonPrimitive(valor))

    fun tipoMedida(indice: Int, tipo: TipoMedida) = item(indice, "tipoMedida", JsonPrimitive(tipo.clave))

    fun referencias(indice: Int, referencias: List<ReferenciaItem>) =
        item(indice, "referencias", JsonNeltume.encodeToJsonElement(referencias))

    fun descuentoItem(indice: Int, descuento: DescuentoItem?) = item(
        indice,
        "descuento",
        if (descuento == null) JsonNull else buildJsonObject {
            put("tipo", descuento.tipo)
            put("valor", if (descuento.esPorcentaje) JsonPrimitive(descuento.valor) else JsonPrimitive(descuento.valor.toLong()))
        },
    )

    /** Convierte el ítem en producto especial de la familia dada, o lo devuelve al catálogo con null. */
    fun personalizado(indice: Int, familia: String?) = item(
        indice,
        "personalizado",
        if (familia == null) JsonNull else buildJsonObject { put("familia", familia) },
    )

    fun descuento(porcentaje: Double) = o.put("descuento", porcentaje)

    fun descuentoAutomatico() = o.put("descuentoAutomatico", true)

    fun flete(monto: Long) = o.put("flete", monto)

    /** Línea de flete del detalle; null la quita. */
    fun fleteLinea(descripcion: String?, cantidad: Int?, unitario: Long?) = o.putJsonObject("fleteLinea") {
        if (descripcion != null) put("descripcion", descripcion.trim().ifEmpty { null })
        if (cantidad != null) put("cantidad", cantidad)
        if (unitario != null) put("unitario", unitario)
    }

    fun quitarFlete() = o.put("fleteLinea", JsonNull)

    /** Fracción (0,42 = 42 %); null vuelve a la ganancia de cada categoría. */
    fun margenCotizacion(margen: Double?) = o.put("margenCotizacion", margen)

    fun observaciones(texto: String?) = o.put("observaciones", texto?.trim()?.ifEmpty { null })

    fun despacho(despacho: JsonObject) = o.put("despacho", despacho)

    fun tarifaStarken(tarifa: JsonObject) = o.put("tarifaStarken", tarifa)

    /** Acceso directo para los casos poco comunes. */
    fun campo(nombre: String, valor: JsonElement) = o.put(nombre, valor)
}
