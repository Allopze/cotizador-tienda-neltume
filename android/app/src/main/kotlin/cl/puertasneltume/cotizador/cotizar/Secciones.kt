package cl.puertasneltume.cotizador.cotizar

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import cl.puertasneltume.cotizador.comun.LocalAvisos
import cl.puertasneltume.cotizador.comun.LocalContenedor
import cl.puertasneltume.cotizador.comun.LocalNavegador
import cl.puertasneltume.cotizador.diseno.Aviso
import cl.puertasneltume.cotizador.diseno.BotonIcono
import cl.puertasneltume.cotizador.diseno.BotonPrincipal
import cl.puertasneltume.cotizador.diseno.BotonSecundario
import cl.puertasneltume.cotizador.diseno.BotonTexto
import cl.puertasneltume.cotizador.diseno.Campo
import cl.puertasneltume.cotizador.diseno.CampoPesos
import cl.puertasneltume.cotizador.diseno.ChipFiltro
import cl.puertasneltume.cotizador.diseno.Divisor
import cl.puertasneltume.cotizador.diseno.Hoja
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Radios
import cl.puertasneltume.cotizador.diseno.Rotulo
import cl.puertasneltume.cotizador.diseno.TonoAviso
import cl.puertasneltume.cotizador.navegacion.Seccion
import cl.puertasneltume.cotizador.nucleo.api.Acciones
import cl.puertasneltume.cotizador.nucleo.api.FalloApi
import cl.puertasneltume.cotizador.nucleo.api.texto
import cl.puertasneltume.cotizador.nucleo.modelo.CampoCliente
import cl.puertasneltume.cotizador.nucleo.modelo.ClienteRegistrado
import cl.puertasneltume.cotizador.nucleo.modelo.Cotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.EstadoCotizacion
import cl.puertasneltume.cotizador.nucleo.reglas.ETIQUETA_CAMPO
import cl.puertasneltume.cotizador.nucleo.reglas.Limites
import cl.puertasneltume.cotizador.nucleo.reglas.aPesos
import cl.puertasneltume.cotizador.nucleo.reglas.bonito
import cl.puertasneltume.cotizador.nucleo.reglas.cantidadFlete
import cl.puertasneltume.cotizador.nucleo.reglas.contarPuertas
import cl.puertasneltume.cotizador.nucleo.reglas.descripcionFlete
import cl.puertasneltume.cotizador.nucleo.reglas.descuentoEsManual
import cl.puertasneltume.cotizador.nucleo.reglas.despachoEditable
import cl.puertasneltume.cotizador.nucleo.reglas.etiquetaDescuento
import cl.puertasneltume.cotizador.nucleo.reglas.ivaTexto
import cl.puertasneltume.cotizador.nucleo.reglas.jsTexto
import cl.puertasneltume.cotizador.nucleo.reglas.leerPesos
import cl.puertasneltume.cotizador.nucleo.reglas.leerPorcentaje
import cl.puertasneltume.cotizador.nucleo.reglas.leerPorcentajeConSigno
import cl.puertasneltume.cotizador.nucleo.reglas.errorMargenTexto
import cl.puertasneltume.cotizador.nucleo.reglas.margenAPorcentaje
import cl.puertasneltume.cotizador.nucleo.reglas.numeroNota
import cl.puertasneltume.cotizador.nucleo.reglas.ordenarNotas
import cl.puertasneltume.cotizador.nucleo.reglas.pct
import cl.puertasneltume.cotizador.nucleo.reglas.pesos
import cl.puertasneltume.cotizador.nucleo.reglas.porcentajeAMargen
import cl.puertasneltume.cotizador.nucleo.reglas.resumenDescuentosItems
import cl.puertasneltume.cotizador.nucleo.reglas.siguienteTramo
import cl.puertasneltume.cotizador.nucleo.reglas.sinTransportista
import cl.puertasneltume.cotizador.nucleo.reglas.textoPuertas
import cl.puertasneltume.cotizador.nucleo.reglas.textoTramo
import cl.puertasneltume.cotizador.nucleo.reglas.tramoAplicable
import cl.puertasneltume.cotizador.nucleo.reglas.unitarioFlete
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/** Cliente, despacho, observaciones y ganancia especial: plegadas, con su resumen a la vista. */
@Composable
fun Secciones(q: Cotizacion, editable: Boolean, ocultarCostos: Boolean, e: EstadoCotizador, vm: CotizadorViewModel) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SeccionCliente(q, editable, e, vm)
        if (editable || despachoEditable(q) || q.despacho != null) SeccionDespacho(q, editable, e, vm)
        if (editable || !q.observaciones.isNullOrBlank()) SeccionObservaciones(q, editable, e, vm)
        if (!ocultarCostos && (editable || q.margenCotizacion != null)) SeccionGanancia(q, editable, e, vm)
    }
}

