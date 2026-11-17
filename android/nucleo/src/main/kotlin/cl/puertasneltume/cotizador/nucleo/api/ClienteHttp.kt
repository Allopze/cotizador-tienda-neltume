package cl.puertasneltume.cotizador.nucleo.api

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.coroutines.executeAsync
import java.io.IOException
import java.net.URLDecoder
import java.util.concurrent.TimeUnit

/** JSON del servidor: tolera campos nuevos y valores de enumeración desconocidos (quedan en su valor por omisión). */
val JsonNeltume = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
    encodeDefaults = false
}

/** Mensajes de error iguales a los de la web (src/app/solicitud.ts, `MENSAJES`). */
object Mensajes {
    const val RED = "Sin conexión con el cotizador. Revisa tu red e intenta nuevamente."
    const val TIEMPO =
        "El asistente tardó demasiado en responder. Intenta de nuevo; si se repite, divide el pedido en partes."
    const val CONFLICTO =
        "Otra persona modificó esta cotización al mismo tiempo. Se cargó la versión actual; revísala e intenta nuevamente."
    const val GRANDE = "El contenido es demasiado largo. Acórtalo e intenta nuevamente."
    const val LENTO =
        "El servidor tardó demasiado en responder. Tus datos guardados se conservan; espera un momento e intenta nuevamente."
    const val GENERAL = "No se pudo completar la operación."
    const val NO_ENCONTRADO = "No se encontró el documento solicitado."
    const val SESION = "Tu sesión expiró. Vuelve a ingresar."
    const val CANCELADO = "Se canceló la espera."
    fun servidor(status: Int) =
        "El cotizador tuvo un problema (error $status). Tus datos guardados se conservan; intenta nuevamente en un momento."
}

/**
 * Error de una solicitud: el mensaje ya está listo para mostrarlo. `codigo` es el del servidor (`version_obsoleta`,
 * `mensaje_procesado`, `ia_timeout`…) o uno propio: `red`, `sesion`, `respuesta_invalida`.
 */
