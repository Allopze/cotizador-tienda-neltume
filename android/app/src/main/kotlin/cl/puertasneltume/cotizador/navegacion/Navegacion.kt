package cl.puertasneltume.cotizador.navegacion

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfo
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.NavBackStack
import androidx.navigation3.runtime.NavEntry
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.rememberDecoratedNavEntries
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.window.core.layout.WindowSizeClass
import cl.puertasneltume.cotizador.R
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.Movimiento
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Radios
import cl.puertasneltume.cotizador.diseno.veta
import kotlinx.serialization.Serializable

/** Pantallas de la app. Son claves de Navigation 3: se guardan y se restauran si el sistema cierra la app. */
@Serializable
sealed interface Ruta : NavKey {
    @Serializable data object Cotizar : Ruta
    @Serializable data object Historial : Ruta
    @Serializable data object Papelera : Ruta
    @Serializable data object Clientes : Ruta
    @Serializable data object Catalogo : Ruta
    @Serializable data class CatalogoSeccion(val seccion: String) : Ruta
    @Serializable data object Ajustes : Ruta
    @Serializable data class AjustesSeccion(val seccion: String) : Ruta
    @Serializable data object Ayuda : Ruta
    @Serializable data class Documento(val archivo: String, val titulo: String, val compartible: Boolean) : Ruta
    @Serializable data class Referencia(val archivo: String, val nombre: String, val tipo: String) : Ruta
}

/** Las cinco secciones de la barra, como el menú de la web («Tienda de puertas»). */
enum class Seccion(val titulo: String, val raiz: Ruta) {
    COTIZAR("Cotizar", Ruta.Cotizar),
    HISTORIAL("Historial", Ruta.Historial),
    CLIENTES("Clientes", Ruta.Clientes),
    CATALOGO("Catálogo", Ruta.Catalogo),
    AJUSTES("Ajustes", Ruta.Ajustes),
    ;

    val icono: ImageVector
        get() = when (this) {
            COTIZAR -> Iconos.Cotizar
            HISTORIAL -> Iconos.Historial
            CLIENTES -> Iconos.Clientes
            CATALOGO -> Iconos.Puerta
            AJUSTES -> Iconos.Ajustes
        }
}

/**
 * Estado de navegación: la sección elegida y una pila por sección (al volver a una sección se encuentra como se dejó).
 * «Abrir cotización» desde Historial o Clientes lleva a Cotizar con esa cotización, como `/?cotizacion=` en la web.
 */
@Stable
class Navegador(val pilas: Map<Seccion, NavBackStack<NavKey>>, seccionInicial: Seccion) {
    var seccion by mutableStateOf(seccionInicial)
        private set

    /** Lo que pide abrir el cotizador; lo consume la pantalla Cotizar. */
    var pedidoCotizador by mutableStateOf<PedidoCotizador?>(null)

    val pila: NavBackStack<NavKey> get() = pilas.getValue(seccion)

    fun ir(destino: Seccion) {
        if (destino == seccion) {
            // Tocar la sección activa vuelve a su raíz.
            val p = pila
            while (p.size > 1) p.removeAt(p.lastIndex)
        }
        seccion = destino
    }

    fun empujar(ruta: Ruta) {
        pila.add(ruta)
    }

    /** Vuelve atrás; en la raíz de otra sección, vuelve a Cotizar. Devuelve false si no hay a dónde volver. */
    fun volver(): Boolean {
        val p = pila
        if (p.size > 1) {
            p.removeAt(p.lastIndex)
            return true
        }
        if (seccion != Seccion.COTIZAR) {
            seccion = Seccion.COTIZAR
            return true
        }
        return false
    }

    fun abrirCotizacion(id: String) {
        pedidoCotizador = PedidoCotizador.Abrir(id)
        ir(Seccion.COTIZAR)
        val p = pilas.getValue(Seccion.COTIZAR)
        while (p.size > 1) p.removeAt(p.lastIndex)
    }

    fun nuevaCotizacion() {
        pedidoCotizador = PedidoCotizador.Nueva
        ir(Seccion.COTIZAR)
    }

    /** Catálogo → «Cotizar»: abre Agregar producto con ese código (como `/?agregar=`). */
    fun agregarProducto(codigo: String) {
        pedidoCotizador = PedidoCotizador.Agregar(codigo)
        ir(Seccion.COTIZAR)
    }
}

sealed interface PedidoCotizador {
    data class Abrir(val id: String) : PedidoCotizador
    data object Nueva : PedidoCotizador
    data class Agregar(val codigo: String) : PedidoCotizador
}

/**
 * Entradas que muestra `NavDisplay`: Cotizar (la sección de inicio) y la sección actual, cada pila con su propio
 * guardado de estado y sus ViewModels (receta «multiple back stacks» de Navigation 3). Las pilas que no están a la
 * vista conservan su estado.
 */
@Composable
fun Navegador.entradas(proveedor: (NavKey) -> NavEntry<NavKey>): List<NavEntry<NavKey>> {
    val decoradas = pilas.mapValues { (_, pila) ->
        rememberDecoratedNavEntries(
            backStack = pila,
            entryDecorators = listOf(
                rememberSaveableStateHolderNavEntryDecorator(),
                rememberViewModelStoreNavEntryDecorator(),
            ),
            entryProvider = proveedor,
        )
    }
    val enUso = if (seccion == Seccion.COTIZAR) listOf(Seccion.COTIZAR) else listOf(Seccion.COTIZAR, seccion)
    return enUso.flatMap { decoradas[it].orEmpty() }
}

