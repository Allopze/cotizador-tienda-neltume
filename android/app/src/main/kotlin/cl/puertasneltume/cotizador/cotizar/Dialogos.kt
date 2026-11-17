package cl.puertasneltume.cotizador.cotizar

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import cl.puertasneltume.cotizador.comun.LocalContenedor
import cl.puertasneltume.cotizador.diseno.Aviso
import cl.puertasneltume.cotizador.diseno.BotonPrincipal
import cl.puertasneltume.cotizador.diseno.BotonSecundario
import cl.puertasneltume.cotizador.diseno.Campo
import cl.puertasneltume.cotizador.diseno.ChipFiltro
import cl.puertasneltume.cotizador.diseno.Divisor
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Radios
import cl.puertasneltume.cotizador.diseno.Rotulo
import cl.puertasneltume.cotizador.diseno.TituloSeccion
import cl.puertasneltume.cotizador.diseno.TonoAviso
import cl.puertasneltume.cotizador.nucleo.api.Acciones
import cl.puertasneltume.cotizador.nucleo.modelo.Fabrica
import cl.puertasneltume.cotizador.nucleo.modelo.ReceptorFacturacion
import cl.puertasneltume.cotizador.nucleo.modelo.TipoDocumento
import cl.puertasneltume.cotizador.nucleo.reglas.Fechas
import cl.puertasneltume.cotizador.nucleo.reglas.Limites
import cl.puertasneltume.cotizador.nucleo.reglas.NumerosCL
import cl.puertasneltume.cotizador.nucleo.reglas.correoValido
import cl.puertasneltume.cotizador.nucleo.reglas.medidaPedida
import cl.puertasneltume.cotizador.nucleo.reglas.nombreFabrica
import cl.puertasneltume.cotizador.nucleo.reglas.normalizarRut
import cl.puertasneltume.cotizador.nucleo.reglas.numeroCotizacion
import cl.puertasneltume.cotizador.nucleo.reglas.pesos
import cl.puertasneltume.cotizador.nucleo.reglas.receptorDesdeCliente
import cl.puertasneltume.cotizador.nucleo.reglas.receptorTieneContenido
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import androidx.compose.foundation.layout.width
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.selection.toggleable

/** Los diálogos que abre el ViewModel en medio de un flujo. */
@Composable
fun DialogosCotizador(vm: CotizadorViewModel, e: EstadoCotizador, admin: Boolean) {
    when (val d = e.dialogo) {
        is Dialogo.Confirmacion -> DialogoConfirmacion(d.titulo, d.mensaje, d.aceptar, d.detalles, d.peligro) { vm.responderConfirmacion(d, it) }
        is Dialogo.Emision -> HojaEmision(d) { d.respuesta.complete(it) }
        is Dialogo.Aprobacion -> HojaAprobacion(d) { d.respuesta.complete(it) }
        is Dialogo.Anulacion -> DialogoAnulacion(d) { d.respuesta.complete(it) }
        null -> {}
    }
}

/** Confirmación con título en serif y la acción nombrada («Emitir con los montos actualizados»). */
@Composable
fun DialogoConfirmacion(titulo: String, mensaje: String, aceptar: String, detalles: List<String> = emptyList(), peligro: Boolean = false, responder: (Boolean) -> Unit) {
    val c = Neltume.colores
    AlertDialog(
        onDismissRequest = { responder(false) },
        shape = Radios.hoja,
        containerColor = c.superficie,
        title = { Text(titulo, style = MaterialTheme.typography.headlineSmall, color = c.tinta) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(mensaje, style = MaterialTheme.typography.bodyMedium, color = c.tintaSuave)
                detalles.forEach { Text("• $it", style = MaterialTheme.typography.bodySmall, color = c.tintaSuave) }
            }
        },
        confirmButton = { BotonPrincipal(aceptar, { responder(true) }, peligro = peligro) },
        dismissButton = { BotonSecundario("Cancelar", { responder(false) }) },
    )
}

