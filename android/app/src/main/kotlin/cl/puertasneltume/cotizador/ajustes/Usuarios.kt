package cl.puertasneltume.cotizador.ajustes

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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cl.puertasneltume.cotizador.Contenedor
import cl.puertasneltume.cotizador.comun.Avisos
import cl.puertasneltume.cotizador.comun.LocalAvisos
import cl.puertasneltume.cotizador.comun.vm
import cl.puertasneltume.cotizador.cotizar.DialogoConfirmacion
import cl.puertasneltume.cotizador.diseno.Aviso
import cl.puertasneltume.cotizador.diseno.Avatar
import cl.puertasneltume.cotizador.diseno.BotonPrincipal
import cl.puertasneltume.cotizador.diseno.BotonSecundario
import cl.puertasneltume.cotizador.diseno.BotonTexto
import cl.puertasneltume.cotizador.diseno.Campo
import cl.puertasneltume.cotizador.diseno.Divisor
import cl.puertasneltume.cotizador.diseno.EstadoVacio
import cl.puertasneltume.cotizador.diseno.Hoja
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Pildora
import cl.puertasneltume.cotizador.diseno.Tarjeta
import cl.puertasneltume.cotizador.diseno.TituloSeccion
import cl.puertasneltume.cotizador.diseno.TonoAviso
import cl.puertasneltume.cotizador.nucleo.api.FalloApi
import cl.puertasneltume.cotizador.nucleo.api.Mensajes
import cl.puertasneltume.cotizador.nucleo.api.texto
import cl.puertasneltume.cotizador.nucleo.reglas.correoValido
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// Ajustes → Usuarios (src/app/ajustes/usuarios.tsx, crear-usuario.tsx y cuentas.ts), solo administración.

@Serializable
internal data class Usuario(
    val id: String,
    val nombre: String = "",
    val email: String = "",
    val rol: String = "admin",
    val activo: Boolean = true,
)

@Serializable
internal data class CambioCuenta(
    val id: Long = 0,
    val fecha: String = "",
    val actor: String? = null,
    val objetivo: String? = null,
    val accion: String = "",
)

@Serializable
internal data class RespuestaCuentas(
    val usuarios: List<Usuario> = emptyList(),
    val actual: String = "",
    val cambios: List<CambioCuenta> = emptyList(),
)

/** Cómo se lee cada movimiento del registro de cambios; uno que esta versión no conoce se muestra tal cual. */
private val ACCIONES_CUENTA = mapOf(
    "crear" to "Creó la cuenta",
    "crear-primera" to "Creó la primera cuenta",
    "editar" to "Editó la cuenta",
    "desactivar" to "Desactivó la cuenta",
    "activar" to "Activó la cuenta",
    "restablecer-clave" to "Restableció la contraseña",
    "inicio-sesion" to "Inició sesión",
    "inicio-sesion-fallido" to "Intento fallido de inicio de sesión",
)

private fun textoAccionCuenta(accion: String) = ACCIONES_CUENTA[accion] ?: accion

/** Solo cuentan las cuentas activas con rol de administración: una desactivada no puede restablecer otra. */
private fun faltaOtraAdministradora(usuarios: List<Usuario>) = usuarios.count { it.activo && it.rol == "admin" } < 2

/** Formulario con errores por campo y un pedido de foco al primero con error. */
internal class Formulario(vararg campos: String) {
    val valores = mutableStateOf(campos.associateWith { "" })
    var errores by mutableStateOf<Map<String?, String>>(emptyMap())
    var foco by mutableStateOf<String?>(null)

    operator fun get(campo: String) = valores.value[campo].orEmpty()
    fun poner(campo: String, valor: String) {
        valores.value = valores.value + (campo to valor)
        if (campo in errores || null in errores) errores = errores - campo - null
    }

    /** `campo` null es un error general (red, servidor). */
    fun fallar(campo: String?, texto: String) {
        errores = mapOf(campo to texto)
        foco = campo
    }

    fun limpiar() {
        valores.value = valores.value.mapValues { "" }
        errores = emptyMap()
        foco = null
    }
}

