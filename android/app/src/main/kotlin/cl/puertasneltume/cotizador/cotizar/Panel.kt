package cl.puertasneltume.cotizador.cotizar

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import cl.puertasneltume.cotizador.comun.LocalContenedor
import cl.puertasneltume.cotizador.diseno.Aviso
import cl.puertasneltume.cotizador.diseno.BotonIcono
import cl.puertasneltume.cotizador.diseno.BotonPrincipal
import cl.puertasneltume.cotizador.diseno.BotonSecundario
import cl.puertasneltume.cotizador.diseno.BotonTexto
import cl.puertasneltume.cotizador.diseno.EstadoVacio
import cl.puertasneltume.cotizador.diseno.Hoja
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.LineaPasos
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Radios
import cl.puertasneltume.cotizador.diseno.ReglaCarpintero
import cl.puertasneltume.cotizador.diseno.Rotulo
import cl.puertasneltume.cotizador.diseno.TonoAviso
import cl.puertasneltume.cotizador.diseno.TotalAnimado
import cl.puertasneltume.cotizador.nucleo.modelo.Cotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.EstadoCotizacion
import cl.puertasneltume.cotizador.nucleo.reglas.Fechas
import cl.puertasneltume.cotizador.nucleo.reglas.autoria
import cl.puertasneltume.cotizador.nucleo.reglas.avancePedido
import cl.puertasneltume.cotizador.nucleo.reglas.dimensionesEnMilimetros
import cl.puertasneltume.cotizador.nucleo.reglas.itemCorregible
import cl.puertasneltume.cotizador.nucleo.reglas.numeroCotizacion
import cl.puertasneltume.cotizador.nucleo.reglas.pedidoGenerado
import cl.puertasneltume.cotizador.nucleo.reglas.plural
import cl.puertasneltume.cotizador.nucleo.reglas.validez
import cl.puertasneltume.cotizador.nucleo.reglas.vencida
import kotlinx.coroutines.launch
import sh.calvin.reorderable.ReorderableItem
import sh.calvin.reorderable.rememberReorderableLazyListState