/** Emitir: lo que se emitirá (cliente, productos y total) y, en administración, el número a mano. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HojaEmision(d: Dialogo.Emision, responder: (Int?) -> Unit) {
    val c = Neltume.colores
    val q = d.q
    val api = LocalContenedor.current.api
    var manual by remember { mutableStateOf(false) }
    var numero by remember { mutableStateOf("") }
    var limites by remember { mutableStateOf<Pair<Int, Int>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(manual) {
        if (manual && limites == null) runCatching { api.numeracion() }.onSuccess { limites = it.siguiente to it.tope }
    }
    ModalBottomSheet({ responder(CotizadorViewModel.CANCELADO) }, sheetState = rememberModalBottomSheetState(true), containerColor = c.superficie) {
        Column(
            Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).navigationBarsPadding().padding(bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            TituloSeccion("Emitir y generar PDF", detalle = "Se asigna el número y se genera el PDF para el cliente.")
            q.origen?.let { Aviso("Esta revisión reemplazará a la N° $it al emitirse.", tono = TonoAviso.ATENCION) }
            Rotulo("Cliente")
            Text(q.cliente.nombre ?: "Sin nombre (los datos del cliente son opcionales)", style = MaterialTheme.typography.bodyMedium, color = c.tinta)
            Rotulo("Productos")
            q.montos.lineas.forEach { l ->
                Row {
                    Text("${l.cantidad} ×", style = MaterialTheme.typography.bodyMedium, color = c.apagado)
                    Spacer(Modifier.padding(4.dp))
                    Column(Modifier.weight(1f)) {
                        Text(nombreItem(VistaItem(l.indice ?: 0, q.solicitudes.getOrElse(l.indice ?: 0) { cl.puertasneltume.cotizador.nucleo.modelo.SolicitudItem() }, l)), style = MaterialTheme.typography.bodyMedium, color = c.tinta)
                        medidaPedida(l)?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = c.apagado) }
                    }
                }
            }
            Divisor()
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Total (IVA incluido)", style = MaterialTheme.typography.titleMedium, color = c.tinta, modifier = Modifier.weight(1f))
                Text(pesos(q.montos.total), style = MaterialTheme.typography.headlineSmall, color = c.tinta)
            }
            if (d.numeroManual) {
                FilaCasilla("Elegir el número a mano", manual, c.verde) { manual = it }
                if (manual) Campo(
                    numero,
                    { numero = it.filter(Char::isDigit); error = null },
                    "Número de la cotización",
                    teclado = KeyboardType.Number,
                    error = error,
                    ayuda = limites?.let { (siguiente, tope) -> "Desde el ${NumerosCL.agruparMiles(siguiente.toString())} hasta el ${NumerosCL.agruparMiles(tope.toString())}. Los números saltados no se vuelven a usar." },
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                BotonSecundario("Cancelar", { responder(CotizadorViewModel.CANCELADO) }, Modifier.weight(1f))
                BotonPrincipal("Emitir", {
                    if (manual) {
                        val n = numero.toIntOrNull()
                        val (desde, hasta) = limites ?: (1 to Int.MAX_VALUE)
                        if (n == null || n < desde || n > hasta) {
                            error = "Escribe un número entre ${NumerosCL.agruparMiles(desde.toString())} y ${NumerosCL.agruparMiles(hasta.toString())}."
                            return@BotonPrincipal
                        }
                        responder(n)
                    } else responder(null)
                }, Modifier.weight(1f))
            }
        }
    }
}

/**
 * Registrar la aprobación del cliente: despacho (opcional) y documento tributario. Con factura se piden los datos del
 * receptor, precargados del cliente o de su ficha en Clientes (por RUT).
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun HojaAprobacion(d: Dialogo.Aprobacion, responder: (DatosAprobacion?) -> Unit) {
    val c = Neltume.colores
    val api = LocalContenedor.current.api
    val q = d.q
    val previa = q?.facturacion
    val teniaPrevio = previa?.documento != null || receptorTieneContenido(previa?.receptor)
    var direccion by remember { mutableStateOf(q?.despacho?.direccion ?: q?.cliente?.direccion ?: "") }
    var entrega by remember { mutableStateOf(q?.despacho?.entregaComprometida ?: "") }
    var transporte by remember { mutableStateOf(q?.despacho?.transporte ?: "") }
    var documento by remember { mutableStateOf(previa?.documento) }
    var receptor by remember { mutableStateOf(previa?.receptor ?: q?.cliente?.let { receptorDesdeCliente(it) } ?: ReceptorFacturacion()) }
    var errores by remember { mutableStateOf(mapOf<String, String>()) }
    var tocado by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        val rut = q?.cliente?.rut
        if (!teniaPrevio && rut != null) runCatching { api.clientePorRut(rut) }.getOrNull()?.let { reg ->
            if (!tocado) {
                reg.documentoHabitual?.let { documento = it }
                val base = reg.receptorFacturacion ?: ReceptorFacturacion(reg.nombre, reg.rut, reg.giro, reg.direccion, reg.comuna, reg.correo)
                receptor = ReceptorFacturacion(
                    base.razonSocial ?: q.cliente.nombre, base.rut ?: q.cliente.rut, base.giro ?: q.cliente.giro,
                    base.direccion ?: q.cliente.direccion, base.comuna ?: q.cliente.comuna, base.correo ?: reg.correo,
                )
            }
        }
    }
    fun aprobar() {
        val facturacion = when (documento) {
            TipoDocumento.FACTURA -> {
                val e = mutableMapOf<String, String>()
                receptor.rut?.takeIf { it.isNotBlank() }?.let { if (normalizarRut(it) == null) e["rut"] = "El RUT no es válido. Revísalo." }
                receptor.correo?.takeIf { it.isNotBlank() }?.let { if (!correoValido(it)) e["correo"] = "El correo no es válido." }
                errores = e
                if (e.isNotEmpty()) return
                buildJsonObject {
                    put("documento", "factura")
                    put("receptor", Acciones.receptorJson(receptor.let { r -> r.copy(rut = r.rut?.let { normalizarRut(it) ?: it }) }))
                }
            }
            TipoDocumento.BOLETA -> buildJsonObject {
                put("documento", "boleta")
                put("receptor", JsonNull)
            }
            null -> if (teniaPrevio) buildJsonObject {
                put("documento", JsonNull)
                put("receptor", JsonNull)
            } else null
        }
        val despacho = buildJsonObject {
            direccion.trim().takeIf { it.isNotEmpty() }?.let { put("direccion", it) }
            transporte.trim().takeIf { it.isNotEmpty() }?.let { put("transporte", it) }
            entrega.trim().takeIf { it.isNotEmpty() }?.let { put("entregaComprometida", it) }
        }
        responder(DatosAprobacion(despacho.takeIf { it.isNotEmpty() }, facturacion))
    }
    ModalBottomSheet({ responder(null) }, sheetState = rememberModalBottomSheetState(true), containerColor = c.superficie) {
        Column(
            Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).navigationBarsPadding().padding(bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            TituloSeccion("¿Aprobar la cotización ${numeroCotizacion(d.numero)}?")
            Text(
                "Se registrará la aprobación del cliente y la cotización quedará bloqueada para edición. La nota de pedido se habilitará cuando registres al menos ${Limites.ANTICIPO_TEXTO} de pago.",
                style = MaterialTheme.typography.bodyMedium,
                color = c.tintaSuave,
            )
            if (d.vencida) Aviso(
                "Esta cotización venció${d.vence?.let { " el ${Fechas.larga(it)}" } ?: ""}. Apruébala solo si el cliente aceptó los valores igualmente.",
                tono = TonoAviso.ATENCION,
            )
            Rotulo("Despacho (opcional)")
            Campo(direccion, { direccion = it }, "Dirección de despacho", largoMaximo = 300)
            Campo(entrega, { entrega = it }, "Entrega comprometida", ayuda = "Ej. semana del 15 de abril", largoMaximo = 120)
            Campo(transporte, { transporte = it }, "Transporte", ayuda = "Retira el cliente, camión propio, Starken…", largoMaximo = 120)
            Divisor()
            Rotulo("Documento para el cliente (opcional)")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ChipFiltro("Aún no sabe", documento == null, { documento = null; tocado = true })
                ChipFiltro("Boleta", documento == TipoDocumento.BOLETA, { documento = TipoDocumento.BOLETA; tocado = true })
                ChipFiltro("Factura", documento == TipoDocumento.FACTURA, { documento = TipoDocumento.FACTURA; tocado = true })
            }
            if (documento == TipoDocumento.FACTURA) CamposReceptor(receptor, errores) { receptor = it; tocado = true }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                BotonSecundario("Cancelar", { responder(null) }, Modifier.weight(1f))
                BotonPrincipal("Aprobar", ::aprobar, Modifier.weight(1f), icono = cl.puertasneltume.cotizador.diseno.Iconos.Check)
            }
        }
    }
}

/** Datos del receptor de la factura (razón social, RUT, giro, dirección, comuna y correo). */
@Composable
fun CamposReceptor(r: ReceptorFacturacion, errores: Map<String, String>, alCambiar: (ReceptorFacturacion) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Campo(r.razonSocial ?: "", { alCambiar(r.copy(razonSocial = it)) }, "Razón social", mayusculas = KeyboardCapitalization.Words, largoMaximo = 300)
        Campo(r.rut ?: "", { alCambiar(r.copy(rut = it)) }, "RUT", error = errores["rut"], mayusculas = KeyboardCapitalization.Characters, largoMaximo = 20)
        Campo(r.giro ?: "", { alCambiar(r.copy(giro = it)) }, "Giro", largoMaximo = 300)
        Campo(r.direccion ?: "", { alCambiar(r.copy(direccion = it)) }, "Dirección", largoMaximo = 300)
        Campo(r.comuna ?: "", { alCambiar(r.copy(comuna = it)) }, "Comuna", mayusculas = KeyboardCapitalization.Words, largoMaximo = 300)
        Campo(r.correo ?: "", { alCambiar(r.copy(correo = it)) }, "Correo (opcional)", error = errores["correo"], teclado = KeyboardType.Email, largoMaximo = 254)
    }
}

