package cl.puertasneltume.cotizador.ajustes

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cl.puertasneltume.cotizador.Contenedor
import cl.puertasneltume.cotizador.comun.Avisos
import cl.puertasneltume.cotizador.comun.LocalAvisos
import cl.puertasneltume.cotizador.comun.LocalContenedor
import cl.puertasneltume.cotizador.comun.vm
import cl.puertasneltume.cotizador.cotizar.DialogoConfirmacion
import cl.puertasneltume.cotizador.diseno.Aviso
import cl.puertasneltume.cotizador.diseno.BotonPrincipal
import cl.puertasneltume.cotizador.diseno.BotonSecundario
import cl.puertasneltume.cotizador.diseno.BotonTexto
import cl.puertasneltume.cotizador.diseno.Campo
import cl.puertasneltume.cotizador.diseno.Divisor
import cl.puertasneltume.cotizador.diseno.Hoja
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Pildora
import cl.puertasneltume.cotizador.diseno.Radios
import cl.puertasneltume.cotizador.diseno.Rotulo
import cl.puertasneltume.cotizador.diseno.TituloSeccion
import cl.puertasneltume.cotizador.diseno.TonoAviso
import cl.puertasneltume.cotizador.nucleo.api.FalloApi
import cl.puertasneltume.cotizador.nucleo.api.JsonNeltume
import cl.puertasneltume.cotizador.nucleo.api.Mensajes
import cl.puertasneltume.cotizador.nucleo.api.texto
import cl.puertasneltume.cotizador.nucleo.reglas.NumerosCL
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode
import java.text.Collator
import java.time.Instant
import java.time.ZoneId
import java.util.Locale

/** Responde cuando el modelo principal falla (`MODELO_RESPALDO_PREDETERMINADO` de src/asistente/ajustes.ts). */
private const val MODELO_RESPALDO_PREDETERMINADO = "Qwen/Qwen3.7-Flash"

/** Un modelo que no responde con herramientas, sin acceso o sin clave no necesita más casos. */
private val SIN_SENTIDO_SEGUIR = setOf("ia_configuracion", "ia_acceso", "ia_autenticacion", "ia_sin_clave")

/** `GET /api/ajustes` (`EstadoAjustes` de configuracion-ia.tsx). `ajustes` se conserva tal cual para distinguir «sin indicar» de «sin respaldo». */
@Serializable
internal data class EstadoIA(
    val ajustes: JsonObject = JsonObject(emptyMap()),
    val commandcodeClave: Boolean = false,
    val commandcodeClaveFuente: String = "ninguna",
    val asistenteConfigurado: Boolean = false,
    val puedeEditar: Boolean? = null,
) {
    private val commandcode: JsonObject get() = ajustes["commandcode"] as? JsonObject ?: JsonObject(emptyMap())
    val modelo: String get() = commandcode.texto("modelo") ?: ""
    val tieneRespaldo: Boolean get() = "respaldo" in commandcode

    /** Sin indicar se usa el respaldo predeterminado; null es «sin respaldo». */
    val respaldo: String? get() = if (!tieneRespaldo) MODELO_RESPALDO_PREDETERMINADO else commandcode.texto("respaldo")

    /** Ausente = editable (compatibilidad). */
    val editable: Boolean get() = puedeEditar != false

    /** ¿Hay una clave que quitar? También una guardada que ya no se puede leer. */
    val claveQuitable: Boolean get() = commandcodeClave || commandcodeClaveFuente == "ilegible"
}

@Serializable
internal data class ModeloCC(
    val id: String,
    val nombre: String = "",
    val precioEntrada: Double? = null,
    val precioSalida: Double? = null,
    val gratis: Boolean = false,
) {
    val titulo: String get() = nombre.ifBlank { id }
    val costo: Double? get() = if (precioEntrada == null || precioSalida == null) null else precioEntrada + precioSalida
}

