package cl.puertasneltume.cotizador.catalogo

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cl.puertasneltume.cotizador.Contenedor
import cl.puertasneltume.cotizador.comun.LocalAvisos
import cl.puertasneltume.cotizador.comun.MarcoPantalla
import cl.puertasneltume.cotizador.comun.vm
import cl.puertasneltume.cotizador.diseno.Aviso
import cl.puertasneltume.cotizador.diseno.Bandeja
import cl.puertasneltume.cotizador.diseno.BotonIcono
import cl.puertasneltume.cotizador.diseno.BotonPrincipal
import cl.puertasneltume.cotizador.diseno.BotonSecundario
import cl.puertasneltume.cotizador.diseno.BotonTexto
import cl.puertasneltume.cotizador.diseno.Campo
import cl.puertasneltume.cotizador.diseno.ChipFiltro
import cl.puertasneltume.cotizador.diseno.Hoja
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Radios
import cl.puertasneltume.cotizador.diseno.Rotulo
import cl.puertasneltume.cotizador.diseno.TituloSeccion
import cl.puertasneltume.cotizador.diseno.TonoAviso
import cl.puertasneltume.cotizador.nucleo.api.FalloApi
import kotlinx.coroutines.launch
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

// Nombres y alias del catálogo (src/app/configuracion-catalogo.tsx): las otras formas en que los clientes nombran
// maderas y modelos, y el tipo de producto de cada modelo al importar la planilla.

internal enum class Grupo(val titulo: String) {
    MADERAS("Maderas"),
    MODELOS("Modelos"),
    FAMILIAS("Tipo de producto al importar la planilla"),
}

internal enum class CampoConfig { NOMBRE, CODIGO, ALIAS, POSIBLES, MODELO }

internal data class ErrorFila(val texto: String, val campo: CampoConfig, val vacia: Boolean = false)

internal data class MaderaEdit(val nombre: String = "", val codigo: String = "", val alias: List<String> = emptyList())

/** Un modelo con sus dos listas: lo que se reemplaza solo y lo que obliga a preguntar. */
internal data class ModeloEdit(val modelo: String = "", val alias: List<String> = emptyList(), val posibles: List<String> = emptyList())

internal data class FamiliaEdit(val modelo: String = "", val familia: String = "PUERTA")

internal data class Filas(val maderas: List<MaderaEdit>, val modelos: List<ModeloEdit>, val familias: List<FamiliaEdit>)

/** Errores por grupo y fila: se muestran junto a la fila que hay que corregir. */
internal typealias Errores = Map<Grupo, Map<Int, ErrorFila>>

private fun limpiar(alias: List<String>) = alias.map { it.trim() }.filter { it.isNotEmpty() }

/** `Object.fromEntries`: la última clave repetida gana, pero conserva el lugar de la primera. */
private fun <V> registro(pares: List<Pair<String, V>>): List<Pair<String, V>> {
    val m = LinkedHashMap<String, V>()
    pares.forEach { (k, v) -> m[k] = v }
    return m.toList()
}

internal fun filasDe(c: ConfiguracionCatalogo): Filas {
    val modelos = LinkedHashMap<String, ModeloEdit>()
    fun fila(modelo: String, cambio: (ModeloEdit) -> ModeloEdit) {
        val k = normalizarCatalogo(modelo)
        modelos[k] = cambio(modelos[k] ?: ModeloEdit(modelo))
    }
    for ((modelo, alias) in c.aliasModelos) fila(modelo) { it.copy(alias = it.alias + alias) }
    for ((modelo, alias) in c.aliasPosiblesModelos) fila(modelo) { it.copy(posibles = it.posibles + alias) }
    return Filas(
        maderas = c.maderas.map { MaderaEdit(it.nombre, it.codigo, it.alias) },
        modelos = modelos.values.toList(),
        familias = c.familiasPorModelo.map { (modelo, familia) -> FamiliaEdit(modelo, familia) },
    )
}

internal fun configuracionDe(f: Filas) = ConfiguracionCatalogo(
    maderas = f.maderas.map { MaderaConfigurada(it.nombre.trim(), it.codigo.trim(), limpiar(it.alias)) },
    familiasPorModelo = registro(f.familias.filter { it.modelo.isNotBlank() }.map { it.modelo.trim() to it.familia }),
    aliasModelos = registro(f.modelos.filter { it.modelo.isNotBlank() && it.alias.isNotEmpty() }.map { it.modelo.trim() to limpiar(it.alias) }),
    aliasPosiblesModelos = registro(f.modelos.filter { it.modelo.isNotBlank() && it.posibles.isNotEmpty() }.map { it.modelo.trim() to limpiar(it.posibles) }),
)

/**
 * Lo que el servidor rechazaría, dicho junto a la fila: vacíos, duplicados y palabras que llevan a dos maderas o dos
 * modelos. Compara como el asistente: sin tildes, mayúsculas ni signos.
 */