// --- Cliente --------------------------------------------------------------------------------------------------

@Composable
private fun SeccionCliente(q: Cotizacion, editable: Boolean, e: EstadoCotizador, vm: CotizadorViewModel) {
    val c = Neltume.colores
    val contenedor = LocalContenedor.current
    val avisos = LocalAvisos.current
    val navegador = LocalNavegador.current
    val alcance = rememberCoroutineScope()
    val cl = q.cliente
    val resumen = listOfNotNull(cl.nombre, cl.rut, cl.comuna, cl.telefono).joinToString(" · ").ifEmpty { "Sin datos del cliente (son opcionales)" }
    var valores by remember(q.id, q.actualizada) { mutableStateOf(CampoCliente.entries.associateWith { cl.valor(it) ?: "" }) }
    var sugerencias by remember { mutableStateOf<List<cl.puertasneltume.cotizador.nucleo.modelo.ClienteDirectorio>>(emptyList()) }
    var buscar by remember { mutableStateOf<String?>(null) }
    var registrado by remember(q.cliente.rut) { mutableStateOf<ClienteRegistrado?>(null) }

    LaunchedEffect(buscar) {
        val texto = buscar ?: return@LaunchedEffect
        if (texto.trim().length < 2) {
            sugerencias = emptyList()
            return@LaunchedEffect
        }
        delay(300)
        sugerencias = runCatching { contenedor.api.sugerirClientes(texto, q.id) }.getOrDefault(emptyList()).take(6)
    }
    LaunchedEffect(q.cliente.rut) {
        registrado = q.cliente.rut?.let { rut -> runCatching { contenedor.api.clientePorRut(rut) }.getOrNull() }
    }

    SeccionPlegable("Cliente y facturación", resumen, Iconos.Usuario) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            ETIQUETA_CAMPO.forEach { (campo, etiqueta) ->
                Campo(
                    valores.getValue(campo),
                    { nuevo ->
                        valores = valores + (campo to nuevo)
                        if (campo == CampoCliente.NOMBRE || campo == CampoCliente.RUT) buscar = nuevo
                    },
                    etiqueta,
                    habilitado = editable && !e.ocupado,
                    teclado = if (campo == CampoCliente.TELEFONO) KeyboardType.Phone else KeyboardType.Text,
                    mayusculas = if (campo == CampoCliente.RUT) KeyboardCapitalization.Characters else KeyboardCapitalization.Words,
                    largoMaximo = 300,
                )
                if ((campo == CampoCliente.NOMBRE || campo == CampoCliente.RUT) && sugerencias.isNotEmpty() && buscar == valores[campo])
                    Sugerencias(sugerencias) { s ->
                        valores = valores + mapOf(
                            CampoCliente.NOMBRE to (s.nombre ?: ""),
                            CampoCliente.RUT to (s.rut ?: ""),
                            CampoCliente.GIRO to (s.giro ?: ""),
                            CampoCliente.TELEFONO to (s.telefono ?: ""),
                            CampoCliente.DIRECCION to (s.direccion ?: ""),
                            CampoCliente.COMUNA to (s.comuna ?: ""),
                        )
                        sugerencias = emptyList()
                        buscar = null
                    }
            }
            if (editable) {
                val cambiados = CampoCliente.entries.filter { (valores.getValue(it).trim().ifEmpty { null }) != cl.valor(it) }
                BotonPrincipal(
                    "Guardar cliente",
                    { vm.editar("cliente", { cambiados.forEach { cliente(it.clave, valores.getValue(it)) } }) },
                    Modifier.fillMaxWidth(),
                    habilitado = cambiados.isNotEmpty() && !e.ocupado,
                    cargando = e.guardando == "cliente",
                )
            }
            if (registrado != null) BotonTexto("Ver en Clientes", { navegador.ir(Seccion.CLIENTES) }, icono = Iconos.Clientes)
            else if (!cl.nombre.isNullOrBlank()) BotonTexto("Guardar como cliente frecuente", {
                alcance.launch {
                    try {
                        registrado = contenedor.api.crearCliente(buildJsonObject {
                            put("nombre", cl.nombre)
                            put("rut", cl.rut)
                            put("giro", cl.giro)
                            put("telefono", cl.telefono)
                            put("direccion", cl.direccion)
                            put("comuna", cl.comuna)
                        })
                        avisos.mostrar("Cliente guardado en Clientes.")
                    } catch (x: FalloApi) {
                        if (x.codigo == "rut_duplicado") avisos.mostrar(x.message ?: "", "Abrir ficha existente", largo = true) { navegador.ir(Seccion.CLIENTES) }
                        else avisos.mostrar(x.message ?: "", largo = true)
                    }
                }
            }, icono = Iconos.Clientes)
        }
    }
}

