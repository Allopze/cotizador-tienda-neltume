package cl.puertasneltume.cotizador

import android.app.Application
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader

class AppNeltume : Application(), SingletonImageLoader.Factory {
    lateinit var contenedor: Contenedor
        private set

    override fun onCreate() {
        super.onCreate()
        contenedor = Contenedor(this)
    }

    override fun newImageLoader(context: PlatformContext): ImageLoader = contenedor.imagenes
}