internal fun validar(f: Filas): Errores {
    val errores = LinkedHashMap<Grupo, LinkedHashMap<Int, ErrorFila>>()
    fun marcar(grupo: Grupo, fila: Int, error: ErrorFila) {
        val delGrupo = errores.getOrPut(grupo) { LinkedHashMap() }
        if (fila !in delGrupo) delGrupo[fila] = error
    }

    val nombres = HashMap<String, Int>()
    val nombresTolerantes = HashMap<String, Int>()
    val codigos = HashMap<String, Int>()
    f.maderas.forEachIndexed { i, m ->
        if (m.nombre.isBlank()) return@forEachIndexed marcar(Grupo.MADERAS, i, ErrorFila("La madera necesita nombre.", CampoConfig.NOMBRE, vacia = true))
        if (m.codigo.isBlank()) return@forEachIndexed marcar(Grupo.MADERAS, i, ErrorFila("La madera necesita código.", CampoConfig.CODIGO, vacia = true))
        if (!Regex("^[A-Za-z0-9]+$").matches(m.codigo.trim()))
            return@forEachIndexed marcar(Grupo.MADERAS, i, ErrorFila("El código solo admite letras y números, sin espacios.", CampoConfig.CODIGO))
        val nombre = normalizarCatalogo(m.nombre)
        val nombreTolerante = claveTolerante(m.nombre)
        val codigo = m.codigo.trim().uppercase()
        when {
            nombre in nombres -> marcar(Grupo.MADERAS, i, ErrorFila("«${m.nombre.trim()}» ya está en la fila ${nombres.getValue(nombre) + 1}.", CampoConfig.NOMBRE))
            nombreTolerante in nombresTolerantes ->
                marcar(Grupo.MADERAS, i, ErrorFila("«${m.nombre.trim()}» ya está en la fila ${nombresTolerantes.getValue(nombreTolerante) + 1}.", CampoConfig.NOMBRE))
            codigo in codigos -> marcar(Grupo.MADERAS, i, ErrorFila("El código «${m.codigo.trim()}» ya lo usa la fila ${codigos.getValue(codigo) + 1}.", CampoConfig.CODIGO))
        }
        nombres.putIfAbsent(nombre, i)
        nombresTolerantes.putIfAbsent(nombreTolerante, i)
        codigos.putIfAbsent(codigo, i)
    }
    // Cada palabra debe llevar a una sola madera. Se marcan las dos filas.
    val terminos = LinkedHashMap<String, MutableList<Pair<Int, String>>>()
    fun anotarTermino(clave: String, fila: Int, valor: String) {
        if (clave.length > 1) terminos.getOrPut(clave) { mutableListOf() } += fila to valor
    }
    f.maderas.forEachIndexed { i, m ->
        for (valor in listOf(m.nombre) + m.alias) {
            anotarTermino("=${normalizarCatalogo(valor)}", i, valor)
            anotarTermino("~${claveTolerante(valor)}", i, valor)
        }
    }
    for (usos in terminos.values)
        for ((fila, valor) in usos) {
            val otro = usos.firstOrNull { (o, _) -> normalizarCatalogo(f.maderas[o].nombre) != normalizarCatalogo(f.maderas[fila].nombre) } ?: continue
            marcar(
                Grupo.MADERAS,
                fila,
                ErrorFila(
                    "«${valor.trim()}» también lleva a ${f.maderas[otro.first].nombre.trim()} (fila ${otro.first + 1}): el asistente no sabría cuál elegir.",
                    if (valor == f.maderas[fila].nombre) CampoConfig.NOMBRE else CampoConfig.ALIAS,
                ),
            )
        }

    for (grupo in listOf(Grupo.MODELOS, Grupo.FAMILIAS)) {
        val vistos = HashMap<String, Int>()
        val vistosTolerantes = HashMap<String, Int>()
        val filas = if (grupo == Grupo.MODELOS) f.modelos.map { it.modelo to (it.alias.isNotEmpty() || it.posibles.isNotEmpty()) }
        else f.familias.map { it.modelo to false }
        filas.forEachIndexed { i, (modelo, conPalabras) ->
            if (modelo.isBlank()) {
                if (conPalabras) marcar(grupo, i, ErrorFila("Escribe el nombre del modelo.", CampoConfig.MODELO, vacia = true))
                return@forEachIndexed
            }
            val k = normalizarCatalogo(modelo)
            val tolerante = claveTolerante(modelo)
            if (k in vistos)
                return@forEachIndexed marcar(grupo, i, ErrorFila("El modelo «${modelo.trim()}» ya está en la fila ${vistos.getValue(k) + 1}.", CampoConfig.MODELO))
            if (grupo == Grupo.MODELOS && tolerante in vistosTolerantes)
                return@forEachIndexed marcar(grupo, i, ErrorFila("El modelo «${modelo.trim()}» ya está en la fila ${vistosTolerantes.getValue(tolerante) + 1}.", CampoConfig.MODELO))
            vistos[k] = i
            vistosTolerantes[tolerante] = i
        }
    }
    // Una palabra de modelo —el nombre, un alias seguro o uno dudoso— debe llevar a un solo modelo; y no estar en las dos columnas.
    val palabras = HashMap<String, Pair<Int, String>>()
    f.modelos.forEachIndexed { i, fila ->
        if (fila.modelo.isBlank()) return@forEachIndexed
        val dudosas = fila.posibles.flatMap { listOf("=${normalizarCatalogo(it)}", "~${claveTolerante(it)}") }.toSet()
        val valores = listOf(CampoConfig.MODELO to fila.modelo) + fila.alias.map { CampoConfig.ALIAS to it } + fila.posibles.map { CampoConfig.POSIBLES to it }
        for ((lista, valor) in valores) {
            val k = normalizarCatalogo(valor)
            if (k.isEmpty()) continue
            if (lista == CampoConfig.ALIAS && ("=$k" in dudosas || "~${claveTolerante(valor)}" in dudosas)) {
                marcar(Grupo.MODELOS, i, ErrorFila("«${valor.trim()}» está en las dos columnas: déjalo solo en una.", CampoConfig.ALIAS))
                continue
            }
            for (clave in listOf("=$k", "~${claveTolerante(valor)}")) {
                val previo = palabras[clave]
                if (previo != null && previo.first != i)
                    marcar(Grupo.MODELOS, i, ErrorFila("«${valor.trim()}» ya lleva a ${previo.second.trim()} (fila ${previo.first + 1}).", lista))
                else if (previo == null) palabras[clave] = i to fila.modelo
            }
        }
    }
    return errores
}

