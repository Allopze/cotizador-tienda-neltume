# 03 · Matriz de QA

**Entorno de las pruebas:**

- bases SQLite aisladas, sembradas con `tests/preparar-e2e.ts` o creadas en el scratchpad con el catálogo de `COTIZADOR_2026.xlsx`, que solo se leyó;
- `next dev` en puertos propios (3123, 3141 y 3142);
- IA en `NELTUME_LLM=fijo`, sin costo; Starken en modo `fijo`; integración con la fábrica apagada;
- nunca se usaron `data/cotizador.sqlite` ni datos reales.

Las rutas `qa/`, `ia/`, `cotizaciones/` y `catalogo/` remiten a los scripts y a la evidencia de la sesión de auditoría. Su descripción completa está en los anexos.

**Leyenda de resultados:**

- **Aprobado:** ejecutado y correcto.
- **Fallido:** ejecutado y con defecto.
- **Simulado:** el servidor real ejecutó una respuesta de modelo simulada; no se probó el modelo real.
- **Bloqueado:** no se pudo ejecutar por el entorno.
- **No ejecutado:** solo se revisó el código o quedó fuera de alcance.

---

## 1. Resultados de la suite existente

| Suite | Comando | Resultado | Duración | Evidencia |
|---|---|---|---|---|
| Unitarias | `npx vitest run` | **1.567 aprobadas, 0 fallidas, 0 omitidas** (97 archivos) | 160,6 s | `qa/vitest.log` |
| E2E paralela | `npm run test:e2e:paralelo` | **Bloqueada:** `EADDRINUSE 3201–3203`, puertos ocupados por la E2E de la app de la fábrica (N-31) | 7 s | `qa/e2e-paralelo.log` |
| E2E en serie | `npm run test:e2e` (puerto 3141) | **89 aprobadas, 1 fallida, 15 no ejecutadas** (dependían de la fallida) | 7,0 min | `qa/e2e-serial.log` |
| Repetición de la fallida | `accesibilidad.e2e.ts:58` sola, 3 veces con servidor en frío | **3/3 aprobadas:** depende de la carga (plazo de 5 s del login con `next dev` en frío), no es un defecto de la app | 46 s × 3 | `qa/a11y-bucle.txt` |
| Proyectos dependientes | `playwright.aceptacion.config.ts` | **14 aprobadas, 1 omitida a propósito** (`movil.e2e.ts:81`, solo Chromium) | 46 s | `qa/acep.log` |
| **Total E2E** | | **103 aprobadas · 1 fallida (0/3 al repetirla sola) · 1 omitida** | | |
| Unitarias relacionadas con cotizaciones | 8 archivos | 151/151 aprobadas | | anexo Cotizaciones |
| Tipos | `npx tsc --noEmit` | 0 errores | | `arquitectura/tsc.txt` |
| Lint | `npx eslint .` | 0 errores, 2 avisos | | `arquitectura/eslint.txt` |
| Dependencias | `npm audit --omit=dev` | 6 avisos: 1 crítico y 2 altos en better-auth y zod (N-36) | | `arquitectura/audit.txt` |
| Evaluación de la IA | `npm run evaluar:regresion` | **No ejecutada:** tiene costo y requiere aprobación previa | | — |
| Firefox | proyecto opcional | **No ejecutado:** Firefox 155 de Playwright no arranca en macOS 27 (documentado en `playwright.config.ts`) | | — |

---

## 2. Matriz de escenarios

### 2.1 Catálogo y familias

