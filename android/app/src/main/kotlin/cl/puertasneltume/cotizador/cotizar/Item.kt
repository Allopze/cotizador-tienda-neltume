package cl.puertasneltume.cotizador.cotizar

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import cl.puertasneltume.cotizador.diseno.BotonIcono
import cl.puertasneltume.cotizador.diseno.BotonTexto
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.Movimiento
import cl.puertasneltume.cotizador.diseno.MuestraMadera
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Pildora
import cl.puertasneltume.cotizador.diseno.Radios
import cl.puertasneltume.cotizador.diseno.Rotulo
import cl.puertasneltume.cotizador.nucleo.modelo.Cotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.Linea
import cl.puertasneltume.cotizador.nucleo.modelo.SolicitudItem
import cl.puertasneltume.cotizador.nucleo.modelo.TipoMedida
import cl.puertasneltume.cotizador.nucleo.reglas.bonito
import cl.puertasneltume.cotizador.nucleo.reglas.conDescuentoItem
import cl.puertasneltume.cotizador.nucleo.reglas.descripcionLinea
import cl.puertasneltume.cotizador.nucleo.reglas.dimensionesEnMilimetros
import cl.puertasneltume.cotizador.nucleo.reglas.esLibre
import cl.puertasneltume.cotizador.nucleo.reglas.faltantesItem
import cl.puertasneltume.cotizador.nucleo.reglas.fueraDeRegla
import cl.puertasneltume.cotizador.nucleo.reglas.medidaPedida
import cl.puertasneltume.cotizador.nucleo.reglas.nombreFabrica
import cl.puertasneltume.cotizador.nucleo.reglas.nombreProducto
import cl.puertasneltume.cotizador.nucleo.reglas.pesos
import cl.puertasneltume.cotizador.nucleo.reglas.plural
import cl.puertasneltume.cotizador.nucleo.reglas.precioConDescuento
import cl.puertasneltume.cotizador.nucleo.reglas.referenciaCatalogo
import cl.puertasneltume.cotizador.nucleo.reglas.textoDescuentoItem

/** Ítem de la cotización: su línea valorizada o, si está pendiente, lo que falta. */
data class VistaItem(val indice: Int, val solicitud: SolicitudItem, val linea: Linea?) {
    val pendiente: Boolean get() = linea == null
    val familia: String get() = linea?.producto?.familia ?: solicitud.personalizado?.familia ?: "PUERTA"
    val clave: String get() = solicitud.id ?: "i$indice"
}

fun vistaItems(q: Cotizacion): List<VistaItem> = q.solicitudes.mapIndexed { i, s ->
    VistaItem(i, s, q.montos.lineas.firstOrNull { it.indice == i })
}

/** Nombre del ítem para mostrar: la descripción de su línea o lo que se sabe de él. */
fun nombreItem(v: VistaItem): String = v.linea?.let { nombreProducto(descripcionLinea(it)) }
    ?: v.solicitud.descripcion?.takeIf { it.isNotBlank() }
    ?: listOfNotNull(v.solicitud.modelo?.let(::bonito), v.solicitud.madera?.let(::bonito)).joinToString(" ").ifEmpty { "Producto sin datos" }

