package cl.puertasneltume.cotizador.ayuda

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import cl.puertasneltume.cotizador.comun.LocalNavegador
import cl.puertasneltume.cotizador.comun.MarcoPantalla
import cl.puertasneltume.cotizador.diseno.Aviso
import cl.puertasneltume.cotizador.diseno.ColoresNeltume
import cl.puertasneltume.cotizador.diseno.Divisor
import cl.puertasneltume.cotizador.diseno.Hoja
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.PildoraEstado
import cl.puertasneltume.cotizador.diseno.Radios
import cl.puertasneltume.cotizador.diseno.ReglaCarpintero
import cl.puertasneltume.cotizador.diseno.Rotulo
import cl.puertasneltume.cotizador.diseno.TonoAviso
import cl.puertasneltume.cotizador.navegacion.Navegador
import cl.puertasneltume.cotizador.navegacion.Ruta
import cl.puertasneltume.cotizador.navegacion.Seccion
import cl.puertasneltume.cotizador.nucleo.modelo.EstadoCotizacion
import cl.puertasneltume.cotizador.nucleo.reglas.Limites
import kotlinx.coroutines.launch

// Guía «Cómo funciona» (src/app/ayuda/page.tsx): el ciclo de una cotización con los nombres de los botones tal como se
// ven, qué significa cada estado, cómo deshacer y a quién pedir ayuda. Texto fijo: si cambia un botón o una regla en la
// web, se cambia aquí también. Marcas del texto: **negrita**, _cursiva_ y [enlace](destino).

/** Días que un borrador eliminado queda en la papelera (`DIAS_PAPELERA` de src/servidor/almacen.ts). */
private const val DIAS_PAPELERA = 30

private val PASOS = listOf(
    "**Escribe el pedido o agrega productos.** En [Cotizar](cotizar), cuenta en el chat lo que pide el cliente: modelo, madera, medidas, cantidad y, si los tienes, sus datos. Por ejemplo: «3 Huilo Huilo en oregón de 80 × 2,10 para Juan Pérez, Temuco». También puedes elegirlos del catálogo con «Agregar producto» (en el teléfono, «+ Producto»). La cotización se arma al lado; en el teléfono, en la pestaña «Cotización».",
    "**Revisa y completa lo pendiente.** Un producto marcado «Incompleto · no suma al total» necesita un dato, por ejemplo la medida o la madera. Respóndelo en el chat o directamente en el detalle. Si una medida no dice si es de _hoja_ (la puerta misma) o de _vano_ (el hueco del muro donde va instalada), el cotizador te lo pregunta.",
    "**Emite la cotización.** Con todo completo, pulsa «Emitir y generar PDF». Recibe su número (N°) y el PDF para el cliente, que puedes descargar o, en el teléfono, compartir.",
    "**Registra la aprobación cuando el cliente acepta.** Pulsa «Registrar aprobación del cliente». Desde ahí la cotización ya no se edita y aparece el «Seguimiento del pedido». Si el cliente ya sabe si quiere **Boleta** o **Factura**, puedes elegirlo ahí (con los datos a quien facturar) o dejarlo en «Aún no sabe» para completarlo después.",
    "**Registra el anticipo.** En el seguimiento, escribe lo que pagó el cliente en «Monto recibido» y pulsa «Registrar pago». Con al menos el ${Limites.ANTICIPO_TEXTO} pagado se habilita la nota de pedido.",
    "**Genera la nota de pedido para fábrica.** «Generar notas de pedido» pide la fábrica de cada ítem (no hay una por omisión: la eliges tú) y genera una nota por fábrica, solo con sus ítems y con el siguiente número de esa fábrica. El reparto se puede preparar antes con «Repartir entre fábricas» o pidiéndoselo al asistente («las Coz Coz van a Santiago»).",
    "**Producción.** Pulsa «Iniciar producción» cuando el pedido entra a fábrica y «Marcar producción terminada» cuando fábrica lo termina. Con notas para las dos fábricas, cada una se marca por separado y el pedido sigue a despacho cuando terminan todas.",
    "**Despacho.** Con el total pagado, pulsa «Marcar lista para despacho», indica el transportista en «Despacho» y registra la salida con «Registrar despacho». Al cerrar, «Completar operación».",
    "**Facturación.** En «Facturación» indica si pide boleta o factura; si pide **Factura**, guarda los datos del receptor (razón social, RUT, giro, dirección y opcionales comuna y correo) y usa «Copiar datos para facturar» para llevarlos con un clic a tu facturador externo. **El cotizador no emite documentos tributarios ni se conecta con el SII:** una vez emitida afuera, anota el documento, su número y fecha, y pulsa «Marcar como facturada».",
)

