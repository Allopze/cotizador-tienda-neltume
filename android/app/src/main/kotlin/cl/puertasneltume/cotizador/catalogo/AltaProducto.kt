package cl.puertasneltume.cotizador.catalogo

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cl.puertasneltume.cotizador.Contenedor
import cl.puertasneltume.cotizador.comun.MarcoPantalla
import cl.puertasneltume.cotizador.comun.vm
import cl.puertasneltume.cotizador.cotizar.DialogoConfirmacion
import cl.puertasneltume.cotizador.diseno.Aviso
import cl.puertasneltume.cotizador.diseno.BotonPrincipal
import cl.puertasneltume.cotizador.diseno.BotonSecundario
import cl.puertasneltume.cotizador.diseno.Campo
import cl.puertasneltume.cotizador.diseno.Dato
import cl.puertasneltume.cotizador.diseno.FormaGlobo
import cl.puertasneltume.cotizador.diseno.FormaGloboAsistente
import cl.puertasneltume.cotizador.diseno.Hoja
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.PuntosEspera
import cl.puertasneltume.cotizador.diseno.Rotulo
import cl.puertasneltume.cotizador.diseno.TituloSeccion
import cl.puertasneltume.cotizador.diseno.TonoAviso
import cl.puertasneltume.cotizador.nucleo.api.FalloApi
import cl.puertasneltume.cotizador.nucleo.modelo.Producto
import cl.puertasneltume.cotizador.nucleo.modelo.ReglasComerciales
import cl.puertasneltume.cotizador.nucleo.reglas.CampoMedida
import cl.puertasneltume.cotizador.nucleo.reglas.Limites
import cl.puertasneltume.cotizador.nucleo.reglas.NOMBRES_CATEGORIA_MARGEN
import cl.puertasneltume.cotizador.nucleo.reglas.decimalCampo
import cl.puertasneltume.cotizador.nucleo.reglas.leerMedida
import cl.puertasneltume.cotizador.nucleo.reglas.leerPesos
import cl.puertasneltume.cotizador.nucleo.reglas.nombreProducto
import cl.puertasneltume.cotizador.nucleo.reglas.pesos
import cl.puertasneltume.cotizador.nucleo.reglas.porcentaje
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

// Agregar un producto al catálogo (src/app/alta-producto.tsx): el formulario es la vía manual y el asistente,
// opcional, lo completa a partir de una descripción. Ambas vías terminan en la misma propuesta revisable.

internal enum class CampoAlta { FAMILIA, MODELO, MADERA, TIPO, MEDIDA, ANCHO_MIN, ANCHO_MAX, LARGO, PRECIO }

private val VACIO: Map<CampoAlta, String> = CampoAlta.entries.associateWith { "" }

@Serializable
internal data class MensajeAlta(val rol: String = "asistente", val texto: String = "")

/** Atributos que el servidor interpretó (null = sin dato). */
@Serializable
internal data class BorradorAlta(
    val modelo: String? = null,
    val familia: String? = null,
    val madera: String? = null,
    val tipo: String? = null,
    val medida: String? = null,
    val anchoMin: Double? = null,
    val anchoMax: Double? = null,
    val largo: Double? = null,
    val precioNeto: Double? = null,
)

@Serializable
private data class RespuestaAlta(
    val id: String = "",
    val mensajes: List<MensajeAlta> = emptyList(),
    val propuesta: Producto? = null,
    val producto: Producto? = null,
    val borrador: BorradorAlta? = null,
    val avisos: List<String> = emptyList(),
)

@Serializable
private data class ConfiguracionNegocio(val reglas: ReglasComerciales = ReglasComerciales())

@Serializable
private data class RespuestaNegocio(val configuracion: ConfiguracionNegocio = ConfiguracionNegocio())

@Serializable
private data class EstadoAsistente(val asistenteConfigurado: Boolean = true)

internal enum class OcupadoAlta { ASISTENTE, REVISAR, GUARDAR }

/** Precio de venta, ganancia y categoría con que se cotizará el producto propuesto. */
internal data class Venta(val precio: Long, val ganancia: String, val categoria: String?)

