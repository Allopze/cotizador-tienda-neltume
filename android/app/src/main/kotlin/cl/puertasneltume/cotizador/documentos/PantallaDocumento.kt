package cl.puertasneltume.cotizador.documentos

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import cl.puertasneltume.cotizador.comun.LocalAvisos
import cl.puertasneltume.cotizador.comun.LocalContenedor
import cl.puertasneltume.cotizador.comun.LocalNavegador
import cl.puertasneltume.cotizador.comun.MarcoPantalla
import cl.puertasneltume.cotizador.cotizar.LocalCotizador
import cl.puertasneltume.cotizador.cotizar.urlReferencia
import cl.puertasneltume.cotizador.diseno.BotonIcono
import cl.puertasneltume.cotizador.diseno.BotonPrincipal
import cl.puertasneltume.cotizador.diseno.EstadoVacio
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Radios
import cl.puertasneltume.cotizador.nucleo.api.FalloApi
import cl.puertasneltume.cotizador.nucleo.modelo.ReferenciaItem
import coil3.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

private sealed interface EstadoDocumento {
    data object Cargando : EstadoDocumento
    data class Listo(val archivo: File, val nombre: String, val paginas: List<Bitmap>) : EstadoDocumento
    data class Error(val mensaje: String, val perdido: Boolean) : EstadoDocumento
}

/**
 * Visor de un PDF del cotizador (cotización o nota de pedido). «Compartir» abre la hoja del sistema (WhatsApp,
 * correo…) y solo está en la cotización, como en la web: la nota lleva precios de fábrica. «Guardar» deja una copia
 * donde la persona elija. Si el archivo ya no está en el servidor, administración puede regenerarlo.
 */
@Composable
fun PantallaDocumento(archivo: String, titulo: String, compartible: Boolean) {
    val api = LocalContenedor.current.api
    VisorPdf(archivo, titulo, compartible, regenerable = true) { api.documento(archivo) }
}

/** Visor de PDF genérico: descarga con la sesión de la app, muestra las páginas y ofrece compartir y guardar. */
@Composable
fun VisorPdf(archivo: String, titulo: String, compartible: Boolean, regenerable: Boolean, descargar: suspend () -> cl.puertasneltume.cotizador.nucleo.api.Descarga) {
    val contenedor = LocalContenedor.current
    val navegador = LocalNavegador.current
    val avisos = LocalAvisos.current
    val cotizador = LocalCotizador.current
    val contexto = LocalContext.current
    val alcance = rememberCoroutineScope()
    var estado by remember(archivo) { mutableStateOf<EstadoDocumento>(EstadoDocumento.Cargando) }
    var intento by remember { mutableIntStateOf(0) }
    val ancho = with(LocalDensity.current) { 1200.dp.toPx().toInt().coerceAtMost(1600) }

    LaunchedEffect(archivo, intento) {
        estado = EstadoDocumento.Cargando
        estado = try {
            val d = descargar()
            val nombre = d.nombre ?: archivo
            val local = withContext(Dispatchers.IO) {
                File(File(contexto.cacheDir, "documentos").apply { mkdirs() }, nombre.replace('/', '-')).apply { writeBytes(d.bytes) }
            }
            EstadoDocumento.Listo(local, nombre, withContext(Dispatchers.IO) { renderizar(local, ancho) })
        } catch (e: FalloApi) {
            EstadoDocumento.Error(e.message ?: "", e.status == 404)
        } catch (e: Exception) {
            EstadoDocumento.Error("No se pudo abrir el PDF.", false)
        }
    }
    val guardar = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/pdf")) { destino ->
        val listo = estado as? EstadoDocumento.Listo ?: return@rememberLauncherForActivityResult
        if (destino != null) alcance.launch {
            val ok = withContext(Dispatchers.IO) {
                runCatching { contexto.contentResolver.openOutputStream(destino)!!.use { it.write(listo.archivo.readBytes()) } }.isSuccess
            }
            avisos.mostrar(if (ok) "PDF guardado." else "No se pudo guardar el PDF.")
        }
    }

    MarcoPantalla(titulo, alVolver = { navegador.volver() }, acciones = {
        val listo = estado as? EstadoDocumento.Listo
        if (listo != null) {
            if (compartible) BotonIcono(Iconos.Compartir, "Compartir", { compartir(contexto, listo.archivo, listo.nombre) })
            BotonIcono(Iconos.Descargar, "Guardar", { guardar.launch(listo.nombre) })
        }
    }) {
        when (val e = estado) {
            EstadoDocumento.Cargando -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Neltume.colores.verde)
            }
            is EstadoDocumento.Error -> {
                val q = cotizador.q
                val propio = regenerable && q != null && (q.pdf == archivo || q.notas.any { it.pdf == archivo })
                EstadoVacio(Iconos.Archivo, if (e.perdido) "El PDF ya no está en el servidor" else "No se pudo abrir", e.mensaje) {
                    if (e.perdido && propio && contenedor.sesion.esAdmin) BotonPrincipal("Regenerar PDF", {
                        val nota = q!!.notas.firstOrNull { it.pdf == archivo }
                        cotizador.regenerarPdf(if (nota != null) "nota" else "cotizacion", nota?.fabrica)
                        navegador.volver()
                    }, icono = Iconos.Recargar)
                    else if (!e.perdido) BotonPrincipal("Reintentar", { intento++ }, icono = Iconos.Recargar)
                    else androidx.compose.material3.Text("Pide a una cuenta administradora que lo regenere.", color = Neltume.colores.apagado)
                }
            }
            is EstadoDocumento.Listo -> PaginasConZoom(e.paginas)
        }
    }
}

