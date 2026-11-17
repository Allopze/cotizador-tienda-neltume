package cl.puertasneltume.cotizador.cotizar

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import cl.puertasneltume.cotizador.comun.LocalContenedor
import cl.puertasneltume.cotizador.comun.LocalNavegador
import cl.puertasneltume.cotizador.diseno.Aviso
import cl.puertasneltume.cotizador.diseno.BotonIcono
import cl.puertasneltume.cotizador.diseno.BotonSecundario
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Radios
import cl.puertasneltume.cotizador.diseno.TituloSeccion
import cl.puertasneltume.cotizador.diseno.TonoAviso
import cl.puertasneltume.cotizador.navegacion.Ruta
import cl.puertasneltume.cotizador.nucleo.api.ArchivoSubida
import cl.puertasneltume.cotizador.nucleo.api.FalloApi
import cl.puertasneltume.cotizador.nucleo.api.JsonNeltume
import cl.puertasneltume.cotizador.nucleo.modelo.Cotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.ReferenciaItem
import cl.puertasneltume.cotizador.nucleo.reglas.MAX_BYTES_REFERENCIA
import cl.puertasneltume.cotizador.nucleo.reglas.MAX_REFERENCIAS_ITEM
import cl.puertasneltume.cotizador.nucleo.reglas.etiquetaTipoReferencia
import cl.puertasneltume.cotizador.nucleo.reglas.tamanoReferencia
import coil3.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File

/** URL de una referencia en el servidor (`urlReferencia`). */
fun urlReferencia(servidor: String, r: ReferenciaItem, descargar: Boolean = false): String =
    "${servidor.trimEnd('/')}/api/referencias/${r.archivo}?nombre=${Uri.encode(r.nombre)}${if (descargar) "&descargar=1" else ""}"

