package cl.puertasneltume.cotizador.catalogo

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cl.puertasneltume.cotizador.Contenedor
import cl.puertasneltume.cotizador.diseno.BotonIcono
import cl.puertasneltume.cotizador.diseno.BotonSecundario
import cl.puertasneltume.cotizador.diseno.Campo
import cl.puertasneltume.cotizador.diseno.ChipFiltro
import cl.puertasneltume.cotizador.diseno.EstadoVacio
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.MuestraMadera
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Radios
import cl.puertasneltume.cotizador.diseno.Rotulo
import cl.puertasneltume.cotizador.diseno.TituloSeccion
import cl.puertasneltume.cotizador.nucleo.api.FalloApi
import cl.puertasneltume.cotizador.nucleo.modelo.GrupoConsulta
import cl.puertasneltume.cotizador.nucleo.modelo.ProductoConsulta
import cl.puertasneltume.cotizador.nucleo.modelo.RespuestaConsulta
import cl.puertasneltume.cotizador.nucleo.reglas.NumerosCL
import cl.puertasneltume.cotizador.nucleo.reglas.medidaProducto
import cl.puertasneltume.cotizador.nucleo.reglas.nombreProducto
import cl.puertasneltume.cotizador.nucleo.reglas.pesos
import cl.puertasneltume.cotizador.nucleo.reglas.sinMedida
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** La primera opción es «todas»: el estado sin filtro (src/app/catalogo-consulta.tsx). */
private val FAMILIAS_CONSULTA = listOf(null to "Todas las familias", "PUERTA" to "Puertas", "MARCO" to "Marcos", "PIEZAS_T" to "Piezas T", "MOLDURA" to "Molduras")

/**
 * Consulta del catálogo: modelos, maderas y medidas con el precio de venta de la cotización. La búsqueda espera a
 * que se deje de escribir (250 ms) y cancela la anterior, como la web.
 */
internal class ConsultaViewModel(private val c: Contenedor) : ViewModel() {
    var q by mutableStateOf("")
        private set
    var familia by mutableStateOf<String?>(null)
        private set
    var datos by mutableStateOf<RespuestaConsulta?>(null)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var cargando by mutableStateOf(false)
        private set
    private var tarea: Job? = null

    init {
        consultar(0)
    }

    fun buscar(texto: String) {
        q = texto.take(100)
        consultar()
    }

    fun filtrar(f: String?) {
        familia = f
        consultar()
    }

    fun limpiar() {
        q = ""
        familia = null
        consultar()
    }

    /** Vuelve a consultar sin tocar la búsqueda. */
    fun reintentar() {
        error = null
        datos = null
        consultar(0)
    }

    private fun consultar(espera: Long = 250) {
        tarea?.cancel()
        tarea = viewModelScope.launch {
            if (espera > 0) delay(espera)
            cargando = true
            try {
                datos = c.api.catalogo(q, familia)
                error = null
            } catch (e: FalloApi) {
                error = e.message
            }
            cargando = false
        }
    }
}

/** Encabezado de la consulta: título e indicación (se desplaza con la lista). */
internal fun LazyListScope.encabezadoConsulta(lado: Dp) {
    item(key = "consulta-titulo") {
        Column(Modifier.padding(horizontal = lado).padding(top = 20.dp, bottom = 4.dp)) {
            TituloSeccion("Consultar el catálogo")
            Spacer(Modifier.height(6.dp))
            Introduccion(
                "Busca como lo dice el cliente: modelo, madera y medida («willow mara 82 210», «ranco 1 metro»). " +
                    "Entiende los mismos nombres que el asistente.",
            )
        }
    }
}

