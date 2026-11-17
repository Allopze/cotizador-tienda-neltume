package cl.puertasneltume.cotizador.catalogo

import java.text.Normalizer
import kotlin.math.abs
import kotlin.math.min

// Cómo reconoce el asistente maderas y modelos: port de src/catalogo/configuracion.ts (solo lo que usa «Probar» y
// la validación de «Nombres y alias»). Lógica pura, sin Android.

internal data class MaderaConfigurada(val nombre: String, val codigo: String, val alias: List<String>)

/** Configuración del catálogo. Los registros de la web van como listas de pares, en el mismo orden. */
internal data class ConfiguracionCatalogo(
    val maderas: List<MaderaConfigurada>,
    val familiasPorModelo: List<Pair<String, String>>,
    val aliasModelos: List<Pair<String, List<String>>>,
    val aliasPosiblesModelos: List<Pair<String, List<String>>>,
)

private val MARCAS = Regex("[\\u0300-\\u036f]")
private val NO_ALFANUMERICO = Regex("[^A-Z0-9]")
private val SEPARADORES = Regex("[^A-Z0-9]+")
private val DOBLES = Regex("(.)\\1+")

private fun sinTildesMayusculas(s: String) = Normalizer.normalize(s, Normalizer.Form.NFD).replace(MARCAS, "").uppercase()

/** Sin tildes, en mayúsculas y solo letras y números: «Huilo huilo» → «HUILOHUILO». */
internal fun normalizarCatalogo(s: String) = sinTildesMayusculas(s).replace(NO_ALFANUMERICO, "")

/**
 * Clave tolerante a errores de escritura: junta palabras repetidas («WILO WILO» → «WILO») y colapsa letras dobles
 * («HUILLO» → «HUILO»). La coincidencia exacta siempre gana.
 */
internal fun claveTolerante(s: String): String {
    val palabras = sinTildesMayusculas(s).split(SEPARADORES).filter { it.isNotEmpty() }
    val propias = if (palabras.size >= 2 && palabras.all { it == palabras[0] }) listOf(palabras[0]) else palabras
    return normalizarCatalogo(propias.joinToString(" ")).replace(DOBLES, "\$1")
}

/** Dueños (por identidad normalizada) de la clave tolerante de `valor` entre `entradas`. */
private fun duenosTolerantes(valor: String, entradas: List<Pair<String, List<String>>>): Map<String, String> {
    val clave = claveTolerante(valor)
    if (clave.isEmpty()) return emptyMap()
    val duenos = LinkedHashMap<String, String>()
    entradas.filter { (_, palabras) -> palabras.any { claveTolerante(it) == clave } }.forEach { (n, _) -> duenos[normalizarCatalogo(n)] = n }
    return duenos
}

/** Único dueño de la clave tolerante; null si nadie la tiene o si la tienen dos (ambigua). */
private fun duenoTolerante(valor: String, entradas: List<Pair<String, List<String>>>): String? =
    duenosTolerantes(valor, entradas).values.singleOrNull()

/** Madera a la que lleva `valor` (nombre o alias, exacto o con la clave tolerante); null si ninguna. */
internal fun resolverMaderaConfigurada(valor: String, configuracion: ConfiguracionCatalogo, tolerante: Boolean = true): String? {
    val clave = normalizarCatalogo(valor)
    val exacta = configuracion.maderas.firstOrNull { m ->
        normalizarCatalogo(m.nombre) == clave || m.alias.any { normalizarCatalogo(it) == clave }
    }
    if (exacta != null || !tolerante) return exacta?.nombre
    return duenoTolerante(valor, configuracion.maderas.map { it.nombre to listOf(it.nombre) + it.alias })
}

/** Singulares de una clave: sin la «s» final y, si termina en «es», también sin ella. Las cortas no se tocan. */
private fun singularesCatalogo(clave: String) = buildList {
    if (clave.length > 3 && clave.endsWith("S")) add(clave.dropLast(1))
    if (clave.length > 4 && clave.endsWith("ES")) add(clave.dropLast(2))
}

internal data class ModeloResuelto(val modelo: String, val canonico: Boolean, val ambiguo: Boolean)

/** Resolutor de modelos con alias seguros y dudosos (`crearResolverModeloConfigurado`). */
internal fun crearResolverModeloConfigurado(
    configuracion: ConfiguracionCatalogo,
    modelos: List<String> = emptyList(),
    tolerante: Boolean = true,
): (String) -> ModeloResuelto {
    val canonicos = LinkedHashMap<String, String>()
    modelos.forEach { canonicos[normalizarCatalogo(it)] = it }
    val exactos = HashMap<String, LinkedHashMap<String, String>>()
    val tolerantes = HashMap<String, LinkedHashMap<String, String>>()
    val dudososExactos = HashSet<String>()
    val dudososTolerantes = HashSet<String>()
    fun anotar(indice: HashMap<String, LinkedHashMap<String, String>>, clave: String, modelo: String) {
        if (clave.isEmpty()) return
        indice.getOrPut(clave) { LinkedHashMap() }[normalizarCatalogo(modelo)] = modelo
    }
    for (modelo in modelos) anotar(tolerantes, claveTolerante(modelo), modelo)
    for ((modelo, aliases) in configuracion.aliasModelos)
        for (palabra in listOf(modelo) + aliases) {
            anotar(exactos, normalizarCatalogo(palabra), modelo)
            anotar(tolerantes, claveTolerante(palabra), modelo)
        }
    for ((modelo, aliases) in configuracion.aliasPosiblesModelos)
        for (palabra in aliases) {
            dudososExactos += normalizarCatalogo(palabra)
            dudososTolerantes += claveTolerante(palabra)
            anotar(tolerantes, claveTolerante(palabra), modelo)
        }
    fun resolver(valor: String): ModeloResuelto {
        val clave = normalizarCatalogo(valor)
        canonicos[clave]?.let { return ModeloResuelto(it, canonico = true, ambiguo = false) }
        val exacto = exactos[clave]
        if (exacto != null && exacto.size == 1 && clave !in dudososExactos) return ModeloResuelto(exacto.values.first(), false, false)
        // «marcos» o «molcos» son el plural de un modelo, no otro parecido: el singular se prueba antes.
        if (tolerante)
            for (singular in singularesCatalogo(clave)) {
                canonicos[singular]?.let { return ModeloResuelto(it, false, false) }
                val aliasSingular = exactos[singular]
                if (aliasSingular != null && aliasSingular.size == 1 && singular !in dudososExactos)
                    return ModeloResuelto(aliasSingular.values.first(), false, false)
            }
        val claveTol = claveTolerante(valor)
        val parecidos = tolerantes[claveTol]
        val ambiguo = (exacto?.size ?: 0) > 1 || (parecidos?.size ?: 0) > 1
        val modelo = if (tolerante && !ambiguo && claveTol !in dudososTolerantes && parecidos != null && parecidos.size == 1)
            parecidos.values.first()
        else valor
        return ModeloResuelto(modelo, false, ambiguo)
    }
    return ::resolver
}

