package cl.puertasneltume.cotizador.ajustes

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cl.puertasneltume.cotizador.Contenedor
import cl.puertasneltume.cotizador.comun.Avisos
import cl.puertasneltume.cotizador.comun.LocalAvisos
import cl.puertasneltume.cotizador.comun.LocalContenedor
import cl.puertasneltume.cotizador.comun.LocalNavegador
import cl.puertasneltume.cotizador.comun.vm
import cl.puertasneltume.cotizador.diseno.Aviso
import cl.puertasneltume.cotizador.diseno.BotonPrincipal
import cl.puertasneltume.cotizador.diseno.BotonSecundario
import cl.puertasneltume.cotizador.diseno.BotonTexto
import cl.puertasneltume.cotizador.diseno.Divisor
import cl.puertasneltume.cotizador.diseno.Hoja
import cl.puertasneltume.cotizador.diseno.Iconos
import cl.puertasneltume.cotizador.diseno.Neltume
import cl.puertasneltume.cotizador.diseno.Rotulo
import cl.puertasneltume.cotizador.diseno.TonoAviso
import cl.puertasneltume.cotizador.documentos.VisorPdf
import cl.puertasneltume.cotizador.nucleo.api.FalloApi
import cl.puertasneltume.cotizador.nucleo.api.Mensajes
import cl.puertasneltume.cotizador.nucleo.reglas.Fechas
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// Ajustes → «Conexión con la fábrica» (src/app/ajustes/conexion-fabrica.tsx y conexion.ts), solo administración: qué
// falta de la configuración, el envío de un PDF de prueba firmado y las últimas pruebas enviadas y recibidas.

@Serializable
internal data class DetalleConfiguracion(
    val urlPresente: Boolean = false,
    val secretoPresente: Boolean = false,
    val urlValida: Boolean = false,
    val secretoValido: Boolean = false,
    val completa: Boolean = false,
    val falta: String? = null,
)

@Serializable
internal data class PruebaListada(
    val id: Long,
    val direccion: String = "enviada",
    val eventoId: String = "",
    val fecha: String = "",
    val resultado: String = "",
    val detalle: String? = null,
    val latenciaMs: Long? = null,
    val tienePdf: Boolean = false,
)

@Serializable
internal data class FabricaConexion(
    val fabrica: String,
    val nombre: String = "",
    val configuracion: DetalleConfiguracion = DetalleConfiguracion(),
    val pruebas: List<PruebaListada> = emptyList(),
)

@Serializable
internal data class EstadoConexion(val fabricas: List<FabricaConexion> = emptyList())

@Serializable
internal data class ResultadoEnvioPrueba(val resultado: String = "", val mensaje: String = "", val aviso: String? = null)

@Serializable
internal data class RespuestaPrueba(val prueba: ResultadoEnvioPrueba, val pruebas: List<PruebaListada> = emptyList())

/** Código corto de la prueba: el que lleva el PDF, para cruzarlo con lo que ve la otra aplicación. */
private fun codigoPrueba(eventoId: String) = eventoId.take(8)

private fun textoDireccion(direccion: String) = if (direccion == "enviada") "Enviada a la fábrica" else "Recibida de la fábrica"

/** El resultado de una prueba como se lee en la lista; el de un fallo es el diagnóstico que se mostró al enviarla. */
private fun textoResultadoPrueba(p: PruebaListada) = when (p.resultado) {
    "recibida" -> "Recibida"
    "aceptada" -> "Aceptada${p.latenciaMs?.let { " en $it ms" } ?: ""}"
    "duplicada" -> "Duplicada: la otra app ya la tenía"
    "sin_respuesta" -> p.detalle ?: "Sin respuesta"
    else -> p.detalle ?: "Rechazada"
}

private fun textoUrl(c: DetalleConfiguracion) = if (c.urlValida) "Configurada" else if (c.urlPresente) "No sirve: debe ser HTTPS" else "Falta"
private fun textoSecreto(c: DetalleConfiguracion) =
    if (c.secretoValido) "Configurado" else if (c.secretoPresente) "No sirve: debe tener al menos 32 caracteres" else "Falta"

internal class ConexionVM(private val c: Contenedor) : ViewModel() {
    var estado by mutableStateOf<EstadoConexion?>(null)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var enviando by mutableStateOf<String?>(null)
        private set
    var actualizando by mutableStateOf(false)
        private set
    var ultima by mutableStateOf<Map<String, ResultadoEnvioPrueba>>(emptyMap())
        private set
    /** Error del último envío de cada fábrica. */
    var errorEnvio by mutableStateOf<Map<String, String>>(emptyMap())
        private set

    init {
        cargar()
    }

    private suspend fun leerEstado() = leer(EstadoConexion.serializer(), c.api.obtenerJson("api/ajustes/conexion"))

    fun cargar() {
        viewModelScope.launch {
            error = null
            try {
                estado = leerEstado()
            } catch (e: FalloApi) {
                error = e.message
            }
        }
    }

    /** «Actualizar lista» confirma que actualizó (auditoría BUG-065). */
    fun actualizar(avisos: Avisos) {
        if (actualizando) return
        actualizando = true
        viewModelScope.launch {
            try {
                estado = leerEstado()
                error = null
                avisos.mostrar("Lista actualizada.")
            } catch (e: FalloApi) {
                error = e.message
            } finally {
                actualizando = false
            }
        }
    }