@Composable
private fun Sugerencias(lista: List<cl.puertasneltume.cotizador.nucleo.modelo.ClienteDirectorio>, elegir: (cl.puertasneltume.cotizador.nucleo.modelo.ClienteDirectorio) -> Unit) {
    val c = Neltume.colores
    Column(Modifier.fillMaxWidth().clip(Radios.lg).border(1.dp, c.linea, Radios.lg).background(c.panel)) {
        Rotulo("Clientes anteriores", Modifier.padding(start = 12.dp, top = 8.dp))
        lista.forEach { s ->
            Column(Modifier.fillMaxWidth().clickable { elegir(s) }.padding(horizontal = 12.dp, vertical = 10.dp)) {
                Text(s.nombre ?: "", style = MaterialTheme.typography.titleSmall, color = c.tinta)
                Text(listOfNotNull(s.rut, s.comuna, s.telefono).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = c.apagado)
            }
        }
    }
}

// --- Despacho -------------------------------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SeccionDespacho(q: Cotizacion, editable: Boolean, e: EstadoCotizador, vm: CotizadorViewModel) {
    val contenedor = LocalContenedor.current
    val d = q.despacho
    val aprobada = q.estado == EstadoCotizacion.APROBADA
    val puedeEditar = (editable || despachoEditable(q)) && !e.ocupado
    var transportistas by remember { mutableStateOf<List<String>?>(null) }
    var destino by remember(q.id, q.actualizada) { mutableStateOf(d?.destino ?: "") }
    var direccion by remember(q.id, q.actualizada) { mutableStateOf(d?.direccion ?: "") }
    var entrega by remember(q.id, q.actualizada) { mutableStateOf(d?.entregaComprometida ?: "") }
    var transporte by remember(q.id, q.actualizada) { mutableStateOf(d?.transporte ?: "") }
    var otro by remember(q.id) { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        transportistas = runCatching {
            ((contenedor.api.obtenerJson("api/configuracion-negocio")["configuracion"] as? JsonObject)?.get("transportistas") as? JsonArray)
                ?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
        }.getOrNull() ?: emptyList()
    }
    val resumen = listOfNotNull(
        d?.destino,
        d?.transporte?.takeIf { !sinTransportista(it) },
        if (q.flete > 0) "${pesos(q.flete)} sin IVA" else null,
    ).joinToString(" · ").ifEmpty { "Destino, transporte y costo por confirmar" }

    fun guardar() {
        val json = Acciones.despachoJson(direccion, transporte, entrega, destino)
        if (aprobada) vm.flujo({ Acciones.despacho(it.id, it.actualizada, json) }, "Despacho actualizado.")
        else vm.editar("despacho", { despacho(json) })
    }

    SeccionPlegable("Despacho", resumen, Iconos.Camion) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Campo(destino, { destino = it }, "Destino (comuna o ciudad)", habilitado = puedeEditar, largoMaximo = 300, mayusculas = KeyboardCapitalization.Words)
            Campo(direccion, { direccion = it }, "Dirección de despacho", habilitado = puedeEditar, largoMaximo = 300)
            Rotulo("Transportista")
            val lista = transportistas.orEmpty().filter { !sinTransportista(it) }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                lista.forEach { t -> ChipFiltro(t, !otro && transporte.equals(t, ignoreCase = true), { if (puedeEditar) { transporte = t; otro = false } }) }
                val libre = transporte.isNotBlank() && lista.none { it.equals(transporte, ignoreCase = true) }
                ChipFiltro("Otro", otro || libre, { if (puedeEditar) { otro = true; if (!libre) transporte = "" } })
            }
            if (otro || (transporte.isNotBlank() && transportistas != null && transportistas!!.none { it.equals(transporte, ignoreCase = true) }))
                Campo(
                    transporte,
                    { transporte = it },
                    "Nombre del transportista",
                    habilitado = puedeEditar,
                    error = if (otro && transporte.isNotBlank() && sinTransportista(transporte)) "Escribe el nombre del transportista." else null,
                    largoMaximo = 120,
                )
            Campo(entrega, { entrega = it }, "Entrega comprometida", habilitado = puedeEditar, ayuda = "Fecha o compromiso con el cliente", largoMaximo = 120)
            Text(
                "Valor de despacho: ${if (q.flete > 0) "${pesos(q.flete)} sin IVA" else "sin flete"}. Se edita en la línea de flete del pedido.",
                style = MaterialTheme.typography.bodySmall,
                color = Neltume.colores.apagado,
            )
            if (puedeEditar) BotonPrincipal(
                "Guardar despacho",
                ::guardar,
                Modifier.fillMaxWidth(),
                habilitado = destino != (d?.destino ?: "") || direccion != (d?.direccion ?: "") || entrega != (d?.entregaComprometida ?: "") || transporte != (d?.transporte ?: ""),
                cargando = e.guardando == "despacho",
            )
            if (editable && (d?.transporte ?: "").trim().equals("starken", ignoreCase = true)) CotizarStarken(q, e, vm)
        }
    }
}

