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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cl.puertasneltume.cotizador.Contenedor
import cl.puertasneltume.cotizador.comun.LocalAvisos
import cl.puertasneltume.cotizador.comun.LocalContenedor
import cl.puertasneltume.cotizador.comun.LocalNavegador
import cl.puertasneltume.cotizador.comun.MarcoPantalla
import cl.puertasneltume.cotizador.comun.vm
import cl.puertasneltume.cotizador.cotizar.DialogoConfirmacion
import cl.puertasneltume.cotizador.diseno.Aviso
import cl.puertasneltume.cotizador.diseno.BotonIcono
import cl.puertasneltume.cotizador.diseno.BotonPrincipal
import cl.puertasneltume.cotizador.diseno.BotonSecundario
import cl.puertasneltume.cotizador.diseno.BotonTexto
import cl.puertasneltume.cotizador.diseno.Campo
import cl.puertasneltume.cotizador.diseno.EstadoVacio
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.MuestraMadera
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Pildora
import cl.puertasneltume.cotizador.diseno.Rotulo
import cl.puertasneltume.cotizador.diseno.Tarjeta
import cl.puertasneltume.cotizador.diseno.TituloSeccion
import cl.puertasneltume.cotizador.diseno.TonoAviso
import cl.puertasneltume.cotizador.navegacion.Ruta
import cl.puertasneltume.cotizador.nucleo.api.FalloApi
import cl.puertasneltume.cotizador.nucleo.reglas.CampoMedida
import cl.puertasneltume.cotizador.nucleo.reglas.Fechas
import cl.puertasneltume.cotizador.nucleo.reglas.Limites
import cl.puertasneltume.cotizador.nucleo.reglas.decimalCampo
import cl.puertasneltume.cotizador.nucleo.reglas.leerMedida
import cl.puertasneltume.cotizador.nucleo.reglas.leerPesos
import cl.puertasneltume.cotizador.nucleo.reglas.medidaProducto
import cl.puertasneltume.cotizador.nucleo.reglas.nombreProducto
import cl.puertasneltume.cotizador.nucleo.reglas.pesos
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// Gestionar productos del catálogo (src/app/gestion-manuales.tsx): corregir productos agregados a mano o
// importados, eliminar los agregados a mano y restaurarlos desde «Productos eliminados».

/** Producto administrable o eliminado: el producto del catálogo con su origen y fechas. */
@Serializable
internal data class ProductoGestion(
    val codigo: String,
    val modelo: String = "",
    val familia: String = "PUERTA",
    val tipo: String? = null,
    val madera: String = "",
    val medida: String = "",
    val anchoMin: Double? = null,
    val anchoMax: Double? = null,
    val altoMin: Double? = null,
    val altoMax: Double? = null,
    val largo: Double = 0.0,
    val precioNeto: Double = 0.0,
    val descripcion: String = "",
    val fuente: String? = null,
    val creada: String? = null,
    val creadaPor: String? = null,
    val eliminada: String? = null,
    /** Otro producto ocupa hoy el código: restaurarlo fallaría. */
    val codigoOcupado: Boolean = false,
) {
    val manual: Boolean get() = fuente == "manual"
    val medidaTexto: String get() = medidaProducto(familia, medida, largo, anchoMin, anchoMax, altoMin, altoMax)
}

@Serializable
private data class ListaProductos(val productos: List<ProductoGestion> = emptyList(), val total: Int = 0)

@Serializable
private data class ProductoEditado(val producto: ProductoGestion)

internal enum class CampoGestion { MODELO, FAMILIA, MADERA, TIPO, MEDIDA, ANCHO_MIN, ANCHO_MAX, ALTO_MIN, ALTO_MAX, LARGO, PRECIO, DESCRIPCION }