private val ESTADOS = listOf(
    Triple(EstadoCotizacion.BORRADOR, false, "En preparación: todavía no se envía al cliente y puedes cambiar todo. Recibe su número al emitirla."),
    Triple(
        EstadoCotizacion.EMITIDA,
        false,
        "Tiene número y PDF para el cliente. Si la cambias, se crea una _revisión_: una versión nueva en borrador que la reemplazará cuando la emitas. El PDF ya enviado no se toca.",
    ),
    Triple(EstadoCotizacion.EMITIDA, true, "Aparece junto a «Emitida» cuando pasó la vigencia. Todavía se puede aprobar, pero se pide confirmar."),
    Triple(
        EstadoCotizacion.APROBADA,
        false,
        "El cliente aceptó. Ya no se edita: desde aquí se registran pagos, nota de pedido, producción, despacho y facturación.",
    ),
    Triple(
        EstadoCotizacion.REEMPLAZADA,
        false,
        "Se emitió una revisión que la reemplaza. Queda guardada para consultarla, pero ya no se puede aprobar ni editar.",
    ),
    Triple(
        EstadoCotizacion.ANULADA,
        false,
        "Quedó sin efecto, por ejemplo porque el cliente la rechazó. Su número no se vuelve a usar. Puedes duplicarla para preparar una nueva.",
    ),
)

private val LINEAS = listOf(
    "**Varias puertas iguales en líneas separadas:** agrégalas una por una, o pídeselo al asistente («4 Ranco pino oregón: 0,85, 1,00, 0,85 y 1,00, todas de 2,20»). Cada línea es independiente: cambiar una no toca las otras.",
    "**Una copia para modificar:** el botón de copiar en la fila de un producto la duplica justo debajo, con su precio, descuento, observaciones y fotos, y abre la copia para que cambies lo que la hace distinta. Al asistente: «duplica la Ranco y que la copia sea vidriada».",
    "**Una puerta con algo que el catálogo no tiene** (vidrio, otro espesor): en «Editar detalles», «Convertir en producto especial». Conserva el precio de partida y después puedes cambiar el nombre, la descripción o el precio sin que la línea quede pendiente.",
    "**Algo que no está en el catálogo:** «Agregar producto» → «Crear producto especial». Queda solo en esta cotización; el catálogo no cambia. Si lo fabrica Neltume, elige su tipo de producto y va a la nota de pedido. Si es otro cargo (instalación, flete local), elige «Otro cargo»: no va a fábrica.",
    "**Varios productos seguidos a mano:** en «Agregar producto», «Agregar y seguir» te deja en la búsqueda para elegir el siguiente sin cerrar la ventana.",
)

private val CATALOGO = listOf(
    "**Cada producto del catálogo es una combinación:** un modelo (Ranco), en una madera (Pino Oregón), para un rango de anchos (0,80 a 0,85 m) y un alto (2,10 m). Por eso un modelo tiene muchas filas: una por cada madera y medida, cada una con su costo.",
    "**El precio de venta** es el costo de fábrica más la ganancia de su categoría (por ejemplo, «Puertas sólidas Pino Oregón»). La categoría la deciden el tipo de producto y la madera. Al crear un producto, la revisión muestra el precio de venta exacto antes de guardar.",
    "**Buscar:** escribe como lo dice el cliente: «willow mara 82 210», «ranco 1 metro». El buscador entiende los mismos nombres que el asistente y, con muchos resultados, primero muestra los modelos para que elijas uno. En Catálogo → Consultar, «Cotizar» lo lleva directo a la cotización.",
    "**Crear un producto en el catálogo** (Catálogo → Agregar producto) lo deja disponible para todas las cotizaciones. Después de guardar, «Agregar otra medida o madera» conserva el modelo y la madera para cargar la siguiente medida. Si es algo para un solo cliente, usa un producto especial en la cotización.",
    "**No hace falta crear tipos de producto:** son fijos (puerta, marco, pieza T, moldura) y deciden cómo se mide cada producto: ancho × alto en las puertas, sección × largo en los accesorios.",
)