/** Cada página como imagen, con zoom de dos dedos y doble toque. */
@Composable
private fun PaginasConZoom(paginas: List<Bitmap>) {
    var escala by remember { mutableFloatStateOf(1f) }
    var desplazamiento by remember { mutableStateOf(Offset.Zero) }
    val transformable = rememberTransformableState { zoom, pan, _ ->
        escala = (escala * zoom).coerceIn(1f, 4f)
        desplazamiento = if (escala == 1f) Offset.Zero else desplazamiento + pan
    }
    Box(Modifier.fillMaxSize().background(Neltume.colores.tonal)) {
        LazyColumn(
            Modifier
                .fillMaxSize()
                .pointerInput(Unit) {
                    detectTapGestures(onDoubleTap = {
                        escala = if (escala > 1f) 1f else 2f
                        desplazamiento = Offset.Zero
                    })
                }
                .transformable(transformable, lockRotationOnZoomPan = true, enabled = true)
                .graphicsLayer {
                    scaleX = escala
                    scaleY = escala
                    translationX = desplazamiento.x
                    translationY = desplazamiento.y
                },
            contentPadding = PaddingValues(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            userScrollEnabled = escala == 1f,
        ) {
            itemsIndexed(paginas) { i, pagina ->
                Image(
                    pagina.asImageBitmap(),
                    contentDescription = "Página ${i + 1} de ${paginas.size}",
                    contentScale = ContentScale.FillWidth,
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(pagina.width.toFloat() / pagina.height)
                        .shadow(2.dp, Radios.sm)
                        .clip(Radios.sm),
                )
            }
        }
    }
}

private fun renderizar(archivo: File, ancho: Int): List<Bitmap> {
    ParcelFileDescriptor.open(archivo, ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
        PdfRenderer(fd).use { pdf ->
            return (0 until pdf.pageCount).map { i ->
                pdf.openPage(i).use { pagina ->
                    val alto = (ancho.toFloat() * pagina.height / pagina.width).toInt()
                    Bitmap.createBitmap(ancho, alto, Bitmap.Config.ARGB_8888).also { bmp ->
                        bmp.eraseColor(Color.WHITE)
                        pagina.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    }
                }
            }
        }
    }
}

/** La hoja de compartir del sistema con el PDF (WhatsApp, correo, Drive…). */
fun compartir(contexto: Context, archivo: File, nombre: String) {
    val uri = FileProvider.getUriForFile(contexto, "${contexto.packageName}.archivos", archivo)
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "application/pdf"
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_SUBJECT, nombre.removeSuffix(".pdf"))
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    contexto.startActivity(Intent.createChooser(intent, "Compartir ${nombre.removeSuffix(".pdf")}"))
}

/** Una referencia del cliente: la imagen con zoom o, si es PDF, el visor. Siempre con la sesión de la app. */
@Composable
fun PantallaReferencia(archivo: String, nombre: String, tipo: String) {
    val contenedor = LocalContenedor.current
    val navegador = LocalNavegador.current
    val avisos = LocalAvisos.current
    val contexto = LocalContext.current
    val alcance = rememberCoroutineScope()
    val r = ReferenciaItem(archivo, nombre, tipo)
    val bajar: suspend () -> cl.puertasneltume.cotizador.nucleo.api.Descarga =
        { contenedor.http.descargar("api/referencias/$archivo", mapOf("nombre" to nombre)) }
    if (!r.esImagen) {
        VisorPdf(archivo, nombre, compartible = true, regenerable = false, descargar = bajar)
        return
    }
    MarcoPantalla(nombre, alVolver = { navegador.volver() }, acciones = {
        BotonIcono(Iconos.Compartir, "Compartir", {
            alcance.launch {
                try {
                    val d = bajar()
                    val local = withContext(Dispatchers.IO) {
                        File(File(contexto.cacheDir, "documentos").apply { mkdirs() }, nombre.replace('/', '-')).apply { writeBytes(d.bytes) }
                    }
                    val uri = FileProvider.getUriForFile(contexto, "${contexto.packageName}.archivos", local)
                    contexto.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                        type = tipo
                        putExtra(Intent.EXTRA_STREAM, uri)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }, "Compartir $nombre"))
                } catch (e: FalloApi) {
                    avisos.mostrar(e.message ?: "No se pudo descargar la imagen.")
                }
            }
        })
    }) {
        var escala by remember { mutableFloatStateOf(1f) }
        var desplazamiento by remember { mutableStateOf(Offset.Zero) }
        val transformable = rememberTransformableState { zoom, pan, _ ->
            escala = (escala * zoom).coerceIn(1f, 5f)
            desplazamiento = if (escala == 1f) Offset.Zero else desplazamiento + pan
        }
        Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color.Black).transformable(transformable), contentAlignment = Alignment.Center) {
            AsyncImage(
                urlReferencia(contenedor.servidor, r),
                nombre,
                Modifier.fillMaxSize().graphicsLayer {
                    scaleX = escala
                    scaleY = escala
                    translationX = desplazamiento.x
                    translationY = desplazamiento.y
                }.semantics { contentDescription = nombre },
                contentScale = ContentScale.Fit,
            )
        }
    }
}
