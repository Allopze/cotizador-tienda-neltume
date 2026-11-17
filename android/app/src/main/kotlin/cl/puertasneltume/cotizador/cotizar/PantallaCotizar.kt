package cl.puertasneltume.cotizador.cotizar

import android.view.accessibility.AccessibilityEvent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import cl.puertasneltume.cotizador.comun.LocalAvisos
import cl.puertasneltume.cotizador.comun.LocalContenedor
import cl.puertasneltume.cotizador.comun.LocalNavegador
import cl.puertasneltume.cotizador.comun.copiar
import cl.puertasneltume.cotizador.diseno.BotonIcono
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.Movimiento
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.PildoraEstado
import cl.puertasneltume.cotizador.diseno.Radios
import cl.puertasneltume.cotizador.navegacion.PedidoCotizador
import cl.puertasneltume.cotizador.navegacion.Ruta
import cl.puertasneltume.cotizador.navegacion.esAncha
import cl.puertasneltume.cotizador.nucleo.modelo.EstadoCotizacion
import cl.puertasneltume.cotizador.nucleo.reglas.Anulable
import cl.puertasneltume.cotizador.nucleo.reglas.numeroCotizacion
import cl.puertasneltume.cotizador.nucleo.reglas.pesos
import cl.puertasneltume.cotizador.nucleo.reglas.plural
import cl.puertasneltume.cotizador.nucleo.reglas.puedeAnular
import cl.puertasneltume.cotizador.nucleo.reglas.resumenTexto
import cl.puertasneltume.cotizador.nucleo.reglas.vencida
import kotlinx.coroutines.launch

/** Cotizar: el pedido por chat y la cotización, en dos páginas deslizables (teléfono) o lado a lado (tablet). */
@Composable
fun PantallaCotizar() {
    val vm = LocalCotizador.current
    val e by vm.estado.collectAsStateWithLifecycle()
    val navegador = LocalNavegador.current
    val avisos = LocalAvisos.current
    val contenedor = LocalContenedor.current
    val admin = contenedor.sesion.esAdmin
    val alcance = rememberCoroutineScope()
    val vista = LocalView.current
    val portapapeles = LocalClipboard.current
    val contexto = LocalContext.current
    val paginas = rememberPagerState(initialPage = 0) { 2 }
    var agregando by rememberSaveable { mutableStateOf<String?>(null) }

    // Lo que pidieron otras pantallas: abrir una cotización, empezar una nueva o agregar un producto.
    LaunchedEffect(navegador.pedidoCotizador) {
        when (val p = navegador.pedidoCotizador) {
            is PedidoCotizador.Abrir -> vm.abrir(p.id)
            PedidoCotizador.Nueva -> vm.nueva()
            is PedidoCotizador.Agregar -> agregando = p.codigo
            null -> {}
        }
        navegador.pedidoCotizador = null
    }
    // Al volver a la app se relee la cotización: otra persona pudo cambiarla.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { vm.recargar() }
    LaunchedEffect(Unit) {
        vm.efecto.collect { ef ->
            when (ef) {
                is Efecto.Aviso -> avisos.mostrar(ef.texto, ef.accion, ef.largo, ef.alAccion)
                Efecto.MostrarCotizacion -> paginas.animateScrollToPage(1)
                Efecto.MostrarPedido -> paginas.animateScrollToPage(0)
                is Efecto.Documento -> avisos.mostrar(
                    "PDF listo. ${ef.detalle ?: "También queda en Documentos, más abajo en la cotización."}",
                    "Ver PDF",
                    largo = true,
                ) { navegador.empujar(Ruta.Documento(ef.archivo, tituloDocumento(ef.archivo), ef.archivo.startsWith("cotizacion"))) }
                is Efecto.Anuncio -> vista.announceForAccessibility(ef.texto)
                is Efecto.IrAlFinal -> {}
            }
        }
    }

    val q = e.cotizacion
    val aprobada = q?.estado == EstadoCotizacion.APROBADA
    val ancha = esAncha()
    val acciones = AccionesCotizar(
        nueva = { vm.nueva() },
        duplicar = { vm.duplicar() },
        copiar = { q?.let { alcance.launch { copiar(portapapeles, contexto, resumenTexto(it)); avisos.mostrar("Resumen copiado al portapapeles.") } } },
        eliminar = { vm.eliminar() },
        anular = { vm.anular() },
        agregarProducto = { agregando = "" },
        verDocumento = { archivo -> navegador.empujar(Ruta.Documento(archivo, tituloDocumento(archivo), archivo.startsWith("cotizacion"))) },
        ayuda = { navegador.empujar(Ruta.Ayuda) },
    )

    Column(Modifier.fillMaxSize().background(Neltume.colores.papel)) {
        BarraCotizar(e, admin, acciones, mostrarTotal = !ancha && paginas.currentPage == 0) {
            alcance.launch { paginas.animateScrollToPage(1) }
        }
        if (ancha) {
            Row(Modifier.fillMaxSize()) {
                Box(Modifier.weight(0.42f).fillMaxHeight()) { PanelChat(vm, e, acciones) }
                Box(Modifier.width(1.dp).fillMaxHeight().background(Neltume.colores.linea))
                Box(Modifier.weight(0.58f).fillMaxHeight()) { PanelCotizacion(vm, e, admin, acciones) }
            }
        } else {
            SelectorVista(
                pagina = paginas.currentPage,
                primera = if (aprobada) "Conversación" else "Pedido",
                segunda = when {
                    aprobada -> "Seguimiento"
                    q != null && q.incompletos.isNotEmpty() -> "Cotización (${plural(q.incompletos.size, "pendiente")})"
                    else -> "Cotización"
                },
            ) { alcance.launch { paginas.animateScrollToPage(it) } }
            HorizontalPager(paginas, Modifier.fillMaxSize(), beyondViewportPageCount = 1, key = { it }) { pagina ->
                if (pagina == 0) PanelChat(vm, e, acciones) else PanelCotizacion(vm, e, admin, acciones)
            }
        }
    }
    AgregarProducto(
        visible = agregando != null,
        codigoInicial = agregando?.ifEmpty { null },
        vm = vm,
        alCerrar = { agregando = null },
    )
    DialogosCotizador(vm, e, admin)
}