@Serializable
private data class MaderaJson(val nombre: String = "", val codigo: String = "", val alias: List<String> = emptyList())

@Serializable
private data class ConfiguracionJson(
    val maderas: List<MaderaJson> = emptyList(),
    val familiasPorModelo: Map<String, String> = emptyMap(),
    val aliasModelos: Map<String, List<String>> = emptyMap(),
    val aliasPosiblesModelos: Map<String, List<String>> = emptyMap(),
) {
    fun aCatalogo() = ConfiguracionCatalogo(
        maderas.map { MaderaConfigurada(it.nombre, it.codigo, it.alias) },
        familiasPorModelo.toList(),
        aliasModelos.toList(),
        aliasPosiblesModelos.toList(),
    )
}

@Serializable
private data class RespuestaConfiguracion(
    val configuracion: ConfiguracionJson = ConfiguracionJson(),
    val version: String? = null,
    val puedeEditar: Boolean = false,
)

/** El documento que se guarda, con las claves en el mismo orden que la web. */
private fun aJson(c: ConfiguracionCatalogo): JsonObject = buildJsonObject {
    putJsonArray("maderas") {
        c.maderas.forEach { m ->
            add(buildJsonObject {
                put("nombre", m.nombre)
                put("codigo", m.codigo)
                put("alias", JsonArray(m.alias.map(::JsonPrimitive)))
            })
        }
    }
    putJsonObject("familiasPorModelo") { c.familiasPorModelo.forEach { (k, v) -> put(k, v) } }
    putJsonObject("aliasModelos") { c.aliasModelos.forEach { (k, v) -> put(k, JsonArray(v.map(::JsonPrimitive))) } }
    putJsonObject("aliasPosiblesModelos") { c.aliasPosiblesModelos.forEach { (k, v) -> put(k, JsonArray(v.map(::JsonPrimitive))) } }
}

@OptIn(ExperimentalSerializationApi::class)
private val JsonLegible = Json {
    prettyPrint = true
    prettyPrintIndent = "  "
}

private const val RUTA_CONFIGURACION = "api/catalogo-configuracion"

internal class ConfiguracionViewModel(private val c: Contenedor) : ViewModel() {
    var base by mutableStateOf<Filas?>(null)
        private set
    var filas by mutableStateOf<Filas?>(null)
        private set
    var puedeEditar by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set

    /** Otra persona guardó antes: se ofrece recargar. */
    var conflicto by mutableStateOf(false)
        private set
    var ocupado by mutableStateOf(false)
        private set
    var intentado by mutableStateOf(false)
        private set

    /** Versión que se está viendo: al guardar va en `If-Match` (si otra persona guardó, 409). */
    private var version: String? = null

    val sucio: Boolean
        get() {
            val b = base ?: return false
            val f = filas ?: return false
            return configuracionDe(f) != configuracionDe(b)
        }

    init {
        cargar()
    }

    private fun aplicar(r: RespuestaConfiguracion) {
        version = r.version
        val nuevas = filasDe(r.configuracion.aCatalogo())
        base = nuevas
        filas = nuevas
        intentado = false
    }

