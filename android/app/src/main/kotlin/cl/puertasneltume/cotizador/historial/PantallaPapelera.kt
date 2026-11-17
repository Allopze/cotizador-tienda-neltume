package cl.puertasneltume.cotizador.historial

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import cl.puertasneltume.cotizador.comun.LocalAvisos
import cl.puertasneltume.cotizador.comun.LocalContenedor
import cl.puertasneltume.cotizador.comun.LocalNavegador
import cl.puertasneltume.cotizador.comun.MarcoPantalla
import cl.puertasneltume.cotizador.diseno.Aviso
import cl.puertasneltume.cotizador.diseno.BotonSecundario
import cl.puertasneltume.cotizador.diseno.BotonTexto
import cl.puertasneltume.cotizador.diseno.Campo
import cl.puertasneltume.cotizador.diseno.EstadoVacio
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Tarjeta
import cl.puertasneltume.cotizador.diseno.TonoAviso
import cl.puertasneltume.cotizador.nucleo.api.Acciones
import cl.puertasneltume.cotizador.nucleo.api.FalloApi
import cl.puertasneltume.cotizador.nucleo.modelo.BorradorEnPapelera
import cl.puertasneltume.cotizador.nucleo.reglas.Fechas
import cl.puertasneltume.cotizador.nucleo.reglas.SIN_CLIENTE
import cl.puertasneltume.cotizador.nucleo.reglas.nombreProducto
import cl.puertasneltume.cotizador.nucleo.reglas.pesos
import cl.puertasneltume.cotizador.nucleo.reglas.plural
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Papelera: borradores eliminados, con búsqueda en el servidor; se restauran tal como estaban. */
@Composable
fun PantallaPapelera() {
    val c = Neltume.colores
    val api = LocalContenedor.current.api
    val navegador = LocalNavegador.current
    val avisos = LocalAvisos.current
    val alcance = rememberCoroutineScope()
    var q by remember { mutableStateOf("") }
    var pagina by remember { mutableIntStateOf(1) }
    var items by remember { mutableStateOf<List<BorradorEnPapelera>?>(null) }
    var total by remember { mutableIntStateOf(0) }
    var plazo by remember { mutableIntStateOf(30) }
    var error by remember { mutableStateOf<String?>(null) }
    var restaurando by remember { mutableStateOf<String?>(null) }
    var recarga by remember { mutableIntStateOf(0) }
    LaunchedEffect(q, pagina, recarga) {
        delay(300)
        try {
            val d = api.papelera(q, pagina)
            items = if (pagina == 1) d.borradores else items.orEmpty() + d.borradores
            total = d.total
            plazo = d.plazoDias
            error = null
        } catch (e: FalloApi) {
            error = e.message
        }
    }
    fun restaurar(r: BorradorEnPapelera) = alcance.launch {
        restaurando = r.id
        try {
            api.accion(Acciones.simple("restaurar_borrador", r.id, r.actualizada))
            items = items?.filter { it.id != r.id }
            total--
            avisos.mostrar("Borrador restaurado.", "Abrirlo") { navegador.abrirCotizacion(r.id) }
        } catch (e: FalloApi) {
            avisos.mostrar(e.message ?: "", largo = true)
            if (e.status == 409) recarga++
        } finally {
            restaurando = null
        }
    }
    MarcoPantalla("Papelera", alVolver = { navegador.volver() }, subtitulo = plural(total, "borrador", "borradores")) {
        Column(Modifier.fillMaxSize()) {
            Column(Modifier.padding(horizontal = 16.dp)) {
                Text(
                    "Los borradores eliminados quedan aquí $plazo días y después se borran. Al restaurar uno vuelve con su conversación, sus ítems y su actividad.",
                    style = MaterialTheme.typography.bodySmall,
                    color = c.apagado,
                )
                Campo(q, { q = it; pagina = 1 }, "Buscar cliente o producto", Modifier.padding(vertical = 10.dp), icono = Iconos.Buscar)
                error?.let { Aviso(it, tono = TonoAviso.PELIGRO) }
            }
            when {
                items == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = c.verde) }
                items!!.isEmpty() -> EstadoVacio(Iconos.Basura, "La papelera está vacía", "Aquí quedan los borradores eliminados, para restaurarlos si hace falta.")
                else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(items!!, key = { it.id }) { r ->
                        Tarjeta(null) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(r.cliente.nombre?.takeIf { it.isNotBlank() } ?: SIN_CLIENTE, style = MaterialTheme.typography.titleSmall, color = c.tinta, modifier = Modifier.weight(1f))
                                Text(pesos(r.total), style = MaterialTheme.typography.titleSmall, color = c.tinta)
                            }
                            r.origen?.let { Text("Revisión de N° $it", style = MaterialTheme.typography.labelMedium, color = c.calidoTexto) }
                            Text(
                                listOfNotNull(r.cliente.comuna?.takeIf { it.isNotBlank() } ?: "Sin comuna", r.cliente.proyecto?.takeIf { it.isNotBlank() }).joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall,
                                color = c.apagado,
                            )
                            if (r.productos.isNotBlank()) Text(nombreProducto(r.productos), style = MaterialTheme.typography.bodySmall, color = c.apagado, maxLines = 2)
                            Text(
                                listOfNotNull(
                                    "Eliminado ${Fechas.corta(r.eliminada.ifEmpty { r.actualizada })}",
                                    plural(r.items, "ítem"),
                                    r.creada.takeIf { it.isNotBlank() }?.let { "Creado ${Fechas.corta(it)}" + (r.creadaPor?.let { p -> " por $p" } ?: "") },
                                ).joinToString(" · "),
                                style = MaterialTheme.typography.labelSmall,
                                color = c.apagado,
                            )
                            BotonSecundario("Restaurar", { restaurar(r) }, Modifier.padding(top = 8.dp), icono = Iconos.Restaurar, cargando = restaurando == r.id)
                        }
                    }
                    if (items!!.size < total) item { BotonTexto("Cargar más", { pagina++ }, Modifier.fillMaxWidth()) }
                }
            }
        }
    }
}
