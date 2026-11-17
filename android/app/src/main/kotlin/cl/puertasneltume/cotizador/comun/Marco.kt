package cl.puertasneltume.cotizador.comun

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import cl.puertasneltume.cotizador.diseno.BotonIcono
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.Neltume

/** Barra superior: volver (si corresponde), título y acciones. Respeta la barra de estado. */
@Composable
fun BarraSuperior(
    titulo: String,
    modifier: Modifier = Modifier,
    alVolver: (() -> Unit)? = null,
    subtitulo: String? = null,
    acciones: @Composable RowScope.() -> Unit = {},
) {
    val c = Neltume.colores
    Row(
        modifier
            .fillMaxWidth()
            .background(c.papel)
            .windowInsetsPadding(WindowInsets.statusBars)
            .height(60.dp)
            .padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (alVolver != null) BotonIcono(Iconos.Izquierda, "Volver", alVolver, tono = c.tinta)
        else Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                titulo,
                style = MaterialTheme.typography.titleLarge,
                color = c.tinta,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.semantics { heading() },
            )
            if (subtitulo != null) Text(subtitulo, style = MaterialTheme.typography.labelSmall, color = c.apagado, maxLines = 1)
        }
        Row(verticalAlignment = Alignment.CenterVertically, content = acciones)
    }
}

/** Pantalla con barra superior y contenido que llena el resto. */
@Composable
fun MarcoPantalla(
    titulo: String,
    alVolver: (() -> Unit)? = null,
    subtitulo: String? = null,
    acciones: @Composable RowScope.() -> Unit = {},
    contenido: @Composable BoxScope.() -> Unit,
) {
    Column(Modifier.fillMaxSize().background(Neltume.colores.papel)) {
        BarraSuperior(titulo, alVolver = alVolver, subtitulo = subtitulo, acciones = acciones)
        Box(Modifier.weight(1f).fillMaxWidth(), content = contenido)
    }
}