| # | Escenario | Prueba existente | Resultado real | Evidencia / hallazgo |
|---|---|---|---|---|
| CAT-1 | Crear un producto (fila) a mano | `alta-manual.e2e.ts`, `alta-catalogo.test.ts` | **Aprobado con defecto**: se crea y se cotiza, pero la vista previa promete $237.488 y la cotización cobra $351.482 | `qa/capturas/d-4…d-13`; N-02 |
| CAT-2 | Vista previa del alta = precio cotizado, en las 11 categorías | Ninguna | **Fallido** en casi todas las categorías (de −17 % a +60 %) | `catalogo/salida-pruebas.txt`; N-02 |
| CAT-3 | Crear un modelo completo (4 maderas × tramos × altos) | Ninguna | **Fallido (no existe la función)**: una fila por formulario (252 para un Ranco) y el formulario se vacía | N-06 |
| CAT-4 | Crear o editar una familia | — | **No aplica**: la familia es un enum fijo (`tipos.ts:6`), no se crea | 05 §1 |
| CAT-5 | «Familia de cada modelo» cambia la familia | `catalogo-secciones.e2e.ts` (solo guarda la configuración) | **Fallido**: sin efecto hasta la próxima importación | N-20 |
| CAT-6 | Herencia de características | — | **No aplica**: no hay herencia; alias y márgenes se aplican por nombre o texto | 05 §1 |
| CAT-7 | Duplicar un producto o un modelo | Ninguna | **Fallido (no existe)** | N-06 |
| CAT-8 | Editar una fila cambia la familia del modelo | Ninguna | **No ejecutado**; leído: no se valida | N-32 |
| CAT-9 | Cambiar el código de madera O→PO | Ninguna | **Fallido**: 2.193 códigos nuevos en la siguiente importación | `catalogo/prueba-importar.ts`; N-21 |
| CAT-10 | El tipo «PUERTA PREPINTADA» cambia el margen | Ninguna | **Fallido**: oregón pasa del 85 % al 140 % | `catalogo/prueba-margen-texto.ts`; N-09 |
| CAT-11 | Alta repetida | `alta-catalogo.test.ts` | **Aprobado**: «Ya existe un producto con esos atributos» | `qa/capturas/d-11` |
| CAT-12 | Importar una planilla conserva los productos manuales | `importar-*.test.ts` | Aprobado (suite) | — |

### 2.2 Búsqueda y selección

| # | Consulta | Prueba existente | Resultado real (Consultar / Agregar) | Lo que entiende el chat |
|---|---|---|---|---|
| BUS-1 | `ranco` | `busqueda-catalogo.test.ts` | 252 resultados; el diálogo muestra 24 y empieza por Lenga | OK |
| BUS-2 | `ranko` | Ninguna | **0** | sugiere RANCO |
| BUS-3 | `willow`, `coscos`, `pangipulli` | Ninguna | **0** | alias OK |
| BUS-4 | `pino oregón 1 metro`, `puerta de 100` | Ninguna | **0** | — |
| BUS-5 | `ranco 1,00 2,20` | Ninguna | **Fallido**: primero RAN-L-1-C (0,60–0,65 m) | — |
| BUS-6 | `ranco oregon 0,82 2,2` (dentro del tramo) | Ninguna | **0** | tramo 0,80–0,85 |
| BUS-7 | `ranco 85x210`, `85cm`, `marco 4x2` | Ninguna | **0** | 4x2 OK |
| BUS-8 | `puertas`, `moldura`, `prepintado` | Ninguna | **0** | — |
| BUS-9 | `oregon` sin tilde, `rauli` | `busqueda-catalogo.test.ts` | Aprobado (2.193) | OK |

Evidencia: `catalogo/salida-pruebas.txt`, `qa/busquedas.txt`, `qa/capturas/e-*`; hallazgo N-07.

### 2.3 Cotizaciones (editor manual)

