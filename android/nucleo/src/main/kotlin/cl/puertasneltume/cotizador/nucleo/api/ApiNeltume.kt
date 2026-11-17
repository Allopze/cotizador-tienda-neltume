package cl.puertasneltume.cotizador.nucleo.api

import cl.puertasneltume.cotizador.nucleo.modelo.ClienteDirectorio
import cl.puertasneltume.cotizador.nucleo.modelo.ClienteRegistrado
import cl.puertasneltume.cotizador.nucleo.modelo.Detalle
import cl.puertasneltume.cotizador.nucleo.modelo.EstadoPrimerArranque
import cl.puertasneltume.cotizador.nucleo.modelo.Listado
import cl.puertasneltume.cotizador.nucleo.modelo.Numeracion
import cl.puertasneltume.cotizador.nucleo.modelo.Papelera
import cl.puertasneltume.cotizador.nucleo.modelo.RespuestaConsulta
import cl.puertasneltume.cotizador.nucleo.modelo.Resultado
import cl.puertasneltume.cotizador.nucleo.modelo.SesionActual
import cl.puertasneltume.cotizador.nucleo.modelo.Sesiones
import cl.puertasneltume.cotizador.nucleo.modelo.Vendedoras
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Una respuesta leída y su JSON original. */
class Crudo<T>(val valor: T, val json: JsonObject) {
    /** Las solicitudes de la cotización tal como llegaron. */
    val solicitudes: kotlinx.serialization.json.JsonArray?
        get() = ((json["cotizacion"] as? JsonObject)?.get("solicitudes")) as? kotlinx.serialization.json.JsonArray
}

/** Filtros del historial (`listadoSchema` de src/app/api/accion/route.ts). */
data class FiltrosHistorial(
    val q: String = "",
    val estado: String? = null,
    val vencenPronto: Boolean = false,
    val saldoPendiente: Boolean = false,
    val porFacturar: Boolean = false,
    val desde: String? = null,
    val hasta: String? = null,
    val comercial: List<String> = emptyList(),
    val operativo: List<String> = emptyList(),
    val vendedora: String? = null,
) {
    fun parametros(pagina: Int, porPagina: Int): Map<String, String?> = buildMap {
        if (q.isNotBlank()) put("q", q.trim())
        if (estado != null) put("estado", estado)
        if (vencenPronto) put("vencenPronto", "true")
        if (saldoPendiente) put("saldoPendiente", "true")
        if (porFacturar) put("porFacturar", "true")
        if (desde != null) put("desde", desde)
        if (hasta != null) put("hasta", hasta)
        if (comercial.isNotEmpty()) put("comercial", comercial.joinToString(","))
        if (operativo.isNotEmpty()) put("operativo", operativo.joinToString(","))
        if (vendedora != null) put("vendedora", vendedora)
        put("pagina", pagina.toString())
        put("porPagina", porPagina.toString())
    }

    val activos: Boolean
        get() = q.isNotBlank() || estado != null || vencenPronto || saldoPendiente || porFacturar || desde != null ||
            hasta != null || comercial.isNotEmpty() || operativo.isNotEmpty() || vendedora != null
}

@Serializable
private data class RespuestaClientes(val clientes: List<ClienteDirectorio> = emptyList())

@Serializable
data class DirectorioClientes(
    val clientes: List<ClienteDirectorio> = emptyList(),
    val total: Int = 0,
    val pagina: Int = 1,
    val porPagina: Int = 30,
)

@Serializable
private data class RespuestaCliente(val cliente: ClienteRegistrado? = null)

/**
 * Las rutas del cotizador, tipadas. Cada método corresponde a una llamada de la web (ver el inventario del plan);
 * los errores llegan como [FalloApi] con el mensaje listo para mostrar.
 */
class ApiNeltume(val http: ClienteHttp) {

    // --- Sesión -----------------------------------------------------------------------------------------------

    /** La sesión actual, o null si no hay (better-auth responde `null`). */
    suspend fun sesion(): SesionActual? =
        http.obtener(SesionActual.serializer().nullable, "api/auth/get-session")?.takeIf { it.user != null }