/** Campos del editor tal como se escriben (decimales con coma). */
internal fun camposDe(p: ProductoGestion): Map<CampoGestion, String> = mapOf(
    CampoGestion.MODELO to p.modelo,
    CampoGestion.FAMILIA to p.familia,
    CampoGestion.MADERA to p.madera,
    CampoGestion.TIPO to (p.tipo ?: ""),
    CampoGestion.MEDIDA to p.medida,
    CampoGestion.ANCHO_MIN to (p.anchoMin?.let(::decimalCampo) ?: ""),
    CampoGestion.ANCHO_MAX to (p.anchoMax?.let(::decimalCampo) ?: ""),
    CampoGestion.ALTO_MIN to (p.altoMin?.let(::decimalCampo) ?: ""),
    CampoGestion.ALTO_MAX to (p.altoMax?.let(::decimalCampo) ?: ""),
    CampoGestion.LARGO to decimalCampo(p.largo),
    // La planilla trae precios con decimales: se editan redondeados y solo se envían si cambian.
    CampoGestion.PRECIO to decimalCampo(Math.round(p.precioNeto).toDouble()),
    CampoGestion.DESCRIPCION to p.descripcion,
)

internal class CambiosProducto(val cambios: JsonObject, val errores: Map<CampoGestion, String>)

/** Solo lo que cambió; un error por campo si algo no se puede guardar (`cambiosDe`). */
internal fun cambiosDe(p: ProductoGestion, c: Map<CampoGestion, String>): CambiosProducto {
    val errores = LinkedHashMap<CampoGestion, String>()
    val cambios = LinkedHashMap<String, JsonElement>()
    fun v(campo: CampoGestion) = c.getValue(campo)
    for ((campo, clave, original) in listOf(
        Triple(CampoGestion.MODELO, "modelo", p.modelo),
        Triple(CampoGestion.MADERA, "madera", p.madera),
        Triple(CampoGestion.MEDIDA, "medida", p.medida),
        Triple(CampoGestion.DESCRIPCION, "descripcion", p.descripcion),
    )) {
        val valor = v(campo).trim()
        if (valor.isEmpty()) errores[campo] = "Este dato es obligatorio."
        else if (valor != original) cambios[clave] = JsonPrimitive(valor)
    }
    val familia = v(CampoGestion.FAMILIA)
    if (familia != p.familia) cambios["familia"] = JsonPrimitive(familia)
    val tipo = v(CampoGestion.TIPO).trim().ifEmpty { null }
    if (tipo != p.tipo) cambios["tipo"] = JsonPrimitive(tipo)
    // Las medidas se leen como en el detalle y el chat; solo se revisan si cambian (el largo, también si cambia la
    // familia): un producto de la planilla fuera de rango se puede seguir corrigiendo en lo demás.
    val originales = camposDe(p)
    for ((campo, clave, actual) in listOf(
        Triple(CampoGestion.ANCHO_MIN, "anchoMin", p.anchoMin),
        Triple(CampoGestion.ANCHO_MAX, "anchoMax", p.anchoMax),
    )) {
        val texto = v(campo).trim()
        if (texto == originales[campo]) continue
        val valor = if (texto.isNotEmpty()) leerMedida(texto, "PUERTA", CampoMedida.ANCHO) else null
        if (texto.isNotEmpty() && valor == null) errores[campo] = Limites.errorMedida(CampoMedida.ANCHO, "PUERTA")
        else if (valor != actual) cambios[clave] = JsonPrimitive(valor)
    }
    for ((campo, clave, actual) in listOf(
        Triple(CampoGestion.ALTO_MIN, "altoMin", p.altoMin),
        Triple(CampoGestion.ALTO_MAX, "altoMax", p.altoMax),
    )) {
        val texto = v(campo).trim()
        if (texto == originales[campo]) continue
        val valor = if (texto.isNotEmpty()) leerMedida(texto, familia, CampoMedida.ALTO) else null
        if (texto.isNotEmpty() && valor == null) errores[campo] = Limites.errorMedida(CampoMedida.ALTO, familia)
        else if (valor != actual) cambios[clave] = JsonPrimitive(valor)
    }
    val conAltoMin = v(CampoGestion.ALTO_MIN).isNotBlank()
    val conAltoMax = v(CampoGestion.ALTO_MAX).isNotBlank()
    if (conAltoMin != conAltoMax) errores[CampoGestion.ALTO_MAX] = "Escribe el alto mínimo y el máximo, o deja ambos vacíos."
    val largoCambio = v(CampoGestion.LARGO).trim() != originales[CampoGestion.LARGO]
    if ((conAltoMin || conAltoMax) && largoCambio)
        errores[CampoGestion.LARGO] = "Con un rango de alto, el alto de referencia se toma del alto máximo."
    else if (largoCambio || familia != p.familia) {
        val largo = leerMedida(v(CampoGestion.LARGO), familia)
        if (largo == null) errores[CampoGestion.LARGO] = Limites.errorMedida(CampoMedida.ALTO, familia)
        else if (largo != p.largo) cambios["largo"] = JsonPrimitive(largo)
    }
    val precio = leerPesos(v(CampoGestion.PRECIO))
    if (!precio.isFinite() || precio <= 0) errores[CampoGestion.PRECIO] = "Escribe el precio en pesos, como 145.000."
    else if (precio != Math.round(p.precioNeto).toDouble()) cambios["precioNeto"] = JsonPrimitive(precio)
    return CambiosProducto(JsonObject(cambios), errores)
}