private val PALABRAS = listOf(
    "Tipo de producto" to "Puerta, marco, pieza T o moldura. Antes se llamaba «familia».",
    "Modelo" to "El nombre de la puerta o accesorio: Ranco, Huilo Huilo, Marco.",
    "Estilo" to "Dato informativo del producto (panel, bloque). «Puerta especial» en la planilla son las de 1,10 m o más de ancho.",
    "Costo de fábrica" to "Lo que cobra la fábrica, sin IVA y sin ganancia. Es lo que se escribe al crear un producto.",
    "Precio de venta" to "Lo que paga el cliente sin IVA: costo de fábrica más la ganancia de su categoría.",
    "Producto especial" to "Algo que no está en el catálogo, cotizado solo en esta cotización con el precio que escribes.",
    "Otro cargo (ítem libre)" to "Lo que no es carpintería: instalación, flete local, un servicio. No va a fábrica.",
    "Hoja / vano" to "Hoja es la puerta misma; vano, el hueco del muro donde va instalada.",
    "Sección (escuadría)" to "Grosor por ancho de un marco o moldura, por ejemplo 2 × 4 pulgadas.",
    "Nota de pedido" to "El documento que va a cada fábrica con lo que tiene que hacer, a precio de fábrica.",
)

private val DESHACER = listOf(
    "**Un cambio en la cotización:** «Deshacer» en el detalle de la cotización (o Ctrl/⌘ + Z) revierte los últimos cambios mientras sigas en esa cotización: productos, datos del cliente, descuento, flete, ganancia y observaciones. El despacho se corrige escribiéndolo de nuevo.",
    "**Un borrador eliminado:** en [Historial](historial), filtro «Papelera», pulsa «Restaurar». Los borradores eliminados se guardan $DIAS_PAPELERA días en la papelera; después se borran para siempre y ya no se pueden restaurar.",
    "**Una aprobación registrada por error:** «Deshacer aprobación» en el seguimiento, mientras no haya pagos, nota de pedido ni factura.",
    "**Un paso de la operación marcado por error:** «Volver al paso anterior», bajo «Siguiente acción». Te pide anotar el motivo. En fábrica deshace el último inicio o término registrado, en la fábrica donde se marcó.",
    "**Un número de cotización o de nota de pedido equivocado:** «Cambiar N°» junto a su PDF (solo cuentas administradoras), o pídeselo al asistente («la nota de Santiago debe ser la 61»). El número debe estar libre; el PDF se vuelve a generar con el número nuevo y el cambio queda en la actividad.",
    "**Un pago mal anotado:** «Anular» junto al pago, hasta que el pedido quede listo para despacho.",
    "**Una factura marcada por error:** «Volver a pendiente» (también permite corregir boleta, factura o los datos del receptor mientras sigue pendiente).",
    "**Una cotización que ya no va:** «Más acciones» → «Anular». Esto no se deshace.",
)

private val CONTACTO = listOf(
    "Si algo no funciona, un mensaje no se entiende o un precio no calza, no lo fuerces: anota el N° de la cotización y lo que estabas haciendo, y avísale a quien administra el cotizador en Neltume.",
    "Si un PDF no abre, una cuenta administradora puede regenerarlo con los mismos datos con que se emitió.",
    "¿Olvidaste tu contraseña? Otra cuenta administradora la restablece en Ajustes → Usuarios. Para cambiarla tú: [Ajustes → Mi cuenta](cuenta).",
    "Lo que está en «Avanzado» dentro de Ajustes (asistente, IVA, ganancia por categoría) cambia el cotizador para todas las cuentas: no lo toques sin consultarlo.",
)

