# Revisión de diseño — Neltume · Cotizador

**Modo:** `/design review`
**Fecha:** 29 de septiembre de 2026
**Commit revisado:** `1535847` (worktree aislado, HEAD)
**Alcance:** ingreso, Cotizar (inicio vacío, borrador, ítem pendiente, emitida, aprobada), Historial, Catálogo (Consultar y Agregar producto), Ajustes y los diálogos de emisión y aprobación. Escritorio 1024-2560 px, tableta 768 px, teléfono 390 px y 320 px, con una pasada de puntero grueso (`pointer: coarse`) para el caso táctil real.

> Esta revisión no modifica la interfaz. Son hallazgos para que los apliquen `/design responsive`, `/design a11y` o `/design refine`.

---

## Veredicto

**Block.** Un hallazgo `HIGH` sigue en pie: en pantalla angosta, dos destinos se vuelven invisibles sin ninguna señal de que existen. Todo lo demás es `MEDIUM`/`LOW`.

Nada de lo revisado falla en contraste, nombre accesible, anillo de foco, orden de encabezados ni reflujo. La deuda no está en la accesibilidad de base, que es de las mejores que he medido, sino en qué pasa cuando el ancho aprieta.

---

## TL;DR

La interfaz tiene un punto de vista real: papel cálido, tinta verde, serif editorial para los títulos, paneles numerados `01 / 02` y estados que explican su consecuencia antes de confirmar. No se parece a un panel genérico y no huele a generado. El aparato de accesibilidad además está verificado, no supuesto: cada parada de tabulador tiene anillo visible, cada campo tiene nombre, cada texto pasa contraste, y el diálogo nativo atrapa y devuelve el foco.

Lo que falta es la capa de pantalla angosta. Dos filas con desplazamiento horizontal esconden destinos sin avisar (`Ajustes` en la cabecera y tres de los seis filtros de estado), la edición en línea queda en blancos de 29 px al tacto, y el buscador del catálogo ordena por lectura de planilla en vez de por relevancia, así que el código exacto aparece quinto de ocho.

**Siguiente movimiento:** `/design responsive` para las dos filas desplazables y el estado de llegada, y `/design a11y` para completar la capa `pointer: coarse`.

---

## Puntajes por lente

| # | Lente | Puntaje | Hallazgo clave |
|---|---|---|---|
| 1 | Primera impresión | 6 / 10 | Voz propia y reconocible, pero en la llegada el 40-70 % del panel izquierdo está vacío y la invitación a actuar queda al fondo, junto al compositor |
| 2 | Jerarquía | 7 / 10 | En la cotización con datos el orden es correcto (título → cliente → ítems → totales → una acción oscura); falla solo en el estado vacío y en el recuadro del catálogo, que reserva pantalla completa para 8 filas |
| 3 | Voz de color | 8 / 10 | Paleta comprometida y neutros teñidos hacia el verde; contrastes verificados en vivo (peor caso 4,69:1). Solo la insignia `Emitida` rompe el registro cálido con un azul |
| 4 | Voz tipográfica | 8 / 10 | Georgia para la escala de pantalla contra Arial para la interfaz; microetiquetas en mayúsculas con tracking; escalones de 30/25/19 y 16/14/13/12 |
| 5 | Sensación de interacción | 7 / 10 | Diálogos nativos con foco devuelto al disparador, acciones deshabilitadas que dicen por qué, confirmaciones que nombran la consecuencia. Pierde por las filas desplazables sin señal |
| | **Total** | **36 / 50** | |

Nada se redondeó hacia arriba: la mayoría de las superficies reales vive en el medio, y este es un trabajo por encima del promedio con defectos concretos.

---

## Disparadores de escalamiento

De la lista de escalamiento, el único presente:

- **Algo cortado o enterrado al angostar a 320 px** — `Ajustes` en la cabecera y `Reemplazadas` / `Anuladas` en los filtros del historial. Detalle en el hallazgo 1; va primero y no se promedia a la baja.

