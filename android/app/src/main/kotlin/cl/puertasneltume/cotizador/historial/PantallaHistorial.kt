package cl.puertasneltume.cotizador.historial

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import cl.puertasneltume.cotizador.comun.LocalAvisos
import cl.puertasneltume.cotizador.comun.LocalNavegador
import cl.puertasneltume.cotizador.comun.vm
import cl.puertasneltume.cotizador.cotizar.ItemMenu
import cl.puertasneltume.cotizador.cotizar.LocalCotizador
import cl.puertasneltume.cotizador.cotizar.SelectorFecha
import cl.puertasneltume.cotizador.diseno.Aviso
import cl.puertasneltume.cotizador.diseno.BotonIcono
import cl.puertasneltume.cotizador.diseno.BotonPrincipal
import cl.puertasneltume.cotizador.diseno.BotonSecundario
import cl.puertasneltume.cotizador.diseno.BotonTexto
import cl.puertasneltume.cotizador.diseno.Campo
import cl.puertasneltume.cotizador.diseno.ChipFiltro
import cl.puertasneltume.cotizador.diseno.EstadoVacio
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.LineaPasos
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Pildora
import cl.puertasneltume.cotizador.diseno.PildoraEstado
import cl.puertasneltume.cotizador.diseno.Rotulo
import cl.puertasneltume.cotizador.diseno.Tarjeta
import cl.puertasneltume.cotizador.diseno.TituloPantalla
import cl.puertasneltume.cotizador.diseno.TituloSeccion
import cl.puertasneltume.cotizador.diseno.TonoAviso
import cl.puertasneltume.cotizador.navegacion.Ruta
import cl.puertasneltume.cotizador.nucleo.api.Descarga
import cl.puertasneltume.cotizador.nucleo.api.FalloApi
import cl.puertasneltume.cotizador.nucleo.modelo.EstadoCotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.EventoCotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.ResumenCotizacion
import cl.puertasneltume.cotizador.nucleo.reglas.Fechas
import cl.puertasneltume.cotizador.nucleo.reglas.SIN_CLIENTE
import cl.puertasneltume.cotizador.nucleo.reglas.autoria
import cl.puertasneltume.cotizador.nucleo.reglas.avancePedido
import cl.puertasneltume.cotizador.nucleo.reglas.estadoPago
import cl.puertasneltume.cotizador.nucleo.reglas.etiquetaComercial
import cl.puertasneltume.cotizador.nucleo.reglas.etiquetaEvento
import cl.puertasneltume.cotizador.nucleo.reglas.etiquetaOperativo
import cl.puertasneltume.cotizador.nucleo.reglas.nombreProducto
import cl.puertasneltume.cotizador.nucleo.reglas.numeroCotizacion
import cl.puertasneltume.cotizador.nucleo.reglas.pesos
import cl.puertasneltume.cotizador.nucleo.reglas.plural
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** Historial de cotizaciones: buscar, filtrar, abrir, duplicar, ver la actividad y exportar. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun PantallaHistorial() {
    val c = Neltume.colores
    val vm = vm { HistorialViewModel(it) }
    val e by vm.estado.collectAsStateWithLifecycle()
    val navegador = LocalNavegador.current
    val cotizador = LocalCotizador.current
    val avisos = LocalAvisos.current
    val contexto = LocalContext.current
    val alcance = rememberCoroutineScope()
    var filtros by remember { mutableStateOf(false) }
    var actividad by remember { mutableStateOf<ResumenCotizacion?>(null) }
    val lista = rememberLazyListState()
    val cerca by remember { derivedStateOf { (lista.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= lista.layoutInfo.totalItemsCount - 5 } }
    LaunchedEffect(cerca, e.items.size) { if (cerca) vm.cargarMas() }

    fun entregarCsv(d: Descarga) = alcance.launch {
        val nombre = d.nombre ?: "historial.csv"
        val archivo = withContext(Dispatchers.IO) {
            File(File(contexto.cacheDir, "exportaciones").apply { mkdirs() }, nombre).apply { writeBytes(d.bytes) }
        }
        val uri = FileProvider.getUriForFile(contexto, "${contexto.packageName}.archivos", archivo)
        contexto.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
            type = "text/csv"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }, "Guardar o enviar el CSV"))
    }
    fun exportar(parte: Int? = null) = alcance.launch {
        try {
            vm.exportar(parte)?.let { entregarCsv(it) }
        } catch (x: FalloApi) {
            avisos.mostrar(x.message ?: "No se pudo exportar.", largo = true)
        }
    }

    Column(Modifier.fillMaxSize().background(c.papel)) {
        Column(Modifier.windowInsetsPadding(WindowInsets.statusBars).padding(horizontal = 16.dp, vertical = 8.dp)) {
            TituloPantalla("Historial", subtitulo = plural(e.total, "registro")) {
                BotonIcono(Iconos.Descargar, "Exportar CSV", { exportar() }, habilitado = !e.exportando && e.total > 0)
            }
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Campo(e.q, vm::buscar, "N°, cliente, RUT o producto", Modifier.weight(1f), icono = Iconos.Buscar,
                    final = if (e.q.isNotEmpty()) ({ BotonIcono(Iconos.Cerrar, "Borrar búsqueda", { vm.buscar("") }) }) else null)
                Spacer(Modifier.width(8.dp))
                Box {
                    BotonIcono(Iconos.Filtro, "Filtros", { filtros = true }, tono = if (e.filtrosHoja > 0) c.verde else c.tintaSuave, fondo = if (e.filtrosHoja > 0) c.verdeVelo else c.tonal)
                    if (e.filtrosHoja > 0) Pildora("${e.filtrosHoja}", c.verde, c.sobreVerde, Modifier.align(Alignment.TopEnd))
                }
            }
        }
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(FiltroEstado.entries) { f ->
                ChipFiltro(f.etiqueta, e.filtro == f, {
                    if (f == FiltroEstado.PAPELERA) navegador.empujar(Ruta.Papelera) else vm.cambiar { it.copy(filtro = f) }
                })
            }
        }
        e.filtro.ayuda?.takeIf { e.filtro != FiltroEstado.PAPELERA }?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = c.apagado, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
        }
        e.partesCsv?.let { partes ->
            Aviso("El listado tiene más de 5.000 filas: descárgalo por partes, en el orden del historial.", Modifier.padding(16.dp), TonoAviso.ATENCION) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    (1..partes).forEach { p -> BotonTexto("Parte $p", { exportar(p) }) }
                }
            }
        }
        PullToRefreshBox(e.recargando, vm::recargar, Modifier.fillMaxSize()) {
            when {
                e.cargando && e.items.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = c.verde) }
                e.error != null && e.items.isEmpty() -> EstadoVacio(Iconos.Wifi, "No se pudo cargar el historial", e.error!!) {
                    BotonPrincipal("Reintentar", vm::recargar, icono = Iconos.Recargar)
                }
                e.items.isEmpty() -> EstadoVacio(
                    Iconos.Historial,
                    if (e.filtros.activos) "Nada con estos filtros" else "Todavía no hay cotizaciones",
                    if (e.filtros.activos) "Prueba con otra búsqueda o limpia los filtros." else "Las cotizaciones aparecen aquí desde el primer pedido.",
                ) { if (e.filtros.activos) BotonSecundario("Limpiar filtros", vm::limpiar) }
                else -> LazyColumn(
                    state = lista,
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    e.items.groupBy { Fechas.mesAnio(it.fecha.ifEmpty { it.creada }) }.forEach { (mes, filas) ->
                        stickyHeader(key = "mes-$mes") {
                            Text(
                                mes,
                                style = MaterialTheme.typography.titleSmall,
                                color = c.apagado,
                                modifier = Modifier.fillMaxWidth().background(c.papel).padding(vertical = 6.dp),
                            )
                        }
                        items(filas, key = { it.id }) { r ->
                            FilaHistorial(
                                r,
                                abrir = { navegador.abrirCotizacion(r.id) },
                                duplicar = {
                                    cotizador.duplicar(r.id, r.numero)
                                    navegador.ir(cl.puertasneltume.cotizador.navegacion.Seccion.COTIZAR)
                                },
                                verActividad = { actividad = r },
                                verPdf = r.pdf?.let { pdf -> { navegador.empujar(Ruta.Documento(pdf, "Cotización ${numeroCotizacion(r.numero)}", true)) } },
                            )
                        }
                    }
                    if (e.cargandoMas) item { Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = c.verde) } }
                }
            }
        }
    }
    if (filtros) HojaFiltros(e, vm) { filtros = false }
    actividad?.let { r -> HojaActividad(r, vm) { actividad = null } }
}