/** Tarifas de Starken para el bulto de la cotización; elegir una deja su neto como valor de despacho. */
@Composable
private fun CotizarStarken(q: Cotizacion, e: EstadoCotizador, vm: CotizadorViewModel) {
    val c = Neltume.colores
    val contenedor = LocalContenedor.current
    val alcance = rememberCoroutineScope()
    var disponible by remember { mutableStateOf<Boolean?>(null) }
    var mensaje by remember { mutableStateOf<String?>(null) }
    var resultado by remember(q.id) { mutableStateOf<JsonObject?>(null) }
    var cargando by remember { mutableStateOf(false) }
    var busqueda by remember { mutableStateOf("") }
    var ciudades by remember { mutableStateOf<List<JsonObject>>(emptyList()) }
    LaunchedEffect(Unit) {
        runCatching { contenedor.api.obtenerJson("api/starken") }.onSuccess {
            disponible = (it["disponible"] as? JsonPrimitive)?.contentOrNull == "true"
            mensaje = it.texto("mensaje")
        }.onFailure { disponible = false; mensaje = it.message }
    }
    suspend fun cargarCiudades() {
        if (ciudades.isEmpty()) ciudades = runCatching {
            (contenedor.api.obtenerJson("api/starken/ciudades", mapOf("tipo" to "destino"))["ciudades"] as? JsonArray)?.map { it.jsonObject }
        }.getOrNull().orEmpty()
    }
    fun cotizar(codigoCiudad: Int? = null) = alcance.launch {
        cargando = true
        try {
            resultado = contenedor.api.enviarJson("api/starken/cotizar", buildJsonObject {
                put("id", q.id)
                if (codigoCiudad != null) put("codigoCiudad", codigoCiudad)
            }, larga = true)
            if (resultado?.texto("estado") == "elegir_ciudad") cargarCiudades()
        } catch (x: FalloApi) {
            mensaje = x.message
        } finally {
            cargando = false
        }
    }
    Divisor(Modifier.padding(vertical = 4.dp))
    if (disponible == false) {
        Aviso(mensaje ?: "Starken no está configurado.", tono = TonoAviso.ATENCION)
        return
    }
    val r = resultado
    if (r == null) {
        BotonSecundario("Cotizar con Starken", { cotizar() }, Modifier.fillMaxWidth(), icono = Iconos.Camion, cargando = cargando, habilitado = disponible == true && !e.ocupado)
        mensaje?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = c.apagado) }
        return
    }
    when (r.texto("estado")) {
        "tarifas" -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val destino = r["destino"]?.jsonObject
            Text("${r.texto("textoBulto") ?: ""} · destino ${destino?.texto("nombre")?.let(::bonito) ?: ""}", style = MaterialTheme.typography.bodySmall, color = c.apagado)
            (r["tarifas"] as? JsonArray)?.map { it.jsonObject }?.forEach { t ->
                val total = (t["costoTotal"] as JsonPrimitive).content.toDouble().toLong()
                val neto = (t["neto"] as JsonPrimitive).content.toDouble().toLong()
                val dias = (t["dias"] as JsonPrimitive).content.toDouble().toInt()
                Row(
                    Modifier.fillMaxWidth().clip(Radios.lg).border(1.dp, c.linea, Radios.lg).padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("${bonito(t.texto("tipoEntrega") ?: "")} · $dias ${if (dias == 1) "día" else "días"}", style = MaterialTheme.typography.titleSmall, color = c.tinta)
                        Text("${pesos(total)} IVA incl. (${pesos(neto)} sin IVA)", style = MaterialTheme.typography.bodySmall, color = c.apagado)
                    }
                    BotonTexto("Usar", {
                        vm.editar("despacho.valor", {
                            despacho(buildJsonObject {
                                put("valor", neto)
                                if (q.despacho?.destino.isNullOrBlank()) put("destino", bonito(destino?.texto("nombre") ?: ""))
                            })
                            tarifaStarken(buildJsonObject {
                                put("tipoEntrega", t.texto("tipoEntrega"))
                                t.texto("servicio")?.let { put("servicio", it) }
                                put("dias", dias)
                                put("costoTotal", total)
                                put("ciudadDestino", destino?.texto("nombre"))
                                put("codigoCiudadDestino", (destino?.get("codigoCiudad") as JsonPrimitive).content.toDouble().toInt())
                                put("vence", t.texto("vence"))
                                put("firma", t.texto("firma"))
                                put("huellaBulto", t.texto("huellaBulto"))
                            })
                        }) { ok -> if (ok) resultado = null }
                    })
                }
            }
            BotonTexto("Cambiar ciudad", {
                resultado = buildJsonObject {
                    put("estado", "elegir_ciudad")
                    put("motivo", "no_encontrada")
                }
                busqueda = ""
                alcance.launch { cargarCiudades() }
            })
        }
        else -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                if (r.texto("motivo") == "ambigua") "Hay varias ciudades posibles para el destino. Elige una:" else "No encontré el destino en Starken. Busca la ciudad:",
                style = MaterialTheme.typography.bodySmall,
                color = c.tinta,
            )
            Campo(busqueda, { busqueda = it }, "Buscar ciudad", icono = Iconos.Buscar)
            val candidatas = (r["candidatas"] as? JsonArray)?.map { it.jsonObject }.orEmpty()
            val lista = if (busqueda.isBlank() && candidatas.isNotEmpty()) candidatas
            else ciudades.filter { ci ->
                val b = cl.puertasneltume.cotizador.nucleo.reglas.plano(busqueda)
                b.isNotEmpty() && (cl.puertasneltume.cotizador.nucleo.reglas.plano(ci.texto("nombre")).contains(b) ||
                    (ci["comunas"] as? JsonArray)?.any { cl.puertasneltume.cotizador.nucleo.reglas.plano((it as JsonPrimitive).content).contains(b) } == true)
            }.take(30)
            lista.forEach { ci ->
                Text(
                    bonito(ci.texto("nombre") ?: ""),
                    style = MaterialTheme.typography.bodyMedium,
                    color = c.verde,
                    modifier = Modifier.fillMaxWidth().clip(Radios.md).clickable { cotizar((ci["codigoCiudad"] as JsonPrimitive).content.toDouble().toInt()) }.padding(10.dp),
                )
            }
        }
    }
}

