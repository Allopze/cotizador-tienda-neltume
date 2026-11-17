package cl.puertasneltume.cotizador.ajustes

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cl.puertasneltume.cotizador.Contenedor
import cl.puertasneltume.cotizador.R
import cl.puertasneltume.cotizador.comun.Avisos
import cl.puertasneltume.cotizador.comun.LocalAvisos
import cl.puertasneltume.cotizador.comun.vm
import cl.puertasneltume.cotizador.diseno.BotonIcono
import cl.puertasneltume.cotizador.diseno.BotonSecundario
import cl.puertasneltume.cotizador.diseno.Campo
import cl.puertasneltume.cotizador.diseno.Hoja
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Radios
import cl.puertasneltume.cotizador.diseno.Rotulo
import cl.puertasneltume.cotizador.diseno.TituloSeccion
import cl.puertasneltume.cotizador.nucleo.api.FalloApi
import cl.puertasneltume.cotizador.nucleo.api.Mensajes
import cl.puertasneltume.cotizador.nucleo.api.texto
import cl.puertasneltume.cotizador.nucleo.reglas.Limites
import cl.puertasneltume.cotizador.nucleo.reglas.MAX_DESDE_PUERTAS
import cl.puertasneltume.cotizador.nucleo.reglas.MAX_TRAMOS
import cl.puertasneltume.cotizador.nucleo.reglas.NOMBRES_CATEGORIA_MARGEN
import cl.puertasneltume.cotizador.nucleo.reglas.NumerosCL
import cl.puertasneltume.cotizador.nucleo.reglas.aCentesimas
import cl.puertasneltume.cotizador.nucleo.reglas.conDosDecimales
import cl.puertasneltume.cotizador.nucleo.reglas.correoValido
import cl.puertasneltume.cotizador.nucleo.reglas.jsTexto
import cl.puertasneltume.cotizador.nucleo.reglas.leerPorcentaje
import cl.puertasneltume.cotizador.nucleo.reglas.margenAPorcentaje
import cl.puertasneltume.cotizador.nucleo.reglas.porcentaje
import cl.puertasneltume.cotizador.nucleo.reglas.porcentajeAMargen
import coil3.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

// Configuración comercial (src/app/ajustes/configuracion-negocio.tsx): empresa, precios y cotizaciones. Cada bloque
// guarda solo su parte sobre lo último guardado, con `If-Match` para no pisar a otra persona (409 si cambió).

private const val RUTA_NEGOCIO = "api/configuracion-negocio"

/** `GET /api/configuracion-negocio`. La configuración se conserva como JSON: el servidor la valida estricta y se devuelve completa. */
@Serializable
internal data class EstadoNegocio(
    val configuracion: JsonObject = JsonObject(emptyMap()),
    val actualizada: String? = null,
    val puedeEditar: Boolean = false,
)

private fun JsonObject.objeto(nombre: String): JsonObject = this[nombre] as? JsonObject ?: JsonObject(emptyMap())
private fun JsonObject.numero(nombre: String): Double? = (this[nombre] as? JsonPrimitive)?.doubleOrNull
private fun JsonObject.con(nombre: String, valor: JsonElement): JsonObject = JsonObject(this + (nombre to valor))

/** Número de un campo como se escribe: con coma decimal (19,5). */
private fun aTexto(n: Double?): String = if (n == null || !n.isFinite()) "" else jsTexto(n).replace('.', ',')

/** Porcentaje escrito con coma o punto decimal; vacío o ilegible es NaN, nunca 0. */
private fun leerCampo(texto: String): Double = if (texto.isBlank()) Double.NaN else leerPorcentaje(texto)

/** Entero escrito (días, puertas); vacío o con decimales es NaN. */
private fun leerEntero(texto: String): Double =
    if (Regex("""^\s*\d+\s*$""").matches(texto)) texto.trim().toDouble() else Double.NaN

/** Error de un porcentaje escrito, o null: hasta `maximo` y con hasta dos decimales. */
private fun errorPorcentaje(texto: String, maximo: Double): String? {
    val n = leerCampo(texto)
    if (n.isNaN()) return "Escribe un número, por ejemplo 19 o 2,5."
    if (n > maximo) return "No puede superar ${NumerosCL.formatear(maximo, maximoDecimales = 2)} %."
    if (!conDosDecimales(n)) return "Usa como máximo dos decimales."
    return null
}

/**
 * Base de los tres formularios: carga, borrador frente a lo guardado y guardado con `If-Match`. Como `useBorrador`
 * de la web, el borrador se reinicia solo cuando cambia lo guardado de este formulario.
 */