/** La cotización: encabezado, seguimiento, productos, secciones y totales, con la barra del total abajo. */
@Composable
fun PanelCotizacion(vm: CotizadorViewModel, e: EstadoCotizador, admin: Boolean, acciones: AccionesCotizar) {
    val c = Neltume.colores
    val q = e.cotizacion
    if (q == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
            EstadoVacio(
                Iconos.Cotizar,
                "Todavía no hay productos",
                "Escribe el pedido en «Pedido» o agrega productos del catálogo sin usar el asistente.",
            ) { BotonPrincipal("Agregar producto del catálogo", acciones.agregarProducto, icono = Iconos.Mas, habilitado = !e.ocupado) }
        }
        return
    }
    val contenedor = LocalContenedor.current
    val ocultarCostos by contenedor.preferencias.modoCliente.collectAsState(false)
    val alcance = rememberCoroutineScope()
    var modificando by rememberSaveable(q.id) { mutableStateOf(false) }
    val editable = q.estado == EstadoCotizacion.BORRADOR || (q.estado == EstadoCotizacion.EMITIDA && modificando)
    val pedido = pedidoGenerado(q)
    var detalle by remember { mutableStateOf<Int?>(null) }
    var referencias by remember { mutableStateOf<Int?>(null) }
    val haptico = LocalHapticFeedback.current

    val items = remember(q) { vistaItems(q) }
    var orden by remember(q) { mutableStateOf(items) }
    val lista = rememberLazyListState()
    val reordenable = rememberReorderableLazyListState(lista) { desde, hasta ->
        val i = orden.indexOfFirst { it.clave == desde.key }
        val j = orden.indexOfFirst { it.clave == hasta.key }
        if (i >= 0 && j >= 0) orden = orden.toMutableList().apply { add(j, removeAt(i)) }
        haptico.performHapticFeedback(HapticFeedbackType.SegmentFrequentTick)
    }

    Column(Modifier.fillMaxSize()) {
        LazyColumn(
            Modifier.weight(1f).fillMaxWidth(),
            state = lista,
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item(key = "encabezado") { Encabezado(q) }
            if (q.estado == EstadoCotizacion.EMITIDA) item(key = "modificar") {
                Aviso(
                    if (modificando) "Estás modificando la ${numeroCotizacion(q.numero)}: el primer cambio crea una revisión en borrador y el PDF emitido se conserva."
                    else "${numeroCotizacion(q.numero)} emitida. Para cambiar algo, toca «Modificar»: se crea una revisión y este PDF se conserva.",
                    tono = if (modificando) TonoAviso.ATENCION else TonoAviso.INFO,
                ) { BotonTexto(if (modificando) "Terminar" else "Modificar", { modificando = !modificando }, icono = if (modificando) Iconos.Check else Iconos.Lapiz) }
            }
            if (q.numero != null && (q.estado == EstadoCotizacion.APROBADA || q.estado == EstadoCotizacion.EMITIDA))
                item(key = "seguimiento") { SeccionSeguimiento(vm, q, e.ocupado) }
            item(key = "productos") {
                CabeceraProductos(
                    q, editable, ocultarCostos, e,
                    agregar = acciones.agregarProducto,
                    alternarCostos = { alcance.launch { contenedor.preferencias.guardarModoCliente(!ocultarCostos) } },
                    vm = vm,
                )
            }
            if (pedido) item(key = "corregir") {
                Aviso("Con la nota de pedido generada, «Corregir pedido» cambia solo los ítems cuya fábrica no empezó a producirlos: cantidad, medidas, hoja o vano, descripción y nota.", tono = TonoAviso.INFO)
            }
            items(orden, key = { it.clave }) { v ->
                ReorderableItem(reordenable, key = v.clave) { arrastrando ->
                    val sombra by animateDpAsState(if (arrastrando) 8.dp else 0.dp, label = "sombra")
                    Box(Modifier.shadow(sombra, Radios.xl)) {
                        TarjetaItem(
                            q = q,
                            v = v,
                            editable = editable,
                            corregible = itemCorregible(q, v.indice),
                            ocultarCostos = ocultarCostos,
                            resaltado = e.cambio?.takeIf { it.id == q.id && v.indice in it.indices }?.marca,
                            ocupado = e.ocupado,
                            vm = vm,
                            abrirDetalle = { detalle = v.indice },
                            abrirReferencias = { referencias = v.indice },
                            agarre = Modifier.draggableHandle(
                                enabled = editable && !e.ocupado,
                                onDragStarted = { haptico.performHapticFeedback(HapticFeedbackType.GestureThresholdActivate) },
                                onDragStopped = {
                                    val hasta = orden.indexOfFirst { it.clave == v.clave }
                                    if (hasta >= 0 && hasta != v.indice) vm.reordenar(v.indice, hasta)
                                    haptico.performHapticFeedback(HapticFeedbackType.GestureEnd)
                                },
                            ),
                        )
                    }
                }
            }
            if (q.flete > 0 || editable) item(key = "flete") { LineaFlete(q, editable, e.ocupado, vm) }
            item(key = "secciones") { Secciones(q, editable, ocultarCostos, e, vm) }
            item(key = "totales") { Totales(q, editable, e, vm) }
            if (q.pdf != null || q.notas.isNotEmpty()) item(key = "documentos") { Documentos(q, admin, e.ocupado, vm, acciones) }
        }
        BarraTotal(q, e, admin, editable, vm, acciones) { indice ->
            alcance.launch {
                val posicion = 4 + indice
                lista.animateScrollToItem(posicion.coerceAtMost(lista.layoutInfo.totalItemsCount - 1))
            }
        }
    }
    detalle?.let { i ->
        val v = vistaItems(q).getOrNull(i)
        if (v != null) HojaDetalleItem(q, v, editable, itemCorregible(q, i), ocultarCostos, vm) { detalle = null } else detalle = null
    }
    referencias?.let { i ->
        val v = vistaItems(q).getOrNull(i)
        if (v != null) HojaReferencias(q, v, editable || itemCorregible(q, i), vm) { referencias = null } else referencias = null
    }
}

