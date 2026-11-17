package cl.puertasneltume.cotizador

import android.content.Context
import android.os.Build
import cl.puertasneltume.cotizador.datos.AlmacenSesion
import cl.puertasneltume.cotizador.datos.Cifrador
import cl.puertasneltume.cotizador.datos.CifradorTink
import cl.puertasneltume.cotizador.datos.Preferencias
import cl.puertasneltume.cotizador.nucleo.api.ApiNeltume
import cl.puertasneltume.cotizador.nucleo.api.ClienteHttp
import cl.puertasneltume.cotizador.nucleo.api.TarroCookies
import cl.puertasneltume.cotizador.sesion.GestorSesion
import coil3.ImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.svg.SvgDecoder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Interceptor
import okhttp3.OkHttpClient

/**
 * Dependencias de la app, creadas una sola vez (inyección manual: pocas piezas, sin procesadores de anotaciones).
 * `servidor` y `cifrador` se pueden cambiar en las pruebas.
 */
class Contenedor(
    val contexto: Context,
    val servidor: String = BuildConfig.SERVIDOR,
    cifrador: Cifrador = CifradorTink(contexto),
) {
    val alcance = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val preferencias = Preferencias(contexto)
    private val almacenSesion = AlmacenSesion(contexto, cifrador)

    private val url = servidor.toHttpUrl()
    val tarro = TarroCookies(TarroCookies.deTexto(url, almacenSesion.cargar())) { galletas ->
        alcance.launch { almacenSesion.guardar(TarroCookies.aTexto(galletas)) }
    }

    /** «NeltumeCotizador/1.0.0 (Android 16; Google Pixel 8)»: así se ve el teléfono en «Sesiones abiertas». */
    val agente = "NeltumeCotizador/${BuildConfig.VERSION_NAME} (Android ${Build.VERSION.RELEASE}; ${Build.MANUFACTURER.replaceFirstChar { it.titlecase() }} ${Build.MODEL})"

    private var gestor: GestorSesion? = null

    /** Un 401 fuera de las rutas de ingreso significa que la sesión venció con la app abierta. */
    private val vigilante = Interceptor { cadena ->
        val respuesta = cadena.proceed(cadena.request())
        if (respuesta.code == 401 && !cadena.request().url.encodedPath.startsWith("/api/auth/")) gestor?.vencio()
        respuesta
    }

    val http = ClienteHttp(servidor, tarro, agente, OkHttpClient.Builder().addInterceptor(vigilante).build())
    val api = ApiNeltume(http)
    val sesion = GestorSesion(api, tarro, preferencias, alcance).also { gestor = it }

    /** Imágenes (logo y fotos de referencia) con la misma sesión. */
    val imagenes: ImageLoader = ImageLoader.Builder(contexto)
        .components {
            add(OkHttpNetworkFetcherFactory(callFactory = { http.http }))
            add(SvgDecoder.Factory())
        }
        .build()
}
