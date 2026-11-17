package cl.puertasneltume.cotizador.ajustes

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cl.puertasneltume.cotizador.Contenedor
import cl.puertasneltume.cotizador.comun.Avisos
import cl.puertasneltume.cotizador.comun.LocalAvisos
import cl.puertasneltume.cotizador.comun.LocalContenedor
import cl.puertasneltume.cotizador.comun.vm
import cl.puertasneltume.cotizador.cotizar.DialogoConfirmacion
import cl.puertasneltume.cotizador.diseno.BotonPrincipal
import cl.puertasneltume.cotizador.diseno.BotonSecundario
import cl.puertasneltume.cotizador.diseno.BotonTexto
import cl.puertasneltume.cotizador.diseno.Divisor
import cl.puertasneltume.cotizador.diseno.Hoja
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Pildora
import cl.puertasneltume.cotizador.diseno.TituloSeccion
import cl.puertasneltume.cotizador.nucleo.api.FalloApi
import cl.puertasneltume.cotizador.nucleo.api.Mensajes
import cl.puertasneltume.cotizador.nucleo.modelo.SesionCuenta
import kotlinx.coroutines.launch

/** Mi cuenta: cambiar la contraseña propia (cambiar-clave.tsx) y las sesiones abiertas (sesiones.tsx). */
internal class CuentaVM(private val c: Contenedor) : ViewModel() {
    var actual by mutableStateOf("")
    var nueva by mutableStateOf("")
    var repetida by mutableStateOf("")
    var errores by mutableStateOf<Map<String, String>>(emptyMap())
        private set

    /** Campo al que llevar el foco; el contador repite el pedido aunque sea el mismo campo. */
    var foco by mutableStateOf<Pair<String, Int>?>(null)
        private set
    var cambiando by mutableStateOf(false)
        private set

    var sesiones by mutableStateOf<List<SesionCuenta>?>(null)
        private set
    var errorSesiones by mutableStateOf<String?>(null)
        private set

    /** Lo que se está cerrando: el id de una sesión o «demas». */
    var ocupadoSesion by mutableStateOf<String?>(null)
        private set

    val escrito: Boolean get() = actual.isNotEmpty() || nueva.isNotEmpty() || repetida.isNotEmpty()

    init {
        cargarSesiones()
    }

    private fun fallar(campo: String, texto: String) {
        errores = mapOf(campo to texto)
        foco = campo to ((foco?.second ?: 0) + 1)
    }

    fun focoAtendido() {
        foco = null
    }

    fun quitarError(campo: String) {
        if (campo in errores) errores = errores - campo
    }

    fun limpiar() {
        actual = ""
        nueva = ""
        repetida = ""
        errores = emptyMap()
    }

    fun cambiarClave(avisos: Avisos) {
        if (cambiando) return
        when {
            actual.isEmpty() -> return fallar("actual", "Escribe tu contraseña actual.")
            nueva.length !in CLAVE_MINIMO..CLAVE_MAXIMO ->
                return fallar("nueva", "La nueva contraseña debe tener entre $CLAVE_MINIMO y $CLAVE_MAXIMO caracteres.")
            nueva != repetida -> return fallar("repetida", "La confirmación no coincide con la nueva contraseña.")
            nueva == actual -> return fallar("nueva", "La nueva contraseña debe ser distinta de la actual.")
        }
        cambiando = true
        errores = emptyMap()
        viewModelScope.launch {
            try {
                c.api.cambiarClave(actual, nueva)
                avisos.mostrar("Contraseña actualizada. Se cerraron las demás sesiones de tu cuenta.", largo = true)
                limpiar()
                cargarSesiones()
            } catch (e: FalloApi) {
                fallar(
                    "actual",
                    if (e.status == 429) "Demasiados intentos. Espera unos minutos antes de volver a intentarlo."
                    else e.message ?: Mensajes.GENERAL,
                )
            } finally {
                cambiando = false
            }
        }
    }

    fun cargarSesiones() {
        viewModelScope.launch {
            errorSesiones = null
            try {
                sesiones = c.api.sesiones().sesiones
            } catch (e: FalloApi) {
                errorSesiones = e.message
            }
        }
    }

    /** Cierra la sesión de otro dispositivo o todas las demás. */
    fun cerrar(id: String?, avisos: Avisos) {
        if (ocupadoSesion != null) return
        ocupadoSesion = id ?: "demas"
        viewModelScope.launch {
            try {
                val r = if (id == null) c.api.cerrarOtrasSesiones() else c.api.cerrarSesion(id)
                sesiones = r.sesiones
                avisos.mostrar(if (id == null) "Se cerraron las demás sesiones de tu cuenta." else "Se cerró la sesión de ese dispositivo.")
                if (r.cerradaActual) c.alcance.launch { c.sesion.salir() }
            } catch (e: FalloApi) {
                avisos.mostrar(e.message ?: Mensajes.GENERAL, largo = true)
                cargarSesiones()
            } finally {
                ocupadoSesion = null
            }
        }
    }
}