@Serializable
internal data class CatalogoModelos(val modelos: List<ModeloCC> = emptyList(), val desactualizado: Boolean = false)

@Serializable
internal data class CasoPrueba(val id: String = "", val descripcion: String = "")

@Serializable
internal data class ErrorPrueba(val codigo: String = "", val mensaje: String = "")

@Serializable
internal data class ResultadoPrueba(
    val totalCasos: Int = 0,
    val caso: CasoPrueba = CasoPrueba(),
    val correcto: Boolean = false,
    val aciertos: Int = 0,
    val total: Int = 0,
    val ms: Double = 0.0,
    val compatible: Boolean = false,
    val error: ErrorPrueba? = null,
)

/** Avance de «Probar modelo» de un selector (el del asistente o el de respaldo). */
internal data class PruebaModelo(
    val modelo: String,
    val resultados: List<ResultadoPrueba> = emptyList(),
    val total: Int? = null,
    val corriendo: Boolean = true,
    val error: String? = null,
)

private enum class Selector { PRINCIPAL, RESPALDO }

internal class AsistenteVM(private val c: Contenedor) : ViewModel() {
    var estado by mutableStateOf<EstadoIA?>(null)
        private set
    var errorCarga by mutableStateOf<String?>(null)
        private set

    // Borrador del modelo y del respaldo.
    var modelo by mutableStateOf("")
        private set
    var respaldo by mutableStateOf<String?>(null)
        private set
    private var respaldoTocado = false

    var catalogo by mutableStateOf<CatalogoModelos?>(null)
        private set
    var errorCatalogo by mutableStateOf<String?>(null)
        private set

    var ocupado by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set

    var apiKey by mutableStateOf("")
    var guardandoClave by mutableStateOf(false)
        private set
    var errorClave by mutableStateOf<String?>(null)
        private set

    var avanzadoAbierto by mutableStateOf(false)
    private var avanzadoDecidido = false

    var pruebas by mutableStateOf<Map<String, PruebaModelo>>(emptyMap())
        private set

    val cambiado: Boolean get() = estado?.let { modelo != it.modelo || respaldo != it.respaldo } ?: false

    init {
        cargar()
        cargarCatalogo()
    }

    fun cargar() {
        viewModelScope.launch {
            errorCarga = null
            try {
                recibir(leer(EstadoIA.serializer(), c.api.obtenerJson("api/ajustes")), reiniciar = true)
            } catch (e: FalloApi) {
                errorCarga = e.message
            }
        }
    }

    fun cargarCatalogo() {
        catalogo = null
        errorCatalogo = null
        viewModelScope.launch {
            try {
                catalogo = leer(CatalogoModelos.serializer(), c.api.obtenerJson("api/ajustes/modelos"))
            } catch (e: FalloApi) {
                errorCatalogo = e.message
            }
        }
    }

    /** `reiniciar`: el borrador vuelve a lo guardado (al cargar y al guardar el modelo; no al guardar la clave). */
    private fun recibir(e: EstadoIA, reiniciar: Boolean) {
        estado = e
        if (reiniciar) {
            modelo = e.modelo
            respaldo = e.respaldo
            respaldoTocado = false
        }
        // Sin una clave que funcione, «Avanzado» empieza abierto: ahí se escribe. Se decide una vez.
        if (!avanzadoDecidido) {
            avanzadoDecidido = true
            avanzadoAbierto = e.editable && !e.commandcodeClave
        }
    }

    fun elegirModelo(id: String) {
        modelo = id
        error = null
    }

    fun elegirRespaldo(id: String?) {
        respaldo = id
        respaldoTocado = true
        error = null
    }

    fun descartar() {
        estado?.let { recibir(it, reiniciar = true) }
        error = null
    }

