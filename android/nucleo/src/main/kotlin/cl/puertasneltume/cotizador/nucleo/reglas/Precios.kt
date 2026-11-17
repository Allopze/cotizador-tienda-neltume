package cl.puertasneltume.cotizador.nucleo.reglas

import cl.puertasneltume.cotizador.nucleo.modelo.Cotizacion
import cl.puertasneltume.cotizador.nucleo.modelo.DescuentoItem
import cl.puertasneltume.cotizador.nucleo.modelo.Linea
import cl.puertasneltume.cotizador.nucleo.modelo.Montos
import cl.puertasneltume.cotizador.nucleo.modelo.Producto
import cl.puertasneltume.cotizador.nucleo.modelo.ReglasComerciales
import cl.puertasneltume.cotizador.nucleo.modelo.TramoDescuento

// Ayudas de precios para la pantalla (src/negocio/precios.ts y descuento-cantidad.ts). El cálculo de montos lo hace
// siempre el servidor; la app solo los muestra.

val NOMBRES_CATEGORIA_MARGEN = linkedMapOf(
    "puertas_solidas_mara_lenga" to "Puertas sólidas Mara / Lenga",
    "puertas_solidas_oregon" to "Puertas sólidas Pino Oregón",
    "puertas_solidas_rauli" to "Puertas sólidas Raulí",
    "puertas_prepintadas" to "Puertas prepintadas",
    "puertas_enchapadas_mara" to "Puertas enchapadas Mara",
    "marcos_finger_sin_enchape" to "Marcos Pino Finger sin enchape",
    "marcos_finger_enchapados" to "Marcos Pino Finger enchapados",
    "marcos_solidos_oregon" to "Marcos sólidos Pino Oregón",
    "marcos_solidos_lenga" to "Marcos sólidos Lenga",
    "accesorios_madera_solida" to "Marcos, molduras y piezas T de madera sólida",
    "otros" to "Otros productos (último recurso)",
)

/** Precio unitario con el descuento especial del ítem. */
fun precioConDescuento(l: Linea): Long = l.precioUnitario - (l.descuentoUnitario ?: 0)

/** Lo que ahorra el descuento especial en toda la línea. */
fun ahorroLinea(l: Linea): Long = l.cantidad * (l.descuentoUnitario ?: 0)

fun conDescuentoItem(l: Linea) = (l.descuentoUnitario ?: 0) > 0

data class ResumenDescuentos(val ahorro: Long, val subtotalOriginal: Long)

fun resumenDescuentosItems(m: Montos): ResumenDescuentos {
    val ahorro = m.lineas.sumOf { ahorroLinea(it) }
    return ResumenDescuentos(ahorro, m.subtotal + ahorro)
}

/** «15 %» o «$5.000 c/u». */
fun textoDescuentoItem(d: DescuentoItem) = if (d.esPorcentaje) porcentaje(d.valor) else "${pesos(d.valor.toLong())} c/u"

/** La descripción escrita por la persona o el producto con las medidas pedidas. */
fun descripcionLinea(l: Linea): String = l.descripcionDocumento?.takeIf { it.isNotEmpty() }
    ?: if (l.anchoSolicitado == null && l.altoSolicitado == null) l.producto.descripcion
    else describirProducto(l.producto, l.anchoSolicitado, l.altoSolicitado)

enum class OrigenMargen { LINEA, PRECIO, COTIZACION, CATEGORIA }

fun origenMargen(l: Linea, margenCotizacion: Double?) = when {
    l.margenPersonalizado -> OrigenMargen.LINEA
    l.precioUnitarioPersonalizado != null -> OrigenMargen.PRECIO
    margenCotizacion != null -> OrigenMargen.COTIZACION
    else -> OrigenMargen.CATEGORIA
}

fun descuentoItemValido(d: DescuentoItem) = if (d.esPorcentaje)
    d.valor.isFinite() && d.valor > 0 && d.valor <= 100 && conDosDecimales(d.valor)
