package cl.puertasneltume.cotizador.sesion

import cl.puertasneltume.cotizador.BuildConfig
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.credentials.CreatePasswordRequest
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPasswordOption
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import androidx.credentials.PasswordCredential
import cl.puertasneltume.cotizador.R
import cl.puertasneltume.cotizador.diseno.Aviso
import cl.puertasneltume.cotizador.diseno.BotonPrincipal
import cl.puertasneltume.cotizador.diseno.BotonTexto
import cl.puertasneltume.cotizador.diseno.Campo
import cl.puertasneltume.cotizador.diseno.CampoClave
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.Movimiento
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Newsreader
import cl.puertasneltume.cotizador.diseno.TonoAviso
import cl.puertasneltume.cotizador.nucleo.api.ApiNeltume
import cl.puertasneltume.cotizador.nucleo.api.FalloApi
import cl.puertasneltume.cotizador.nucleo.reglas.correoValido
import kotlinx.coroutines.launch

/** Ingreso: la foto de la puerta Neltume sobre el bosque y el formulario en una lámina. */
@Composable
fun PantallaIngreso(gestor: GestorSesion, api: ApiNeltume, correoGuardado: String, primeraCuenta: Boolean, sinConexion: String?) {
    val c = Neltume.colores
    var entrando by remember { mutableStateOf(false) }
    val apertura by animateFloatAsState(if (entrando) 1f else 0f, tween(700, easing = Movimiento.salida), label = "puerta")
    Box(Modifier.fillMaxSize().background(c.bosque)) {
        // La puerta: al ingresar se acerca y se aclara, como la escena 3D de la web.
        Image(
            painterResource(R.drawable.puerta_ingreso),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .fillMaxWidth()
                .height(420.dp)
                .graphicsLayer {
                    scaleX = 1f + apertura * 0.12f
                    scaleY = 1f + apertura * 0.12f
                    alpha = 1f - apertura * 0.3f
                },
        )
        Box(
            Modifier.fillMaxWidth().height(420.dp).background(
                Brush.verticalGradient(0f to Color.Transparent, 0.55f to Color.Transparent, 1f to c.bosque),
            ),
        )
        Column(
            Modifier
                .fillMaxSize()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .statusBarsPadding()
                .windowInsetsPadding(WindowInsets.navigationBars),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 20.dp)) {
                Image(
                    painterResource(R.drawable.logo_neltume),
                    contentDescription = "Neltume",
                    colorFilter = ColorFilter.tint(Color(0xFFF2EAD8)),
                    modifier = Modifier.size(44.dp, 50.dp),
                )
            }
            Spacer(Modifier.height(150.dp))
            Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp)) {
                Text(
                    "Puertas nativas\ndel sur",
                    style = MaterialTheme.typography.displaySmall.copy(fontFamily = Newsreader),
                    color = Color(0xFFF2EAD8),
                )
                Text("Panguipulli, Región de Los Ríos", style = MaterialTheme.typography.bodySmall, color = Color(0xFFEFE6D2).copy(alpha = 0.8f))
            }
            Spacer(Modifier.height(24.dp))
            Column(
                Modifier
                    .widthIn(max = 480.dp)
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp)
                    .clip(RoundedCornerShape(24.dp))
                    .background(c.superficie)
                    .padding(horizontal = 20.dp, vertical = 24.dp),
            ) {
                AnimatedContent(primeraCuenta, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "formulario") { primera ->
                    if (primera) FormularioPrimeraCuenta(gestor, api)
                    else FormularioIngreso(gestor, correoGuardado, sinConexion, alEntrar = { entrando = true })
                }
            }
            Spacer(Modifier.height(16.dp))
            if (BuildConfig.DEBUG) {
                // La versión de pruebas apunta al servidor de pruebas del Mac: que nadie la confunda con la real.
                Text(
                    "Copia de pruebas · los datos no son reales",
                    style = MaterialTheme.typography.labelLarge,
                    color = c.bosqueTinta,
                    modifier = Modifier
                        .padding(bottom = 16.dp)
                        .clip(RoundedCornerShape(50))
                        .background(Color(0xFF7A4E1E))
                        .padding(horizontal = 14.dp, vertical = 6.dp),
                )
            } else Text(
                "Modelo Neltume · 0,80 × 2,00 m",
                style = MaterialTheme.typography.labelSmall,
                color = c.bosqueTinta.copy(alpha = 0.5f),
                modifier = Modifier.padding(bottom = 16.dp),
            )
        }
    }
}

