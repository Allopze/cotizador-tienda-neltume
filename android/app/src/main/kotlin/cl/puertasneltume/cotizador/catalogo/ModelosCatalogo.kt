package cl.puertasneltume.cotizador.catalogo

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cl.puertasneltume.cotizador.Contenedor
import cl.puertasneltume.cotizador.comun.LocalAvisos
import cl.puertasneltume.cotizador.comun.LocalContenedor
import cl.puertasneltume.cotizador.comun.MarcoPantalla
import cl.puertasneltume.cotizador.comun.vm
import cl.puertasneltume.cotizador.diseno.Aviso
import cl.puertasneltume.cotizador.diseno.BotonIcono
import cl.puertasneltume.cotizador.diseno.BotonPrincipal
import cl.puertasneltume.cotizador.diseno.BotonSecundario
import cl.puertasneltume.cotizador.diseno.Campo
import cl.puertasneltume.cotizador.diseno.Divisor
import cl.puertasneltume.cotizador.diseno.EstadoVacio
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.MuestraMadera
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Pildora
import cl.puertasneltume.cotizador.diseno.Rotulo
import cl.puertasneltume.cotizador.diseno.Tarjeta
import cl.puertasneltume.cotizador.diseno.TituloSeccion
import cl.puertasneltume.cotizador.diseno.TonoAviso
import cl.puertasneltume.cotizador.nucleo.api.FalloApi
import cl.puertasneltume.cotizador.nucleo.reglas.nombreProducto
import cl.puertasneltume.cotizador.nucleo.reglas.pesos
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

// Vista por modelo (src/app/modelos-catalogo.tsx): cada puerta con sus maderas y medidas. Desde aquí se crea un
// modelo nuevo copiando uno parecido (con el costo ajustado) y se renombra uno agregado aquí.

@Serializable
internal data class MaderaDeModelo(val madera: String, val filas: Int = 0, val desde: Double = 0.0, val hasta: Double = 0.0)

@Serializable
internal data class ModeloResumen(
    val modelo: String,
    val familia: String = "PUERTA",
    val filas: Int = 0,
    val origen: String = "planilla",
    val maderas: List<MaderaDeModelo> = emptyList(),
)

@Serializable
private data class RespuestaModelos(val modelos: List<ModeloResumen> = emptyList())

@Serializable
private data class ModeloCreado(val modelo: String, val creados: Int = 0)

@Serializable
private data class ModeloRenombrado(val modelo: String)

private val ORIGEN = mapOf("planilla" to "De la planilla", "manual" to "Agregado aquí", "mixto" to "Planilla y agregados aquí")

private fun medidas(n: Int) = "$n ${if (n == 1) "medida" else "medidas"}"

internal class ModelosViewModel(private val c: Contenedor) : ViewModel() {
    var modelos by mutableStateOf<List<ModeloResumen>?>(null)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var filtro by mutableStateOf("")

    init {
        cargar()
    }

    fun cargar() {
        error = null
        viewModelScope.launch {
            try {
                modelos = c.pedirCatalogo(RespuestaModelos.serializer(), buildJsonObject { put("tipo", "listar_modelos") }).modelos
            } catch (e: FalloApi) {
                error = e.message
            }
        }
    }

    val visibles: List<ModeloResumen>
        get() {
            val texto = plana(filtro).trim()
            return modelos.orEmpty().filter { texto.isEmpty() || plana(it.modelo).contains(texto) }
        }
}

