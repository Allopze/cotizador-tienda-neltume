package cl.puertasneltume.cotizador

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import cl.puertasneltume.cotizador.diseno.TemaNeltume
import cl.puertasneltume.cotizador.sesion.EstadoSesion

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        val contenedor = (application as AppNeltume).contenedor
        // El splash se queda mientras se comprueba la sesión: así no parpadea el ingreso antes de entrar.
        installSplashScreen().setKeepOnScreenCondition { contenedor.sesion.estado.value is EstadoSesion.Comprobando }
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        contenedor.sesion.iniciar()
        setContent { TemaNeltume { RaizApp(contenedor) } }
    }
}