// --- Observaciones y ganancia ---------------------------------------------------------------------------------

@Composable
private fun SeccionObservaciones(q: Cotizacion, editable: Boolean, e: EstadoCotizador, vm: CotizadorViewModel) {
    var texto by remember(q.id, q.actualizada) { mutableStateOf(q.observaciones ?: "") }
    SeccionPlegable("Observaciones", q.observaciones?.takeIf { it.isNotBlank() } ?: "Agregar indicaciones para el documento", Iconos.Notas) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Campo(texto, { texto = it }, "Observaciones", lineas = 3, habilitado = editable && !e.ocupado, largoMaximo = 2000)
            if (editable) BotonPrincipal(
                "Guardar observaciones",
                { vm.editar("observaciones", { observaciones(texto) }) },
                Modifier.fillMaxWidth(),
                habilitado = texto.trim() != (q.observaciones ?: "") && !e.ocupado,
                cargando = e.guardando == "observaciones",
            )
        }
    }
}

@Composable
private fun SeccionGanancia(q: Cotizacion, editable: Boolean, e: EstadoCotizador, vm: CotizadorViewModel) {
    var texto by remember(q.id, q.actualizada) { mutableStateOf(q.margenCotizacion?.let { jsTexto(margenAPorcentaje(it)).replace('.', ',') } ?: "") }
    var error by remember { mutableStateOf<String?>(null) }
    SeccionPlegable(
        "Ganancia especial de la cotización",
        q.margenCotizacion?.let { "${pct(margenAPorcentaje(it))} en todos los productos" } ?: "La de cada categoría",
        Iconos.Porcentaje,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                "Pasa por encima de la ganancia de cada categoría y por debajo de la de cada línea. No cambia la nota de pedido.",
                style = MaterialTheme.typography.bodySmall,
                color = Neltume.colores.apagado,
            )
            Campo(texto, { texto = it; error = null }, "Ganancia", error = error, teclado = KeyboardType.Decimal, sufijo = "%", habilitado = editable && !e.ocupado)
            if (editable) Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (q.margenCotizacion != null) BotonSecundario("Restaurar", { vm.editar("margen", { margenCotizacion(null) }) }, Modifier.weight(1f))
                BotonPrincipal("Aplicar", {
                    error = errorMargenTexto(texto)
                    if (error == null) vm.editar("margen", { margenCotizacion(porcentajeAMargen(leerPorcentajeConSigno(texto))) })
                }, Modifier.weight(1f), habilitado = texto.isNotBlank(), cargando = e.guardando == "margen")
            }
        }
    }
}