/** Acciones que comparten la barra, el chat y el panel. */
class AccionesCotizar(
    val nueva: () -> Unit,
    val duplicar: () -> Unit,
    val copiar: () -> Unit,
    val eliminar: () -> Unit,
    val anular: () -> Unit,
    val agregarProducto: () -> Unit,
    val verDocumento: (String) -> Unit,
    val ayuda: () -> Unit,
)

fun tituloDocumento(archivo: String): String {
    val numero = Regex("""-(\d+)(?:-\d+)?\.pdf$""").find(archivo)?.groupValues?.get(1) ?: ""
    return when {
        archivo.startsWith("cotizacion") -> "Cotización N° $numero"
        "panguipulli" in archivo -> "Nota de pedido N° $numero · Panguipulli"
        "santiago" in archivo -> "Nota de pedido N° $numero · Santiago"
        else -> "Nota de pedido N° $numero"
    }
}

@Composable
private fun BarraCotizar(e: EstadoCotizador, admin: Boolean, acciones: AccionesCotizar, mostrarTotal: Boolean, irATotal: () -> Unit) {
    val c = Neltume.colores
    val q = e.cotizacion
    var menu by remember { mutableStateOf(false) }
    Row(
        Modifier
            .fillMaxWidth()
            .windowInsetsPadding(WindowInsets.statusBars)
            .height(60.dp)
            .padding(start = 16.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (q == null) "Nueva cotización" else numeroCotizacion(q.numero),
                    style = MaterialTheme.typography.titleLarge,
                    color = c.tinta,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (q != null) {
                    Spacer(Modifier.width(8.dp))
                    PildoraEstado(q.estado, vencida = vencida(q))
                }
            }
            if (q?.cliente?.nombre != null)
                Text(q.cliente.nombre!!, style = MaterialTheme.typography.labelSmall, color = c.apagado, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        // En la página del pedido, el total va arriba: tocarlo lleva a la cotización.
        AnimatedVisibility(mostrarTotal && q != null && q.montos.lineas.isNotEmpty(), enter = fadeIn(), exit = fadeOut()) {
            Box(
                Modifier
                    .clip(Radios.pildora)
                    .background(c.verdeVelo)
                    .clickable(onClick = irATotal)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            ) {
                Text(pesos(q?.montos?.total ?: 0), style = MaterialTheme.typography.labelLarge, color = c.verde)
            }
        }
        BotonIcono(Iconos.Mas, "Nueva cotización", acciones.nueva, habilitado = !e.ocupado && (q != null || e.charla.isNotEmpty()))
        Box {
            BotonIcono(Iconos.MasOpciones, "Más acciones", { menu = true }, habilitado = q != null)
            DropdownMenu(menu, { menu = false }, shape = Radios.lg, containerColor = c.superficie) {
                if (q != null) {
                    ItemMenu("Duplicar", Iconos.Duplicar) { menu = false; acciones.duplicar() }
                    ItemMenu("Copiar resumen", Iconos.Copiar) { menu = false; acciones.copiar() }
                    if (q.estado == EstadoCotizacion.BORRADOR && q.numero == null)
                        ItemMenu("Eliminar borrador", Iconos.Basura, peligro = true) { menu = false; acciones.eliminar() }
                    when (val r = puedeAnular(q)) {
                        is Anulable.Si -> ItemMenu("Anular", Iconos.Prohibido, peligro = true) { menu = false; acciones.anular() }
                        is Anulable.No -> if (q.estado != EstadoCotizacion.BORRADOR)
                            DropdownMenuItem(
                                text = { Column { Text("Anular", color = c.apagado); Text(r.motivo, style = MaterialTheme.typography.labelSmall, color = c.apagado) } },
                                onClick = {},
                                enabled = false,
                                leadingIcon = { Icon(Iconos.Prohibido, null, tint = c.apagado) },
                            )
                    }
                    ItemMenu("Cómo funciona", Iconos.Ayuda) { menu = false; acciones.ayuda() }
                }
            }
        }
    }
}

@Composable
fun ItemMenu(texto: String, icono: androidx.compose.ui.graphics.vector.ImageVector, peligro: Boolean = false, alPulsar: () -> Unit) {
    val c = Neltume.colores
    DropdownMenuItem(
        text = { Text(texto, color = if (peligro) c.peligro else c.tinta) },
        onClick = alPulsar,
        leadingIcon = { Icon(icono, null, tint = if (peligro) c.peligro else c.tintaSuave) },
    )
}

/** «Pedido | Cotización»: dos pestañas que mueven las páginas (también se deslizan con el dedo). */
@Composable
private fun SelectorVista(pagina: Int, primera: String, segunda: String, alElegir: (Int) -> Unit) {
    val c = Neltume.colores
    Row(
        Modifier
            .padding(horizontal = 16.dp)
            .padding(bottom = 8.dp)
            .fillMaxWidth()
            .clip(Radios.lg)
            .background(c.tonal)
            .padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        listOf(primera, segunda).forEachIndexed { i, texto ->
            val activa = pagina == i
            val fondo by animateColorAsState(if (activa) c.superficie else c.tonal, tween(Movimiento.RAPIDO), label = "pestana")
            Box(
                Modifier
                    .weight(1f)
                    .height(40.dp)
                    .clip(Radios.md)
                    .background(fondo)
                    .clickable { alElegir(i) }
                    .semantics {
                        role = Role.Tab
                        selected = activa
                    },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    texto,
                    style = MaterialTheme.typography.labelLarge,
                    color = if (activa) c.tinta else c.apagado,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(horizontal = 8.dp),
                )
            }
        }
    }
}