    fun guardar(avisos: Avisos) {
        val e = estado ?: return
        if (ocupado || guardandoClave || !e.editable || !cambiado) return
        ocupado = true
        error = null
        viewModelScope.launch {
            try {
                val commandcode = buildJsonObject {
                    put("modelo", modelo)
                    // Sin tocar y sin indicar en lo guardado, el respaldo sigue «sin indicar» (el predeterminado).
                    if (respaldoTocado || e.tieneRespaldo) put("respaldo", respaldo)
                }
                val cuerpo = buildJsonObject {
                    put("tipo", "guardar")
                    put("ajustes", buildJsonObject { put("commandcode", commandcode) })
                }
                recibir(leer(EstadoIA.serializer(), c.api.enviarJson("api/ajustes", cuerpo)), reiniciar = true)
                avisos.mostrar("Configuración del asistente guardada.")
            } catch (x: FalloApi) {
                error = x.message
            } finally {
                ocupado = false
            }
        }
    }

    fun guardarClave(avisos: Avisos) {
        val e = estado ?: return
        if (ocupado || guardandoClave || !e.editable || apiKey.isBlank()) return
        guardandoClave = true
        errorClave = null
        viewModelScope.launch {
            try {
                val r = c.api.enviarJson("api/ajustes", buildJsonObject {
                    put("tipo", "guardar-clave")
                    put("apiKey", apiKey)
                })
                recibir(leer(EstadoIA.serializer(), r), reiniciar = false)
                apiKey = ""
                avisos.mostrar("Clave API de CommandCode guardada en Ajustes.")
            } catch (x: FalloApi) {
                errorClave = x.message
            } finally {
                guardandoClave = false
            }
        }
    }

    fun quitarClave(avisos: Avisos) {
        val e = estado ?: return
        if (!e.claveQuitable || ocupado || guardandoClave || !e.editable) return
        guardandoClave = true
        errorClave = null
        viewModelScope.launch {
            try {
                val r = c.api.enviarJson("api/ajustes", buildJsonObject { put("tipo", "quitar-clave") })
                recibir(leer(EstadoIA.serializer(), r), reiniciar = false)
                apiKey = ""
                avisos.mostrar("Se quitó la clave API de CommandCode.")
            } catch (x: FalloApi) {
                errorClave = x.message
            } finally {
                guardandoClave = false
            }
        }
    }

    /**
     * «Probar modelo»: los casos de prueba con el modelo elegido (aunque no esté guardado), uno por petición para
     * mostrar el avance. Gasta saldo de CommandCode: la pantalla lo confirma antes. Salir de la sección lo detiene.
     */
    fun probar(cual: String, id: String) {
        if (pruebas[cual]?.corriendo == true) return
        viewModelScope.launch {
            var p = PruebaModelo(id)
            pruebas = pruebas + (cual to p)
            try {
                var caso = 0
                while (caso < (p.total ?: Int.MAX_VALUE) && caso < 50) {
                    val r = leer(
                        ResultadoPrueba.serializer(),
                        c.api.enviarJson("api/ajustes/probar", buildJsonObject {
                            put("modelo", id)
                            put("caso", caso)
                        }, larga = true),
                    )
                    p = p.copy(total = r.totalCasos, resultados = p.resultados + r)
                    pruebas = pruebas + (cual to p)
                    if (r.error != null && r.error.codigo in SIN_SENTIDO_SEGUIR) break
                    caso++
                }
            } catch (x: FalloApi) {
                p = p.copy(error = x.message ?: Mensajes.GENERAL)
            }
            pruebas = pruebas + (cual to p.copy(corriendo = false))
        }
    }
}

// --- Textos -------------------------------------------------------------------------------------------------------

/** «US$0,28 entrada · US$1,1 salida / 1 M», «Gratis» o «Precio no publicado». */
private fun precioModelo(m: ModeloCC): String {
    if (m.gratis) return "Gratis"
    if (m.precioEntrada == null || m.precioSalida == null) return "Precio no publicado"
    fun usd(p: Double): String {
        val redondeado = BigDecimal(p.toString()).round(MathContext(3, RoundingMode.HALF_UP)).toDouble()
        return "US$" + NumerosCL.formatear(redondeado, maximoDecimales = 12)
    }
    return "${usd(m.precioEntrada)} entrada · ${usd(m.precioSalida)} salida / 1 M"
}