@Composable
private fun FilaHistorial(r: ResumenCotizacion, abrir: () -> Unit, duplicar: () -> Unit, verActividad: () -> Unit, verPdf: (() -> Unit)?) {
    val c = Neltume.colores
    var menu by remember { mutableStateOf(false) }
    Tarjeta(abrir) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(numeroCotizacion(r.numero), style = MaterialTheme.typography.titleMedium, color = c.tinta)
            Spacer(Modifier.width(8.dp))
            PildoraEstado(r.estado, vencida = r.vencida && r.estado == EstadoCotizacion.EMITIDA)
            Spacer(Modifier.weight(1f))
            Text(pesos(r.total), style = MaterialTheme.typography.titleMedium, color = c.tinta)
            Box {
                BotonIcono(Iconos.MasOpciones, "Acciones de ${numeroCotizacion(r.numero)}", { menu = true })
                DropdownMenu(menu, { menu = false }) {
                    ItemMenu("Abrir", Iconos.Externo) { menu = false; abrir() }
                    verPdf?.let { ItemMenu("Ver PDF", Iconos.Archivo) { menu = false; it() } }
                    ItemMenu("Duplicar", Iconos.Duplicar) { menu = false; duplicar() }
                    ItemMenu("Actividad", Iconos.Historial) { menu = false; verActividad() }
                }
            }
        }
        Text(r.cliente.nombre?.takeIf { it.isNotBlank() } ?: SIN_CLIENTE, style = MaterialTheme.typography.bodyMedium, color = c.tinta)
        if (r.productos.isNotBlank()) Text(nombreProducto(r.productos), style = MaterialTheme.typography.bodySmall, color = c.apagado, maxLines = 2)
        Spacer(Modifier.height(8.dp))
        if (r.estado == EstadoCotizacion.APROBADA || r.estado == EstadoCotizacion.EMITIDA) {
            val a = avancePedido(r)
            LineaPasos(a.hechos, a.actual, compacta = true)
            Spacer(Modifier.height(8.dp))
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                listOfNotNull(Fechas.corta(r.fecha.ifEmpty { r.creada }), r.cliente.comuna, if (r.pendientes > 0) plural(r.pendientes, "pendiente") else null).joinToString(" · "),
                style = MaterialTheme.typography.labelSmall,
                color = c.apagado,
                modifier = Modifier.weight(1f),
            )
            estadoPago(r)?.let { Pildora(it, c.tonal, c.tintaSuave) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun HojaFiltros(e: EstadoHistorial, vm: HistorialViewModel, alCerrar: () -> Unit) {
    val c = Neltume.colores
    var calendario by remember { mutableStateOf<String?>(null) }
    ModalBottomSheet(alCerrar, sheetState = rememberModalBottomSheetState(true), containerColor = c.superficie) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).navigationBarsPadding().padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            TituloSeccion("Filtros")
            Rotulo("Fechas")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                BotonSecundario(e.desde?.let { "Desde ${Fechas.chilena(it)}" } ?: "Desde", { calendario = "desde" }, Modifier.weight(1f), icono = Iconos.Calendario)
                BotonSecundario(e.hasta?.let { "Hasta ${Fechas.chilena(it)}" } ?: "Hasta", { calendario = "hasta" }, Modifier.weight(1f), icono = Iconos.Calendario)
            }
            if (e.desde != null && e.hasta != null && e.desde > e.hasta) Aviso("«Desde» es posterior a «Hasta»: no habrá resultados.", tono = TonoAviso.ATENCION)
            if (e.desde != null || e.hasta != null) BotonTexto("Quitar fechas", { vm.cambiar { it.copy(desde = null, hasta = null) } })
            Rotulo("Seguimiento")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                etiquetaComercial.forEach { (estado, nombre) ->
                    val clave = estado.name.lowercase()
                    ChipFiltro(nombre, clave in e.comercial, { vm.cambiar { it.copy(comercial = if (clave in it.comercial) it.comercial - clave else it.comercial + clave) } })
                }
            }
            Rotulo("Operación")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                etiquetaOperativo.forEach { (estado, nombre) ->
                    val clave = estado.clave
                    ChipFiltro(nombre, clave in e.operativo, { vm.cambiar { it.copy(operativo = if (clave in it.operativo) it.operativo - clave else it.operativo + clave) } })
                }
            }
            if (e.vendedoras.isNotEmpty()) {
                Rotulo("Vendedora")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    ChipFiltro("Todas", e.vendedora == null, { vm.cambiar { it.copy(vendedora = null) } })
                    e.vendedoras.forEach { v -> ChipFiltro(v, e.vendedora == v, { vm.cambiar { it.copy(vendedora = v) } }) }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                BotonSecundario("Limpiar filtros", { vm.limpiar(); alCerrar() }, Modifier.weight(1f))
                BotonPrincipal("Ver ${plural(e.total, "resultado")}", alCerrar, Modifier.weight(1f))
            }
        }
    }
    calendario?.let { cual ->
        SelectorFecha((if (cual == "desde") e.desde else e.hasta) ?: Fechas.hoy(), null, "2100-12-31", { calendario = null }) { f ->
            vm.cambiar { if (cual == "desde") it.copy(desde = f) else it.copy(hasta = f) }
            calendario = null
        }
    }
}