internal class UsuariosVM(private val c: Contenedor) : ViewModel() {
    var usuarios by mutableStateOf<List<Usuario>?>(null)
        private set
    var cambios by mutableStateOf<List<CambioCuenta>>(emptyList())
        private set
    var actual by mutableStateOf("")
        private set
    var error by mutableStateOf<String?>(null)
        private set

    /** Id de la cuenta en curso de cambio. */
    var ocupado by mutableStateOf<String?>(null)
        private set

    var editando by mutableStateOf<Usuario?>(null)
        private set
    val edicion = Formulario("nombre", "correo", "confirmacion")

    var claveDe by mutableStateOf<Usuario?>(null)
        private set
    val clave = Formulario("clave", "repetida", "confirmacion")

    var creando by mutableStateOf(false)
        private set
    var enviandoAlta by mutableStateOf(false)
        private set
    val alta = Formulario("nombre", "correo", "clave", "repetida")

    init {
        cargar()
    }

    private fun aplicar(r: RespuestaCuentas) {
        usuarios = r.usuarios
        actual = r.actual
        cambios = r.cambios
    }

    fun cargar() {
        viewModelScope.launch {
            error = null
            try {
                aplicar(leer(RespuestaCuentas.serializer(), c.api.obtenerJson("api/usuarios")))
            } catch (e: FalloApi) {
                error = e.message
            }
        }
    }

    fun abrirEdicion(u: Usuario) {
        cerrarClave()
        edicion.limpiar()
        edicion.poner("nombre", u.nombre)
        edicion.poner("correo", u.email)
        editando = u
    }

    fun cerrarEdicion() {
        if (ocupado != null) return
        editando = null
        edicion.limpiar()
    }

    fun abrirClave(u: Usuario) {
        cerrarEdicion()
        clave.limpiar()
        claveDe = u
    }

    fun cerrarClave() {
        if (ocupado != null) return
        claveDe = null
        clave.limpiar()
    }

    fun cambiaCorreo(u: Usuario) = edicion["correo"].trim().lowercase() != u.email.lowercase()

    /** `alFallar` recibe el error y devuelve true si ya lo mostró junto a un campo. */
    private fun accion(id: String, cuerpo: JsonObject, mensaje: String, avisos: Avisos, alFallar: (FalloApi) -> Boolean = { false }) {
        ocupado = id
        error = null
        viewModelScope.launch {
            try {
                aplicar(leer(RespuestaCuentas.serializer(), c.api.enviarJson("api/usuarios", cuerpo, metodo = "PATCH")))
                ocupado = null
                cerrarEdicion()
                cerrarClave()
                avisos.mostrar(mensaje, largo = true)
            } catch (e: FalloApi) {
                if (!alFallar(e)) avisos.mostrar(e.message ?: Mensajes.GENERAL, largo = true)
            } finally {
                ocupado = null
            }
        }
    }

    /**
     * Un error de la contraseña propia (falta, es incorrecta o hubo demasiados intentos) va junto a ese campo; un
     * correo ya usado, junto al correo; el resto, al pie del formulario.
     */
    private fun errorConfirmacion(f: Formulario): (FalloApi) -> Boolean = { e ->
        when {
            e.codigo == "confirmar_clave" -> {
                f.poner("confirmacion", "")
                f.fallar("confirmacion", e.message ?: Mensajes.GENERAL)
            }
            e.status == 409 && e.message == "Ya existe una cuenta con ese correo." -> f.fallar("correo", e.message!!)
            else -> f.fallar(null, e.message ?: Mensajes.GENERAL)
        }
        true
    }