    fun enviar(f: FabricaConexion) {
        if (enviando != null) return
        enviando = f.fabrica
        errorEnvio = errorEnvio - f.fabrica
        viewModelScope.launch {
            try {
                val r = leer(RespuestaPrueba.serializer(), c.api.enviarJson("api/ajustes/conexion", buildJsonObject { put("fabrica", f.fabrica) }, larga = true))
                ultima = ultima + (f.fabrica to r.prueba)
                estado = estado?.let { e -> e.copy(fabricas = e.fabricas.map { x -> if (x.fabrica == f.fabrica) x.copy(pruebas = r.pruebas) else x }) }
            } catch (e: FalloApi) {
                errorEnvio = errorEnvio + (f.fabrica to (e.message ?: Mensajes.GENERAL))
            } finally {
                enviando = null
            }
        }
    }
}

@Composable
internal fun SeccionConexionFabrica() {
    val vm = vm { ConexionVM(it) }
    val avisos = LocalAvisos.current
    val e = vm.estado
    MarcoSeccion(SeccionAjustes.FABRICA.encabezado) {
        when {
            e == null && vm.error != null -> ErrorCarga(vm.error!!, vm::cargar)
            e == null -> Cargando("Cargando la conexión con la fábrica…")
            else -> {
                Intro(
                    "Comprueba que la tienda y la fábrica se hablan: envía un PDF de prueba firmado a la fábrica y muestra el resultado al instante. La fábrica tiene el mismo botón en sus Ajustes; lo que ella envíe aparece abajo como «Recibida de la fábrica», con el mismo código de prueba que lleva el PDF. Una prueba no crea pedidos ni cotizaciones.",
                )
                vm.error?.let { TextoError(it) }
                e.fabricas.forEach { f -> TarjetaFabrica(vm, f, avisos) }
            }
        }
    }
}

@Composable
private fun TarjetaFabrica(vm: ConexionVM, f: FabricaConexion, avisos: Avisos) {
    val c = Neltume.colores
    val navegador = LocalNavegador.current
    val conf = f.configuracion
    val resultado = vm.ultima[f.fabrica]
    Hoja {
        Ceja("Fábrica ${f.nombre}")
        Spacer(Modifier.height(10.dp))
        Row(Modifier.fillMaxWidth()) {
            Column(Modifier.weight(1f).semantics(mergeDescendants = true) {}) {
                Rotulo("URL de la fábrica")
                Text(textoUrl(conf), style = MaterialTheme.typography.bodyMedium, color = if (conf.urlValida) c.tinta else c.peligro)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f).semantics(mergeDescendants = true) {}) {
                Rotulo("Secreto compartido")
                Text(textoSecreto(conf), style = MaterialTheme.typography.bodyMedium, color = if (conf.secretoValido) c.tinta else c.peligro)
            }
        }
        conf.falta?.let {
            Spacer(Modifier.height(10.dp))
            Aviso(it, tono = TonoAviso.ATENCION)
        }
        Spacer(Modifier.height(12.dp))
        BotonPrincipal(
            if (vm.enviando == f.fabrica) "Enviando…" else "Enviar PDF de prueba a la fábrica",
            { vm.enviar(f) },
            Modifier.fillMaxWidth(),
            icono = Iconos.Enviar,
            habilitado = conf.completa && vm.enviando == null,
            cargando = vm.enviando == f.fabrica,
        )
        Spacer(Modifier.height(8.dp))
        BotonSecundario(
            if (vm.actualizando) "Actualizando…" else "Actualizar lista",
            { vm.actualizar(avisos) },
            Modifier.fillMaxWidth(),
            icono = Iconos.Recargar,
            habilitado = !vm.actualizando && vm.enviando == null,
        )
        val errorEnvio = vm.errorEnvio[f.fabrica]
        errorEnvio?.let {
            Spacer(Modifier.height(10.dp))
            Aviso(it, tono = TonoAviso.PELIGRO)
        }
        if (resultado != null && errorEnvio == null && vm.enviando != f.fabrica) {
            Spacer(Modifier.height(10.dp))
            Aviso(
                "${resultado.mensaje}.${resultado.aviso?.let { " $it" } ?: ""}",
                tono = if (resultado.resultado == "aceptada") TonoAviso.EXITO else TonoAviso.PELIGRO,
            )
        }

        Spacer(Modifier.height(16.dp))
        Rotulo("Últimas pruebas")
        Spacer(Modifier.height(4.dp))
        if (f.pruebas.isEmpty()) {
            Nota("Todavía no hay pruebas enviadas ni recibidas.")
        } else {
            f.pruebas.forEachIndexed { i, p ->
                if (i > 0) Divisor(Modifier.padding(vertical = 2.dp))
                Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f).semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(Fechas.fechaHora(p.fecha), style = MaterialTheme.typography.titleSmall, color = c.tinta)
                        Text(
                            "${textoDireccion(p.direccion)} · código ${codigoPrueba(p.eventoId)}",
                            style = MaterialTheme.typography.bodySmall,
                            color = c.apagado,
                        )
                        val ok = p.resultado == "aceptada" || p.resultado == "recibida"
                        Text(textoResultadoPrueba(p), style = MaterialTheme.typography.bodySmall, color = if (ok) c.verde else c.peligro)
                    }
                    Spacer(Modifier.width(8.dp))
                    if (p.tienePdf) {
                        BotonTexto("Ver PDF", { navegador.empujar(rutaPdfPrueba(p.id, codigoPrueba(p.eventoId))) }, icono = Iconos.Archivo)
                    } else {
                        Nota("Sin PDF")
                    }
                }
            }
        }
    }
}

/** El PDF de una prueba de conexión, en el visor de la app (descargado con la sesión). */
@Composable
internal fun PdfPrueba(id: String, codigo: String?) {
    val contenedor = LocalContenedor.current
    VisorPdf(
        "prueba-$id.pdf",
        if (codigo.isNullOrBlank()) "Prueba de conexión" else "Prueba $codigo",
        compartible = false,
        regenerable = false,
    ) { contenedor.http.descargar("api/ajustes/conexion/pruebas/$id") }
}