/** Gratis primero; los demás por entrada + salida; sin precio al final; a igualdad, por nombre. */
private fun ordenarModelos(modelos: List<ModeloCC>): List<ModeloCC> {
    val cotejo = Collator.getInstance(Locale.forLanguageTag("es")).apply { strength = Collator.PRIMARY }
    return modelos.sortedWith { a, b ->
        val ca = a.costo
        val cb = b.costo
        when {
            a.gratis != b.gratis -> if (a.gratis) -1 else 1
            ca != null && cb == null -> -1
            ca == null && cb != null -> 1
            ca != null && cb != null && ca != cb -> ca.compareTo(cb)
            else -> cotejo.compare(a.titulo, b.titulo)
        }
    }
}

/** Último diagnóstico del chat guardado por el cotizador (`DiagnosticoIA` de diagnostico-ia.ts). */
private data class Diagnostico(val modelo: String?, val respaldo: Boolean, val ms: Double, val fecha: Instant)

private fun leerDiagnostico(json: String?): Diagnostico? = runCatching {
    val o = JsonNeltume.parseToJsonElement(json ?: return null).jsonObject
    val modelo = o["modelo"]?.let { if (it is JsonPrimitive && it.isString) it.content else null }
    val respaldo = (o["respaldo"] as? JsonPrimitive)?.booleanOrNull ?: return null
    val ms = (o["ms"] as? JsonPrimitive)?.doubleOrNull?.takeIf { it.isFinite() && it >= 0 } ?: return null
    val fecha = Instant.parse(o.texto("fecha") ?: return null)
    Diagnostico(modelo, respaldo, ms, fecha)
}.getOrNull()

/** Texto del último diagnóstico del chat: qué modelo respondió, si fue el respaldo y cuánto tardó. */
private fun textoDiagnostico(d: Diagnostico?, nombre: String?): String {
    if (d == null) return "Todavía no hay mensajes del chat."
    val modelo = d.modelo?.let { if (nombre != null && nombre != it) "$nombre ($it)" else it } ?: "sin consultar a la IA"
    val segundos = NumerosCL.formatear(d.ms / 1000, minimoDecimales = 1, maximoDecimales = 1)
    val z = d.fecha.atZone(ZoneId.systemDefault())
    val hora = "%02d:%02d".format(z.hour, z.minute)
    return "$hora · $modelo${if (d.respaldo) " · respondió el modelo de respaldo" else ""} · $segundos s"
}

private fun segundos(n: Double) = NumerosCL.formatear(n, maximoDecimales = 1)

// --- Pantalla -----------------------------------------------------------------------------------------------------

@Composable
internal fun SeccionAsistente() {
    val vm = vm { AsistenteVM(it) }
    val avisos = LocalAvisos.current
    val e = vm.estado
    MarcoSeccion(
        SeccionAjustes.ASISTENTE.encabezado,
        sucio = vm.cambiado,
        pie = if (e?.editable == true) {
            { BarraGuardar(vm.cambiado, vm.ocupado || vm.guardandoClave, vm.error, vm::descartar, { vm.guardar(avisos) }) }
        } else null,
    ) {
        when {
            e != null -> FormularioAsistente(vm, e, avisos)
            vm.errorCarga != null -> ErrorCarga(vm.errorCarga!!, vm::cargar)
            else -> Cargando("Cargando la configuración…")
        }
    }
}

