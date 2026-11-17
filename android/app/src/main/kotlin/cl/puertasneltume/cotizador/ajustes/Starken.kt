package cl.puertasneltume.cotizador.ajustes

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cl.puertasneltume.cotizador.Contenedor
import cl.puertasneltume.cotizador.comun.Avisos
import cl.puertasneltume.cotizador.comun.LocalAvisos
import cl.puertasneltume.cotizador.comun.vm
import cl.puertasneltume.cotizador.diseno.Aviso
import cl.puertasneltume.cotizador.diseno.Campo
import cl.puertasneltume.cotizador.diseno.Hoja
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Radios
import cl.puertasneltume.cotizador.diseno.TituloSeccion
import cl.puertasneltume.cotizador.diseno.TonoAviso
import cl.puertasneltume.cotizador.nucleo.api.FalloApi
import cl.puertasneltume.cotizador.nucleo.api.Mensajes
import cl.puertasneltume.cotizador.nucleo.reglas.NumerosCL
import cl.puertasneltume.cotizador.nucleo.reglas.jsTexto
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.text.Normalizer
import java.util.Locale

// Ajustes → Starken (src/app/ajustes/starken.tsx): ciudad de origen y, si la empresa los midió, el peso por unidad y
// el grosor de cada familia. Vacíos, el peso y las medidas embaladas se estiman por producto.

@Serializable
internal data class CiudadOrigen(val codigoCiudad: Long, val nombre: String)

@Serializable
internal data class CiudadStarken(val codigoCiudad: Long, val nombre: String, val comunas: List<String> = emptyList())

@Serializable
internal data class FamiliaStarken(val kg: Double? = null, val espesorCm: Double? = null)

@Serializable
internal data class ConfiguracionStarken(val origen: CiudadOrigen? = null, val paquete: Map<String, FamiliaStarken> = emptyMap())

@Serializable
internal data class EstadoStarken(
    val disponible: Boolean = false,
    val mensaje: String? = null,
    val configuracion: ConfiguracionStarken = ConfiguracionStarken(),
    val puedeEditar: Boolean = false,
)

@Serializable
private data class RespuestaCiudades(val ciudades: List<CiudadStarken> = emptyList())

internal data class MedidasTexto(val kg: String = "", val espesorCm: String = "")

/** Familias que viajan (`FAMILIAS_ENVIO` y `ETIQUETA_FAMILIA` de src/negocio/starken.ts). */
private val FAMILIAS = listOf("PUERTA" to "Puertas", "MARCO" to "Marcos", "MOLDURA" to "Molduras", "PIEZAS_T" to "Piezas T")
private const val MAX_KG_UNIDAD = 2000.0
private const val MAX_ESPESOR_CM = 300.0

/** La medida como se escribe: 4.5 → «4,5»; sin definir → vacío (`medidaATexto`). */
private fun medidaATexto(n: Double?) = if (n == null) "" else jsTexto(n).replace('.', ',')

/** Medida escrita («4,5», «4.5», «25»): vacío es null (sin definir); lo que no es un número positivo, NaN (`leerMedida`). */
private fun leerMedida(texto: String): Double? {
    val limpio = texto.trim().replaceFirst(',', '.')
    if (limpio.isEmpty()) return null
    val n = if (Regex("""^\d+(?:\.\d+)?$""").matches(limpio)) limpio.toDouble() else Double.NaN
    return if (n > 0) n else Double.NaN
}

/** Primer problema de los datos de una familia, dicho regla por regla; null si están bien (o ambos vacíos). */
private fun errorFamilia(familia: String, kg: Double?, espesorCm: Double?): String? = when {
    kg != null && kg.isNaN() -> "$familia: el peso por unidad debe ser un número mayor que cero (por ejemplo 4,5)."
    kg != null && kg > MAX_KG_UNIDAD -> "$familia: el peso por unidad no puede superar ${NumerosCL.formatear(MAX_KG_UNIDAD)} kg."
    espesorCm != null && espesorCm.isNaN() -> "$familia: el espesor debe ser un número mayor que cero (por ejemplo 4,5)."
    espesorCm != null && espesorCm > MAX_ESPESOR_CM -> "$familia: el espesor no puede superar ${NumerosCL.formatear(MAX_ESPESOR_CM)} cm."
    (kg == null) != (espesorCm == null) -> "$familia: completa el peso y el espesor, o deja ambos vacíos."
    else -> null
}