/**
 * Referencias del cliente para un ítem (fotos o PDF). Se suben al servidor y la lista se guarda con `editar`; nunca
 * pasan al catálogo. Hasta 10 por ítem y 10 MB cada una.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun HojaReferencias(q: Cotizacion, v: VistaItem, editable: Boolean, vm: CotizadorViewModel, alCerrar: () -> Unit) {
    val c = Neltume.colores
    val contenedor = LocalContenedor.current
    val navegador = LocalNavegador.current
    val contexto = LocalContext.current
    val alcance = rememberCoroutineScope()
    val actuales = v.solicitud.referencias
    var subiendo by remember { androidx.compose.runtime.mutableIntStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }
    var fotoPendiente by remember { mutableStateOf<Uri?>(null) }

    fun subir(uris: List<Uri>) {
        if (uris.isEmpty()) return
        val cupo = MAX_REFERENCIAS_ITEM - actuales.size
        if (cupo <= 0) {
            error = "Cada ítem admite hasta $MAX_REFERENCIAS_ITEM referencias."
            return
        }
        alcance.launch {
            error = null
            val nuevas = mutableListOf<ReferenciaItem>()
            for (uri in uris.take(cupo)) {
                subiendo++
                try {
                    val archivo = withContext(Dispatchers.IO) { prepararArchivo(contexto, uri) }
                    if (archivo.bytes.size > MAX_BYTES_REFERENCIA) {
                        error = "«${archivo.nombre}» pesa más de 10 MB."
                        continue
                    }
                    val r = contenedor.api.subirReferencia(archivo)["referencia"]
                    if (r != null) nuevas += JsonNeltume.decodeFromJsonElement(ReferenciaItem.serializer(), r)
                } catch (e: FalloApi) {
                    error = e.message
                } catch (e: Exception) {
                    error = "No se pudo leer el archivo. Prueba con otra imagen o un PDF."
                } finally {
                    subiendo--
                }
            }
            if (nuevas.isNotEmpty()) vm.editar("referencias.${v.indice}", { referencias(v.indice, actuales + nuevas) })
            if (uris.size > cupo) error = "Solo se agregaron $cupo: cada ítem admite hasta $MAX_REFERENCIAS_ITEM referencias."
        }
    }

    val galeria = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(MAX_REFERENCIAS_ITEM)) { subir(it) }
    val documento = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { subir(it) }
    val camara = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        if (ok) fotoPendiente?.let { subir(listOf(it)) }
    }

    ModalBottomSheet(alCerrar, sheetState = rememberModalBottomSheetState(true), containerColor = c.superficie) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).navigationBarsPadding().padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            TituloSeccion("Referencias del cliente", detalle = "Ítem ${v.indice + 1} · ${nombreItem(v)}")
            Text(
                "Fotos o documentos que entregó el cliente para este ítem. Se imprimen en las observaciones de la cotización y de la nota de pedido; nunca pasan al catálogo.",
                style = MaterialTheme.typography.bodySmall,
                color = c.apagado,
            )
            if (subiendo > 0) LinearProgressIndicator(Modifier.fillMaxWidth(), color = c.verde, trackColor = c.tonal)
            error?.let { Aviso(it, tono = TonoAviso.PELIGRO) }
            if (actuales.isEmpty()) Text("Todavía no hay referencias.", style = MaterialTheme.typography.bodyMedium, color = c.tintaSuave)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                actuales.forEachIndexed { i, r ->
                    Box {
                        Box(
                            Modifier
                                .size(96.dp)
                                .clip(Radios.lg)
                                .border(1.dp, c.linea, Radios.lg)
                                .background(c.panel)
                                .clickable { navegador.empujar(Ruta.Referencia(r.archivo, r.nombre, r.tipo)) }
                                .semantics { contentDescription = "${r.nombre}, ${etiquetaTipoReferencia(r.tipo)}, ${tamanoReferencia(r.tamano)}" },
                            contentAlignment = Alignment.Center,
                        ) {
                            if (r.esImagen) AsyncImage(urlReferencia(contenedor.servidor, r), null, Modifier.size(96.dp), contentScale = ContentScale.Crop)
                            else Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Icon(Iconos.Archivo, null, tint = c.peligro)
                                Text("PDF", style = MaterialTheme.typography.labelSmall, color = c.peligro)
                            }
                        }
                        if (editable) BotonIcono(
                            Iconos.Cerrar,
                            "Quitar ${r.nombre}",
                            { vm.editar("referencias.${v.indice}", { referencias(v.indice, actuales.filterIndexed { j, _ -> j != i }) }) },
                            Modifier.align(Alignment.TopEnd).padding(2.dp).size(32.dp),
                            tono = c.tinta,
                            fondo = c.superficie.copy(alpha = 0.9f),
                        )
                    }
                }
            }
            if (editable && actuales.size < MAX_REFERENCIAS_ITEM) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                BotonSecundario("Cámara", {
                    val carpeta = File(contexto.cacheDir, "fotos").apply { mkdirs() }
                    val archivo = File(carpeta, "foto-${System.currentTimeMillis()}.jpg")
                    val uri = FileProvider.getUriForFile(contexto, "${contexto.packageName}.archivos", archivo)
                    fotoPendiente = uri
                    camara.launch(uri)
                }, Modifier.weight(1f), icono = Iconos.Camara)
                BotonSecundario("Galería", {
                    galeria.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                }, Modifier.weight(1f), icono = Iconos.Imagen)
                BotonSecundario("PDF", { documento.launch(arrayOf("application/pdf")) }, Modifier.weight(1f), icono = Iconos.Archivo)
            }
        }
    }
}

private const val LADO_MAXIMO = 2560

/**
 * Lee el archivo elegido. Las fotos se giran según su EXIF y se reducen a 2560 px en JPEG (las de un teléfono pesan
 * varios MB); PNG y WEBP chicos y los PDF van tal cual.
 */
fun prepararArchivo(contexto: Context, uri: Uri): ArchivoSubida {
    val resolver = contexto.contentResolver
    val tipo = resolver.getType(uri) ?: "image/jpeg"
    val nombre = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
    } ?: "referencia"
    val bytes = resolver.openInputStream(uri)!!.use { it.readBytes() }
    if (tipo == "application/pdf") return ArchivoSubida("archivo", nombre, tipo, bytes)
    val limites = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, limites)
    val lado = maxOf(limites.outWidth, limites.outHeight)
    if (tipo != "image/jpeg" && lado <= LADO_MAXIMO && bytes.size < 4_000_000) return ArchivoSubida("archivo", nombre, tipo, bytes)
    var muestra = 1
    while (lado / (muestra * 2) >= LADO_MAXIMO) muestra *= 2
    var bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = muestra })
        ?: return ArchivoSubida("archivo", nombre, tipo, bytes)
    val escala = LADO_MAXIMO.toFloat() / maxOf(bitmap.width, bitmap.height)
    val giro = when (ExifInterface(bytes.inputStream()).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90f
        ExifInterface.ORIENTATION_ROTATE_180 -> 180f
        ExifInterface.ORIENTATION_ROTATE_270 -> 270f
        else -> 0f
    }
    if (escala < 1f || giro != 0f) {
        val m = Matrix().apply {
            if (escala < 1f) postScale(escala, escala)
            if (giro != 0f) postRotate(giro)
        }
        bitmap = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, m, true)
    }
    val salida = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.JPEG, 85, salida)
    val base = nombre.substringBeforeLast('.', nombre)
    return ArchivoSubida("archivo", "$base.jpg", "image/jpeg", salida.toByteArray())
}