@Composable
private fun FormularioAsistente(vm: AsistenteVM, e: EstadoIA, avisos: Avisos) {
    val c = Neltume.colores
    val catalogo = vm.catalogo
    val modelos = catalogo?.modelos.orEmpty()
    fun nombreDe(id: String) = modelos.firstOrNull { it.id == id }?.nombre?.takeIf { it.isNotBlank() }
    var elegir by remember { mutableStateOf<Selector?>(null) }
    var probar by remember { mutableStateOf<Pair<Selector, String>?>(null) }
    var quitarClave by remember { mutableStateOf(false) }
    val bloqueado = vm.ocupado || vm.guardandoClave

    Intro("El asistente interpreta los mensajes del chat. Los precios siempre se calculan en el cotizador y nunca se envían al asistente.")
    when {
        e.commandcodeClaveFuente == "ilegible" ->
            Aviso("La clave guardada ya no se puede leer. Vuelve a ingresarla aquí.", tono = TonoAviso.ATENCION)
        e.commandcodeClave -> Aviso(
            if (e.commandcodeClaveFuente == "entorno") "El asistente usa la clave definida en el servidor."
            else "El asistente tiene su clave API configurada en Ajustes.",
            tono = TonoAviso.EXITO,
        )
        else -> Aviso("El asistente no está configurado. Pide a quien administra el cotizador que lo active.", tono = TonoAviso.ATENCION)
    }

    SeccionAvanzada(
        "modelo y clave del asistente",
        "Deciden cómo funciona el asistente para todas las cuentas. Cambiar el modelo o quitar la clave puede dejar el chat sin responder, y «Probar modelo» puede gastar saldo de CommandCode. Cámbialos solo si sabes lo que haces o te lo pidió quien da soporte.",
        vm.avanzadoAbierto,
        { vm.avanzadoAbierto = it },
    ) {
        // Modelo del asistente.
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (!e.editable) {
                Rotulo("Modelo del asistente")
                ModeloFijo(vm.modelo, nombreDe(vm.modelo))
                Nota("Solo quien administra el cotizador puede cambiar el modelo.")
            } else {
                SelectorModelo("Modelo del asistente", vm.modelo, null, modelos, catalogo == null && vm.errorCatalogo == null, !bloqueado) {
                    elegir = Selector.PRINCIPAL
                }
                ProbarModelo(vm.pruebas[Selector.PRINCIPAL.name]?.takeIf { it.modelo == vm.modelo }, vm.modelo, bloqueado) {
                    probar = Selector.PRINCIPAL to vm.modelo
                }
            }
        }
        Divisor()
        // Modelo de respaldo.
        val respaldo = vm.respaldo
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (!e.editable) {
                Rotulo("Modelo de respaldo")
                if (respaldo != null) ModeloFijo(respaldo, nombreDe(respaldo))
                else Text("Sin respaldo", style = MaterialTheme.typography.titleSmall, color = c.tinta)
            } else {
                SelectorModelo("Modelo de respaldo", respaldo.orEmpty(), "Sin respaldo", modelos, catalogo == null && vm.errorCatalogo == null, !bloqueado) {
                    elegir = Selector.RESPALDO
                }
                if (respaldo != null) {
                    ProbarModelo(vm.pruebas[Selector.RESPALDO.name]?.takeIf { it.modelo == respaldo }, respaldo, bloqueado) {
                        probar = Selector.RESPALDO to respaldo
                    }
                }
            }
            Nota(
                when {
                    respaldo == null -> "Sin respaldo: si el modelo del asistente falla, se muestra el error y hay que reenviar el mensaje."
                    respaldo == vm.modelo -> "Es el mismo modelo del asistente: no hay respaldo."
                    else -> "Responde solo si el modelo del asistente falla: límite de uso, caída, demora o modelo retirado."
                },
            )
            if (e.editable && respaldo != null) {
                BotonTexto("Quitar respaldo", { vm.elegirRespaldo(null) }, habilitado = !bloqueado, icono = Iconos.Cerrar)
            }
        }
        Divisor()
        UltimaRespuesta(::nombreDe)
        if (catalogo?.desactualizado == true) {
            Aviso("CommandCode no respondió; se muestra el último catálogo disponible.", tono = TonoAviso.ATENCION)
        }
        if (vm.errorCatalogo != null) ErrorCarga("No se pudo cargar el catálogo. ${vm.errorCatalogo}", vm::cargarCatalogo)

        if (e.editable) {
            Divisor()
            ClaveApi(vm, e, avisos, alQuitar = { quitarClave = true })
        }
    }

    elegir?.let { cual ->
        HojaModelos(
            titulo = if (cual == Selector.PRINCIPAL) "Modelo del asistente" else "Modelo de respaldo",
            actual = if (cual == Selector.PRINCIPAL) vm.modelo else vm.respaldo.orEmpty(),
            catalogo = catalogo,
            error = vm.errorCatalogo,
            reintentar = vm::cargarCatalogo,
            alCerrar = { elegir = null },
        ) { id ->
            if (cual == Selector.PRINCIPAL) vm.elegirModelo(id) else vm.elegirRespaldo(id)
            elegir = null
        }
    }

    probar?.let { (cual, id) ->
        val info = modelos.firstOrNull { it.id == id }
        DialogoConfirmacion(
            "Probar ${info?.titulo ?: id}",
            "Se envían 5 pedidos de prueba (unas 5 a 8 consultas) a este modelo, sin respaldo y sin crear cotizaciones." +
                (info?.let { " Precio del modelo: ${precioModelo(it)}." } ?: ""),
            "Probar",
        ) { ok ->
            probar = null
            if (ok) vm.probar(cual.name, id)
        }
    }

    if (quitarClave) {
        DialogoConfirmacion(
            "Quitar clave de CommandCode",
            "El asistente dejará de funcionar hasta que se configure otra clave.",
            "Quitar clave",
            peligro = true,
        ) { ok ->
            quitarClave = false
            if (ok) vm.quitarClave(avisos)
        }
    }
}

