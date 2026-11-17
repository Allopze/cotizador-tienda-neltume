package cl.puertasneltume.cotizador.ajustes

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import cl.puertasneltume.cotizador.comun.LocalNavegador
import cl.puertasneltume.cotizador.comun.MarcoPantalla
import cl.puertasneltume.cotizador.cotizar.DialogoConfirmacion
import cl.puertasneltume.cotizador.diseno.Aviso
import cl.puertasneltume.cotizador.diseno.BotonIcono
import cl.puertasneltume.cotizador.diseno.BotonPrincipal
import cl.puertasneltume.cotizador.diseno.BotonSecundario
import cl.puertasneltume.cotizador.diseno.BotonTexto
import cl.puertasneltume.cotizador.diseno.Campo
import cl.puertasneltume.cotizador.diseno.Hoja
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.Movimiento
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Radios
import cl.puertasneltume.cotizador.diseno.ReglaCarpintero
import cl.puertasneltume.cotizador.diseno.Rotulo
import cl.puertasneltume.cotizador.diseno.TituloSeccion
import cl.puertasneltume.cotizador.diseno.TonoAviso
import cl.puertasneltume.cotizador.navegacion.esAncha
import cl.puertasneltume.cotizador.nucleo.api.JsonNeltume
import cl.puertasneltume.cotizador.nucleo.reglas.Fechas
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.json.JsonElement
import androidx.compose.animation.core.tween

/** Ancho de lectura de Ajustes en tablet: los formularios no se estiran de borde a borde. */
internal val ANCHO_AJUSTES = 720.dp

/** Mismo texto que la web (`AVISO_SALIDA` de pantalla-ajustes.tsx). */
internal const val AVISO_SALIDA = "Hay cambios sin guardar en Ajustes. ¿Salir de todos modos?"

// Mismos límites que Better Auth (minPasswordLength / maxPasswordLength en autenticacion-config).
internal const val CLAVE_MINIMO = 8
internal const val CLAVE_MAXIMO = 128

/**
 * Secciones de Ajustes (src/app/ajustes/secciones.ts): `titulo` en la lista, `encabezado` en la barra de la sección.
 * Las marcadas `admin` solo se muestran a quien administra.
 */
internal enum class SeccionAjustes(
    val id: String,
    val titulo: String,
    val encabezado: String,
    val detalle: String,
    val icono: ImageVector,
    val admin: Boolean,
) {
    CUENTA("cuenta", "Mi cuenta", "Mi cuenta", "Contraseña y sesiones abiertas", Iconos.Usuario, false),
    ASISTENTE("asistente", "Asistente", "Asistente", "Si el asistente funciona, su modelo y su clave", Iconos.Destellos, false),
    EMPRESA("empresa", "Datos de la empresa", "Datos de la empresa", "Contacto, condiciones comerciales y logo", Iconos.Edificio, false),
    PRECIOS("precios", "Precios y descuentos", "Precios y descuentos", "Descuento máximo, descuento por cantidad, IVA y ganancia", Iconos.Porcentaje, false),
    COTIZACIONES("cotizaciones", "Cotizaciones", "Vigencia y transportistas", "Vigencia y transportistas", Iconos.Calendario, false),
    STARKEN("starken", "Starken", "Despacho con Starken", "Ciudad de origen y peso de cada tipo de producto", Iconos.Camion, false),
    FABRICA("fabrica", "Conexión con la fábrica", "Conexión con la fábrica", "Prueba de conexión firmada con la fábrica", Iconos.Fabrica, true),
    USUARIOS("usuarios", "Usuarios", "Usuarios", "Cuentas, contraseñas y registro de cambios", Iconos.Clientes, true),
    ;

    companion object {
        fun visibles(admin: Boolean) = entries.filter { admin || !it.admin }
        fun de(id: String) = entries.firstOrNull { it.id == id }
    }
}

/** Lee una respuesta JSON del servidor con el JSON tolerante de la app. */
internal fun <T> leer(estrategia: DeserializationStrategy<T>, json: JsonElement): T = JsonNeltume.decodeFromJsonElement(estrategia, json)

/** «14 oct 2026, 21:30» en la hora de Chile (`fechaHoraCuenta` de cuentas.ts). */
internal fun fechaHoraCuenta(iso: String): String = runCatching {
    val z = Fechas.enChile(iso)
    "${Fechas.corta(iso)}, ${"%02d:%02d".format(z.hour, z.minute)}"
}.getOrDefault(iso)

