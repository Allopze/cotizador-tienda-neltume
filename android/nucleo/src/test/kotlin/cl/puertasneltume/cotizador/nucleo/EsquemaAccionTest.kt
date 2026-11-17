package cl.puertasneltume.cotizador.nucleo

import cl.puertasneltume.cotizador.nucleo.api.Acciones
import cl.puertasneltume.cotizador.nucleo.modelo.Cliente
import cl.puertasneltume.cotizador.nucleo.modelo.DescuentoItem
import cl.puertasneltume.cotizador.nucleo.modelo.Fabrica
import cl.puertasneltume.cotizador.nucleo.modelo.Mensaje
import cl.puertasneltume.cotizador.nucleo.modelo.ReceptorFacturacion
import cl.puertasneltume.cotizador.nucleo.modelo.ReferenciaItem
import cl.puertasneltume.cotizador.nucleo.modelo.TipoDocumento
import cl.puertasneltume.cotizador.nucleo.modelo.TipoMedida
import cl.puertasneltume.cotizador.nucleo.reglas.DatosGenerales
import cl.puertasneltume.cotizador.nucleo.reglas.cuerpoRestaurarGeneral
import com.networknt.schema.InputFormat
import com.networknt.schema.SchemaRegistry
import com.networknt.schema.SpecificationVersion
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.fail

/**
 * Cada cuerpo que arma la app para `POST /api/accion` cumple el esquema del servidor (accion.schema.json, generado
 * por tests/esquema-movil.test.ts desde src/servidor/esquema-accion.ts). Un cuerpo inválido respondería 400.
 */