private fun aTextos(c: ConfiguracionStarken) = FAMILIAS.associate { (f, _) ->
    val p = c.paquete[f]
    f to MedidasTexto(medidaATexto(p?.kg), medidaATexto(p?.espesorCm))
}

private fun origenDe(e: EstadoStarken) = e.configuracion.origen?.codigoCiudad?.toString().orEmpty()

internal class StarkenVM(private val c: Contenedor) : ViewModel() {
    var estado by mutableStateOf<EstadoStarken?>(null)
        private set
    var origen by mutableStateOf("")
        private set
    var textos by mutableStateOf<Map<String, MedidasTexto>>(emptyMap())
        private set
    var ciudades by mutableStateOf<List<CiudadStarken>?>(null)
        private set
    var errorCarga by mutableStateOf<String?>(null)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var errorCiudades by mutableStateOf<String?>(null)
        private set
    var ocupado by mutableStateOf(false)
        private set

    val sucio: Boolean
        get() {
            val e = estado ?: return false
            return origen != origenDe(e) || textos != aTextos(e.configuracion)
        }

    init {
        cargar()
    }

    private fun recibir(e: EstadoStarken) {
        estado = e
        origen = origenDe(e)
        textos = aTextos(e.configuracion)
    }

    fun cargar() {
        viewModelScope.launch {
            errorCarga = null
            try {
                val e = leer(EstadoStarken.serializer(), c.api.obtenerJson("api/starken"))
                recibir(e)
                if (e.disponible) cargarCiudades()
            } catch (x: FalloApi) {
                errorCarga = x.message
            }
        }
    }

    fun cargarCiudades() {
        viewModelScope.launch {
            errorCiudades = null
            try {
                ciudades = leer(RespuestaCiudades.serializer(), c.api.obtenerJson("api/starken/ciudades", mapOf("tipo" to "origen"))).ciudades
            } catch (x: FalloApi) {
                errorCiudades = x.message
            }
        }
    }

    /** Las ciudades de Starken; si la guardada ya no figura (o la lista no cargó), se conserva como opción. */
    fun opciones(): List<CiudadStarken> {
        val lista = ciudades.orEmpty().toMutableList()
        val guardado = estado?.configuracion?.origen
        if (guardado != null && lista.none { it.codigoCiudad == guardado.codigoCiudad }) {
            lista.add(0, CiudadStarken(guardado.codigoCiudad, guardado.nombre))
        }
        return lista
    }

    fun elegirOrigen(codigo: String) {
        error = null
        origen = codigo
    }

    fun cambiar(familia: String, medidas: MedidasTexto) {
        error = null
        textos = textos + (familia to medidas)
    }

    fun descartar() {
        error = null
        estado?.let(::recibir)
    }

    fun guardar(avisos: Avisos) {
        val e = estado ?: return
        if (!e.puedeEditar || ocupado || !sucio) return
        val medidas = FAMILIAS.map { (f, etiqueta) ->
            val t = textos[f] ?: MedidasTexto()
            val kg = leerMedida(t.kg)
            val espesor = leerMedida(t.espesorCm)
            errorFamilia(etiqueta, kg, espesor)?.let {
                error = it
                return
            }
            Triple(f, kg, espesor)
        }
        val paquete = buildJsonObject {
            medidas.forEach { (f, kg, espesor) ->
                put(f, buildJsonObject {
                    put("kg", kg)
                    put("espesorCm", espesor)
                })
            }
        }
        val ciudad = opciones().firstOrNull { it.codigoCiudad.toString() == origen }
        val cuerpo = buildJsonObject {
            if (ciudad != null) {
                put("origen", buildJsonObject {
                    put("codigoCiudad", ciudad.codigoCiudad)
                    put("nombre", ciudad.nombre)
                })
            } else put("origen", JsonNull)
            put("paquete", paquete)
        }
        ocupado = true
        error = null
        viewModelScope.launch {
            try {
                recibir(leer(EstadoStarken.serializer(), c.api.enviarJson("api/starken", cuerpo)))
                avisos.mostrar("Configuración de Starken guardada.")
            } catch (x: FalloApi) {
                error = x.message ?: Mensajes.GENERAL
            } finally {
                ocupado = false
            }
        }
    }
}