    fun cargar() {
        error = null
        conflicto = false
        viewModelScope.launch {
            try {
                val r = c.http.obtener(RespuestaConfiguracion.serializer(), RUTA_CONFIGURACION)
                aplicar(r)
                puedeEditar = r.puedeEditar
            } catch (e: FalloApi) {
                error = e.message
            }
        }
    }

    fun cambiar(cambio: (Filas) -> Filas) {
        filas = filas?.let(cambio)
    }

    fun descartar() {
        filas = base
        intentado = false
        error = null
        conflicto = false
    }

    /** Guarda; devuelve false si hay filas por corregir (para llevar la vista a la primera). */
    fun guardar(alGuardar: () -> Unit): Boolean {
        val f = filas ?: return true
        if (!puedeEditar || ocupado) return true
        intentado = true
        if (f.maderas.isEmpty()) {
            error = "Debe quedar al menos una madera."
            return true
        }
        if (validar(f).isNotEmpty()) {
            error = "Corrige las filas marcadas antes de guardar."
            return false
        }
        ocupado = true
        error = null
        conflicto = false
        viewModelScope.launch {
            try {
                val v = version
                val r = c.http.enviar(
                    RespuestaConfiguracion.serializer(),
                    RUTA_CONFIGURACION,
                    aJson(configuracionDe(f)),
                    cabecerasExtra = if (v != null) mapOf("If-Match" to v) else emptyMap(),
                )
                aplicar(r)
                alGuardar()
            } catch (e: FalloApi) {
                error = e.message
                conflicto = e.esConflictoDeVersion
            } finally {
                ocupado = false
            }
        }
        return true
    }
}

@Composable
internal fun SeccionConfiguracion(s: SeccionCatalogo, volver: () -> Unit) {
    val vm = vm { ConfiguracionViewModel(it) }
    val alVolver = GuardiaSalida(vm.sucio, volver)
    MarcoPantalla(s.titulo, alVolver = alVolver, subtitulo = "Catálogo") {
        ConMargenLateral { lado ->
            val filas = vm.filas
            val base = vm.base
            val error = vm.error
            when {
                filas != null && base != null -> EditorConfiguracion(vm, filas, base, lado)
                error != null -> ErrorReintento(error, vm::cargar, Modifier.padding(horizontal = lado, vertical = 16.dp))
                else -> Cargando("Cargando configuración…")
            }
        }
    }
}