internal class AltaViewModel(private val c: Contenedor) : ViewModel() {
    /** Las reglas vigentes: la vista previa usa la misma ganancia por categoría que la cotización. */
    var reglas by mutableStateOf(ReglasComerciales())
        private set

    /** Sin asistente sigue disponible el formulario: solo se oculta la descripción asistida. */
    var asistente by mutableStateOf(true)
        private set
    var campos by mutableStateOf(VACIO)
        private set

    /** Lo guardado (o vacío) es el punto de partida para saber si hay algo a medias. */
    private var base by mutableStateOf(VACIO)
    var avisos by mutableStateOf(emptyList<String>())
        private set
    var id by mutableStateOf<String?>(null)
        private set
    var mensajes by mutableStateOf(emptyList<MensajeAlta>())
        private set
    var mensaje by mutableStateOf("")
    var propuesta by mutableStateOf<Producto?>(null)
        private set
    var guardado by mutableStateOf<Producto?>(null)
        private set
    var ocupado by mutableStateOf<OcupadoAlta?>(null)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var errores by mutableStateOf(mapOf<CampoAlta, String>())
        private set

    val sucio: Boolean get() = guardado == null && (campos != base || mensaje.isNotBlank())

    /** Sin tipo elegido se muestran los campos de puerta (lo más común). */
    val puerta: Boolean get() = campos.getValue(CampoAlta.FAMILIA).let { it.isEmpty() || it == "PUERTA" }

    fun valor(campo: CampoAlta) = campos.getValue(campo)

    init {
        viewModelScope.launch {
            try {
                reglas = c.http.obtener(RespuestaNegocio.serializer(), "api/configuracion-negocio").configuracion.reglas
            } catch (e: FalloApi) {
                // Sin las reglas se usa la ganancia por omisión; el servidor calcula el precio real.
            }
        }
        viewModelScope.launch {
            try {
                asistente = c.http.obtener(EstadoAsistente.serializer(), "api/ajustes").asistenteConfigurado
            } catch (e: FalloApi) {
                // Si no se puede saber, se ofrece el asistente; el servidor dirá si falta.
            }
        }
    }

    fun venta(p: Producto): Venta {
        val ganancia = gananciaProducto(p, reglas)
        return Venta(
            precioVenta(p.precioNeto, ganancia),
            porcentaje(ganancia * 100),
            if (reglas.margenes != null) NOMBRES_CATEGORIA_MARGEN[categoriaGanancia(p)] else null,
        )
    }

    /** Cambiar un dato invalida la propuesta revisada: hay que volver a revisarla. */
    fun cambiar(campo: CampoAlta, valor: String) {
        campos = campos + (campo to valor)
        errores = errores - campo
        propuesta = null
        avisos = emptyList()
    }

    /** Vuelca en el formulario lo que el asistente entendió, sin borrar lo que ya estaba escrito. */
    private fun volcar(b: BorradorAlta) {
        val c = campos
        campos = mapOf(
            CampoAlta.FAMILIA to (b.familia ?: c.getValue(CampoAlta.FAMILIA)),
            CampoAlta.MODELO to (b.modelo ?: c.getValue(CampoAlta.MODELO)),
            CampoAlta.MADERA to (b.madera ?: c.getValue(CampoAlta.MADERA)),
            CampoAlta.TIPO to (b.tipo ?: c.getValue(CampoAlta.TIPO)),
            CampoAlta.MEDIDA to (b.medida ?: c.getValue(CampoAlta.MEDIDA)),
            CampoAlta.ANCHO_MIN to (b.anchoMin?.let(::decimalCampo) ?: c.getValue(CampoAlta.ANCHO_MIN)),
            CampoAlta.ANCHO_MAX to (b.anchoMax?.let(::decimalCampo) ?: c.getValue(CampoAlta.ANCHO_MAX)),
            CampoAlta.LARGO to (b.largo?.let(::decimalCampo) ?: c.getValue(CampoAlta.LARGO)),
            CampoAlta.PRECIO to (b.precioNeto?.let(::decimalCampo) ?: c.getValue(CampoAlta.PRECIO)),
        )
    }

