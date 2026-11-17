package cl.puertasneltume.cotizador.ajustes

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import cl.puertasneltume.cotizador.BuildConfig
import cl.puertasneltume.cotizador.comun.LocalContenedor
import cl.puertasneltume.cotizador.comun.LocalNavegador
import cl.puertasneltume.cotizador.cotizar.DialogoConfirmacion
import cl.puertasneltume.cotizador.diseno.Avatar
import cl.puertasneltume.cotizador.diseno.BotonSecundario
import cl.puertasneltume.cotizador.diseno.Divisor
import cl.puertasneltume.cotizador.diseno.EstadoVacio
import cl.puertasneltume.cotizador.diseno.FilaNavegable
import cl.puertasneltume.cotizador.diseno.Hoja
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Pildora
import cl.puertasneltume.cotizador.diseno.Radios
import cl.puertasneltume.cotizador.diseno.TituloPantalla
import cl.puertasneltume.cotizador.navegacion.Ruta
import cl.puertasneltume.cotizador.sesion.EstadoSesion
import kotlinx.coroutines.launch

/**
 * Ajustes: la cuenta arriba (con «Cerrar sesión»), las secciones de la web como filas y, al pie, la guía, las
 * licencias y la versión de la app.
 */
@Composable
fun PantallaAjustes() {
    val c = Neltume.colores
    val contenedor = LocalContenedor.current
    val navegador = LocalNavegador.current
    val estado by contenedor.sesion.estado.collectAsState()
    val usuario = (estado as? EstadoSesion.Dentro)?.usuario
    val admin = usuario?.role?.split(',')?.map { it.trim() }?.contains("admin") ?: false
    var confirmarSalida by remember { mutableStateOf(false) }
    var saliendo by remember { mutableStateOf(false) }

    Box(
        Modifier.fillMaxSize().background(c.papel).verticalScroll(rememberScrollState()),
        contentAlignment = Alignment.TopCenter,
    ) {
        Column(
            Modifier
                .widthIn(max = ANCHO_AJUSTES)
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.statusBars)
                .padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            TituloPantalla("Ajustes")

            // La cuenta: como el menú de la cuenta en el encabezado de la web.
            val nombre = usuario?.name?.takeIf { it.isNotBlank() } ?: usuario?.email?.takeIf { it.isNotBlank() } ?: "Tu cuenta"
            Hoja {
                Row(Modifier.semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically) {
                    Avatar(nombre, tamano = 52.dp)
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(nombre, style = MaterialTheme.typography.titleMedium, color = c.tinta, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        val correo = usuario?.email.orEmpty()
                        if (correo.isNotBlank() && correo != nombre) {
                            Text(correo, style = MaterialTheme.typography.bodySmall, color = c.apagado, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        if (admin) {
                            Spacer(Modifier.height(6.dp))
                            Pildora("Administradora", c.verdeVelo, c.verde, icono = Iconos.Escudo)
                        }
                    }
                }
                Spacer(Modifier.height(14.dp))
                BotonSecundario(
                    if (saliendo) "Saliendo…" else "Cerrar sesión",
                    { confirmarSalida = true },
                    Modifier.fillMaxWidth(),
                    icono = Iconos.Salir,
                    cargando = saliendo,
                )
            }

            Ceja("Configuración", Modifier.padding(top = 4.dp, start = 4.dp))
            Hoja(relleno = PaddingValues(6.dp)) {
                SeccionAjustes.visibles(admin).forEachIndexed { i, s ->
                    if (i > 0) Divisor(Modifier.padding(start = 60.dp, end = 12.dp))
                    FilaNavegable(s.titulo, { navegador.empujar(Ruta.AjustesSeccion(s.id)) }, detalle = s.detalle, icono = s.icono)
                }
            }

            Ceja("Ayuda", Modifier.padding(top = 4.dp, start = 4.dp))
            Hoja(relleno = PaddingValues(6.dp)) {
                FilaNavegable(
                    "Cómo funciona",
                    { navegador.empujar(Ruta.Ayuda) },
                    detalle = "Los pasos de una cotización, qué significa cada estado y cómo deshacer",
                    icono = Iconos.Ayuda,
                )
                Divisor(Modifier.padding(start = 60.dp, end = 12.dp))
                FilaNavegable(
                    "Licencias",
                    { navegador.empujar(Ruta.AjustesSeccion(SECCION_LICENCIAS)) },
                    detalle = "Tipografías e íconos de código abierto que usa la app",
                    icono = Iconos.Libro,
                )
                Divisor(Modifier.padding(start = 60.dp, end = 12.dp))
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 12.dp, vertical = 10.dp).semantics(mergeDescendants = true) {},
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(36.dp).clip(Radios.md).background(c.tonal), contentAlignment = Alignment.Center) {
                        Icon(Iconos.Info, null, tint = c.tintaSuave, modifier = Modifier.size(18.dp))
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Versión de la app", style = MaterialTheme.typography.titleSmall, color = c.tinta)
                        Text(BuildConfig.VERSION_NAME, style = MaterialTheme.typography.bodySmall, color = c.apagado)
                    }
                }
            }

            Column(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("NELTUME / Hecho en madera.", style = MaterialTheme.typography.labelSmall, color = c.apagado, textAlign = TextAlign.Center)
                Text("Asistente de cotizaciones · Uso interno", style = MaterialTheme.typography.labelSmall, color = c.apagado, textAlign = TextAlign.Center)
            }
        }
    }

    if (confirmarSalida) {
        DialogoConfirmacion(
            "Cerrar sesión",
            "Para volver a entrar necesitarás tu correo y tu contraseña. El mensaje del chat que no hayas enviado se descarta.",
            "Cerrar sesión",
        ) { ok ->
            confirmarSalida = false
            if (ok && !saliendo) {
                saliendo = true
                // En el alcance de la app: al salir, esta pantalla deja de existir antes de que termine.
                contenedor.alcance.launch { contenedor.sesion.salir() }
            }
        }
    }
}

