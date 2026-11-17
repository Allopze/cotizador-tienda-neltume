package cl.puertasneltume.cotizador.catalogo

import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cl.puertasneltume.cotizador.Contenedor
import cl.puertasneltume.cotizador.comun.MarcoPantalla
import cl.puertasneltume.cotizador.comun.vm
import cl.puertasneltume.cotizador.cotizar.DialogoConfirmacion
import cl.puertasneltume.cotizador.diseno.Aviso
import cl.puertasneltume.cotizador.diseno.BotonPrincipal
import cl.puertasneltume.cotizador.diseno.BotonSecundario
import cl.puertasneltume.cotizador.diseno.Hoja
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Radios
import cl.puertasneltume.cotizador.diseno.Rotulo
import cl.puertasneltume.cotizador.diseno.TituloSeccion
import cl.puertasneltume.cotizador.diseno.TonoAviso
import cl.puertasneltume.cotizador.nucleo.api.ArchivoSubida
import cl.puertasneltume.cotizador.nucleo.api.FalloApi
import cl.puertasneltume.cotizador.nucleo.reglas.Fechas
import cl.puertasneltume.cotizador.nucleo.reglas.NumerosCL
import cl.puertasneltume.cotizador.nucleo.reglas.pesos
import cl.puertasneltume.cotizador.nucleo.reglas.plural
import cl.puertasneltume.cotizador.nucleo.reglas.tamanoReferencia
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.IOException
import kotlin.math.abs

// Importar el catálogo desde la planilla Excel (src/app/catalogo/importar-catalogo.tsx): se analiza y compara, y
// solo al confirmar se aplica. Cada planilla reemplaza únicamente sus propios productos.

private const val MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
private const val MAXIMO_MB = 20
private const val RUTA_IMPORTAR = "api/catalogo/importar"

@Serializable
internal data class ProductoBreve(val codigo: String = "", val descripcion: String = "", val precioNeto: Double? = null)

@Serializable
internal data class Conteos(
    val nuevos: Int = 0,
    val modificados: Int = 0,
    val soloDescripcion: Int = 0,
    val sinCambios: Int = 0,
    val eliminados: Int = 0,
)

@Serializable
internal data class Modificado(val codigo: String = "", val anterior: ProductoBreve = ProductoBreve(), val nuevo: ProductoBreve = ProductoBreve())

@Serializable
internal data class SoloDescripcion(val codigo: String = "", val anterior: String = "", val nueva: String = "")

@Serializable
internal data class ProductosVista(
    val nuevos: List<ProductoBreve> = emptyList(),
    val modificados: List<Modificado> = emptyList(),
    val soloDescripcion: List<SoloDescripcion> = emptyList(),
    val sinCambios: List<ProductoBreve> = emptyList(),
    val eliminados: List<ProductoBreve> = emptyList(),
)

@Serializable
internal data class Incidencia(val fila: Int = 0, val hoja: String? = null, val accion: String = "", val detalle: String = "")

@Serializable
internal data class OtraPlanilla(val origen: String = "", val etiqueta: String = "", val productos: Int = 0)

/** Vista previa de la importación: la comparación con el catálogo vigente. */
@Serializable
internal data class VistaPrevia(
    val origen: String = "",
    val etiquetaOrigen: String = "",
    val sinModificar: List<OtraPlanilla> = emptyList(),
    val sha256: String = "",
    val baseSha256: String? = null,
    val versionCatalogo: String? = null,
    val edicionesManuales: List<ProductoBreve> = emptyList(),
    val fuente: String = "",
    val totalProductos: Int = 0,
    val conteos: Conteos = Conteos(),
    val productos: ProductosVista = ProductosVista(),
    val incidencias: List<Incidencia> = emptyList(),
    val erroresPlantilla: List<String> = emptyList(),
) {
    private val cantidadAnterior get() = conteos.sinCambios + conteos.modificados + conteos.soloDescripcion + conteos.eliminados

    /** Una reducción grande de productos exige confirmarla aparte. */
    val requiereForzar get() = totalProductos < cantidadAnterior * 0.9
    val sinCambios get() = conteos.nuevos + conteos.modificados + conteos.soloDescripcion + conteos.eliminados == 0
}

/** Copia que guardó la importación: a qué se puede volver (y la versión que debe seguir vigente para hacerlo). */
@Serializable
internal data class PlanillaAnterior(
    val origen: String = "",
    val etiqueta: String = "",
    val fuente: String = "",
    val fecha: String = "",
    val productos: Int = 0,
    val edicionesManuales: Int = 0,
    val importada: String = "",
    val versionCatalogo: String = "",
)