Revisados y **ausentes**: nada operable sin nombre, nada enfocable sin indicador visible, ningún camino que el mouse recorra y el teclado no, ningún movimiento decorativo que ignore `prefers-reduced-motion`, ningún texto bajo su contraste, ninguna distinción solo por color, ninguna acción irreversible sin confirmación, ningún campo donde el marcador de posición haga de etiqueta.

---

## Hallazgos

| # | Severidad | Disciplina | Ubicación | Antes | Después | Por qué |
|---|---|---|---|---|---|---|
| 1 | HIGH | Responsive | `src/app/responsive.css:155-160` y `:494-499` | `.header-nav` y `.history-filters` se desplazan en horizontal con `scrollbar-width: none` y sin degradado. A 320 px, `Ajustes` empieza en x=296 y el contenedor termina en ~304: queda entero fuera. A 390 px, `Reemplazadas` y `Anuladas` quedan fuera y la última píldora visible termina a ras del borde | Máscara de degradado en el borde derecho (el mismo recurso que ya usa `.messages` en `chat.css:31`), o reservar el asomo del siguiente elemento; el desplazador se mantiene | Dos destinos desaparecen sin aviso en teléfono. Se alcanzan con deslizamiento o tabulador, así que la falla es de señalización, no de alcance: el arreglo es una pista visual, no rehacer la fila |
| 2 | MEDIUM | Interaction | `src/app/globals.css:650-664`, `src/app/responsive.css:523-529` | `.campo-valor-boton` mide 29 px de alto con puntero fino **y** con puntero grueso. En un borrador son 7 blancos: cliente, RUT, ciudad/comuna, cantidad, descuento y flete | Darle 44 px de área al tacto dentro del bloque `pointer: coarse` (crecer con relleno o `::before`, no con el alto visual, para no mover el lápiz absoluto de `globals.css:676-687`) | Toda la edición en línea del flujo móvil queda en un blanco chico. La capa `coarse` ya sube `.remove` (44 px) y `.campo-editar`, pero se salta este control |
| 3 | MEDIUM | Surface | `src/app/api/catalogo/route.ts:81-84` | Buscar `HUIL-O-3-B` devuelve 8 productos ordenados por familia, modelo, madera, alto y ancho: el código exacto aparece en la quinta fila, detrás de tres maderas que solo comparten la palabra clave | Anteponer la coincidencia exacta de código, luego el prefijo de código, y dejar el orden de lectura actual para el resto | El campo se ofrece como búsqueda («Busca por modelo, madera, medida o código») y se usa como consulta puntual; la fila que la persona pidió no debería requerir escaneo |
| 4 | LOW | Layout | `src/app/login.css:6-15` con `src/app/layout.tsx:5-6` | `.account-toggle` queda en 36 px incluso con `(pointer: coarse)`, mientras todos los demás controles compactos medidos suben a 44 px | Mover el `min-height` de `.account-toggle` a un bloque `coarse` declarado después de `login.css`, o declarar la capa `coarse` al final de las importaciones | Es el único control que no llega a 44 px en un teléfono real; la causa es de orden de cascada, no de intención |
| 5 | LOW | Layout | `src/app/avisos.tsx:14`, `src/app/globals.css:564-573` | El aviso de éxito está fijo en `right:20px; bottom:20px` y cae encima del bloque `Total` de la cotización durante sus 9 s de vida | Desplazar la zona de avisos por encima del pie de la cotización, o anclarla al área de trabajo en vez de a la ventana | Tapa justo la cifra a la que se refiere la descarga que anuncia |
| 6 | LOW | Layout | `src/app/chat.css:70-72` y `src/app/responsive.css:391-395` | Sin conversación, el bloque de bienvenida se ancla al fondo (`justify-content: flex-end`) y deja vacío el 40-70 % superior del panel izquierdo entre 1024 y 2560 px de ancho | Centrar la bienvenida mientras la conversación está vacía; conservar el anclaje al fondo en cuanto hay mensajes | La primera fijación de la mirada en la pantalla de llegada es espacio vacío, y la invitación a escribir queda última |