internal abstract class FormularioNegocioVM<B : Any>(protected val c: Contenedor, private val exito: String) : ViewModel() {
    var configuracion by mutableStateOf<JsonObject?>(null)
        private set
    private var actualizada: String? = null
    var puedeEditar by mutableStateOf(false)
        private set
    var errorCarga by mutableStateOf<String?>(null)
        private set
    private var guardado by mutableStateOf<B?>(null)
    var borrador by mutableStateOf<B?>(null)
        protected set
    var ocupado by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        protected set

    protected abstract fun desde(conf: JsonObject): B
    protected open fun clave(b: B): Any = b

    /** Valida el borrador; devuelve el cambio sobre lo último guardado, o null si hay un error (ya marcado). */
    protected abstract fun preparar(b: B): ((JsonObject) -> JsonObject)?
    protected open fun alLimpiarErrores() {}

    val sucio: Boolean
        get() {
            val b = borrador ?: return false
            val g = guardado ?: return false
            return clave(b) != clave(g)
        }

    fun cargar() {
        viewModelScope.launch {
            errorCarga = null
            try {
                recibir(leer(EstadoNegocio.serializer(), c.api.obtenerJson(RUTA_NEGOCIO)), reiniciar = false)
            } catch (e: FalloApi) {
                errorCarga = e.message
            }
        }
    }

    /** Devuelve true si el borrador volvió a lo guardado. */
    private fun recibir(e: EstadoNegocio, reiniciar: Boolean): Boolean {
        configuracion = e.configuracion
        actualizada = e.actualizada
        puedeEditar = e.puedeEditar
        val nuevo = desde(e.configuracion)
        val anterior = guardado
        guardado = nuevo
        val reinicia = reiniciar || anterior == null || borrador == null || clave(anterior) != clave(nuevo)
        if (reinicia) borrador = nuevo
        return reinicia
    }

    protected fun editar(b: B) {
        error = null
        borrador = b
    }

    fun descartar() {
        borrador = guardado
        error = null
        alLimpiarErrores()
    }

    fun guardar(avisos: Avisos) {
        val b = borrador ?: return
        val conf = configuracion ?: return
        if (!puedeEditar || ocupado || !sucio) return
        val cambio = preparar(b) ?: return
        ocupado = true
        error = null
        viewModelScope.launch {
            try {
                // Si otra persona guardó desde que se abrió esta pantalla, la respuesta es 409 y no se pisa su cambio.
                val r = c.api.enviarJson(RUTA_NEGOCIO, cambio(conf), cabeceras = actualizada?.let { mapOf("If-Match" to it) } ?: emptyMap())
                recibir(leer(EstadoNegocio.serializer(), r), reiniciar = true)
                alLimpiarErrores()
                avisos.mostrar(exito)
            } catch (e: FalloApi) {
                if (e.status == 409) {
                    val volvio = try {
                        recibir(leer(EstadoNegocio.serializer(), c.api.obtenerJson(RUTA_NEGOCIO)), reiniciar = false)
                    } catch (x: FalloApi) {
                        null
                    }
                    error = when (volvio) {
                        null -> e.message
                        true -> "Otra persona cambió estos datos antes que tú. Se cargó la versión actual; vuelve a aplicar tus cambios."
                        false -> "Otra persona guardó la configuración antes que tú. Se cargó la versión actual: revisa tus cambios y vuelve a guardar."
                    }
                } else {
                    error = e.message ?: Mensajes.GENERAL
                }
            } finally {
                ocupado = false
            }
        }
    }
}

/** Muestra la carga o el error de la configuración comercial; con ella lista, el bloque. */
@Composable
private fun ColumnScope.ConNegocio(vm: FormularioNegocioVM<*>, contenido: @Composable ColumnScope.() -> Unit) {
    when {
        vm.borrador != null -> contenido()
        vm.errorCarga != null -> ErrorCarga(vm.errorCarga!!, vm::cargar)
        else -> Cargando("Cargando la configuración comercial…")
    }
}

/** Campo de cifra escrito como texto (acepta coma decimal), con su error junto al campo. */
@Composable
private fun CampoCifra(
    valor: String,
    alCambiar: (String) -> Unit,
    etiqueta: String,
    error: String?,
    habilitado: Boolean,
    modifier: Modifier = Modifier,
    entero: Boolean = false,
    foco: FocusRequester? = null,
    largo: Int = 8,
    ayuda: String? = null,
) {
    Campo(
        valor,
        alCambiar,
        etiqueta,
        modifier,
        error = error,
        ayuda = ayuda,
        teclado = if (entero) KeyboardType.Number else KeyboardType.Decimal,
        habilitado = habilitado,
        largoMaximo = largo,
        foco = foco,
    )
}