@Serializable
private data class Importado(
    val fuente: String = "",
    val etiquetaOrigen: String = "",
    val conteos: Conteos = Conteos(),
    val anterior: PlanillaAnterior? = null,
    val versionCatalogo: String? = null,
)

@Serializable
private data class EstadoDeshacer(val deshacer: List<PlanillaAnterior> = emptyList())

@Serializable
private data class Restaurada(val restaurada: PlanillaAnterior = PlanillaAnterior())

internal class ArchivoElegido(val nombre: String, val tamano: Long, val bytes: ByteArray)

internal enum class OcupadoImportar { PREVISUALIZAR, CONFIRMAR, VOLVER, LEER }

/** Diferencia de precio: «(+4,2 %)», «(−1 %)». */
private fun variacion(anterior: Double?, nuevo: Double?): String {
    val a = anterior ?: 0.0
    val n = nuevo ?: 0.0
    if (a == 0.0) return ""
    val pct = (n - a) / a * 100
    if (abs(pct) < 0.05) return ""
    return " (${if (pct > 0) "+" else "−"}${NumerosCL.formatear(abs(pct), maximoDecimales = 1)} %)"
}

internal class ImportarViewModel(private val c: Contenedor) : ViewModel() {
    var archivo by mutableStateOf<ArchivoElegido?>(null)
        private set
    var vista by mutableStateOf<VistaPrevia?>(null)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var mensaje by mutableStateOf<String?>(null)
        private set
    var ocupado by mutableStateOf<OcupadoImportar?>(null)
        private set
    var forzar by mutableStateOf(false)

    /** El catálogo o el archivo cambiaron después de la vista previa: solo se puede volver a analizar. */
    var obsoleta by mutableStateOf<String?>(null)
        private set
    var deshacer by mutableStateOf<PlanillaAnterior?>(null)
        private set

    init {
        consultarDeshacer()
    }

    /** «Volver a la planilla anterior» sigue disponible al volver a esta sección: lo dice el servidor. */
    private fun consultarDeshacer() {
        viewModelScope.launch {
            try {
                deshacer = c.http.obtener(EstadoDeshacer.serializer(), RUTA_IMPORTAR).deshacer.firstOrNull()
            } catch (e: FalloApi) {
                // Sin esa consulta solo falta el atajo para volver atrás: la importación sigue funcionando.
            }
        }
    }