@Composable
private fun EditorConfiguracion(vm: ConfiguracionViewModel, filas: Filas, base: Filas, lado: androidx.compose.ui.unit.Dp) {
    val c = Neltume.colores
    val avisos = LocalAvisos.current
    val alcance = rememberCoroutineScope()
    val desplazamiento = rememberScrollState()
    val posiciones = remember { mutableStateMapOf<Grupo, Int>() }
    val errores = remember(filas) { validar(filas) }
    val borrador = remember(filas) { configuracionDe(filas) }
    val editable = vm.puedeEditar && !vm.ocupado

    // Un vacío se marca al intentar guardar; un choque, apenas aparece.
    fun visible(grupo: Grupo, i: Int): ErrorFila? = errores[grupo]?.get(i)?.takeIf { vm.intentado || !it.vacia }
    fun errorEn(grupo: Grupo, i: Int, campo: CampoConfig): String? = visible(grupo, i)?.takeIf { it.campo == campo }?.texto
    fun cuenta(grupo: Grupo) = errores[grupo].orEmpty().keys.count { visible(grupo, it) != null }
    fun irA(grupo: Grupo) {
        posiciones[grupo]?.let { y -> alcance.launch { desplazamiento.animateScrollTo(y) } }
    }

    /** Una fila nueva y vacía se quita sin más; una con datos se puede recuperar unos segundos. */
    fun <T> quitar(grupo: Grupo, i: Int, fila: T, conDatos: Boolean, nombre: String, lista: (Filas) -> List<T>, con: (Filas, List<T>) -> Filas) {
        vm.cambiar { f -> con(f, lista(f).filterIndexed { j, _ -> j != i }) }
        if (!conDatos) return
        avisos.mostrar("Se quitó $nombre. Se aplica al guardar.", accion = "Deshacer") {
            vm.cambiar { f ->
                val nueva = lista(f).toMutableList()
                nueva.add(minOf(i, nueva.size), fila)
                con(f, nueva)
            }
        }
    }

    fun guardar() {
        val ok = vm.guardar { avisos.mostrar("Nombres y alias guardados.") }
        if (!ok) Grupo.entries.firstOrNull { cuenta(it) > 0 || errores[it].orEmpty().isNotEmpty() }?.let(::irA)
    }

    Column(Modifier.fillMaxSize()) {
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(desplazamiento).padding(horizontal = lado).padding(top = 8.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Introduccion(
                "Los clientes no siempre escriben igual que el catálogo: dicen «pino» por Pino Oregon o «willow» por Huilo " +
                    "Huilo. Aquí se le enseña al asistente esas otras formas de decirlo. Los cambios se aplican a las " +
                    "cotizaciones nuevas.",
            )
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Grupo.entries.forEach { g ->
                    val n = cuenta(g)
                    ChipFiltro(g.titulo + if (n > 0) " ($n por corregir)" else "", false, { irA(g) })
                }
            }
            ProbarReconocimiento(borrador, filas.modelos.map { it.modelo })

            // --- Maderas -------------------------------------------------------------------------------------
            Hoja(Modifier.fillMaxWidth().onGloballyPositioned { posiciones[Grupo.MADERAS] = it.positionInParent().y.toInt() }) {
                TituloSeccion(Grupo.MADERAS.titulo)
                Spacer(Modifier.height(6.dp))
                Introduccion(
                    "En «El cliente también puede escribir» van otras palabras con que un cliente nombra la madera: " +
                        "abreviaciones, otros nombres o errores comunes. No hace falta repetirlas con tildes o en minúsculas. El " +
                        "código es la letra con que se arman los códigos de producto que reconoce la fábrica: no lo cambies en " +
                        "una madera que ya tiene productos.",
                )
                Spacer(Modifier.height(12.dp))
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    filas.maderas.forEachIndexed { i, madera ->
                        val nombre = madera.nombre.trim().ifEmpty { "nueva" }
                        Bandeja(Modifier.fillMaxWidth()) {
                            CabeceraFila("Fila ${i + 1}", "Quitar madera $nombre", editable) {
                                quitar(Grupo.MADERAS, i, madera, madera.nombre.isNotBlank() || madera.codigo.isNotBlank() || madera.alias.isNotEmpty(), "la madera $nombre", Filas::maderas) { f, l -> f.copy(maderas = l) }
                            }
                            Campo(
                                madera.nombre,
                                { v -> vm.cambiar { f -> f.copy(maderas = f.maderas.mapIndexed { j, m -> if (j == i) m.copy(nombre = v) else m }) } },
                                "Nombre",
                                error = errorEn(Grupo.MADERAS, i, CampoConfig.NOMBRE),
                                habilitado = editable,
                                mayusculas = KeyboardCapitalization.Characters,
                                largoMaximo = 80,
                            )
                            Spacer(Modifier.height(8.dp))
                            Campo(
                                madera.codigo,
                                { v -> vm.cambiar { f -> f.copy(maderas = f.maderas.mapIndexed { j, m -> if (j == i) m.copy(codigo = v) else m }) } },
                                "Código",
                                error = errorEn(Grupo.MADERAS, i, CampoConfig.CODIGO),
                                habilitado = editable,
                                mayusculas = KeyboardCapitalization.Characters,
                                largoMaximo = 10,
                            )
                            // Cambiar el código re-codifica todos los productos de esa madera al importar.
                            if (base.maderas.any { normalizarCatalogo(it.nombre) == normalizarCatalogo(madera.nombre) && it.codigo.isNotEmpty() && it.codigo != madera.codigo }) {
                                Spacer(Modifier.height(6.dp))
                                Aviso(
                                    "Al importar la planilla, todos los productos de ${madera.nombre.trim().ifEmpty { "esta madera" }} cambiarán de código y la fábrica no reconocerá los anteriores.",
                                    Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                                    TonoAviso.ATENCION,
                                )
                            }
                            Spacer(Modifier.height(10.dp))
                            CampoPalabras(
                                rotulo = "El cliente también puede escribir",
                                etiqueta = "Otras formas de escribir ${madera.nombre.trim().ifEmpty { "la madera nueva" }}",
                                valores = madera.alias,
                                nombre = madera.nombre,
                                cambiar = { a -> vm.cambiar { f -> f.copy(maderas = f.maderas.mapIndexed { j, m -> if (j == i) m.copy(alias = a) else m }) } },
                                error = errorEn(Grupo.MADERAS, i, CampoConfig.ALIAS),
                                habilitado = editable,
                            )
                        }
                    }
                }
                Spacer(Modifier.height(10.dp))
                BotonSecundario("Agregar madera", { vm.cambiar { f -> f.copy(maderas = f.maderas + MaderaEdit()) } }, icono = Iconos.Mas, habilitado = editable)
            }

            // --- Modelos -------------------------------------------------------------------------------------
            Hoja(Modifier.fillMaxWidth().onGloballyPositioned { posiciones[Grupo.MODELOS] = it.positionInParent().y.toInt() }) {
                TituloSeccion(Grupo.MODELOS.titulo)
                Spacer(Modifier.height(6.dp))
                Introduccion(
                    "**Se cambia solo:** el asistente lo reemplaza por el modelo sin preguntar («willow» → Huilo Huilo). " +
                        "**Podría ser:** palabras que a veces son el modelo y a veces no; el ítem queda pendiente hasta que " +
                        "alguien confirme («pillo» → ¿Huilo Huilo?).",
                )
                Spacer(Modifier.height(12.dp))
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    filas.modelos.forEachIndexed { i, fila ->
                        val nombre = fila.modelo.trim().ifEmpty { "el modelo nuevo" }
                        Bandeja(Modifier.fillMaxWidth()) {
                            CabeceraFila("Fila ${i + 1}", "Quitar palabras de $nombre", editable) {
                                quitar(Grupo.MODELOS, i, fila, fila.modelo.isNotBlank() || fila.alias.isNotEmpty() || fila.posibles.isNotEmpty(), "las palabras de $nombre", Filas::modelos) { f, l -> f.copy(modelos = l) }
                            }
                            Campo(
                                fila.modelo,
                                { v -> vm.cambiar { f -> f.copy(modelos = f.modelos.mapIndexed { j, m -> if (j == i) m.copy(modelo = v) else m }) } },
                                "Modelo",
                                error = errorEn(Grupo.MODELOS, i, CampoConfig.MODELO),
                                habilitado = editable,
                                mayusculas = KeyboardCapitalization.Characters,
                                largoMaximo = 80,
                            )
                            Spacer(Modifier.height(10.dp))
                            CampoPalabras(
                                rotulo = "Se cambia solo",
                                etiqueta = "Se cambia solo por $nombre",
                                valores = fila.alias,
                                nombre = fila.modelo,
                                cambiar = { a -> vm.cambiar { f -> f.copy(modelos = f.modelos.mapIndexed { j, m -> if (j == i) m.copy(alias = a) else m }) } },
                                error = errorEn(Grupo.MODELOS, i, CampoConfig.ALIAS),
                                habilitado = editable,
                            )
                            Spacer(Modifier.height(10.dp))
                            CampoPalabras(
                                rotulo = "Podría ser (pregunta)",
                                etiqueta = "Podría ser $nombre (pregunta)",
                                valores = fila.posibles,
                                nombre = fila.modelo,
                                dudosa = true,
                                cambiar = { a -> vm.cambiar { f -> f.copy(modelos = f.modelos.mapIndexed { j, m -> if (j == i) m.copy(posibles = a) else m }) } },
                                error = errorEn(Grupo.MODELOS, i, CampoConfig.POSIBLES),
                                habilitado = editable,
                            )
                        }
                    }
                }
                Spacer(Modifier.height(10.dp))
                BotonSecundario("Agregar modelo", { vm.cambiar { f -> f.copy(modelos = f.modelos + ModeloEdit()) } }, icono = Iconos.Mas, habilitado = editable)
            }

            // --- Tipo de producto al importar ----------------------------------------------------------------
            Hoja(Modifier.fillMaxWidth().onGloballyPositioned { posiciones[Grupo.FAMILIAS] = it.positionInParent().y.toInt() }) {
                TituloSeccion(Grupo.FAMILIAS.titulo)
                Spacer(Modifier.height(6.dp))
                Introduccion(
                    "Qué tipo de producto es cada modelo que llega en la planilla principal. **Se aplica la próxima vez que " +
                        "importes la planilla**: no cambia los productos que ya están en el catálogo ni los agregados a mano. Un " +
                        "modelo que no está en esta lista se importa como puerta.",
                )
                Spacer(Modifier.height(12.dp))
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    filas.familias.forEachIndexed { i, fila ->
                        val nombre = fila.modelo.trim()
                        Bandeja(Modifier.fillMaxWidth()) {
                            CabeceraFila("Fila ${i + 1}", "Quitar familia de ${nombre.ifEmpty { "modelo nuevo" }}", editable) {
                                quitar(Grupo.FAMILIAS, i, fila, true, "la familia de ${nombre.ifEmpty { "un modelo" }}", Filas::familias) { f, l -> f.copy(familias = l) }
                            }
                            Campo(
                                fila.modelo,
                                { v -> vm.cambiar { f -> f.copy(familias = f.familias.mapIndexed { j, m -> if (j == i) m.copy(modelo = v) else m }) } },
                                "Modelo",
                                error = errorEn(Grupo.FAMILIAS, i, CampoConfig.MODELO),
                                habilitado = editable,
                                mayusculas = KeyboardCapitalization.Characters,
                                largoMaximo = 80,
                            )
                            Spacer(Modifier.height(8.dp))
                            SelectorFamilia(
                                fila.familia,
                                { v -> vm.cambiar { f -> f.copy(familias = f.familias.mapIndexed { j, m -> if (j == i) m.copy(familia = v) else m }) } },
                                habilitado = editable,
                            )
                        }
                    }
                }
                Spacer(Modifier.height(10.dp))
                BotonSecundario("Agregar modelo", { vm.cambiar { f -> f.copy(familias = f.familias + FamiliaEdit()) } }, icono = Iconos.Mas, habilitado = editable)
            }

            Desplegable("Avanzado · vista técnica para soporte") {
                Aviso(
                    "Muestra esta misma configuración en el formato que usa el sistema (JSON). Solo sirve para que quien da " +
                        "soporte revise un problema; aquí no se cambia nada.",
                    tono = TonoAviso.ATENCION,
                )
                Box(Modifier.fillMaxWidth().clip(Radios.md).background(c.panel).horizontalScroll(rememberScrollState()).padding(12.dp)) {
                    Text(
                        JsonLegible.encodeToString(JsonObject.serializer(), aJson(borrador)),
                        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace, fontSize = 12.sp, fontFeatureSettings = null),
                        color = c.tinta,
                        softWrap = false,
                    )
                }
            }
        }

        // Barra de guardado: siempre a la vista, como la barra fija de la web.
        if (!vm.puedeEditar) {
            Text(
                "Solo quien administra el cotizador puede cambiar esta configuración.",
                Modifier.fillMaxWidth().background(c.panel).padding(horizontal = lado, vertical = 14.dp),
                style = MaterialTheme.typography.bodyMedium,
                color = c.tintaSuave,
            )
        } else {
            val sucio = vm.sucio
            Column(
                Modifier.fillMaxWidth().background(if (sucio) c.ambarFondo else c.superficie).padding(horizontal = lado, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                val error = vm.error
                if (error != null) Aviso(
                    error,
                    Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
                    TonoAviso.PELIGRO,
                    accion = if (vm.conflicto) ({ BotonTexto("Recargar", vm::cargar, icono = Iconos.Recargar, peligro = true) }) else null,
                )
                else Text(
                    if (sucio) "Hay cambios sin guardar." else "Sin cambios pendientes.",
                    Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    style = MaterialTheme.typography.labelMedium,
                    color = if (sucio) c.ambarTexto else c.apagado,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    BotonSecundario("Descartar cambios", vm::descartar, Modifier.weight(1f), habilitado = !vm.ocupado && sucio)
                    BotonPrincipal(
                        if (vm.ocupado) "Guardando…" else "Guardar configuración",
                        ::guardar,
                        Modifier.weight(1f),
                        habilitado = sucio,
                        cargando = vm.ocupado,
                    )
                }
            }
        }
    }
}