/** Secciones de la guía, en orden; el índice lleva a cada una. */
private val INDICE = listOf(
    "Los pasos de una cotización",
    "Qué significa cada estado",
    "Líneas repetidas, copias y productos especiales",
    "El catálogo en 5 minutos",
    "Qué significa cada palabra",
    "Cómo deshacer",
    "A quién pedir ayuda",
)

/** Texto con **negrita**, _cursiva_ y [enlaces](destino) que llevan a otra sección de la app. */
private fun rico(texto: String, c: ColoresNeltume, ir: (String) -> Unit): AnnotatedString = buildAnnotatedString {
    var i = 0
    while (i < texto.length) {
        when {
            texto.startsWith("**", i) && texto.indexOf("**", i + 2) > 0 -> {
                val fin = texto.indexOf("**", i + 2)
                withStyle(SpanStyle(fontWeight = FontWeight.W600, color = c.tinta)) { append(texto.substring(i + 2, fin)) }
                i = fin + 2
            }
            texto[i] == '_' && texto.indexOf('_', i + 1) > 0 -> {
                val fin = texto.indexOf('_', i + 1)
                withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(texto.substring(i + 1, fin)) }
                i = fin + 1
            }
            texto[i] == '[' && texto.indexOf("](", i) > 0 -> {
                val medio = texto.indexOf("](", i)
                val fin = texto.indexOf(')', medio)
                val destino = texto.substring(medio + 2, fin)
                val estilo = TextLinkStyles(SpanStyle(color = c.verde, fontWeight = FontWeight.W600, textDecoration = TextDecoration.Underline))
                withLink(LinkAnnotation.Clickable(destino, estilo) { ir(destino) }) { append(texto.substring(i + 1, medio)) }
                i = fin + 1
            }
            else -> {
                append(texto[i])
                i++
            }
        }
    }
}

/** Destinos de los enlaces de la guía, como los `<Link>` de la web. */
private fun irA(navegador: Navegador, destino: String) {
    when (destino) {
        "cotizar" -> navegador.ir(Seccion.COTIZAR)
        "historial" -> navegador.ir(Seccion.HISTORIAL)
        "cuenta" -> {
            navegador.ir(Seccion.AJUSTES)
            navegador.empujar(Ruta.AjustesSeccion("cuenta"))
        }
    }
}

