package cl.puertasneltume.cotizador.ajustes

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cl.puertasneltume.cotizador.comun.LocalNavegador
import cl.puertasneltume.cotizador.diseno.Divisor
import cl.puertasneltume.cotizador.diseno.EstadoVacio
import cl.puertasneltume.cotizador.diseno.FilaNavegable
import cl.puertasneltume.cotizador.diseno.Hoja
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.Neltume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Una licencia incluida en `assets/licencias/`. Solo estas se pueden abrir. */
private class Licencia(val archivo: String, val nombre: String, val detalle: String)

private val LICENCIAS = listOf(
    Licencia("OFL-host-grotesk.txt", "Host Grotesk", "Tipografía del texto · SIL Open Font License 1.1"),
    Licencia("OFL-newsreader.txt", "Newsreader", "Tipografía de los títulos · SIL Open Font License 1.1"),
    Licencia("ISC-lucide.txt", "Lucide", "Íconos · Licencia ISC"),
)

@Composable
internal fun PantallaLicencias() {
    val navegador = LocalNavegador.current
    MarcoSeccion("Licencias") {
        Intro("La app usa estas tipografías e íconos de código abierto. Toca uno para leer su licencia.")
        Hoja(relleno = PaddingValues(6.dp)) {
            LICENCIAS.forEachIndexed { i, l ->
                if (i > 0) Divisor(Modifier.padding(start = 60.dp, end = 12.dp))
                FilaNavegable(l.nombre, { navegador.empujar(rutaLicencia(l.archivo)) }, detalle = l.detalle, icono = Iconos.Libro)
            }
        }
    }
}

@Composable
internal fun PantallaLicencia(archivo: String) {
    val licencia = LICENCIAS.firstOrNull { it.archivo == archivo }
    val contexto = LocalContext.current
    val texto by produceState<String?>(null, archivo) {
        value = if (licencia == null) "" else withContext(Dispatchers.IO) {
            runCatching { contexto.assets.open("licencias/${licencia.archivo}").bufferedReader().use { it.readText() } }.getOrDefault("")
        }
    }
    MarcoSeccion(licencia?.nombre ?: "Licencia") {
        when (val t = texto) {
            null -> Cargando("Cargando la licencia…")
            "" -> EstadoVacio(Iconos.Libro, "No se pudo abrir la licencia", "El texto no está incluido en esta versión de la app.")
            else -> Hoja {
                SelectionContainer {
                    Text(
                        t.trim(),
                        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 18.sp),
                        color = Neltume.colores.tintaSuave,
                    )
                }
            }
        }
    }
}
