package cl.puertasneltume.cotizador.cotizar

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.runtime.Stable
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import cl.puertasneltume.cotizador.nucleo.reglas.plural
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import cl.puertasneltume.cotizador.comun.LocalContenedor
import cl.puertasneltume.cotizador.diseno.Aviso
import cl.puertasneltume.cotizador.diseno.BotonPrincipal
import cl.puertasneltume.cotizador.diseno.BotonSecundario
import cl.puertasneltume.cotizador.diseno.BotonTexto
import cl.puertasneltume.cotizador.diseno.Campo
import cl.puertasneltume.cotizador.diseno.CampoPesos
import cl.puertasneltume.cotizador.diseno.ChipFiltro
import cl.puertasneltume.cotizador.diseno.EstadoVacio
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.MuestraMadera
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Radios
import cl.puertasneltume.cotizador.diseno.Rotulo
import cl.puertasneltume.cotizador.diseno.TituloSeccion
import cl.puertasneltume.cotizador.diseno.TonoAviso
import cl.puertasneltume.cotizador.nucleo.api.FalloApi
import cl.puertasneltume.cotizador.nucleo.modelo.GrupoConsulta
import cl.puertasneltume.cotizador.nucleo.modelo.ProductoConsulta
import cl.puertasneltume.cotizador.nucleo.modelo.RespuestaConsulta
import cl.puertasneltume.cotizador.nucleo.modelo.TipoMedida
import cl.puertasneltume.cotizador.nucleo.reglas.CampoMedida
import cl.puertasneltume.cotizador.nucleo.reglas.Limites
import cl.puertasneltume.cotizador.nucleo.reglas.aPesos
import cl.puertasneltume.cotizador.nucleo.reglas.bonito
import cl.puertasneltume.cotizador.nucleo.reglas.decimalCampo
import cl.puertasneltume.cotizador.nucleo.reglas.leerMedida
import cl.puertasneltume.cotizador.nucleo.reglas.leerPesos
import cl.puertasneltume.cotizador.nucleo.reglas.medidaProducto
import cl.puertasneltume.cotizador.nucleo.reglas.nombreProducto
import cl.puertasneltume.cotizador.nucleo.reglas.pesos
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

val FAMILIAS = listOf(null to "Todo", "PUERTA" to "Puertas", "MARCO" to "Marcos", "MOLDURA" to "Molduras", "PIEZAS_T" to "Piezas T")

/**
 * Agregar producto sin usar la IA: busca en el catálogo, elige medidas y cantidad, y lo suma al pedido. «Agregar y
 * seguir» deja la búsqueda abierta. También crea un producto especial (fuera de catálogo) solo para esta cotización.
 */
/**
 * Lo que la hoja recuerda mientras está abierta, como la web: la búsqueda (para sumar otra medida del mismo modelo),
 * lo ya agregado con «Agregar y seguir» y la última elección de hoja o vano (en una obra suele repetirse).
 */