---

## Considerado y descartado

| Ubicación | Candidato | Por qué se descartó |
|---|---|---|
| `src/app/globals.css:676-687` | `scrollWidth` 16 px mayor que `clientWidth` en `.quote-pie`, `.totals` y `.campo-discreto` | Lo produce el lápiz en `position: absolute; left: 100%`, que vive fuera de su caja. Nada se recorta y no hay desplazamiento horizontal de página (verificado de 320 a 2560 px): es ruido de medición, no un defecto |
| `src/app/historial.tsx:197-208` | El buscador del historial no tiene etiqueta visible, solo `placeholder` | Sí tiene nombre accesible (`<span class="sr-only">Buscar cotizaciones</span>`), y el marcador describe el alcance, no la identidad del campo. La regla de «marcador haciendo de etiqueta» no aplica |
| `src/app/cotizacion.css:88-91` | La insignia `Emitida` usa azul (`#2f506b` sobre `#e2ebf3`), el único tono frío del sistema | El estado también lleva texto, así que no hay significado solo por color, y el frío separa «en curso» de «cerrado» (verde). Cambiarlo costaría una distinción útil |
| `src/app/globals.css:31-34` | El texto más pequeño de la interfaz es de 12 px | Es metadato (fechas, códigos, autoría) sobre contraste verificado, en una herramienta interna de escritorio. Bajarlo a 11 px sería peor; subirlo rompería la densidad de las tablas |
| `src/app/responsive.css:239-315` | Los ítems del historial en móvil ocupan ~200 px de alto por fila | La rejilla de 3 columnas con meta en la segunda fila es legible y mantiene carriles estables; compactarla costaría la alineación de importes |
| `src/app/cotizacion.css:344-396` | Las tablas se convierten en tarjetas bajo 520 px | **Ya está resuelto.** El informe `ui-audit/INFORME.md` reportaba importes cortados en móvil; medido hoy, la tabla de ítems mide 318/318 y la del catálogo 322/322 sin desborde, con la última celda dentro del contenedor. Ese hallazgo está obsoleto |

---

## Verificación

Revisiones ejecutadas, con lo que se observó:

**Pasaron**

- **Instancia aislada:** worktree en `HEAD` con su propia base SQLite de fixture y su propio `.next`, en el puerto 3100. No se tocó la base real ni el servidor de desarrollo del puerto 3000.
- **Flujos reales recorridos** (Playwright, Chromium del propio detector del proyecto): ingreso → borrador → ítem pendiente → diálogo de emisión → emitida → diálogo de aprobación → aprobada → historial → catálogo (consultar y agregar) → ajustes.
- **Contraste de texto**, con composición de alfa sobre el fondo efectivo y umbrales 4.5 / 3.0 según tamaño: 0 fallos en todas las pantallas. Peor caso medido 4,69:1 (el botón «Enviar» deshabilitado, exento por estado). El peor texto habilitado fue 5,22:1.
- **Nombres accesibles:** 0 campos sin nombre, 0 botones o enlaces sin nombre en todos los estados capturados.
- **Foco:** 25-29 paradas de tabulador por pantalla revisadas, **0 sin indicador visible**; anillo de 2 px `rgb(170,113,77)` con 4 px de aire. En el diálogo, el foco cicla dentro (Cerrar → Cancelar → Emitir) y Escape lo cierra devolviéndolo al botón «Emitir y generar PDF».
- **Estructura:** un solo `h1` por pantalla, sin saltos de nivel, `main`/`nav`/`header` presentes, 0 imágenes sin `alt`, `lang="es-CL"`.
- **Reflujo:** sin desplazamiento horizontal de página en 320, 360, 390, 768, 1024, 1440 y 2560 px, con y sin cotización abierta.
- **Movimiento reducido:** con `prefers-reduced-motion: reduce` no queda ninguna transición ni animación sobre 1 ms.
- **Táctil real** (`hasTouch`, `isMobile`, `pointer: coarse` confirmado por `matchMedia`): `.button.small`, `.remove`, `.jump-to-quote` y el envío del chat miden 44 px; el compositor pasa a 16 px (sin zoom automático en iOS).