// --- Flete ----------------------------------------------------------------------------------------------------

@Composable
fun LineaFlete(q: Cotizacion, editable: Boolean, ocupado: Boolean, vm: CotizadorViewModel) {
    val c = Neltume.colores
    var abierto by remember(q.id) { mutableStateOf(false) }
    var descripcion by remember(q.id, q.actualizada) { mutableStateOf(q.fleteDescripcion ?: "") }
    var cantidad by remember(q.id, q.actualizada) { mutableStateOf(cantidadFlete(q).toString()) }
    var unitario by remember(q.id, q.actualizada) { mutableStateOf(if (q.flete > 0) unitarioFlete(q).toString() else "") }
    if (q.flete <= 0 && !abierto) {
        BotonTexto("Agregar flete", { abierto = true }, icono = Iconos.Camion, habilitado = !ocupado)
        return
    }
    Hoja(relleno = androidx.compose.foundation.layout.PaddingValues(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(descripcionFlete(q), style = MaterialTheme.typography.titleSmall, color = c.tinta)
                Text("FLETE · ${cantidadFlete(q)} × ${pesos(unitarioFlete(q))}", style = MaterialTheme.typography.bodySmall, color = c.apagado)
            }
            Text(pesos(q.flete), style = MaterialTheme.typography.titleMedium, color = c.tinta)
            if (editable && q.flete > 0) BotonIcono(Iconos.Cerrar, "Quitar flete", { vm.editar("flete", { quitarFlete() }) }, habilitado = !ocupado)
        }
        if (editable) {
            Spacer(Modifier.height(10.dp))
            Campo(descripcion, { descripcion = it }, "Descripción", ayuda = "Vacía: «${descripcionFlete(q.copy(fleteDescripcion = null))}»", largoMaximo = 300)
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Campo(cantidad, { cantidad = it.filter(Char::isDigit) }, "Cantidad", Modifier.weight(1f), teclado = KeyboardType.Number)
                CampoPesos(unitario, { unitario = it }, "Unitario sin IVA", Modifier.weight(1.4f))
            }
            Spacer(Modifier.height(8.dp))
            BotonPrincipal("Guardar flete", {
                val u = leerPesos(unitario).aPesos()
                val n = cantidad.toIntOrNull()
                if (u != null && u >= 0 && n != null && n >= 1) vm.editar("flete", { fleteLinea(descripcion, n, u) }) { if (it) abierto = false }
            }, Modifier.fillMaxWidth(), habilitado = unitario.isNotBlank() && !ocupado)
        }
    }
}