@Stable
private class EstadoBusqueda(textoInicial: String) {
    var texto by mutableStateOf(textoInicial)
    var familia by mutableStateOf<String?>(null)
    var grupo by mutableStateOf<GrupoConsulta?>(null)
    var tipo by mutableStateOf(TipoMedida.HOJA)
    var agregados by mutableStateOf(listOf<String>())
    /** El producto pedido desde el catálogo se abre una sola vez: al volver se ven los resultados. */
    var inicialAbierto by mutableStateOf(false)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgregarProducto(visible: Boolean, codigoInicial: String?, vm: CotizadorViewModel, alCerrar: () -> Unit) {
    if (!visible) return
    val c = Neltume.colores
    var elegido by remember { mutableStateOf<ProductoConsulta?>(null) }
    var especial by rememberSaveable { mutableStateOf(false) }
    val estado = remember { EstadoBusqueda(codigoInicial ?: "") }
    ModalBottomSheet(alCerrar, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = c.superficie) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(0.94f).imePadding().navigationBarsPadding()) {
            AnimatedContent(Triple(elegido, especial, Unit), transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "agregar") { (p, esp, _) ->
                when {
                    esp -> FormEspecial(vm, estado.texto.trim(), volver = { especial = false }, alCerrar = alCerrar)
                    p != null -> FormProducto(p, vm, estado, volver = { elegido = null }, alCerrar = alCerrar)
                    else -> Busqueda(codigoInicial, estado, elegir = { elegido = it }, especial = { especial = true }, alCerrar = alCerrar)
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Busqueda(codigoInicial: String?, estado: EstadoBusqueda, elegir: (ProductoConsulta) -> Unit, especial: () -> Unit, alCerrar: () -> Unit) {
    val c = Neltume.colores
    val api = LocalContenedor.current.api
    var texto by estado::texto
    var familia by estado::familia
    var grupo by estado::grupo
    var respuesta by remember { mutableStateOf<RespuestaConsulta?>(null) }
    var cargando by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(texto, familia) {
        delay(250)
        cargando = true
        try {
            respuesta = api.catalogo(texto, familia)
            error = null
            val r = respuesta
            if (codigoInicial != null && texto == codigoInicial && !estado.inicialAbierto)
                r?.productos?.firstOrNull { it.codigo == codigoInicial }?.let { estado.inicialAbierto = true; elegir(it) }
        } catch (e: FalloApi) {
            error = e.message
        } finally {
            cargando = false
        }
    }
    // Una sola columna: dentro de AnimatedContent (una caja), dos hijos sueltos se dibujarían uno encima del otro.
    Column(Modifier.fillMaxSize()) {
    Column(Modifier.padding(horizontal = 20.dp)) {
        TituloSeccion("Agregar producto", detalle = "Busca en el catálogo sin usar el asistente.")
        val agregados = estado.agregados
        if (agregados.isNotEmpty()) Row(
            Modifier.padding(top = 10.dp).fillMaxWidth().clip(Radios.lg).background(c.verdeVelo).padding(start = 14.dp, top = 6.dp, bottom = 6.dp, end = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "${plural(agregados.size, "producto agregado", "productos agregados")} · ${agregados.takeLast(3).joinToString(" · ")}${if (agregados.size > 3) " …" else ""}",
                style = MaterialTheme.typography.bodySmall,
                color = c.tinta,
                modifier = Modifier.weight(1f).semantics { liveRegion = LiveRegionMode.Polite },
            )
            BotonTexto("Listo, ver cotización", alCerrar)
        }
        Spacer(Modifier.height(12.dp))
        Campo(texto, { texto = it; grupo = null }, "Modelo, madera o medida", icono = Iconos.Buscar, accionIme = ImeAction.Search, mayusculas = KeyboardCapitalization.None, ayuda = "Ej. «huilo oregón 80»")
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            FAMILIAS.forEach { (f, nombre) -> ChipFiltro(nombre, familia == f, { familia = f; grupo = null }) }
        }
        if (cargando) LinearProgressIndicator(Modifier.fillMaxWidth(), color = c.verde, trackColor = c.tonal) else Spacer(Modifier.height(4.dp))
        respuesta?.interpretacion?.let { Text("Buscando: $it", style = MaterialTheme.typography.bodySmall, color = c.apagado) }
        respuesta?.sugerencia?.let { Text("Se buscó «${bonito(it)}» en lugar de lo escrito.", style = MaterialTheme.typography.bodySmall, color = c.calidoTexto) }
        error?.let { Aviso(it, tono = TonoAviso.PELIGRO) }
    }
    val r = respuesta
    val productos = r?.productos.orEmpty().let { lista -> grupo?.let { g -> lista.filter { it.modelo == g.modelo && it.madera == g.madera } } ?: lista }
    LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (grupo == null && (r?.grupos?.size ?: 0) > 1 && (r?.total ?: 0) > 24) {
            item { Rotulo("${r!!.total} productos en ${r.grupos.size} grupos: elige modelo y madera") }
            items(r!!.grupos, key = { "${it.modelo}|${it.madera}" }) { g ->
                Row(
                    Modifier.fillMaxWidth().clip(Radios.lg).border(1.dp, c.linea, Radios.lg).clickable { grupo = g }.padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    MuestraMadera(g.madera)
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text("${bonito(g.modelo)} · ${bonito(g.madera)}", style = MaterialTheme.typography.titleSmall, color = c.tinta)
                        Text("${g.total} medidas", style = MaterialTheme.typography.bodySmall, color = c.apagado)
                    }
                }
            }
        } else {
            if (grupo != null) item { BotonTexto("Todos los resultados", { grupo = null }, icono = Iconos.Izquierda) }
            items(productos, key = { it.codigo }) { p -> FilaProducto(p) { elegir(p) } }
            if (r != null && productos.isEmpty() && !cargando) item {
                EstadoVacio(Iconos.Buscar, "Sin resultados", "Prueba con otro nombre o crea un producto especial solo para esta cotización.")
            }
        }
        item {
            Spacer(Modifier.height(8.dp))
            BotonSecundario("Crear producto especial", especial, Modifier.fillMaxWidth(), icono = Iconos.Mas)
            Text("Fuera de catálogo: queda solo en esta cotización, con el precio que indiques.", style = MaterialTheme.typography.bodySmall, color = c.apagado, modifier = Modifier.padding(top = 6.dp, bottom = 24.dp))
        }
    }
    }
}

@Composable
fun FilaProducto(p: ProductoConsulta, alPulsar: () -> Unit) {
    val c = Neltume.colores
    Row(
        Modifier.fillMaxWidth().clip(Radios.lg).background(c.superficie).border(1.dp, c.linea, Radios.lg).clickable(onClick = alPulsar).padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MuestraMadera(p.madera)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(nombreProducto(p.descripcion), style = MaterialTheme.typography.titleSmall, color = c.tinta)
            Text("${p.codigo} · ${medidaProducto(p.familia, p.medida, p.largo, p.anchoMin, p.anchoMax, p.altoMin, p.altoMax)}", style = MaterialTheme.typography.bodySmall, color = c.apagado)
        }
        Spacer(Modifier.width(8.dp))
        Column(horizontalAlignment = Alignment.End) {
            Text(pesos(p.unitario), style = MaterialTheme.typography.titleSmall, color = c.tinta)
            Text("sin IVA", style = MaterialTheme.typography.labelSmall, color = c.apagado)
        }
    }
}