/** Buscador y familias: fijo arriba mientras se recorre la lista. */
internal fun LazyListScope.buscadorConsulta(vm: ConsultaViewModel, lado: Dp) {
    stickyHeader(key = "consulta-buscador") {
        val c = Neltume.colores
        val foco = LocalFocusManager.current
        Column(Modifier.fillMaxWidth().background(c.papel).padding(top = 8.dp)) {
            Campo(
                vm.q,
                vm::buscar,
                "Buscar en el catálogo",
                Modifier.padding(horizontal = lado),
                ayuda = "Ej.: Molco oregón 0,80",
                icono = Iconos.Buscar,
                accionIme = ImeAction.Search,
                alAccion = { foco.clearFocus() },
                mayusculas = KeyboardCapitalization.None,
                largoMaximo = 100,
                final = if (vm.q.isNotEmpty()) ({ BotonIcono(Iconos.Cerrar, "Borrar búsqueda", { vm.buscar("") }) }) else null,
            )
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = lado, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                FAMILIAS_CONSULTA.forEach { (f, nombre) ->
                    ChipFiltro(
                        nombre,
                        vm.familia == f,
                        { vm.filtrar(f) },
                        Modifier.semantics {
                            role = Role.RadioButton
                            selected = vm.familia == f
                        },
                    )
                }
            }
            if (vm.cargando && vm.datos != null)
                LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = lado).height(2.dp), color = c.verde, trackColor = c.tonal)
            else Spacer(Modifier.height(2.dp))
        }
    }
}

/** Resultados: lectura de la búsqueda, grupos por modelo y madera, conteo y productos con «Cotizar». */
internal fun LazyListScope.resultadosConsulta(vm: ConsultaViewModel, lado: Dp, cotizar: (ProductoConsulta) -> Unit) {
    val datos = vm.datos
    val error = vm.error
    when {
        error != null -> item(key = "consulta-error") { ErrorReintento(error, vm::reintentar, Modifier.padding(horizontal = lado, vertical = 8.dp)) }
        datos == null -> item(key = "consulta-cargando") { Cargando("Cargando catálogo…") }
        datos.productos.isEmpty() -> item(key = "consulta-vacia") {
            EstadoVacio(Iconos.Buscar, "Sin productos que coincidan.", "Prueba con otro modelo, madera o medida.") {
                if (vm.q.isNotBlank() || vm.familia != null) BotonSecundario("Limpiar filtros", vm::limpiar)
            }
        }
        else -> {
            item(key = "consulta-resumen") {
                Column(Modifier.padding(horizontal = lado).padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    LecturaBusqueda(datos, vm.q)
                    if (datos.total > 40 && datos.grupos.size > 1) Desplegable("Ver por modelo y madera (${datos.grupos.size})") {
                        datos.grupos.forEach { g ->
                            FilaGrupo(g) { vm.buscar("${nombreProducto(g.modelo)} ${nombreProducto(g.madera)}") }
                        }
                    }
                    Text(
                        if (datos.total > datos.productos.size)
                            "Mostrando ${datos.productos.size} de ${datos.total} productos: afina la búsqueda para ver el resto."
                        else "${datos.total} producto${if (datos.total == 1) "" else "s"}.",
                        Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                        style = MaterialTheme.typography.bodySmall,
                        color = Neltume.colores.apagado,
                    )
                    Rotulo("Precio de venta: costo de fábrica + ganancia, sin IVA")
                }
            }
            itemsIndexed(datos.productos, key = { _, p -> "p-${p.codigo}" }) { i, p ->
                val inicioModelo = i > 0 && datos.productos[i - 1].modelo != p.modelo
                FilaConsulta(p, Modifier.padding(horizontal = lado).padding(top = if (inicioModelo) 14.dp else 8.dp)) { cotizar(p) }
            }
        }
    }
}

/** Cómo se entendió la búsqueda y, si una palabra no se reconoció, con qué modelo se buscó (`LecturaBusqueda`). */
@Composable
private fun LecturaBusqueda(datos: RespuestaConsulta, consulta: String) {
    if (consulta.isBlank() || (datos.interpretacion == null && datos.sugerencia == null)) return
    val c = Neltume.colores
    val negrita = SpanStyle(fontWeight = FontWeight.SemiBold, color = c.tinta)
    val texto = buildAnnotatedString {
        val sugerencia = datos.sugerencia
        if (sugerencia != null) {
            append("No encontré «${consulta.trim()}» tal cual. Te muestro ")
            withStyle(negrita) { append(nombreProducto(sugerencia)) }
            append(datos.interpretacion?.let { ": ${nombreProducto(it)}" } ?: ".")
        } else {
            append("Buscando ")
            withStyle(negrita) { append(nombreProducto(datos.interpretacion ?: "")) }
        }
    }
    Text(texto, style = MaterialTheme.typography.bodySmall, color = if (datos.sugerencia != null) c.calidoTexto else c.tintaSuave)
}

