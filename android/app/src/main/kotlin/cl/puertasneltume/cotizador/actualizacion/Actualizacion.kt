package cl.puertasneltume.cotizador.actualizacion

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import cl.puertasneltume.cotizador.BuildConfig
import cl.puertasneltume.cotizador.Contenedor
import cl.puertasneltume.cotizador.comun.vm
import cl.puertasneltume.cotizador.diseno.Aviso
import cl.puertasneltume.cotizador.diseno.BotonPrincipal
import cl.puertasneltume.cotizador.diseno.BotonSecundario
import cl.puertasneltume.cotizador.diseno.EstadoVacio
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Radios
import cl.puertasneltume.cotizador.diseno.TonoAviso
import cl.puertasneltume.cotizador.nucleo.api.FalloApi
import cl.puertasneltume.cotizador.nucleo.reglas.tamanoReferencia
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import java.io.File
import java.security.MessageDigest

/** Lo que publica el servidor en `/api/app/version` (src/servidor/app-movil.ts). */
@Serializable
data class VersionPublicada(
    val versionCode: Int,
    val versionName: String,
    val sha256: String,
    val minimo: Int? = null,
    val notas: String? = null,
    val tamano: Long = 0,
)

data class EstadoActualizacion(
    val disponible: VersionPublicada? = null,
    val obligatoria: Boolean = false,
    val mostrarAviso: Boolean = false,
    val descargando: Boolean = false,
    val error: String? = null,
    /** El teléfono pide permitir la instalación de apps desde el cotizador antes de instalar. */
    val faltaPermiso: Boolean = false,
)

/**
 * Autoactualización del APK (sin Google Play): la app consulta la versión publicada al abrirse y al volver; si hay
 * una más nueva la ofrece, la descarga con la sesión, verifica su sha256 y abre el instalador del sistema. Por debajo
 * de la versión mínima no deja seguir.
 */
class ActualizacionViewModel(private val c: Contenedor) : ViewModel() {
    private val _estado = MutableStateFlow(EstadoActualizacion())
    val estado: StateFlow<EstadoActualizacion> = _estado.asStateFlow()
    private var ultimaConsulta = 0L

    fun consultar() {
        if (System.currentTimeMillis() - ultimaConsulta < 30 * 60_000 && _estado.value.disponible != null) return
        ultimaConsulta = System.currentTimeMillis()
        viewModelScope.launch {
            val v = try {
                c.api.http.obtener(VersionPublicada.serializer(), "api/app/version")
            } catch (e: FalloApi) {
                return@launch // 404 sin app publicada, o sin red: se reintenta al volver.
            }
            val actual = BuildConfig.VERSION_CODE
            if (v.versionCode <= actual) {
                _estado.update { EstadoActualizacion() }
                return@launch
            }
            val obligatoria = (v.minimo ?: 0) > actual
            val descartada = c.preferencias.avisoActualizacion() == v.versionName
            _estado.update { it.copy(disponible = v, obligatoria = obligatoria, mostrarAviso = obligatoria || !descartada) }
        }
    }

    fun descartar() {
        val v = _estado.value.disponible ?: return
        _estado.update { it.copy(mostrarAviso = false) }
        viewModelScope.launch { c.preferencias.guardarAvisoActualizacion(v.versionName) }
    }

    fun actualizar(contexto: Context) {
        val v = _estado.value.disponible ?: return
        if (!contexto.packageManager.canRequestPackageInstalls()) {
            _estado.update { it.copy(faltaPermiso = true) }
            contexto.startActivity(
                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${contexto.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            return
        }
        viewModelScope.launch {
            _estado.update { it.copy(descargando = true, error = null, faltaPermiso = false) }
            try {
                val d = c.api.http.descargar("api/app/apk")
                val hash = MessageDigest.getInstance("SHA-256").digest(d.bytes).joinToString("") { "%02x".format(it) }
                if (hash != v.sha256) throw IllegalStateException("El archivo descargado no coincide con la versión publicada. Intenta de nuevo.")
                val apk = withContext(Dispatchers.IO) {
                    File(File(contexto.cacheDir, "actualizaciones").apply { mkdirs() }, "cotizador-neltume-${v.versionName}.apk").apply { writeBytes(d.bytes) }
                }
                val uri = FileProvider.getUriForFile(contexto, "${contexto.packageName}.archivos", apk)
                contexto.startActivity(
                    Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            } catch (e: FalloApi) {
                _estado.update { it.copy(error = e.message) }
            } catch (e: Exception) {
                _estado.update { it.copy(error = e.message ?: "No se pudo descargar la actualización.") }
            } finally {
                _estado.update { it.copy(descargando = false) }
            }
        }
    }
}

/**
 * Aviso de versión nueva (diálogo) o, si la instalada quedó bajo la mínima, la pantalla que pide actualizar.
 * Devuelve true cuando la app no puede seguir.
 */
@Composable
fun ControlActualizacion(): Boolean {
    val vm = vm(key = "actualizacion") { ActualizacionViewModel(it) }
    val e by vm.estado.collectAsStateWithLifecycle()
    val contexto = LocalContext.current
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { vm.consultar() }
    val v = e.disponible ?: return false
    if (e.obligatoria) {
        PantallaActualizar(v, e, actualizar = { vm.actualizar(contexto) })
        return true
    }
    if (e.mostrarAviso) {
        val c = Neltume.colores
        AlertDialog(
            onDismissRequest = vm::descartar,
            shape = Radios.hoja,
            containerColor = c.superficie,
            title = { Text("Hay una versión nueva", style = MaterialTheme.typography.headlineSmall, color = c.tinta) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "Cotizador Neltume ${v.versionName}${if (v.tamano > 0) " · ${tamanoReferencia(v.tamano)}" else ""}. Tienes la ${BuildConfig.VERSION_NAME}.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = c.tintaSuave,
                    )
                    v.notas?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = c.tinta) }
                    if (e.faltaPermiso) Aviso("Permite «Instalar apps desconocidas» para el cotizador y vuelve a tocar «Actualizar».", tono = TonoAviso.ATENCION)
                    e.error?.let { Aviso(it, tono = TonoAviso.PELIGRO) }
                    if (e.descargando) LinearProgressIndicator(Modifier.fillMaxWidth(), color = c.verde, trackColor = c.tonal)
                }
            },
            confirmButton = { BotonPrincipal("Actualizar", { vm.actualizar(contexto) }, cargando = e.descargando, icono = Iconos.Descargar) },
            dismissButton = { BotonSecundario("Más tarde", vm::descartar, habilitado = !e.descargando) },
        )
    }
    return false
}

@Composable
private fun PantallaActualizar(v: VersionPublicada, e: EstadoActualizacion, actualizar: () -> Unit) {
    val c = Neltume.colores
    Column(Modifier.fillMaxSize().background(c.papel).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Column(Modifier.widthIn(max = 480.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            EstadoVacio(
                Iconos.Descargar,
                "Actualiza la app",
                "Esta versión (${BuildConfig.VERSION_NAME}) ya no funciona con el cotizador. Instala la ${v.versionName} para continuar; tus datos están en el servidor y no se pierden.",
            )
            if (e.faltaPermiso) Aviso("Permite «Instalar apps desconocidas» para el cotizador y vuelve a tocar «Actualizar».", tono = TonoAviso.ATENCION)
            e.error?.let { Aviso(it, tono = TonoAviso.PELIGRO) }
            Spacer(Modifier.height(16.dp))
            BotonPrincipal("Actualizar", actualizar, Modifier.fillMaxWidth(), cargando = e.descargando, icono = Iconos.Descargar)
        }
    }
}