@Composable
private fun Encabezado(q: Cotizacion) {
    val c = Neltume.colores
    Column(Modifier.fillMaxWidth().padding(top = 8.dp)) {
        Text(numeroCotizacion(q.numero), style = MaterialTheme.typography.headlineLarge, color = c.tinta, modifier = Modifier.semantics { heading() })
        val autor = autoria(q.creadaPor, q.emitidaPor, q.aprobadaPor, q.anuladaPor)
        val fecha = (q.fechaEmision ?: q.creada).takeIf { it.isNotEmpty() }?.let { Fechas.larga(it) }
        Text(listOfNotNull(autor.ifEmpty { null }, fecha).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = c.apagado)
        if (q.estado == EstadoCotizacion.EMITIDA || q.estado == EstadoCotizacion.BORRADOR)
            Text(validez(q), style = MaterialTheme.typography.bodySmall, color = if (vencida(q)) c.peligro else c.apagado)
        q.origen?.let { Text("Revisión de la N° $it", style = MaterialTheme.typography.bodySmall, color = c.calidoTexto) }
        if (q.estado == EstadoCotizacion.REEMPLAZADA && q.reemplazadaPor != null)
            Text("Reemplazada por la N° ${q.reemplazadaPor}", style = MaterialTheme.typography.bodySmall, color = c.calidoTexto)
        if (q.estado == EstadoCotizacion.ANULADA) Text(
            "Anulada${q.fechaAnulacion?.let { " el ${Fechas.larga(it)}" } ?: ""}${q.motivoAnulacion?.let { ": $it" } ?: ""}",
            style = MaterialTheme.typography.bodySmall,
            color = c.peligro,
        )
        if (vencida(q)) Aviso("Venció el ${Fechas.larga(q.vence!!)}. Se puede aprobar igual, confirmándolo.", Modifier.padding(top = 8.dp), TonoAviso.ATENCION)
        Spacer(Modifier.height(12.dp))
        ReglaCarpintero()
    }
}

@Composable
private fun CabeceraProductos(
    q: Cotizacion,
    editable: Boolean,
    ocultarCostos: Boolean,
    e: EstadoCotizador,
    agregar: () -> Unit,
    alternarCostos: () -> Unit,
    vm: CotizadorViewModel,
) {
    val c = Neltume.colores
    Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("Productos", style = MaterialTheme.typography.headlineSmall, color = c.tinta, modifier = Modifier.semantics { heading() })
            Text(
                plural(q.solicitudes.size, "ítem") + if (q.incompletos.isNotEmpty()) " · ${plural(q.incompletos.size, "pendiente")}" else "",
                style = MaterialTheme.typography.bodySmall,
                color = if (q.incompletos.isNotEmpty()) c.pendiente else c.apagado,
            )
        }
        if (editable) {
            BotonIcono(Iconos.Deshacer, "Deshacer", vm::deshacer, habilitado = e.puedeDeshacer && !e.ocupado)
            BotonIcono(Iconos.Rehacer, "Rehacer", vm::rehacer, habilitado = e.puedeRehacer && !e.ocupado)
        }
        BotonIcono(if (ocultarCostos) Iconos.OjoTachado else Iconos.Ojo, if (ocultarCostos) "Mostrar costos" else "Ocultar costos", alternarCostos)
        if (editable) BotonSecundario("Producto", agregar, icono = Iconos.Mas, habilitado = !e.ocupado)
    }
}

/** Sección plegable de la cotización: título, resumen y contenido al abrirla. */
@Composable
fun SeccionPlegable(
    titulo: String,
    resumen: String,
    icono: androidx.compose.ui.graphics.vector.ImageVector,
    modifier: Modifier = Modifier,
    abiertaInicial: Boolean = false,
    contenido: @Composable () -> Unit,
) {
    val c = Neltume.colores
    var abierta by rememberSaveable(titulo) { mutableStateOf(abiertaInicial) }
    Column(modifier.fillMaxWidth().clip(Radios.xl).background(c.superficie).border(1.dp, c.linea, Radios.xl)) {
        Row(
            Modifier.fillMaxWidth().clickable { abierta = !abierta }.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(34.dp).clip(Radios.md).background(c.verdePalido), contentAlignment = Alignment.Center) {
                Icon(icono, null, tint = c.verde, modifier = Modifier.size(18.dp))
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(titulo, style = MaterialTheme.typography.titleSmall, color = c.tinta)
                Text(resumen, style = MaterialTheme.typography.bodySmall, color = c.apagado, maxLines = 2)
            }
            Icon(if (abierta) Iconos.Arriba else Iconos.Abajo, if (abierta) "Cerrar $titulo" else "Abrir $titulo", tint = c.apagado)
        }
        androidx.compose.animation.AnimatedVisibility(abierta) {
            Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp)) { contenido() }
        }
    }
}