internal const val SECCION_LICENCIAS = "licencias"
private const val PREFIJO_LICENCIA = "licencia/"
private const val PREFIJO_PDF_PRUEBA = "prueba-pdf/"

/** Ruta interna del PDF de una prueba de conexión (`api/ajustes/conexion/pruebas/<id>`). */
internal fun rutaPdfPrueba(id: Long, codigo: String) = Ruta.AjustesSeccion("$PREFIJO_PDF_PRUEBA$id/$codigo")

internal fun rutaLicencia(archivo: String) = Ruta.AjustesSeccion("$PREFIJO_LICENCIA$archivo")

/** Una sección de Ajustes (`Ruta.AjustesSeccion`), o una subpantalla suya (licencias, PDF de una prueba). */
@Composable
fun PantallaSeccionAjustes(seccion: String) {
    val contenedor = LocalContenedor.current
    val estado by contenedor.sesion.estado.collectAsState()
    val admin = (estado as? EstadoSesion.Dentro)?.usuario?.role?.split(',')?.map { it.trim() }?.contains("admin") ?: false
    when {
        seccion == SECCION_LICENCIAS -> PantallaLicencias()
        seccion.startsWith(PREFIJO_LICENCIA) -> PantallaLicencia(seccion.removePrefix(PREFIJO_LICENCIA))
        seccion.startsWith(PREFIJO_PDF_PRUEBA) -> {
            val partes = seccion.removePrefix(PREFIJO_PDF_PRUEBA).split('/')
            PdfPrueba(partes[0], partes.getOrNull(1))
        }
        else -> when (SeccionAjustes.de(seccion)?.takeIf { admin || !it.admin }) {
            SeccionAjustes.CUENTA -> SeccionCuenta()
            SeccionAjustes.ASISTENTE -> SeccionAsistente()
            SeccionAjustes.EMPRESA -> SeccionEmpresa()
            SeccionAjustes.PRECIOS -> SeccionPrecios()
            SeccionAjustes.COTIZACIONES -> SeccionCotizaciones()
            SeccionAjustes.STARKEN -> SeccionStarken()
            SeccionAjustes.FABRICA -> SeccionConexionFabrica()
            SeccionAjustes.USUARIOS -> SeccionUsuarios()
            null -> MarcoSeccion("Ajustes") {
                EstadoVacio(
                    Iconos.Candado,
                    "Sección no disponible",
                    "Esta sección es solo para quien administra el cotizador.",
                )
            }
        }
    }
}