| # | Escenario | Prueba existente | Resultado real | Evidencia / hallazgo |
|---|---|---|---|---|
| COT-1 | 4 líneas Ranco 0,85/1,00/0,85/1,00 × 2,20 a mano | Ninguna con líneas repetidas | **Aprobado**: 4 líneas independientes que persisten | `qa/capturas/a-*`; Cot A1–A4 |
| COT-2 | Editar una línea no afecta a su gemela | Ninguna | **Aprobado** | Cot A2–A3 |
| COT-3 | Duplicar una línea y modificar la copia | No existe la función | **Fallido (no existe)**; la alternativa (agregar de nuevo) deja el original intacto | `qa/capturas/b-*`; N-05 |
| COT-4 | Copia renombrada a «Ranco vidriada» conserva el precio | Ninguna | **Fallido**: el precio se descarta y la línea queda pendiente | Cot B1; N-19 |
| COT-5 | Producto personalizado de 45 o 50 mm sin tocar el catálogo | `pedido-especial.e2e.ts` | **Aprobado** | `qa/capturas/c-*`; Cot C2 |
| COT-6 | Ítem libre «Instalación» | `item-libre.e2e.ts` | **Aprobado** | Cot C1 |
| COT-7 | Ancho entre tramos (0,87) → tramo siguiente con aviso | `medidas-*.test.ts` | Aprobado | Cot C3 |
| COT-8 | Medida sobre la máxima (1,60) → pendiente | `medidas-especiales.test.ts` | Aprobado | Cot C4 |
| COT-9 | Totales con descuento por ítem, general, tramo, flete e IVA | `montos.test.ts`, `flujo.e2e.ts` | **Aprobado**: pantalla = recarga = PDF ($1.076.523) | `qa/capturas/f-*`; Cot D1–D9 |
| COT-10 | Guardar y recargar (F5) | `descuento-item.e2e.ts:56` (documenta que vuelve al inicio) | **Aprobado con observación**: F5 muestra un cotizador vacío; la cotización está en el Historial | QA H-08 |
| COT-11 | Reordenar | `cotizador-ui.e2e.ts` | Aprobado | Cot E4 |
| COT-12 | Eliminar una emitida | — | Aprobado (se rechaza) | Cot K2 |
| COT-13 | Recotización al quitar, agregar, reordenar o deshacer con el catálogo cambiado | Ninguna | **Fallido** en las 4 acciones (sin aviso) | Cot R-*; N-12 |
| COT-14 | «Corregir pedido» en una aprobada con el catálogo cambiado | `pedido-corregido.e2e.ts` (sin cambio de catálogo) | **Fallido**: el total cambia de $2.800.288 a $2.593.493 | Cot I1; N-01 |
| COT-15 | Revisión de una emitida conserva los precios | — | **Aprobado con observación**: vuelve a precios del catálogo (decisión M3) | Cot G2; N-28 |
| COT-16 | Una emitida no cambia al cambiar el catálogo | `persistencia-*.test.ts` | Aprobado | Cot G1 |
| COT-17 | Deshacer descuento general, flete o cliente | — | **Fallido (no cubierto)** | N-16 |

### 2.4 PDF y documentos

| # | Escenario | Prueba existente | Resultado real | Evidencia |
|---|---|---|---|---|
| PDF-1 | El PDF reproduce los montos guardados | `pdf-*.test.ts`, `flujo.e2e.ts` | Aprobado | Cot F1; `qa/capturas/f-…323.pdf` |
| PDF-2 | Dos especiales «Ranco vidriada» de 0,85 y 1,00 se distinguen | `pdf.test.ts:317-335` **fija lo contrario** | **Fallido** | Cot J1–J2; N-13 |
| PDF-3 | «No incluye: instalación… vidrios» cuando sí se incluyen | Ninguna | **Fallido** (leído y generado) | N-26 |
| PDF-4 | Notas de pedido por fábrica (577 / 59), «Por definir» | `notas-por-fabrica.test.ts` | Aprobado | Cot H1 |

### 2.5 Asistente de IA (servidor real, respuestas de modelo simuladas)

| # | Mensaje | Resultado | Capa del defecto |
|---|---|---|---|
| IA-1 | «4 Ranco pino oregón 0,85; 1,00; 0,85; 1,00» | **Fallido** (simulado): quedan 2 | Ejecución (N-03) |
| IA-2 | «Agrega otra puerta igual a la primera» | **Fallido** (simulado): se descarta, o la cantidad queda pendiente | Ejecución (N-03, IA H6) |
| IA-3 | «Quiero la puerta 4 igual a la puerta 2» | **Aprobado** (simulado) | — |
| IA-3b | «…la puerta 4 igual a la Molco» | **Fallido** (simulado): «No entendí» | Ejecución (N-24) |
| IA-4 | «Duplica esta Ranco y haz que la copia sea vidriada» | **Fallido** (simulado): descartada | Ejecución (N-03, N-05) |
| IA-5 | «Necesito cotizar una puerta con otro espesor» | **Aprobado** (simulado) si la respuesta no lleva cifras | Ejecución (N-04) |
| IA-6 | «Agrega tres puertas iguales, pero separadas» | **Fallido** (simulado): 1 de 3 | Ejecución (N-03) |
| IA-7 | «Cambia solamente la medida de la segunda puerta» | **Aprobado** con la medida dicha; **Fallido** si el modelo pregunta «¿0,80 × 2,00?» (texto reemplazado) | Ejecución (N-04) |
| IA-8 | «Busca una puerta de pino oregón de un metro de ancho» | **Fallido** (simulado): no hay herramienta de búsqueda, y la respuesta con cifras se bloquea | Ejecución y diseño (N-04, N-25) |
| IA-9 | «Agrega un producto que no existe en el catálogo» | **Aprobado** (simulado) | — |
| IA-10 | «Necesito crear una nueva familia» | **Aprobado** (simulado): «no se puede»; es correcto porque es un enum | — |
| IA-11 | «¿En qué familia debo poner esta puerta?» | **Aprobado** (simulado) si no lleva cifras | Ejecución (N-04) |
| IA-12 | Respuesta con `fabrica: null` o `flete: null` de relleno | **Fallido** (simulado): «No quité la fábrica…» una vez por ítem | Ejecución (N-10) |
| IA-13 | Reenvío de la IA de un ítem anterior (control de BUG-008) | **Aprobado** (simulado) | — |
| IA-14 | Reenvío con tilde o en cm | **Fallido** (simulado): duplica en silencio | Ejecución (N-23) |
| IA-15 | Turno con una parte válida y otra con el índice errado | **Fallido** (simulado): se pierde todo y el mensaje es engañoso | Ejecución (N-22) |
| IA-16 | Interpretación real del modelo en todos los casos anteriores | **No ejecutado** (costo) | — |