/** «Fila N» con el botón para quitarla (los errores nombran las filas por su número). */
@Composable
private fun CabeceraFila(texto: String, descripcionQuitar: String, habilitado: Boolean, quitar: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Rotulo(texto, Modifier.weight(1f))
        BotonIcono(Iconos.Basura, descripcionQuitar, quitar, habilitado = habilitado)
    }
}

/** Prueba lo que el asistente reconocería con el borrador actual, antes de guardar. */
@Composable
private fun ProbarReconocimiento(config: ConfiguracionCatalogo, modelos: List<String>) {
    val c = Neltume.colores
    var texto by rememberSaveable { mutableStateOf("") }
    val resultado = remember(texto, config, modelos) { probarReconocimiento(texto, config, modelos) }
    Hoja(Modifier.fillMaxWidth(), color = c.panel) {
        Campo(
            texto,
            { texto = it },
            "Probar: escribe una madera o modelo como lo diría un cliente",
            ayuda = "Ej.: raulí, willow",
            icono = Iconos.Buscar,
            accionIme = ImeAction.Done,
            mayusculas = KeyboardCapitalization.None,
            largoMaximo = 80,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            resultado,
            Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            style = MaterialTheme.typography.bodyMedium,
            color = if (normalizarCatalogo(texto).isEmpty()) c.apagado else c.tinta,
        )
    }
}