// --- Marco de una sección ---------------------------------------------------------------------------------------

/**
 * Pantalla de una sección de Ajustes: barra con volver, regla de carpintero y el contenido desplazable con ancho de
 * lectura. Con cambios sin guardar, volver (botón o gesto) pide confirmar, como el aviso de salida de la web. `pie`
 * es la barra fija de «Guardar cambios».
 */
@Composable
internal fun MarcoSeccion(
    titulo: String,
    sucio: Boolean = false,
    acciones: @Composable RowScope.() -> Unit = {},
    pie: (@Composable () -> Unit)? = null,
    contenido: @Composable ColumnScope.() -> Unit,
) {
    val navegador = LocalNavegador.current
    var confirmarSalida by remember { mutableStateOf(false) }
    BackHandler(enabled = sucio) { confirmarSalida = true }
    MarcoPantalla(titulo, alVolver = { if (sucio) confirmarSalida = true else navegador.volver() }, acciones = acciones) {
        Column(Modifier.fillMaxSize().imePadding()) {
            Box(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()), contentAlignment = Alignment.TopCenter) {
                Column(
                    Modifier.widthIn(max = ANCHO_AJUSTES).fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 2.dp, bottom = 32.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    ReglaCarpintero()
                    contenido()
                }
            }
            pie?.invoke()
        }
    }
    if (confirmarSalida) {
        DialogoConfirmacion("Cambios sin guardar", AVISO_SALIDA, "Salir sin guardar", peligro = true) { salir ->
            confirmarSalida = false
            if (salir) navegador.volver()
        }
    }
}

/**
 * Barra fija de guardado (`AccionesGuardar` de borrador.tsx): aparece al haber cambios, dice que están pendientes y
 * lleva el error del guardado para que se vea sin bajar al final del formulario.
 */
@Composable
internal fun BarraGuardar(
    sucio: Boolean,
    ocupado: Boolean,
    error: String?,
    alDescartar: () -> Unit,
    alGuardar: () -> Unit,
    etiqueta: String = "Guardar cambios",
) {
    val c = Neltume.colores
    AnimatedVisibility(
        sucio || error != null,
        enter = slideInVertically(tween(Movimiento.ENTRADA, easing = Movimiento.salida)) { it } + fadeIn(),
        exit = slideOutVertically(tween(Movimiento.RAPIDO)) { it } + fadeOut(),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .background(c.superficie)
                .then(if (esAncha()) Modifier.navigationBarsPadding() else Modifier),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(Modifier.fillMaxWidth().height(1.dp).background(c.linea))
            Column(
                Modifier.widthIn(max = ANCHO_AJUSTES).fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (error != null) {
                    Text(
                        error,
                        style = MaterialTheme.typography.bodySmall,
                        color = c.peligro,
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    )
                }
                if (sucio && !ocupado) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(8.dp).clip(CircleShape).background(c.pendiente))
                        Spacer(Modifier.width(8.dp))
                        Text("Cambios sin guardar", style = MaterialTheme.typography.labelMedium, color = c.tintaSuave)
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    BotonSecundario("Descartar", alDescartar, Modifier.weight(1f), habilitado = sucio && !ocupado)
                    BotonPrincipal(if (ocupado) "Guardando…" else etiqueta, alGuardar, Modifier.weight(1f), habilitado = sucio, cargando = ocupado)
                }
            }
        }
    }
}

/**
 * Bloque «Avanzado» (avanzado.tsx): lo que con un toque puede dejar mal el cotizador queda plegado, con su
 * advertencia a la vista al abrirlo.
 */