@Composable
private fun ClaveApi(vm: AsistenteVM, e: EstadoIA, avisos: Avisos, alQuitar: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        TituloSeccion(
            "Clave API de CommandCode",
            detalle = if (e.commandcodeClaveFuente == "entorno")
                "El asistente usa una clave definida en el servidor. Si guardas otra aquí, se usará esta en su lugar."
            else "La clave se guarda cifrada en este cotizador y no vuelve a mostrarse.",
        )
        CampoContrasena(
            vm.apiKey,
            { vm.apiKey = it },
            "Nueva clave API",
            ayuda = if (e.commandcodeClave) "Ingresa una clave para reemplazar la actual" else "Pega tu clave API",
            error = vm.errorClave,
            accionIme = ImeAction.Done,
            alAccion = { vm.guardarClave(avisos) },
            habilitado = !vm.guardandoClave && !vm.ocupado,
            autocompletar = false,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (e.claveQuitable) {
                BotonSecundario("Quitar clave", alQuitar, Modifier.weight(1f), habilitado = !vm.guardandoClave && !vm.ocupado, peligro = true)
            }
            BotonPrincipal(
                if (vm.guardandoClave) "Guardando…" else "Guardar clave",
                { vm.guardarClave(avisos) },
                Modifier.weight(1f),
                habilitado = !vm.ocupado && vm.apiKey.isNotBlank(),
                cargando = vm.guardandoClave,
            )
        }
    }
}

/** Último mensaje del chat: si respondió el respaldo, el modelo del asistente está fallando. */
@Composable
private fun UltimaRespuesta(nombreDe: (String) -> String?) {
    val contenedor = LocalContenedor.current
    val json by contenedor.preferencias.diagnostico.collectAsState(null)
    val d = remember(json) { leerDiagnostico(json) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Rotulo("Última respuesta del chat")
        val texto = textoDiagnostico(d, d?.modelo?.let(nombreDe))
        if (d?.respaldo == true) {
            Aviso("$texto. El modelo del asistente falló en ese mensaje: pruébalo o revisa el registro del servidor.", tono = TonoAviso.ATENCION)
        } else {
            Nota(texto, color = Neltume.colores.tintaSuave)
        }
    }
}