    fun elegir(uri: Uri) {
        if (ocupado != null) return
        vista = null
        error = null
        mensaje = null
        forzar = false
        obsoleta = null
        deshacer = null
        archivo = null
        val resolver = c.contexto.contentResolver
        ocupado = OcupadoImportar.LEER
        viewModelScope.launch {
            try {
                val (nombre, tamano) = withContext(Dispatchers.IO) {
                    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
                        if (cursor.moveToFirst()) {
                            val n = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let { cursor.getString(it) }
                            val t = cursor.getColumnIndex(OpenableColumns.SIZE).takeIf { it >= 0 && !cursor.isNull(it) }?.let { cursor.getLong(it) }
                            n to t
                        } else null
                    } ?: (null to null)
                }
                val nombreArchivo = nombre ?: uri.lastPathSegment ?: "planilla"
                if (!nombreArchivo.endsWith(".xlsx", ignoreCase = true)) {
                    error = "El archivo debe ser una planilla Excel .xlsx."
                    return@launch
                }
                val limite = MAXIMO_MB * 1024L * 1024L
                if (tamano != null && tamano > limite) {
                    error = "El archivo pesa ${tamanoReferencia(tamano)}; el máximo es $MAXIMO_MB MB."
                    return@launch
                }
                val bytes = withContext(Dispatchers.IO) { resolver.openInputStream(uri)?.use { it.readBytes() } }
                if (bytes == null) {
                    error = "No se pudo leer el archivo. Elígelo de nuevo."
                    return@launch
                }
                if (bytes.size > limite) {
                    error = "El archivo pesa ${tamanoReferencia(bytes.size.toLong())}; el máximo es $MAXIMO_MB MB."
                    return@launch
                }
                archivo = ArchivoElegido(nombreArchivo, bytes.size.toLong(), bytes)
            } catch (e: IOException) {
                error = "No se pudo leer el archivo. Elígelo de nuevo."
            } catch (e: SecurityException) {
                error = "No se pudo leer el archivo. Elígelo de nuevo."
            } finally {
                ocupado = null
            }
        }
    }

    fun descartarVista() {
        vista = null
        forzar = false
        obsoleta = null
    }

    fun enviar(confirmar: Boolean) {
        val a = archivo ?: return
        if (ocupado != null) return
        if (confirmar && obsoleta != null) return
        val v = vista
        ocupado = if (confirmar) OcupadoImportar.CONFIRMAR else OcupadoImportar.PREVISUALIZAR
        error = null
        mensaje = null
        val subida = ArchivoSubida("archivo", a.nombre, MIME_XLSX, a.bytes)
        viewModelScope.launch {
            try {
                if (confirmar && v != null) {
                    val r = c.http.subir(
                        Importado.serializer(),
                        RUTA_IMPORTAR,
                        subida,
                        campos = mapOf(
                            "accion" to "confirmar",
                            "versionCatalogo" to (v.versionCatalogo ?: ""),
                            "sha256" to v.sha256,
                            "baseSha256" to (v.baseSha256 ?: ""),
                            "forzar" to (v.requiereForzar && forzar).toString(),
                        ),
                    )
                    mensaje = "${r.etiquetaOrigen} actualizada desde ${r.fuente}: ${cantidad(r.conteos.nuevos)} productos nuevos, " +
                        "${cantidad(r.conteos.modificados)} modificados y ${cantidad(r.conteos.eliminados)} retirados."
                    deshacer = if (r.anterior != null && r.versionCatalogo != null)
                        r.anterior.copy(importada = r.fuente, versionCatalogo = r.versionCatalogo)
                    else null
                    vista = null
                    archivo = null
                    forzar = false
                } else {
                    vista = c.http.subir(VistaPrevia.serializer(), RUTA_IMPORTAR, subida, campos = mapOf("accion" to "previsualizar"))
                    forzar = false
                    obsoleta = null
                }
            } catch (e: FalloApi) {
                // Repetir la confirmación daría el mismo error: la vista previa queda inhabilitada hasta analizar de nuevo.
                if (confirmar && e.codigo == "vista_previa_obsoleta") obsoleta = e.message else error = e.message
            } finally {
                ocupado = null
            }
        }
    }

    fun volverAnterior() {
        val d = deshacer ?: return
        if (ocupado != null) return
        ocupado = OcupadoImportar.VOLVER
        error = null
        mensaje = null
        viewModelScope.launch {
            try {
                val r = c.pedirCatalogo(Restaurada.serializer(), buildJsonObject {
                    put("tipo", "volver_planilla")
                    put("origen", d.origen)
                    put("versionCatalogo", d.versionCatalogo)
                }).restaurada
                mensaje = "${r.etiqueta} de vuelta en ${r.fuente}: ${cantidad(r.productos)} productos" +
                    (if (r.edicionesManuales > 0) ", ${plural(r.edicionesManuales, "editado", "editados")} a mano" else "") + "."
                // La planilla que se deshizo queda como copia: ahora se puede volver a ella con el mismo botón.
                deshacer = null
                consultarDeshacer()
            } catch (e: FalloApi) {
                error = e.message
                // El catálogo cambió o ya no hay copia: volver atrás dejó de ser posible.
                if (e.codigo == "version_obsoleta" || e.codigo == "no_encontrada") deshacer = null
            } finally {
                ocupado = null
            }
        }
    }
}