@Composable
internal fun SeccionAvanzada(
    titulo: String,
    advertencia: String,
    abierta: Boolean,
    alCambiar: (Boolean) -> Unit,
    contenido: @Composable ColumnScope.() -> Unit,
) {
    val c = Neltume.colores
    val giro by animateFloatAsState(if (abierta) 180f else 0f, tween(Movimiento.RAPIDO), label = "avanzado")
    Hoja(relleno = PaddingValues(0.dp)) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp)
                .clickable(onClickLabel = if (abierta) "Plegar" else "Desplegar") { alCambiar(!abierta) }
                .semantics(mergeDescendants = true) {
                    role = Role.Button
                    stateDescription = if (abierta) "Desplegado" else "Plegado"
                }
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(36.dp).clip(Radios.md).background(c.calidoVelo), contentAlignment = Alignment.Center) {
                Icon(Iconos.Llave, null, tint = c.calidoTexto, modifier = Modifier.size(18.dp))
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text("Avanzado", style = MaterialTheme.typography.titleSmall, color = c.tinta)
                Text(titulo.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.bodySmall, color = c.apagado)
            }
            Icon(Iconos.Abajo, null, tint = c.apagado, modifier = Modifier.size(18.dp).rotate(giro))
        }
        AnimatedVisibility(abierta, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
            Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Aviso(advertencia, tono = TonoAviso.ATENCION)
                contenido()
            }
        }
    }
}

/** Pliegue simple de una explicación («¿Cómo se estima el bulto?»). */
@Composable
internal fun Plegable(titulo: String, texto: String) {
    val c = Neltume.colores
    var abierto by remember { mutableStateOf(false) }
    val giro by animateFloatAsState(if (abierto) 180f else 0f, tween(Movimiento.RAPIDO), label = "plegable")
    Column(Modifier.fillMaxWidth().clip(Radios.lg).background(c.panel)) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp)
                .clickable { abierto = !abierto }
                .semantics(mergeDescendants = true) {
                    role = Role.Button
                    stateDescription = if (abierto) "Desplegado" else "Plegado"
                }
                .padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Iconos.Info, null, tint = c.pizarra, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(10.dp))
            Text(titulo, style = MaterialTheme.typography.labelLarge, color = c.tinta, modifier = Modifier.weight(1f))
            Icon(Iconos.Abajo, null, tint = c.apagado, modifier = Modifier.size(16.dp).rotate(giro))
        }
        AnimatedVisibility(abierto, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
            Text(texto, style = MaterialTheme.typography.bodySmall, color = c.tintaSuave, modifier = Modifier.padding(start = 14.dp, end = 14.dp, bottom = 14.dp))
        }
    }
}

// --- Textos y estados -------------------------------------------------------------------------------------------

/** Subtítulo en versalitas de un bloque (los `eyebrow` de la web: «SESIONES ABIERTAS», «TOPE DE DESCUENTO»). */
@Composable
internal fun Ceja(texto: String, modifier: Modifier = Modifier) {
    Text(
        texto.uppercase(),
        modifier.semantics { heading() },
        style = MaterialTheme.typography.labelMedium.copy(letterSpacing = 0.08.em),
        color = Neltume.colores.apagado,
    )
}

/** Texto introductorio de una sección o bloque. */
@Composable
internal fun Intro(texto: String, modifier: Modifier = Modifier) {
    Text(texto, modifier, style = MaterialTheme.typography.bodyMedium, color = Neltume.colores.tintaSuave)
}

/** Nota pequeña y apagada (las `muted` de la web). */
@Composable
internal fun Nota(texto: String, modifier: Modifier = Modifier, color: androidx.compose.ui.graphics.Color = Neltume.colores.apagado) {
    Text(texto, modifier, style = MaterialTheme.typography.bodySmall, color = color)
}

/** Aviso de solo lectura para quien no administra (`SinPermiso`): los campos desactivados solos no explican por qué. */
@Composable
internal fun SinPermiso(texto: String = "Solo quien administra el cotizador puede cambiar estos datos.") {
    Aviso(texto, tono = TonoAviso.INFO, titulo = "Solo lectura")
}

@Composable
internal fun Cargando(texto: String, modifier: Modifier = Modifier) {
    val c = Neltume.colores
    Column(
        modifier.fillMaxWidth().padding(vertical = 40.dp).semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator(Modifier.size(28.dp), color = c.verde, strokeWidth = 2.5.dp)
        Spacer(Modifier.height(12.dp))
        Text(texto, style = MaterialTheme.typography.bodySmall, color = c.apagado)
    }
}

@Composable
internal fun ErrorCarga(texto: String, reintentar: () -> Unit, modifier: Modifier = Modifier) {
    Aviso(texto, modifier.semantics { liveRegion = LiveRegionMode.Assertive }, tono = TonoAviso.PELIGRO, accion = {
        BotonTexto("Reintentar", reintentar, icono = Iconos.Recargar)
    })
}