/** Anular: definitivo; advierte lo pagado (anular no devuelve pagos) y pide marcar que se entiende. */
@Composable
private fun DialogoAnulacion(d: Dialogo.Anulacion, responder: (String?) -> Unit) {
    val c = Neltume.colores
    var motivo by remember { mutableStateOf("") }
    var entendido by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { responder(null) },
        shape = Radios.hoja,
        containerColor = c.superficie,
        title = { Text("Anular la cotización ${numeroCotizacion(d.q.numero)}", style = MaterialTheme.typography.headlineSmall, color = c.tinta) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    "La anulación es definitiva: conserva el número y el PDF, que se descarga con la marca «ANULADA».${if (d.q.notas.isNotEmpty()) " Las notas de pedido quedan anuladas." else ""}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = c.tintaSuave,
                )
                if (d.pagado > 0) Aviso("Tiene ${pesos(d.pagado)} pagados. Anular no devuelve los pagos: gestiona la devolución aparte.", tono = TonoAviso.ATENCION)
                Campo(motivo, { motivo = it }, "Motivo (opcional)", largoMaximo = 500)
                FilaCasilla("Entiendo que no se puede deshacer", entendido, c.peligro) { entendido = it }
            }
        },
        confirmButton = {
            BotonPrincipal("Anular", { responder(motivo.trim().ifEmpty { CotizadorViewModel.SIN_MOTIVO }) }, habilitado = entendido, peligro = true)
        },
        dismissButton = { BotonSecundario("Cancelar", { responder(null) }) },
    )
}