    fun describir() {
        if (mensaje.isBlank() || ocupado != null || guardado != null) return
        ocupado = OcupadoAlta.ASISTENTE
        error = null
        val texto = mensaje
        viewModelScope.launch {
            try {
                val d = c.pedirCatalogo(RespuestaAlta.serializer(), buildJsonObject {
                    put("tipo", "mensaje")
                    id?.let { put("id", it) }
                    put("mensaje", texto)
                }, larga = true)
                id = d.id
                mensajes = d.mensajes
                d.borrador?.let(::volcar)
                propuesta = d.propuesta
                avisos = d.avisos
                mensaje = ""
            } catch (e: FalloApi) {
                error = e.message
            } finally {
                ocupado = null
            }
        }
    }

    /**
     * Revisa lo que falta antes de ir al servidor y pide la propuesta. Devuelve el primer campo con error, para
     * llevarle el foco.
     */
    fun revisar(): CampoAlta? {
        if (ocupado != null || guardado != null) return null
        val textoPrecio = valor(CampoAlta.PRECIO).trim()
        val precio = if (textoPrecio.isNotEmpty()) leerPesos(textoPrecio) else null
        val faltan = LinkedHashMap<CampoAlta, String>()
        if (valor(CampoAlta.FAMILIA).isEmpty()) faltan[CampoAlta.FAMILIA] = "Elige el tipo de producto."
        if (valor(CampoAlta.MODELO).isBlank()) faltan[CampoAlta.MODELO] = "Escribe el modelo."
        if (valor(CampoAlta.MADERA).isBlank()) faltan[CampoAlta.MADERA] = "Escribe la madera."
        val medidas = medidasAlta(campos)
        if (puerta) {
            medidas.errores[CampoAlta.ANCHO_MIN]?.let { faltan[CampoAlta.ANCHO_MIN] = it }
            medidas.errores[CampoAlta.ANCHO_MAX]?.let { faltan[CampoAlta.ANCHO_MAX] = it }
        } else if (valor(CampoAlta.MEDIDA).isBlank()) faltan[CampoAlta.MEDIDA] = "Escribe la medida o escuadría."
        medidas.errores[CampoAlta.LARGO]?.let { faltan[CampoAlta.LARGO] = it }
        if (precio == null || !precio.isFinite() || precio <= 0) faltan[CampoAlta.PRECIO] = "Escribe el costo de fábrica sin IVA, en pesos."
        errores = faltan
        if (faltan.isNotEmpty()) {
            error = null
            return faltan.keys.first()
        }
        ocupado = OcupadoAlta.REVISAR
        error = null
        val familia = valor(CampoAlta.FAMILIA)
        val cuerpo = buildJsonObject {
            put("tipo", "manual")
            id?.let { put("id", it) }
            putJsonObject("producto") {
                put("familia", familia.ifEmpty { null })
                put("modelo", valor(CampoAlta.MODELO).trim().ifEmpty { null })
                put("madera", valor(CampoAlta.MADERA).trim().ifEmpty { null })
                put("tipo", valor(CampoAlta.TIPO).trim().ifEmpty { null })
                put("medida", if (puerta) null else valor(CampoAlta.MEDIDA).trim().ifEmpty { null })
                put("anchoMin", medidas.anchoMin)
                put("anchoMax", medidas.anchoMax)
                put("largo", medidas.largo)
                put("precioNeto", precio?.takeIf { it.isFinite() && it > 0 })
            }
        }
        viewModelScope.launch {
            try {
                val d = c.pedirCatalogo(RespuestaAlta.serializer(), cuerpo)
                id = d.id
                propuesta = d.propuesta
                avisos = d.avisos
            } catch (e: FalloApi) {
                error = e.message
            } finally {
                ocupado = null
            }
        }
        return null
    }

    fun guardar() {
        val borrador = id ?: return
        val p = propuesta ?: return
        if (ocupado != null || guardado != null) return
        ocupado = OcupadoAlta.GUARDAR
        error = null
        viewModelScope.launch {
            try {
                val d = c.pedirCatalogo(RespuestaAlta.serializer(), buildJsonObject {
                    put("tipo", "confirmar")
                    put("id", borrador)
                })
                guardado = d.producto ?: p
                // Lo guardado es el punto de partida: editar desde ahí vuelve a marcar el alta como pendiente.
                base = campos
                propuesta = null
            } catch (e: FalloApi) {
                error = e.message
            } finally {
                ocupado = null
            }
        }
    }