/**
 * Tarjeta de un ítem. Deslizar a la izquierda lo quita (con «Deshacer» en el aviso); el menú tiene mover, duplicar y
 * quitar, y tocar la tarjeta abre el detalle. Un ítem recién cambiado se resalta y se desvanece en 1,1 s.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TarjetaItem(
    q: Cotizacion,
    v: VistaItem,
    editable: Boolean,
    corregible: Boolean,
    ocultarCostos: Boolean,
    resaltado: Long?,
    ocupado: Boolean,
    vm: CotizadorViewModel,
    abrirDetalle: () -> Unit,
    abrirReferencias: () -> Unit,
    agarre: Modifier,
) {
    val c = Neltume.colores
    val haptico = LocalHapticFeedback.current
    var menu by remember { mutableStateOf(false) }
    val total = q.solicitudes.size
    val resalte = remember { androidx.compose.animation.Animatable(Color.Transparent) }
    LaunchedEffect(resaltado) {
        if (resaltado != null) {
            resalte.snapTo(c.verdeVelo)
            resalte.animateTo(c.superficie.copy(alpha = 0f), tween(Movimiento.RESALTE))
        }
    }
    val estadoDeslizar = rememberSwipeToDismissBoxState(
        confirmValueChange = { valor ->
            if (valor == SwipeToDismissBoxValue.EndToStart && editable && !ocupado) {
                haptico.performHapticFeedback(HapticFeedbackType.Confirm)
                vm.quitar(v.indice)
            }
            false // Vuelve a su lugar: desaparece cuando el servidor confirma.
        },
    )
    val accionesAccesibles = buildList {
        if (editable) {
            add(CustomAccessibilityAction("Quitar ítem") { vm.quitar(v.indice); true })
            add(CustomAccessibilityAction("Duplicar línea") { vm.duplicarLinea(v.indice); true })
            if (v.indice > 0) add(CustomAccessibilityAction("Mover arriba") { vm.reordenar(v.indice, v.indice - 1); true })
            if (v.indice < total - 1) add(CustomAccessibilityAction("Mover abajo") { vm.reordenar(v.indice, v.indice + 1); true })
        }
    }
    SwipeToDismissBox(
        state = estadoDeslizar,
        enableDismissFromStartToEnd = false,
        enableDismissFromEndToStart = editable && !ocupado,
        backgroundContent = {
            Row(
                Modifier.fillMaxSize().clip(Radios.xl).background(c.peligro).padding(horizontal = 24.dp),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Quitar", style = MaterialTheme.typography.labelLarge, color = if (c.oscuro) c.bosque else Color.White)
                Spacer(Modifier.width(8.dp))
                Icon(Iconos.Basura, null, tint = if (c.oscuro) c.bosque else Color.White)
            }
        },
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .clip(Radios.xl)
                .background(c.superficie)
                .background(resalte.value)
                .border(1.dp, if (v.pendiente) c.pendiente.copy(alpha = 0.45f) else c.linea, Radios.xl)
                .clickable(enabled = editable || corregible || v.solicitud.referencias.isNotEmpty(), onClick = abrirDetalle)
                .semantics { customActions = accionesAccesibles }
                .padding(start = 16.dp, end = 4.dp, top = 12.dp, bottom = 8.dp),
        ) {
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f).padding(top = 4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (!esLibre(v.solicitud)) {
                            MuestraMadera(v.linea?.producto?.madera ?: v.solicitud.madera)
                            Spacer(Modifier.width(8.dp))
                        }
                        Text("${v.indice + 1}.", style = MaterialTheme.typography.labelMedium, color = c.apagado)
                        Spacer(Modifier.width(4.dp))
                        Text(nombreItem(v), style = MaterialTheme.typography.titleSmall, color = c.tinta, modifier = Modifier.weight(1f))
                    }
                    val medida = v.linea?.let(::medidaPedida)
                        ?: dimensionesEnMilimetros(v.solicitud.ancho, v.solicitud.alto, v.solicitud.tipoMedida)
                    val codigo = v.linea?.producto?.codigo
                    Text(
                        listOfNotNull(codigo, medida).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall,
                        color = c.apagado,
                    )
                }
                if (editable) Icon(
                    Iconos.Agarre,
                    "Arrastrar para ordenar",
                    tint = c.lineaFuerte,
                    modifier = agarre.padding(10.dp).size(20.dp),
                )
                Box {
                    BotonIcono(Iconos.MasOpciones, "Acciones del ítem ${v.indice + 1}", { menu = true }, habilitado = !ocupado)
                    DropdownMenu(menu, { menu = false }, shape = Radios.lg, containerColor = c.superficie) {
                        ItemMenu(if (editable || corregible) "Editar detalles" else "Ver detalles", Iconos.Lapiz) { menu = false; abrirDetalle() }
                        ItemMenu("Referencias del cliente", Iconos.Clip) { menu = false; abrirReferencias() }
                        if (editable) {
                            ItemMenu("Duplicar línea", Iconos.Duplicar) { menu = false; vm.duplicarLinea(v.indice) }
                            if (v.indice > 0) ItemMenu("Mover arriba", Iconos.FlechaArriba) { menu = false; vm.reordenar(v.indice, v.indice - 1) }
                            if (v.indice < total - 1) ItemMenu("Mover abajo", Iconos.FlechaAbajo) { menu = false; vm.reordenar(v.indice, v.indice + 1) }
                            ItemMenu("Quitar", Iconos.Basura, peligro = true) { menu = false; vm.quitar(v.indice) }
                        }
                    }
                }
            }
            if (v.pendiente) Pendiente(q, v, editable, abrirDetalle)
            v.linea?.let { l -> Importes(l, v, editable || corregible, ocupado, vm) }
            FlowRow(Modifier.padding(top = 6.dp, end = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (v.familia == "PUERTA" && (v.solicitud.ancho != null || v.solicitud.alto != null) && !esLibre(v.solicitud))
                    HojaVano(v.solicitud.tipoMedida ?: v.linea?.tipoMedida, editable || corregible && !ocupado) { t ->
                        vm.editar("tipoMedida.${v.indice}", { tipoMedida(v.indice, t) })
                    }
                if (v.solicitud.personalizado != null) Pildora(
                    if (esLibre(v.solicitud)) "Ítem libre" else "Especial",
                    c.calidoVelo,
                    c.calidoTexto,
                )
                v.linea?.descuentoItem?.let { Pildora("Descuento ${textoDescuentoItem(it)}", c.verdeVelo, c.verde, icono = Iconos.Porcentaje) }
                v.solicitud.fabrica?.let { Pildora(nombreFabrica.getValue(it), c.pizarraVelo, c.pizarra, icono = Iconos.Fabrica) }
                if (v.solicitud.referencias.isNotEmpty()) Box(Modifier.clip(Radios.pildora).clickable(onClick = abrirReferencias)) {
                    Pildora(plural(v.solicitud.referencias.size, "referencia"), c.tonal, c.tintaSuave, icono = Iconos.Clip)
                }
                if (!ocultarCostos && v.linea?.margenPersonalizado == true) Pildora("Ganancia propia", c.tonal, c.tintaSuave)
            }
            v.solicitud.observaciones?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = c.tintaSuave, modifier = Modifier.padding(top = 6.dp, end = 12.dp))
            }
            v.linea?.let { l ->
                if (!v.pendiente && l.producto.codigo != "ESPECIAL" && l.producto.codigo != "OTRO")
                    Text(referenciaCatalogo(l), style = MaterialTheme.typography.labelSmall, color = c.apagado, modifier = Modifier.padding(top = 6.dp, end = 12.dp))
            }
        }
    }
}

@Composable
private fun Pendiente(q: Cotizacion, v: VistaItem, editable: Boolean, abrirDetalle: () -> Unit) {
    val c = Neltume.colores
    val faltan = faltantesItem(q, v.indice).orEmpty()
    val regla = fueraDeRegla(q, v.indice)
    Column(Modifier.padding(top = 8.dp, end = 12.dp).fillMaxWidth().clip(Radios.md).background(c.ambarFondo).padding(10.dp)) {
        Text(
            when {
                regla != null -> "Precio o descuento fuera de regla"
                faltan.isNotEmpty() -> "Pendiente · falta ${faltan.joinToString(", ") { it.etiqueta.lowercase() }}"
                else -> "Pendiente: no suma al total"
            },
            style = MaterialTheme.typography.labelLarge,
            color = c.ambarTexto,
        )
        Text(regla ?: q.incompletos.firstOrNull { it.indice == v.indice }?.pregunta ?: "", style = MaterialTheme.typography.bodySmall, color = c.ambarTexto)
        if (editable) BotonTexto("Completar datos", abrirDetalle, icono = Iconos.Lapiz)
    }
}

/** Cantidad con −/+, unitario y total sin IVA; con descuento del ítem, el precio original tachado. */
@Composable
private fun Importes(l: Linea, v: VistaItem, editable: Boolean, ocupado: Boolean, vm: CotizadorViewModel) {
    val c = Neltume.colores
    val haptico = LocalHapticFeedback.current
    Row(Modifier.fillMaxWidth().padding(top = 10.dp, end = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column {
            Rotulo("Cant.")
            if (editable) Row(verticalAlignment = Alignment.CenterVertically) {
                BotonPaso(Iconos.Menos, "Restar uno", !ocupado && l.cantidad > 1) {
                    haptico.performHapticFeedback(HapticFeedbackType.SegmentTick)
                    vm.editar("cantidad.${v.indice}", { cantidad(v.indice, l.cantidad - 1) })
                }
                Text("${l.cantidad}", style = MaterialTheme.typography.titleMedium, color = c.tinta, modifier = Modifier.padding(horizontal = 10.dp).semantics { contentDescription = "Cantidad ${l.cantidad}" })
                BotonPaso(Iconos.Mas, "Sumar uno", !ocupado && l.cantidad < 10000) {
                    haptico.performHapticFeedback(HapticFeedbackType.SegmentTick)
                    vm.editar("cantidad.${v.indice}", { cantidad(v.indice, l.cantidad + 1) })
                }
            } else Text("${l.cantidad}", style = MaterialTheme.typography.titleMedium, color = c.tinta, modifier = Modifier.height(36.dp).padding(top = 6.dp))
        }
        Spacer(Modifier.weight(1f))
        Column(horizontalAlignment = Alignment.End) {
            Rotulo("Unitario")
            if (conDescuentoItem(l)) {
                Text(pesos(l.precioUnitario), style = MaterialTheme.typography.labelSmall.copy(textDecoration = TextDecoration.LineThrough), color = c.apagado)
                Text(pesos(precioConDescuento(l)), style = MaterialTheme.typography.bodyMedium, color = c.tinta)
            } else Text(pesos(l.precioUnitario), style = MaterialTheme.typography.bodyMedium, color = c.tinta)
        }
        Spacer(Modifier.width(18.dp))
        Column(horizontalAlignment = Alignment.End) {
            Rotulo("Total sin IVA")
            Text(pesos(l.total), style = MaterialTheme.typography.titleMedium, color = c.tinta)
        }
    }
}

@Composable
private fun BotonPaso(icono: androidx.compose.ui.graphics.vector.ImageVector, descripcion: String, habilitado: Boolean, alPulsar: () -> Unit) {
    val c = Neltume.colores
    Box(
        Modifier
            .size(36.dp)
            .clip(Radios.md)
            .background(if (habilitado) c.tonal else c.panel)
            .clickable(enabled = habilitado, onClick = alPulsar)
            .semantics { contentDescription = descripcion },
        contentAlignment = Alignment.Center,
    ) { Icon(icono, null, tint = if (habilitado) c.tinta else c.lineaFuerte, modifier = Modifier.size(16.dp)) }
}

/** Hoja o vano: si la medida es de la puerta o del hueco del muro (falta aclararlo antes de emitir). */
@Composable
fun HojaVano(actual: TipoMedida?, habilitado: Boolean, elegir: (TipoMedida) -> Unit) {
    val c = Neltume.colores
    Row(Modifier.clip(Radios.pildora).border(1.dp, if (actual == null || actual == TipoMedida.NO_ESPECIFICADO) c.pendiente.copy(alpha = 0.5f) else c.lineaMedia, Radios.pildora)) {
        listOf(TipoMedida.HOJA to "Hoja", TipoMedida.VANO to "Vano").forEach { (tipo, texto) ->
            val elegido = actual == tipo
            val fondo by animateColorAsState(if (elegido) c.verde else c.superficie, tween(Movimiento.RAPIDO), label = "hojaVano")
            Text(
                texto,
                style = MaterialTheme.typography.labelMedium,
                color = if (elegido) c.sobreVerde else c.tintaSuave,
                modifier = Modifier
                    .background(fondo)
                    .clickable(enabled = habilitado && !elegido) { elegir(tipo) }
                    .semantics { contentDescription = "Medida de $texto${if (elegido) ", elegida" else ""}" }
                    .padding(horizontal = 14.dp, vertical = 6.dp),
            )
        }
    }
}
