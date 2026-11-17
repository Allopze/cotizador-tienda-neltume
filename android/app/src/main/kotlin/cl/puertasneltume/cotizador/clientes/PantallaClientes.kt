package cl.puertasneltume.cotizador.clientes

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import cl.puertasneltume.cotizador.comun.LocalAvisos
import cl.puertasneltume.cotizador.comun.LocalContenedor
import cl.puertasneltume.cotizador.comun.LocalNavegador
import cl.puertasneltume.cotizador.cotizar.CamposReceptor
import cl.puertasneltume.cotizador.cotizar.DialogoConfirmacion
import cl.puertasneltume.cotizador.diseno.Aviso
import cl.puertasneltume.cotizador.diseno.BotonPrincipal
import cl.puertasneltume.cotizador.diseno.BotonSecundario
import cl.puertasneltume.cotizador.diseno.BotonTexto
import cl.puertasneltume.cotizador.diseno.Campo
import cl.puertasneltume.cotizador.diseno.ChipFiltro
import cl.puertasneltume.cotizador.diseno.Divisor
import cl.puertasneltume.cotizador.diseno.EstadoVacio
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Pildora
import cl.puertasneltume.cotizador.diseno.PildoraEstado
import cl.puertasneltume.cotizador.diseno.Radios
import cl.puertasneltume.cotizador.diseno.Rotulo
import cl.puertasneltume.cotizador.diseno.Tarjeta
import cl.puertasneltume.cotizador.diseno.TituloPantalla
import cl.puertasneltume.cotizador.diseno.TituloSeccion
import cl.puertasneltume.cotizador.diseno.TonoAviso
import cl.puertasneltume.cotizador.nucleo.api.Acciones
import cl.puertasneltume.cotizador.nucleo.api.FalloApi
import cl.puertasneltume.cotizador.nucleo.modelo.ClienteDirectorio
import cl.puertasneltume.cotizador.nucleo.modelo.ReceptorFacturacion
import cl.puertasneltume.cotizador.nucleo.modelo.TipoDocumento
import cl.puertasneltume.cotizador.nucleo.reglas.Fechas
import cl.puertasneltume.cotizador.nucleo.reglas.SIN_CLIENTE
import cl.puertasneltume.cotizador.nucleo.reglas.correoValido
import cl.puertasneltume.cotizador.nucleo.reglas.etiquetaDocumentoFacturacion
import cl.puertasneltume.cotizador.nucleo.reglas.normalizarRut
import cl.puertasneltume.cotizador.nucleo.reglas.numeroCotizacion
import cl.puertasneltume.cotizador.nucleo.reglas.pesos
import cl.puertasneltume.cotizador.nucleo.reglas.plural
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Clientes: los frecuentes y los que solo aparecen en cotizaciones, con sus cotizaciones recientes. */
@Composable
fun PantallaClientes() {
    val c = Neltume.colores
    val contenedor = LocalContenedor.current
    val api = contenedor.api
    val navegador = LocalNavegador.current
    val avisos = LocalAvisos.current
    val admin = contenedor.sesion.esAdmin
    val alcance = rememberCoroutineScope()
    var q by rememberSaveable { mutableStateOf("") }
    var pagina by remember { mutableIntStateOf(1) }
    var clientes by remember { mutableStateOf<List<ClienteDirectorio>?>(null) }
    var total by remember { mutableIntStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }
    var recarga by remember { mutableIntStateOf(0) }
    var editando by remember { mutableStateOf<ClienteDirectorio?>(null) }
    var nuevo by remember { mutableStateOf(false) }
    var eliminar by remember { mutableStateOf<ClienteDirectorio?>(null) }
    var abierto by rememberSaveable { mutableStateOf<String?>(null) }
    val lista = rememberLazyListState()
    val cerca by remember { derivedStateOf { (lista.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= lista.layoutInfo.totalItemsCount - 4 } }

    LaunchedEffect(q, pagina, recarga) {
        if (pagina == 1) delay(300)
        try {
            val d = api.directorioClientes(q, pagina)
            clientes = if (pagina == 1) d.clientes else clientes.orEmpty() + d.clientes
            total = d.total
            error = null
        } catch (e: FalloApi) {
            error = e.message
        }
    }
    LaunchedEffect(cerca) { if (cerca && (clientes?.size ?: 0) < total) pagina++ }

    Column(Modifier.fillMaxSize().background(c.papel)) {
        Column(Modifier.windowInsetsPadding(WindowInsets.statusBars).padding(horizontal = 16.dp, vertical = 8.dp)) {
            TituloPantalla("Clientes", subtitulo = plural(total, "cliente")) {
                BotonSecundario("Nuevo", { nuevo = true }, icono = Iconos.Mas)
            }
            Spacer(Modifier.height(12.dp))
            Campo(q, { q = it; pagina = 1 }, "Buscar nombre, RUT, comuna o teléfono", icono = Iconos.Buscar)
            error?.let { Aviso(it, tono = TonoAviso.PELIGRO) }
        }
        when {
            clientes == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = c.verde) }
            clientes!!.isEmpty() -> EstadoVacio(
                Iconos.Clientes,
                if (q.isBlank()) "Todavía no hay clientes" else "Sin coincidencias",
                if (q.isBlank()) "Aparecen al cotizar con datos del cliente o al crearlos aquí." else "Prueba con otro nombre o el RUT.",
            ) { BotonPrincipal("Crear cliente", { nuevo = true }, icono = Iconos.Mas) }
            else -> LazyColumn(state = lista, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(clientes!!, key = { it.id ?: "${it.rut}|${it.nombre}" }) { cl ->
                    val clave = cl.id ?: "${cl.rut}|${cl.nombre}"
                    FilaCliente(
                        cl,
                        abierto = abierto == clave,
                        alternar = { abierto = if (abierto == clave) null else clave },
                        admin = admin,
                        abrirCotizacion = { navegador.abrirCotizacion(it) },
                        editar = { editando = cl },
                        eliminar = { eliminar = cl },
                    )
                }
            }
        }
    }
    if (nuevo || editando != null) HojaCliente(editando, alCerrar = { nuevo = false; editando = null }) {
        nuevo = false
        editando = null
        pagina = 1
        recarga++
    }
    eliminar?.let { cl ->
        DialogoConfirmacion(
            "Eliminar a ${cl.nombre ?: SIN_CLIENTE}",
            "Sale de Clientes frecuentes. Sus cotizaciones no cambian: siguen en el historial con sus datos.",
            "Eliminar cliente",
            peligro = true,
        ) { ok ->
            eliminar = null
            if (ok && cl.id != null && cl.actualizado != null) alcance.launch {
                try {
                    api.eliminarCliente(cl.id!!, cl.actualizado!!)
                    avisos.mostrar("Cliente eliminado.")
                    pagina = 1
                    recarga++
                } catch (e: FalloApi) {
                    avisos.mostrar(e.message ?: "", largo = true)
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FilaCliente(
    cl: ClienteDirectorio,
    abierto: Boolean,
    alternar: () -> Unit,
    admin: Boolean,
    abrirCotizacion: (String) -> Unit,
    editar: () -> Unit,
    eliminar: () -> Unit,
) {
    val c = Neltume.colores
    Tarjeta(alternar) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(cl.nombre?.takeIf { it.isNotBlank() } ?: SIN_CLIENTE, style = MaterialTheme.typography.titleMedium, color = c.tinta, modifier = Modifier.weight(1f, fill = false))
                    Spacer(Modifier.width(8.dp))
                    Pildora(if (cl.registrado) "Frecuente" else "Solo en cotizaciones", if (cl.registrado) c.verdeVelo else c.tonal, if (cl.registrado) c.verde else c.tintaSuave)
                }
                Text(listOfNotNull(cl.rut, cl.comuna, cl.telefono).joinToString(" · ").ifEmpty { "Sin RUT ni comuna" }, style = MaterialTheme.typography.bodySmall, color = c.apagado)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(plural(cl.cantidad, "cotización", "cotizaciones"), style = MaterialTheme.typography.labelMedium, color = c.tintaSuave)
                cl.cotizaciones.firstOrNull()?.let { Text("Última: ${Fechas.corta(it.actualizada)}", style = MaterialTheme.typography.labelSmall, color = c.apagado) }
            }
        }
        AnimatedVisibility(abierto) {
            Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Divisor()
                listOf("Giro" to cl.giro, "Dirección" to cl.direccion, "Correo" to cl.correo, "Notas" to cl.notas).forEach { (k, v) ->
                    if (!v.isNullOrBlank()) Row { Rotulo("$k  "); Text(v, style = MaterialTheme.typography.bodySmall, color = c.tinta) }
                }
                etiquetaDocumentoFacturacion(null, cl.documentoHabitual, null, cl.receptorFacturacion)?.let {
                    Row { Rotulo("Documento habitual  "); Text(it, style = MaterialTheme.typography.bodySmall, color = c.tinta) }
                }
                if (cl.cotizaciones.isNotEmpty()) {
                    Rotulo("Cotizaciones recientes")
                    cl.cotizaciones.forEach { q ->
                        Row(
                            Modifier.fillMaxWidth().clickable { abrirCotizacion(q.id) }.padding(vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(numeroCotizacion(q.numero), style = MaterialTheme.typography.titleSmall, color = c.verde)
                            Spacer(Modifier.width(8.dp))
                            PildoraEstado(q.estado)
                            Spacer(Modifier.width(8.dp))
                            Text(listOfNotNull(q.proyecto, Fechas.corta(q.actualizada)).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = c.apagado, modifier = Modifier.weight(1f))
                            Text(pesos(q.total), style = MaterialTheme.typography.bodySmall, color = c.tinta)
                        }
                    }
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    BotonSecundario(if (cl.registrado) "Editar" else "Guardar como cliente", editar, icono = if (cl.registrado) Iconos.Lapiz else Iconos.Mas)
                    if (cl.registrado && admin) BotonTexto("Eliminar cliente", eliminar, peligro = true, icono = Iconos.Basura)
                }
            }
        }
    }
}

