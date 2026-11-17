package cl.puertasneltume.cotizador.cotizar

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import cl.puertasneltume.cotizador.diseno.Aviso
import cl.puertasneltume.cotizador.diseno.BotonPrincipal
import cl.puertasneltume.cotizador.diseno.BotonSecundario
import cl.puertasneltume.cotizador.diseno.BotonTexto
import cl.puertasneltume.cotizador.diseno.Campo
import cl.puertasneltume.cotizador.diseno.CampoPesos
import cl.puertasneltume.cotizador.diseno.ChipFiltro
import cl.puertasneltume.cotizador.diseno.Divisor
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Rotulo
import cl.puertasneltume.cotizador.diseno.TituloSeccion
import cl.puertasneltume.cotizador.diseno.TonoAviso
import cl.puertasneltume.cotizador.nucleo.api.Cambios
import cl.puertasneltume.cotizador.nucleo.modelo.Cotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.DescuentoItem
import cl.puertasneltume.cotizador.nucleo.modelo.TipoMedida
import cl.puertasneltume.cotizador.nucleo.reglas.CampoMedida
import cl.puertasneltume.cotizador.nucleo.reglas.Limites
import cl.puertasneltume.cotizador.nucleo.reglas.aPesos
import cl.puertasneltume.cotizador.nucleo.reglas.decimalCampo
import cl.puertasneltume.cotizador.nucleo.reglas.errorMargenTexto
import cl.puertasneltume.cotizador.nucleo.reglas.esLibre
import cl.puertasneltume.cotizador.nucleo.reglas.familiaItem
import cl.puertasneltume.cotizador.nucleo.reglas.jsTexto
import cl.puertasneltume.cotizador.nucleo.reglas.leerMedida
import cl.puertasneltume.cotizador.nucleo.reglas.leerPesos
import cl.puertasneltume.cotizador.nucleo.reglas.leerPorcentaje
import cl.puertasneltume.cotizador.nucleo.reglas.leerPorcentajeConSigno
import cl.puertasneltume.cotizador.nucleo.reglas.margenAPorcentaje
import cl.puertasneltume.cotizador.nucleo.reglas.pesos
import cl.puertasneltume.cotizador.nucleo.reglas.porcentajeAMargen

private val FAMILIAS_ESPECIAL = listOf("PUERTA" to "Puerta", "MARCO" to "Marco", "MOLDURA" to "Moldura", "PIEZAS_T" to "Pieza T", "OTRO" to "Ítem libre")

