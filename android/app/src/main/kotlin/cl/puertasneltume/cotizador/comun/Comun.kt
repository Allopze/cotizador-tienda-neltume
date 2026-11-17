package cl.puertasneltume.cotizador.comun

import android.content.ClipData
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.Clipboard
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import cl.puertasneltume.cotizador.Contenedor
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Radios
import cl.puertasneltume.cotizador.navegacion.Navegador
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

val LocalContenedor = staticCompositionLocalOf<Contenedor> { error("Falta el contenedor") }
val LocalNavegador = staticCompositionLocalOf<Navegador> { error("Falta el navegador") }
val LocalAvisos = staticCompositionLocalOf<Avisos> { error("Faltan los avisos") }

/**
 * Alto de lo que una pantalla tiene fijo abajo (la barra del total): los avisos se muestran encima y no tapan la
 * acción principal.
 */
@Stable
class MargenAvisos {
    var valor by androidx.compose.runtime.mutableStateOf(0.dp)
}

val LocalMargenAvisos = staticCompositionLocalOf { MargenAvisos() }

/** ViewModel con sus dependencias del contenedor. */
@Composable
inline fun <reified VM : ViewModel> vm(key: String? = null, crossinline crear: (Contenedor) -> VM): VM {
    val contenedor = LocalContenedor.current
    return viewModel(key = key, factory = viewModelFactory { initializer { crear(contenedor) } })
}

/**
 * Avisos breves al pie de la pantalla (los «toasts» de la web), con una acción opcional como «Deshacer».
 * Uno a la vez: el siguiente reemplaza al anterior.
 */
@Stable
class Avisos(private val alcance: CoroutineScope) {
    val estado = SnackbarHostState()

    fun mostrar(texto: String, accion: String? = null, largo: Boolean = false, alAccion: () -> Unit = {}) {
        alcance.launch {
            estado.currentSnackbarData?.dismiss()
            val r = estado.showSnackbar(
                texto,
                actionLabel = accion,
                withDismissAction = accion == null && largo,
                duration = when {
                    accion != null -> SnackbarDuration.Long
                    largo -> SnackbarDuration.Long
                    else -> SnackbarDuration.Short
                },
            )
            if (r == SnackbarResult.ActionPerformed) alAccion()
        }
    }
}

@Composable
fun HostAvisos(avisos: Avisos, modifier: Modifier = Modifier) {
    val c = Neltume.colores
    SnackbarHost(avisos.estado, modifier) { datos ->
        Snackbar(
            modifier = Modifier.padding(horizontal = 12.dp),
            shape = Radios.lg,
            containerColor = c.bosque,
            contentColor = c.bosqueTinta,
            action = datos.visuals.actionLabel?.let { etiqueta ->
                {
                    TextButton(onClick = { datos.performAction() }) {
                        Text(etiqueta, color = if (c.oscuro) c.verde else c.verdeVelo, style = MaterialTheme.typography.labelLarge)
                    }
                }
            },
        ) { Text(datos.visuals.message, style = MaterialTheme.typography.bodyMedium) }
    }
}

/** Copia al portapapeles; en Android 13+ el sistema ya avisa, antes se avisa con un toast. */
suspend fun copiar(portapapeles: Clipboard, contexto: Context, texto: String, rotulo: String = "Cotizador Neltume") {
    portapapeles.setClipEntry(ClipEntry(ClipData.newPlainText(rotulo, texto)))
    if (android.os.Build.VERSION.SDK_INT < 33) Toast.makeText(contexto, "Copiado", Toast.LENGTH_SHORT).show()
}

/** UUID para `nuevoId` (reintentos sin duplicar borradores). */
fun idNuevo(): String = java.util.UUID.randomUUID().toString()