private fun metrosRango(m: Double) = NumerosCL.formatear(m, minimoDecimales = 2, maximoDecimales = 2)

private fun rango(min: Double?, max: Double?): String? = when {
    min == null || max == null -> null
    min == max -> "${metrosRango(min)} m"
    else -> "${metrosRango(min)} a ${metrosRango(max)} m"
}

/** Un modelo en una madera con sus medidas: elegirlo acota la búsqueda (`GruposBusqueda`). */
@Composable
private fun FilaGrupo(g: GrupoConsulta, elegir: () -> Unit) {
    val c = Neltume.colores
    val ancho = rango(g.anchoMin, g.anchoMax)
    val alto = rango(g.altoMin, g.altoMax)
    val detalle = if (g.familia == "PUERTA") listOfNotNull(ancho?.let { "Anchos $it" }, alto?.let { "altos $it" }).joinToString(" · ")
    else listOfNotNull(alto?.let { "Largos $it" }).joinToString(" · ")
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clip(Radios.lg)
            .background(c.superficie)
            .border(1.dp, c.linea, Radios.lg)
            .clickable(onClickLabel = "Buscar este modelo", onClick = elegir)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MuestraMadera(g.madera)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text("${nombreProducto(g.modelo)} · ${nombreProducto(g.madera)}", style = MaterialTheme.typography.titleSmall, color = c.tinta)
            if (detalle.isNotEmpty()) Text(detalle, style = MaterialTheme.typography.bodySmall, color = c.apagado)
        }
        Text("${g.total} ${if (g.total == 1) "medida" else "medidas"}", style = MaterialTheme.typography.labelMedium, color = c.tintaSuave)
    }
}

/** Un producto con su medida, su precio de venta sin IVA y «Cotizar» (lo abre en Cotizar sin volver a buscarlo). */
@Composable
private fun FilaConsulta(p: ProductoConsulta, modifier: Modifier, cotizar: () -> Unit) {
    val c = Neltume.colores
    // En puertas la medida va aparte: el nombre queda en modelo y madera.
    val nombre = if (p.familia == "PUERTA") sinMedida(nombreProducto(p.descripcion)) else nombreProducto(p.descripcion)
    Row(
        modifier
            .fillMaxWidth()
            .clip(Radios.lg)
            .background(c.superficie)
            .border(1.dp, c.linea, Radios.lg)
            .clickable(onClickLabel = "Cotizar ${nombreProducto(p.descripcion)} (${p.codigo})", onClick = cotizar)
            .padding(start = 14.dp, top = 12.dp, bottom = 12.dp, end = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MuestraMadera(p.madera)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(nombre, style = MaterialTheme.typography.titleSmall, color = c.tinta)
            Text(
                medidaProducto(p.familia, p.medida, p.largo, p.anchoMin, p.anchoMax, p.altoMin, p.altoMax),
                style = MaterialTheme.typography.bodySmall,
                color = c.tintaSuave,
            )
            Text(
                p.codigo + if (p.manual) " · agregado manualmente" else "",
                style = MaterialTheme.typography.labelSmall,
                color = c.apagado,
            )
        }
        Spacer(Modifier.width(8.dp))
        Column(horizontalAlignment = Alignment.End) {
            Text(pesos(p.unitario), style = MaterialTheme.typography.titleSmall, color = c.tinta)
            Text("sin IVA", style = MaterialTheme.typography.labelSmall, color = c.apagado)
            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Cotizar", style = MaterialTheme.typography.labelMedium, color = c.verde)
                Icon(Iconos.Derecha, null, tint = c.verde, modifier = Modifier.size(14.dp))
            }
        }
    }
}