@Composable
private fun FormularioIngreso(gestor: GestorSesion, correoGuardado: String, sinConexion: String?, alEntrar: () -> Unit, vencida: Boolean = false) {
    val c = Neltume.colores
    val contexto = LocalContext.current
    val alcance = rememberCoroutineScope()
    var correo by rememberSaveable(correoGuardado) { mutableStateOf(correoGuardado) }
    var clave by rememberSaveable { mutableStateOf("") }
    var errorCorreo by remember { mutableStateOf<String?>(null) }
    var errorClave by remember { mutableStateOf<String?>(null) }
    var ocupado by remember { mutableStateOf(false) }
    var delGestor by remember { mutableStateOf(false) }

    fun ingresar() {
        if (ocupado) return
        errorCorreo = null
        errorClave = null
        when {
            correo.isBlank() -> errorCorreo = "Escribe tu correo electrónico."
            !correoValido(correo) -> errorCorreo = "Revisa el correo: debe tener la forma nombre@dominio.cl."
            clave.isEmpty() -> errorClave = "Escribe tu contraseña."
            else -> alcance.launch {
                ocupado = true
                try {
                    // Se ofrece guardar la clave antes de entrar (después, esta pantalla ya no existe).
                    gestor.ingresar(correo, clave) {
                        alEntrar()
                        if (!delGestor) ofrecerGuardarClave(contexto, correo.trim(), clave)
                    }
                } catch (e: FalloApi) {
                    clave = ""
                    delGestor = false
                    errorClave = e.message
                } finally {
                    ocupado = false
                }
            }
        }
    }

    // El gestor de contraseñas del teléfono ofrece la clave guardada: con la sesión de 12 h, volver a entrar es un toque.
    LaunchedEffect(Unit) {
        if (clave.isEmpty()) leerClaveGuardada(contexto)?.let { (id, guardada) ->
            correo = id
            clave = guardada
            delGestor = true
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(if (vencida) "Tu sesión expiró" else "Iniciar sesión", style = MaterialTheme.typography.headlineMedium, color = c.tinta)
        Text(
            if (vencida) "Vuelve a ingresar para continuar; lo que escribiste se conservó."
            else "Ingresa con tu cuenta para continuar al cotizador.",
            style = MaterialTheme.typography.bodyMedium,
            color = c.apagado,
        )
        if (sinConexion != null) Aviso(sinConexion, tono = TonoAviso.ATENCION)
        Campo(
            correo,
            { correo = it; errorCorreo = null },
            "Correo electrónico",
            error = errorCorreo,
            teclado = KeyboardType.Email,
            mayusculas = KeyboardCapitalization.None,
            tipoContenido = ContentType.Username + ContentType.EmailAddress,
            largoMaximo = 254,
            habilitado = !ocupado,
        )
        CampoClave(clave, { clave = it; errorClave = null; delGestor = false }, "Contraseña", error = errorClave, alAccion = ::ingresar, habilitado = !ocupado)
        BotonPrincipal("Ingresar", ::ingresar, Modifier.fillMaxWidth(), cargando = ocupado)
    }
}

@Composable
private fun FormularioPrimeraCuenta(gestor: GestorSesion, api: ApiNeltume) {
    val c = Neltume.colores
    val alcance = rememberCoroutineScope()
    var codigo by rememberSaveable { mutableStateOf("") }
    var nombre by rememberSaveable { mutableStateOf("") }
    var correo by rememberSaveable { mutableStateOf("") }
    var clave by rememberSaveable { mutableStateOf("") }
    var repetida by rememberSaveable { mutableStateOf("") }
    var error by remember { mutableStateOf<Pair<String, String>?>(null) }
    var ocupado by remember { mutableStateOf(false) }

    fun crear() {
        val problema = when {
            codigo.isBlank() -> "codigo" to "Pega el código que aparece en el registro del servidor."
            nombre.isBlank() -> "nombre" to "Escribe tu nombre."
            correo.isBlank() -> "correo" to "Escribe tu correo electrónico."
            !correoValido(correo) -> "correo" to "Revisa el correo: debe tener la forma nombre@dominio.cl."
            clave.length !in 8..128 -> "clave" to "La contraseña debe tener entre 8 y 128 caracteres."
            clave != repetida -> "repetida" to "La confirmación no coincide con la contraseña."
            else -> null
        }
        error = problema
        if (problema != null || ocupado) return
        alcance.launch {
            ocupado = true
            try {
                api.crearPrimeraCuenta(codigo, nombre, correo, clave)
                gestor.ingresar(correo, clave)
            } catch (e: FalloApi) {
                val mensaje = e.message ?: ""
                val campo = when {
                    e.status == 403 || Regex("código", RegexOption.IGNORE_CASE).containsMatchIn(mensaje) -> "codigo"
                    Regex("nombre", RegexOption.IGNORE_CASE).containsMatchIn(mensaje) -> "nombre"
                    Regex("correo", RegexOption.IGNORE_CASE).containsMatchIn(mensaje) -> "correo"
                    Regex("contraseña", RegexOption.IGNORE_CASE).containsMatchIn(mensaje) -> "clave"
                    else -> "general"
                }
                error = campo to mensaje
            } finally {
                ocupado = false
            }
        }
    }

    fun errorDe(campo: String) = error?.takeIf { it.first == campo }?.second
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Crear la primera cuenta", style = MaterialTheme.typography.headlineMedium, color = c.tinta)
        Text(
            "El cotizador todavía no tiene cuentas. Pide a quien administra el servidor el código de un solo uso que aparece en su registro.",
            style = MaterialTheme.typography.bodyMedium,
            color = c.apagado,
        )
        errorDe("general")?.let { Aviso(it, tono = TonoAviso.PELIGRO) }
        Campo(codigo, { codigo = it }, "Código de un solo uso", error = errorDe("codigo"), mayusculas = KeyboardCapitalization.None, habilitado = !ocupado)
        Campo(nombre, { nombre = it }, "Tu nombre", error = errorDe("nombre"), mayusculas = KeyboardCapitalization.Words, habilitado = !ocupado)
        Campo(correo, { correo = it }, "Correo electrónico", error = errorDe("correo"), teclado = KeyboardType.Email, tipoContenido = ContentType.NewUsername, habilitado = !ocupado)
        CampoClave(clave, { clave = it }, "Contraseña", error = errorDe("clave"), accionIme = ImeAction.Next, nueva = true, habilitado = !ocupado)
        CampoClave(repetida, { repetida = it }, "Repite la contraseña", error = errorDe("repetida"), alAccion = ::crear, nueva = true, habilitado = !ocupado)
        BotonPrincipal("Crear cuenta e ingresar", ::crear, Modifier.fillMaxWidth(), cargando = ocupado)
    }
}