/**
 * Detalle de un ítem. Se edita todo y se guarda de una vez («Guardar cambios»). Con la nota de pedido generada, solo
 * lo que admite «Corregir pedido»: cantidad, medidas, hoja o vano, descripción y nota.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HojaDetalleItem(q: Cotizacion, v: VistaItem, editable: Boolean, corregible: Boolean, ocultarCostos: Boolean, vm: CotizadorViewModel, alCerrar: () -> Unit) {
    val c = Neltume.colores
    val s = v.solicitud
    val l = v.linea
    val familia = familiaItem(s, l?.producto?.familia, q.incompletos.firstOrNull { it.indice == v.indice }?.rechazo)
    val esPuerta = familia == "PUERTA"
    val libre = esLibre(s)
    val especial = s.personalizado != null
    val soloPedido = !editable && corregible
    val puedeEditar = editable || corregible

    var descripcion by remember { mutableStateOf(s.descripcion ?: "") }
    var modelo by remember { mutableStateOf(s.modelo ?: "") }
    var madera by remember { mutableStateOf(s.madera ?: "") }
    var ancho by remember { mutableStateOf(s.ancho?.let(::decimalCampo) ?: "") }
    var alto by remember { mutableStateOf(s.alto?.let(::decimalCampo) ?: "") }
    var medida by remember { mutableStateOf(s.medida ?: "") }
    var cantidad by remember { mutableStateOf((l?.cantidad ?: s.cantidad)?.toString() ?: "") }
    var tipo by remember { mutableStateOf(s.tipoMedida) }
    var observaciones by remember { mutableStateOf(s.observaciones ?: "") }
    var precio by remember { mutableStateOf(s.precioUnitario?.toString() ?: "") }
    var costo by remember { mutableStateOf(s.costoFabrica?.toLong()?.toString() ?: "") }
    var ganancia by remember { mutableStateOf(s.margen?.let { jsTexto(margenAPorcentaje(it)).replace('.', ',') } ?: "") }
    var descTipo by remember { mutableStateOf(s.descuento?.tipo ?: "porcentaje") }
    var descValor by remember {
        mutableStateOf(s.descuento?.let { if (it.esPorcentaje) jsTexto(it.valor).replace('.', ',') else it.valor.toLong().toString() } ?: "")
    }
    var familiaEspecial by remember { mutableStateOf(s.personalizado?.familia ?: familia) }
    var errores by remember { mutableStateOf(mapOf<String, String>()) }
    var guardando by remember { mutableStateOf(false) }

    fun guardar() {
        val e = mutableMapOf<String, String>()
        val nAncho = if (ancho.isBlank()) null else leerMedida(ancho, "PUERTA", CampoMedida.ANCHO).also { if (it == null) e["ancho"] = Limites.errorMedida(CampoMedida.ANCHO, familia) }
        val nAlto = if (alto.isBlank()) null else leerMedida(alto, familia, CampoMedida.ALTO).also { if (it == null) e["alto"] = Limites.errorMedida(CampoMedida.ALTO, familia) }
        val nCantidad = cantidad.trim().toIntOrNull()
        if (!Limites.cantidadValida(nCantidad)) e["cantidad"] = "Indica una cantidad entera entre 1 y 10.000."
        val nPrecio = if (precio.isBlank()) null else leerPesos(precio).aPesos()?.takeIf { it > 0 }.also { if (it == null) e["precio"] = "Escribe un precio en pesos, sin decimales." }
        val nCosto = if (costo.isBlank()) null else leerPesos(costo).aPesos()?.takeIf { it > 0 }.also { if (it == null) e["costo"] = "Escribe el costo en pesos, sin decimales." }
        val nMargen = if (ganancia.isBlank()) null else errorMargenTexto(ganancia).let { err ->
            if (err != null) {
                e["ganancia"] = err
                null
            } else porcentajeAMargen(leerPorcentajeConSigno(ganancia))
        }
        val nDescuento = if (descValor.isBlank()) null else {
            val valor = if (descTipo == "porcentaje") leerPorcentaje(descValor) else leerPesos(descValor)
            val d = DescuentoItem(descTipo, valor)
            if (!cl.puertasneltume.cotizador.nucleo.reglas.descuentoItemValido(d)) {
                e["descuento"] = if (descTipo == "porcentaje") "El descuento debe ser mayor que 0 y hasta 100 %, con dos decimales." else "Escribe un monto en pesos, sin decimales."
                null
            } else d
        }
        if (especial && !libre && madera.isBlank()) e["madera"] = "Indica la madera del pedido especial."
        if (especial && modelo.isBlank()) e["modelo"] = "Escribe el nombre del producto."
        errores = e
        if (e.isNotEmpty()) return
        val i = v.indice
        val cambios: Cambios.() -> Unit = {
            if (descripcion.trim() != (s.descripcion ?: "")) itemTexto(i, "descripcion", descripcion)
            if (observaciones.trim() != (s.observaciones ?: "")) itemTexto(i, "observaciones", observaciones)
            if (nAncho != s.ancho) itemNumero(i, "ancho", nAncho)
            if (nAlto != s.alto) itemNumero(i, "alto", nAlto)
            if (!esPuerta && medida.trim() != (s.medida ?: "")) itemTexto(i, "medida", medida)
            if (tipo != s.tipoMedida && tipo != null) tipoMedida(i, tipo!!)
            if (nCantidad != null && nCantidad != (l?.cantidad ?: s.cantidad)) cantidad(i, nCantidad)
            if (!soloPedido) {
                if (modelo.trim() != (s.modelo ?: "")) itemTexto(i, "modelo", modelo)
                if (madera.trim() != (s.madera ?: "")) itemTexto(i, "madera", madera)
                if (nPrecio != s.precioUnitario) itemNumero(i, "precioUnitario", nPrecio)
                if (especial && nCosto?.toDouble() != s.costoFabrica) itemNumero(i, "costoFabrica", nCosto)
                if (!ocultarCostos && nMargen != s.margen) itemNumero(i, "margen", nMargen)
                if (nDescuento != s.descuento) descuentoItem(i, nDescuento)
                if (especial && familiaEspecial != s.personalizado?.familia) personalizado(i, familiaEspecial)
            }
        }
        guardando = true
        vm.editar("detalle.$i", cambios) { ok ->
            guardando = false
            if (ok) alCerrar()
        }
    }

    val estado = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(alCerrar, sheetState = estado, containerColor = c.superficie) {
        Column(
            Modifier
                .fillMaxWidth()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .navigationBarsPadding()
                .padding(bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            TituloSeccion("Ítem ${v.indice + 1}", detalle = nombreItem(v))
            if (soloPedido) Aviso(
                "Corregir pedido: el cambio vuelve a generar la cotización y la nota de pedido, y la fábrica recibe la revisión. Solo se corrigen la cantidad, las medidas, hoja o vano, la descripción y la nota.",
                tono = TonoAviso.ATENCION,
            )
            if (!puedeEditar) Aviso("Esta cotización no admite cambios en sus ítems.")
            Campo(cantidad, { cantidad = it.filter(Char::isDigit) }, "Cantidad", teclado = KeyboardType.Number, error = errores["cantidad"], habilitado = puedeEditar)
            if (!soloPedido && (especial || v.pendiente)) {
                Campo(modelo, { modelo = it }, if (especial) "Nombre del producto" else "Modelo", error = errores["modelo"], habilitado = puedeEditar, mayusculas = KeyboardCapitalization.Words)
                if (!libre) Campo(madera, { madera = it }, "Madera", error = errores["madera"], habilitado = puedeEditar, mayusculas = KeyboardCapitalization.Words)
            }
            if (!libre) {
                if (esPuerta) Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Campo(ancho, { ancho = it }, "Ancho", Modifier.weight(1f), error = errores["ancho"], teclado = KeyboardType.Decimal, sufijo = "m", habilitado = puedeEditar, ayuda = "0,80 · 80 cm · 800 mm")
                    Campo(alto, { alto = it }, "Alto", Modifier.weight(1f), error = errores["alto"], teclado = KeyboardType.Decimal, sufijo = "m", habilitado = puedeEditar, ayuda = "2,10 · 210 cm")
                } else Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Campo(medida, { medida = it }, "Escuadría", Modifier.weight(1f), habilitado = puedeEditar, ayuda = "Grosor por ancho: 2x4", mayusculas = KeyboardCapitalization.Characters)
                    Campo(alto, { alto = it }, "Largo", Modifier.weight(1f), error = errores["alto"], teclado = KeyboardType.Decimal, sufijo = "m", habilitado = puedeEditar, ayuda = "Hasta 6 m")
                }
                if (esPuerta) Column {
                    Rotulo("La medida es de")
                    Spacer(Modifier.height(6.dp))
                    HojaVano(tipo, puedeEditar) { tipo = it }
                }
            }
            Campo(descripcion, { descripcion = it }, "Descripción para el documento", habilitado = puedeEditar, ayuda = "Vacía usa el nombre del producto con las medidas pedidas.", largoMaximo = 300)
            Campo(observaciones, { observaciones = it }, "Nota del ítem", lineas = 2, habilitado = puedeEditar, largoMaximo = Limites.LARGO_OBSERVACION_ITEM, ayuda = "Va a la cotización y a la nota de pedido.")
            if (!soloPedido && puedeEditar) {
                Divisor()
                TituloSeccion("Precio")
                CampoPesos(precio, { precio = it }, if (especial) "Precio unitario (sin IVA)" else "Precio unitario fijado a mano", error = errores["precio"], ayuda = if (especial) null else "Vacío usa el precio del catálogo${v.linea?.let { " (${pesos(it.precioCliente ?: it.precioUnitario)})" } ?: ""}.")
                if (especial && !libre && !ocultarCostos) CampoPesos(costo, { costo = it }, "Costo de fábrica", error = errores["costo"], ayuda = "Sin él, la línea va «Por definir» en la nota de pedido.")
                if (!ocultarCostos && !especial) Campo(ganancia, { ganancia = it }, "Ganancia de esta línea", error = errores["ganancia"], teclado = KeyboardType.Decimal, sufijo = "%", ayuda = "Vacía usa la de la cotización o la categoría.")
                Rotulo("Descuento especial del ítem")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ChipFiltro("Porcentaje", descTipo == "porcentaje", { descTipo = "porcentaje" })
                    ChipFiltro("Monto por unidad", descTipo == "monto", { descTipo = "monto" })
                }
                if (descTipo == "porcentaje") Campo(descValor, { descValor = it }, "Descuento", error = errores["descuento"], teclado = KeyboardType.Decimal, sufijo = "%")
                else CampoPesos(descValor, { descValor = it }, "Descuento por unidad", error = errores["descuento"])
                if (especial) {
                    Rotulo("Tipo de producto especial")
                    androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        FAMILIAS_ESPECIAL.forEach { (clave, nombre) -> ChipFiltro(nombre, familiaEspecial == clave, { familiaEspecial = clave }) }
                    }
                } else if (v.pendiente) {
                    Aviso(
                        "Si el modelo o la medida no están en el catálogo, cotízalo como pedido especial con el precio que indiques.",
                        accion = {
                            BotonTexto("Cotizar como especial", {
                                vm.editar("especial.${v.indice}", { personalizado(v.indice, familia) }) { if (it) alCerrar() }
                            })
                        },
                    )
                }
            }
            if (puedeEditar) Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                BotonSecundario("Cancelar", alCerrar, Modifier.weight(1f))
                BotonPrincipal("Guardar cambios", ::guardar, Modifier.weight(1f), cargando = guardando)
            } else BotonSecundario("Cerrar", alCerrar, Modifier.fillMaxWidth())
            Spacer(Modifier.width(1.dp))
        }
    }
}
