package cl.puertasneltume.cotizador.diseno

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import cl.puertasneltume.cotizador.nucleo.reglas.NumerosCL

/**
 * Campo de texto de la app: borde suave, radio 8, 52 dp de alto y el error debajo, unido al campo para TalkBack.
 */
@Composable
fun Campo(
    valor: String,
    alCambiar: (String) -> Unit,
    etiqueta: String,
    modifier: Modifier = Modifier,
    error: String? = null,
    ayuda: String? = null,
    teclado: KeyboardType = KeyboardType.Text,
    accionIme: ImeAction = ImeAction.Next,
    alAccion: (() -> Unit)? = null,
    habilitado: Boolean = true,
    soloLectura: Boolean = false,
    lineas: Int = 1,
    maxLineas: Int = if (lineas > 1) 8 else 1,
    icono: ImageVector? = null,
    sufijo: String? = null,
    prefijo: String? = null,
    transformacion: VisualTransformation = VisualTransformation.None,
    mayusculas: KeyboardCapitalization = KeyboardCapitalization.Sentences,
    tipoContenido: ContentType? = null,
    final: (@Composable () -> Unit)? = null,
    largoMaximo: Int? = null,
    foco: androidx.compose.ui.focus.FocusRequester? = null,
) {
    val c = Neltume.colores
    Column(modifier) {
        OutlinedTextField(
            value = valor,
            onValueChange = { nuevo -> alCambiar(if (largoMaximo != null) nuevo.take(largoMaximo) else nuevo) },
            label = { Text(etiqueta) },
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 52.dp)
                .let { m -> if (foco != null) m.focusRequester(foco) else m }
                .let { m -> if (tipoContenido != null) m.semantics { contentType = tipoContenido } else m },
            enabled = habilitado,
            readOnly = soloLectura,
            isError = error != null,
            singleLine = lineas == 1 && maxLineas == 1,
            minLines = lineas,
            maxLines = maxLineas,
            leadingIcon = icono?.let { { Icon(it, null, Modifier.padding(start = 2.dp)) } },
            trailingIcon = final,
            suffix = sufijo?.let { { Text(it) } },
            prefix = prefijo?.let { { Text(it) } },
            visualTransformation = transformacion,
            supportingText = when {
                error != null -> ({ Text(error) })
                ayuda != null -> ({ Text(ayuda) })
                else -> null
            },
            keyboardOptions = KeyboardOptions(
                keyboardType = teclado,
                imeAction = accionIme,
                capitalization = if (teclado == KeyboardType.Text) mayusculas else KeyboardCapitalization.None,
                autoCorrectEnabled = teclado == KeyboardType.Text,
            ),
            keyboardActions = KeyboardActions(onAny = { alAccion?.invoke() ?: defaultKeyboardAction(accionIme) }),
            shape = Radios.md,
            textStyle = MaterialTheme.typography.bodyLarge,
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = c.verde,
                unfocusedBorderColor = c.lineaMedia,
                focusedLabelColor = c.verde,
                unfocusedLabelColor = c.apagado,
                cursorColor = c.verde,
                focusedContainerColor = c.superficie,
                unfocusedContainerColor = c.superficie,
                disabledContainerColor = c.panel,
                errorBorderColor = c.peligro,
                errorLabelColor = c.peligro,
                errorSupportingTextColor = c.peligro,
                errorCursorColor = c.peligro,
            ),
        )
    }
}

/** Contraseña con el botón para mostrarla. */
@Composable
fun CampoClave(
    valor: String,
    alCambiar: (String) -> Unit,
    etiqueta: String,
    modifier: Modifier = Modifier,
    error: String? = null,
    accionIme: ImeAction = ImeAction.Done,
    alAccion: (() -> Unit)? = null,
    nueva: Boolean = false,
    habilitado: Boolean = true,
) {
    var visible by remember { mutableStateOf(false) }
    Campo(
        valor = valor,
        alCambiar = alCambiar,
        etiqueta = etiqueta,
        modifier = modifier,
        error = error,
        teclado = KeyboardType.Password,
        accionIme = accionIme,
        alAccion = alAccion,
        habilitado = habilitado,
        transformacion = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
        tipoContenido = if (nueva) ContentType.NewPassword else ContentType.Password,
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
 * Pesos mientras se escriben: el campo guarda solo dígitos y muestra los puntos de miles («1.500.000»). El teclado
 * es numérico.
 */
object MilesTransformacion : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        val digitos = text.text
        if (digitos.isEmpty() || !digitos.all { it.isDigit() }) return TransformedText(text, OffsetMapping.Identity)
        val visible = NumerosCL.agruparMiles(digitos)
        // Tablas de posiciones: original → visible y visible → original.
        val aVisible = IntArray(digitos.length + 1)
        val aOriginal = IntArray(visible.length + 1)
        var o = 0
        for (v in visible.indices) {
            aOriginal[v] = o
            if (visible[v] != '.') aVisible[o++] = v
        }
        aVisible[digitos.length] = visible.length
        aOriginal[visible.length] = digitos.length
        val mapa = object : OffsetMapping {
            override fun originalToTransformed(offset: Int) = aVisible[offset.coerceIn(0, digitos.length)]
            override fun transformedToOriginal(offset: Int) = aOriginal[offset.coerceIn(0, visible.length)]
        }
        return TransformedText(AnnotatedString(visible), mapa)
    }
}

/** Campo de monto en pesos (solo dígitos). */
@Composable
fun CampoPesos(
    valor: String,
    alCambiar: (String) -> Unit,
    etiqueta: String,
    modifier: Modifier = Modifier,
    error: String? = null,
    ayuda: String? = null,
    accionIme: ImeAction = ImeAction.Done,
    alAccion: (() -> Unit)? = null,
    habilitado: Boolean = true,
    foco: androidx.compose.ui.focus.FocusRequester? = null,
) {
    Campo(
        foco = foco,
        valor = valor,
        alCambiar = { alCambiar(it.filter(Char::isDigit).trimStart('0').take(12)) },
        etiqueta = etiqueta,
        modifier = modifier,
        error = error,
        ayuda = ayuda,
        teclado = KeyboardType.Number,
        accionIme = accionIme,
        alAccion = alAccion,
        habilitado = habilitado,
        prefijo = "$",
        transformacion = MilesTransformacion,
    )
}