/** Un modelo como dato (sin permiso para cambiarlo): sin nombre conocido, el identificador basta. */
@Composable
private fun ModeloFijo(id: String, nombre: String?) {
    val c = Neltume.colores
    Column(Modifier.fillMaxWidth().clip(Radios.md).background(c.panel).padding(12.dp)) {
        if (nombre != null && nombre != id) {
            Text(nombre, style = MaterialTheme.typography.titleSmall, color = c.tinta)
            Text(id, style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace), color = c.apagado)
        } else {
            Text(id, style = MaterialTheme.typography.titleSmall, color = c.tinta)
        }
    }
}

@Composable
private fun SelectorModelo(
    etiqueta: String,
    modelo: String,
    vacio: String?,
    modelos: List<ModeloCC>,
    cargando: Boolean,
    habilitado: Boolean,
    alPulsar: () -> Unit,
) {
    val actual = modelos.firstOrNull { it.id == modelo }
    val principal = actual?.titulo ?: modelo.ifEmpty { vacio.orEmpty() }
    SelectorCampo(etiqueta, principal, habilitado, alPulsar) {
        TextoSelector(principal, modelo.takeIf { it.isNotEmpty() && it != principal }, apagado = modelo.isEmpty())
    }
    if (actual == null && modelo.isNotBlank() && !cargando && modelos.isNotEmpty()) {
        Nota("El modelo guardado no aparece en el catálogo actual de CommandCode.", color = Neltume.colores.pendiente)
    }
}

/** Botón «Probar modelo» con el avance y el resultado de la prueba del modelo elegido. */
@Composable
private fun ProbarModelo(prueba: PruebaModelo?, modelo: String, deshabilitado: Boolean, alProbar: () -> Unit) {
    val c = Neltume.colores
    val resultados = prueba?.resultados.orEmpty()
    val corriendo = prueba?.corriendo == true
    val total = prueba?.total ?: 5
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        BotonSecundario(
            if (corriendo) "Probando ${minOf(resultados.size + 1, total)} de $total…" else "Probar modelo",
            alProbar,
            icono = Iconos.Reproducir,
            habilitado = !deshabilitado && modelo.isNotBlank() && !corriendo,
            cargando = corriendo,
        )
        if (resultados.isNotEmpty() && !corriendo) {
            val compatible = resultados.any { it.compatible }
            val correctos = resultados.count { it.correcto }
            val promedio = resultados.sumOf { it.ms } / resultados.size / 1000
            Aviso(
                if (compatible) "Funciona con el cotizador · $correctos de ${resultados.size} pedidos correctos · ${segundos(promedio)} s promedio por pedido"
                else "No funciona con el cotizador: ${resultados.firstOrNull { it.error != null }?.error?.mensaje ?: "no respondió con la herramienta."}",
                tono = if (compatible && correctos == resultados.size) TonoAviso.EXITO else TonoAviso.ATENCION,
            )
        }
        resultados.forEach { r ->
            Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.Top) {
                Icon(
                    if (r.correcto) Iconos.Check else Iconos.CirculoX,
                    if (r.correcto) "Correcto" else "Incorrecto",
                    tint = if (r.correcto) c.verde else c.peligro,
                    modifier = Modifier.padding(top = 2.dp).size(16.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    "${r.caso.descripcion} · ${r.error?.codigo ?: "${r.aciertos}/${r.total}"} · ${segundos(r.ms / 1000)} s",
                    style = MaterialTheme.typography.bodySmall,
                    color = c.tintaSuave,
                )
            }
        }
        prueba?.error?.let { TextoError(it) }
    }
}

