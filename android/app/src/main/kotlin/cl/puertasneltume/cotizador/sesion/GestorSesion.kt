package cl.puertasneltume.cotizador.sesion

import cl.puertasneltume.cotizador.datos.Preferencias
import cl.puertasneltume.cotizador.nucleo.api.ApiNeltume
import cl.puertasneltume.cotizador.nucleo.api.FalloApi
import cl.puertasneltume.cotizador.nucleo.api.TarroCookies
import cl.puertasneltume.cotizador.nucleo.modelo.UsuarioSesion
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

sealed interface EstadoSesion {
    data object Comprobando : EstadoSesion

    /** Sin sesión. `primeraCuenta` si el servidor todavía no tiene ninguna cuenta. */
    data class Fuera(val primeraCuenta: Boolean = false, val sinConexion: String? = null) : EstadoSesion

    data class Dentro(val usuario: UsuarioSesion) : EstadoSesion
}

/**
 * La sesión de la app. Dura 12 h sin renovarse (better-auth); cuando el servidor responde 401 con la app abierta, no
 * se sale: se pide ingresar de nuevo sobre la pantalla actual y se conserva lo escrito ([vencida]).
 */
class GestorSesion(
    private val api: ApiNeltume,
    private val tarro: TarroCookies,
    private val preferencias: Preferencias,
    private val alcance: CoroutineScope,
) {
    private val _estado = MutableStateFlow<EstadoSesion>(EstadoSesion.Comprobando)
    val estado: StateFlow<EstadoSesion> = _estado.asStateFlow()

    private val _vencida = MutableStateFlow(false)
    val vencida: StateFlow<Boolean> = _vencida.asStateFlow()

    val usuario: UsuarioSesion? get() = (estado.value as? EstadoSesion.Dentro)?.usuario

    /** Todas las cuentas son administradoras hoy, pero la app respeta el rol que informe el servidor. */
    val esAdmin: Boolean get() = usuario?.role?.split(',')?.map { it.trim() }?.contains("admin") ?: false

    private var iniciada = false

    /** Comprueba la sesión una vez por proceso (también si el sistema recreó la app). */
    @Synchronized
    fun iniciar() {
        if (iniciada) return
        iniciada = true
        comprobar()
    }

    fun comprobar() {
        alcance.launch {
            _estado.value = EstadoSesion.Comprobando
            _estado.value = try {
                val sesion = if (tarro.hayGalletas()) api.sesion() else null
                if (sesion?.user != null) EstadoSesion.Dentro(sesion.user!!)
                else EstadoSesion.Fuera(primeraCuenta = api.primerArranque()?.pendiente == true)
            } catch (e: FalloApi) {
                // Sin red al abrir: si había galletas, se entra igual y cada pantalla dirá que no hay conexión.
                if (tarro.hayGalletas()) EstadoSesion.Dentro(UsuarioSesion(name = "")) else EstadoSesion.Fuera(sinConexion = e.message)
            }
        }
    }

    /** Inicia sesión y deja la app adentro. Lanza [FalloApi] con el mensaje del formulario. */
    suspend fun ingresar(email: String, clave: String, antesDeEntrar: suspend () -> Unit = {}) {
        api.ingresar(email, clave)
        preferencias.guardarCorreo(email)
        antesDeEntrar()
        val usuario = api.sesion()?.user ?: UsuarioSesion(email = email)
        _vencida.value = false
        _estado.value = EstadoSesion.Dentro(usuario)
    }

    /** El servidor respondió 401 con la app abierta. */
    fun vencio() {
        if (_estado.value is EstadoSesion.Dentro) _vencida.value = true
    }

    /** Descarta el aviso de sesión vencida y vuelve a la pantalla de ingreso. */
    fun irAlIngreso() {
        _vencida.value = false
        tarro.vaciar()
        _estado.value = EstadoSesion.Fuera()
    }

    suspend fun salir() {
        runCatching { api.salir() }
        tarro.vaciar()
        preferencias.olvidarSesion()
        _vencida.value = false
        _estado.value = EstadoSesion.Fuera()
    }

    /** Actualiza el nombre del usuario cuando llega con datos (al volver la red). */
    fun actualizarUsuario(usuario: UsuarioSesion) {
        _estado.update { if (it is EstadoSesion.Dentro) EstadoSesion.Dentro(usuario) else it }
    }
}