/** La sesión venció con la app abierta: se ingresa de nuevo sin perder la pantalla ni lo escrito. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HojaSesionVencida(gestor: GestorSesion, correoGuardado: String) {
    val vencida by gestor.vencida.collectAsState()
    if (!vencida) return
    val estado = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { false })
    ModalBottomSheet(
        onDismissRequest = {},
        sheetState = estado,
        containerColor = Neltume.colores.superficie,
        dragHandle = null,
    ) {
        Column(Modifier.padding(horizontal = 20.dp, vertical = 24.dp).imePadding()) {
            FormularioIngreso(gestor, correoGuardado, null, alEntrar = {}, vencida = true)
            Spacer(Modifier.height(8.dp))
            BotonTexto("Ir a la pantalla de ingreso", gestor::irAlIngreso, icono = Iconos.Salir)
        }
    }
}

/** Las pruebas instrumentadas lo apagan: el gestor de contraseñas del sistema abre hojas fuera de la app. */
object GestorDeClaves {
    @Volatile
    var activo: Boolean = true
}

private tailrec fun Context.actividad(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.actividad()
    else -> null
}

private suspend fun leerClaveGuardada(contexto: Context): Pair<String, String>? {
    if (!GestorDeClaves.activo) return null
    val actividad = contexto.actividad() ?: return null
    return try {
        val respuesta = CredentialManager.create(actividad).getCredential(
            actividad,
            GetCredentialRequest(listOf(GetPasswordOption())),
        )
        (respuesta.credential as? PasswordCredential)?.let { it.id to it.password }
    } catch (_: NoCredentialException) {
        null // no hay una clave guardada: se escribe a mano
    } catch (_: GetCredentialException) {
        null // la vendedora cerró la hoja o el gestor no está disponible
    }
}

private suspend fun ofrecerGuardarClave(contexto: Context, correo: String, clave: String) {
    if (!GestorDeClaves.activo) return
    val actividad = contexto.actividad() ?: return
    try {
        CredentialManager.create(actividad).createCredential(actividad, CreatePasswordRequest(correo, clave))
    } catch (_: CreateCredentialException) {
        // No quiso guardarla o el gestor no está disponible: no es un error para ella.
    }
}