// --- Totales --------------------------------------------------------------------------------------------------

/** Subtotal, descuento (automático por cantidad o fijado a mano), flete, neto, IVA y total. */
@Composable
fun Totales(q: Cotizacion, editable: Boolean, e: EstadoCotizador, vm: CotizadorViewModel) {
    val c = Neltume.colores
    val m = q.montos
    val reglas = q.reglas
    var descuento by remember(q.id, q.actualizada) { mutableStateOf(if (q.descuento > 0) jsTexto(q.descuento).replace('.', ',') else "") }
    var error by remember { mutableStateOf<String?>(null) }
    val (ahorro, subtotalOriginal) = resumenDescuentosItems(m)
    val puertas = contarPuertas(m.lineas)
    val tramos = reglas?.descuentosPorCantidad.orEmpty()
    Hoja {
        Text("Totales", style = MaterialTheme.typography.headlineSmall, color = c.tinta)
        Spacer(Modifier.height(10.dp))
        if (ahorro > 0) {
            FilaTotal("Subtotal original", pesos(subtotalOriginal + m.flete))
            FilaTotal("Ahorro por descuentos especiales", "−${pesos(ahorro)}")
        }
        FilaTotal("Subtotal", pesos(m.subtotal + m.flete))
        if (m.descuento > 0) FilaTotal("${etiquetaDescuento(q)} ${pct(m.descuentoPorcentaje)}", "−${pesos(m.descuento)}")
        if (tramos.isNotEmpty() && !descuentoEsManual(q)) {
            val tramo = tramoAplicable(tramos, puertas)
            val siguiente = siguienteTramo(tramos, puertas)
            Text(
                listOfNotNull(
                    tramo?.let { "${textoPuertas(puertas)} → ${pct(it.porcentaje)}" },
                    siguiente?.let { "Siguiente tramo: ${textoTramo(it)}" },
                ).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                color = c.verde,
            )
        }
        FilaTotal("Neto (sin IVA)", pesos(m.neto))
        FilaTotal("IVA ${ivaTexto(reglas?.iva)}", pesos(m.iva))
        Divisor(Modifier.padding(vertical = 8.dp))
        FilaTotal("Total", pesos(m.total), destacado = true)
        if (editable) {
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Campo(
                    descuento,
                    { descuento = it; error = null },
                    "Descuento",
                    Modifier.weight(1f),
                    error = error,
                    teclado = KeyboardType.Decimal,
                    sufijo = "%",
                    ayuda = "Hasta ${pct(reglas?.descuentoMaximo ?: Limites.DESCUENTO_MAXIMO)}",
                )
                BotonSecundario("Aplicar", {
                    val d = leerPorcentaje(descuento)
                    val maximo = reglas?.descuentoMaximo ?: Limites.DESCUENTO_MAXIMO
                    if (!Limites.descuentoValido(d, maximo)) error = "El descuento debe estar entre 0 y ${pct(maximo)}, con hasta dos decimales."
                    else vm.editar("descuento", { descuento(d) })
                }, Modifier.padding(top = 6.dp), habilitado = !e.ocupado)
            }
            if (descuentoEsManual(q) && tramos.isNotEmpty())
                BotonTexto("Restaurar automático", { vm.editar("descuento", { descuentoAutomatico() }) }, icono = Iconos.Volver, habilitado = !e.ocupado)
        }
    }
}