@Composable
internal fun SeccionStarken() {
    val vm = vm { StarkenVM(it) }
    val avisos = LocalAvisos.current
    val e = vm.estado
    val editable = e?.puedeEditar == true
    MarcoSeccion(
        SeccionAjustes.STARKEN.encabezado,
        sucio = vm.sucio,
        pie = if (editable) {
            { BarraGuardar(vm.sucio, vm.ocupado, vm.error, vm::descartar, { vm.guardar(avisos) }) }
        } else null,
    ) {
        when {
            e != null -> FormularioStarken(vm, e)
            vm.errorCarga != null -> ErrorCarga(vm.errorCarga!!, vm::cargar)
            else -> Cargando("Cargando la configuración de Starken…")
        }
    }
}

@Composable
private fun FormularioStarken(vm: StarkenVM, e: EstadoStarken) {
    val c = Neltume.colores
    val editable = e.puedeEditar
    val activo = editable && !vm.ocupado
    var elegirCiudad by remember { mutableStateOf(false) }

    Intro(
        "El despacho con Starken se cotiza desde la cotización, con el bulto que arman las piezas del pedido. Deja vacía una familia para que su peso se estime; si ya pesaste una unidad embalada, indícalo aquí.",
    )
    Plegable(
        "¿Cómo se estima el bulto?",
        "Sin datos medidos, el peso y las medidas de cada producto se calculan con sus medidas, la densidad de la madera y un embalaje típico (cartón para puertas, film para el resto). Con datos medidos se usan el peso y el espesor indicados; los marcos, molduras y piezas T se toman con sección cuadrada de ese espesor.",
    )
    if (!editable) SinPermiso()
    if (!e.disponible) {
        Aviso(
            "Starken aún no está conectado a este cotizador; pide a soporte que lo active. Mientras tanto puedes guardar los pesos medidos.",
            tono = TonoAviso.ATENCION,
        )
    }

    Hoja {
        val opciones = vm.opciones()
        val elegida = opciones.firstOrNull { it.codigoCiudad.toString() == vm.origen }
        val guardado = e.configuracion.origen
        val cargandoCiudades = vm.ciudades == null && e.disponible && vm.errorCiudades == null
        val marcador = if (cargandoCiudades) "Cargando ciudades…" else "Seleccionar ciudad de origen"
        SelectorCampo(
            "Ciudad de origen",
            elegida?.nombre ?: marcador,
            habilitado = activo && e.disponible && !(vm.ciudades == null && guardado == null),
            alPulsar = { elegirCiudad = true },
        ) {
            TextoSelector(elegida?.nombre ?: marcador, apagado = elegida == null)
        }
        vm.errorCiudades?.let {
            Spacer(Modifier.height(8.dp))
            ErrorCarga(it, vm::cargarCiudades)
        }
    }

    FAMILIAS.forEach { (f, etiqueta) ->
        val t = vm.textos[f] ?: MedidasTexto()
        Hoja {
            Ceja(etiqueta)
            Spacer(Modifier.height(8.dp))
            Row {
                Campo(
                    t.kg,
                    { vm.cambiar(f, t.copy(kg = it)) },
                    "Peso por unidad (kg)",
                    Modifier.weight(1f),
                    ayuda = if (t.kg.isBlank()) "Estimado" else null,
                    teclado = KeyboardType.Decimal,
                    habilitado = activo,
                    largoMaximo = 8,
                )
                Spacer(Modifier.width(10.dp))
                Campo(
                    t.espesorCm,
                    { vm.cambiar(f, t.copy(espesorCm = it)) },
                    "Espesor (cm)",
                    Modifier.weight(1f),
                    ayuda = if (t.espesorCm.isBlank()) "Estimado" else null,
                    teclado = KeyboardType.Decimal,
                    accionIme = if (f == FAMILIAS.last().first) ImeAction.Done else ImeAction.Next,
                    habilitado = activo,
                    largoMaximo = 8,
                )
            }
        }
    }
    if (!editable) vm.error?.let { TextoError(it) }

    if (elegirCiudad) {
        HojaCiudades(vm.opciones(), vm.origen, alCerrar = { elegirCiudad = false }) {
            vm.elegirOrigen(it)
            elegirCiudad = false
        }
    }
}