    fun guardarEdicion(avisos: Avisos) {
        val u = editando ?: return
        if (ocupado != null) return
        val f = edicion
        val cambia = cambiaCorreo(u)
        when {
            f["nombre"].isBlank() -> return f.fallar("nombre", "Escribe el nombre de la persona.")
            !correoValido(f["correo"]) -> return f.fallar("correo", "Revisa el correo: debe tener la forma nombre@dominio.cl.")
            cambia && f["confirmacion"].isEmpty() -> return f.fallar("confirmacion", "Escribe tu contraseña para confirmar el cambio de correo.")
        }
        f.errores = emptyMap()
        accion(u.id, buildJsonObject {
            put("accion", "editar")
            put("id", u.id)
            put("nombre", f["nombre"])
            put("email", f["correo"])
            if (cambia) put("passwordActual", f["confirmacion"])
        }, "Cuenta actualizada.", avisos, errorConfirmacion(f))
    }

    fun restablecer(avisos: Avisos) {
        val u = claveDe ?: return
        if (ocupado != null) return
        val f = clave
        when {
            f["clave"].length !in CLAVE_MINIMO..CLAVE_MAXIMO ->
                return f.fallar("clave", "La contraseña debe tener entre $CLAVE_MINIMO y $CLAVE_MAXIMO caracteres.")
            f["clave"] != f["repetida"] -> return f.fallar("repetida", "La confirmación no coincide con la contraseña.")
            f["confirmacion"].isEmpty() -> return f.fallar("confirmacion", "Escribe tu contraseña para confirmar el cambio.")
        }
        f.errores = emptyMap()
        accion(u.id, buildJsonObject {
            put("accion", "restablecer-clave")
            put("id", u.id)
            put("password", f["clave"])
            put("passwordActual", f["confirmacion"])
        }, "Contraseña de ${u.nombre} restablecida; se cerraron sus sesiones.", avisos, errorConfirmacion(f))
    }

    fun cambiarEstado(u: Usuario, avisos: Avisos) {
        if (ocupado != null) return
        accion(u.id, buildJsonObject {
            put("accion", if (u.activo) "desactivar" else "activar")
            put("id", u.id)
        }, if (u.activo) "Cuenta desactivada." else "Cuenta activada.", avisos)
    }

    fun abrirAlta() {
        alta.limpiar()
        creando = true
    }

    fun cerrarAlta() {
        if (enviandoAlta) return
        alta.limpiar()
        creando = false
    }

    fun crear(avisos: Avisos) {
        if (enviandoAlta) return
        val f = alta
        when {
            f["nombre"].isBlank() -> return f.fallar("nombre", "Escribe el nombre de la persona.")
            f["correo"].isBlank() -> return f.fallar("correo", "Escribe el correo de la cuenta.")
            !correoValido(f["correo"]) -> return f.fallar("correo", "Revisa el correo: debe tener la forma nombre@dominio.cl.")
            f["clave"].length !in CLAVE_MINIMO..CLAVE_MAXIMO ->
                return f.fallar("clave", "La contraseña debe tener entre $CLAVE_MINIMO y $CLAVE_MAXIMO caracteres.")
            f["clave"] != f["repetida"] -> return f.fallar("repetida", "La confirmación no coincide con la contraseña.")
        }
        enviandoAlta = true
        f.errores = emptyMap()
        viewModelScope.launch {
            try {
                val r = c.api.enviarJson("api/usuarios", buildJsonObject {
                    put("nombre", f["nombre"])
                    put("email", f["correo"])
                    put("password", f["clave"])
                })
                val correo = (r["usuario"] as? JsonObject)?.texto("email") ?: f["correo"].trim()
                enviandoAlta = false
                cerrarAlta()
                avisos.mostrar("Cuenta creada para $correo. La persona podrá cambiar su contraseña desde Ajustes.", largo = true)
                cargar()
            } catch (e: FalloApi) {
                if (e.status == 409) f.fallar("correo", "Ya existe una cuenta con ese correo.")
                else f.fallar(null, e.message ?: Mensajes.GENERAL)
            } finally {
                enviandoAlta = false
            }
        }
    }
}