**No verificadas**

- Navegadores iOS/Android reales: la emulación de puntero grueso reproduce el caso, no el motor.
- Respuestas del asistente contra el proveedor real: la instancia usó el adaptador fijo (`NELTUME_LLM=fijo`), así que el texto de las respuestas del modelo y su latencia no se ejercitaron.
- El diseño de los PDF emitidos: se descargaron `cotizacion-*.pdf` y `nota-pedido-*.pdf`, pero no se revisó su maquetación.
- Ampliación al 200 % en el navegador: se aproximó con el barrido a 320 px, que es el mismo caso de reflujo, pero no es la misma prueba.
- Lectura con lector de pantalla: se inspeccionó la estructura y los nombres, no el orden de anuncio hablado.
- Los avisos `error` (`role="alert"`) no se provocaron; solo se vio el de éxito.

---

## Lo que funciona

- **Estados que explican su consecuencia.** Emitir, aprobar y anular nombran lo que va a pasar antes de confirmar, y el foco inicial en la confirmación cae en `Cancelar`, no en el botón destructivo. Aprobar una vencida exige confirmarlo aparte.
- **La acción deshabilitada dice por qué.** Con un ítem pendiente, «Emitir y generar PDF» se apaga y aparece «Completa o quita los ítems pendientes para generar el PDF.» justo debajo. La fila pendiente muestra «Pendiente de completar», guiones en vez de $0 y «Incompleto · no suma al total».
- **El asistente pregunta con opciones tocables.** Ante un marco sin datos ofrece `2X4 2X5 2X6 2X8`, luego los largos y el rango de cantidad, en vez de exigir texto libre.
- **El catálogo en teléfono es una tarjeta por producto**, con nombre, código, medida y precio siempre visibles; 8 productos sin recorte ni desplazamiento lateral.
- **El aparato de foco y nombres es sistemático**, no parche por parche: una sola regla `:focus-visible` en `globals.css:78-92`, un diálogo nativo `<dialog>.showModal()` en `dialogo.tsx`, y `aria-label` en cada control de icono.
- **Los estados de cotización se leen sin color:** `Borrador`, `Emitida`, `Aprobada`, `Reemplazada`, `Anulada` llevan texto además del relleno, y la anulada va tachada.

---

## Próximos modos

- `/design responsive` — hallazgo 1 (máscara o asomo en `.header-nav` y `.history-filters`) y hallazgo 6 (estado de llegada del panel de conversación).
- `/design a11y` — hallazgo 2 (blancos de 29 px en `.campo-valor-boton`) y hallazgo 4 (orden de cascada de `.account-toggle`).
- `/design refine` — hallazgo 5 (el aviso sobre el total) y hallazgo 3 si se prefiere tratar el orden del catálogo como ajuste de superficie.

---

## Método y límites

Navegación e instrumentación sobre una instancia local aislada, con base de fixture creada desde la planilla real y el adaptador de IA fijo; no se usaron ni modificaron la base ni las credenciales de producción. Las capturas de esta revisión incluyen nombres y precios del catálogo interno.

Los informes previos en `ui-audit/` son de una versión anterior de la interfaz: la cabecera, el catálogo y la composición de la pantalla principal cambiaron. Dos de sus tres hallazgos ya no se reproducen (el corte de importes en móvil está resuelto y los blancos táctiles suben a 44 px con puntero grueso); el tercero, el desplazamiento vertical del flujo móvil, se atiende ahora con el salto «Ver cotización ↓».