@Composable
fun rememberNavegador(): Navegador {
    val pilas = mapOf(
        Seccion.COTIZAR to rememberNavBackStack(Ruta.Cotizar),
        Seccion.HISTORIAL to rememberNavBackStack(Ruta.Historial),
        Seccion.CLIENTES to rememberNavBackStack(Ruta.Clientes),
        Seccion.CATALOGO to rememberNavBackStack(Ruta.Catalogo),
        Seccion.AJUSTES to rememberNavBackStack(Ruta.Ajustes),
    )
    var guardada by rememberSaveable { mutableStateOf(Seccion.COTIZAR) }
    val navegador = remember { Navegador(pilas, guardada) }
    guardada = navegador.seccion
    return navegador
}

/** ¿Pantalla ancha (tablet, plegable abierto)? Entonces riel lateral y dos paneles. */
@Composable
fun esAncha(): Boolean = currentWindowAdaptiveInfo().windowSizeClass
    .isWidthAtLeastBreakpoint(WindowSizeClass.WIDTH_DP_EXPANDED_LOWER_BOUND)

/** Estructura: barra inferior en el teléfono (se esconde con el teclado) o riel con veta en pantallas anchas. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun Estructura(navegador: Navegador, contenido: @Composable BoxScope.() -> Unit) {
    val c = Neltume.colores
    if (esAncha()) {
        Row(Modifier.fillMaxSize().background(c.papel)) {
            RielLateral(navegador)
            Box(Modifier.weight(1f).fillMaxHeight()) { contenido() }
        }
    } else {
        Column(Modifier.fillMaxSize().background(c.papel)) {
            Box(Modifier.weight(1f).fillMaxWidth()) { contenido() }
            AnimatedVisibility(!WindowInsets.isImeVisible, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
                BarraInferior(navegador)
            }
        }
    }
}

@Composable
private fun BarraInferior(navegador: Navegador) {
    val c = Neltume.colores
    Column(Modifier.fillMaxWidth().background(c.superficie)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.linea))
        Row(
            Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.navigationBars).height(68.dp).padding(horizontal = 4.dp),
            horizontalArrangement = Arrangement.SpaceAround,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Seccion.entries.forEach { s -> ItemBarra(s, navegador.seccion == s, Modifier.weight(1f)) { navegador.ir(s) } }
        }
    }
}

@Composable
private fun ItemBarra(seccion: Seccion, activa: Boolean, modifier: Modifier, alPulsar: () -> Unit) {
    val c = Neltume.colores
    val fondo by animateColorAsState(if (activa) c.verdeVelo else c.verdeVelo.copy(alpha = 0f), tween(Movimiento.RAPIDO), label = "pildora")
    Column(
        modifier
            .clip(Radios.lg)
            .clickable(onClick = alPulsar)
            .semantics(mergeDescendants = true) {
                role = Role.Tab
                selected = activa
            }
            .padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(Modifier.size(width = 52.dp, height = 30.dp).clip(Radios.pildora).background(fondo), contentAlignment = Alignment.Center) {
            Icon(seccion.icono, null, tint = if (activa) c.verde else c.tintaSuave, modifier = Modifier.size(21.dp))
        }
        Spacer(Modifier.height(3.dp))
        Text(
            seccion.titulo,
            style = MaterialTheme.typography.labelSmall,
            color = if (activa) c.tinta else c.apagado,
            maxLines = 1,
        )
    }
}

@Composable
private fun RielLateral(navegador: Navegador) {
    val c = Neltume.colores
    Column(
        Modifier
            .width(92.dp)
            .fillMaxHeight()
            .veta(c)
            .windowInsetsPadding(WindowInsets.statusBars)
            .windowInsetsPadding(WindowInsets.navigationBars)
            .padding(vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Image(
            painterResource(R.drawable.logo_neltume),
            contentDescription = "Neltume",
            colorFilter = ColorFilter.tint(c.bosqueTinta.copy(alpha = 0.92f)),
            modifier = Modifier.size(36.dp, 41.dp),
        )
        Spacer(Modifier.height(28.dp))
        Seccion.entries.forEach { s ->
            val activa = navegador.seccion == s
            Column(
                Modifier
                    .padding(vertical = 6.dp)
                    .clip(Radios.lg)
                    .clickable { navegador.ir(s) }
                    .semantics(mergeDescendants = true) {
                        role = Role.Tab
                        selected = activa
                        contentDescription = s.titulo
                    }
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(
                    Modifier.size(56.dp, 32.dp).clip(Radios.pildora).background(if (activa) c.bosqueTinta.copy(alpha = 0.14f) else c.bosque.copy(alpha = 0f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(s.icono, null, tint = if (activa) Color.White else c.bosqueTinta.copy(alpha = 0.72f), modifier = Modifier.size(22.dp))
                }
                Spacer(Modifier.height(4.dp))
                Text(s.titulo, style = MaterialTheme.typography.labelSmall, color = if (activa) Color.White else c.bosqueTinta.copy(alpha = 0.72f))
            }
        }
    }
}

