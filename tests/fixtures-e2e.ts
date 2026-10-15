import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

// Fixture común de la E2E: cada prueba falla si una página lanzó una excepción sin capturar (`pageerror`) o escribió
// un error en la consola (React avisa ahí las fallas de hidratación, las claves repetidas y los setState tras
// desmontar). Todos los *.e2e.ts importan `test` y `expect` desde aquí en vez de '@playwright/test'.
export * from '@playwright/test';

/**
 * Errores de consola que no son fallas de la aplicación y se ignoran en toda la suite:
 * - «Failed to load resource: … status of 4xx/5xx»: Chrome anota así cada respuesta con error, incluidas las que las
 *   pruebas provocan a propósito (401 de la sesión vencida, 400 de validación, 409 de conflicto, 404 de un PDF
 *   que falta, 503 sin Chromium). La interfaz las explica con su propio mensaje, que las pruebas revisan.
 * - «net::ERR_ABORTED» / «ERR_CONNECTION_REFUSED»: navegaciones o descargas interrumpidas al cambiar de página o al
 *   cerrar el contexto.
 * - «Fetch API cannot load … due to access control checks.»: así anota WebKit (proyecto «webkit-iphone») una lectura
 *   que la navegación canceló, lo mismo que Chrome llama «net::ERR_ABORTED»; la app ya la descarta (`.catch`), pero
 *   WebKit la informa igual como error de la página. Aparece de vez en cuando, según cuánto tarda la lectura.
 */
const IGNORADOS_SIEMPRE: RegExp[] = [
  /^Failed to load resource: the server responded with a status of [45]\d\d/,
  /net::ERR_ABORTED/,
  /net::ERR_CONNECTION_REFUSED/,
  /due to access control checks\.$/,
];

interface Opciones {
  /** Errores esperados en esta prueba (además de los de siempre), con `test.use({ erroresEsperados: [...] })`. */
  erroresEsperados: RegExp[];
}

/** Junta los errores de todas las páginas del contexto, incluidas las que se abren después (ventanas, pestañas). */
function vigilar(context: BrowserContext, errores: string[]) {
  const enPagina = (page: Page) => {
    page.on('pageerror', (error) => errores.push(`[pageerror] ${page.url()} · ${error.message}`));
    page.on('console', (mensaje) => {
      if (mensaje.type() === 'error') errores.push(`[console] ${page.url()} · ${mensaje.text()}`);
    });
  };
  context.pages().forEach(enPagina);
  context.on('page', enPagina);
}

export const test = base.extend<Opciones & { _sinErroresDeConsola: void }>({
  erroresEsperados: [[], { option: true }],
  _sinErroresDeConsola: [
    async ({ context, erroresEsperados }, use, testInfo) => {
      const errores: string[] = [];
      vigilar(context, errores);
      await use();
      // Si la prueba ya falló, su error es el que importa; los de consola quedan adjuntos para el diagnóstico.
      const ignorados = [...IGNORADOS_SIEMPRE, ...erroresEsperados];
      const reales = errores.filter((e) => !ignorados.some((r) => r.test(e.replace(/^\[\w+\] \S+ · /, ''))));
      if (reales.length) await testInfo.attach('errores-de-consola', { body: reales.join('\n'), contentType: 'text/plain' });
      if (testInfo.status === testInfo.expectedStatus)
        expect(reales, 'La página no debe lanzar excepciones ni escribir errores en la consola').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