/** «Cómo funciona»: la guía para quien cotiza, para leer cómodamente en el teléfono. */
@Composable
fun PantallaAyuda() {
    val c = Neltume.colores
    val navegador = LocalNavegador.current
    val lista = rememberLazyListState()
    val alcance = rememberCoroutineScope()
    val ir: (String) -> Unit = { irA(navegador, it) }
    // Posición en la lista de cada sección: el ítem 0 es la introducción con el índice.
    fun saltar(seccion: Int) = alcance.launch { lista.animateScrollToItem(seccion + 1) }

    MarcoPantalla("Cómo funciona", alVolver = { navegador.volver() }) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
            LazyColumn(
                Modifier.widthIn(max = 680.dp).fillMaxWidth(),
                state = lista,
                contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 2.dp, bottom = 40.dp),
                verticalArrangement = Arrangement.spacedBy(28.dp),
            ) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        ReglaCarpintero()
                        Text(
                            "Una cotización avanza paso a paso, desde el pedido del cliente hasta la factura. En cada momento, el botón principal de la cotización muestra lo que toca hacer ahora.",
                            style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.W400),
                            color = c.tinta,
                        )
                        Hoja(relleno = PaddingValues(vertical = 8.dp, horizontal = 6.dp)) {
                            Rotulo("En esta página", Modifier.padding(start = 10.dp, top = 4.dp, bottom = 4.dp))
                            INDICE.forEachIndexed { i, titulo ->
                                if (i > 0) Divisor(Modifier.padding(horizontal = 10.dp))
                                Row(
                                    Modifier
                                        .fillMaxWidth()
                                        .heightIn(min = 48.dp)
                                        .clip(Radios.md)
                                        .clickable(onClickLabel = "Ir a la sección") { saltar(i) }
                                        .semantics(mergeDescendants = true) { role = Role.Button }
                                        .padding(horizontal = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text("${i + 1}", style = MaterialTheme.typography.labelLarge, color = c.calidoTexto, modifier = Modifier.width(24.dp))
                                    Text(titulo, style = MaterialTheme.typography.bodyMedium, color = c.tinta, modifier = Modifier.weight(1f))
                                    Icon(Iconos.Abajo, null, tint = c.apagado, modifier = Modifier.size(16.dp))
                                }
                            }
                        }
                    }
                }

                item {
                    SeccionGuia(INDICE[0]) {
                        PASOS.forEachIndexed { i, paso -> Paso(i + 1, rico(paso, c, ir)) }
                        Aviso("En el seguimiento, el recuadro «Siguiente acción» dice siempre qué falta y trae el botón para hacerlo.", tono = TonoAviso.INFO)
                    }
                }

                item {
                    SeccionGuia(INDICE[1]) {
                        ESTADOS.forEach { (estado, vencida, texto) ->
                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                PildoraEstado(estado, vencida = vencida)
                                Text(rico(texto, c, ir), style = MaterialTheme.typography.bodyLarge, color = c.tintaSuave)
                            }
                        }
                    }
                }

                item { SeccionGuia(INDICE[2]) { LINEAS.forEach { Vineta(rico(it, c, ir)) } } }

                item { SeccionGuia(INDICE[3]) { CATALOGO.forEach { Vineta(rico(it, c, ir)) } } }

                item {
                    SeccionGuia(INDICE[4]) {
                        PALABRAS.forEach { (palabra, definicion) ->
                            Column(Modifier.semantics(mergeDescendants = true) {}) {
                                Text(palabra, style = MaterialTheme.typography.titleMedium, color = c.tinta)
                                Text(definicion, style = MaterialTheme.typography.bodyLarge, color = c.tintaSuave)
                            }
                        }
                    }
                }

                item { SeccionGuia(INDICE[5]) { DESHACER.forEach { Vineta(rico(it, c, ir)) } } }

                item { SeccionGuia(INDICE[6]) { CONTACTO.forEach { Vineta(rico(it, c, ir)) } } }

                item {
                    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("NELTUME / Hecho en madera.", style = MaterialTheme.typography.labelSmall, color = c.apagado)
                        Text("Asistente de cotizaciones · Uso interno", style = MaterialTheme.typography.labelSmall, color = c.apagado)
                    }
                }
            }
        }
    }
}

/** Sección de la guía: título en serif con su regla de carpintero. */
@Composable
private fun SeccionGuia(titulo: String, contenido: @Composable () -> Unit) {
    val c = Neltume.colores
    Column {
        Text(titulo, style = MaterialTheme.typography.headlineSmall, color = c.tinta, modifier = Modifier.semantics { heading() })
        Spacer(Modifier.height(10.dp))
        ReglaCarpintero()
        Spacer(Modifier.height(16.dp))
        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) { contenido() }
    }
}

/** Un paso numerado: el número en un círculo verde y el texto con su acción en negrita. */
@Composable
private fun Paso(numero: Int, texto: AnnotatedString) {
    val c = Neltume.colores
    Row(verticalAlignment = Alignment.Top) {
        Box(Modifier.size(30.dp).clip(CircleShape).background(c.verdeVelo), contentAlignment = Alignment.Center) {
            Text("$numero", style = MaterialTheme.typography.labelLarge, color = c.verde)
        }
        Spacer(Modifier.width(14.dp))
        Text(texto, style = MaterialTheme.typography.bodyLarge, color = c.tintaSuave, modifier = Modifier.weight(1f).padding(top = 3.dp))
    }
}

/** Un punto de una lista: viñeta cálida y el texto. */
@Composable
private fun Vineta(texto: AnnotatedString) {
    val c = Neltume.colores
    Row(verticalAlignment = Alignment.Top) {
        Box(Modifier.padding(top = 10.dp).size(6.dp).clip(CircleShape).background(c.calido))
        Spacer(Modifier.width(14.dp))
        Text(texto, style = MaterialTheme.typography.bodyLarge, color = c.tintaSuave, modifier = Modifier.weight(1f))
    }
}