open class FalloApi(
    mensaje: String,
    val status: Int,
    val codigo: String? = null,
    val detalle: JsonObject? = null,
) : Exception(mensaje) {
    /** Un dato de `detalle` como texto (`id` en `revision_abierta`, `vence` en `cotizacion_vencida`). */
    fun dato(nombre: String): String? = (detalle?.get(nombre) as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull

    val esConflictoDeVersion: Boolean get() = codigo == "version_obsoleta"
}

/** 401: la sesión venció o se cerró. La app pide ingresar de nuevo sin perder lo escrito. */
class SesionVencida : FalloApi(Mensajes.SESION, 401, "sesion")

/** Mensaje para un estado HTTP, como `mensajePorEstado` de la web. */
fun mensajePorEstado(status: Int, delServidor: String?, codigo: String?): String = when {
    codigo?.startsWith("ia_") == true && delServidor != null -> delServidor
    status == 522 || status == 523 || status == 524 -> Mensajes.LENTO
    status == 504 -> Mensajes.TIEMPO
    status == 502 -> Mensajes.servidor(status)
    delServidor != null -> delServidor
    status == 409 -> Mensajes.CONFLICTO
    status == 413 -> Mensajes.GRANDE
    status == 404 -> Mensajes.NO_ENCONTRADO
    status >= 500 -> Mensajes.servidor(status)
    else -> Mensajes.GENERAL
}

/** Archivo descargado (PDF, CSV) con el nombre que propone el servidor. */
class Descarga(val bytes: ByteArray, val nombre: String?, val tipo: String?)

/** Parte de archivo de una subida multipart. Su largo se conoce: el servidor exige `Content-Length`. */
class ArchivoSubida(val campo: String, val nombre: String, val tipo: String, val bytes: ByteArray)

/**
 * Cliente HTTP del cotizador. La sesión es la cookie firmada de better-auth: se guarda y se devuelve tal como llega
 * (`tarro`). Toda escritura lleva `Origin` con el origen del servidor (better-auth lo exige en un POST con cookie, y
 * `src/servidor/acceso.ts` lo acepta porque coincide con el Host).
 */
class ClienteHttp(
    servidor: String,
    tarro: CookieJar,
    agente: String,
    base: OkHttpClient = OkHttpClient(),
    val json: Json = JsonNeltume,
) {
    val url: HttpUrl = servidor.trimEnd('/').toHttpUrl()
    val origen: String = buildString {
        append(url.scheme).append("://").append(url.host)
        if (url.port != HttpUrl.defaultPort(url.scheme)) append(':').append(url.port)
    }

    private val cabeceras = Interceptor { cadena ->
        val pedido = cadena.request()
        val nuevo = pedido.newBuilder().header("User-Agent", agente)
        if (pedido.method != "GET" && pedido.method != "HEAD") nuevo.header("Origin", origen)
        cadena.proceed(nuevo.build())
    }

    val http: OkHttpClient = base.newBuilder()
        .cookieJar(tarro)
        .addInterceptor(cabeceras)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .followRedirects(false)
        .build()

    /**
     * Para el chat, el alta con IA y «Probar modelo»: el servidor corta a los 90 s (`CMD_PLAZO_TOTAL_MS`) y
     * Cloudflare a los 100 s con un 524. La app espera algo más para recibir el error del servidor.
     */
    private val httpLargo: OkHttpClient = http.newBuilder()
        .readTimeout(130, TimeUnit.SECONDS)
        .callTimeout(140, TimeUnit.SECONDS)
        .build()

    fun ruta(ruta: String, parametros: Map<String, String?> = emptyMap()): HttpUrl {
        val constructor = url.newBuilder()
        ruta.trim('/').split('/').filter { it.isNotEmpty() }.forEach { constructor.addPathSegment(it) }
        parametros.forEach { (clave, valor) -> if (valor != null) constructor.addQueryParameter(clave, valor) }
        return constructor.build()
    }

    suspend fun <T> obtener(
        estrategia: DeserializationStrategy<T>,
        ruta: String,
        parametros: Map<String, String?> = emptyMap(),
    ): T = leer(estrategia, ejecutar(Request.Builder().url(ruta(ruta, parametros)).get().build()))

    suspend fun <T> enviar(
        estrategia: DeserializationStrategy<T>,
        ruta: String,
        cuerpo: JsonElement,
        metodo: String = "POST",
        largo: Boolean = false,
        cabecerasExtra: Map<String, String> = emptyMap(),
    ): T {
        val texto = json.encodeToString(JsonElement.serializer(), cuerpo)
        val pedido = Request.Builder()
            .url(ruta(ruta))
            .method(metodo, texto.toRequestBody(TIPO_JSON))
        cabecerasExtra.forEach { (k, v) -> pedido.header(k, v) }
        return leer(estrategia, ejecutar(pedido.build(), largo))
    }

    suspend fun <T> subir(
        estrategia: DeserializationStrategy<T>,
        ruta: String,
        archivo: ArchivoSubida,
        campos: Map<String, String> = emptyMap(),
    ): T {
        val partes = MultipartBody.Builder().setType(MultipartBody.FORM)
        campos.forEach { (k, v) -> partes.addFormDataPart(k, v) }
        partes.addFormDataPart(archivo.campo, archivo.nombre, archivo.bytes.toRequestBody(archivo.tipo.toMediaType()))
        val cuerpo: RequestBody = partes.build()
        // Las partes tienen largo conocido: OkHttp envía Content-Length y no un cuerpo «chunked», que el servidor rechaza.
        check(cuerpo.contentLength() >= 0)
        return leer(estrategia, ejecutar(Request.Builder().url(ruta(ruta)).post(cuerpo).build(), largo = true))
    }

    /** Descarga binaria autenticada (PDF, CSV, APK). */
    suspend fun descargar(ruta: String, parametros: Map<String, String?> = emptyMap()): Descarga {
        val respuesta = ejecutar(Request.Builder().url(ruta(ruta, parametros)).get().build(), largo = true)
        return respuesta.use { r ->
            if (!r.isSuccessful) throw falloDe(r.code, withContext(Dispatchers.IO) { r.body.string() })
            val bytes = withContext(Dispatchers.IO) { r.body.bytes() }
            Descarga(bytes, nombreDeDisposicion(r.header("Content-Disposition")), r.header("Content-Type"))
        }
    }

    /** ¿Existe el documento? (HEAD, como `documentoDisponible` de la web). */
    suspend fun existe(ruta: String): Boolean {
        val r = ejecutar(Request.Builder().url(ruta(ruta)).head().build())
        r.close()
        if (r.code == 401) throw SesionVencida()
        return r.isSuccessful
    }

    private suspend fun ejecutar(pedido: Request, largo: Boolean = false): Response {
        val cliente = if (largo) httpLargo else http
        return try {
            cliente.newCall(pedido).executeAsync()
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            throw FalloApi(Mensajes.RED, 0, "red")
        }
    }

    private suspend fun <T> leer(estrategia: DeserializationStrategy<T>, respuesta: Response): T {
        val (codigo, texto) = respuesta.use { r ->
            r.code to try {
                withContext(Dispatchers.IO) { r.body.string() }
            } catch (e: IOException) {
                throw FalloApi(Mensajes.RED, 0, "red")
            }
        }
        if (codigo !in 200..299) throw falloDe(codigo, texto)
        val elemento = try {
            if (texto.isBlank()) JsonNull else json.parseToJsonElement(texto)
        } catch (e: Exception) {
            throw FalloApi(Mensajes.servidor(codigo), codigo, "respuesta_invalida")
        }
        return try {
            json.decodeFromJsonElement(estrategia, elemento)
        } catch (e: Exception) {
            throw FalloApi(Mensajes.servidor(codigo), codigo, "respuesta_invalida")
        }
    }

    private fun falloDe(status: Int, texto: String): FalloApi {
        if (status == 401) return SesionVencida()
        val cuerpo = try {
            json.parseToJsonElement(texto).jsonObject
        } catch (e: Exception) {
            null
        }
        val error = (cuerpo?.get("error") as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull
        val codigo = (cuerpo?.get("codigo") as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull
        val detalle = cuerpo?.get("detalle") as? JsonObject
        return FalloApi(mensajePorEstado(status, error, codigo), status, codigo, detalle)
    }

    companion object {
        val TIPO_JSON = "application/json; charset=utf-8".toMediaType()

        /** El nombre de archivo de `Content-Disposition`: `filename*` (UTF-8) si viene y, si no, `filename`. */
        fun nombreDeDisposicion(cabecera: String?): String? {
            if (cabecera == null) return null
            Regex("""filename\*=UTF-8''([^;\s]+)""", RegexOption.IGNORE_CASE).find(cabecera)?.let {
                runCatching { return URLDecoder.decode(it.groupValues[1].replace("+", "%2B"), "UTF-8") }
            }
            return Regex("""filename="([^"]+)"""").find(cabecera)?.groupValues?.get(1)
        }
    }
}

/** Galletas en memoria que avisan al almacén persistente cuando cambian. Descarta las vencidas. */
class TarroCookies(
    iniciales: List<Cookie> = emptyList(),
    private val alCambiar: (List<Cookie>) -> Unit = {},
) : CookieJar {
    private val galletas = iniciales.toMutableList()

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        if (cookies.isEmpty()) return
        val ahora = System.currentTimeMillis()
        for (nueva in cookies) {
            galletas.removeAll { it.name == nueva.name && it.domain == nueva.domain && it.path == nueva.path }
            if (nueva.expiresAt > ahora) galletas.add(nueva)
        }
        alCambiar(galletas.toList())
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val ahora = System.currentTimeMillis()
        if (galletas.removeAll { it.expiresAt <= ahora }) alCambiar(galletas.toList())
        return galletas.filter { it.matches(url) }
    }

    @Synchronized
    fun vaciar() {
        galletas.clear()
        alCambiar(emptyList())
    }

    @Synchronized
    fun hayGalletas(): Boolean = galletas.any { it.expiresAt > System.currentTimeMillis() }

    companion object {
        /** Serializa para guardar: una galleta por línea, en formato `Set-Cookie`. */
        fun aTexto(cookies: List<Cookie>): String = cookies.joinToString("\n") { it.toString() }

        fun deTexto(url: HttpUrl, texto: String): List<Cookie> =
            texto.lines().filter { it.isNotBlank() }.mapNotNull { Cookie.parse(url, it) }
    }
}

/** El texto de un campo de un objeto JSON, o null. */
fun JsonObject.texto(nombre: String): String? = (this[nombre] as? kotlinx.serialization.json.JsonPrimitive)?.let {
    if (it is JsonNull) null else it.contentOrNull
}

internal fun JsonElement.textoPlano(): String? = runCatching { jsonPrimitive.contentOrNull }.getOrNull()