/** Alta o edición de un cliente frecuente, con su documento habitual y el receptor de la factura. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun HojaCliente(base: ClienteDirectorio?, alCerrar: () -> Unit, alGuardar: () -> Unit) {
    val c = Neltume.colores
    val api = LocalContenedor.current.api
    val avisos = LocalAvisos.current
    val alcance = rememberCoroutineScope()
    val edita = base?.registrado == true && base.id != null
    var nombre by remember { mutableStateOf(base?.nombre ?: "") }
    var rut by remember { mutableStateOf(base?.rut ?: "") }
    var giro by remember { mutableStateOf(base?.giro ?: "") }
    var telefono by remember { mutableStateOf(base?.telefono ?: "") }
    var comuna by remember { mutableStateOf(base?.comuna ?: "") }
    var direccion by remember { mutableStateOf(base?.direccion ?: "") }
    var correo by remember { mutableStateOf(base?.correo ?: "") }
    var notas by remember { mutableStateOf(base?.notas ?: "") }
    var documento by remember { mutableStateOf(base?.documentoHabitual) }
    var receptor by remember { mutableStateOf(base?.receptorFacturacion ?: ReceptorFacturacion()) }
    var errores by remember { mutableStateOf(mapOf<String, String>()) }
    var duplicado by remember { mutableStateOf<String?>(null) }
    var guardando by remember { mutableStateOf(false) }
    fun guardar() {
        val e = mutableMapOf<String, String>()
        if (nombre.isBlank()) e["nombre"] = "El nombre del cliente es obligatorio."
        if (rut.isNotBlank() && normalizarRut(rut) == null) e["rut"] = "El RUT no es válido. Revísalo."
        if (correo.isNotBlank() && !correoValido(correo)) e["correo"] = "El correo no es válido."
        if (documento == TipoDocumento.FACTURA) {
            receptor.rut?.takeIf { it.isNotBlank() }?.let { if (normalizarRut(it) == null) e["receptor.rut"] = "El RUT de facturación no es válido." }
            receptor.correo?.takeIf { it.isNotBlank() }?.let { if (!correoValido(it)) e["receptor.correo"] = "El correo de facturación no es válido." }
        }
        errores = e
        if (e.isNotEmpty()) return
        val cuerpo = buildJsonObject {
            if (edita) {
                put("id", base!!.id)
                put("actualizado", base.actualizado)
            }
            put("nombre", nombre.trim())
            put("rut", rut.trim().ifEmpty { null })
            put("giro", giro.trim().ifEmpty { null })
            put("telefono", telefono.trim().ifEmpty { null })
            put("direccion", direccion.trim().ifEmpty { null })
            put("comuna", comuna.trim().ifEmpty { null })
            put("correo", correo.trim().ifEmpty { null })
            put("notas", notas.trim().ifEmpty { null })
            put("documentoHabitual", documento?.clave)
            put("receptorFacturacion", if (documento == TipoDocumento.FACTURA) Acciones.receptorJson(receptor) else JsonNull)
        }
        alcance.launch {
            guardando = true
            try {
                if (edita) api.editarCliente(cuerpo) else api.crearCliente(cuerpo)
                avisos.mostrar(if (edita) "Cliente actualizado." else "Cliente guardado.")
                alGuardar()
            } catch (x: FalloApi) {
                if (x.codigo == "rut_duplicado") duplicado = x.message else errores = mapOf("general" to (x.message ?: ""))
            } finally {
                guardando = false
            }
        }
    }
    ModalBottomSheet(alCerrar, sheetState = rememberModalBottomSheetState(true), containerColor = c.superficie) {
        Column(
            Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).navigationBarsPadding().padding(bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            TituloSeccion(if (edita) "Editar cliente" else "Nuevo cliente frecuente")
            Campo(nombre, { nombre = it }, "Nombre o razón social", error = errores["nombre"], mayusculas = KeyboardCapitalization.Words, largoMaximo = 300)
            Campo(rut, { rut = it }, "RUT", error = errores["rut"], mayusculas = KeyboardCapitalization.Characters, largoMaximo = 20)
            Campo(giro, { giro = it }, "Giro", largoMaximo = 300)
            Campo(telefono, { telefono = it }, "Teléfono", teclado = KeyboardType.Phone, largoMaximo = 300)
            Campo(comuna, { comuna = it }, "Ciudad / comuna", mayusculas = KeyboardCapitalization.Words, largoMaximo = 300)
            Campo(direccion, { direccion = it }, "Dirección", largoMaximo = 300)
            Campo(correo, { correo = it }, "Correo", error = errores["correo"], teclado = KeyboardType.Email, largoMaximo = 300)
            Campo(notas, { notas = it }, "Notas", lineas = 2, largoMaximo = 1000)
            Rotulo("Documento habitual")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ChipFiltro("Sin definir", documento == null, { documento = null })
                ChipFiltro("Boleta", documento == TipoDocumento.BOLETA, { documento = TipoDocumento.BOLETA })
                ChipFiltro("Factura", documento == TipoDocumento.FACTURA, { documento = TipoDocumento.FACTURA })
            }
            if (documento == TipoDocumento.FACTURA) {
                BotonTexto("Usar los datos del cliente", {
                    receptor = ReceptorFacturacion(nombre.ifBlank { null }, rut.ifBlank { null }, giro.ifBlank { null }, direccion.ifBlank { null }, comuna.ifBlank { null }, correo.ifBlank { null })
                }, icono = Iconos.Copiar)
                CamposReceptor(receptor, mapOf("rut" to (errores["receptor.rut"] ?: ""), "correo" to (errores["receptor.correo"] ?: "")).filterValues { it.isNotEmpty() }) { receptor = it }
            }
            duplicado?.let { Aviso(it, tono = TonoAviso.ATENCION) }
            errores["general"]?.let { Aviso(it, tono = TonoAviso.PELIGRO) }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                BotonSecundario("Cancelar", alCerrar, Modifier.weight(1f))
                BotonPrincipal("Guardar", ::guardar, Modifier.weight(1f), cargando = guardando)
            }
        }
    }
}