Evidencia: `ia/escenarios.test.ts`, `ia/extra.test.ts`, `ia/resultados*.json` (36 escenarios).

### 2.6 Robustez, accesibilidad y dispositivos

| # | Escenario | Prueba existente | Resultado real | Evidencia |
|---|---|---|---|---|
| ROB-1 | Red cortada al editar la cantidad | Ninguna con `abort` | **Aprobado**: avisa, conserva «3» y el total no cambia | `qa/capturas/h-red-cortada-cantidad.png` |
| ROB-2 | Red cortada al agregar | Ninguna | **Aprobado con observación**: el aviso sale dos veces | QA H-10 |
| ROB-3 | Red cortada al emitir | Ninguna | **Aprobado**: no consume un número | `h-emitir-sin-red.png` |
| ROB-4 | Doble clic en agregar o confirmar la emisión | `toque-doble.e2e.ts` | **Aprobado**: 1 línea, 1 emisión (N° 324) | `h-doble-confirmar.png` |
| ROB-5 | Doble clic en «Emitir y generar PDF» | — | **Aprobado con observación**: el diálogo se abre y se cierra | QA H-09 |
| ROB-6 | Doble envío del primer producto | Ninguna | **Fallido**: 2 borradores | Cot E3; N-27 |
| ROB-7 | Dos pestañas, versión vieja → 409 | `sesion.e2e.ts`, `carga-concurrencia.test.ts` | Aprobado (servidor) | Cot E1 |
| ROB-8 | Reacción de la pantalla a un 409 (¿se pierde lo escrito?) | `gestion.e2e.ts` (parcial) | **No ejecutado** | — |
| A11Y-1 | axe en 7 pantallas × 1440/768/390 | `accesibilidad.e2e.ts` | **Aprobado**: 0 violaciones en 21 combinaciones | `qa/a11y-*.log` |
| A11Y-2 | Agregar un producto solo con teclado | `cotizador-ui.e2e.ts` (parcial) | **Aprobado** (11 Tab, Enter, Enter) | `[g-teclado]` |
| A11Y-3 | Foco tras elegir hoja o vano | Ninguna | **Fallido**: el foco va al body | N-30 |
| A11Y-4 | Escape en el buscador del diálogo | Ninguna | **Fallido** (menor): el primer Escape solo borra el texto | QA H-06 |
| A11Y-5 | Contraste de los bordes de los campos | Ninguna | **Fallido** (calculado): 1,5:1 | N-44 |
| RES-1 | Sin desborde horizontal a 390 y 768 px | `movil.e2e.ts` | Aprobado | `qa/capturas/g-*-390.png` |
| RES-2 | El aviso «Producto agregado» no tapa la tabla | Ninguna | **Fallido**: 440 × 676 px | N-29 |
| RES-3 | iPhone 13 (WebKit) | `movil.e2e.ts` | Aprobado (8 pruebas) | `qa/acep.log` |
| SUB-1 | Subida real de fotos y su copia al duplicar | `referencias-cliente.e2e.ts` | **No ejecutado** en esta auditoría; leído: `structuredClone` y archivos inmutables por sha256 | — |
| SEG-1 | Todas las rutas API exigen sesión | Ninguna global | **No ejecutado** por HTTP; leído: las 25 rutas lo verifican | Arq M-05 |

---

## 3. Pruebas faltantes y automatización recomendada

Por orden de valor. Las specs de la auditoría (`qa/specs/*.spec.ts`, `ia/*.test.ts`, `cotizaciones/*.ts`) sirven de punto de partida y deben pasarse a `tests/` cuando se implemente cada arreglo.