/** Minúsculas, sin tildes: «Ñuble», «nuble» y «ÑUBLE» se buscan igual. */
private fun normalizar(texto: String) = Normalizer.normalize(texto.lowercase(Locale.forLanguageTag("es")), Normalizer.Form.NFD)
    .replace(Regex("""\p{M}+"""), "")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HojaCiudades(opciones: List<CiudadStarken>, actual: String, alCerrar: () -> Unit, elegir: (String) -> Unit) {
    val c = Neltume.colores
    var busqueda by remember { mutableStateOf("") }
    val criterio = normalizar(busqueda.trim())
    val filtradas = opciones.filter { criterio.isEmpty() || normalizar(it.nombre).contains(criterio) || it.comunas.any { k -> normalizar(k).contains(criterio) } }
    ModalBottomSheet(alCerrar, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = c.superficie) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(0.9f).padding(horizontal = 16.dp)) {
            TituloSeccion("Ciudad de origen", detalle = "Desde donde sale el despacho con Starken.")
            Spacer(Modifier.height(10.dp))
            Campo(busqueda, { busqueda = it }, "Buscar ciudad o comuna", icono = Iconos.Buscar, accionIme = ImeAction.Search)
            LazyColumn(Modifier.weight(1f).navigationBarsPadding(), contentPadding = PaddingValues(vertical = 8.dp)) {
                if (criterio.isEmpty()) item(key = "ninguna") { OpcionCiudad("Sin ciudad de origen", null, actual.isEmpty()) { elegir("") } }
                if (filtradas.isEmpty()) item { Nota("No hay ciudades que coincidan con la búsqueda.", Modifier.padding(vertical = 16.dp)) }
                items(filtradas, key = { it.codigoCiudad }) { ciudad ->
                    OpcionCiudad(
                        ciudad.nombre,
                        ciudad.comunas.takeIf { it.isNotEmpty() }?.let { if (it.size <= 4) it.joinToString(", ") else it.take(4).joinToString(", ") + "…" },
                        ciudad.codigoCiudad.toString() == actual,
                    ) { elegir(ciudad.codigoCiudad.toString()) }
                }
            }
        }
    }
}

@Composable
private fun OpcionCiudad(nombre: String, detalle: String?, elegida: Boolean, alElegir: () -> Unit) {
    val c = Neltume.colores
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .clip(Radios.lg)
            .background(if (elegida) c.verdeVelo else c.superficie)
            .clickable(onClick = alElegir)
            .semantics(mergeDescendants = true) {
                role = Role.RadioButton
                selected = elegida
            }
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.Center) {
            Text(nombre, style = MaterialTheme.typography.bodyLarge, color = c.tinta)
            if (detalle != null) Text(detalle, style = MaterialTheme.typography.bodySmall, color = c.apagado, maxLines = 1)
        }
        if (elegida) Icon(Iconos.Check, null, tint = c.verde, modifier = Modifier.size(18.dp))
    }
}