@Composable
internal fun SeccionUsuarios() {
    val vm = vm { UsuariosVM(it) }
    val avisos = LocalAvisos.current
    val c = Neltume.colores
    var desactivar by remember { mutableStateOf<Usuario?>(null) }
    val usuarios = vm.usuarios
    val escrito = vm.creando && listOf("nombre", "correo", "clave", "repetida").any { vm.alta[it].isNotEmpty() }

    MarcoSeccion(SeccionAjustes.USUARIOS.encabezado, sucio = escrito) {
        Intro(
            "Edita nombre y correo, activa o desactiva cuentas y restablece contraseñas. Las cuentas que se crean aquí son todas administradoras: pueden cotizar y cambiar Ajustes. Mantén siempre al menos dos activas.",
        )
        if (usuarios != null && faltaOtraAdministradora(usuarios)) {
            Aviso(
                "Hay una sola cuenta administradora activa. Crea otra: si se olvida esta contraseña, otra administradora puede restablecerla sin recurrir a la terminal del servidor.",
                tono = TonoAviso.ATENCION,
            )
        }
        vm.error?.let { ErrorCarga(it, vm::cargar) }
        when {
            usuarios == null -> if (vm.error == null) Cargando("Cargando cuentas…")
            usuarios.isEmpty() -> EstadoVacio(Iconos.Clientes, "No hay cuentas.", "Crea la primera desde «Nueva cuenta».")
            else -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                usuarios.forEach { u ->
                    TarjetaUsuario(
                        u,
                        propia = u.id == vm.actual,
                        ocupado = vm.ocupado,
                        cambiandoEstado = vm.ocupado == u.id && vm.editando == null && vm.claveDe == null,
                        editar = { vm.abrirEdicion(u) },
                        restablecer = { vm.abrirClave(u) },
                        cambiarEstado = { if (u.activo) desactivar = u else vm.cambiarEstado(u, avisos) },
                    )
                }
            }
        }

        Hoja {
            TituloSeccion("Nueva cuenta", detalle = "Define una contraseña inicial; la persona podrá cambiarla desde Ajustes.")
            Spacer(Modifier.height(12.dp))
            BotonSecundario("Crear cuenta", vm::abrirAlta, Modifier.fillMaxWidth(), icono = Iconos.Mas)
        }

        if (usuarios != null) {
            Hoja {
                TituloSeccion(
                    "Registro de cambios",
                    detalle = "Los movimientos más recientes (hasta 50): quién creó, editó, desactivó, activó o restableció la contraseña de qué cuenta, y los inicios de sesión correctos y fallidos con el dispositivo y la IP.",
                )
                Spacer(Modifier.height(8.dp))
                if (vm.cambios.isEmpty()) {
                    Nota("Todavía no hay cambios registrados.")
                } else {
                    vm.cambios.forEachIndexed { i, cambio ->
                        if (i > 0) Divisor(Modifier.padding(vertical = 2.dp))
                        FilaCambio(cambio)
                    }
                }
            }
        }
    }

    vm.editando?.let { u -> HojaEdicion(vm, u, avisos) }
    vm.claveDe?.let { u -> HojaClave(vm, u, avisos) }
    if (vm.creando) HojaAlta(vm, avisos)

    desactivar?.let { u ->
        DialogoConfirmacion(
            "Desactivar cuenta",
            "Se cerrarán las sesiones abiertas de ${u.nombre} (${u.email}) y no podrá volver a entrar hasta que actives la cuenta otra vez. Sus cotizaciones se conservan.",
            "Desactivar cuenta",
            peligro = true,
        ) { ok ->
            desactivar = null
            if (ok) vm.cambiarEstado(u, avisos)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TarjetaUsuario(
    u: Usuario,
    propia: Boolean,
    ocupado: String?,
    cambiandoEstado: Boolean,
    editar: () -> Unit,
    restablecer: () -> Unit,
    cambiarEstado: () -> Unit,
) {
    val c = Neltume.colores
    Tarjeta(null) {
        Row(Modifier.semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically) {
            Avatar(u.nombre.ifBlank { u.email }, tamano = 40.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(u.nombre.ifBlank { u.email }, style = MaterialTheme.typography.titleSmall, color = c.tinta)
                Text(u.email, style = MaterialTheme.typography.bodySmall, color = c.apagado)
                Text(
                    (if (u.rol == "admin") "Administradora" else "Sin permisos de administración") + if (propia) " · Tu cuenta" else "",
                    style = MaterialTheme.typography.labelSmall,
                    color = c.tintaSuave,
                )
            }
            Spacer(Modifier.width(8.dp))
            if (u.activo) Pildora("Activa", c.verdeVelo, c.verde) else Pildora("Desactivada", c.peligroVelo, c.peligro)
        }
        Spacer(Modifier.height(6.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            val libre = ocupado == null
            BotonTexto("Editar", editar, icono = Iconos.Lapiz, habilitado = libre)
            BotonTexto("Restablecer clave", restablecer, icono = Iconos.Llave, habilitado = libre)
            // La propia cuenta activa no se puede desactivar: sin botón.
            if (!(propia && u.activo)) {
                BotonTexto(
                    when {
                        cambiandoEstado && u.activo -> "Desactivando…"
                        cambiandoEstado -> "Activando…"
                        u.activo -> "Desactivar"
                        else -> "Activar"
                    },
                    cambiarEstado,
                    icono = if (u.activo) Iconos.Prohibido else Iconos.CirculoCheck,
                    habilitado = libre,
                    peligro = u.activo,
                )
            }
        }
    }
}

@Composable
private fun FilaCambio(cambio: CambioCuenta) {
    val c = Neltume.colores
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp).semantics(mergeDescendants = true) {}) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(textoAccionCuenta(cambio.accion), style = MaterialTheme.typography.titleSmall, color = c.tinta, modifier = Modifier.weight(1f))
            Spacer(Modifier.width(8.dp))
            Text(fechaHoraCuenta(cambio.fecha), style = MaterialTheme.typography.labelSmall, color = c.apagado)
        }
        if (!cambio.objetivo.isNullOrBlank()) Text(cambio.objetivo, style = MaterialTheme.typography.bodySmall, color = c.tintaSuave)
        Text("Por ${cambio.actor ?: "—"}", style = MaterialTheme.typography.bodySmall, color = c.apagado)
    }
}