/** Cambiar el número de la cotización o de una nota (administración): debe estar libre en su serie. */
@Composable
fun DialogoCambiarNumero(documento: String, fabrica: Fabrica?, actual: Int, alCerrar: () -> Unit, aplicar: (Int) -> Unit) {
    val c = Neltume.colores
    var numero by remember { mutableStateOf("") }
    val nombre = if (documento == "cotizacion") "la cotización N° $actual" else "la nota de pedido N° $actual${fabrica?.let { " de ${nombreFabrica[it]}" } ?: ""}"
    AlertDialog(
        onDismissRequest = alCerrar,
        shape = Radios.hoja,
        containerColor = c.superficie,
        title = { Text("Cambiar el número de $nombre", style = MaterialTheme.typography.headlineSmall, color = c.tinta) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    "Debe estar libre en su serie. El PDF se vuelve a generar con el número nuevo${if (documento == "cotizacion") " (y también los de sus notas, que la nombran)" else ""}, y el cambio queda en la actividad.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = c.tintaSuave,
                )
                Campo(numero, { numero = it.filter(Char::isDigit) }, "Número nuevo", teclado = KeyboardType.Number)
            }
        },
        confirmButton = {
            BotonPrincipal("Cambiar", { numero.toIntOrNull()?.let(aplicar) }, habilitado = numero.toIntOrNull()?.let { it > 0 && it != actual } == true)
        },
        dismissButton = { BotonSecundario("Cancelar", alCerrar) },
    )
}

/** Casilla con su texto: toda la fila responde al toque (no solo el cuadrito) y TalkBack la lee como una casilla. */
@Composable
private fun FilaCasilla(texto: String, marcada: Boolean, color: androidx.compose.ui.graphics.Color, alCambiar: (Boolean) -> Unit) {
    val c = Neltume.colores
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clip(Radios.md)
            .toggleable(marcada, role = Role.Checkbox, onValueChange = alCambiar),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(marcada, onCheckedChange = null, colors = CheckboxDefaults.colors(checkedColor = color))
        Spacer(Modifier.width(10.dp))
        Text(texto, style = MaterialTheme.typography.bodyMedium, color = c.tinta)
    }
}