// --- Datos de la empresa ------------------------------------------------------------------------------------------

private class CampoEmpresa(val clave: String, val etiqueta: String, val multilinea: Boolean = false, val teclado: KeyboardType = KeyboardType.Text)

private val CAMPOS_EMPRESA = listOf(
    CampoEmpresa("nombre", "Nombre de la empresa"),
    CampoEmpresa("rut", "RUT"),
    CampoEmpresa("direccion", "Dirección"),
    CampoEmpresa("telefono", "Teléfono", teclado = KeyboardType.Phone),
    CampoEmpresa("correo", "Correo de contacto", teclado = KeyboardType.Email),
    CampoEmpresa("web", "Sitio web", teclado = KeyboardType.Uri),
    CampoEmpresa("condicionesPago", "Condiciones de pago", multilinea = true),
    CampoEmpresa("plazoEntrega", "Plazo de entrega", multilinea = true),
    CampoEmpresa("datosBancarios", "Datos bancarios", multilinea = true),
)

private const val LOGO_MAXIMO = 48_000

internal data class BorradorEmpresa(val campos: Map<String, String>, val logo: String?)

internal class EmpresaVM(c: Contenedor) : FormularioNegocioVM<BorradorEmpresa>(c, "Datos de la empresa guardados.") {
    var errorCorreo by mutableStateOf<String?>(null)
        private set
    var focoCorreo by mutableIntStateOf(0)
        private set
    var errorLogo by mutableStateOf<String?>(null)

    init {
        cargar()
    }

    override fun desde(conf: JsonObject): BorradorEmpresa {
        val e = conf.objeto("empresa")
        return BorradorEmpresa(CAMPOS_EMPRESA.associate { it.clave to (e.texto(it.clave) ?: "") }, e.texto("logoSvg"))
    }

    fun focoAtendido() {
        focoCorreo = 0
    }

    fun cambiar(campo: String, valor: String) {
        val b = borrador ?: return
        if (campo == "correo") errorCorreo = null
        editar(b.copy(campos = b.campos + (campo to valor)))
    }

    fun cambiarLogo(svg: String?) {
        val b = borrador ?: return
        errorLogo = null
        editar(b.copy(logo = svg))
    }

    override fun alLimpiarErrores() {
        errorCorreo = null
        errorLogo = null
    }

    override fun preparar(b: BorradorEmpresa): ((JsonObject) -> JsonObject)? {
        // El correo es obligatorio para el servidor; el rechazo de zod no se lee bien, así que se revisa antes.
        if (!correoValido(b.campos["correo"].orEmpty())) {
            errorCorreo = "Revisa el correo: debe tener la forma nombre@dominio.cl."
            focoCorreo++
            return null
        }
        return { conf ->
            val empresa = conf.objeto("empresa").toMutableMap()
            CAMPOS_EMPRESA.forEach { campo ->
                val v = b.campos[campo.clave].orEmpty()
                empresa[campo.clave] = if (v.isEmpty()) JsonNull else JsonPrimitive(v)
            }
            empresa["logoSvg"] = b.logo?.let { JsonPrimitive(it) } ?: JsonNull
            conf.con("empresa", JsonObject(empresa))
        }
    }
}