/** Focos de un formulario: lleva el foco al campo que falló. */
@Composable
private fun rememberFocos(f: Formulario, vararg campos: String): Map<String, FocusRequester> {
    val focos = remember { campos.associateWith { FocusRequester() } }
    LaunchedEffect(f.foco, f.errores) {
        val campo = f.foco ?: return@LaunchedEffect
        runCatching { focos[campo]?.requestFocus() }
        f.foco = null
    }
    return focos
}

@Composable
private fun HojaEdicion(vm: UsuariosVM, u: Usuario, avisos: Avisos) {
    val f = vm.edicion
    val focos = rememberFocos(f, "nombre", "correo", "confirmacion")
    val ocupado = vm.ocupado != null
    HojaFormulario("Editar la cuenta", u.email, alCerrar = vm::cerrarEdicion, bloqueada = ocupado) {
        Campo(
            f["nombre"],
            { f.poner("nombre", it) },
            "Nombre",
            error = f.errores["nombre"],
            habilitado = !ocupado,
            mayusculas = KeyboardCapitalization.Words,
            largoMaximo = 120,
            foco = focos["nombre"],
            tipoContenido = ContentType.PersonFullName,
        )
        Campo(
            f["correo"],
            { f.poner("correo", it) },
            "Correo",
            error = f.errores["correo"],
            teclado = KeyboardType.Email,
            habilitado = !ocupado,
            largoMaximo = 254,
            foco = focos["correo"],
        )
        if (vm.cambiaCorreo(u)) {
            CampoContrasena(
                f["confirmacion"],
                { f.poner("confirmacion", it) },
                "Tu contraseña (para confirmar el cambio de correo)",
                error = f.errores["confirmacion"],
                accionIme = ImeAction.Done,
                alAccion = { vm.guardarEdicion(avisos) },
                habilitado = !ocupado,
                foco = focos["confirmacion"],
            )
        }
        f.errores[null]?.let { TextoError(it) }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            BotonSecundario("Cancelar", vm::cerrarEdicion, Modifier.weight(1f), habilitado = !ocupado)
            BotonPrincipal(if (ocupado) "Guardando…" else "Guardar", { vm.guardarEdicion(avisos) }, Modifier.weight(1f), cargando = ocupado)
        }
    }
}

