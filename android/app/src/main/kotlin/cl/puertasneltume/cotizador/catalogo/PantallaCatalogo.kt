package cl.puertasneltume.cotizador.catalogo

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import cl.puertasneltume.cotizador.comun.LocalContenedor
import cl.puertasneltume.cotizador.comun.LocalNavegador
import cl.puertasneltume.cotizador.comun.MarcoPantalla
import cl.puertasneltume.cotizador.comun.vm
import cl.puertasneltume.cotizador.diseno.Divisor
import cl.puertasneltume.cotizador.diseno.FilaNavegable
import cl.puertasneltume.cotizador.diseno.Hoja
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.TituloPantalla
import cl.puertasneltume.cotizador.navegacion.Ruta
import cl.puertasneltume.cotizador.navegacion.esAncha

/** Secciones del catálogo (src/app/catalogo/secciones.ts), con una línea que dice para qué sirve cada una. */
internal data class SeccionCatalogo(
    val id: String,
    val titulo: String,
    val encabezado: String,
    val detalle: String,
    val icono: ImageVector,
    val soloAdmin: Boolean,
)

internal val SECCIONES_CATALOGO = listOf(
    SeccionCatalogo("consultar", "Consultar", "Consultar el catálogo", "Modelos, maderas y medidas con su precio de venta.", Iconos.Buscar, false),
    SeccionCatalogo("agregar", "Agregar producto", "Agregar un producto", "A mano o describiéndolo al asistente; revisas la propuesta antes de guardarla.", Iconos.Mas, false),
    SeccionCatalogo("importar", "Importar", "Importar catálogo desde Excel", "Sube la planilla, revisa la comparación y confirma.", Iconos.Planilla, true),
    SeccionCatalogo("modelos", "Modelos", "Modelos: duplicar y renombrar", "Crea un modelo copiando uno parecido o renombra uno agregado aquí.", Iconos.Duplicar, true),
    SeccionCatalogo("manuales", "Gestionar catálogo", "Gestionar productos del catálogo", "Corrige o elimina productos y restaura los eliminados.", Iconos.Lapiz, true),
    SeccionCatalogo("configuracion", "Nombres y alias", "Nombres y alias del catálogo", "Otras formas en que los clientes nombran maderas y modelos.", Iconos.Etiqueta, true),
)

/** Las secciones que ve la cuenta: sin administrar, solo Consultar y Agregar (como la web). */
internal fun seccionesVisibles(admin: Boolean) = SECCIONES_CATALOGO.filter { admin || !it.soloAdmin }

/**
 * Catálogo: la consulta (el uso diario) a la vista y, encima, las demás secciones. En una pantalla ancha las
 * secciones van en una columna a la izquierda y la consulta ocupa el resto.
 */
@Composable
fun PantallaCatalogo() {
    val c = Neltume.colores
    val navegador = LocalNavegador.current
    val admin = LocalContenedor.current.sesion.esAdmin
    val consulta = vm { ConsultaViewModel(it) }
    val otras = seccionesVisibles(admin).filter { it.id != "consultar" }
    val abrir: (SeccionCatalogo) -> Unit = { navegador.empujar(Ruta.CatalogoSeccion(it.id)) }
    val cotizar: (String) -> Unit = { navegador.agregarProducto(it) }

    Box(Modifier.fillMaxSize().background(c.papel).windowInsetsPadding(WindowInsets.statusBars)) {
        if (esAncha()) {
            Row(Modifier.fillMaxSize()) {
                Column(
                    Modifier.width(340.dp).fillMaxHeight().verticalScroll(rememberScrollState()).padding(start = 24.dp, end = 8.dp, top = 8.dp, bottom = 24.dp),
                ) {
                    TituloPantalla("Catálogo")
                    Spacer(Modifier.height(16.dp))
                    ListaSecciones(otras, abrir)
                }
                ConMargenLateral { lado ->
                    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 32.dp)) {
                        contenidoConsulta(consulta, lado) { cotizar(it.codigo) }
                    }
                }
            }
        } else {
            ConMargenLateral { lado ->
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 32.dp)) {
                    item(key = "titulo") { TituloPantalla("Catálogo", Modifier.padding(horizontal = lado).padding(top = 8.dp)) }
                    if (otras.isNotEmpty()) item(key = "secciones") {
                        ListaSecciones(otras, abrir, Modifier.padding(horizontal = lado).padding(top = 16.dp))
                    }
                    contenidoConsulta(consulta, lado) { cotizar(it.codigo) }
                }
            }
        }
    }
}

private fun LazyListScope.contenidoConsulta(vm: ConsultaViewModel, lado: Dp, cotizar: (cl.puertasneltume.cotizador.nucleo.modelo.ProductoConsulta) -> Unit) {
    encabezadoConsulta(lado)
    buscadorConsulta(vm, lado)
    resultadosConsulta(vm, lado, cotizar)
}

/** Las otras secciones como filas con ícono, título y una línea de detalle. */
@Composable
private fun ListaSecciones(secciones: List<SeccionCatalogo>, abrir: (SeccionCatalogo) -> Unit, modifier: Modifier = Modifier) {
    Hoja(modifier.fillMaxWidth(), relleno = PaddingValues(vertical = 4.dp, horizontal = 4.dp)) {
        secciones.forEachIndexed { i, s ->
            if (i > 0) Divisor(Modifier.padding(horizontal = 12.dp))
            FilaNavegable(s.titulo, { abrir(s) }, detalle = s.detalle, icono = s.icono)
        }
    }
}

/**
 * Una sección del catálogo con su barra y «Volver». Una sección de administración pedida sin permiso muestra la
 * consulta, como la web.
 */
@Composable
fun PantallaSeccionCatalogo(seccion: String) {
    val navegador = LocalNavegador.current
    val admin = LocalContenedor.current.sesion.esAdmin
    val s = seccionesVisibles(admin).firstOrNull { it.id == seccion } ?: SECCIONES_CATALOGO.first()
    val volver: () -> Unit = { navegador.volver() }
    when (s.id) {
        "agregar" -> SeccionAlta(s, volver)
        "importar" -> SeccionImportar(s, volver)
        "modelos" -> SeccionModelos(s, volver)
        "manuales" -> SeccionGestion(s, volver)
        "configuracion" -> SeccionConfiguracion(s, volver)
        else -> SeccionConsultar(s, volver)
    }
}

/** Consultar como sección propia (enlace directo o sección sin permiso). */
@Composable
private fun SeccionConsultar(s: SeccionCatalogo, volver: () -> Unit) {
    val navegador = LocalNavegador.current
    val consulta = vm { ConsultaViewModel(it) }
    MarcoPantalla(s.titulo, alVolver = volver, subtitulo = "Catálogo") {
        ConMargenLateral { lado ->
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 32.dp), verticalArrangement = Arrangement.Top) {
                contenidoConsulta(consulta, lado) { navegador.agregarProducto(it.codigo) }
            }
        }
    }
}