internal class GestionViewModel(private val c: Contenedor) : ViewModel() {
    var busqueda by mutableStateOf("")
        private set
    var productos by mutableStateOf<List<ProductoGestion>?>(null)
        private set
    var total by mutableIntStateOf(0)
        private set
    var cargando by mutableStateOf(true)
        private set
    var error by mutableStateOf<String?>(null)
        private set

    /** Código del producto que se está eliminando o restaurando. */
    var ocupado by mutableStateOf<String?>(null)
        private set
    var eliminados by mutableStateOf<List<ProductoGestion>?>(null)
        private set
    var errorEliminados by mutableStateOf<String?>(null)
        private set
    private var tarea: Job? = null

    val termino: String get() = busqueda.trim()

    init {
        listar(0)
        listarEliminados()
    }

    fun buscar(texto: String) {
        busqueda = texto.take(120)
        listar()
    }

    /** Mismo ritmo que Consultar. Sin término se listan los agregados a mano, que son los que más se corrigen. */
    fun listar(espera: Long = 250) {
        tarea?.cancel()
        tarea = viewModelScope.launch {
            if (espera > 0) delay(espera)
            cargando = true
            val t = termino
            try {
                val d = c.pedirCatalogo(ListaProductos.serializer(), buildJsonObject {
                    put("tipo", "listar_productos")
                    if (t.isNotEmpty()) put("q", t)
                })
                if (t.isEmpty()) {
                    val manuales = d.productos.filter { it.manual }
                    productos = manuales
                    total = manuales.size
                } else {
                    productos = d.productos
                    total = d.total
                }
                error = null
            } catch (e: FalloApi) {
                error = e.message
            }
            cargando = false
        }
    }

    fun listarEliminados() {
        viewModelScope.launch {
            try {
                eliminados = c.pedirCatalogo(ListaProductos.serializer(), buildJsonObject { put("tipo", "listar_eliminados") }).productos
                errorEliminados = null
            } catch (e: FalloApi) {
                errorEliminados = e.message
            }
        }
    }

    fun eliminar(p: ProductoGestion, alListo: () -> Unit) {
        if (ocupado != null) return
        ocupado = p.codigo
        error = null
        viewModelScope.launch {
            try {
                c.pedirCatalogo(JsonObject.serializer(), buildJsonObject {
                    put("tipo", "eliminar")
                    put("codigo", p.codigo)
                })
                productos = productos?.filter { it.codigo != p.codigo }
                total -= 1
                alListo()
                listarEliminados()
            } catch (e: FalloApi) {
                error = e.message
            } finally {
                ocupado = null
            }
        }
    }

    fun restaurar(p: ProductoGestion, alListo: () -> Unit) {
        if (ocupado != null) return
        ocupado = p.codigo
        errorEliminados = null
        viewModelScope.launch {
            try {
                c.pedirCatalogo(JsonObject.serializer(), buildJsonObject {
                    put("tipo", "restaurar")
                    put("codigo", p.codigo)
                })
                alListo()
                eliminados = eliminados?.filter { it.codigo != p.codigo }
                // La lista de arriba lo vuelve a mostrar (sin búsqueda, lista los agregados a mano).
                listar(0)
                listarEliminados()
            } catch (e: FalloApi) {
                errorEliminados = e.message
            } finally {
                ocupado = null
            }
        }
    }

    fun actualizado(nuevo: ProductoGestion) {
        productos = productos?.map { if (it.codigo == nuevo.codigo) nuevo else it }
    }
}