/** Lista de modelos de CommandCode con búsqueda, agrupada como en la web. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HojaModelos(
    titulo: String,
    actual: String,
    catalogo: CatalogoModelos?,
    error: String?,
    reintentar: () -> Unit,
    alCerrar: () -> Unit,
    elegir: (String) -> Unit,
) {
    val c = Neltume.colores
    var busqueda by remember { mutableStateOf("") }
    val modelos = catalogo?.modelos.orEmpty()
    val ordenados = remember(modelos) { ordenarModelos(modelos) }
    val criterio = busqueda.trim().lowercase(Locale.forLanguageTag("es"))
    val filtrados = ordenados.filter {
        criterio.isEmpty() || it.titulo.lowercase(Locale.forLanguageTag("es")).contains(criterio) || it.id.lowercase(Locale.forLanguageTag("es")).contains(criterio)
    }
    val grupos = listOf(
        "Gratis" to filtrados.filter { it.gratis },
        "Ordenados por precio" to filtrados.filter { !it.gratis && it.costo != null },
        "Precio no publicado" to filtrados.filter { !it.gratis && it.costo == null },
    ).filter { it.second.isNotEmpty() }
    val noDisponible = actual.isNotBlank() && catalogo != null && modelos.none { it.id == actual }

    ModalBottomSheet(alCerrar, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = c.superficie) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(0.92f).padding(horizontal = 16.dp)) {
            TituloSeccion(titulo, detalle = "Gratis primero; los demás se ordenan por entrada + salida por millón de tokens.")
            Spacer(Modifier.height(10.dp))
            Campo(busqueda, { busqueda = it }, "Buscar modelo o identificador…", icono = Iconos.Buscar, accionIme = ImeAction.Search)
            when {
                catalogo == null && error == null -> Cargando("Cargando el catálogo de CommandCode…")
                catalogo == null -> ErrorCarga("No se pudo cargar el catálogo.", reintentar, Modifier.padding(top = 8.dp))
                else -> LazyColumn(Modifier.weight(1f).navigationBarsPadding(), contentPadding = PaddingValues(vertical = 8.dp)) {
                    if (noDisponible) item { Nota("El modelo seleccionado ya no aparece en el catálogo actual.", Modifier.padding(vertical = 6.dp), color = c.pendiente) }
                    if (grupos.isEmpty()) {
                        item {
                            Nota(
                                if (modelos.isNotEmpty()) "No hay modelos que coincidan con la búsqueda." else "CommandCode no publicó modelos compatibles.",
                                Modifier.padding(vertical = 16.dp),
                            )
                        }
                    }
                    grupos.forEach { (grupo, opciones) ->
                        item(key = "g-$grupo") { Ceja(grupo, Modifier.padding(top = 14.dp, bottom = 6.dp)) }
                        items(opciones, key = { "m-$grupo-${it.id}" }) { m -> OpcionModelo(m, m.id == actual) { elegir(m.id) } }
                    }
                    if (catalogo.desactualizado) {
                        item { Nota("No se pudo actualizar el catálogo; esta lista puede estar desactualizada.", Modifier.padding(vertical = 10.dp), color = c.pendiente) }
                    }
                }
            }
        }
    }
}

@Composable
private fun OpcionModelo(m: ModeloCC, elegido: Boolean, alElegir: () -> Unit) {
    val c = Neltume.colores
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clip(Radios.lg)
            .background(if (elegido) c.verdeVelo else c.superficie)
            .clickable(onClick = alElegir)
            .semantics(mergeDescendants = true) {
                role = Role.RadioButton
                selected = elegido
            }
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(m.titulo, style = MaterialTheme.typography.titleSmall, color = c.tinta, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(m.id, style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace), color = c.apagado, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Spacer(Modifier.width(10.dp))
        Column(horizontalAlignment = Alignment.End) {
            if (m.gratis) Pildora("GRATIS", c.verdeVelo, c.verde)
            else Text(precioModelo(m), style = MaterialTheme.typography.labelSmall, color = c.tintaSuave)
        }
        if (elegido) {
            Spacer(Modifier.width(8.dp))
            Icon(Iconos.Check, null, tint = c.verde, modifier = Modifier.size(18.dp))
        }
    }
}