| # | Prueba nueva | Tipo | Cubre | Base |
|---|---|---|---|---|
| T-1 | Corregir pedido con el catálogo ±10 %: total, notas y PDF idénticos | Unitaria + E2E | N-01 | `cotizaciones/` I1 |
| T-2 | Vista previa del alta = línea cotizada, por cada una de las 11 categorías | Unitaria + E2E | N-02 | `qa/specs/03-alta`, `06-precio` |
| T-3 | Chat: 4 líneas repetidas, «otra igual», «tres separadas», «duplica y vidriada» | Unitaria (simulada) + casos en `evals/cotizacion.json` | N-03, N-05 | `ia/escenarios.test.ts` A1, E1, E3, E5 |
| T-4 | Chat: reenvío con frase antigua, con tilde o en cm, que no duplica | Unitaria (simulada) | N-23 | `ia/escenarios.test.ts` A3, A4 |
| T-5 | Chat: una respuesta con medidas o cantidades llega tal cual, y un monto inventado se bloquea | Unitaria | N-04 | `ia/extra.test.ts` |
| T-6 | Chat: sin avisos «No quité…» ante `null` de relleno | Unitaria | N-10 | `ia/escenarios.test.ts` D1 |
| T-7 | Duplicar línea: copia completa, original intacto, persistencia, idempotencia | Unitaria + E2E | N-05 | `qa/specs/01-lineas` b |
| T-8 | E2E con líneas repetidas a mano (4 líneas, 2 pares iguales) | E2E | Regresión de A | `qa/specs/01-lineas` a |
| T-9 | Recotización en quitar, agregar, reordenar y deshacer | Unitaria | N-12 | `cotizaciones/` R-* |
| T-10 | PDF con medida en especiales | Unitaria (reemplaza `pdf.test.ts:317-335`) | N-13 | `cotizaciones/` J1–J2 |
| T-11 | La tabla de búsqueda de 05 §10 como prueba de aceptación | Unitaria + E2E del diálogo | N-07 | `catalogo/prueba-busqueda.ts` |
| T-12 | Red cortada con `page.route(...).abort()` al editar, agregar y emitir | E2E | Robustez | `qa/specs/02-cotizar` h |
| T-13 | Geometría del aviso (alto < 120 px, «Quitar ítem» clicable) | E2E | N-29 | `qa/specs/04-pantallas` |
| T-14 | Teclado completo: confirmar hoja o vano en 2 líneas sin perder el foco | E2E | N-30 | `qa/specs/04-pantallas` g2 |
| T-15 | Autorización de las 25 rutas sin sesión → 401 | Unitaria o HTTP | Arq M-05 | — |
| T-16 | Migración del catálogo: los 8.866 productos con precio, código, familia y descripción idénticos | Unitaria (antes y después) | Etapa 4 de 05 | — |
| T-17 | Rol vendedora: ningún camino de un clic crea filas globales (si se crea el rol) | E2E | N-08, N-17 | — |

**Infraestructura de pruebas:**

- Puerto base configurable en `e2e-paralelo.mjs` (N-31).
- Plazo del login E2E de 30 s, o calentar `/` antes de las pruebas (QA H-12).
- Una falla aislada de `flujos` no debería dejar sin correr `aceptacion`: una segunda pasada con `--no-deps`, o reportar «no ejecutadas» en el resumen.
- La E2E siembra una cuenta `user` que producción nunca tiene (§5.2 de 01). Decidir si las pruebas deben reflejar la configuración real.

## 4. Riesgos de QA

| Riesgo | Impacto | Mitigación |
|---|---|---|
| La interpretación del modelo real no se probó | Los escenarios IA marcados «Aprobado» solo valen para la capa del servidor | Correr `evaluar:regresion` con los casos nuevos, con el costo aprobado |
| La suite paralela es la compuerta del deploy y falla por puertos | Falsos rojos o deploys bloqueados | T-infra |
| Pruebas que fijan comportamientos que hay que cambiar (`pdf.test.ts:317-335`; `descuento-item.e2e.ts:56`) | Una corrección se puede «arreglar» rompiendo la intención | Decidir y actualizar en el mismo PR |
| `pedido-corregido.e2e.ts` no cambia el catálogo entre la aprobación y la corrección | N-01 pasó desapercibido | T-1 |
| Sin pruebas de usabilidad con usuarias | Las hipótesis UX (N-14, N-15) no están validadas | Sesiones de 04 §7 |