@Composable
internal fun SeccionGestion(s: SeccionCatalogo, volver: () -> Unit) {
    val vm = vm { GestionViewModel(it) }
    val avisos = LocalAvisos.current
    val navegador = LocalNavegador.current
    var editando by remember { mutableStateOf<ProductoGestion?>(null) }
    var eliminar by remember { mutableStateOf<ProductoGestion?>(null) }
    MarcoPantalla(s.titulo, alVolver = volver, subtitulo = "Catálogo") {
        ConMargenLateral { lado ->
            val productos = vm.productos
            val error = vm.error
            val eliminados = vm.eliminados.orEmpty()
            LazyColumn(Modifier.fillMaxSize(), contentPadding = relleno(lado), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item(key = "intro") {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Introduccion(
                            "Corrige los datos de productos agregados a mano o importados. Los cambios en productos de la " +
                                "planilla se reemplazan la próxima vez que la importes.",
                        )
                        Campo(
                            vm.busqueda,
                            vm::buscar,
                            "Buscar por código, modelo, madera o medida",
                            ayuda = "Ej.: MOL-O-3-A o Molco 0,80",
                            icono = Iconos.Buscar,
                            accionIme = ImeAction.Search,
                            mayusculas = KeyboardCapitalization.None,
                            largoMaximo = 120,
                            final = if (vm.busqueda.isNotEmpty()) ({ BotonIcono(Iconos.Cerrar, "Borrar búsqueda", { vm.buscar("") }) }) else null,
                        )
                    }
                }
                when {
                    error != null -> item(key = "error") { ErrorReintento(error, { vm.listar(0) }) }
                    productos == null -> item(key = "cargando") { Cargando("Cargando productos…") }
                    productos.isEmpty() -> item(key = "vacio") {
                        if (vm.termino.isNotEmpty()) EstadoVacio(Iconos.Buscar, "Sin resultados", "No se encontraron productos.")
                        else EstadoVacio(
                            Iconos.Paquete,
                            "Sin productos agregados a mano",
                            "Aún no hay productos agregados a mano. Busca un código, modelo, madera o medida para corregir uno de la planilla, o agrega un producto.",
                        ) { BotonSecundario("Agregar producto", { navegador.empujar(Ruta.CatalogoSeccion("agregar")) }, icono = Iconos.Mas) }
                    }
                    else -> {
                        item(key = "conteo") {
                            val n = productos.size
                            Text(
                                when {
                                    vm.termino.isEmpty() -> "$n producto${if (n == 1) "" else "s"} agregado${if (n == 1) "" else "s"} a mano. Busca para corregir uno de la planilla."
                                    vm.total > n -> "Mostrando $n de ${vm.total} productos: afina la búsqueda para ver el resto."
                                    else -> "${vm.total} producto${if (vm.total == 1) "" else "s"}."
                                },
                                Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                                style = MaterialTheme.typography.bodySmall,
                                color = Neltume.colores.apagado,
                            )
                        }
                        items(productos, key = { "g-${it.codigo}" }) { p ->
                            FilaGestion(p, habilitado = vm.ocupado == null, editar = { editando = p }, eliminar = { eliminar = p })
                        }
                    }
                }
                if (eliminados.isNotEmpty() || vm.errorEliminados != null) item(key = "eliminados") {
                    Column(Modifier.padding(top = 12.dp)) {
                        Desplegable("Productos eliminados${vm.eliminados?.let { " (${it.size})" } ?: ""}") {
                            Apagado("Productos agregados a mano que se eliminaron. Al restaurarlos vuelven tal como estaban, con quién los agregó y cuándo.")
                            vm.errorEliminados?.let { ErrorReintento(it, vm::listarEliminados) }
                            eliminados.forEach { p ->
                                FilaEliminado(p, vm.ocupado) {
                                    vm.restaurar(p) { avisos.mostrar("Producto ${p.codigo} restaurado en el catálogo.") }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    editando?.let { p ->
        EditorProducto(p, cerrar = { editando = null }) { nuevo ->
            vm.actualizado(nuevo)
            avisos.mostrar("Cambios guardados en ${nuevo.codigo}.")
        }
    }
    eliminar?.let { p ->
        DialogoConfirmacion(
            "Eliminar producto",
            "¿Eliminar «${nombreProducto(p.descripcion)}» (${p.codigo}) del catálogo? Los borradores que lo usaban quedarán con el ítem pendiente.",
            "Eliminar producto",
            peligro = true,
        ) { ok ->
            eliminar = null
            if (ok) vm.eliminar(p) {
                avisos.mostrar("Producto ${p.codigo} eliminado del catálogo. Puedes restaurarlo en «Productos eliminados».", largo = true)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FilaGestion(p: ProductoGestion, habilitado: Boolean, editar: () -> Unit, eliminar: () -> Unit) {
    val c = Neltume.colores
    Tarjeta(null) {
        Row(verticalAlignment = Alignment.Top) {
            MuestraMadera(p.madera, Modifier.padding(top = 4.dp))
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(nombreProducto(p.descripcion), style = MaterialTheme.typography.titleSmall, color = c.tinta)
                Text(p.medidaTexto, style = MaterialTheme.typography.bodySmall, color = c.tintaSuave)
                Spacer(Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(p.codigo, style = MaterialTheme.typography.labelSmall, color = c.apagado)
                    Spacer(Modifier.width(8.dp))
                    Pildora(if (p.manual) "Agregado a mano" else "Planilla", if (p.manual) c.verdeVelo else c.tonal, if (p.manual) c.verde else c.tintaSuave)
                }
            }
            Spacer(Modifier.width(8.dp))
            Column(horizontalAlignment = Alignment.End) {
                Text(pesos(p.precioNeto), style = MaterialTheme.typography.titleSmall, color = c.tinta)
                Text("costo sin IVA", style = MaterialTheme.typography.labelSmall, color = c.apagado)
            }
        }
        Spacer(Modifier.height(8.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            BotonSecundario("Editar", editar, icono = Iconos.Lapiz, habilitado = habilitado)
            if (p.manual) BotonTexto("Eliminar", eliminar, icono = Iconos.Basura, habilitado = habilitado, peligro = true)
        }
    }
}

@Composable
private fun FilaEliminado(p: ProductoGestion, ocupado: String?, restaurar: () -> Unit) {
    val c = Neltume.colores
    Tarjeta(null) {
        Text(nombreProducto(p.descripcion), style = MaterialTheme.typography.titleSmall, color = c.tinta)
        Text("${p.medidaTexto} · ${pesos(p.precioNeto)} costo sin IVA", style = MaterialTheme.typography.bodySmall, color = c.tintaSuave)
        Text(
            buildString {
                append(p.codigo)
                p.eliminada?.let { append(" · Eliminado el ${Fechas.corta(it)}") }
                p.creada?.let { append(" · Agregado el ${Fechas.corta(it)}") }
                p.creadaPor?.let { append(" por $it") }
            },
            style = MaterialTheme.typography.labelSmall,
            color = c.apagado,
        )
        if (p.codigoOcupado) {
            Spacer(Modifier.height(6.dp))
            Aviso("Otro producto usa hoy este código: no se puede restaurar.", tono = TonoAviso.ATENCION)
        }
        Spacer(Modifier.height(8.dp))
        BotonSecundario(
            if (ocupado == p.codigo) "Restaurando…" else "Restaurar",
            restaurar,
            icono = Iconos.Restaurar,
            habilitado = ocupado == null && !p.codigoOcupado,
            cargando = ocupado == p.codigo,
        )
    }
}

/** Editor de un producto en una hoja: la lista queda de solo lectura y cabe en cualquier ancho. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EditorProducto(producto: ProductoGestion, cerrar: () -> Unit, guardado: (ProductoGestion) -> Unit) {
    val c = Neltume.colores
    val contenedor = LocalContenedor.current
    val alcance = rememberCoroutineScope()
    var valores by remember(producto.codigo) { mutableStateOf(camposDe(producto)) }
    var errores by remember { mutableStateOf(mapOf<CampoGestion, String>()) }
    var error by remember { mutableStateOf<String?>(null) }
    var ocupado by remember { mutableStateOf(false) }
    val focos = remember { CampoGestion.entries.associateWith { FocusRequester() } }
    val familia = valores.getValue(CampoGestion.FAMILIA)
    val puerta = familia == "PUERTA"
    val tieneRango = valores.getValue(CampoGestion.ALTO_MIN).isNotBlank() || valores.getValue(CampoGestion.ALTO_MAX).isNotBlank()

    fun guardar() {
        if (ocupado) return
        val r = cambiosDe(producto, valores)
        errores = r.errores
        r.errores.keys.firstOrNull()?.let { primero ->
            if (primero != CampoGestion.FAMILIA) runCatching { focos.getValue(primero).requestFocus() }
            return
        }
        if (r.cambios.isEmpty()) return cerrar()
        ocupado = true
        error = null
        alcance.launch {
            try {
                val d = contenedor.pedirCatalogo(ProductoEditado.serializer(), buildJsonObject {
                    put("tipo", "editar")
                    put("codigo", producto.codigo)
                    put("cambios", r.cambios)
                })
                guardado(d.producto)
                cerrar()
            } catch (e: FalloApi) {
                error = e.message
                ocupado = false
            }
        }
    }

    @Composable
    fun campo(nombre: CampoGestion, etiqueta: String, ayuda: String? = null, numero: Boolean = false, lineas: Int = 1) = Campo(
        valores.getValue(nombre),
        { valor ->
            valores = valores + (nombre to valor)
            errores = errores - nombre
        },
        etiqueta,
        error = errores[nombre],
        ayuda = ayuda,
        teclado = if (numero) KeyboardType.Decimal else KeyboardType.Text,
        habilitado = !ocupado,
        lineas = lineas,
        mayusculas = KeyboardCapitalization.Sentences,
        foco = focos.getValue(nombre),
        prefijo = if (nombre == CampoGestion.PRECIO) "$" else null,
    )

    ModalBottomSheet({ if (!ocupado) cerrar() }, sheetState = rememberModalBottomSheetState(true), containerColor = c.superficie) {
        Column(
            Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).navigationBarsPadding().padding(bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Rotulo("EDITAR · ${producto.codigo}")
            TituloSeccion(nombreProducto(producto.descripcion))
            if (producto.fuente == "planilla")
                Aviso("Producto de la planilla: este cambio se reemplaza la próxima vez que importes la planilla.", tono = TonoAviso.ATENCION)
            SelectorFamilia(familia, { valores = valores + (CampoGestion.FAMILIA to it) }, habilitado = !ocupado)
            campo(CampoGestion.MODELO, "Modelo")
            campo(CampoGestion.MADERA, "Madera")
            campo(CampoGestion.TIPO, "Estilo (opcional)", ayuda = "Solo informativo. Si dice «prepintada» o «enchapada», cambia la ganancia.")
            if (puerta) campo(CampoGestion.MEDIDA, "Medida (texto)")
            else campo(CampoGestion.MEDIDA, "Medida o escuadría", ayuda = "Escuadría: grosor por ancho de la pieza.")
            if (puerta) {
                campo(CampoGestion.ANCHO_MIN, "Ancho mínimo", ayuda = "En metros (0,80), centímetros (80 cm) o milímetros (800 mm).", numero = true)
                campo(CampoGestion.ANCHO_MAX, "Ancho máximo", numero = true)
                campo(CampoGestion.ALTO_MIN, "Alto mínimo del rango", ayuda = "Opcional. Si lo usas, completa también el alto máximo.", numero = true)
                campo(CampoGestion.ALTO_MAX, "Alto máximo del rango", ayuda = "El alto de referencia del producto se toma de aquí.", numero = true)
            }
            if (!tieneRango) campo(
                CampoGestion.LARGO,
                if (puerta) "Alto" else "Largo",
                ayuda = "En metros (2,10), centímetros (210 cm) o milímetros (2100 mm), ${Limites.textoRangoMedida(CampoMedida.ALTO, familia)}.",
                numero = true,
            )
            campo(CampoGestion.PRECIO, "Costo de fábrica sin IVA", ayuda = "Costo de fábrica, sin la ganancia de venta.", numero = true)
            campo(CampoGestion.DESCRIPCION, "Descripción", ayuda = "Es el texto que aparece en la cotización y el PDF.", lineas = 2)
            error?.let { Aviso(it, tono = TonoAviso.PELIGRO) }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                BotonSecundario("Cancelar", cerrar, Modifier.weight(1f), habilitado = !ocupado)
                BotonPrincipal(if (ocupado) "Guardando…" else "Guardar cambios", ::guardar, Modifier.weight(1f), cargando = ocupado)
            }
        }
    }
}
