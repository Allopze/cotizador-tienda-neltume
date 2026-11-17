package cl.puertasneltume.cotizador.nucleo

import cl.puertasneltume.cotizador.nucleo.api.DirectorioClientes
import cl.puertasneltume.cotizador.nucleo.api.JsonNeltume
import cl.puertasneltume.cotizador.nucleo.modelo.ClienteDirectorio
import cl.puertasneltume.cotizador.nucleo.modelo.Detalle
import cl.puertasneltume.cotizador.nucleo.modelo.EstadoCotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.EstadoOperativo
import cl.puertasneltume.cotizador.nucleo.modelo.Fabrica
import cl.puertasneltume.cotizador.nucleo.modelo.Listado
import cl.puertasneltume.cotizador.nucleo.modelo.Numeracion
import cl.puertasneltume.cotizador.nucleo.modelo.Papelera
import cl.puertasneltume.cotizador.nucleo.modelo.RespuestaConsulta
import cl.puertasneltume.cotizador.nucleo.modelo.Resultado
import cl.puertasneltume.cotizador.nucleo.modelo.SesionActual
import cl.puertasneltume.cotizador.nucleo.modelo.Sesiones
import cl.puertasneltume.cotizador.nucleo.modelo.Vendedoras
import cl.puertasneltume.cotizador.nucleo.reglas.avancePedido
import cl.puertasneltume.cotizador.nucleo.reglas.preguntasPendientes
import cl.puertasneltume.cotizador.nucleo.reglas.resumenTexto
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Las respuestas reales del servidor (guardadas por android/scripts/contrato.mjs) se leen con los modelos de la app.
 * Si el servidor cambia una forma que la app usa, esta prueba falla.
 */
class ContratoTest {
    private fun texto(nombre: String) = javaClass.getResource("/contrato/respuestas/$nombre.json")!!.readText()
    private fun <T> leer(nombre: String, estrategia: DeserializationStrategy<T>): T = JsonNeltume.decodeFromString(estrategia, texto(nombre))

    @Test
    fun cotizacionesEnCadaEstado() {
        val borrador = leer("detalle-borrador", Detalle.serializer()).cotizacion
        assertEquals(EstadoCotizacion.BORRADOR, borrador.estado)
        assertEquals(2, borrador.solicitudes.size)
        assertTrue(borrador.montos.total > 0 && borrador.flete > 0)
        assertTrue(resumenTexto(borrador).contains("Total:"))

        val emitida = leer("detalle-emitida", Detalle.serializer())
        assertEquals(EstadoCotizacion.EMITIDA, emitida.cotizacion.estado)
        assertTrue(emitida.cotizacion.numero != null && emitida.cotizacion.pdf != null && emitida.cotizacion.vence != null)
        assertTrue(emitida.eventos.isNotEmpty())

        val aprobada = leer("detalle-aprobada", Detalle.serializer()).cotizacion
        assertEquals(EstadoCotizacion.APROBADA, aprobada.estado)
        assertEquals(EstadoOperativo.EN_PRODUCCION, aprobada.estadoOperativo)
        assertEquals(Fabrica.PANGUIPULLI, aprobada.notas.single().fabrica)
        assertTrue(aprobada.notas.single().inicioProduccion != null)
        assertTrue(aprobada.pagos.isNotEmpty() && aprobada.comentariosInternos.isNotEmpty())
        assertEquals(5, avancePedido(aprobada).actual) // Anticipo y notas listos; falta terminar la producción.
        assertEquals("boleta", aprobada.facturacion?.documento?.clave)
    }

    @Test
    fun resultadosDeAcciones() {
        for (nombre in listOf("resultado-chat", "resultado-editar", "resultado-agregar", "resultado-emitir", "resultado-aprobar", "resultado-nota")) {
            val r = leer(nombre, Resultado.serializer())
            assertTrue(r.cotizacion.id.isNotEmpty(), nombre)
        }
        assertTrue(leer("resultado-emitir", Resultado.serializer()).archivo != null)
        assertTrue(leer("resultado-nota", Resultado.serializer()).archivo?.startsWith("nota-pedido") == true)
        assertTrue(leer("resultado-chat", Resultado.serializer()).cambios != null)
        val efimera = leer("resultado-efimera", Resultado.serializer())
        assertTrue(efimera.efimera)
        if (javaClass.getResource("/contrato/respuestas/detalle-pendiente.json") != null) {
            val pendiente = leer("detalle-pendiente", Detalle.serializer()).cotizacion
            preguntasPendientes(pendiente) // no falla con los rechazos reales
        }
    }

    @Test
    fun listadosYConsultas() {
        val listado = leer("listado", Listado.serializer())
        assertTrue(listado.total >= 1 && listado.cotizaciones.isNotEmpty())
        leer("listado-filtros", Listado.serializer())
        val papelera = leer("papelera", Papelera.serializer())
        assertTrue(papelera.borradores.isNotEmpty(), "la papelera del contrato debe traer un borrador eliminado")
        assertTrue(papelera.borradores.all { it.eliminada.isNotBlank() && it.actualizada.isNotBlank() })
        assertTrue(leer("numeracion", Numeracion.serializer()).siguiente > 0)
        assertTrue(leer("vendedoras", Vendedoras.serializer()).vendedoras.isNotEmpty())
        assertTrue(leer("catalogo", RespuestaConsulta.serializer()).productos.isNotEmpty())
        assertTrue(leer("catalogo-familia", RespuestaConsulta.serializer()).productos.all { it.familia == "MARCO" })
        val sugerencias = JsonNeltume.decodeFromJsonElement(
            ListSerializer(ClienteDirectorio.serializer()),
            JsonNeltume.parseToJsonElement(texto("clientes-sugerencias")).jsonObject["clientes"]!!,
        )
        assertTrue(sugerencias.isNotEmpty())
        assertTrue(leer("clientes-directorio", DirectorioClientes.serializer()).clientes.isNotEmpty())
        assertTrue(leer("sesion", SesionActual.serializer()).user?.email == "admin@neltume.test")
        assertTrue(leer("sesiones", Sesiones.serializer()).sesiones.any { it.actual })
    }

    @Test
    fun respuestasGenericasSonObjetos() {
        for (nombre in listOf("ajustes", "configuracion-negocio", "starken", "starken-cotizar", "usuarios", "envios"))
            JsonNeltume.decodeFromString(JsonObject.serializer(), texto(nombre))
        val tarifas = JsonNeltume.decodeFromString(JsonObject.serializer(), texto("starken-cotizar"))
        assertTrue(tarifas.containsKey("estado") || tarifas.containsKey("error"))
    }
}