/**
 * Barra fija del total: el total que sube contando (o el parcial con lo pendiente) y la acción principal según el
 * estado: emitir, registrar la aprobación o, en una aprobada, ir al seguimiento.
 */
@Composable
private fun BarraTotal(q: Cotizacion, e: EstadoCotizador, admin: Boolean, editable: Boolean, vm: CotizadorViewModel, acciones: AccionesCotizar, irAPendiente: (Int) -> Unit) {
    val c = Neltume.colores
    val pendientes = q.incompletos.size
    val sinTipo = cl.puertasneltume.cotizador.nucleo.reglas.indicesMedidaSinTipo(q)
    val margen = cl.puertasneltume.cotizador.comun.LocalMargenAvisos.current
    val densidad = androidx.compose.ui.platform.LocalDensity.current
    androidx.compose.runtime.DisposableEffect(Unit) { onDispose { margen.valor = 0.dp } }
    Column(
        Modifier
            .fillMaxWidth()
            .onSizeChanged { margen.valor = with(densidad) { it.height.toDp() } }
            .shadow(10.dp, Radios.hoja.copy(bottomStart = androidx.compose.foundation.shape.CornerSize(0.dp), bottomEnd = androidx.compose.foundation.shape.CornerSize(0.dp)), ambientColor = androidx.compose.ui.graphics.Color(0x22000000))
            .background(c.superficie)
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Rotulo(if (pendientes > 0) "Total parcial" else "Total del pedido")
                TotalAnimado(q.montos.total, estilo = MaterialTheme.typography.headlineMedium)
                if (pendientes > 0) Text(
                    "${plural(pendientes, "pendiente")} sin valorizar ↑",
                    style = MaterialTheme.typography.labelMedium,
                    color = c.pendiente,
                    modifier = Modifier.clickable { irAPendiente(q.incompletos.first().indice) },
                ) else Text("IVA incluido · CLP", style = MaterialTheme.typography.labelSmall, color = c.apagado)
            }
            Spacer(Modifier.width(12.dp))
            when {
                q.estado == EstadoCotizacion.BORRADOR -> {
                    val puede = q.solicitudes.isNotEmpty() && pendientes == 0 && sinTipo.isEmpty()
                    BotonPrincipal(
                        if (sinTipo.isNotEmpty() && pendientes == 0) "Resolver medida" else "Emitir y generar PDF",
                        { if (sinTipo.isNotEmpty() && pendientes == 0) irAPendiente(sinTipo.first()) else vm.emitir(admin) },
                        habilitado = (puede || (sinTipo.isNotEmpty() && pendientes == 0)) && !e.ocupado,
                        cargando = e.enCurso == Operacion.EMITIR,
                        icono = Iconos.Archivo,
                    )
                }
                q.estado == EstadoCotizacion.EMITIDA && !editable -> BotonPrincipal(
                    "Registrar aprobación",
                    vm::aprobar,
                    habilitado = !e.ocupado,
                    cargando = e.enCurso == Operacion.APROBAR,
                    icono = Iconos.Check,
                )
                q.estado == EstadoCotizacion.EMITIDA && editable && q.origen == null -> BotonPrincipal(
                    "Emitir revisión",
                    { vm.emitir(admin) },
                    habilitado = !e.ocupado && pendientes == 0,
                    icono = Iconos.Archivo,
                )
                else -> {}
            }
        }
        val faltan = buildList {
            if (q.estado == EstadoCotizacion.BORRADOR && q.solicitudes.isEmpty()) add("Agrega al menos un producto.")
            if (pendientes > 0) add("Completa o quita ${plural(pendientes, "ítem pendiente", "ítems pendientes")} para emitir.")
            if (sinTipo.isNotEmpty()) add("Indica si la medida es de hoja o de vano en ${plural(sinTipo.size, "puerta")}.")
        }
        if (q.estado == EstadoCotizacion.BORRADOR && faltan.isNotEmpty())
            Text(faltan.joinToString(" "), style = MaterialTheme.typography.labelSmall, color = c.apagado, modifier = Modifier.padding(top = 6.dp))
    }
}


@Composable
fun LineaPasosCotizacion(q: Cotizacion) {
    val a = avancePedido(q)
    LineaPasos(a.hechos, a.actual)
}