/** Lee el SVG elegido con las mismas comprobaciones que la web; devuelve el texto o el mensaje de error. */
private suspend fun leerLogo(contexto: Context, uri: Uri): Result<String> = withContext(Dispatchers.IO) {
    runCatching {
        val resolvedor = contexto.contentResolver
        val tipo = resolvedor.getType(uri)
        val nombre = resolvedor.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        }.orEmpty()
        val bytes = resolvedor.openInputStream(uri)?.use { entrada ->
            val buffer = ByteArray(LOGO_MAXIMO + 1)
            var leidos = 0
            while (leidos < buffer.size) {
                val n = entrada.read(buffer, leidos, buffer.size - leidos)
                if (n < 0) break
                leidos += n
            }
            buffer.copyOf(leidos)
        } ?: error("El logo debe ser un archivo SVG de hasta 48 KB.")
        val esSvg = tipo == "image/svg+xml" || nombre.lowercase().endsWith(".svg")
        if (bytes.size > LOGO_MAXIMO || !esSvg) error("El logo debe ser un archivo SVG de hasta 48 KB.")
        val texto = String(bytes, Charsets.UTF_8)
        val abre = Regex("""<svg(?:\s|>)""", RegexOption.IGNORE_CASE).containsMatchIn(texto)
        val peligroso = Regex("""<script|<foreignObject|\son\w+\s*=|javascript:""", RegexOption.IGNORE_CASE).containsMatchIn(texto)
        if (!abre || peligroso) error("El SVG no tiene un formato permitido.")
        texto
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun SeccionEmpresa() {
    val vm = vm { EmpresaVM(it) }
    val avisos = LocalAvisos.current
    val c = Neltume.colores
    val contexto = LocalContext.current
    val alcance = rememberCoroutineScope()
    val focoCorreo = remember { FocusRequester() }
    LaunchedEffect(vm.focoCorreo) {
        if (vm.focoCorreo == 0) return@LaunchedEffect
        runCatching { focoCorreo.requestFocus() }
        vm.focoAtendido()
    }
    val elegirLogo = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) alcance.launch {
            leerLogo(contexto, uri).fold(
                onSuccess = { vm.cambiarLogo(it) },
                onFailure = { vm.errorLogo = it.message ?: "El SVG no tiene un formato permitido." },
            )
        }
    }
    val editable = vm.puedeEditar
    val activo = editable && !vm.ocupado

    MarcoSeccion(
        SeccionAjustes.EMPRESA.encabezado,
        sucio = vm.sucio,
        pie = if (editable) {
            { BarraGuardar(vm.sucio, vm.ocupado, vm.error, vm::descartar, { vm.guardar(avisos) }) }
        } else null,
    ) {
        ConNegocio(vm) {
            val b = vm.borrador!!
            Intro("Datos de contacto, condiciones comerciales y logo que acompañan a las cotizaciones.")
            if (!editable) SinPermiso()
            Hoja {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    CAMPOS_EMPRESA.forEach { campo ->
                        Campo(
                            b.campos[campo.clave].orEmpty(),
                            { vm.cambiar(campo.clave, it) },
                            campo.etiqueta,
                            error = if (campo.clave == "correo") vm.errorCorreo else null,
                            teclado = campo.teclado,
                            accionIme = if (campo.multilinea) ImeAction.Default else ImeAction.Next,
                            habilitado = activo,
                            lineas = if (campo.multilinea) 3 else 1,
                            mayusculas = if (campo.clave == "nombre") KeyboardCapitalization.Words else KeyboardCapitalization.Sentences,
                            largoMaximo = when {
                                campo.multilinea -> 1200
                                campo.clave == "correo" -> 254
                                else -> 300
                            },
                            foco = if (campo.clave == "correo") focoCorreo else null,
                        )
                    }
                }
            }
            Hoja {
                TituloSeccion(
                    "Logo para la aplicación y los documentos",
                    detalle = "Sube un SVG de hasta 48 KB. Si lo quitas, se usa el logo de Neltume.",
                )
                Spacer(Modifier.height(12.dp))
                // Fondo blanco: el logo va sobre el papel de los documentos.
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(120.dp)
                        .clip(Radios.lg)
                        .background(Color.White)
                        .border(1.dp, c.linea, Radios.lg)
                        .padding(16.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    val logo = b.logo
                    if (logo != null) {
                        val datos = remember(logo) {
                            "data:image/svg+xml;base64," + Base64.encodeToString(logo.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
                        }
                        AsyncImage(datos, "Vista previa del logo", Modifier.size(width = 180.dp, height = 90.dp), contentScale = ContentScale.Fit)
                    } else {
                        Image(
                            painterResource(R.drawable.logo_neltume),
                            contentDescription = "Vista previa del logo: logo de Neltume",
                            colorFilter = ColorFilter.tint(Color(0xFF1D2B24)),
                            modifier = Modifier.size(width = 76.dp, height = 85.dp),
                        )
                    }
                }
                Spacer(Modifier.height(12.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    BotonSecundario("Seleccionar logo", { elegirLogo.launch(arrayOf("image/svg+xml")) }, icono = Iconos.Subir, habilitado = activo)
                    if (b.logo != null) {
                        BotonSecundario("Usar logo predeterminado", { vm.cambiarLogo(null) }, icono = Iconos.Restaurar, habilitado = activo)
                    }
                }
                vm.errorLogo?.let {
                    Spacer(Modifier.height(8.dp))
                    TextoError(it)
                }
            }
            if (!editable) vm.error?.let { TextoError(it) }
        }
    }
}

// --- Precios y descuentos -----------------------------------------------------------------------------------------

internal data class TramoTexto(val desde: String = "", val porcentaje: String = "")

internal data class BorradorPrecios(
    val margenes: Map<String, String>,
    val iva: String,
    val descuentoMaximo: String,
    val tramos: List<TramoTexto>,
)

/** Problema de los tramos (`ProblemaTramos` de descuento-cantidad.ts): el mensaje y el campo que lo causa. */
internal data class ProblemaTramos(val mensaje: String, val indice: Int? = null, val campo: String? = null)

