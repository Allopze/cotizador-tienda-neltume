package cl.puertasneltume.cotizador.nucleo.reglas

import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

/** Fechas en la zona de Chile, como src/negocio/vigencia.ts y src/app/formato.ts. */
object Fechas {
    val ZONA: ZoneId = ZoneId.of("America/Santiago")

    /** Reloj de la app; las pruebas lo fijan. */
    @Volatile
    var reloj: Clock = Clock.systemUTC()

    private val MESES_CORTOS = listOf("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic")
    private val MESES = listOf(
        "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre",
        "diciembre",
    )
    private val SOLO_FECHA = Regex("""^\d{4}-\d{2}-\d{2}$""")

    /** Instante de un texto ISO. Una fecha sin hora se lee a mediodía UTC: a medianoche caería el día anterior en Chile. */
    fun instante(iso: String): Instant = when {
        SOLO_FECHA.matches(iso) -> Instant.parse("${iso}T12:00:00Z")
        else -> runCatching { Instant.parse(iso) }.getOrElse { OffsetDateTime.parse(iso).toInstant() }
    }

    fun enChile(iso: String): ZonedDateTime = instante(iso).atZone(ZONA)

    fun ahora(): Instant = Instant.now(reloj)

    /** «12 sept 2026»: listas y opciones. */
    fun corta(iso: String): String = enChile(iso).let { "${it.dayOfMonth} ${MESES_CORTOS[it.monthValue - 1]} ${it.year}" }

    /** «12 de septiembre de 2026»: panel de la cotización. */
    fun larga(iso: String): String = enChile(iso).let { "${it.dayOfMonth} de ${MESES[it.monthValue - 1]} de ${it.year}" }

    /** «Septiembre de 2026»: encabezados de mes del historial. */
    fun mesAnio(iso: String): String =
        enChile(iso).let { "${MESES[it.monthValue - 1].replaceFirstChar { c -> c.uppercase() }} de ${it.year}" }

    /**
     * Fecha local (YYYY-MM-DD) en Santiago de un instante ISO (`fechaLocal`). Como `new Date` de JavaScript, una
     * fecha sin hora es medianoche UTC (no mediodía, como en `corta` y `larga`).
     */
    fun local(iso: String): String =
        (if (SOLO_FECHA.matches(iso)) Instant.parse("${iso}T00:00:00Z") else instante(iso)).atZone(ZONA).toLocalDate().toString()

    fun local(instante: Instant): String = instante.atZone(ZONA).toLocalDate().toString()

    /** Hoy en Chile (YYYY-MM-DD). */
    fun hoy(): String = local(ahora())

    fun hoyLocal(): LocalDate = ahora().atZone(ZONA).toLocalDate()

    /** «25-10-2026 14:30» (`fechaHoraChile`). */
    fun fechaHora(iso: String): String = runCatching {
        enChile(iso).format(DateTimeFormatter.ofPattern("dd-MM-yyyy HH:mm"))
    }.getOrDefault(iso)

    /** «25-10-2026» desde «2026-10-25» (`fechaChilena`). */
    fun chilena(fecha: String): String {
        val partes = fecha.take(10).split('-')
        return if (partes.size == 3) "${partes[2]}-${partes[1]}-${partes[0]}" else fecha
    }

    /** ¿Ya pasó el último día de validez? (`estaVencida`). */
    fun vencida(vence: String?, ahora: Instant = ahora()): Boolean = !vence.isNullOrEmpty() && local(ahora) > vence

    /** «hace 5 min», «ayer 14:30»: para la lista de sesiones y la actividad reciente. */
    fun relativa(iso: String, ahora: Instant = ahora()): String {
        val momento = instante(iso)
        val segundos = (ahora.epochSecond - momento.epochSecond).coerceAtLeast(0)
        val local = momento.atZone(ZONA)
        val hoy = ahora.atZone(ZONA).toLocalDate()
        val hora = local.format(DateTimeFormatter.ofPattern("HH:mm"))
        return when {
            segundos < 60 -> "recién"
            segundos < 3600 -> "hace ${segundos / 60} min"
            local.toLocalDate() == hoy -> "hoy $hora"
            local.toLocalDate() == hoy.minusDays(1) -> "ayer $hora"
            else -> "${corta(iso)} $hora"
        }
    }
}