@Composable
internal fun SeccionModelos(s: SeccionCatalogo, volver: () -> Unit) {
    val vm = vm { ModelosViewModel(it) }
    val avisos = LocalAvisos.current
    var duplicando by remember { mutableStateOf<ModeloResumen?>(null) }
    var renombrando by remember { mutableStateOf<ModeloResumen?>(null) }
    MarcoPantalla(s.titulo, alVolver = volver, subtitulo = "Catálogo") {
        ConMargenLateral { lado ->
            val modelos = vm.modelos
            val error = vm.error
            LazyColumn(Modifier.fillMaxSize(), contentPadding = relleno(lado), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item(key = "intro") {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Introduccion(
                            "Un modelo reúne todas las maderas y medidas de una puerta o accesorio. Para crear uno nuevo parecido a " +
                                "otro, usa **Duplicar**: copia sus maderas y medidas, ajusta el costo en un porcentaje y queda listo " +
                                "para cotizar. Las medidas sueltas se agregan en «Agregar producto».",
                        )
                        Campo(
                            vm.filtro,
                            { vm.filtro = it },
                            "Buscar modelo",
                            ayuda = "Por ejemplo, Ranco",
                            icono = Iconos.Buscar,
                            accionIme = ImeAction.Search,
                            mayusculas = KeyboardCapitalization.None,
                            largoMaximo = 60,
                            final = if (vm.filtro.isNotEmpty()) ({ BotonIcono(Iconos.Cerrar, "Borrar búsqueda", { vm.filtro = "" }) }) else null,
                        )
                    }
                }
                when {
                    error != null -> item(key = "error") { ErrorReintento(error, vm::cargar) }
                    modelos == null -> item(key = "cargando") { Cargando("Cargando modelos…") }
                    vm.visibles.isEmpty() -> item(key = "vacio") {
                        EstadoVacio(Iconos.Buscar, "Sin coincidencias", "Ningún modelo coincide con «${vm.filtro.trim()}».")
                    }
                    else -> items(vm.visibles, key = { it.modelo }) { m ->
                        FichaModelo(m, duplicar = { duplicando = m }, renombrar = { renombrando = m })
                    }
                }
            }
        }
    }
    duplicando?.let { m ->
        HojaDuplicar(m, alCerrar = { duplicando = null }) { nuevo, creados ->
            duplicando = null
            vm.filtro = nuevo
            vm.cargar()
            avisos.mostrar("Modelo ${nombreProducto(nuevo)} creado con ${medidas(creados)}. Ya se puede cotizar.", largo = true)
        }
    }
    renombrando?.let { m ->
        HojaRenombrar(m, alCerrar = { renombrando = null }) { nuevo ->
            renombrando = null
            vm.filtro = nuevo
            vm.cargar()
            avisos.mostrar("Modelo renombrado a ${nombreProducto(nuevo)}. El nombre anterior se sigue reconociendo.", largo = true)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FichaModelo(m: ModeloResumen, duplicar: () -> Unit, renombrar: () -> Unit) {
    val c = Neltume.colores
    Tarjeta(null) {
        Text(nombreProducto(m.modelo), Modifier.semantics { heading() }, style = MaterialTheme.typography.titleLarge, color = c.tinta)
        Spacer(Modifier.height(4.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("${etiquetaFamilia(m.familia)} · ${medidas(m.filas)}", style = MaterialTheme.typography.bodySmall, color = c.apagado)
            Spacer(Modifier.width(8.dp))
            Pildora(ORIGEN[m.origen] ?: m.origen, if (m.origen == "planilla") c.tonal else c.verdeVelo, if (m.origen == "planilla") c.tintaSuave else c.verde)
        }
        Spacer(Modifier.height(10.dp))
        Divisor()
        Column(Modifier.padding(vertical = 6.dp)) {
            m.maderas.forEach { d ->
                Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    MuestraMadera(d.madera)
                    Spacer(Modifier.width(10.dp))
                    Text(nombreProducto(d.madera), Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, color = c.tinta)
                    Text(
                        "${medidas(d.filas)} · costo ${pesos(d.desde)}${if (d.hasta != d.desde) " a ${pesos(d.hasta)}" else ""}",
                        style = MaterialTheme.typography.bodySmall,
                        color = c.tintaSuave,
                    )
                }
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            BotonSecundario("Duplicar", duplicar, icono = Iconos.Duplicar)
            if (m.origen == "manual") BotonSecundario("Renombrar", renombrar, icono = Iconos.Lapiz)
        }
    }
}

/** Lee el ajuste como la web: «10», «-5», «2,5 %»; vacío es 0. */
private fun leerAjuste(texto: String): Double? =
    texto.replace(',', '.').replace("%", "").replace('−', '-').trim().ifEmpty { "0" }.toDoubleOrNull()?.takeIf { it.isFinite() }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HojaDuplicar(m: ModeloResumen, alCerrar: () -> Unit, alCrear: (String, Int) -> Unit) {
    val c = Neltume.colores
    val contenedor = LocalContenedor.current
    val alcance = rememberCoroutineScope()
    var nombre by rememberSaveable { mutableStateOf("") }
    var maderas by remember { mutableStateOf(m.maderas.map { it.madera }.toSet()) }
    var ajuste by rememberSaveable { mutableStateOf("0") }
    var ocupado by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val porcentaje = leerAjuste(ajuste)
    val ajusteValido = porcentaje != null && porcentaje >= -50 && porcentaje <= 200
    val factor = 1 + (if (ajusteValido) porcentaje!! else 0.0) / 100
    val elegidas = m.maderas.filter { it.madera in maderas }
    val total = elegidas.sumOf { it.filas }
    val ejemplo = elegidas.firstOrNull()

    fun crear() {
        error = when {
            nombre.isBlank() -> "Escribe el nombre del modelo nuevo."
            elegidas.isEmpty() -> "Elige al menos una madera."
            !ajusteValido -> "El ajuste debe estar entre −50 % y +200 %."
            else -> null
        }
        if (error != null) return
        ocupado = true
        alcance.launch {
            try {
                val r = contenedor.pedirCatalogo(ModeloCreado.serializer(), buildJsonObject {
                    put("tipo", "duplicar_modelo")
                    put("origen", m.modelo)
                    put("nombre", nombre.trim())
                    if (elegidas.size == m.maderas.size) put("maderas", JsonNull) else putJsonArray("maderas") { elegidas.forEach { add(JsonPrimitive(it.madera)) } }
                    put("factor", factor)
                })
                alCrear(r.modelo, r.creados)
            } catch (e: FalloApi) {
                error = e.message
            } finally {
                ocupado = false
            }
        }
    }

    ModalBottomSheet({ if (!ocupado) alCerrar() }, sheetState = rememberModalBottomSheetState(true), containerColor = c.superficie) {
        Column(
            Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).navigationBarsPadding().padding(bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            TituloSeccion("Duplicar ${nombreProducto(m.modelo)}")
            Campo(nombre, { nombre = it }, "Nombre del modelo nuevo", ayuda = "Ej.: Roble", habilitado = !ocupado, mayusculas = KeyboardCapitalization.Words, largoMaximo = 100)
            Column {
                Rotulo("Maderas que se copian")
                m.maderas.forEach { d ->
                    Casilla(
                        buildAnnotatedString {
                            append(nombreProducto(d.madera))
                            withStyle(SpanStyle(color = c.apagado)) { append(" (${medidas(d.filas)})") }
                        },
                        d.madera in maderas,
                        { marcada -> maderas = if (marcada) maderas + d.madera else maderas - d.madera },
                        habilitada = !ocupado,
                    )
                }
            }
            Campo(
                ajuste,
                { ajuste = it.take(6) },
                "Ajuste del costo de fábrica (%)",
                error = if (!ajusteValido) "El ajuste debe estar entre −50 % y +200 %." else null,
                ayuda = "0 copia los mismos costos; 10 los sube 10 %; −5 los baja 5 %.",
                teclado = KeyboardType.Decimal,
                accionIme = ImeAction.Done,
                alAccion = ::crear,
                habilitado = !ocupado,
                sufijo = "%",
            )
            val negrita = SpanStyle(fontWeight = FontWeight.SemiBold, color = c.tinta)
            Text(
                if (elegidas.isEmpty()) buildAnnotatedString { append("Elige al menos una madera.") }
                else buildAnnotatedString {
                    append("Se crearán ")
                    withStyle(negrita) { append("$total") }
                    append(if (total == 1) " medida" else " medidas")
                    if (ejemplo != null && ajusteValido) {
                        append(". Por ejemplo, en ${nombreProducto(ejemplo.madera)} el costo de ${pesos(ejemplo.desde)} queda en ")
                        withStyle(negrita) { append(pesos(Math.round(ejemplo.desde * factor).toDouble())) }
                    }
                    append(". El precio de venta se calcula con la ganancia de cada categoría.")
                },
                Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                style = MaterialTheme.typography.bodyMedium,
                color = c.tintaSuave,
            )
            error?.let { Aviso(it, tono = TonoAviso.PELIGRO) }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                BotonSecundario("Cancelar", alCerrar, Modifier.weight(1f), habilitado = !ocupado)
                BotonPrincipal(if (ocupado) "Creando…" else "Crear modelo", ::crear, Modifier.weight(1f), icono = Iconos.Duplicar, cargando = ocupado)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HojaRenombrar(m: ModeloResumen, alCerrar: () -> Unit, alRenombrar: (String) -> Unit) {
    val c = Neltume.colores
    val contenedor = LocalContenedor.current
    val alcance = rememberCoroutineScope()
    var nombre by rememberSaveable { mutableStateOf(nombreProducto(m.modelo)) }
    var ocupado by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun renombrar() {
        if (nombre.isBlank()) {
            error = "Escribe el nombre nuevo."
            return
        }
        ocupado = true
        error = null
        alcance.launch {
            try {
                val r = contenedor.pedirCatalogo(ModeloRenombrado.serializer(), buildJsonObject {
                    put("tipo", "renombrar_modelo")
                    put("anterior", m.modelo)
                    put("nombre", nombre.trim())
                })
                alRenombrar(r.modelo)
            } catch (e: FalloApi) {
                error = e.message
            } finally {
                ocupado = false
            }
        }
    }

    ModalBottomSheet({ if (!ocupado) alCerrar() }, sheetState = rememberModalBottomSheetState(true), containerColor = c.superficie) {
        Column(
            Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).navigationBarsPadding().padding(bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            TituloSeccion("Renombrar ${nombreProducto(m.modelo)}")
            Campo(
                nombre,
                { nombre = it },
                "Nombre nuevo",
                ayuda = "Cambia en sus ${m.filas} medidas. El nombre anterior se sigue reconociendo en el chat y en los borradores.",
                accionIme = ImeAction.Done,
                alAccion = ::renombrar,
                habilitado = !ocupado,
                mayusculas = KeyboardCapitalization.Words,
                largoMaximo = 100,
            )
            error?.let { Aviso(it, tono = TonoAviso.PELIGRO) }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                BotonSecundario("Cancelar", alCerrar, Modifier.weight(1f), habilitado = !ocupado)
                BotonPrincipal(if (ocupado) "Guardando…" else "Renombrar", ::renombrar, Modifier.weight(1f), cargando = ocupado)
            }
        }
    }
}
