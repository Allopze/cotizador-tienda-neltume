package cl.puertasneltume.cotizador

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation3.runtime.NavEntry
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.ui.NavDisplay
import cl.puertasneltume.cotizador.actualizacion.ControlActualizacion
import cl.puertasneltume.cotizador.ajustes.PantallaAjustes
import cl.puertasneltume.cotizador.ajustes.PantallaSeccionAjustes
import cl.puertasneltume.cotizador.ayuda.PantallaAyuda
import cl.puertasneltume.cotizador.catalogo.PantallaCatalogo
import cl.puertasneltume.cotizador.catalogo.PantallaSeccionCatalogo
import cl.puertasneltume.cotizador.clientes.PantallaClientes
import cl.puertasneltume.cotizador.comun.Avisos
import cl.puertasneltume.cotizador.comun.HostAvisos
import cl.puertasneltume.cotizador.comun.LocalAvisos
import cl.puertasneltume.cotizador.comun.LocalMargenAvisos
import cl.puertasneltume.cotizador.comun.MargenAvisos
import cl.puertasneltume.cotizador.comun.LocalContenedor
import cl.puertasneltume.cotizador.comun.LocalNavegador
import cl.puertasneltume.cotizador.cotizar.CotizadorViewModel
import cl.puertasneltume.cotizador.cotizar.LocalCotizador
import cl.puertasneltume.cotizador.cotizar.PantallaCotizar
import cl.puertasneltume.cotizador.comun.vm
import cl.puertasneltume.cotizador.diseno.Movimiento
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.documentos.PantallaDocumento
import cl.puertasneltume.cotizador.documentos.PantallaReferencia
import cl.puertasneltume.cotizador.historial.PantallaHistorial
import cl.puertasneltume.cotizador.historial.PantallaPapelera
import cl.puertasneltume.cotizador.navegacion.Estructura
import cl.puertasneltume.cotizador.navegacion.Ruta
import cl.puertasneltume.cotizador.navegacion.entradas
import cl.puertasneltume.cotizador.navegacion.rememberNavegador
import cl.puertasneltume.cotizador.sesion.EstadoSesion
import cl.puertasneltume.cotizador.sesion.HojaSesionVencida
import cl.puertasneltume.cotizador.sesion.PantallaIngreso

@Composable
fun RaizApp(contenedor: Contenedor) {
    val estado by contenedor.sesion.estado.collectAsState()
    val correo by contenedor.preferencias.correo.collectAsState("")
    CompositionLocalProvider(LocalContenedor provides contenedor) {
        AnimatedContent(
            targetState = estado,
            contentKey = { it::class },
            transitionSpec = {
                (fadeIn(tween(Movimiento.DIALOGO)) + scaleIn(tween(Movimiento.DIALOGO, easing = Movimiento.salida), initialScale = 0.98f)) togetherWith
                    fadeOut(tween(Movimiento.RAPIDO))
            },
            label = "sesion",
        ) { e ->
            when (e) {
                EstadoSesion.Comprobando -> Box(Modifier.fillMaxSize().background(Neltume.colores.bosque))
                is EstadoSesion.Fuera -> PantallaIngreso(contenedor.sesion, contenedor.api, correo, e.primeraCuenta, e.sinConexion)
                is EstadoSesion.Dentro -> AppPrincipal()
            }
        }
        HojaSesionVencida(contenedor.sesion, correo)
    }
}

@Composable
private fun AppPrincipal() {
    val navegador = rememberNavegador()
    val alcance = rememberCoroutineScope()
    val avisos = remember { Avisos(alcance) }
    val margenAvisos = remember { MargenAvisos() }
    // El cotizador vive con la actividad (no con una pantalla) y es propio de cada cuenta.
    val usuario = LocalContenedor.current.sesion.usuario
    val cotizador = vm(key = "cotizador-${usuario?.id ?: usuario?.email}") { CotizadorViewModel(it) }
    CompositionLocalProvider(LocalNavegador provides navegador, LocalAvisos provides avisos, LocalCotizador provides cotizador, LocalMargenAvisos provides margenAvisos) {
        // Bajo la versión mínima publicada, la app pide actualizarse antes de seguir.
        if (ControlActualizacion()) return@CompositionLocalProvider
        Estructura(navegador) {
            NavDisplay(
                entries = navegador.entradas(proveedor()),
                onBack = { navegador.volver() },
            )
            HostAvisos(avisos, Modifier.align(Alignment.BottomCenter).imePadding().padding(bottom = 8.dp + margenAvisos.valor))
        }
    }
}

private fun proveedor(): (NavKey) -> NavEntry<NavKey> = entryProvider {
    entry<Ruta.Cotizar> { PantallaCotizar() }
    entry<Ruta.Historial> { PantallaHistorial() }
    entry<Ruta.Papelera> { PantallaPapelera() }
    entry<Ruta.Clientes> { PantallaClientes() }
    entry<Ruta.Catalogo> { PantallaCatalogo() }
    entry<Ruta.CatalogoSeccion> { PantallaSeccionCatalogo(it.seccion) }
    entry<Ruta.Ajustes> { PantallaAjustes() }
    entry<Ruta.AjustesSeccion> { PantallaSeccionAjustes(it.seccion) }
    entry<Ruta.Ayuda> { PantallaAyuda() }
    entry<Ruta.Documento> { PantallaDocumento(it.archivo, it.titulo, it.compartible) }
    entry<Ruta.Referencia> { PantallaReferencia(it.archivo, it.nombre, it.tipo) }
}