@Composable
internal fun SeccionImportar(s: SeccionCatalogo, volver: () -> Unit) {
    val vm = vm { ImportarViewModel(it) }
    val elegir = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) vm.elegir(uri) }
    var confirmarImportar by rememberSaveable { mutableStateOf(false) }
    var confirmarVolver by rememberSaveable { mutableStateOf(false) }
    MarcoPantalla(s.titulo, alVolver = volver, subtitulo = "Catálogo") {
        ConMargenLateral { lado ->
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = lado).padding(top = 8.dp, bottom = 32.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Introduccion(
                    "Sube la planilla de puertas sólidas o la de enchapadas, prepintadas y marcos finger: se reconoce sola y " +
                        "cada una reemplaza únicamente sus propios productos. El catálogo vigente no cambia hasta que revises la " +
                        "comparación y confirmes.",
                )
                ElegirArchivo(vm.archivo, habilitado = vm.ocupado == null, leyendo = vm.ocupado == OcupadoImportar.LEER) {
                    elegir.launch(arrayOf(MIME_XLSX, "application/octet-stream"))
                }
                BotonPrincipal(
                    if (vm.ocupado == OcupadoImportar.PREVISUALIZAR && vm.vista == null) "Analizando…" else "Analizar y comparar",
                    { vm.enviar(confirmar = false) },
                    Modifier.fillMaxWidth(),
                    icono = Iconos.Planilla,
                    habilitado = vm.archivo != null && vm.ocupado == null,
                    cargando = vm.ocupado == OcupadoImportar.PREVISUALIZAR && vm.vista == null,
                )
                if (vm.archivo == null) Apagado("Elige una planilla para analizarla.")
                vm.error?.let { Aviso(it, Modifier.semantics { liveRegion = LiveRegionMode.Assertive }, TonoAviso.PELIGRO) }
                vm.mensaje?.let { Aviso(it, Modifier.semantics { liveRegion = LiveRegionMode.Polite }, TonoAviso.EXITO) }
                vm.deshacer?.let { d ->
                    Hoja(Modifier.fillMaxWidth(), color = Neltume.colores.panel) {
                        Apagado(
                            "¿No era ${d.importada}? Puedes volver a la ${d.etiqueta.lowercase(ES_CL)} anterior (${d.fuente}) mientras nadie cambie el catálogo.",
                        )
                        Spacer(Modifier.height(10.dp))
                        BotonSecundario(
                            if (vm.ocupado == OcupadoImportar.VOLVER) "Volviendo…" else "Volver a la planilla anterior",
                            { confirmarVolver = true },
                            icono = Iconos.Deshacer,
                            habilitado = vm.ocupado == null,
                            cargando = vm.ocupado == OcupadoImportar.VOLVER,
                        )
                    }
                }
                vm.vista?.let { v -> VistaPreviaImportacion(v, vm) { confirmarImportar = true } }
            }
        }
    }
    val v = vm.vista
    if (confirmarImportar && v != null) {
        DialogoConfirmacion(
            "Importar planilla",
            "Se aplicará ${v.fuente} (${v.etiquetaOrigen.lowercase(ES_CL)}). Los demás productos del catálogo no cambian.",
            "Importar planilla",
            detalles = buildList {
                add("Nuevos: ${cantidad(v.conteos.nuevos)}")
                add("Modificados: ${cantidad(v.conteos.modificados)}")
                if (v.conteos.soloDescripcion > 0) add("Formato de descripción actualizado: ${cantidad(v.conteos.soloDescripcion)}")
                add("Sin cambios: ${cantidad(v.conteos.sinCambios)}")
                add("Retirados: ${cantidad(v.conteos.eliminados)}")
                if (v.edicionesManuales.isNotEmpty())
                    add("Se pierden los cambios hechos a mano en ${plural(v.edicionesManuales.size, "producto", "productos")} de esta planilla.")
            },
        ) { ok ->
            confirmarImportar = false
            if (ok) vm.enviar(confirmar = true)
        }
    }
    val d = vm.deshacer
    if (confirmarVolver && d != null) {
        DialogoConfirmacion(
            "Volver a la planilla anterior",
            buildString {
                append("La ${d.etiqueta.lowercase(ES_CL)} vuelve a como estaba antes de importar ${d.importada}: los ")
                append("${cantidad(d.productos)} productos de ${d.fuente}")
                if (d.fecha.isNotEmpty()) append(", importada el ${Fechas.corta(d.fecha)}")
                append(", con los precios que tenían en el catálogo.")
                if (d.edicionesManuales > 0) {
                    append("\n\nVuelven también los cambios hechos a mano en ${plural(d.edicionesManuales, "producto", "productos")} de esa ")
                    append("planilla, que siguen marcados como editados a mano: la próxima importación los volverá a avisar.")
                }
                append("\n\nNo cambian la otra planilla ni los productos agregados a mano, y las cotizaciones ya emitidas conservan ")
                append("sus precios. ${d.importada} queda guardada como planilla anterior: si nadie cambia el catálogo, podrás volver ")
                append("a ella con este mismo botón.")
            },
            "Volver a la planilla anterior",
        ) { ok ->
            confirmarVolver = false
            if (ok) vm.volverAnterior()
        }
    }
}