private const val CAMPO_DESDE = "desde"
private const val CAMPO_PORCENTAJE = "porcentaje"

/** Primer problema de los tramos, o null (`problemaTramos`). Acepta NaN (campo vacío) para decir cuál falta. */
private fun problemaTramos(tramos: List<Pair<Double, Double>>, descuentoMaximo: Double): ProblemaTramos? {
    if (tramos.size > MAX_TRAMOS) return ProblemaTramos("Puedes definir hasta $MAX_TRAMOS tramos.")
    val vistos = mutableSetOf<Double>()
    val incompleto = "Completa «Desde» y el porcentaje de cada tramo."
    tramos.forEachIndexed { i, (desde, pct) ->
        fun enDesde(m: String) = ProblemaTramos(m, i, CAMPO_DESDE)
        fun enPorcentaje(m: String) = ProblemaTramos(m, i, CAMPO_PORCENTAJE)
        if (!desde.isFinite()) return enDesde(incompleto)
        if (!pct.isFinite()) return enPorcentaje(incompleto)
        if (desde != Math.floor(desde) || desde < 2 || desde > MAX_DESDE_PUERTAS)
            return enDesde("«Desde» debe ser un número entero de puertas, de 2 a $MAX_DESDE_PUERTAS.")
        val tramo = "«desde ${desde.toLong()} puertas»"
        if (pct <= 0) return enPorcentaje("El porcentaje del tramo $tramo debe ser mayor que 0.")
        if (!conDosDecimales(pct)) return enPorcentaje("El porcentaje del tramo $tramo admite hasta dos decimales.")
        if (pct > descuentoMaximo)
            return enPorcentaje("El porcentaje del tramo $tramo no puede superar el descuento máximo (${porcentaje(descuentoMaximo)}).")
        if (!vistos.add(desde)) return enDesde("Hay más de un tramo $tramo: cada umbral debe ser distinto.")
    }
    return null
}

private fun claveMargen(clave: String) = "margen-$clave"
private fun claveTramo(i: Int, campo: String) = "tramo-$i-$campo"

/** Campos que viven en «Avanzado»: con un error ahí, el bloque se abre para mostrarlo. */
private fun enAvanzado(clave: String) = clave == "iva" || clave.startsWith("margen-")

internal class PreciosVM(c: Contenedor) : FormularioNegocioVM<BorradorPrecios>(c, "Precios y descuentos guardados.") {
    /** Errores de cada campo: se calculan al guardar y, una vez visibles, se actualizan al corregir. */
    var errores by mutableStateOf<Map<String, String>?>(null)
        private set
    var avisoTramos by mutableStateOf<ProblemaTramos?>(null)
        private set
    var avanzadoAbierto by mutableStateOf(false)
    var foco by mutableStateOf<Pair<String, Int>?>(null)
        private set

    init {
        cargar()
    }