internal fun resolverModeloConfigurado(valor: String, configuracion: ConfiguracionCatalogo, modelos: List<String> = emptyList()) =
    crearResolverModeloConfigurado(configuracion, modelos)(valor).modelo

/** Modelo al que podría referirse un alias dudoso; null si el valor no figura entre ellos. */
internal fun resolverModeloPosibleConfigurado(valor: String, configuracion: ConfiguracionCatalogo): String? {
    val clave = normalizarCatalogo(valor)
    val exacta = configuracion.aliasPosiblesModelos.firstOrNull { (_, aliases) -> aliases.any { normalizarCatalogo(it) == clave } }
    return exacta?.first ?: duenoTolerante(valor, configuracion.aliasPosiblesModelos)
}

/** Distancia de Damerau-Levenshtein con transposición adyacente; basta saber si supera 1. */
private fun distanciaDamerau(a: String, b: String): Int {
    if (abs(a.length - b.length) > 1) return 2
    val d = Array(a.length + 1) { i -> IntArray(b.length + 1) { j -> if (i == 0) j else if (j == 0) i else 0 } }
    for (i in 1..a.length)
        for (j in 1..b.length) {
            val costo = if (a[i - 1] == b[j - 1]) 0 else 1
            d[i][j] = min(min(d[i - 1][j] + 1, d[i][j - 1] + 1), d[i - 1][j - 1] + costo)
            if (i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1]) d[i][j] = min(d[i][j], d[i - 2][j - 2] + 1)
        }
    return d[a.length][b.length]
}

/**
 * Modelo al que `valor` se parece a lo más a una letra o una transposición (`modeloParecido`). null si la clave es
 * muy corta o si más de un modelo queda igual de cerca.
 */
internal fun modeloParecido(valor: String, configuracion: ConfiguracionCatalogo, modelos: List<String> = emptyList()): String? {
    val singulares = singularesCatalogo(normalizarCatalogo(valor))
    val conocidos = modelos + configuracion.aliasModelos.flatMap { (m, a) -> listOf(m) + a }
    if (conocidos.any { normalizarCatalogo(it) in singulares }) return null
    val clave = claveTolerante(valor)
    if (clave.length < 5) return null
    val candidatos = LinkedHashMap<String, String>()
    fun probar(palabra: String, modelo: String) {
        val otra = claveTolerante(palabra)
        if (clave != otra && distanciaDamerau(clave, otra) <= 1) candidatos[normalizarCatalogo(modelo)] = modelo
    }
    for (modelo in modelos) probar(modelo, modelo)
    for ((modelo, aliases) in configuracion.aliasModelos) {
        probar(modelo, modelo)
        for (alias in aliases) probar(alias, modelo)
    }
    for ((modelo, _) in configuracion.aliasPosiblesModelos) probar(modelo, modelo)
    return candidatos.values.singleOrNull()
}

/**
 * Lo que el asistente entendería de un texto con la configuración dada (`ProbarReconocimiento` de la web): madera,
 * modelo seguro, modelo posible (pregunta) o parecido.
 */
internal fun probarReconocimiento(texto: String, configuracion: ConfiguracionCatalogo, modelos: List<String>): String {
    val k = normalizarCatalogo(texto)
    if (k.isEmpty()) return "Muestra qué entendería el asistente, incluidos los cambios sin guardar."
    val nombreMadera = resolverMaderaConfigurada(texto, configuracion)
    val madera = nombreMadera?.let { n -> configuracion.maderas.firstOrNull { it.nombre == n } }
    val resuelto = resolverModeloConfigurado(texto, configuracion, modelos)
    val modelo = resuelto.takeIf { normalizarCatalogo(resuelto) != k || modelos.any { normalizarCatalogo(it) == k } }
    val posible = if (modelo == null) resolverModeloPosibleConfigurado(texto, configuracion) else null
    val parecido = if (modelo == null && posible == null) modeloParecido(texto, configuracion, modelos) else null
    if (madera == null && modelo == null && posible == null && parecido == null)
        return "No lo reconoce: lo deja tal como lo escribió el cliente."
    return listOfNotNull(
        madera?.let { "Lo entiende como la madera ${it.nombre} (código ${it.codigo})." },
        modelo?.let { "Lo entiende como el modelo $it." },
        posible?.let { "Podría ser el modelo $it: pregunta antes de usarlo." },
        parecido?.let { "Podría ser el modelo $it (se parece): pregunta antes de usarlo." },
    ).joinToString(" ")
}