@Composable
private fun HojaClave(vm: UsuariosVM, u: Usuario, avisos: Avisos) {
    val f = vm.clave
    val focos = rememberFocos(f, "clave", "repetida", "confirmacion")
    val ocupado = vm.ocupado != null
    HojaFormulario("Restablecer la contraseña", "${u.nombre} · ${u.email}", alCerrar = vm::cerrarClave, bloqueada = ocupado) {
        CampoContrasena(
            f["clave"],
            { f.poner("clave", it) },
            "Nueva contraseña (mínimo $CLAVE_MINIMO caracteres)",
            error = f.errores["clave"],
            nueva = true,
            habilitado = !ocupado,
            foco = focos["clave"],
        )
        CampoContrasena(
            f["repetida"],
            { f.poner("repetida", it) },
            "Repite la nueva contraseña",
            error = f.errores["repetida"],
            nueva = true,
            habilitado = !ocupado,
            foco = focos["repetida"],
        )
        CampoContrasena(
            f["confirmacion"],
            { f.poner("confirmacion", it) },
            "Tu contraseña (para confirmar)",
            error = f.errores["confirmacion"],
            accionIme = ImeAction.Done,
            alAccion = { vm.restablecer(avisos) },
            habilitado = !ocupado,
            foco = focos["confirmacion"],
        )
        Nota("Se cerrarán las sesiones abiertas de esta cuenta.")
        f.errores[null]?.let { TextoError(it) }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            BotonSecundario("Cancelar", vm::cerrarClave, Modifier.weight(1f), habilitado = !ocupado)
            BotonPrincipal(
                if (ocupado) "Guardando…" else "Guardar contraseña",
                { vm.restablecer(avisos) },
                Modifier.weight(1.4f),
                habilitado = f["clave"].isNotEmpty(),
                cargando = ocupado,
            )
        }
    }
}

@Composable
private fun HojaAlta(vm: UsuariosVM, avisos: Avisos) {
    val f = vm.alta
    val focos = rememberFocos(f, "nombre", "correo", "clave", "repetida")
    val ocupado = vm.enviandoAlta
    HojaFormulario(
        "Nueva cuenta",
        "Define una contraseña inicial; la persona podrá cambiarla desde Ajustes.",
        alCerrar = vm::cerrarAlta,
        bloqueada = ocupado,
    ) {
        Campo(
            f["nombre"],
            { f.poner("nombre", it) },
            "Nombre",
            error = f.errores["nombre"],
            habilitado = !ocupado,
            mayusculas = KeyboardCapitalization.Words,
            largoMaximo = 120,
            foco = focos["nombre"],
            tipoContenido = ContentType.PersonFullName,
        )
        Campo(
            f["correo"],
            { f.poner("correo", it) },
            "Correo",
            error = f.errores["correo"],
            teclado = KeyboardType.Email,
            habilitado = !ocupado,
            largoMaximo = 254,
            foco = focos["correo"],
        )
        CampoContrasena(
            f["clave"],
            { f.poner("clave", it) },
            "Contraseña inicial (mínimo $CLAVE_MINIMO caracteres)",
            error = f.errores["clave"],
            nueva = true,
            habilitado = !ocupado,
            foco = focos["clave"],
        )
        CampoContrasena(
            f["repetida"],
            { f.poner("repetida", it) },
            "Repite la contraseña inicial",
            error = f.errores["repetida"],
            nueva = true,
            accionIme = ImeAction.Done,
            alAccion = { vm.crear(avisos) },
            habilitado = !ocupado,
            foco = focos["repetida"],
        )
        f.errores[null]?.let { TextoError(it) }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            BotonSecundario("Cancelar", vm::cerrarAlta, Modifier.weight(1f), habilitado = !ocupado)
            BotonPrincipal(if (ocupado) "Creando…" else "Crear cuenta", { vm.crear(avisos) }, Modifier.weight(1f), cargando = ocupado)
        }
    }
}