/**
 * Lista de palabras como etiquetas: cada una se ve entera y se quita con su ×. El botón +, «Listo» en el teclado,
 * una coma o salir del campo la agregan; pegar una lista separada por comas agrega todas. La clave tolerante reconoce los
 * nombres aunque no tengan alias: esas variantes no se repiten, y lo que sobra se explica con un botón para quitarlo.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CampoPalabras(
    rotulo: String,
    etiqueta: String,
    valores: List<String>,
    nombre: String,
    cambiar: (List<String>) -> Unit,
    dudosa: Boolean = false,
    error: String? = null,
    habilitado: Boolean = true,
) {
    val c = Neltume.colores
    var texto by remember { mutableStateOf("") }
    var aviso by remember { mutableStateOf("") }
    var enfocado by remember { mutableStateOf(false) }
    val foco = remember { FocusRequester() }
    val claveNombre = claveTolerante(nombre)
    // En «Podría ser» una variante del nombre no sobra: anotarla ahí hace que el asistente pregunte.
    fun igualAlNombre(v: String) =
        if (dudosa) normalizarCatalogo(nombre).isNotEmpty() && normalizarCatalogo(v) == normalizarCatalogo(nombre) else claveTolerante(v) == claveNombre
    fun sobra(v: String, i: Int): Boolean {
        val clave = claveTolerante(v)
        return clave.isNotEmpty() && (igualAlNombre(v) || valores.take(i).any { claveTolerante(it) == clave })
    }
    val sobrantes = valores.filterIndexed { i, v -> sobra(v, i) }

    fun agregar(crudo: String) {
        val nuevos = valores.toMutableList()
        val repetidos = mutableListOf<String>()
        for (parte in crudo.split(',').map { it.trim() }.filter { it.isNotEmpty() }) {
            val clave = claveTolerante(parte)
            if (clave.isEmpty() || igualAlNombre(parte) || nuevos.any { claveTolerante(it) == clave }) repetidos += parte
            else nuevos += parte.uppercase(ES_CL)
        }
        if (nuevos.size != valores.size) cambiar(nuevos)
        aviso = if (repetidos.isNotEmpty())
            "No hace falta agregar ${repetidos.joinToString(", ") { "«$it»" }}: el asistente ya lo reconoce (no distingue tildes, mayúsculas ni letras repetidas)."
        else ""
        texto = ""
    }

    Column(Modifier.fillMaxWidth()) {
        Rotulo(rotulo, color = if (error != null) c.peligro else c.apagado)
        Spacer(Modifier.height(6.dp))
        FlowRow(
            Modifier
                .fillMaxWidth()
                .clip(Radios.md)
                .background(if (habilitado) c.superficie else c.panel)
                .border(if (enfocado) 2.dp else 1.dp, if (error != null) c.peligro else if (enfocado) c.verde else c.lineaMedia, Radios.md)
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, enabled = habilitado) { foco.requestFocus() }
                .padding(6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            valores.forEachIndexed { i, valor ->
                Row(
                    Modifier.height(40.dp).clip(Radios.pildora).background(c.tonal).border(1.dp, c.linea, Radios.pildora).padding(start = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(valor, style = MaterialTheme.typography.labelMedium, color = c.tinta)
                    Box(
                        Modifier
                            .size(40.dp)
                            .clip(CircleShape)
                            .clickable(enabled = habilitado) { cambiar(valores.filterIndexed { j, _ -> j != i }) }
                            .semantics {
                                contentDescription = "Quitar «$valor»"
                                role = Role.Button
                            },
                        contentAlignment = Alignment.Center,
                    ) { Icon(Iconos.Cerrar, null, tint = c.tintaSuave, modifier = Modifier.size(16.dp)) }
                }
            }
            BasicTextField(
                texto,
                { nuevo ->
                    if (',' in nuevo) agregar(nuevo)
                    else {
                        texto = nuevo.take(80)
                        aviso = ""
                    }
                },
                Modifier
                    .weight(1f)
                    .widthIn(min = 140.dp)
                    .heightIn(min = 40.dp)
                    .focusRequester(foco)
                    .onFocusChanged {
                        enfocado = it.isFocused
                        if (!it.isFocused && texto.isNotBlank()) agregar(texto)
                    }
                    .semantics { contentDescription = etiqueta },
                enabled = habilitado,
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyMedium.copy(color = c.tinta),
                cursorBrush = SolidColor(c.verde),
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Characters,
                    autoCorrectEnabled = false,
                    imeAction = ImeAction.Done,
                ),
                keyboardActions = KeyboardActions(onDone = { if (texto.isNotBlank()) agregar(texto) }),
                decorationBox = { campo ->
                    Row(Modifier.fillMaxWidth().padding(start = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                            if (texto.isEmpty()) Text(
                                if (valores.isNotEmpty()) "+ otra" else "Escribe una palabra",
                                style = MaterialTheme.typography.bodyMedium,
                                color = c.apagado,
                            )
                            campo()
                        }
                        if (texto.isNotBlank()) BotonIcono(Iconos.Mas, "Agregar «${texto.trim()}»", { agregar(texto) }, tono = c.verde)
                    }
                },
            )
        }
        if (error != null) Text(error, Modifier.padding(top = 4.dp), style = MaterialTheme.typography.bodySmall, color = c.peligro)
        if (sobrantes.isNotEmpty()) {
            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "${sobrantes.joinToString(", ") { "«$it»" }} no hace falta: el asistente ya lo reconoce por el nombre o por otra palabra (no distingue tildes, mayúsculas ni letras repetidas).",
                    Modifier.weight(1f),
                    style = MaterialTheme.typography.bodySmall,
                    color = c.ambarTexto,
                )
                BotonTexto("Quitar", { cambiar(valores.filterIndexed { i, v -> !sobra(v, i) }) }, habilitado = habilitado)
            }
        }
        if (aviso.isNotEmpty()) Text(
            aviso,
            Modifier.padding(top = 4.dp).semantics { liveRegion = LiveRegionMode.Polite },
            style = MaterialTheme.typography.bodySmall,
            color = c.ambarTexto,
        )
    }
}