class EsquemaAccionTest {
    private val esquema = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12)
        .getSchema(javaClass.getResource("/contrato/accion.schema.json")!!.readText(), InputFormat.JSON)

    private val id = "00000000-0000-4000-8000-000000000001"
    private val v = "2026-11-17T12:00:00.000Z"
    private val referencia = ReferenciaItem("a".repeat(64) + ".jpg", "puerta.jpg", "image/jpeg", 1024, v)
    private val receptor = ReceptorFacturacion("Constructora Sur SpA", "76.086.428-5", "Construcción", "Av. 1", "Temuco", "a@b.cl")

    private fun cuerpos(): Map<String, JsonObject> = linkedMapOf(
        "chat nuevo" to Acciones.chat("3 Huilo Huilo", nuevoId = id, razonamiento = "no", contexto = listOf(Mensaje("usuario", "Hola"), Mensaje("asistente", "¿Qué necesitas?"))),
        "chat abierto" to Acciones.chat("agrega marcos", id = id, actualizada = v),
        "chat objetivo" to Acciones.chat("se aprobó", objetivoId = id, objetivoActualizada = v),
        "agregar_producto" to Acciones.agregarProducto("HUIL-O-3-B", 3, 0.8, 2.1, TipoMedida.HOJA, nuevoId = id),
        "agregar_producto abierto" to Acciones.agregarProducto("MAR-2X4", 2, null, 2.1, null, id, v),
        "agregar_personalizado" to Acciones.agregarPersonalizado("Puerta curva", "PUERTA", "Lenga", null, 0.9, 2.1, TipoMedida.VANO, 1, 450000, "con vidrio", listOf(referencia), nuevoId = id),
        "agregar_personalizado libre" to Acciones.agregarPersonalizado("Instalación", "OTRO", "", "Instalación en obra", null, null, TipoMedida.NO_ESPECIFICADO, 1, 80000, null, emptyList(), id, v),
        "quitar" to Acciones.quitar(id, v, 0),
        "restaurar_borrador" to Acciones.simple("restaurar_borrador", id, v),
        "desaprobar" to Acciones.simple("desaprobar", id, v),
        "eliminar" to Acciones.simple("eliminar", id, v),
        "regenerar_pdf" to Acciones.regenerarPdf(id, v, "nota", Fabrica.PANGUIPULLI),
        "retroceder_operacion" to Acciones.retrocederOperacion(id, v, "Se registró por error"),
        "reordenar" to Acciones.reordenar(id, v, 0, 2),
        "duplicar_item" to Acciones.duplicarItem(id, v, 1),
        "restaurar_items" to Acciones.restaurarItems(id, v, buildJsonArray {
            add(buildJsonObject {
                put("id", "item-1")
                put("modelo", "HUILO HUILO")
                put("madera", "PINO OREGON")
                put("ancho", 0.8)
                put("alto", 2.1)
                put("medida", kotlinx.serialization.json.JsonNull)
                put("cantidad", 3)
                put("tipoMedida", "hoja")
                put("fabrica", "panguipulli")
            })
        }),
        "emitir" to Acciones.emitir(id, v),
        "emitir con número" to Acciones.emitir(id, v, 400),
        "aprobar" to Acciones.aprobar(
            id, v, true,
            Acciones.despachoJson("Calle 1", "Starken", "15 de abril").let { d -> JsonObject(d.filterValues { it !is kotlinx.serialization.json.JsonNull }) },
            buildJsonObject {
                put("documento", "factura")
                put("receptor", Acciones.receptorJson(receptor))
            },
        ),
        "duplicar" to Acciones.duplicar(id, id),
        "anular" to Acciones.anular(id, v, "Rechazada por el cliente"),
        "editar todo" to Acciones.editar(id, v) {
            cliente("nombre", "Juan Pérez")
            cliente("rut", "")
            cantidad(0, 4)
            itemTexto(0, "descripcion", "Puerta principal")
            itemNumero(0, "precioUnitario", null)
            itemNumero(0, "margen", 0.42)
            itemNumero(0, "ancho", 0.85)
            tipoMedida(0, TipoMedida.VANO)
            referencias(0, listOf(referencia))
            descuentoItem(0, DescuentoItem("porcentaje", 10.0))
            descuentoItem(1, DescuentoItem("monto", 5000.0))
            personalizado(2, "MARCO")
            itemNumero(2, "costoFabrica", 30000)
            descuento(5.5)
            margenCotizacion(0.4)
            observaciones("Entregar en obra")
            fleteLinea("Flete a Temuco", 2, 15000)
        },
        "editar automático" to Acciones.editar(id, v) {
            descuentoAutomatico()
            quitarFlete()
            margenCotizacion(null)
            despacho(Acciones.despachoJson("Calle 1", "Otro transportista", null, "Temuco"))
        },
        "editar_pedido" to Acciones.editarPedido(id, v, listOf(0 to buildJsonObject { put("cantidad", 5) }, 1 to buildJsonObject { put("tipoMedida", "hoja") })),
        "pago" to Acciones.pago(id, v, 500000, "2026-11-17", "Transferencia"),
        "anular_pago" to Acciones.anularPago(id, v, "pago-1", "Error de monto"),
        "despacho" to Acciones.despacho(id, v, Acciones.despachoJson("Calle 1", "Starken", "15 de abril")),
        "comentario" to Acciones.comentario(id, v, "Llamar el lunes"),
        "comercial" to Acciones.comercial(id, v, "seguimiento"),
        "generar_nota" to Acciones.generarNota(id, v, mapOf(0 to Fabrica.PANGUIPULLI, 1 to Fabrica.SANTIAGO)),
        "generar_nota sin reparto" to Acciones.generarNota(id, v),
        "asignar_fabricas" to Acciones.asignarFabricas(id, v, mapOf(0 to Fabrica.SANTIAGO, 1 to null)),
        "cambiar_numero" to Acciones.cambiarNumero(id, v, "nota", 600, Fabrica.PANGUIPULLI),
        "operacion" to Acciones.operacion(id, v, "iniciar_produccion", Fabrica.PANGUIPULLI),
        "facturacion" to Acciones.facturacion(id, v, "facturada", TipoDocumento.FACTURA, "1234", "2026-11-17"),
        "facturacion pendiente" to Acciones.facturacion(id, v, "pendiente"),
        "datos_facturacion" to Acciones.datosFacturacion(id, v, TipoDocumento.FACTURA, receptor),
        "datos_facturacion boleta" to Acciones.datosFacturacion(id, v, TipoDocumento.BOLETA, null),
        "restaurar general (deshacer)" to cuerpoRestaurarGeneral(
            id,
            v,
            DatosGenerales(Cliente(nombre = "Juan"), 0.0, false, 30000, 2, null, null, null),
        ),
    )

    @Test
    fun cadaCuerpoCumpleElEsquemaDelServidor() {
        val fallas = cuerpos().mapNotNull { (nombre, cuerpo) ->
            val errores = esquema.validate(cuerpo.toString(), InputFormat.JSON) { ctx ->
                ctx.executionConfig { it.formatAssertionsEnabled(true) }
            }
            if (errores.isEmpty()) null else "$nombre: ${errores.take(4).joinToString("; ")}\n    $cuerpo"
        }
        if (fallas.isNotEmpty()) fail("${fallas.size} cuerpos inválidos:\n" + fallas.joinToString("\n"))
    }

    @Test
    fun seCubrenTodosLosTiposDelServidor() {
        val tipos = cuerpos().values.map { (it["tipo"] as JsonPrimitive).content }.toSet()
        val delServidor = Regex("\"const\":\\s*\"([a-z_]+)\"").findAll(javaClass.getResource("/contrato/accion.schema.json")!!.readText())
            .map { it.groupValues[1] }.toSet() - setOf("porcentaje", "monto") // el `tipo` del descuento de un ítem
        assertEquals(emptySet(), delServidor - tipos, "Tipos del servidor sin un cuerpo de prueba en la app")
    }
}