    /**
     * Inicia sesión. Los errores salen con los textos del formulario web: credenciales (401), demasiados intentos
     * (429), red o servidor.
     */
    suspend fun ingresar(email: String, clave: String) {
        try {
            http.enviar(JsonElement.serializer(), "api/auth/sign-in/email", buildJsonObject {
                put("email", email.trim())
                put("password", clave)
            })
        } catch (e: FalloApi) {
            throw when {
                e.status == 0 -> e
                e.status >= 500 -> e
                e.status == 429 -> FalloApi(
                    "Demasiados intentos seguidos. Espera unos minutos antes de volver a intentar.",
                    429,
                    "demasiados_intentos",
                )
                else -> FalloApi("Correo o contraseña incorrectos. Revísalos y vuelve a intentar.", e.status, "credenciales")
            }
        }
    }

    suspend fun salir() {
        try {
            http.enviar(JsonElement.serializer(), "api/auth/sign-out", JsonObject(emptyMap()))
        } catch (e: SesionVencida) {
            // Ya no había sesión: el resultado es el mismo.
        }
    }

    /** Cambia la propia contraseña y cierra las demás sesiones, como Ajustes → Mi cuenta. */
    suspend fun cambiarClave(actual: String, nueva: String) {
        try {
            http.enviar(JsonElement.serializer(), "api/auth/change-password", buildJsonObject {
                put("currentPassword", actual)
                put("newPassword", nueva)
                put("revokeOtherSessions", true)
            })
        } catch (e: FalloApi) {
            throw when (e.status) {
                400, 401 -> if (e is SesionVencida) e else FalloApi("La contraseña actual no es correcta.", e.status, "clave_actual")
                429 -> FalloApi("Demasiados intentos seguidos. Espera unos minutos antes de volver a intentar.", 429)
                else -> e
            }
        }
    }

    /** Estado de la primera cuenta; null cuando ya existe alguna (la ruta responde 404). */
    suspend fun primerArranque(): EstadoPrimerArranque? = try {
        http.obtener(EstadoPrimerArranque.serializer(), "api/primer-arranque")
    } catch (e: FalloApi) {
        if (e.status == 404) null else throw e
    }

    suspend fun crearPrimeraCuenta(codigo: String, nombre: String, email: String, clave: String) {
        http.enviar(JsonElement.serializer(), "api/primer-arranque", buildJsonObject {
            put("codigo", codigo.trim())
            put("nombre", nombre.trim())
            put("email", email.trim())
            put("password", clave)
        })
    }

    suspend fun sesiones(): Sesiones = http.obtener(Sesiones.serializer(), "api/sesiones")

    suspend fun cerrarSesion(id: String): Sesiones = http.enviar(Sesiones.serializer(), "api/sesiones", buildJsonObject {
        put("accion", "cerrar")
        put("id", id)
    })

    suspend fun cerrarOtrasSesiones(): Sesiones =
        http.enviar(Sesiones.serializer(), "api/sesiones", buildJsonObject { put("accion", "cerrar-demas") })

    // --- Cotizaciones -----------------------------------------------------------------------------------------

    /** Cualquier acción de `POST /api/accion` (ver [Acciones]). `larga` para el chat: espera hasta 130 s. */
    suspend fun accion(cuerpo: JsonObject, larga: Boolean = false): Resultado =
        http.enviar(Resultado.serializer(), "api/accion", cuerpo, largo = larga)

    suspend fun detalle(id: String): Detalle = http.obtener(Detalle.serializer(), "api/accion", mapOf("id" to id))

    /**
     * Como [accion], pero con el JSON tal como llegó: deshacer y rehacer devuelven las solicitudes exactamente como
     * el servidor las guardó (el esquema de `restaurar_items` es estricto).
     */
    suspend fun accionCruda(cuerpo: JsonObject, larga: Boolean = false): Crudo<Resultado> {
        val json = http.enviar(JsonObject.serializer(), "api/accion", cuerpo, largo = larga)
        return Crudo(http.json.decodeFromJsonElement(Resultado.serializer(), json), json)
    }

    suspend fun detalleCrudo(id: String): Crudo<Detalle> {
        val json = http.obtener(JsonObject.serializer(), "api/accion", mapOf("id" to id))
        return Crudo(http.json.decodeFromJsonElement(Detalle.serializer(), json), json)
    }