    /**
     * Otro producto como el recién guardado: conserva tipo, modelo, madera y estilo, y deja vacías las medidas y el
     * costo. Un modelo son muchas medidas y maderas.
     */
    fun otroComoEste() {
        val nueva = VACIO + listOf(CampoAlta.FAMILIA, CampoAlta.MODELO, CampoAlta.MADERA, CampoAlta.TIPO).associateWith { valor(it) }
        limpiar(nueva)
    }

    /** Descarta la conversación y los datos, y deja la pantalla lista para otro producto. */
    fun reiniciar() {
        if (ocupado != null) return
        val pendiente = id.takeIf { guardado == null }
        limpiar(VACIO)
        if (pendiente != null) cancelarBorrador(pendiente)
    }

    private fun limpiar(nuevos: Map<CampoAlta, String>) {
        id = null
        mensajes = emptyList()
        mensaje = ""
        campos = nuevos
        base = nuevos
        propuesta = null
        guardado = null
        error = null
        errores = emptyMap()
        avisos = emptyList()
    }

    /** El borrador puede haber expirado: descartarlo sigue siendo seguro y no hay nada más que hacer. */
    private fun cancelarBorrador(borrador: String) {
        c.alcance.launch {
            try {
                c.pedirCatalogo(RespuestaAlta.serializer(), buildJsonObject {
                    put("tipo", "cancelar")
                    put("id", borrador)
                })
            } catch (e: FalloApi) {
                // Ya no existía.
            }
        }
    }

    /** Al salir de la sección con una propuesta a medias, se descarta el borrador del servidor. */
    override fun onCleared() {
        val pendiente = id
        if (pendiente != null && guardado == null) cancelarBorrador(pendiente)
    }
}

internal class MedidasAlta(val anchoMin: Double?, val anchoMax: Double?, val largo: Double?, val errores: Map<CampoAlta, String>)

/**
 * Medidas del alta con el mismo lector que el detalle y el chat (`medidasAlta`): «0,80», «80 cm», «2100 mm». Un
 * campo vacío pide el dato; uno ilegible o fuera de rango dice el rango y cómo escribirlo.
 */
internal fun medidasAlta(c: Map<CampoAlta, String>): MedidasAlta {
    val familia = c.getValue(CampoAlta.FAMILIA)
    val puerta = familia == "PUERTA"
    val errores = LinkedHashMap<CampoAlta, String>()
    fun leer(nombre: CampoAlta, campo: CampoMedida, vacio: String): Double? {
        val texto = c.getValue(nombre).trim()
        if (texto.isEmpty()) {
            errores[nombre] = vacio
            return null
        }
        val valor = leerMedida(texto, familia, campo)
        if (valor == null) errores[nombre] = Limites.errorMedida(campo, familia)
        return valor
    }
    val anchoMin = if (puerta) leer(CampoAlta.ANCHO_MIN, CampoMedida.ANCHO, "Escribe el ancho mínimo.") else null
    val anchoMax = if (puerta) leer(CampoAlta.ANCHO_MAX, CampoMedida.ANCHO, "Escribe el ancho máximo.") else null
    val largo = leer(CampoAlta.LARGO, CampoMedida.ALTO, if (puerta) "Escribe el alto." else "Escribe el largo.")
    return MedidasAlta(anchoMin, anchoMax, largo, errores)
}

@Composable
internal fun SeccionAlta(s: SeccionCatalogo, volver: () -> Unit) {
    val vm = vm { AltaViewModel(it) }
    val alVolver = GuardiaSalida(vm.sucio, volver)
    MarcoPantalla(s.titulo, alVolver = alVolver, subtitulo = "Catálogo") {
        ConMargenLateral { lado ->
            val guardado = vm.guardado
            if (guardado != null) ProductoAgregado(guardado, vm, Modifier.padding(horizontal = lado))
            else FormularioAlta(vm, lado)
        }
    }
}