else d.valor == Math.floor(d.valor) && d.valor > 0 && d.valor <= 100_000_000

/** Pesos que descuenta por unidad (centésimas de punto, nunca más que el precio). */
fun descuentoPorUnidad(precioUnitario: Long, d: DescuentoItem?): Long {
    if (d == null) return 0
    val monto = if (d.esPorcentaje) Math.round(precioUnitario * Math.round(d.valor * 100).toDouble() / 10000)
    else d.valor.toLong()
    return minOf(monto, precioUnitario)
}

// --- Descuento por cantidad -------------------------------------------------------------------------------

const val MAX_TRAMOS = 10
const val MAX_DESDE_PUERTAS = 100_000

fun contarPuertas(lineas: List<Linea>) = lineas.filter { it.producto.familia == "PUERTA" }.sumOf { it.cantidad }

fun tramoAplicable(tramos: List<TramoDescuento>?, puertas: Int): TramoDescuento? =
    tramos.orEmpty().filter { it.desdePuertas <= puertas }.maxByOrNull { it.desdePuertas }

fun siguienteTramo(tramos: List<TramoDescuento>?, puertas: Int): TramoDescuento? =
    tramos.orEmpty().filter { it.desdePuertas > puertas }.minByOrNull { it.desdePuertas }

fun textoPuertas(n: Int) = "$n ${if (n == 1) "puerta" else "puertas"}"

/** «desde 20 puertas −10 %». */
fun textoTramo(t: TramoDescuento) = "desde ${t.desdePuertas} puertas −${porcentaje(t.porcentaje)}"

/** ¿Fijó el descuento una persona? Sin el dato, lo que había lo fijó una persona. */
fun descuentoEsManual(q: Cotizacion) = q.descuentoManual ?: (q.descuento > 0)

fun descuentoPorCantidadActivo(q: Cotizacion) = !descuentoEsManual(q) && !q.reglas?.descuentosPorCantidad.isNullOrEmpty()

/** «Descuento por cantidad» solo si lo aplicó un tramo. */
fun etiquetaDescuento(q: Cotizacion) = if (descuentoPorCantidadActivo(q)) "Descuento por cantidad" else "Descuento"

/** Primer problema de una lista de tramos, o null. */
fun errorTramos(tramos: List<TramoDescuento>, descuentoMaximo: Double): String? {
    if (tramos.size > MAX_TRAMOS) return "Puedes definir hasta $MAX_TRAMOS tramos."
    val vistos = mutableSetOf<Int>()
    for (t in tramos) {
        if (t.desdePuertas < 2 || t.desdePuertas > MAX_DESDE_PUERTAS)
            return "«Desde» debe ser un número entero de puertas, de 2 a $MAX_DESDE_PUERTAS."
        val tramo = "«desde ${t.desdePuertas} puertas»"
        if (!t.porcentaje.isFinite()) return "Completa «Desde» y el porcentaje de cada tramo."
        if (t.porcentaje <= 0) return "El porcentaje del tramo $tramo debe ser mayor que 0."
        if (!conDosDecimales(t.porcentaje)) return "El porcentaje del tramo $tramo admite hasta dos decimales."
        if (t.porcentaje > descuentoMaximo)
            return "El porcentaje del tramo $tramo no puede superar el descuento máximo (${porcentaje(descuentoMaximo)})."
        if (!vistos.add(t.desdePuertas)) return "Hay más de un tramo $tramo: cada umbral debe ser distinto."
    }
    return null
}

/** El margen estándar de la categoría (solo para explicar la ganancia; el servidor lo aplica). */
fun reglasDe(q: Cotizacion) = q.reglas ?: ReglasComerciales()

/** ¿El producto es de catálogo (no especial ni libre)? */
fun Producto.esDeCatalogo() = codigo != "ESPECIAL" && codigo != "OTRO"