    suspend fun listado(filtros: FiltrosHistorial, pagina: Int = 1, porPagina: Int = 30): Listado =
        http.obtener(Listado.serializer(), "api/accion", filtros.parametros(pagina, porPagina))

    suspend fun exportarCsv(filtros: FiltrosHistorial, parte: Int? = null): Descarga =
        http.descargar("api/accion", filtros.parametros(1, 30) - "pagina" - "porPagina" + buildMap {
            put("formato", "csv")
            if (parte != null) put("parte", parte.toString())
        })

    suspend fun papelera(q: String, pagina: Int, porPagina: Int = 30): Papelera = http.obtener(
        Papelera.serializer(),
        "api/accion",
        mapOf("papelera" to "1", "q" to q.trim().ifEmpty { null }, "pagina" to "$pagina", "porPagina" to "$porPagina"),
    )

    suspend fun numeracion(): Numeracion = http.obtener(Numeracion.serializer(), "api/accion", mapOf("numeracion" to "1"))

    suspend fun vendedoras(): List<String> =
        http.obtener(Vendedoras.serializer(), "api/accion", mapOf("vendedoras" to "1")).vendedoras

    // --- Documentos -------------------------------------------------------------------------------------------

    suspend fun documento(archivo: String): Descarga = http.descargar("api/documento/$archivo")

    suspend fun documentoExiste(archivo: String): Boolean = http.existe("api/documento/$archivo")

    // --- Catálogo ---------------------------------------------------------------------------------------------

    suspend fun catalogo(q: String, familia: String? = null): RespuestaConsulta = http.obtener(
        RespuestaConsulta.serializer(),
        "api/catalogo",
        mapOf("q" to q.trim().take(100).ifEmpty { null }, "familia" to familia),
    )

    /** `POST /api/catalogo` con cualquier `tipo` (alta, gestión, modelos). La respuesta varía según el tipo. */
    suspend fun catalogoAccion(cuerpo: JsonObject, larga: Boolean = false): JsonObject =
        http.enviar(JsonObject.serializer(), "api/catalogo", cuerpo, largo = larga)

    // --- Clientes ---------------------------------------------------------------------------------------------

    suspend fun sugerirClientes(q: String, excluir: String? = null): List<ClienteDirectorio> = http.obtener(
        RespuestaClientes.serializer(),
        "api/clientes",
        mapOf("q" to q.trim(), "excluir" to excluir),
    ).clientes

    suspend fun clientePorRut(rut: String): ClienteRegistrado? =
        http.obtener(RespuestaCliente.serializer(), "api/clientes", mapOf("rut" to rut)).cliente

    suspend fun directorioClientes(q: String, pagina: Int): DirectorioClientes = http.obtener(
        DirectorioClientes.serializer(),
        "api/clientes",
        mapOf("directorio" to "1", "q" to q.trim().ifEmpty { null }, "pagina" to "$pagina"),
    )

    suspend fun crearCliente(datos: JsonObject): ClienteRegistrado? =
        http.enviar(RespuestaCliente.serializer(), "api/clientes", datos).cliente

    suspend fun editarCliente(datos: JsonObject): ClienteRegistrado? =
        http.enviar(RespuestaCliente.serializer(), "api/clientes", datos, metodo = "PATCH").cliente

    suspend fun eliminarCliente(id: String, actualizado: String) {
        http.enviar(JsonElement.serializer(), "api/clientes", buildJsonObject {
            put("id", id)
            put("actualizado", actualizado)
        }, metodo = "DELETE")
    }

    // --- Genéricos para Ajustes, Starken, Usuarios y demás --------------------------------------------------------

    suspend fun obtenerJson(ruta: String, parametros: Map<String, String?> = emptyMap()): JsonObject =
        http.obtener(JsonObject.serializer(), ruta, parametros)

    suspend fun enviarJson(
        ruta: String,
        cuerpo: JsonElement,
        metodo: String = "POST",
        larga: Boolean = false,
        cabeceras: Map<String, String> = emptyMap(),
    ): JsonObject = http.enviar(JsonObject.serializer(), ruta, cuerpo, metodo, larga, cabeceras)

    suspend fun subirReferencia(archivo: ArchivoSubida): JsonObject =
        http.subir(JsonObject.serializer(), "api/referencias", archivo)
}