/** Texto de error de un bloque, anunciado por TalkBack. */
@Composable
internal fun TextoError(texto: String, modifier: Modifier = Modifier) {
    Text(
        texto,
        modifier.semantics { liveRegion = LiveRegionMode.Assertive },
        style = MaterialTheme.typography.bodySmall,
        color = Neltume.colores.peligro,
    )
}

// --- Campos -----------------------------------------------------------------------------------------------------

/** Contraseña con el botón para mostrarla y con foco programable (para llevar el foco al campo con error). */
@Composable
internal fun CampoContrasena(
    valor: String,
    alCambiar: (String) -> Unit,
    etiqueta: String,
    modifier: Modifier = Modifier,
    error: String? = null,
    ayuda: String? = null,
    accionIme: ImeAction = ImeAction.Next,
    alAccion: (() -> Unit)? = null,
    nueva: Boolean = false,
    habilitado: Boolean = true,
    foco: FocusRequester? = null,
    autocompletar: Boolean = true,
) {
    var visible by remember { mutableStateOf(false) }
    Campo(
        valor = valor,
        alCambiar = { alCambiar(it.take(if (autocompletar) CLAVE_MAXIMO else 2048)) },
        etiqueta = etiqueta,
        modifier = modifier,
        error = error,
        ayuda = ayuda,
        teclado = KeyboardType.Password,
        accionIme = accionIme,
        alAccion = alAccion,
        habilitado = habilitado,
        transformacion = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
        tipoContenido = if (!autocompletar) null else if (nueva) ContentType.NewPassword else ContentType.Password,
        foco = foco,
        final = {
            BotonIcono(
                if (visible) Iconos.OjoTachado else Iconos.Ojo,
                if (visible) "Ocultar contraseña" else "Mostrar contraseña",
                { visible = !visible },
            )
        },
    )
}

/**
 * Un control que abre una lista (selector de modelo, ciudad de origen): con aspecto de campo, su rótulo arriba y el
 * nombre accesible completo («Ciudad de origen: Temuco»).
 */
@Composable
internal fun SelectorCampo(
    etiqueta: String,
    descripcion: String,
    habilitado: Boolean,
    alPulsar: () -> Unit,
    modifier: Modifier = Modifier,
    contenido: @Composable RowScope.() -> Unit,
) {
    val c = Neltume.colores
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        // El rótulo ya va en el nombre accesible del control: TalkBack no lo repite.
        Rotulo(etiqueta, Modifier.clearAndSetSemantics {})
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp)
                .clip(Radios.md)
                .background(if (habilitado) c.superficie else c.panel)
                .border(1.dp, c.lineaMedia, Radios.md)
                .clickable(enabled = habilitado, onClickLabel = "Elegir", onClick = alPulsar)
                .semantics(mergeDescendants = true) {
                    role = Role.Button
                    contentDescription = "$etiqueta: $descripcion"
                }
                .padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) { Row(verticalAlignment = Alignment.CenterVertically, content = contenido) }
            Spacer(Modifier.width(8.dp))
            Icon(Iconos.Abajo, null, tint = if (habilitado) c.tintaSuave else c.apagado.copy(alpha = 0.5f), modifier = Modifier.size(18.dp))
        }
    }
}

/** Texto principal de un selector, con una línea secundaria opcional. */
@Composable
internal fun TextoSelector(principal: String, secundario: String? = null, apagado: Boolean = false) {
    val c = Neltume.colores
    Column {
        Text(
            principal,
            style = MaterialTheme.typography.bodyLarge,
            color = if (apagado) c.apagado else c.tinta,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (secundario != null) {
            Text(
                secundario,
                style = MaterialTheme.typography.bodySmall.copy(fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace),
                color = c.apagado,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** Hoja inferior con un formulario breve (editar una cuenta, restablecer una contraseña). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun HojaFormulario(
    titulo: String,
    detalle: String?,
    alCerrar: () -> Unit,
    bloqueada: Boolean = false,
    contenido: @Composable ColumnScope.() -> Unit,
) {
    // Mientras se envía, la hoja no se cierra (ni deslizando, ni con el velo, ni con volver).
    val bloqueo by rememberUpdatedState(bloqueada)
    val estado = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { it != SheetValue.Hidden || !bloqueo })
    ModalBottomSheet(alCerrar, sheetState = estado, containerColor = Neltume.colores.superficie) {
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
            TituloSeccion(titulo, detalle = detalle)
            contenido()
        }
    }
}
