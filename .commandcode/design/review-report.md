# Revisión de diseño — Neltume · Cotizador

**Modo:** `/design review`
**Fecha:** 30 de septiembre de 2026
**Commit revisado:** `c09dd28` (worktree sucio: Ajustes, catálogo y configuración de negocio sin commitear)
**Alcance:** ingreso, Cotizar (llegada y primer mensaje), Historial, Catálogo (Consultar, Agregar, Gestionar, Configuración) y Ajustes (contraseña, asistente, empresa, feriados, usuarios). Escritorio 1280 px, teléfono 390 px y 320 px.

> Esta revisión no modifica la interfaz. Son hallazgos para que los apliquen `/design responsive` y `/design interaction`.

---

## Veredicto

**Block** al momento de la revisión. **Superado el mismo día:** los tres `HIGH` se arreglaron y los `MEDIUM`/`LOW` también, salvo los dos que no se reprodujeron al medirlos. Estado en [Arreglos aplicados](#arreglos-aplicados).

Los tres `HIGH` eran nuevos respecto de la revisión del 29 de septiembre: en Ajustes la página entera se desplazaba en horizontal, en el catálogo de teléfono dos secciones de administración quedaban fuera de la vista sin rastro, y el selector de logo no tenía nombre accesible. Lo que la revisión anterior marcó como resuelto se sostiene: la máscara de la cabecera y de los filtros ya estaba, el orden de búsqueda por código exacto ya estaba, y el contraste, los nombres y el foco siguen limpios.

---

## TL;DR

La voz se mantiene: papel cálido, tinta verde, serif para los títulos, una sola acción oscura por bloque. El ingreso, la consulta del catálogo y el historial se leen de un vistazo y no huelen a generados.

Lo que se rompió está en las superficies nuevas. El formulario de feriados declara tres columnas con mínimos de 150 y 200 px que no caben bajo 800 px, así que Ajustes mide 501 px de ancho en un teléfono de 390 y de 320. Y la fila de secciones del catálogo, que ahora tiene cuatro destinos, esconde «Gestionar catálogo» y «Configuración» completos a 320 px, con la barra de desplazamiento apagada y sin la máscara que ya usan las otras dos filas.

**Siguiente movimiento:** `/design responsive` para las dos filas que no se parten ni avisan, y `/design interaction` para el selector de logo, que es un control nativo suelto en medio de un formulario con etiqueta.

---

## Puntajes por lente

| # | Lente | Puntaje | Hallazgo clave |
|---|---|---|---|
| 1 | Primera impresión | 7 / 10 | El ingreso y la llegada del cotizador tienen punto de vista propio; Ajustes en teléfono lo pierde al desbordar la ventana |
| 2 | Jerarquía | 7 / 10 | Una acción oscura por sección y títulos serif claros; en el catálogo de teléfono la jerarquía falla porque dos secciones no se ven |
| 3 | Voz de color | 8 / 10 | Paleta comprometida, neutros teñidos, estados con texto además de color. Contraste medido: 0 fallos en las nueve pantallas |
| 4 | Voz tipográfica | 8 / 10 | Georgia contra Arial, microetiquetas en mayúsculas con tracking, escalones distinguibles. Sin cambios respecto de ayer |
| 5 | Sensación de interacción | 5 / 10 | Diálogos y confirmaciones siguen bien; pierden el desborde de Ajustes, las secciones invisibles y el file input sin nombre |
| | **Total** | **35 / 50** | |

La bajada respecto de 36/50 no es de voz. Es de la capa angosta de las pantallas que se agregaron después de la revisión anterior.

---

## Disparadores de escalamiento

De la lista de escalamiento, presentes:

- **Algo cortado o enterrado al angostar a 320 px** — la página de Ajustes desborda 181 px, y «Gestionar catálogo» más «Configuración» quedan enteras fuera del contenedor. Hallazgos 1 y 2; van primero.
- **Algo operable que no dice qué es** — el `<input type="file">` del logo no tiene etiqueta asociada ni `aria-label`. Hallazgo 3.

Revisados y **ausentes**: nada enfocable sin indicador visible en el ingreso (3 paradas, las tres con anillo), ningún campo de texto cuyo marcador haga de etiqueta, ningún texto bajo su contraste, ninguna distinción solo por color en los estados medidos, ninguna acción irreversible sin `window.confirm` en feriados y en eliminar producto.

---

## Hallazgos

| # | Severidad | Disciplina | Ubicación | Antes | Después | Por qué |
|---|---|---|---|---|---|---|
| 1 | HIGH | Layout | `src/app/chat.css:448-453` y `src/app/responsive.css:509-511` | `.feriado-form` es `grid-template-columns: minmax(150px, 0.5fr) minmax(200px, 1fr) auto`. El bloque de 800 px lo pasa a `1fr`, pero `minmax()` no cede ante `1fr`: la fila mide 501 px. A 390 px el botón «Agregar feriado» termina en x=501; a 320 px la página desborda 181 px y aparecen barra de desplazamiento horizontal | Cambiar los mínimos a `minmax(0, …)` o partir el formulario en una columna bajo 800 px con `grid-template-columns: 1fr` real, y dejar el botón en su propia fila | Es la única pantalla que mueve la ventana entera. El mismo patrón está a un paso en `.logo-configuracion-acciones`, que a 320 px termina en x=347 |
| 2 | HIGH | Responsive | `src/app/catalogo/secciones.ts:2-7` con `src/app/responsive.css:155-163` | `.secciones-nav` se desplaza con `scrollbar-width: none` y sin máscara. A 320 px «Gestionar catálogo» empieza en x=247 y termina en 384, y «Configuración» va de 388 a 494: las dos quedan enteras fuera, sin degradado que avise | Aplicar a `.secciones-nav` la misma `mask-image` que ya tienen `.header-nav` y `.history-filters`, o partir las cuatro secciones en dos filas bajo 800 px | Quien administra el catálogo desde el teléfono no tiene señal de que existen dos secciones. Se alcanzan deslizando, así que el arreglo es una pista, no una navegación nueva |
| 3 | HIGH | Accessibility | `src/app/ajustes/configuracion-negocio.tsx:132-133` | `<input type="file" accept="image/svg+xml,.svg">` sin `id`, sin `<label for>` y sin `aria-label`. El texto «Logo para la aplicación…» es un `<span class="ia-field-label">`, no una etiqueta. Medido: `labels: 0` | Envolverlo en un `<label>` («Seleccionar logo») o darle `aria-label`, y ocultar el control nativo detrás de un botón con el mismo estilo que el resto del formulario | Es el único control de las pantallas recorridas sin nombre accesible. Además se ve como el selector crudo del sistema, al lado de botones que sí tienen voz |
| 4 | MEDIUM | Surface | `src/app/gestion-manuales.tsx:31-45` y `src/servidor/repositorio-catalogo.ts:416-453` | Al entrar a «Gestionar catálogo» sin búsqueda se piden y se pintan 300 filas (el tope), de 8773 productos, cada una con «Editar» y, si es manual, «Eliminar». No hay texto de «mostrando 300 de N» como sí lo tiene Consultar | Exigir un término antes de listar, o paginar, y mostrar el total real. El filtro ya existe en el servidor (`listarAdministrables(q, limite)`) | Abrir la sección para corregir un código obliga a recibir y recorrer trescientas filas de la planilla. Es la pantalla más pesada del producto y no lo dice |
| 5 | MEDIUM | Interaction | `src/app/ajustes/usuarios.tsx:74-77` y `src/app/cotizacion.css:445-450` | En angosto, `td.celda-acciones` pasa a `position: absolute; top: 8px; right: 0`. La fila de usuarios trae tres botones («Editar», «Restablecer clave», «Desactivar») pensados para una celda de tabla, no para una esquina de 90 px | En la tarjeta móvil, apilar las acciones bajo la cuenta en vez de absolverlas a la esquina, igual que ya hace el historial con «Duplicar» | La regla se escribió para el botón único de quitar un ítem. Reutilizada en usuarios, las tres acciones compiten por el mismo punto |
| 6 | LOW | Layout | `src/app/globals.css:570-578` | `.avisos` sigue fijo en `right: 20px; bottom: 20px` durante 9 s. En Ajustes tapa el pie; en una cotización abierta tapa el bloque de totales | Anclar la zona de avisos por encima del pie de la cotización, o a la cabecera de la sección que originó el aviso | Ya estaba en la revisión anterior y no se movió. Sigue siendo el aviso de éxito el que esconde la cifra de la que habla |
| 7 | LOW | Writing | `src/app/configuracion-catalogo.tsx:62-64` | La configuración de maderas, familias y alias se edita como un `<textarea>` de JSON crudo, con el rótulo «Configuración del catálogo (JSON)» | Editar cada lista (maderas, familias, alias) como filas con sus campos, y reservar el JSON para exportar | Quien administra el catálogo no debería necesitar saber que es JSON para cambiar un alias. Un error de coma se confirma solo al guardar |

---

## Arreglos aplicados

Se aplicaron en la misma jornada sobre el árbol de trabajo y se volvieron a medir en la misma instancia aislada.

| # | Hallazgo | Estado | Qué cambió |
|---|---|---|---|
| 1 | Ajustes desbordaba el teléfono | **Arreglado** | La causa era de media query: las reglas de una sola columna vivían dentro de `@media (min-width: 801px) and (min-height: 680px)`, así que el teléfono conservaba las tres columnas con mínimos de 150 y 200 px. Se movieron a `max-width: 800px` (`responsive.css`), los mínimos pasaron a 0 (`chat.css:451`) y `.manual-editor` suelta su `min-width: 380px` en la tarjeta. Medido: 0 px de desborde a 390 y a 320 (antes 111 y 181) |
| 2 | Dos secciones del catálogo desaparecían | **Arreglado** | `.secciones-nav` recibe la misma `mask-image` que ya usaban la cabecera y los filtros (`globals.css:316`). Medido a 390 y 320: la máscara está aplicada y el borde se desvanece sobre «Gestionar catálogo» |
| 3 | El selector de logo no tenía nombre | **Arreglado** | Pasa a ser una etiqueta «Seleccionar logo» con el control dentro y el aspecto de los demás botones; el anillo de foco se dibuja sobre la etiqueta con `:has(input:focus-visible)` (`configuracion-negocio.tsx:134`, `chat.css:452`). Medido: nombre accesible presente y anillo `2px rgb(170, 113, 77)` visible con foco de teclado |
| 4 | Gestionar catálogo volcaba 300 filas | **Arreglado** | Sin término no lista y explica qué escribir; con término muestra el total real (`gestion-manuales.tsx`, `repositorio-catalogo.ts:417`, `api/catalogo/route.ts:166`). Medido: 0 filas al entrar, «Mostrando 300 de 315» con «MOL» y «300 de 8773» con «a» |
| 5 | Tres acciones de usuario en una esquina | **No reproducía como se describió** | El mecanismo citado (`td.celda-acciones` absoluta) está acotado a `.table-wrap` y no llega a la tabla de usuarios: los botones ya se apilaban sin desbordar. Lo real era que colgaban alineados a la derecha en tres líneas; ahora ocupan el ancho y se envuelven (`cotizacion.css:694`) |
| 6 | El aviso de éxito tapaba el total | **No reproducía** | Con un aviso real (descarga de PDF) medido en 1280×900, 1280×800, 1024×690, 1280×700 y 390×844 desplazado: el aviso nunca cruza el bloque del total; cae sobre la fila de condiciones. Se dejó como estaba |
| 7 | La configuración del catálogo era JSON crudo | **Arreglado** | Editor por filas para maderas, familia por modelo y alias por modelo, con alta y baja por fila; el JSON queda en un `details` de solo lectura. Verificado el guardado (200 sin cambios) y el rechazo de duplicados («Código de madera duplicado: O.») |

**Comprobaciones tras el arreglo:** `npm run typecheck` y `npm run lint` sin salida; `vitest run` con 159 pruebas en verde y 3 fallos en `tests/autenticacion.test.ts` que **ya fallaban sin estos cambios** (verificado guardando el árbol aparte); capturas nuevas a 1280, 390 y 320.

---

## Considerado y descartado

| Ubicación | Candidato | Por qué se descartó |
|---|---|---|
| `src/app/responsive.css:155-163` y `:521-531` | La cabecera y los filtros del historial siguen desplazándose | Ya tienen máscara de degradado, que era el arreglo pedido el 29 de septiembre. A 390 px «Ajustes» asoma (empieza en x=296, el contenedor acaba en 358); a 320 px queda fuera, pero el degradado avisa. No es el mismo defecto que el hallazgo 2 |
| `src/app/api/catalogo/route.ts:95-111` | La búsqueda `HUIL-O-3-B` devolvía el código exacto en quinto lugar | Ya está corregido: `cercania()` antepone la coincidencia exacta y luego el prefijo. El hallazgo 3 de la revisión anterior no se reproduce |
| `src/app/chat.css:23-32` | El panel de conversación vacío deja aire arriba | En la pantalla completa el bloque `.chat-panel.inicio` ya centra la invitación (`responsive.css:401-406`). En el teléfono el compositor queda arriba, que es donde se escribe. No hay espacio muerto que corregir |
| `src/app/globals.css:31-34` | El texto de metadato sigue en 12 px | Contraste verificado en las nueve pantallas, 0 fallos. Subirlo rompería la densidad de las tablas del catálogo |
| `src/servidor/servicio.ts` | «No entendí, ¿puedes reformularlo?» ante «puerta 2x4» | Es el adaptador fijo de la instancia de prueba (`NELTUME_LLM=fijo`), no la interfaz. No se evaluó como hallazgo de diseño |

---

## Verificación

Revisiones ejecutadas, con lo que se observó:

**Pasaron**

- **Instancia aislada:** `next dev` en `127.0.0.1:3100` con `NELTUME_DATA_DIR=data/test-e2e`, adaptador de IA fijo y sincronización de feriados apagada. No se tocó la base real ni el puerto 3000. El usuario de fixture se promovió a `admin` solo en esa base, para poder ver feriados, usuarios y las secciones de administración.
- **Contraste de texto**, composición de alfa sobre el fondo efectivo, umbrales 4.5 y 3.0: 0 fallos en ingreso, cotizar, historial, las cuatro secciones del catálogo y ajustes, en 1280 px.
- **Nombres accesibles:** 0 controles sin nombre en esas pantallas, con una excepción medida: el `<input type="file">` del logo (`labels: 0`, sin `aria-label`).
- **Foco en el ingreso:** 3 paradas de tabulador, 0 sin indicador visible.
- **Estructura:** un solo `h1` por pantalla, sin saltos de nivel, en las nueve capturas.
- **Reflujo:** sin desplazamiento horizontal de página en cotizar, historial y catálogo a 390 y 320 px. Ajustes es la excepción: 111 px a 390 y 181 px a 320.
- **Recorte medido a 320 px:** cabecera (Ajustes de x=296 a 387, fuera), filtros del historial (Aprobadas, Reemplazadas y Anuladas fuera, con máscara), secciones del catálogo (Gestionar catálogo y Configuración enteras fuera, sin máscara).

**No verificadas**

- El orden de anuncio con lector de pantalla: se inspeccionó la estructura y los nombres, no la lectura hablada.
- Navegadores iOS y Android reales: las medidas son de Chromium headless con viewport angosto, no del motor del teléfono.
- Ampliación al 200 %: se aproximó con el barrido a 320 px, que es el mismo caso de reflujo pero no la misma prueba.
- El diseño de los PDF emitidos.
- Las respuestas del asistente contra el proveedor real: la instancia usó `NELTUME_LLM=fijo`.
- Los avisos de error (`role="alert"`) no se provocaron; solo se vio su posición en el CSS.
- El diálogo de emisión y de aprobación no se recorrió en esta pasada. La revisión del 29 de septiembre los cubrió y el código de esos diálogos no cambió.

---

## Lo que funciona

- **El ingreso tiene voz.** Logo, «ESPACIO INTERNO · COTIZACIONES», un solo botón oscuro y una línea que dice a quién pedir una cuenta. Nada de panel genérico.
- **La consulta del catálogo dice lo que esconde.** «Mostrando 300 de 8773 productos: afina la búsqueda para ver el resto.» El mismo texto se llevó a Gestionar catálogo al arreglar el hallazgo 4.
- **Los estados se leen sin color.** Aprobada, Anulada, Emitida, Reemplazada y Borrador llevan texto además del relleno, y la anulada va tachada.
- **Cada sección de Ajustes tiene una sola acción oscura** (Cambiar contraseña, Guardar, Guardar clave, Guardar configuración) y el resto queda en secundario. La jerarquía de commit es clara.
- **La máscara de la cabecera y de los filtros ya existe**, que era el hallazgo `HIGH` de la revisión anterior. El recurso está; faltaba aplicarlo a la tercera fila, y quedó aplicado.
- **El código exacto va primero.** `cercania()` en la consulta del catálogo antepone la coincidencia exacta y luego el prefijo, que era el otro hallazgo medido ayer.

---

## Próximos modos

Ninguno pendiente: los arreglos de esta jornada cubren los siete hallazgos. Si se quiere seguir, el orden natural es:

- `/design finish` — una pasada de fricción sobre el flujo completo, ahora que las pantallas de administración dejaron de romperse en angosto.
- `/design refine` — carácter del editor de configuración del catálogo, que hoy es correcto pero neutro.

---

## Método y límites

Navegación e instrumentación con Playwright y el Chromium del sistema, sobre una instancia local aislada con la planilla real importada en `data/test-e2e`. La segunda pasada de medición se cortó porque el límite de intentos de ingreso devolvió 429; las cifras de desborde, recorte y nombres salieron de la primera pasada, que sí ingresó. Las capturas incluyen nombres de clientes, RUT y precios del catálogo interno, y no se publican con este informe.

La revisión del 29 de septiembre (`36/50`, un `HIGH`) queda reemplazada por esta. Dos de sus tres hallazgos de fondo ya no se reproducen; el tercero, la zona de avisos fija, sigue y se conserva aquí como hallazgo 6.
