package cl.puertasneltume.cotizador

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.printToString
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import cl.puertasneltume.cotizador.sesion.GestorDeClaves
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * El guion de cinco minutos del README contra el servidor de pruebas (IA y Starken simulados, sin costo):
 * android/scripts/e2e.sh siembra los datos, arranca el servidor, hace `adb reverse` y corre esta prueba.
 * Ingresar → pedir por chat → indicar hoja → emitir → aprobar → anticipo → nota de pedido de Panguipulli.
 */
@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class GuionCincoMinutosTest {
    @get:Rule val compose = createEmptyComposeRule()

    @Before fun preparar() {
        GestorDeClaves.activo = false
        ActivityScenario.launch(MainActivity::class.java)
    }

    /** Espera un texto; si no llega, la falla incluye lo que había en pantalla. */
    private fun esperar(texto: String, ms: Long = 30_000) {
        try {
            compose.waitUntilAtLeastOneExists(hasText(texto, substring = true), ms)
        } catch (e: Throwable) {
            val pantalla = runCatching { compose.onAllNodes(isRoot()).onFirst().printToString(maxDepth = 40) }.getOrDefault("")
            throw AssertionError("No apareció «$texto». En pantalla:\n$pantalla", e)
        }
    }
    /** Los avisos («PDF listo · Ver PDF») flotan sobre el contenido: se espera que se cierren antes de tocar debajo. */
    private fun sinAvisos() = compose.waitUntil(20_000) { compose.onAllNodesWithText("Ver PDF").fetchSemanticsNodes().isEmpty() }

    private fun tocar(texto: String) = compose.onAllNodes(hasText(texto) and hasClickAction()).onFirst().performClick()

    @Test fun cotizarEmitirAprobarYGenerarNota() {
        // Ingresar (si la sesión de una corrida anterior sigue viva, ya se está adentro).
        compose.waitUntil(30_000) {
            compose.onAllNodesWithText("Ingresar").fetchSemanticsNodes().isNotEmpty() ||
                compose.onAllNodesWithText("Cuéntame el pedido").fetchSemanticsNodes().isNotEmpty()
        }
        if (compose.onAllNodesWithText("Ingresar").fetchSemanticsNodes().isNotEmpty()) {
            compose.onNodeWithText("Correo electrónico").performTextInput("admin@neltume.test")
            compose.onNodeWithText("Contraseña").performTextInput("clave-e2e-segura-2026")
            // Con el teclado abierto, «Listo» en la contraseña ingresa (como lo haría una persona).
            compose.onNodeWithText("Contraseña").performImeAction()
        }
        esperar("Cuéntame el pedido")

        // Pedido por chat con el asistente simulado.
        tocar("“3 Huilo Huilo en oregón de 80 × 2,10 para Juan Pérez, Temuco”")
        compose.onNode(hasContentDescription("Enviar mensaje")).performClick()
        esperar("Agregué", 60_000)

        // Cotización: hoja, emitir.
        tocar("Cotización")
        esperar("Productos")
        tocar("Hoja")
        esperar("Emitir y generar PDF")
        tocar("Emitir y generar PDF")
        esperar("Elegir el número a mano")
        tocar("Emitir")
        esperar("Esperando la aprobación del cliente", 60_000)

        // Aprobar.
        tocar("Registrar aprobación")
        esperar("Documento para el cliente (opcional)")
        tocar("Aprobar")
        esperar("Seguimiento del pedido", 30_000)

        // Anticipo: el saldo completo, y luego las notas de pedido.
        sinAvisos()
        compose.onNodeWithText("Saldo completo").performScrollTo().performClick()
        esperar("Registrar pago", 10_000)
        compose.onNodeWithText("Registrar pago").performScrollTo().performClick()
        esperar("Pago de $", 30_000)
        compose.waitUntil(20_000) { compose.onAllNodesWithText("Pago de $", substring = true).fetchSemanticsNodes().isEmpty() }
        // «Generar nota de pedido» o «Generar notas de pedido», según cuántas fábricas haya.
        compose.onAllNodes(hasText("Generar nota", substring = true) and hasClickAction()).onFirst().performScrollTo().performClick()
        esperar("Todo a Panguipulli")
        tocar("Todo a Panguipulli")
        tocar("Generar")
        esperar("Fábrica Panguipulli", 60_000)
    }
}
