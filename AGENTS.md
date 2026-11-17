<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## App de Android (`android/`)

La app nativa (Kotlin + Jetpack Compose) usa este mismo servidor por su API. Su núcleo (`android/nucleo`) repite algunas reglas de presentación de la web y arma los cuerpos de `POST /api/accion`; tres pruebas lo mantienen a la par:

- `tests/vectores-movil.test.ts` y `tests/esquema-movil.test.ts` fallan si cambia una regla de `src/app/formato.ts`, `src/negocio/*` usada por la app o el esquema de `src/servidor/esquema-accion.ts`. Regenera con `ACTUALIZAR_VECTORES=1 npx vitest run tests/vectores-movil.test.ts tests/esquema-movil.test.ts` y corre `./gradlew :nucleo:test` en `android/` para portar el cambio.
- Si cambia la forma de una respuesta que lee la app, regenera las respuestas reales con el servidor de pruebas (`npm run movil:servidor`, luego `npm run movil:contrato`) y corre `./gradlew :nucleo:test`.
- Los textos de la app (literales en `android/app/src/main/kotlin`) pasan por la misma lista de `tests/textos-interfaz.test.ts`.