/** Registro de actividad de una cotización: cada cambio con su fecha y quién lo hizo. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HojaActividad(r: ResumenCotizacion, vm: HistorialViewModel, alCerrar: () -> Unit) {
    val c = Neltume.colores
    var eventos by remember { mutableStateOf<List<EventoCotizacion>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(r.id) {
        try {
            eventos = vm.actividad(r.id)
        } catch (e: FalloApi) {
            error = e.message
        }
    }
    ModalBottomSheet(alCerrar, containerColor = c.superficie) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).navigationBarsPadding().padding(bottom = 16.dp)) {
            TituloSeccion("Actividad de la ${numeroCotizacion(r.numero)}", detalle = autoria(r.creadaPor, r.emitidaPor, r.aprobadaPor, r.anuladaPor))
            Spacer(Modifier.height(12.dp))
            error?.let { Aviso(it, tono = TonoAviso.PELIGRO) }
            if (eventos == null && error == null) CircularProgressIndicator(color = c.verde)
            eventos?.reversed()?.forEach { ev ->
                Row(Modifier.padding(vertical = 8.dp)) {
                    Box(Modifier.padding(top = 6.dp).width(8.dp).height(8.dp).background(c.verde, androidx.compose.foundation.shape.CircleShape))
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text(etiquetaEvento(ev.tipo), style = MaterialTheme.typography.titleSmall, color = c.tinta)
                        ev.detalle?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = c.tintaSuave) }
                        Text("${Fechas.fechaHora(ev.fecha)}${ev.usuario?.let { " · $it" } ?: ""}", style = MaterialTheme.typography.labelSmall, color = c.apagado)
                    }
                }
            }
        }
    }
}