    override fun desde(conf: JsonObject): BorradorPrecios {
        val r = conf.objeto("reglas")
        val margenes = r.objeto("margenes")
        val tramos = (r["descuentosPorCantidad"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }.map { t ->
            TramoTexto((t["desdePuertas"] as? JsonPrimitive)?.intOrNull?.toString().orEmpty(), aTexto(t.numero("porcentaje")))
        }
        return BorradorPrecios(
            margenes = NOMBRES_CATEGORIA_MARGEN.keys.associateWith { aTexto(margenAPorcentaje(margenes.numero(it) ?: 0.0)) },
            iva = aTexto(r.numero("iva")?.let(::margenAPorcentaje)),
            descuentoMaximo = aTexto(r.numero("descuentoMaximo")),
            tramos = tramos,
        )
    }

    private fun tramosNumericos(b: BorradorPrecios) = b.tramos.map { leerEntero(it.desde) to leerCampo(it.porcentaje) }

    /** Con un descuento máximo ilegible, los tramos no se comparan contra él (ese error ya se ve en su campo). */
    private fun problema(b: BorradorPrecios) = problemaTramos(tramosNumericos(b), leerCampo(b.descuentoMaximo).takeIf { it.isFinite() } ?: 100.0)

    /** Errores por campo, en el orden de la pantalla: descuento máximo, ganancias e IVA. */
    private fun erroresPrecios(b: BorradorPrecios): Map<String, String> = buildMap {
        errorPorcentaje(b.descuentoMaximo, Limites.DESCUENTO_MAXIMO)?.let { put("descuentoMaximo", it) }
        NOMBRES_CATEGORIA_MARGEN.keys.forEach { k -> errorPorcentaje(b.margenes[k].orEmpty(), Limites.MARGEN_MAX * 100)?.let { put(claveMargen(k), it) } }
        errorPorcentaje(b.iva, 100.0)?.let { put("iva", it) }
    }

    fun cambiar(b: BorradorPrecios, revisarTramos: Boolean = true) {
        editar(b)
        if (errores != null) errores = erroresPrecios(b)
        if (revisarTramos && avisoTramos != null) avisoTramos = problema(b)
    }

    fun agregarTramo() {
        val b = borrador ?: return
        if (b.tramos.size >= MAX_TRAMOS) return
        cambiar(b.copy(tramos = b.tramos + TramoTexto()), revisarTramos = false)
        foco = claveTramo(b.tramos.size, CAMPO_DESDE) to ((foco?.second ?: 0) + 1)
    }

    fun quitarTramo(i: Int) {
        val b = borrador ?: return
        cambiar(b.copy(tramos = b.tramos.filterIndexed { j, _ -> j != i }))
    }

    private fun enfocar(clave: String) {
        foco = clave to ((foco?.second ?: 0) + 1)
    }

    fun focoAtendido() {
        foco = null
    }

    override fun alLimpiarErrores() {
        errores = null
        avisoTramos = null
    }

    override fun preparar(b: BorradorPrecios): ((JsonObject) -> JsonObject)? {
        val enCampos = erroresPrecios(b)
        val primero = enCampos.keys.firstOrNull()
        if (primero != null) {
            errores = enCampos
            // Un error dentro de «Avanzado» plegado no se vería: se abre antes de llevar el foco.
            if (enCampos.keys.any(::enAvanzado)) avanzadoAbierto = true
            enfocar(primero)
            return null
        }
        errores = null
        val invalido = problema(b)
        if (invalido != null) {
            avisoTramos = invalido
            if (invalido.indice != null && invalido.campo != null) enfocar(claveTramo(invalido.indice, invalido.campo))
            return null
        }
        val margenes = buildJsonObject {
            NOMBRES_CATEGORIA_MARGEN.keys.forEach { k -> put(k, porcentajeAMargen(leerCampo(b.margenes[k].orEmpty()))) }
        }
        val tramos = buildJsonArray {
            tramosNumericos(b).forEach { (desde, pct) ->
                add(buildJsonObject {
                    put("desdePuertas", desde.toLong())
                    put("porcentaje", aCentesimas(pct))
                })
            }
        }
        val iva = porcentajeAMargen(leerCampo(b.iva))
        val maximo = aCentesimas(leerCampo(b.descuentoMaximo))
        return { conf ->
            val reglas = conf.objeto("reglas")
                .con("margenes", margenes)
                .con("iva", JsonPrimitive(iva))
                .con("descuentoMaximo", JsonPrimitive(maximo))
                .con("descuentosPorCantidad", tramos)
            conf.con("reglas", reglas)
        }
    }
}

@Composable
internal fun SeccionPrecios() {
    val vm = vm { PreciosVM(it) }
    val avisos = LocalAvisos.current
    val c = Neltume.colores
    val focos = remember { mutableMapOf<String, FocusRequester>() }
    fun foco(clave: String) = focos.getOrPut(clave) { FocusRequester() }
    LaunchedEffect(vm.foco) {
        val (clave, _) = vm.foco ?: return@LaunchedEffect
        delay(120) // deja abrir «Avanzado» o aparecer la fila nueva antes de mover el foco
        runCatching { focos[clave]?.requestFocus() }
        vm.focoAtendido()
    }
    val editable = vm.puedeEditar
    val activo = editable && !vm.ocupado
    val errores = vm.errores

    MarcoSeccion(
        SeccionAjustes.PRECIOS.encabezado,
        sucio = vm.sucio,
        pie = if (editable) {
            {
                BarraGuardar(
                    vm.sucio,
                    vm.ocupado,
                    if (!errores.isNullOrEmpty()) "Revisa los campos marcados antes de guardar." else vm.error,
                    vm::descartar,
                    { vm.guardar(avisos) },
                )
            }
        } else null,
    ) {
        ConNegocio(vm) {
            val b = vm.borrador!!
            Intro("Estos valores se copian en cada cotización nueva. Cambiarlos no modifica las cotizaciones existentes.")
            if (!editable) SinPermiso()

            Hoja {
                Ceja("Tope de descuento")
                Spacer(Modifier.height(8.dp))
                CampoCifra(
                    b.descuentoMaximo,
                    { vm.cambiar(b.copy(descuentoMaximo = it)) },
                    "Descuento máximo (%)",
                    errores?.get("descuentoMaximo"),
                    activo,
                    foco = foco("descuentoMaximo"),
                )
            }

            Hoja {
                Ceja("Descuento por cantidad")
                Spacer(Modifier.height(6.dp))
                Nota(
                    "Descuento automático según el total de puertas de la cotización (marcos, molduras y piezas T no cuentan). Se aplica el tramo más alto alcanzado y nunca supera el descuento máximo; quien cotiza puede cambiarlo en su cotización.",
                    color = c.tintaSuave,
                )
                Spacer(Modifier.height(10.dp))
                if (b.tramos.isEmpty()) Nota("Sin tramos: las cotizaciones no llevan descuento por cantidad.")
                b.tramos.forEachIndexed { i, t ->
                    val aviso = vm.avisoTramos
                    fun marcado(campo: String) = aviso != null && aviso.indice == i && aviso.campo == campo
                    Column(Modifier.padding(top = if (i == 0) 0.dp else 8.dp)) {
                        Rotulo("Tramo ${i + 1}")
                        Row(verticalAlignment = Alignment.Top) {
                            CampoCifra(
                                t.desde,
                                { v -> vm.cambiar(b.copy(tramos = b.tramos.mapIndexed { j, x -> if (j == i) x.copy(desde = v) else x })) },
                                "Desde (puertas)",
                                if (marcado(CAMPO_DESDE)) " " else null,
                                activo,
                                Modifier.weight(1f),
                                entero = true,
                                foco = foco(claveTramo(i, CAMPO_DESDE)),
                                largo = 5,
                            )
                            Spacer(Modifier.width(10.dp))
                            CampoCifra(
                                t.porcentaje,
                                { v -> vm.cambiar(b.copy(tramos = b.tramos.mapIndexed { j, x -> if (j == i) x.copy(porcentaje = v) else x })) },
                                "Descuento (%)",
                                if (marcado(CAMPO_PORCENTAJE)) " " else null,
                                activo,
                                Modifier.weight(1f),
                                foco = foco(claveTramo(i, CAMPO_PORCENTAJE)),
                            )
                            if (editable) {
                                BotonIcono(Iconos.Basura, "Quitar el tramo ${i + 1}", { vm.quitarTramo(i) }, Modifier.padding(top = 6.dp), habilitado = !vm.ocupado)
                            }
                        }
                    }
                }
                vm.avisoTramos?.let {
                    Spacer(Modifier.height(6.dp))
                    TextoError(it.mensaje)
                }
                if (editable) {
                    Spacer(Modifier.height(10.dp))
                    BotonSecundario(
                        "Agregar tramo",
                        vm::agregarTramo,
                        icono = Iconos.Mas,
                        habilitado = !vm.ocupado && b.tramos.size < MAX_TRAMOS,
                    )
                }
            }

            SeccionAvanzada(
                "IVA y ganancia por categoría",
                "Cambian el precio de todas las cotizaciones nuevas. Un valor equivocado (por ejemplo, IVA 1,9 en vez de 19) deja mal cada precio que se cotice después. Cámbialos solo cuando Neltume lo haya decidido.",
                vm.avanzadoAbierto,
                { vm.avanzadoAbierto = it },
            ) {
                Ceja("Ganancia sobre el costo de fábrica")
                Nota("Porcentaje que se suma al costo de fábrica de cada producto para llegar al precio sin IVA de la cotización.", color = c.tintaSuave)
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    NOMBRES_CATEGORIA_MARGEN.forEach { (clave, etiqueta) ->
                        CampoCifra(
                            b.margenes[clave].orEmpty(),
                            { v -> vm.cambiar(b.copy(margenes = b.margenes + (clave to v)), revisarTramos = false) },
                            "$etiqueta (%)",
                            errores?.get(claveMargen(clave)),
                            activo,
                            foco = foco(claveMargen(clave)),
                        )
                    }
                }
                Ceja("IVA", Modifier.padding(top = 6.dp))
                CampoCifra(
                    b.iva,
                    { vm.cambiar(b.copy(iva = it), revisarTramos = false) },
                    "IVA (%)",
                    errores?.get("iva"),
                    activo,
                    foco = foco("iva"),
                )
            }
            if (!editable) vm.error?.let { TextoError(it) }
        }
    }
}

