package cl.puertasneltume.cotizador

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation3.runtime.NavBackStack
import androidx.navigation3.runtime.NavKey
import androidx.test.core.app.ApplicationProvider
import cl.puertasneltume.cotizador.comun.Avisos
import cl.puertasneltume.cotizador.comun.LocalAvisos
import cl.puertasneltume.cotizador.comun.LocalContenedor
import cl.puertasneltume.cotizador.comun.LocalNavegador
import cl.puertasneltume.cotizador.cotizar.AccionesCotizar
import cl.puertasneltume.cotizador.cotizar.CotizadorViewModel
import cl.puertasneltume.cotizador.cotizar.EstadoCotizador
import cl.puertasneltume.cotizador.cotizar.LocalCotizador
import cl.puertasneltume.cotizador.cotizar.PanelChat
import cl.puertasneltume.cotizador.cotizar.PanelCotizacion
import cl.puertasneltume.cotizador.datos.CifradorEnClaro
import cl.puertasneltume.cotizador.diseno.Aviso
import cl.puertasneltume.cotizador.diseno.BotonPrincipal
import cl.puertasneltume.cotizador.diseno.BotonSecundario
import cl.puertasneltume.cotizador.diseno.ChipFiltro
import cl.puertasneltume.cotizador.diseno.Hoja
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.LineaPasos
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.PildoraEstado
import cl.puertasneltume.cotizador.diseno.TemaNeltume
import cl.puertasneltume.cotizador.diseno.TituloPantalla
import cl.puertasneltume.cotizador.diseno.TonoAviso
import cl.puertasneltume.cotizador.diseno.TotalAnimado
import cl.puertasneltume.cotizador.navegacion.Navegador
import cl.puertasneltume.cotizador.navegacion.Seccion
import cl.puertasneltume.cotizador.nucleo.api.JsonNeltume
import cl.puertasneltume.cotizador.nucleo.modelo.Cotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.Detalle
import cl.puertasneltume.cotizador.nucleo.modelo.EstadoCotizacion
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Capturas de las pantallas principales con datos reales del servidor (las respuestas del contrato), en tema claro y
 * oscuro, en un teléfono y en una tablet. `./gradlew :app:recordRoborazziDebug` las guarda en app/build/outputs/roborazzi;
 * `verifyRoborazziDebug` compara contra las guardadas.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], qualifiers = "w411dp-h891dp-xxhdpi")
class CapturasTest {
    private val contenedor by lazy {
        Contenedor(ApplicationProvider.getApplicationContext(), servidor = "http://127.0.0.1:9", cifrador = CifradorEnClaro())
    }

    private fun cotizacion(nombre: String): Cotizacion = JsonNeltume.decodeFromString(
        Detalle.serializer(),
        javaClass.getResource("/contrato/respuestas/$nombre.json")!!.readText(),
    ).cotizacion

    private val acciones = AccionesCotizar({}, {}, {}, {}, {}, {}, {}, {})

    @Composable
    private fun Marco(oscuro: Boolean, contenido: @Composable () -> Unit) {
        val alcance = rememberCoroutineScope()
        val vm = remember { CotizadorViewModel(contenedor) }
        val navegador = remember {
            Navegador(Seccion.entries.associateWith { NavBackStack<NavKey>(it.raiz) }, Seccion.COTIZAR)
        }
        TemaNeltume(oscuro) {
            CompositionLocalProvider(
                LocalContenedor provides contenedor,
                LocalNavegador provides navegador,
                LocalAvisos provides remember { Avisos(alcance) },
                LocalCotizador provides vm,
            ) { Box(Modifier.fillMaxSize().background(Neltume.colores.papel)) { contenido() } }
        }
    }

    private fun panel(nombre: String, archivo: String, oscuro: Boolean) = captureRoboImage("build/capturas/$archivo.png") {
        Marco(oscuro) {
            val vm = LocalCotizador.current
            PanelCotizacion(vm, EstadoCotizador(cargando = false, cotizacion = cotizacion(nombre)), admin = true, acciones = acciones)
        }
    }

    @Test fun borradorClaro() = panel("detalle-borrador", "panel-borrador-claro", false)
    @Test fun borradorOscuro() = panel("detalle-borrador", "panel-borrador-oscuro", true)
    @Test fun emitidaClaro() = panel("detalle-emitida", "panel-emitida-claro", false)
    @Test fun aprobadaClaro() = panel("detalle-aprobada", "panel-aprobada-claro", false)
    @Test fun aprobadaOscuro() = panel("detalle-aprobada", "panel-aprobada-oscuro", true)

    @Config(qualifiers = "w1280dp-h800dp-mdpi")
    @Test fun aprobadaTablet() = panel("detalle-aprobada", "panel-aprobada-tablet", false)

    @Test fun chatClaro() = captureRoboImage("build/capturas/chat-claro.png") {
        Marco(false) {
            val vm = LocalCotizador.current
            PanelChat(vm, EstadoCotizador(cargando = false, cotizacion = cotizacion("detalle-borrador")), acciones)
        }
    }

    @Test fun chatVacioOscuro() = captureRoboImage("build/capturas/chat-vacio-oscuro.png") {
        Marco(true) {
            val vm = LocalCotizador.current
            PanelChat(vm, EstadoCotizador(cargando = false), acciones)
        }
    }

    /** El sistema de diseño en una hoja: botones, píldoras de estado, pasos, total, avisos y chips. */
    @Test fun sistemaDeDiseno() {
        for (oscuro in listOf(false, true)) captureRoboImage("build/capturas/diseno-${if (oscuro) "oscuro" else "claro"}.png") {
            Marco(oscuro) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    TituloPantalla("Historial", subtitulo = "51 registros")
                    Hoja {
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            BotonPrincipal("Emitir y generar PDF", {}, icono = Iconos.Archivo)
                            BotonSecundario("Repartir entre fábricas", {}, icono = Iconos.Fabrica)
                            androidx.compose.foundation.layout.Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                EstadoCotizacion.entries.forEach { PildoraEstado(it) }
                            }
                            LineaPasos(listOf(true, true, true, false, false, false, false, false), 3)
                            TotalAnimado(1_027_664)
                            Aviso("Faltan datos para facturar: giro.", tono = TonoAviso.ATENCION)
                            androidx.compose.foundation.layout.Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                ChipFiltro("Todas", true, {})
                                ChipFiltro("Emitidas", false, {})
                            }
                        }
                    }
                }
            }
        }
    }
}