/** Zona para elegir la planilla: nombre y tamaño del archivo elegido, o el formato aceptado. */
@Composable
private fun ElegirArchivo(archivo: ArchivoElegido?, habilitado: Boolean, leyendo: Boolean, elegir: () -> Unit) {
    val c = Neltume.colores
    Surface(
        onClick = elegir,
        enabled = habilitado,
        modifier = Modifier.fillMaxWidth().heightIn(min = 88.dp),
        shape = Radios.xl,
        color = if (archivo != null) c.verdePalido else c.panel,
        border = BorderStroke(1.dp, if (archivo != null) c.verde.copy(alpha = 0.5f) else c.lineaMedia),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(44.dp).clip(Radios.md).background(c.superficie), contentAlignment = Alignment.Center) {
                Icon(if (archivo != null) Iconos.Planilla else Iconos.Subir, null, tint = c.verde, modifier = Modifier.size(22.dp))
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                if (leyendo) {
                    Text("Leyendo el archivo…", style = MaterialTheme.typography.titleSmall, color = c.tinta)
                } else if (archivo != null) {
                    Text(archivo.nombre, style = MaterialTheme.typography.titleSmall, color = c.tinta)
                    Text("${tamanoReferencia(archivo.tamano)} · Elegir otro archivo", style = MaterialTheme.typography.bodySmall, color = c.apagado)
                } else {
                    Text("Elegir planilla Excel", style = MaterialTheme.typography.titleSmall, color = c.tinta)
                    Text(".xlsx, máximo $MAXIMO_MB MB", style = MaterialTheme.typography.bodySmall, color = c.apagado)
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun VistaPreviaImportacion(v: VistaPrevia, vm: ImportarViewModel, confirmar: () -> Unit) {
    val c = Neltume.colores
    val ocupado = vm.ocupado != null
    val negrita = SpanStyle(fontWeight = FontWeight.SemiBold, color = c.tinta)
    Hoja(Modifier.fillMaxWidth()) {
        Text("Vista previa · ${v.fuente}", Modifier.semantics { heading() }, style = MaterialTheme.typography.titleLarge, color = c.tinta)
        Spacer(Modifier.height(6.dp))
        Text(
            buildAnnotatedString {
                append("Formato detectado: ")
                withStyle(negrita) { append(v.etiquetaOrigen) }
                append(". ${cantidad(v.totalProductos)} productos en la planilla.")
            },
            style = MaterialTheme.typography.bodyMedium,
            color = c.tintaSuave,
        )
        Spacer(Modifier.height(6.dp))
        val otras = v.sinModificar.joinToString(" ni ") { o ->
            "la ${o.etiqueta.lowercase(ES_CL)} (${if (o.productos > 0) "${cantidad(o.productos)} productos" else "aún sin importar"})"
        }
        Apagado(
            "Solo se reemplazan los productos de esta planilla. No se modifican " +
                (if (otras.isNotEmpty()) "$otras ni " else "") + "los productos agregados a mano.",
        )
        Spacer(Modifier.height(12.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Conteo(v.conteos.nuevos, "Nuevos")
            Conteo(v.conteos.modificados, "Modificados")
            if (v.conteos.soloDescripcion > 0) Conteo(v.conteos.soloDescripcion, "Formato de descripción actualizado")
            Conteo(v.conteos.sinCambios, "Sin cambios")
            Conteo(v.conteos.eliminados, "Retirados")
        }
        Spacer(Modifier.height(12.dp))
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (v.sinCambios) Aviso("La planilla es idéntica al catálogo vigente: no hay nada que importar.")
            if (v.conteos.soloDescripcion > 0) Desplegable("Formato de descripción actualizado: ${cantidad(v.conteos.soloDescripcion)} · mismo precio y medidas") {
                v.productos.soloDescripcion.forEach { p -> Vineta("${p.codigo} · ${p.anterior} → ${p.nueva}") }
                if (v.conteos.soloDescripcion > v.productos.soloDescripcion.size) Apagado("Se muestran los primeros ${v.productos.soloDescripcion.size}.")
            }
            if (v.edicionesManuales.isNotEmpty()) {
                Aviso(
                    "${plural(v.edicionesManuales.size, "producto de esta planilla se editó", "productos de esta planilla se editaron")} a mano. " +
                        "Al confirmar, vuelven a los valores de la planilla y esos cambios se pierden.",
                    tono = TonoAviso.ATENCION,
                )
                Desplegable("Editados a mano (${cantidad(v.edicionesManuales.size)})", inicial = true) {
                    v.edicionesManuales.forEach { p -> Vineta("${p.codigo} · ${p.descripcion} · ${pesos(p.precioNeto ?: 0.0)}") }
                }
            }
            if (v.conteos.eliminados > 0)
                Aviso("Al confirmar, se retirarán ${cantidad(v.conteos.eliminados)} productos que no aparecen en esta planilla.", tono = TonoAviso.ATENCION)
            if (v.requiereForzar) Casilla(
                AnnotatedString("Confirmo que la reducción a ${cantidad(v.totalProductos)} productos es intencional."),
                vm.forzar,
                { vm.forzar = it },
                habilitada = !ocupado,
            )
            if (!v.sinCambios) {
                if (v.productos.nuevos.isNotEmpty()) Desplegable("Nuevos (${cantidad(v.conteos.nuevos)})", inicial = true) {
                    v.productos.nuevos.forEach { p -> Vineta("${p.codigo} · ${p.descripcion} · ${pesos(p.precioNeto ?: 0.0)}") }
                    if (v.conteos.nuevos > v.productos.nuevos.size) Apagado("Se muestran los primeros ${v.productos.nuevos.size}.")
                }
                if (v.productos.modificados.isNotEmpty()) Desplegable("Modificados (${cantidad(v.conteos.modificados)})", inicial = true) {
                    v.productos.modificados.forEach { p ->
                        val descripcion = if (p.anterior.descripcion == p.nuevo.descripcion) p.nuevo.descripcion else "${p.anterior.descripcion} → ${p.nuevo.descripcion}"
                        Vineta(
                            "${p.codigo} · $descripcion · ${pesos(p.anterior.precioNeto ?: 0.0)} → ${pesos(p.nuevo.precioNeto ?: 0.0)}" +
                                variacion(p.anterior.precioNeto, p.nuevo.precioNeto),
                        )
                    }
                }
                if (v.productos.eliminados.isNotEmpty()) Desplegable("Retirados (${cantidad(v.conteos.eliminados)})", inicial = true) {
                    v.productos.eliminados.forEach { p -> Vineta("${p.codigo} · ${p.descripcion}") }
                }
            }
            if (v.incidencias.isNotEmpty()) Desplegable("Filas corregidas o excluidas al leer la planilla (${cantidad(v.incidencias.size)})") {
                v.incidencias.take(50).forEach { i -> Vineta("${i.hoja?.let { "${it.trim()} · " } ?: ""}Fila ${i.fila}: ${i.detalle}") }
                if (v.incidencias.size > 50) Apagado("Se muestran las primeras 50.")
            }
            // Fallas de la hoja «Cotizador» del Excel original: no cambian los precios que se importan.
            if (v.erroresPlantilla.isNotEmpty()) Desplegable("Notas sobre la hoja «Cotizador» del Excel (${v.erroresPlantilla.size}) · no afectan la importación") {
                v.erroresPlantilla.forEach { Vineta(it) }
            }
            vm.obsoleta?.let { Aviso(it, Modifier.semantics { liveRegion = LiveRegionMode.Assertive }, TonoAviso.ATENCION) }
        }
        Spacer(Modifier.height(14.dp))
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            BotonPrincipal(
                if (vm.ocupado == OcupadoImportar.CONFIRMAR) "Aplicando…" else "Confirmar e importar",
                confirmar,
                Modifier.fillMaxWidth(),
                icono = Iconos.Check,
                habilitado = !ocupado && vm.obsoleta == null && !v.sinCambios && (!v.requiereForzar || vm.forzar),
                cargando = vm.ocupado == OcupadoImportar.CONFIRMAR,
            )
            if (vm.obsoleta != null) BotonSecundario(
                if (vm.ocupado == OcupadoImportar.PREVISUALIZAR) "Analizando…" else "Volver a analizar",
                { vm.enviar(confirmar = false) },
                Modifier.fillMaxWidth(),
                icono = Iconos.Recargar,
                habilitado = !ocupado,
                cargando = vm.ocupado == OcupadoImportar.PREVISUALIZAR,
            )
            BotonSecundario("Descartar vista previa", vm::descartarVista, Modifier.fillMaxWidth(), habilitado = !ocupado)
        }
    }
}

/** Un conteo de la comparación: la cifra grande y su nombre. */
@Composable
private fun Conteo(n: Int, nombre: String) {
    val c = Neltume.colores
    Column(
        Modifier.widthIn(min = 96.dp).clip(Radios.lg).background(c.panel).padding(horizontal = 14.dp, vertical = 10.dp).semantics(mergeDescendants = true) {},
    ) {
        Text(cantidad(n), style = MaterialTheme.typography.headlineSmall, color = c.tinta)
        Rotulo(nombre)
    }
}