/** Resultado del alta: lo guardado y cómo seguir. */
@Composable
private fun ProductoAgregado(p: Producto, vm: AltaViewModel, modifier: Modifier) {
    val c = Neltume.colores
    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Hoja(Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }, relleno = androidx.compose.foundation.layout.PaddingValues(24.dp)) {
            Box(Modifier.align(Alignment.CenterHorizontally).size(64.dp).clip(CircleShape).background(c.verdeVelo), contentAlignment = Alignment.Center) {
                Icon(Iconos.Check, null, tint = c.verde, modifier = Modifier.size(30.dp))
            }
            Spacer(Modifier.height(14.dp))
            Text("Producto agregado", Modifier.align(Alignment.CenterHorizontally).semantics { heading() }, style = MaterialTheme.typography.headlineSmall, color = c.tinta)
            Spacer(Modifier.height(4.dp))
            Text(nombreProducto(p.descripcion), Modifier.align(Alignment.CenterHorizontally), style = MaterialTheme.typography.titleMedium, color = c.tinta)
            Text(
                "Código ${p.codigo} · ${if (vm.mensajes.isNotEmpty()) "Completado con el asistente y revisado por ti." else "Ingresado a mano."}",
                Modifier.align(Alignment.CenterHorizontally).padding(top = 4.dp),
                style = MaterialTheme.typography.bodySmall,
                color = c.apagado,
            )
            Spacer(Modifier.height(20.dp))
            BotonPrincipal("Agregar otra medida o madera de ${nombreProducto(p.modelo)}", vm::otroComoEste, Modifier.fillMaxWidth(), icono = Iconos.Mas)
            Spacer(Modifier.height(10.dp))
            BotonSecundario("Agregar otro producto", vm::reiniciar, Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun FormularioAlta(vm: AltaViewModel, lado: androidx.compose.ui.unit.Dp) {
    val c = Neltume.colores
    val alcance = rememberCoroutineScope()
    val desplazamiento = rememberScrollState()
    val focos = remember { CampoAlta.entries.associateWith { FocusRequester() } }
    val verFamilia = remember { BringIntoViewRequester() }
    val verRevision = remember { BringIntoViewRequester() }
    var confirmar by rememberSaveable { mutableStateOf(false) }
    val ocupado = vm.ocupado != null
    val puerta = vm.puerta

    fun revisar() {
        val primero = vm.revisar()
        when (primero) {
            null -> Unit
            CampoAlta.FAMILIA -> alcance.launch { verFamilia.bringIntoView() }
            else -> runCatching { focos.getValue(primero).requestFocus() }
        }
    }

    @Composable
    fun campo(
        nombre: CampoAlta,
        etiqueta: String,
        ayuda: String? = null,
        numero: Boolean = false,
        mayusculas: KeyboardCapitalization = KeyboardCapitalization.Words,
        ultimo: Boolean = false,
    ) = Campo(
        vm.valor(nombre),
        { vm.cambiar(nombre, it) },
        etiqueta,
        error = vm.errores[nombre],
        ayuda = ayuda,
        teclado = if (numero) KeyboardType.Decimal else KeyboardType.Text,
        accionIme = if (ultimo) ImeAction.Done else ImeAction.Next,
        alAccion = if (ultimo) ({ revisar() }) else null,
        habilitado = !ocupado,
        mayusculas = mayusculas,
        largoMaximo = 120,
        foco = focos.getValue(nombre),
        prefijo = if (nombre == CampoAlta.PRECIO) "$" else null,
    )

    Column(
        Modifier.fillMaxSize().imePadding().verticalScroll(desplazamiento).padding(horizontal = lado).padding(top = 8.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Introduccion(
            "Completa los datos a mano o describe el producto y deja que el asistente llene el formulario. En ambos " +
                "casos revisas la propuesta antes de guardarla. **Ingresa el costo de fábrica sin IVA, no el precio de " +
                "venta:** las cotizaciones le suman la ganancia de su categoría (por ejemplo, Puertas sólidas Pino Oregón), " +
                "igual que a los productos de la planilla. Antes de guardar verás el precio de venta exacto.",
        )

        Hoja(Modifier.fillMaxWidth()) {
            TituloSeccion("Describir con el asistente · opcional", detalle = if (vm.asistente) "Lo que entienda se carga en el formulario de abajo." else null)
            Spacer(Modifier.height(12.dp))
            if (!vm.asistente) Text("El asistente no está configurado: completa los datos en el formulario.", style = MaterialTheme.typography.bodyMedium, color = c.apagado)
            else {
                if (vm.mensajes.isNotEmpty()) {
                    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        vm.mensajes.forEachIndexed { i, m -> GloboAlta(m, vivo = i == vm.mensajes.lastIndex) }
                    }
                    Spacer(Modifier.height(12.dp))
                }
                AnimatedVisibility(vm.ocupado == OcupadoAlta.ASISTENTE) {
                    Row(Modifier.padding(bottom = 12.dp).semantics { liveRegion = LiveRegionMode.Polite }, verticalAlignment = Alignment.CenterVertically) {
                        PuntosEspera()
                        Text("  Interpretando la descripción…", style = MaterialTheme.typography.bodySmall, color = c.apagado)
                    }
                }
                Campo(
                    vm.mensaje,
                    { vm.mensaje = it },
                    "Describe el producto",
                    lineas = 2,
                    maxLineas = 6,
                    habilitado = !ocupado,
                    accionIme = ImeAction.Default,
                    largoMaximo = 3000,
                    ayuda = "Ej.: puerta modelo Roble, en raulí, de 80 a 85 cm de ancho y 2,10 m de alto; precio $145.000 sin IVA",
                )
                Spacer(Modifier.height(10.dp))
                BotonSecundario(
                    if (vm.ocupado == OcupadoAlta.ASISTENTE) "Interpretando…" else "Completar formulario",
                    vm::describir,
                    Modifier.fillMaxWidth(),
                    icono = Iconos.Destellos,
                    habilitado = vm.mensaje.isNotBlank() && !ocupado,
                    cargando = vm.ocupado == OcupadoAlta.ASISTENTE,
                )
            }
        }

        Hoja(Modifier.fillMaxWidth()) {
            TituloSeccion("Datos del producto")
            Spacer(Modifier.height(12.dp))
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SelectorFamilia(
                    vm.valor(CampoAlta.FAMILIA),
                    { vm.cambiar(CampoAlta.FAMILIA, it) },
                    Modifier.bringIntoViewRequester(verFamilia),
                    error = vm.errores[CampoAlta.FAMILIA],
                    habilitado = !ocupado,
                )
                campo(CampoAlta.MODELO, "Modelo", ayuda = "Ej.: Roble")
                campo(CampoAlta.MADERA, "Madera", ayuda = "Ej.: Raulí")
                campo(
                    CampoAlta.TIPO,
                    "Estilo (opcional)",
                    ayuda = "Solo informativo. Si dice «prepintada» o «enchapada», cambia la ganancia: lo verás en la revisión.",
                    mayusculas = KeyboardCapitalization.Sentences,
                )
                if (puerta) {
                    campo(
                        CampoAlta.ANCHO_MIN,
                        "Ancho mínimo",
                        ayuda = "Este precio sirve para los anchos entre el mínimo y el máximo. En metros (0,80), centímetros (80 cm) o milímetros (800 mm).",
                        numero = true,
                    )
                    campo(CampoAlta.ANCHO_MAX, "Ancho máximo", ayuda = "Si es una sola medida, repite el mínimo.", numero = true)
                    campo(CampoAlta.LARGO, "Alto", ayuda = "En metros (2,10), centímetros (210 cm) o milímetros (2100 mm).", numero = true)
                } else {
                    campo(CampoAlta.MEDIDA, "Medida o escuadría", ayuda = "Escuadría: grosor por ancho de la pieza. Ej.: 2x4", mayusculas = KeyboardCapitalization.None)
                    campo(CampoAlta.LARGO, "Largo", ayuda = "En metros (3,60), centímetros (360 cm) o milímetros (3600 mm).", numero = true)
                }
                campo(
                    CampoAlta.PRECIO,
                    "Costo de fábrica sin IVA",
                    ayuda = "Lo que cobra la fábrica, sin la ganancia de venta: la revisión muestra el precio de venta.",
                    numero = true,
                    ultimo = true,
                )
            }
            Spacer(Modifier.height(14.dp))
            BotonPrincipal(
                if (vm.ocupado == OcupadoAlta.REVISAR) "Revisando…" else "Revisar propuesta",
                ::revisar,
                Modifier.fillMaxWidth(),
                habilitado = !ocupado,
                cargando = vm.ocupado == OcupadoAlta.REVISAR,
            )
            if (vm.id != null || vm.campos.values.any { it.isNotEmpty() }) {
                Spacer(Modifier.height(8.dp))
                BotonSecundario("Empezar de nuevo", vm::reiniciar, Modifier.fillMaxWidth(), habilitado = !ocupado)
            }
        }

        vm.error?.let { Aviso(it, Modifier.semantics { liveRegion = LiveRegionMode.Assertive }, TonoAviso.PELIGRO) }

        vm.propuesta?.let { p ->
            val venta = vm.venta(p)
            Hoja(Modifier.fillMaxWidth().bringIntoViewRequester(verRevision), color = c.panel) {
                Rotulo("Revisión antes de guardar")
                Spacer(Modifier.height(4.dp))
                Text(nombreProducto(p.descripcion), Modifier.semantics { heading() }, style = MaterialTheme.typography.headlineSmall, color = c.tinta)
                Spacer(Modifier.height(12.dp))
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Dato("Código interno asignado", p.codigo)
                    Dato("Tipo de producto", etiquetaFamilia(p.familia))
                    Dato("Costo de fábrica sin IVA", pesos(p.precioNeto))
                    Dato("Precio de venta sin IVA (ganancia ${venta.ganancia})", pesos(venta.precio), destacado = true)
                    venta.categoria?.let { Dato("Categoría de ganancia", it) }
                }
                if (vm.avisos.isNotEmpty()) {
                    Spacer(Modifier.height(12.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) { vm.avisos.forEach { Aviso(it, tono = TonoAviso.ATENCION) } }
                }
                Spacer(Modifier.height(12.dp))
                Text(
                    "Confirma que el costo de fábrica y los datos del producto sean correctos: el producto queda en el catálogo para todas las cotizaciones.",
                    style = MaterialTheme.typography.bodySmall,
                    color = c.tintaSuave,
                )
                Spacer(Modifier.height(12.dp))
                BotonPrincipal(
                    if (vm.ocupado == OcupadoAlta.GUARDAR) "Guardando…" else "Confirmar y guardar",
                    { confirmar = true },
                    Modifier.fillMaxWidth(),
                    icono = Iconos.Check,
                    habilitado = !ocupado,
                    cargando = vm.ocupado == OcupadoAlta.GUARDAR,
                )
            }
            if (confirmar) {
                DialogoConfirmacion(
                    "Agregar al catálogo",
                    "¿Agregar «${p.descripcion}» al catálogo con costo de fábrica sin IVA ${pesos(p.precioNeto)}? " +
                        "Se venderá a ${pesos(venta.precio)} sin IVA (ganancia de ${venta.ganancia}).",
                    "Agregar al catálogo",
                ) { ok ->
                    confirmar = false
                    if (ok) vm.guardar()
                }
            }
        }
    }
    // Una propuesta nueva se trae a la vista (también la que completa el asistente).
    LaunchedEffect(vm.propuesta?.codigo) { if (vm.propuesta != null) verRevision.bringIntoView() }
}

/** Globo de la conversación con el asistente: «TÚ» a la derecha, «NELTUME» a la izquierda. */
@Composable
private fun GloboAlta(m: MensajeAlta, vivo: Boolean) {
    val c = Neltume.colores
    val propio = m.rol == "usuario"
    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (propio) Alignment.End else Alignment.Start) {
        Text(if (propio) "TÚ" else "NELTUME", style = MaterialTheme.typography.labelSmall, color = c.apagado)
        Spacer(Modifier.height(2.dp))
        Text(
            m.texto,
            Modifier
                .widthIn(max = 520.dp)
                .clip(if (propio) FormaGlobo else FormaGloboAsistente)
                .background(if (propio) c.verdeVelo else c.tonal)
                .padding(horizontal = 12.dp, vertical = 8.dp)
                .let { if (vivo && !propio) it.semantics { liveRegion = LiveRegionMode.Polite } else it },
            style = MaterialTheme.typography.bodyMedium,
            color = c.tinta,
        )
    }
}