@Composable
private fun FormProducto(p: ProductoConsulta, vm: CotizadorViewModel, estado: EstadoBusqueda, volver: () -> Unit, alCerrar: () -> Unit) {
    val c = Neltume.colores
    val alcance = rememberCoroutineScope()
    val puerta = p.familia == "PUERTA"
    val anchoInicial = p.anchoMax ?: p.anchoMin
    var cantidad by remember { mutableStateOf("1") }
    var ancho by remember { mutableStateOf(anchoInicial?.let(::decimalCampo) ?: "") }
    var alto by remember { mutableStateOf(decimalCampo(p.altoMax ?: p.largo)) }
    var tipo by remember { mutableStateOf(estado.tipo) }
    var error by remember { mutableStateOf<String?>(null) }
    var ocupado by remember { mutableStateOf(false) }
    fun tramo(min: Double, max: Double) = if (min == max) "${decimalCampo(min)} m" else "entre ${decimalCampo(min)} y ${decimalCampo(max)} m"
    fun agregar(seguir: Boolean) {
        val n = cantidad.trim().toIntOrNull()
        val anchoM = if (puerta) leerMedida(ancho, "PUERTA", CampoMedida.ANCHO) else null
        val altoM = leerMedida(alto, p.familia)
        val anchoMin = p.anchoMin ?: anchoInicial ?: 0.0
        val anchoMax = p.anchoMax ?: anchoInicial ?: Double.MAX_VALUE
        val altoMin = p.altoMin ?: p.largo
        val altoMax = p.altoMax ?: p.largo
        fun dentro(m: Double, min: Double, max: Double) = m >= min - 1e-9 && m <= max + 1e-9
        error = when {
            !Limites.cantidadValida(n) -> "La cantidad debe ser un número entero entre 1 y 10.000."
            puerta && anchoM == null -> Limites.errorMedida(CampoMedida.ANCHO, "PUERTA")
            puerta && !dentro(anchoM!!, anchoMin, anchoMax) -> "Este producto se cotiza con un ancho ${tramo(anchoMin, anchoMax)}."
            altoM == null -> Limites.errorMedida(CampoMedida.ALTO, p.familia)
            !dentro(altoM, altoMin, altoMax) -> "Este producto se cotiza con un ${if (puerta) "alto" else "largo"} ${tramo(altoMin, altoMax)}."
            else -> null
        }
        if (error != null) return
        alcance.launch {
            ocupado = true
            try {
                vm.agregarProducto(p.codigo, n!!, anchoM, altoM, if (puerta) tipo else null, seguir)
                if (puerta) estado.tipo = tipo
                if (seguir) {
                    estado.agregados += nombreProducto(p.descripcion) + if (n > 1) " × $n" else ""
                    volver()
                } else alCerrar()
            } catch (e: FalloApi) {
                error = e.message
            } finally {
                ocupado = false
            }
        }
    }
    Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        BotonTexto("Volver a resultados", volver, icono = Iconos.Izquierda, habilitado = !ocupado)
        Row(verticalAlignment = Alignment.CenterVertically) {
            MuestraMadera(p.madera)
            Spacer(Modifier.width(10.dp))
            Text(nombreProducto(p.descripcion), style = MaterialTheme.typography.headlineSmall, color = c.tinta)
        }
        Text("${p.codigo} · ${pesos(p.unitario)} sin IVA, unitario de referencia. El precio final se calcula con las condiciones de esta cotización.", style = MaterialTheme.typography.bodySmall, color = c.apagado)
        Campo(cantidad, { cantidad = it.filter(Char::isDigit) }, "Cantidad", teclado = KeyboardType.Number)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (puerta) Campo(ancho, { ancho = it }, "Ancho", Modifier.weight(1f), teclado = KeyboardType.Decimal, sufijo = "m")
            Campo(alto, { alto = it }, if (puerta) "Alto" else "Largo", Modifier.weight(1f), teclado = KeyboardType.Decimal, sufijo = "m")
        }
        if (puerta) Column {
            Rotulo("La medida es de")
            Spacer(Modifier.height(6.dp))
            HojaVano(tipo, true) { tipo = it }
        }
        error?.let { Aviso(it, tono = TonoAviso.PELIGRO) }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            BotonSecundario("Agregar y seguir", { agregar(true) }, Modifier.weight(1f), habilitado = !ocupado)
            BotonPrincipal("Agregar al pedido", { agregar(false) }, Modifier.weight(1f), cargando = ocupado)
        }
        Spacer(Modifier.height(24.dp))
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FormEspecial(vm: CotizadorViewModel, nombreInicial: String, volver: () -> Unit, alCerrar: () -> Unit) {
    val c = Neltume.colores
    val alcance = rememberCoroutineScope()
    var nombre by remember { mutableStateOf(nombreInicial) }
    var familia by remember { mutableStateOf("PUERTA") }
    var madera by remember { mutableStateOf("") }
    var cantidad by remember { mutableStateOf("1") }
    var ancho by remember { mutableStateOf("") }
    var alto by remember { mutableStateOf("") }
    var tipo by remember { mutableStateOf(TipoMedida.HOJA) }
    var precio by remember { mutableStateOf("") }
    var descripcion by remember { mutableStateOf("") }
    var notas by remember { mutableStateOf("") }
    var errores by remember { mutableStateOf(mapOf<String, String>()) }
    var ocupado by remember { mutableStateOf(false) }
    val libre = familia == "OTRO"
    val puerta = familia == "PUERTA"
    fun agregar() {
        val e = mutableMapOf<String, String>()
        if (nombre.isBlank()) e["nombre"] = "Escribe el nombre del producto."
        if (!libre && madera.isBlank()) e["madera"] = "Indica la madera."
        val n = cantidad.toIntOrNull()
        if (!Limites.cantidadValida(n)) e["cantidad"] = "La cantidad debe ser un número entero entre 1 y 10.000."
        val anchoM = if (!libre && puerta && ancho.isNotBlank()) leerMedida(ancho, "PUERTA", CampoMedida.ANCHO).also { if (it == null) e["ancho"] = Limites.errorMedida(CampoMedida.ANCHO, familia) } else null
        val altoM = if (!libre && alto.isNotBlank()) leerMedida(alto, familia).also { if (it == null) e["alto"] = Limites.errorMedida(CampoMedida.ALTO, familia) } else null
        val p = leerPesos(precio).aPesos()?.takeIf { it > 0 }
        if (p == null) e["precio"] = "Escribe el precio unitario en pesos, sin decimales."
        errores = e
        if (e.isNotEmpty()) return
        alcance.launch {
            ocupado = true
            try {
                vm.agregarPersonalizado(
                    nombre.trim(), familia, if (libre) "" else madera.trim(), descripcion.trim().ifEmpty { null }, anchoM, altoM,
                    if (puerta) tipo else TipoMedida.NO_ESPECIFICADO, n!!, p!!, notas.trim().ifEmpty { null }, emptyList(),
                )
                alCerrar()
            } catch (x: FalloApi) {
                errores = mapOf("general" to (x.message ?: ""))
            } finally {
                ocupado = false
            }
        }
    }
    Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        BotonTexto("Volver a la búsqueda", volver, icono = Iconos.Izquierda, habilitado = !ocupado)
        TituloSeccion("Producto especial", detalle = "Queda solo en esta cotización; nunca pasa al catálogo.")
        Rotulo("Tipo")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("PUERTA" to "Puerta", "MARCO" to "Marco", "MOLDURA" to "Moldura", "PIEZAS_T" to "Pieza T", "OTRO" to "Ítem libre").forEach { (f, n) ->
                ChipFiltro(n, familia == f, { familia = f })
            }
        }
        if (libre) Text("Lo que no es carpintería (instalación, flete especial…): nombre, cantidad y precio. No va a ninguna fábrica.", style = MaterialTheme.typography.bodySmall, color = c.apagado)
        Campo(nombre, { nombre = it }, "Nombre", error = errores["nombre"], mayusculas = KeyboardCapitalization.Words, largoMaximo = 300)
        if (!libre) Campo(madera, { madera = it }, "Madera", error = errores["madera"], mayusculas = KeyboardCapitalization.Words, largoMaximo = 300)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Campo(cantidad, { cantidad = it.filter(Char::isDigit) }, "Cantidad", Modifier.weight(1f), error = errores["cantidad"], teclado = KeyboardType.Number)
            CampoPesos(precio, { precio = it }, "Precio unitario", Modifier.weight(1.5f), error = errores["precio"], ayuda = "Sin IVA")
        }
        if (!libre) Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (puerta) Campo(ancho, { ancho = it }, "Ancho (opcional)", Modifier.weight(1f), error = errores["ancho"], teclado = KeyboardType.Decimal, sufijo = "m")
            Campo(alto, { alto = it }, if (puerta) "Alto (opcional)" else "Largo (opcional)", Modifier.weight(1f), error = errores["alto"], teclado = KeyboardType.Decimal, sufijo = "m")
        }
        if (puerta) HojaVano(tipo, true) { tipo = it }
        Campo(descripcion, { descripcion = it }, "Descripción para el documento (opcional)", largoMaximo = 300)
        Campo(notas, { notas = it }, "Nota del ítem (opcional)", lineas = 2, largoMaximo = Limites.LARGO_OBSERVACION_ITEM)
        errores["general"]?.let { Aviso(it, tono = TonoAviso.PELIGRO) }
        BotonPrincipal("Agregar al pedido", ::agregar, Modifier.fillMaxWidth(), cargando = ocupado)
        Spacer(Modifier.height(24.dp))
    }
}