// --- Vigencia y transportistas ------------------------------------------------------------------------------------

internal data class BorradorCotizaciones(val vigencia: String, val transportistas: String)

/** Lista de transportistas tal como se guarda: sin espacios sobrantes, sin líneas vacías ni repetidas. */
private fun listaTransportistas(texto: String) = texto.split('\n').map { it.trim() }.filter { it.isNotEmpty() }.distinct()

private fun errorVigencia(texto: String): String? {
    val n = leerEntero(texto)
    return if (n.isNaN() || n > 365) "Escribe un número entero de días, entre 0 y 365." else null
}

internal class CotizacionesVM(c: Contenedor) : FormularioNegocioVM<BorradorCotizaciones>(c, "Vigencia y transportistas guardados.") {
    /** Error de la vigencia: se muestra al guardar y, una vez visible, se actualiza al corregir. */
    var errorDias by mutableStateOf<String?>(null)
        private set
    var focoDias by mutableIntStateOf(0)
        private set

    init {
        cargar()
    }

    override fun desde(conf: JsonObject): BorradorCotizaciones {
        val r = conf.objeto("reglas")
        val transportistas = (conf["transportistas"] as? JsonArray).orEmpty().mapNotNull { runCatching { it.jsonPrimitive.content }.getOrNull() }
        return BorradorCotizaciones((r["vigenciaDiasHabiles"] as? JsonPrimitive)?.intOrNull?.toString().orEmpty(), transportistas.joinToString("\n"))
    }