@Composable
private fun FilaTotal(etiqueta: String, valor: String, destacado: Boolean = false) {
    val c = Neltume.colores
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(etiqueta, style = if (destacado) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyMedium, color = if (destacado) c.tinta else c.tintaSuave, modifier = Modifier.weight(1f))
        Text(valor, style = if (destacado) MaterialTheme.typography.headlineSmall else MaterialTheme.typography.bodyMedium, color = c.tinta)
    }
}

// --- Documentos -----------------------------------------------------------------------------------------------

/** PDF de la cotización y de cada nota de pedido: ver (con compartir y descargar), regenerar y cambiar número. */
@Composable
fun Documentos(q: Cotizacion, admin: Boolean, ocupado: Boolean, vm: CotizadorViewModel, acciones: AccionesCotizar) {
    val c = Neltume.colores
    var cambiar by remember { mutableStateOf<Triple<String, cl.puertasneltume.cotizador.nucleo.modelo.Fabrica?, Int>?>(null) }
    Hoja {
        Text("Documentos", style = MaterialTheme.typography.headlineSmall, color = c.tinta)
        Spacer(Modifier.height(8.dp))
        q.pdf?.let { pdf ->
            FilaDocumento("Cotización ${q.numero?.let { "N° $it" } ?: ""}", "Para el cliente", { acciones.verDocumento(pdf) },
                cambiarNumero = if (admin && q.numero != null && (q.estado == EstadoCotizacion.EMITIDA || q.estado == EstadoCotizacion.APROBADA)) ({ cambiar = Triple("cotizacion", null, q.numero!!) }) else null,
                regenerar = if (admin) ({ vm.regenerarPdf("cotizacion", null) }) else null,
                ocupado = ocupado,
            )
        }
        ordenarNotas(q.notas).forEach { n ->
            FilaDocumento(
                "Nota de pedido ${numeroNota(n.numero, n.fabrica)}",
                if (n.anulada) "Anulada" else "Para la fábrica · precios de fábrica",
                { acciones.verDocumento(n.pdf) },
                cambiarNumero = if (admin && !n.anulada && q.estado == EstadoCotizacion.APROBADA) ({ cambiar = Triple("nota", n.fabrica, n.numero) }) else null,
                regenerar = if (admin) ({ vm.regenerarPdf("nota", n.fabrica) }) else null,
                ocupado = ocupado,
            )
        }
    }
    cambiar?.let { (documento, fabrica, actual) ->
        DialogoCambiarNumero(documento, fabrica, actual, alCerrar = { cambiar = null }) { numero ->
            cambiar = null
            vm.flujo({ Acciones.cambiarNumero(it.id, it.actualizada, documento, numero, fabrica) })
        }
    }
}

@Composable
private fun FilaDocumento(titulo: String, detalle: String, ver: () -> Unit, cambiarNumero: (() -> Unit)?, regenerar: (() -> Unit)?, ocupado: Boolean) {
    val c = Neltume.colores
    var menu by remember { mutableStateOf(false) }
    Row(
        Modifier.fillMaxWidth().clip(Radios.lg).clickable(onClick = ver).padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        androidx.compose.foundation.layout.Box(Modifier.width(40.dp).height(48.dp).clip(Radios.sm).background(c.peligroVelo), contentAlignment = Alignment.Center) {
            Text("PDF", style = MaterialTheme.typography.labelSmall, color = c.peligro)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(titulo, style = MaterialTheme.typography.titleSmall, color = c.tinta)
            Text(detalle, style = MaterialTheme.typography.bodySmall, color = c.apagado)
        }
        if (cambiarNumero != null || regenerar != null) androidx.compose.foundation.layout.Box {
            BotonIcono(Iconos.MasOpciones, "Más acciones de $titulo", { menu = true }, habilitado = !ocupado)
            androidx.compose.material3.DropdownMenu(menu, { menu = false }) {
                ItemMenu("Ver", Iconos.Ojo) { menu = false; ver() }
                cambiarNumero?.let { ItemMenu("Cambiar N°", Iconos.Numero) { menu = false; it() } }
                regenerar?.let { ItemMenu("Regenerar PDF", Iconos.Recargar) { menu = false; it() } }
            }
        } else BotonIcono(Iconos.Derecha, "Ver $titulo", ver)
    }
}
