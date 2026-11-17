package cl.puertasneltume.cotizador.datos

import android.content.Context
import android.util.Base64
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.google.crypto.tink.Aead
import com.google.crypto.tink.KeyTemplates
import com.google.crypto.tink.RegistryConfiguration
import com.google.crypto.tink.aead.AeadConfig
import com.google.crypto.tink.integration.android.AndroidKeysetManager
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.runBlocking

private val Context.sesionStore: DataStore<Preferences> by preferencesDataStore(name = "sesion")
private val Context.preferenciasStore: DataStore<Preferences> by preferencesDataStore(name = "preferencias")

/** Cifra la sesión antes de guardarla. En las pruebas (sin Keystore) se usa uno en claro. */
interface Cifrador {
    fun cifrar(texto: String): String
    fun descifrar(texto: String): String?
}

/** AES-256-GCM con la llave maestra en el Android Keystore de este teléfono (no viaja en respaldos). */
class CifradorTink(contexto: Context) : Cifrador {
    private val aead: Aead by lazy {
        AeadConfig.register()
        AndroidKeysetManager.Builder()
            .withSharedPref(contexto, "neltume_llavero", "neltume_llaves")
            .withKeyTemplate(KeyTemplates.get("AES256_GCM"))
            .withMasterKeyUri("android-keystore://neltume_maestra")
            .build()
            .keysetHandle
            .getPrimitive(RegistryConfiguration.get(), Aead::class.java)
    }
    private val asociado = "neltume-sesion".toByteArray()

    override fun cifrar(texto: String): String =
        Base64.encodeToString(aead.encrypt(texto.toByteArray(), asociado), Base64.NO_WRAP)

    override fun descifrar(texto: String): String? = runCatching {
        String(aead.decrypt(Base64.decode(texto, Base64.NO_WRAP), asociado))
    }.getOrNull()
}

class CifradorEnClaro : Cifrador {
    override fun cifrar(texto: String) = texto
    override fun descifrar(texto: String) = texto
}

/** Las galletas de la sesión, cifradas. */
class AlmacenSesion(private val contexto: Context, private val cifrador: Cifrador) {
    private val clave = stringPreferencesKey("galletas")

    /** Lectura síncrona al iniciar la app (un archivo pequeño), antes de la primera solicitud. */
    fun cargar(): String = runBlocking {
        val guardado = contexto.sesionStore.data.first()[clave] ?: return@runBlocking ""
        cifrador.descifrar(guardado) ?: ""
    }

    suspend fun guardar(texto: String) {
        contexto.sesionStore.edit { p ->
            if (texto.isEmpty()) p.remove(clave) else p[clave] = cifrador.cifrar(texto)
        }
    }
}

/**
 * Preferencias de esta persona en este teléfono: lo que la web guarda en sessionStorage y localStorage (texto del
 * mensaje en preparación, cotización abierta, «ocultar costos», nivel de razonamiento por modelo, último correo).
 */
class Preferencias(private val contexto: Context) {
    private val store get() = contexto.preferenciasStore

    private object Claves {
        val correo = stringPreferencesKey("correo")
        val borradorTexto = stringPreferencesKey("borrador.texto")
        val borradorId = stringPreferencesKey("borrador.id")
        val abierta = stringPreferencesKey("abierta")
        val modoCliente = booleanPreferencesKey("modo-cliente")
        val diagnostico = stringPreferencesKey("diagnostico")
        val avisoActualizacion = stringPreferencesKey("aviso-actualizacion")
        fun razonamiento(modelo: String) = stringPreferencesKey("razonamiento:$modelo")
    }

    val correo: Flow<String> = store.data.map { it[Claves.correo] ?: "" }
    suspend fun guardarCorreo(correo: String) = store.edit { it[Claves.correo] = correo.trim() }

    val modoCliente: Flow<Boolean> = store.data.map { it[Claves.modoCliente] ?: false }
    suspend fun guardarModoCliente(valor: Boolean) = store.edit { it[Claves.modoCliente] = valor }

    /** Texto escrito en el chat y la cotización a la que pertenece; sobrevive a cerrar la app. */
    suspend fun borrador(): Pair<String, String?> = store.data.first().let { (it[Claves.borradorTexto] ?: "") to it[Claves.borradorId] }
    suspend fun guardarBorrador(texto: String, id: String?) = store.edit {
        if (texto.isBlank()) {
            it.remove(Claves.borradorTexto)
            it.remove(Claves.borradorId)
        } else {
            it[Claves.borradorTexto] = texto
            if (id != null) it[Claves.borradorId] = id else it.remove(Claves.borradorId)
        }
    }

    suspend fun abierta(): String? = store.data.first()[Claves.abierta]
    suspend fun guardarAbierta(id: String?) = store.edit { if (id == null) it.remove(Claves.abierta) else it[Claves.abierta] = id }

    suspend fun razonamiento(modelo: String): String? = store.data.first()[Claves.razonamiento(modelo)]
    suspend fun guardarRazonamiento(modelo: String, nivel: String) = store.edit { it[Claves.razonamiento(modelo)] = nivel }

    /** Última respuesta del chat (modelo, respaldo, ms) para Ajustes → Asistente, sin texto de la conversación. */
    val diagnostico: Flow<String?> = store.data.map { it[Claves.diagnostico] }
    suspend fun guardarDiagnostico(json: String) = store.edit { it[Claves.diagnostico] = json }

    /** Versión de la app cuyo aviso de actualización ya se descartó. */
    suspend fun avisoActualizacion(): String? = store.data.first()[Claves.avisoActualizacion]
    suspend fun guardarAvisoActualizacion(version: String) = store.edit { it[Claves.avisoActualizacion] = version }

    /** Al cerrar sesión se olvida lo de la sesión, pero no el correo. */
    suspend fun olvidarSesion() = store.edit {
        it.remove(Claves.borradorTexto)
        it.remove(Claves.borradorId)
        it.remove(Claves.abierta)
        it.remove(Claves.diagnostico)
    }
}