    /** Se edita como texto (una opción por línea) y se ordena recién al guardar, para poder escribir líneas nuevas. */
    override fun clave(b: BorradorCotizaciones): Any = listOf(b.vigencia.trim(), listaTransportistas(b.transportistas))

    fun cambiarVigencia(texto: String) {
        val b = borrador ?: return
        editar(b.copy(vigencia = texto))
        if (errorDias != null) errorDias = errorVigencia(texto)
    }

    fun cambiarTransportistas(texto: String) {
        val b = borrador ?: return
        editar(b.copy(transportistas = texto))
    }

    override fun alLimpiarErrores() {
        errorDias = null
    }

    fun focoAtendido() {
        focoDias = 0
    }

    override fun preparar(b: BorradorCotizaciones): ((JsonObject) -> JsonObject)? {
        errorDias = errorVigencia(b.vigencia)
        if (errorDias != null) {
            focoDias++
            return null
        }
        val dias = leerEntero(b.vigencia).toLong()
        val lista = listaTransportistas(b.transportistas)
        return { conf ->
            conf.con("reglas", conf.objeto("reglas").con("vigenciaDiasHabiles", JsonPrimitive(dias)))
                .con("transportistas", JsonArray(lista.map { JsonPrimitive(it) }))
        }
    }
}

@Composable
internal fun SeccionCotizaciones() {
    val vm = vm { CotizacionesVM(it) }
    val avisos = LocalAvisos.current
    val focoDias = remember { FocusRequester() }
    LaunchedEffect(vm.focoDias) {
        if (vm.focoDias == 0) return@LaunchedEffect
        runCatching { focoDias.requestFocus() }
        vm.focoAtendido()
    }
    val editable = vm.puedeEditar
    val activo = editable && !vm.ocupado

    MarcoSeccion(
        SeccionAjustes.COTIZACIONES.encabezado,
        sucio = vm.sucio,
        pie = if (editable) {
            { BarraGuardar(vm.sucio, vm.ocupado, vm.error, vm::descartar, { vm.guardar(avisos) }) }
        } else null,
    ) {
        ConNegocio(vm) {
            val b = vm.borrador!!
            Intro("Rige para las cotizaciones nuevas; las existentes conservan lo que tenían.")
            if (!editable) SinPermiso()
            Hoja {
                Ceja("Vigencia")
                Spacer(Modifier.height(8.dp))
                CampoCifra(
                    b.vigencia,
                    vm::cambiarVigencia,
                    "Vigencia (días hábiles)",
                    vm.errorDias,
                    activo,
                    entero = true,
                    foco = focoDias,
                )
                Nota(
                    "No cuentan los fines de semana ni los feriados de Chile, que se actualizan solos (incluidos los decretados por única vez, como los de elecciones).",
                )
            }
            Hoja {
                Ceja("Transportistas")
                Spacer(Modifier.height(8.dp))
                Campo(
                    b.transportistas,
                    vm::cambiarTransportistas,
                    "Opciones de despacho, una por línea",
                    accionIme = ImeAction.Default,
                    habilitado = activo,
                    lineas = 4,
                    maxLineas = 10,
                    largoMaximo = 800,
                    mayusculas = KeyboardCapitalization.Words,
                )
                val lista = listaTransportistas(b.transportistas)
                if (lista.isNotEmpty()) {
                    Nota("${lista.size} ${if (lista.size == 1) "opción" else "opciones"}: ${lista.joinToString(", ")}")
                }
            }
            if (!editable) vm.error?.let { TextoError(it) }
        }
    }
}