@Composable
internal fun SeccionCuenta() {
    val vm = vm { CuentaVM(it) }
    val avisos = LocalAvisos.current
    val contenedor = LocalContenedor.current
    val focos = remember { mapOf("actual" to FocusRequester(), "nueva" to FocusRequester(), "repetida" to FocusRequester()) }
    var cerrarEsta by remember { mutableStateOf(false) }
    LaunchedEffect(vm.foco) {
        val (campo, _) = vm.foco ?: return@LaunchedEffect
        runCatching { focos[campo]?.requestFocus() }
        vm.focoAtendido()
    }

    MarcoSeccion(SeccionAjustes.CUENTA.encabezado, sucio = vm.escrito) {
        Hoja {
            TituloSeccion("Cambiar contraseña", detalle = "Al cambiarla se cierran las demás sesiones abiertas con tu cuenta.")
            Spacer(Modifier.height(14.dp))
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                CampoContrasena(
                    vm.actual,
                    { vm.actual = it; vm.quitarError("actual") },
                    "Contraseña actual",
                    error = vm.errores["actual"],
                    habilitado = !vm.cambiando,
                    foco = focos.getValue("actual"),
                )
                CampoContrasena(
                    vm.nueva,
                    { vm.nueva = it; vm.quitarError("nueva") },
                    "Nueva contraseña (mínimo $CLAVE_MINIMO caracteres)",
                    error = vm.errores["nueva"],
                    nueva = true,
                    habilitado = !vm.cambiando,
                    foco = focos.getValue("nueva"),
                )
                CampoContrasena(
                    vm.repetida,
                    { vm.repetida = it; vm.quitarError("repetida") },
                    "Repite la nueva contraseña",
                    error = vm.errores["repetida"],
                    nueva = true,
                    accionIme = ImeAction.Done,
                    alAccion = { vm.cambiarClave(avisos) },
                    habilitado = !vm.cambiando,
                    foco = focos.getValue("repetida"),
                )
            }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                BotonSecundario("Descartar", vm::limpiar, Modifier.weight(1f), habilitado = vm.escrito && !vm.cambiando)
                BotonPrincipal(
                    if (vm.cambiando) "Guardando…" else "Cambiar contraseña",
                    { vm.cambiarClave(avisos) },
                    Modifier.weight(1.4f),
                    cargando = vm.cambiando,
                )
            }
        }

        Hoja {
            TituloSeccion(
                "Sesiones abiertas",
                detalle = "Los equipos y navegadores donde tu cuenta tiene una sesión abierta. Si no reconoces alguno, ciérralo y cambia tu contraseña.",
            )
            Spacer(Modifier.height(10.dp))
            val sesiones = vm.sesiones
            val error = vm.errorSesiones
            when {
                error != null && sesiones == null -> ErrorCarga(error, vm::cargarSesiones)
                sesiones == null -> Cargando("Cargando sesiones…")
                else -> {
                    sesiones.forEachIndexed { i, s ->
                        if (i > 0) Divisor(Modifier.padding(vertical = 4.dp))
                        FilaSesion(
                            s,
                            ocupado = vm.ocupadoSesion,
                            alCerrar = { if (s.actual) cerrarEsta = true else vm.cerrar(s.id, avisos) },
                        )
                    }
                    val otras = sesiones.count { !it.actual }
                    Spacer(Modifier.height(10.dp))
                    BotonSecundario(
                        if (vm.ocupadoSesion == "demas") "Cerrando…" else "Cerrar las demás",
                        { vm.cerrar(null, avisos) },
                        Modifier.fillMaxWidth(),
                        icono = Iconos.Salir,
                        habilitado = vm.ocupadoSesion == null && otras > 0,
                        cargando = vm.ocupadoSesion == "demas",
                    )
                }
            }
        }
    }

    if (cerrarEsta) {
        DialogoConfirmacion(
            "Cerrar esta sesión",
            "Saldrás del cotizador en este teléfono. Para volver a entrar necesitarás tu correo y tu contraseña.",
            "Cerrar esta sesión",
        ) { ok ->
            cerrarEsta = false
            // Igual que «Cerrar sesión»: salir a propósito descarta el borrador del chat.
            if (ok) contenedor.alcance.launch { contenedor.sesion.salir() }
        }
    }
}

@Composable
private fun FilaSesion(s: SesionCuenta, ocupado: String?, alCerrar: () -> Unit) {
    val c = Neltume.colores
    val dispositivo = s.dispositivo?.takeIf { it.isNotBlank() } ?: "Dispositivo desconocido"
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.Top) {
        Box(
            Modifier.size(36.dp).clip(CircleShape).background(if (s.actual) c.verdeVelo else c.tonal),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Iconos.Dispositivo, null, tint = if (s.actual) c.verde else c.tintaSuave, modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Column(Modifier.semantics(mergeDescendants = true) {}) {
                Text(dispositivo, style = MaterialTheme.typography.titleSmall, color = c.tinta)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (s.actual) {
                        Pildora("Esta sesión", c.verdeVelo, c.verde)
                        if (s.ip != null) Spacer(Modifier.width(8.dp))
                    }
                    if (s.ip != null) Text("IP ${s.ip}", style = MaterialTheme.typography.bodySmall, color = c.apagado)
                }
                Spacer(Modifier.height(2.dp))
                Text("Inicio: ${fechaHoraCuenta(s.creada)}", style = MaterialTheme.typography.bodySmall, color = c.tintaSuave)
                Text("Vence: ${fechaHoraCuenta(s.vence)}", style = MaterialTheme.typography.bodySmall, color = c.apagado)
            }
            BotonTexto(
                when {
                    ocupado == s.id -> "Cerrando…"
                    s.actual -> "Cerrar esta sesión"
                    else -> "Cerrar sesión"
                },
                alCerrar,
                icono = Iconos.Salir,
                habilitado = ocupado == null,
                peligro = true,
            )
        }
    }
}
