# Auditoría del Cotizador Neltume · 26 de octubre de 2026

Rama `main` en el commit `1ecd0c1` (ítem libre ya mergeado), árbol limpio. Stack verificado: Next.js 16.4.3 (App Router, Turbopack), React 19.2, TypeScript 5.9, better-sqlite3 13 (esquema v28), Zod 4, better-auth 1.7, PDF con Chromium vía Playwright 1.58, IA vía CommandCode con herramientas.

La evidencia de cada hallazgo (scripts, salidas, textos de PDF y capturas, 6,6 MB) quedó fuera del repositorio, en `~/Documents/auditoria-cotizador-2026-10-26/` del equipo donde se hizo la auditoría. Las rutas `auditoria-2026-10-26/…`, `evidencia/…` y `capturas/…` de este informe son relativas a esa carpeta. Los scripts se corrieron desde una carpeta temporal y todavía contienen esas rutas absolutas: sirven para leer cómo se reprodujo cada caso, y para volver a correrlos hay que ajustar la ruta base (`D`, `AUD`, `SP`).

---

## A. Resumen ejecutivo

### Estado general

Los cálculos de dinero son exactos. Para una misma cotización no apareció ninguna diferencia de un peso entre lo guardado en la base, lo que muestra el panel, el HTML que recibe el generador y el texto del PDF, ni en las cotizaciones ni en las notas de pedido. La máquina de estados resistió 32 transiciones inválidas forzadas por la API. También resistieron la emisión «una a la vez», los dobles clics (9 de 9 escenarios), los conflictos entre pestañas y la recuperación sin red, y axe-core no encontró ninguna violación WCAG 2.2 AA en 40 pantallas. Las pruebas existentes pasan completas: 1.541 unitarias y 102 E2E.

Los problemas graves no están en las fórmulas. Están en **datos que se pierden o cambian de lugar sin aviso** y en **lo que viaja a la fábrica**:

- Una observación escrita en una puerta puede guardarse en otra del mismo modelo.
- Editar una cotización emitida puede borrar las fotos y la fábrica de su revisión.
- Una orden de trabajo puede viajar a la fábrica con los ítems de otro pedido.
- El ancho de un marco especial no llega a ningún documento.
- Un pedido que nunca llegó a la fábrica no se avisa en ninguna pantalla.
- El validador del asistente deja pasar en silencio algunas equivocaciones típicas de un modelo: copiar la cantidad o la madera de otro ítem, quitar el ítem equivocado, duplicar un ítem o inventar texto para el PDF.

### Cifras

| Severidad | Bug confirmado | Bug probable | Riesgo técnico | Problema de UX | Mejora | Total |
|---|---|---|---|---|---|---|
| P0 | 0 | 0 | 0 | 0 | 0 | **0** |
| P1 | 8 | 0 | 0 | 1 | 0 | **9** |
| P2 | 23 | 0 | 1 | 0 | 0 | **24** |
| P3 | 15 | 1 | 5 | 8 | 3 | **32** |
| **Total** | **46** | **1** | **6** | **9** | **3** | **65** |

Los síntomas con la misma causa se agruparon en un solo registro. Por ejemplo, el PDF con exceso de fotos y el envío que queda «fallido» por pesar más de 20 MB forman un solo hallazgo (BUG-004).

### Flujos más problemáticos

1. **Edición de ítems en el panel**: BUG-001, BUG-010, BUG-011 y BUG-057.
2. **Revisiones de una cotización emitida**: BUG-002, BUG-012 y BUG-025.
3. **Integración con la fábrica de Panguipulli**: BUG-003, BUG-004, BUG-019, BUG-020 y BUG-021.
4. **Validación de lo que propone la IA**: BUG-006 a BUG-009 y BUG-026 a BUG-032.
5. **Copias y reimpresiones de documentos**: BUG-016 y BUG-017.

### Riesgos principales para el negocio

- **Puertas fabricadas mal.** La fábrica puede recibir una orden de trabajo ajena (BUG-003), un marco especial sin su ancho (BUG-005) o una observación que era de otra puerta (BUG-001).
- **Pedidos que la tienda da por enviados y la fábrica nunca recibe.** El estado «fallido» solo se ve desde el servidor (BUG-004).
- **Fotos del cliente que desaparecen** de la revisión que se envía (BUG-002).
- **Cotizaciones con precios o fletes que cambiaron sin aviso.** Un cambio de catálogo se aplica al editar cualquier campo (BUG-012), y una tarifa de Starken calculada para 2 puertas se mantiene con 20 (BUG-013).
- **Errores del asistente que no se avisan.** Todo lo de la IA se comprobó con un modelo simulado. El defecto del validador es determinista, pero no se midió cuántas veces un modelo real comete esos errores.

### Limitaciones de la auditoría

- **Sin gasto en IA ni contacto con terceros.** No se hizo ninguna llamada pagada a la IA: el asistente se probó con un modelo simulado que devuelve tool-calls adversariales. No se habló con la fábrica real (solo con una fábrica falsa en `127.0.0.1`) ni con Starken real (se usó el simulado).
- **Datos reales intactos.** No se abrió `data/cotizador.sqlite`. Todo corrió en bases temporales con el catálogo real importado de `datos-privados/`.
- **Navegadores y PDF.** Se probó solo en Chromium. No se probó con lectores de pantalla reales, Safari, Firefox ni teléfonos físicos. Los PDF se renderizaron con pdfjs; no se abrieron en Preview o Acrobat ni se imprimieron.
- **Sin carga ni procesos múltiples.** No hubo pruebas de carga ni de varios procesos sobre la misma base.

---

## B. Inventario de funcionalidades

| Módulo / flujo | Dónde vive | Evaluado | Cómo |
|---|---|---|---|
| Inicio de sesión, sesiones, cuentas | `src/app/login`, `api/auth`, `api/usuarios`, `api/sesiones` | Sí | E2E, HTTP con sesiones reales, carreras forzadas |
| Asistente (chat) y anclaje de cifras | `src/servidor/chat.ts`, `src/asistente/*` | Sí (modelo simulado) | 101 escenarios adversariales en los dos modos de anclaje |
| Proveedor de IA (CommandCode): errores, plazos, respaldo | `src/asistente/llm.ts`, `commandcode-chat.ts` | Sí (fetch falso) | 429/5xx/timeout/JSON roto/respuesta vacía |
| Panel de cotización: ítems, descripción, observaciones, medidas, madera | `cotizacion-panel.tsx`, `campo-editable.tsx` | Sí | Playwright en `:3200` |
| Descuento por ítem, general, por cantidad; ganancia por línea y por cotización | `precios.ts`, `descuento-item.tsx`, `margenes.tsx` | Sí | Servicio real, Playwright, barrido exhaustivo de redondeo |
| Ítems libres y pedidos especiales | `personalizados.ts`, `agregar-producto.tsx` | Sí | Servicio, PDF, envío a la fábrica |
| Fotos y referencias del cliente | `referencias-item.tsx`, `api/referencias` | Sí | Subidas, PDF, revisiones |
| Flete y Starken | `negocio/starken.ts`, `cotizar-starken.tsx` | Parcial | Solo el modo simulado |
| Emitir, numerar, renumerar, revisiones | `servicio.ts`, `almacen.ts` | Sí | Concurrencia controlada, HTTP |
| Aprobar, pagos, facturación, operación, retroceder, anular, desaprobar | `servicio.ts`, `seguimiento-operacion.tsx` | Sí | API y Playwright |
| Notas de pedido por fábrica y orden de trabajo | `servicio.ts`, `pdf.ts` | Sí | PDF reales, texto y geometría |
| Envío automático a la fábrica, reintentos, cancelación | `integracion-*.ts` | Sí | Fábrica falsa en `127.0.0.1:3410` |
| Prueba de conexión con la fábrica | `integracion-prueba-*.ts`, `ajustes/conexion-fabrica.tsx` | Sí | 18 casos de recepción y 5 de envío |
| Historial: filtros, búsqueda, papelera | `historial.tsx`, `almacen.ts` | Sí | Playwright y servicio |
| Exportación CSV | `servidor/exportar.ts` | Solo lectura | Se verificó la protección contra fórmulas (`=`, `+`, `-`, `@`); no se ejecutó |
| Clientes y autocompletar | `servidor/clientes.ts`, `app/clientes` | Sí | Servicio y Playwright |
| Catálogo: consulta, alta manual, gestionar, nombres y alias | `app/catalogo`, `alta-catalogo.ts` | Sí | Playwright |
| Importar planilla de catálogo | `catalogo/importar.ts` | Parcial | Solo un archivo inválido, para no alterar el catálogo; lo válido lo cubren las pruebas del repo |
| Ajustes: precios, cotizaciones, empresa, IA, Starken, usuarios | `app/ajustes` | Sí | Playwright y carreras HTTP |
| Control de acceso y cabeceras (Host, Origin, cuerpo) | `acceso*.ts`, todas las rutas `/api` | Sí | 26 rutas sin sesión y con rol `user` |
| `/api/salud`, primer arranque, logo | `api/salud`, `api/primer-arranque`, `api/logo` | Sí | HTTP |
| Respaldo y restauración | `scripts/lib/restauracion.ts` | Parcial | Solo la función, en una base temporal; nunca contra `data/` |
| Limpieza de borradores | `almacen.ts`, `scripts/limpiar-borradores.ts` | Parcial | Prueba unitaria; el script por tsx quedó bloqueado por el largo de la ruta del socket (entorno) |
| Feriados y vigencia | `negocio/feriados.ts`, `vigencia.ts` | Solo pruebas del repo | Sin sincronizar con la red |
| Ayuda, 404, configuración | `app/ayuda`, `not-found.tsx` | Sí | Recorrido y capturas |
| Evaluación de IA (`evaluar:*`), paridad con Excel con IA, deploy | `scripts/` | No | Exigen gasto o desplegar; están prohibidos para esta auditoría |

---

## C. Registro de hallazgos

Las rutas de evidencia son relativas a `auditoria-2026-10-26/evidencia/` y `auditoria-2026-10-26/capturas/`. En los hallazgos del asistente, «modelo simulado» significa que la tool-call se inyectó a mano: el defecto del validador se reproduce siempre (100 %) con esa entrada, pero no se midió con qué frecuencia la genera un modelo real.

### P1 · Alto

**BUG-001: Una observación o un dato escrito sin guardar se pasa a otro producto del mismo modelo y se guarda en él**

- **Severidad:** P1.
- **Categoría:** Persistencia / UI.
- **Estado:** Confirmado.
- **Ubicación:** Cotizar → panel «Cotización en curso» → «Editar detalles» de un ítem.
- **Archivo y líneas:** `src/app/cotizacion-panel.tsx:672` y `:699`. La clave de React se arma con `JSON.stringify([modelo, madera, fuente]) + '#' + ocurrencia`. Los ítems agregados desde el catálogo no tienen `fuente` (`src/servidor/servicio.ts:831-840`). El estado `editando`/`borrador` vive en `src/app/campo-editable.tsx:87-88`.
- **Descripción:** dos Molco Lenga de distinto ancho tienen la misma identidad y solo se distinguen por su posición. Al quitar, mover o cambiar la madera de otro ítem, React reutiliza el componente de otro producto. Con el componente viajan el campo abierto y su texto, el `<details>` desplegado y el tipo de descuento elegido.
- **Pasos:**
  1. Agrega desde el catálogo MOL-L-1-A (0,60), MOL-L-2-A (0,70) y MOL-L-3-A (0,80).
  2. Abre los detalles del ítem 2 y pulsa «Editar observación del producto».
  3. Escribe «Abre a la izquierda».
  4. Quita el ítem 1 y confirma.
  5. Pulsa Guardar.
- **Esperado:** el campo abierto sigue en la Molco 0,70 y se guarda ahí.
- **Obtenido:** el campo abierto aparece bajo la Molco 0,80 y se guarda en ella (`guardado=["0.7:-","0.8:Abre a la izquierda…"]`). Pasa lo mismo con «Mover ítem 1 hacia abajo». Al cambiar la madera del ítem 1, el borrador salta al ítem 2.
- **Frecuencia:** quitar 3/3, mover 2/2, cambiar madera 2/2. Con modelos distintos, 0/1.
- **Evidencia:** `evidencia/ui/06-claves-react.ts`, `06b-reordenar.ts`, `registro-06-claves.log`; `capturas/ui/06-K1-antes.png`, `06-K1-despues.png`, `06-K1-guardado.png`, `06b-K4-tras-mover.png`. La captura `06-K1-despues.png` se revisó en la consolidación.
- **Causa raíz:** confirmada. Los ítems no tienen una identidad estable.
- **Impacto:** una indicación de fabricación («bisagras a la izquierda») termina en otra puerta, en el PDF y en la nota de pedido, sin aviso. Es el caso más común: varias puertas del mismo modelo con distinto ancho.
- **Solución:**
  - Definitiva (dificultad media): un `id` estable por `SolicitudItem`, generado en el servidor, con migración para los ítems existentes, y usarlo como `key`.
  - Mitigación inmediata (dificultad baja): cerrar y descartar las ediciones abiertas cuando cambian el orden o la cantidad de ítems.
- **Prueba de regresión:** E2E con tres Molco Lenga y un borrador abierto en el ítem 2. Quitar el ítem 1, moverlo y cambiarle la madera. En los tres casos el borrador debe seguir en la 0,70 y guardarse ahí.

**BUG-002: Editar la cotización emitida pisa su revisión abierta: se pierden fotos, fábrica y correcciones del cliente**

- **Severidad:** P1.
- **Categoría:** Persistencia.
- **Estado:** Confirmado.
- **Ubicación:** acción `editar` sobre una cotización emitida que ya tiene una revisión en borrador.
- **Archivo y líneas:** `src/servidor/servicio.ts:1002` (`aplicarCambiosItems(q.solicitudes, …)` calcula sobre la emitida), `:1106-1107` (`destino.solicitudes = solicitudes; destino.cliente = cliente`), `:460` (`abrirEdicion` reutiliza la revisión si `mismoContenido`) y `:437-449` (`mismoContenido` no compara `referencias` ni `fabrica`, y compara el cliente normalizado).
- **Descripción:** si la revisión abierta tiene el «mismo contenido» que la emitida, el cambio se calcula sobre la emitida y el resultado se escribe en la revisión. Se borra todo lo que `mismoContenido` no compara.
- **Pasos (HTTP real, una sola persona):**
  1. Emitir la N° 323.
  2. Adjuntar una foto al ítem 1: se abre la revisión R con 1 foto.
  3. Volver a abrir la emitida desde Historial.
  4. Editar las observaciones.
- **Esperado:** R conserva la foto, o se responde 409 `revision_abierta`, un código que la interfaz ya maneja (`cotizador.tsx:461`).
- **Obtenido:** 200, y R queda con 0 fotos. La actividad solo dice «Observaciones actualizadas». En otras variantes, el nombre corregido «Juan Pérez» vuelve a «Juan Perez» y la fábrica `santiago` pasa a `null`.
- **Frecuencia:** 1/1 en cada variante (determinista).
- **Evidencia:** `evidencia/persistencia/http-revision.mjs` → `salida-http-revision.txt` («RESULTADO: LA FOTO SE PERDIÓ EN SILENCIO»); `concurrencia.test.ts` (C3, C3b, C4) → `salida-concurrencia.txt`. Se volvió a correr en la consolidación con el mismo resultado.
- **Causa raíz:** confirmada. Se usa `q` en vez de `destino` como base. El chat no tiene este defecto porque parte de la revisión.
- **Impacto:** la revisión emitida, o la nota de pedido que se genere después, sale sin la foto del cliente, sin el reparto de fábricas o con el cliente mal escrito.
- **Solución (baja-media):** cuando `abrirEdicion` devuelve una revisión existente, aplicar `aplicarCambiosItems` y `sanearCliente` sobre `destino`, o responder siempre 409 `revision_abierta`. Revisar el mismo patrón en `restaurar_items`.
- **Prueba de regresión:** emitida → foto, fábrica y tilde en R → `editar` sobre la emitida → R conserva las tres cosas, o se recibe 409.

**BUG-003: La fábrica puede recibir la orden de trabajo (PDF de producción) de otro pedido**

- **Severidad:** P1.
- **Categoría:** Integración.
- **Estado:** Confirmado.
- **Ubicación:** bandeja de envíos a Panguipulli.
- **Archivo y líneas:** `src/servidor/integracion-bandeja.ts:93` nombra el archivo `orden-trabajo-${fabrica}-${orderNumber}-r${revision}.pdf`. `src/servidor/integracion-envio.ts:189-197` reutiliza ese archivo si existe, sin comprobar a qué pedido pertenece. `scripts/lib/restauracion.ts:171-172` y `:195` restauran `pdf/` y `referencias/`, pero no `data/integracion/pdf`.
- **Descripción:** si dos pedidos llegan a tener el mismo N.º de nota en la misma revisión, el segundo se envía con la OT del primero. Los datos estructurados (`order`) sí son los correctos, pero el PDF de producción es ajeno. La OT ajena muestra el mismo N.º de nota y pasa la verificación de la fábrica.
- **Pasos:**
  - **Camino A (renumeración):**
    1. A genera la nota 577.
    2. Se cambia el número de la cotización A (rev 2).
    3. La nota de A pasa de 577 a 700 (rev 3).
    4. B genera la nota 701.
    5. La nota de B pasa de 701 a 577: es su rev 2 y reutiliza `orden-trabajo-panguipulli-577-r2.pdf`, que es de A.
  - **Camino B (restaurar un respaldo):** se respalda, la nota 577 de X se entrega, se restaura el respaldo y otra cotización Y recibe la 577.
- **Esperado:** la OT de B (o de Y) con sus propios ítems.
- **Obtenido:**
  - Camino A: `sha OT de B rev2 = sha OT de A rev2: true`. La OT trae «Bisagras a la derecha», «Edificio Los Robles» y «Cotización N.º 363», todo de A.
  - Camino B: `OT de Y = OT de X (sha): true`.
- **Frecuencia:** determinista cuando se dan las condiciones (2/2 en el camino B). Son condiciones poco frecuentes.
- **Evidencia:** `evidencia/fabrica/s03-revisiones.mts` y `.log` (línea 49); `s04-limites.mts` y `.log`; `s08-restaurar.mts` y `.log` (línea 7). El código se revisó en la consolidación.
- **Causa raíz:** confirmada. El archivo se identifica por fábrica, número y revisión, no por envío, y se reutiliza solo porque existe.
- **Impacto:** la fábrica puede fabricar las puertas de otro cliente o con otras medidas.
- **Solución (baja):**
  - Nombrar la OT por `evento_id` o id de envío.
  - Guardar su sha256 en la fila y verificarlo antes de reutilizarla.
  - Que la restauración aparte también `data/integracion/`.
- **Prueba de regresión:** repetir el camino A en `tests/integracion-fabrica.test.ts`. El `production.sha256` de B rev 2 debe ser distinto del de A, y su texto debe contener los ítems de B.

**BUG-004: Si un pedido no llega a la fábrica, nadie en la tienda se entera; con muchas fotos falla al instante**

- **Severidad:** P1.
- **Categoría:** Integración / UX.
- **Estado:** Problema de UX confirmado (de observabilidad).
- **Ubicación:** seguimiento de la operación y notas de pedido.
- **Archivo y líneas:**
  - `src/app/seguimiento-operacion.tsx` no consulta la bandeja: ningún archivo de `src/app`, salvo Ajustes → Conexión, menciona el envío.
  - `src/app/api/salud/comprobaciones.ts:240-266`: el aviso existe solo en el JSON de `/api/salud` con sesión de administración, y ninguna pantalla lo consume.
  - `src/servidor/servicio.ts:1871-1872`: un error al preparar el envío solo se escribe en el registro.
  - `src/servidor/integracion-envio.ts:39` (tope de 20 MiB) y `:42` (15 intentos).
  - Las fotos se incrustan en la nota y en la OT sin un tope total (`pdf.ts:759-777`) y además viajan como adjuntos.
- **Descripción:** un envío queda «fallido» en estos casos:
  - la fábrica responde 400/409/413/415/422, incluida una anulación rechazada;
  - la fábrica está caída unas 33 h;
  - el cuerpo pesa más de 20 MiB, lo que pasa con unas 20 fotos de peor caso.

  En todos ellos la nota se ve igual que una entregada. La documentación promete «15 intentos (≈ 3 días)» (`integracion-envio.ts:42`, `docs/integracion-fabrica.md:334`), pero la suma real es de unas 32,5 h. El cálculo se verificó en la consolidación.
- **Pasos:**
  1. Generar una nota de Panguipulli con la fábrica respondiendo 503 durante 15 intentos, o con 409 en la anulación, o con 20 fotos con textura.
  2. Mirar la cotización, el seguimiento y la respuesta de la acción.
- **Esperado:** un indicador de solo lectura en la nota («Enviada a fábrica / Pendiente / No llegó») y un aviso para administración. Sin un botón nuevo, como pide el negocio.
- **Obtenido:**
  - El estado queda `fallido` y la respuesta de «Anular» trae `avisos=[]`.
  - El estado solo se ve con `npm run integracion` o con GET `/api/salud`.
  - Con 20 fotos: «El pedido pesa 21 MB y el tope es 20 MB», `fallido`, 0 adjuntos subidos.
  - Con 28 fotos con textura, la nota y la OT pesan 6,58 MiB cada una. El estándar pide ≤ 5 MiB por documento (ancla 15).
- **Frecuencia:** siempre que hay un fallo definitivo.
- **Evidencia:** `evidencia/fabrica/s02-errores.log` (esperas `[34,60,142,…,21287]` s, `estado final=fallido`), `s03-revisiones.log` (F15), `s04-limites.log` (F21); `evidencia/pdf/e-imagenes.ts` (E3).
- **Causa raíz:** confirmada. Por diseño, el estado del envío solo es visible para quien opera el servidor, y no hay un presupuesto de peso para las imágenes.
- **Impacto:** pedidos que la tienda da por enviados y la fábrica nunca recibe, o anulaciones rechazadas con el pedido en producción.
- **Solución (media):**
  - Exponer el estado del último envío de cada nota en la API de la cotización y mostrarlo en el seguimiento.
  - Avisar a administración.
  - Reducir las fotos hasta caber en 5 MiB por documento, o avisar al generar la nota.
  - Reconsiderar el tope de intentos y corregir el texto «≈ 3 días».
- **Prueba de regresión:**
  - Un envío `fallido` muestra «No llegó a la fábrica» en la nota.
  - Una nota con 40 fotos queda en ≤ 5 MiB, o avisa antes de encolarse.

**BUG-005: El ancho de un pedido especial de marco o moldura no llega a ningún documento ni a la fábrica**

- **Severidad:** P1.
- **Categoría:** PDF / Integración.
- **Estado:** Confirmado.
- **Ubicación:** cotización, nota de pedido, orden de trabajo y mensaje a la fábrica de un pedido especial que no es puerta.
- **Archivo y líneas:** `src/servidor/pdf.ts:60-67` (`medidaPedida`: fuera de las puertas ignora `anchoSolicitado` y usa `producto.medida`), `src/negocio/personalizados.ts:127` (`medida: ''`), `src/servidor/integracion-pedido.ts:62` (`widthMm: puerta ? … : null`). `src/app/agregar-producto.tsx:449` ofrece «Ancho (m) · opcional» para toda familia salvo el ítem libre.
- **Pasos:**
  1. Agregar un producto personalizado de familia MARCO, madera Lenga, ancho 0,9, alto 2,1, cantidad 2, $60.000.
  2. Emitir, aprobar, registrar el anticipo y generar la nota.
- **Esperado:** la cotización, la nota, la OT y el pedido llevan 0,90 × 2,10 m.
- **Obtenido:**
  - Las tres impresiones dicen «Medida solicitada: × 2,10 m». Para una moldura especial con ancho 0,35, «× 2,40 m».
  - El pedido lleva `widthMm:null, section:null, requested:" × 2,10 m"`.
  - El ancho sí está guardado y el panel lo muestra.
- **Frecuencia:** 100 % de los especiales de marco o moldura con ancho.
- **Evidencia:** `evidencia/pdf/g-medida-especial.ts`, `evidencia/pdf/runs/g1/texto.txt` (líneas 10, 13, 41 y 44, revisadas en la consolidación); `capturas/pdf/g1-nota-p1.png`, `g1-cot-p1.png`.
- **Causa raíz:** confirmada. El formato de medida fuera de las puertas da por hecho que hay una escuadría de catálogo.
- **Impacto:** la fábrica recibe un marco especial sin el ancho que dio el cliente.
- **Solución (media):** imprimir «0,90 m × 2,10 m» si hay ancho y no imprimir el «×» suelto. Enviar el ancho en `dimensions`; esto exige acordar el contrato con la fábrica. O bien ocultar el campo «Ancho» para esas familias.
- **Prueba de regresión:** un especial MARCO con ancho 0,9 muestra «0,90» en la nota y en la OT, y el pedido lleva el ancho. Ningún especial sin sección contiene «: ×».

**BUG-006: El asistente puede copiar el modelo, la madera, la medida o la cantidad de otro ítem del borrador, y el validador lo acepta sin aviso**

- **Severidad:** P1.
- **Categoría:** Lógica (IA).
- **Estado:** Confirmado en el validador, con un modelo simulado.
- **Ubicación:** chat con un borrador que ya tiene ítems.
- **Archivo y líneas:** `src/asistente/anclaje.ts:157-166` (`anclarCifras` acepta cualquier cifra presente en `previos`), `:333` (`anclarNombres`, mismo criterio) y `:582`, `:623`, `:659`, `:765`, `:802` (en `anclarFrases`, `conocida(...)` decide antes de comparar con la frase); `src/servidor/chat.ts:1051` (`previos = [...q.solicitudes, …]`).
- **Pasos:**
  1. Turno 1: «5 molco en lenga de 80x200».
  2. Turno 2: «agrega 3 coz coz en mara de 90x200».
  3. El modelo responde `agregar:[{modelo:'COZ COZ', madera:'MARA', ancho:0.9, alto:2, cantidad:5, fuente:'3 coz coz en mara de 90x200'}]`.
  4. Variantes probadas: `madera:'LENGA'`, `modelo:'MOLCO'`, `ancho:0.8`, y «agrega coz coz de 90x200» respondido con `madera:'LENGA', cantidad:5`.
- **Esperado:** se corrige o queda pendiente, con aviso.
- **Obtenido:** se cotizan 5 Coz Coz, Coz Coz en Lenga, o 3 MOLCO MARA. Con el ancho de 0,8, el precio pasa de $562.436 a $542.190. `avisos: []` en los modos «avisar» (el de producción) y «corregir».
- **Frecuencia:** 100 % con esa tool-call.
- **Evidencia:** `evidencia/ia/t01-adversarial.test.ts` (S1.02a-e, S1.22) y `evidencia/ia/escenarios/S1.02*.json`. S1.02a se volvió a correr en la consolidación.
- **Causa raíz:** confirmada. La excepción para «otra igual» (`tests/precision-ia.test.ts:129`) se aplica a cualquier ítem nuevo o editado, y le gana a lo que dice su propia frase. Ninguna prueba documenta ese alcance.
- **Impacto:** producto, madera, medida o cantidad equivocados, con su precio, sin alerta.
- **Solución (media):** un valor ya conocido vale solo si la frase del ítem no nombra otro y dice «igual», «otra» o «misma», o si es una edición del mismo índice.
- **Prueba de regresión:** los casos S1.02a-e en `tests/chat-fiabilidad.test.ts` y como evaluación de dos turnos en `evals/`.

**BUG-007: Editar o quitar por índice no comprueba que el ítem sea el que nombra el mensaje**

- **Severidad:** P1.
- **Categoría:** Lógica (IA).
- **Estado:** Confirmado en el validador, con un modelo simulado.
- **Ubicación:** chat, `modificar_cotizacion` (`items` y `quitar`).
- **Archivo y líneas:** `src/servidor/chat.ts:714-749` (`aplicarModificacion`); `src/asistente/llm.ts:358-362` (`problemaSalida` solo cruza el modelo en `asignar_fabricas`).
- **Pasos:** con el borrador [Molco×5, CozCoz×3]:
  - «que las molco sean 4» → `items:[{indice:1, cambios:{cantidad:4}}]`;
  - «saca las coz coz» → `quitar:[0]`.
- **Esperado:** aviso o reintento, como hace la comprobación cruzada de `asignar_fabricas`.
- **Obtenido:** las Coz Coz quedan en 4, o se borra la Molco. Solo aparece «Se actualizó…» o «Se quitó…», sin aviso. Además, con dos Molco, `asignar_fabricas` acepta el índice equivocado (`chat.ts:203`).
- **Frecuencia:** 100 % con esa tool-call.
- **Evidencia:** `evidencia/ia/t01-adversarial.test.ts` (S1.19, S1.20), `t02-adversarial2.test.ts` (S1.28). S1.20 se volvió a correr en la consolidación.
- **Causa raíz:** confirmada.
- **Impacto:** se modifica o se elimina el producto equivocado.
- **Solución (media):** si la `fuente` o el mensaje nombran un modelo distinto del ítem de ese índice, avisar o reintentar. Para `quitar`, exigir que el modelo del ítem aparezca en el mensaje.
- **Prueba de regresión:** S1.19, S1.20 y S1.28.

**BUG-008: Un ítem que el asistente repite se suma en silencio y duplica el pedido**

- **Severidad:** P1.
- **Categoría:** Lógica (IA).
- **Estado:** Confirmado en el validador, con un modelo simulado.
- **Ubicación:** chat, `modificar_cotizacion.agregar`.
- **Archivo y líneas:** `src/servidor/chat.ts:750` (`items.push(...agregar)` sin deduplicar). El ítem repetido no recibe «No pude verificar» porque coincide con `previos`.
- **Pasos:**
  - «2 molco en lenga de 80x200» → `agregar:[molco, molco]`.
  - Variante: en el turno 2, «agrega también 3 coz coz…», y la IA vuelve a agregar la Molco del turno 1 con su `fuente` antigua.
- **Esperado:** aviso o descarte del ítem idéntico.
- **Obtenido:** el pedido queda duplicado y el total se dobla, con `avisos: []`.
- **Frecuencia:** 100 % con esa tool-call.
- **Evidencia:** `evidencia/ia/t01-adversarial.test.ts` (S1.09), `t02-adversarial2.test.ts` (S1.09b). S1.09 se volvió a correr en la consolidación.
- **Causa raíz:** confirmada.
- **Impacto:** cotización al doble del monto.
- **Solución (baja):** avisar o descartar un ítem nuevo idéntico a otro del mismo turno, o a uno ya presente con la misma `fuente`.
- **Prueba de regresión:** S1.09 y S1.09b.

**BUG-009: Texto inventado por el asistente (descripción, observaciones, datos del cliente) llega al PDF del cliente y a la nota de fábrica**

- **Severidad:** P1.
- **Categoría:** Lógica (IA) / PDF.
- **Estado:** Confirmado en el validador, con un modelo simulado.
- **Ubicación:** chat → documento.
- **Archivo y líneas:** `src/asistente/esquemas.ts:40-41` (`descripcion` y `observaciones` en cualquier ítem, sin verificación); `src/servidor/items-vigentes.ts:121` (`descripcionDocumento: s.descripcion`); `src/servidor/pdf.ts:269-272`; `src/servidor/chat.ts:754` (`cliente` se aplica sin anclaje).
- **Pasos:** «2 molco en lenga de 80x200», y la IA agrega `descripcion:'Molco lenga con vidrio templado y cerradura incluida'` y `observaciones:'Instalación incluida sin costo'`. En otra variante agrega `cliente:{nombre:'Pedro Soto', rut:'11.111.111-1'}` sin que el mensaje los mencione.
- **Esperado:** el texto no escrito por la persona no se acepta, o se avisa.
- **Obtenido:**
  - El HTML del PDF muestra «Molco lenga con vidrio templado…» en lugar del nombre del producto, y «Observación: Instalación incluida sin costo». La nota de pedido también.
  - El cliente queda sobrescrito.
  - `avisos: []`.
- **Frecuencia:** 100 % con esa tool-call.
- **Evidencia:** `evidencia/ia/t01-adversarial.test.ts` (S1.11, S1.15), `t06-documentos.test.ts` (S1.15b), `escenarios/S1.15-avisar.json`. S1.15 se volvió a correr en la consolidación.
- **Causa raíz:** confirmada.
- **Impacto:** compromisos comerciales que nadie dijo, por escrito y ante el cliente. Es también el blanco natural de una inyección de instrucciones (ver BUG-026).
- **Solución (media):** aceptar `descripcion` y `observaciones` solo si el texto aparece en el mensaje, o solo en ítems libres. Anclar o avisar cada cambio de los datos del cliente.
- **Prueba de regresión:** S1.15b. Se renderiza la plantilla y el texto inventado no aparece.

### P2 · Medio

**BUG-010: Cambiar el «Tipo» del descuento especial y salir del campo borra el descuento guardado**

- **Severidad:** P2.
- **Categoría:** Lógica / UI.
- **Estado:** Confirmado.
- **Ubicación:** detalle del ítem → «Descuento especial».
- **Archivo y líneas:** `src/app/descuento-item.tsx:82` (`textoGuardado` vacío si cambia el tipo), `:135` (`key={tipo}` vuelve a montar el input), `:145` (`onBlur={guardarEscrito}`) y `:113` (un texto vacío ejecuta `guardar(null)`).
- **Pasos:**
  1. Guardar un descuento «Monto por unidad» de $50.000.
  2. Elegir «Porcentaje (%)» en «Tipo».
  3. Hacer clic fuera del campo.
- **Esperado:** el descuento sigue guardado hasta que se escriba otro valor.
- **Obtenido:** el descuento desaparece. Solo aparece «Total actualizado: $…», y el chat dice «Se actualizó 2 × Molco…» sin mencionar el descuento.
- **Frecuencia:** 4/4.
- **Evidencia:** `evidencia/ui/07-descuento-duplicar.ts` (D5b), `17-emitir-con-campo-abierto.ts`; `capturas/ui/07-D5b-cambiar-tipo-salir.png`.
- **Causa raíz:** confirmada.
- **Impacto:** cambia el precio al cliente sin que la persona lo haya pedido.
- **Solución (baja):** un campo vacío tras cambiar de tipo no quita el descuento. Solo lo quitan «Quitar descuento» o escribir 0. El aviso debe nombrar el cambio.
- **Prueba de regresión:** con un descuento en monto, cambiar a % y salir del campo: el descuento sigue igual.

**BUG-011: Lo escrito sin guardar se pierde al emitir o al cambiar de pantalla, sin aviso**

- **Severidad:** P2.
- **Categoría:** UX / Persistencia.
- **Estado:** Confirmado.
- **Ubicación:** Cotizar (`CampoEditable`) y el diálogo «Emitir la cotización».
- **Archivo y líneas:** los borradores viven solo en el estado de cada `CampoEditable` (`src/app/campo-editable.tsx:87-88`). Cotizar no usa `useAvisoSalida`, que Ajustes y Catálogo sí usan (`src/app/secciones-pantalla.ts:31`).
- **Pasos:** escribir «Bisagras a la izquierda» en «Observación del producto» sin guardar, pulsar «Emitir y generar PDF» y confirmar.
- **Esperado:** advertir que hay campos sin guardar, o guardarlos antes de emitir.
- **Obtenido:** el diálogo no lo menciona y se emite con `observaciones=null`. El PDF no trae el texto. Ir a Historial con «Madera» a medio editar tampoco avisa.
- **Frecuencia:** emitir 2/2, navegar 1/1.
- **Evidencia:** `evidencia/ui/17-emitir-con-campo-abierto.ts`, `10-entradas-navegacion.ts`; `capturas/ui/17-dialogo-emitir-con-campo-abierto.png`, `17-emitida-sin-observacion.png`.
- **Causa raíz:** confirmada. El panel no sabe qué campos están abiertos.
- **Impacto:** se emite un documento sin una indicación que la vendedora cree haber escrito.
- **Solución (media):** registrar a nivel del panel los campos abiertos con cambios, para usarlo en el diálogo de emitir y aprobar y en `useAvisoSalida`.
- **Prueba de regresión:** con un campo abierto y modificado, el diálogo de emitir lo lista y la navegación pide confirmar.

**BUG-012: Tras reimportar el catálogo, cualquier edición recotiza en silencio con los precios nuevos y la emisión ya no pide confirmar**

- **Severidad:** P2.
- **Categoría:** Lógica.
- **Estado:** Confirmado.
- **Ubicación:** editar una cotización (detalle, chat, quitar o reordenar) después de una reimportación.
- **Archivo y líneas:** `src/servidor/servicio.ts:233-311` (`calcular`) y `:313-322` (`recalcular`) recotizan sin comparar con las líneas previas. `:549` (`diferenciasPrecio`) solo se usa al emitir, en `:1178`, y compara con montos que la edición ya actualizó. Contradice `README.md` («Si cambió algún precio… no se emite… queda registrado en su actividad»).
- **Pasos:**
  1. Emitir la N° 323 con 2 Molco a $155.000 (costo $100.000).
  2. Reimportar con la Molco a costo $110.000.
  3. Corregir solo el nombre del cliente en la N° 323.
  4. Emitir la revisión.
- **Esperado:** el aviso «El precio unitario de MOL-… cambió de $155.000 a $170.500» y su registro en la actividad.
- **Obtenido:** la revisión cobra $170.500 y el total pasa de $389.172 a $426.062 (+9,5 %). `avisos: []`. La actividad solo dice «Datos del cliente: nombre». Se emite como N° 324 sin aviso. En un borrador pasa lo mismo al editar la cantidad de otro ítem. El control sí funciona si no hubo una edición intermedia (409 `precios_cambiaron`).
- **Frecuencia:** 100 %.
- **Evidencia:** `evidencia/logica/a4-catalogo-cambiado.audit.ts`, `salida-a4.txt`, `registro.log` (`[R1]`, `[R2]`, `[R3]`).
- **Causa raíz:** confirmada.
- **Impacto:** el cliente recibe precios distintos en productos que nadie tocó, y no queda constancia del cambio.
- **Solución (media):** en `recalcular`, comparar con las líneas previas de las solicitudes no editadas, devolver avisos y registrar el cambio. Otra opción: guardar la versión del catálogo con que se cotizó y compararla al emitir.
- **Prueba de regresión:** emitida → reimportar → editar el cliente → aviso y evento en la actividad.

**BUG-013: La tarifa de Starken aplicada no se invalida cuando el pedido cambia después**

- **Severidad:** P2.
- **Categoría:** Lógica.
- **Estado:** Confirmado.
- **Ubicación:** flete con Starken.
- **Archivo y líneas:** `src/servidor/servicio.ts:1047-1067` (la huella se verifica solo al aplicar la tarifa); `src/servidor/edicion.ts:265-287` (`aplicarFlete` conserva el flete); `src/app/cotizar-starken.tsx:72`, `:182` y `:250` (el estado «aplicada» es solo local).
- **Pasos:**
  1. Cotización con 2 Molco y transporte Starken.
  2. Aplicar la tarifa de $101.150 (flete $85.000).
  3. Cambiar la cantidad a 20.
  4. Emitir.
- **Esperado:** un aviso de que el despacho se cotizó para otro pedido.
- **Obtenido:** el flete sigue en $85.000 aunque el bulto pasa de 68,7 kg a 686,2 kg. No hay avisos ni al editar ni al emitir.
- **Frecuencia:** 100 %.
- **Evidencia:** `evidencia/logica/a5-starken-aplicada.audit.ts`, `salida-a5.txt` (`[S3]`).
- **Causa raíz:** confirmada. No se guarda la huella del pedido junto con la tarifa aplicada.
- **Impacto:** se cobra el despacho de 2 puertas por un pedido de 20.
- **Solución (media):** guardar la huella con el despacho y avisar, o marcar el flete, cuando cambie.
- **Prueba de regresión:** el escenario S3.

**BUG-014: Pedido especial: un costo de fábrica mayor que el precio no avisa de la venta bajo el costo, y no tiene piso de ganancia**

- **Severidad:** P2.
- **Categoría:** Lógica.
- **Estado:** Confirmado.
- **Ubicación:** producto personalizado con «Costo de fábrica».
- **Archivo y líneas:** `src/servidor/servicio.ts:248-258` (la condición que omite el aviso compara el precio y el modelo, no el costo); `src/servidor/items-vigentes.ts:129-135` y `:150-159` (el rango se valida contra `precioNeto`, que en un especial es el mismo precio escrito); `src/negocio/personalizados.ts:133`.
- **Pasos:**
  1. Agregar el especial «Puerta doble» a $450.000.
  2. Escribir un costo de fábrica de $500.000 → `avisos: []` y nada en la actividad.
  3. Recién al bajar el precio a $449.000 aparece «queda bajo el costo de fábrica ($500.000)».
  - Variantes: con un costo de $100.000.000, el especial queda valorizado a −99,5 % sin pendiente; subir el costo de $460.000 a $900.000 tampoco avisa.
- **Esperado:** según `docs/reglas-negocio.md` («se vuelve a avisar solo si cambia ese precio o ese costo»), avisar al cambiar el costo.
- **Frecuencia:** 100 % en el flujo habitual: el costo se escribe después de agregar el especial.
- **Evidencia:** `evidencia/logica/a3-especiales-starken.audit.ts` (G1b, G1c), `a2-documentos.audit.ts` (G1), `registro.log`.
- **Causa raíz:** confirmada. La línea guardada no conserva el costo anterior para compararlo.
- **Impacto:** venta con pérdida sin aviso ni registro.
- **Solución (baja-media):** guardar `costoFabrica` en la línea y, si hay costo, aplicar `precioEnRango(precio, costoFabrica)`.
- **Prueba de regresión:** G1b y G1c.

**BUG-015: En la cotización PDF, las filas con descuento especial pegan la cantidad, los precios y los totales**

- **Severidad:** P2.
- **Categoría:** PDF.
- **Estado:** Confirmado.
- **Ubicación:** tabla de productos de la cotización.
- **Archivo y líneas:** `src/servidor/pdf.ts:279-280` (`conOriginal`: tachado y final en la misma línea) y `:417` (`.unit` de 27 mm, `.tot` de 29 mm, `white-space:nowrap`).
- **Pasos:** una puerta de $182.688 × 3 con 12,35 % de descuento → emitir.
- **Esperado:** cada cifra separada y legible.
- **Obtenido:** se lee «3$182.688 $160.126 $548.064 $480.378». Medido con pdfjs, los fragmentos se tocan (0,0 pt de separación) y el total llega al borde.
- **Frecuencia:** toda línea con descuento y un unitario de 6 dígitos o más, que es el precio normal de una puerta.
- **Evidencia:** `capturas/pdf/b2-p1.png` (revisada en la consolidación), `d7-p1.png`, `b3a-p1.png`; `evidencia/pdf/b-cotizaciones.ts`, `d-geometria.ts`.
- **Causa raíz:** confirmada. Columnas angostas con dos cifras por celda.
- **Impacto:** el cliente puede leer mal la cantidad o el precio en el documento comercial.
- **Solución (baja):** poner el precio original tachado en su propia línea, encima del rebajado, o ensanchar las columnas. Solo afecta a la cotización, que el lector de la fábrica no usa.
- **Prueba de regresión:** al menos 1,5 pt de separación entre los fragmentos de cada fila con descuento.

**BUG-016: La copia «ANULADA» y la reimpresión al cambiar el número se arman con los datos vigentes, no con lo emitido**

- **Severidad:** P2.
- **Categoría:** PDF.
- **Estado:** Confirmado.
- **Ubicación:** descarga de una cotización o nota anulada; acción «Cambiar N°».
- **Archivo y líneas:** `src/servidor/documentos.ts:49-60` (`plantilla(q, …)` en vez de `documentos_snapshot`); `src/servidor/pdf.ts:304` (`descripcionFlete(q)` lee el `q.despacho` vigente); `src/servidor/servicio.ts:1987` y `:1996` (`plantilla(renumerada, …)`). El despacho cambia después de emitir en `servicio.ts:1324`, `:1509` y `:1557`.
- **Pasos:**
  1. Emitir con flete «Temuco · Starken».
  2. Aprobar cambiando el despacho a «Osorno · Chilexpress».
  3. Anular y descargar; o, en vez de anular, cambiar el teléfono de la empresa en Ajustes y renumerar de 323 a 900.
- **Esperado:** el documento emitido, con la marca ANULADA o con el número nuevo.
- **Obtenido:**
  - La línea de flete pasa a «Osorno · Chilexpress».
  - Cambian el teléfono del pie y de «Para aceptar».
  - Aparece una condición nueva («Datos para transferencia: Banco Nuevo…»).
  - La fecha y la vigencia siguen siendo las originales. Los montos no cambian.
- **Frecuencia:** cada vez que el despacho o los Ajustes cambian entre la emisión y la copia.
- **Evidencia:** `evidencia/pdf/runs/c2/cot-original.txt` contra `cot-anulada.txt`; `runs/c3/cot-antes.txt` contra `cot-900.txt`; `capturas/pdf/c2-cotizacion-anulada-p1.png`, `c3-cot-900-p1.png`.
- **Causa raíz:** confirmada. «Regenerar» sí respeta el snapshot (`tests/pdf-texto.test.ts`), pero estas dos rutas no lo usan.
- **Impacto:** el mismo número de documento circula con dos contenidos distintos.
- **Solución (media):** partir del HTML del snapshot y cambiar solo el número o agregar la marca, o congelar al emitir los datos que se imprimen.
- **Prueba de regresión:** cambiar el despacho y los Ajustes después de emitir. El texto de la copia anulada o renumerada debe ser igual al emitido, salvo la marca o el número.

**BUG-017: «Aprobada por» de la nota de pedido muestra a quien la generó, no a quien aprobó; sus copias muestran a otra persona**

- **Severidad:** P2.
- **Categoría:** PDF.
- **Estado:** Confirmado.
- **Ubicación:** nota de pedido.
- **Archivo y líneas:** `src/servidor/servicio.ts:1796` (`autor: this.autor` al generar); `src/servidor/documentos.ts:37` (`autor: q.aprobadaPor` en las copias); `src/servidor/pdf.ts:206`.
- **Pasos:** Carla aprueba; Paula registra el anticipo y genera las notas.
- **Esperado:** «Aprobada por Carla», como muestra el panel (`formato.ts:201`) y como pretende `tests/pdf.test.ts:704-707`.
- **Obtenido:** las notas originales dicen «Aprobada por Paula Soto». La copia anulada y la renumerada dicen «Carla Aprobadora».
- **Frecuencia:** siempre que dos personas distintas aprueban y generan la nota.
- **Evidencia:** `evidencia/pdf/c-notas.ts` (C1 a C3); `runs/c2/nota-panguipulli-original.txt` contra `nota-panguipulli-anulada.txt`; `capturas/pdf/c1-nota-panguipulli-p1.png`, `c2-nota-panguipulli-anulada-p1.png`.
- **Causa raíz:** confirmada. El mismo campo sale de dos fuentes distintas.
- **Impacto:** un dato de autoría incorrecto en el documento que va a la fábrica.
- **Solución (baja):** usar `copia.aprobadaPor` en `servicio.ts:1796`.
- **Prueba de regresión:** aprobar con A y generar con B: la nota y su copia anulada dicen A.

**BUG-018: Un texto largo sin espacios (una URL, un código) achica la hoja y, en el extremo, saca del PDF las columnas Cant., Precio y Total**

- **Severidad:** P2.
- **Categoría:** PDF.
- **Estado:** Confirmado.
- **Ubicación:** cotización: descripción, observaciones, dirección y giro.
- **Archivo y líneas:** `src/servidor/pdf.ts:414` (tabla sin `table-layout:fixed`); `:411-413`, `:418`, `:438` y `:445` (sin `overflow-wrap:anywhere`).
- **Pasos:** emitir con una URL de 155 caracteres en las observaciones generales, o con una descripción de 80 a 300 caracteres sin espacios.
- **Obtenido:**

  | Texto sin espacios | Resultado |
  |---|---|
  | 80 caracteres en la descripción | la página se reduce (el encabezado pasa a 6,5 pt) y el Total queda recortado |
  | URL de 155 caracteres en las observaciones | toda la cotización al 76 % |
  | URL de 120 caracteres en la dirección | al 69 % |
  | 300 caracteres en la descripción | Cant., Precio y Total salen de la hoja |
  | 300 caracteres en el giro | desaparece el bloque «Obra» |

  El escape de HTML funciona: `<script>`, `&`, emoji y RTL se imprimen literales.
- **Frecuencia:** el caso extremo es poco frecuente; una URL pegada en observaciones o en la dirección es realista.
- **Evidencia:** `evidencia/pdf/d-geometria.ts` (D2, D3, D6), `b-cotizaciones.ts` (B6); `capturas/pdf/d6-80-p1.png`, `d2-p1.png`, `b6-p1.png`.
- **Causa raíz:** confirmada.
- **Impacto:** una cotización ilegible, o sin precios por línea.
- **Solución (baja):** `table-layout:fixed`, `overflow-wrap:anywhere` y `min-width:0` en esas celdas. En la nota hay que avisar a la fábrica, porque toca las anclas del estándar (§8).
- **Prueba de regresión:** con una descripción de 300 caracteres y una URL en las observaciones, el encabezado mide 7,3 pt y cada fila trae su cantidad y sus dos montos.

**BUG-019: Una anulación puede quedar retenida hasta 6 h detrás de una revisión obsoleta**

- **Severidad:** P2.
- **Categoría:** Integración.
- **Estado:** Confirmado.
- **Ubicación:** bandeja de envíos.
- **Archivo y líneas:** `src/servidor/integracion-bandeja.ts:77-81` (al encolar no se reemplaza la revisión en curso) y `:133-138` (`NOT EXISTS` bloquea la revisión nueva); `src/servidor/integracion-envio.ts:233` y `:259-263` (`reemplazarSiHayNueva` solo se evalúa al tomar el envío).
- **Pasos:**
  1. Se genera la nota y el POST queda en vuelo.
  2. Se anula la cotización.
  3. El intento en vuelo termina con 503 y `Retry-After: 21600`.
  4. La fábrica vuelve a responder bien.
- **Esperado:** `order.cancelled` sale en la pasada siguiente.
- **Obtenido:** a los 1, 5, 30, 60 y 300 min sigue pendiente. Recién a los 365 min queda entregada.
- **Frecuencia:** determinista con esa secuencia.
- **Evidencia:** `evidencia/fabrica/s10-anulacion-retenida.mts` y `.log`.
- **Causa raíz:** confirmada.
- **Impacto:** la fábrica puede seguir produciendo durante horas un pedido ya anulado.
- **Solución (baja):** si falla un `order.ready` y ya existe una revisión mayor, marcarlo «reemplazado» en vez de reprogramarlo.
- **Prueba de regresión:** repetir la secuencia y verificar que la anulación queda entregada en la pasada de +1 min.

**BUG-020: Restaurar un respaldo hace retroceder la bandeja: se reutilizan claves de idempotencia y números de nota**

- **Severidad:** P2.
- **Categoría:** Integración / Persistencia.
- **Estado:** Confirmado.
- **Ubicación:** `npm run restaurar`.
- **Archivo y líneas:** `scripts/lib/restauracion.ts:166-196` restaura `integracion_envios`. `src/servidor/integracion-bandeja.ts:71-73` y `:111` calculan la revisión y la clave `…:{id}:PANGUIPULLI:{rev}` desde la bandeja.
- **Pasos:**
  1. Se respalda.
  2. Se entrega la nota 577 de X.
  3. Se restaura el respaldo.
  4. X vuelve a generar su nota.
- **Esperado:** la fábrica recibe la versión vigente, sin duplicar números.
- **Obtenido:** X recibe la nota 578 con la misma clave rev 1, y la fábrica responde 409 `idempotency_conflict`: queda `fallido` sin reintento. La fábrica conserva X como 577, un número que la tienda ahora asigna a otra cotización (ver también BUG-003, camino B).
- **Frecuencia:** determinista después de restaurar con envíos posteriores al respaldo.
- **Evidencia:** `evidencia/fabrica/s08-restaurar.mts` y `.log`.
- **Causa raíz:** confirmada. El estado de la integración viaja con el respaldo; el de la fábrica no.
- **Impacto:** dos pedidos distintos con el N.º 577 en la fábrica.
- **Solución (media):** no retroceder la bandeja ni los correlativos ya enviados (agregar una «época» a `eventId` y a las claves), y advertir en `npm run restaurar` que hay que conciliar con la fábrica.
- **Prueba de regresión:** una prueba de `restaurarRespaldo` con envíos posteriores al respaldo.

**BUG-021: Si se renumera mientras la integración está mal configurada, la revisión nunca llega a la fábrica (la anulación sí)**

- **Severidad:** P2.
- **Categoría:** Integración.
- **Estado:** Confirmado.
- **Ubicación:** `cambiar_numero` de una nota ya enviada.
- **Archivo y líneas:** `src/servidor/servicio.ts:1868` (`prepararEnvios` omite la nota si `!configuracionFabrica(...)`), llamado desde `:2008-2015`. En cambio, `anularInterna` (`:788-789`) encola sin mirar la configuración.
- **Pasos:**
  1. Entregar la nota 577.
  2. Dejar el secreto inválido, por ejemplo durante una rotación.
  3. Renumerar a 586 y anular.
  4. Restaurar el secreto.
- **Esperado:** la fábrica recibe la revisión con el N.º 586 y después la anulación.
- **Obtenido:** recibe `order.ready#1 N°577` y `order.cancelled#2 N°586`. La revisión con el N.º 586 nunca sale.
- **Frecuencia:** determinista con esa secuencia.
- **Evidencia:** `evidencia/fabrica/s04-limites.log` (F22).
- **Causa raíz:** confirmada. La configuración se exige al encolar, cuando debería exigirse solo al enviar.
- **Impacto:** la tienda y la fábrica quedan con números distintos para el mismo pedido.
- **Solución (baja):** encolar sin exigir la configuración las revisiones de pedidos que ya están en la bandeja.
- **Prueba de regresión:** F22.

**BUG-022: La suite E2E arranca con la integración de `.env.local` activa y podría enviar pedidos de prueba a `localhost:3000`**

- **Severidad:** P2.
- **Categoría:** Integración / Otra (entorno de pruebas).
- **Estado:** Riesgo técnico. El entorno se confirmó; el envío no se ejecutó.
- **Ubicación:** `playwright.config.ts`.
- **Archivo y líneas:** `playwright.config.ts:61-81` (`webServer.env` no anula `NELTUME_FABRICA_*`); `.env.local` apunta a `http://localhost:3000` con un secreto real; `next dev` carga `.env.local` y `NELTUME_TEST_MODE=1` no apaga la integración. Las E2E de flujo, aceptación, reparto y operación generan notas de Panguipulli.
- **Pasos:** reproducir el entorno de Playwright (`{...process.env, ...webServer.env}`) y cargar `.env.local` con el cargador de Next.
- **Esperado:** integración desactivada durante las pruebas.
- **Obtenido:** `integracionConfigurada() = true`, con la URL `http://localhost:3000`.
- **Frecuencia:** cada corrida de `npm run test:e2e`, incluida la del deploy.
- **Evidencia:** `evidencia/fabrica/s06-e2e-env.mts` y `.log`; con las variables vacías, `s06b-e2e-env-vacio.log` da `false`. Esta auditoría corrió la E2E con esas variables vacías, así que no envió nada.
- **Causa raíz:** confirmada.
- **Impacto:** con la fábrica en desarrollo en el puerto 3000, cada corrida le mete pedidos «577» ficticios. Si `.env.local` llegara a apuntar a la fábrica real, como en el cruce del 25 de octubre, serían pedidos falsos en producción.
- **Solución (baja):** agregar `NELTUME_FABRICA_PANGUIPULLI_URL: ''` y `NELTUME_FABRICA_PANGUIPULLI_SECRETO: ''` a `webServer.env`. Se verificó que Next no pisa una variable vacía.
- **Prueba de regresión:** una prueba que cargue `playwright.config.ts` y compruebe que `webServer.env` anula esas variables.

**BUG-023: Ajustes no tiene control de versión: si dos personas guardan, la última pisa los cambios de la otra**

- **Severidad:** P2.
- **Categoría:** Persistencia.
- **Estado:** Confirmado en configuración comercial; probable en configuración de catálogo, IA y Starken.
- **Ubicación:** Ajustes → Precios y descuentos, Cotizaciones, Empresa.
- **Archivo y líneas:** `src/app/api/configuracion-negocio/route.ts:27-47`; `src/servidor/configuracion-negocio.ts:158-168` (reemplazo completo, `ON CONFLICT … DO UPDATE`). La misma forma está en `src/app/api/catalogo-configuracion/route.ts:32-46`.
- **Pasos:**
  1. Dos administradoras abren Ajustes.
  2. Ana guarda IVA 20 % y vigencia 15.
  3. Bea, desde la pantalla que abrió antes, agrega un transportista.
- **Esperado:** 409, o se conservan los dos cambios.
- **Obtenido:** 200 y 200. El IVA vuelve a 0,19 y la vigencia a 10.
- **Frecuencia:** 1/1 por HTTP.
- **Evidencia:** `evidencia/persistencia/http-carreras.mjs` → `salida-http-carreras.txt`; `acceso.test.ts` (S1).
- **Causa raíz:** confirmada. El POST manda el documento completo, sin versión.
- **Impacto:** reglas comerciales que vuelven solas a valores viejos. Las cotizaciones nuevas congelan esas reglas.
- **Solución (baja-media):** devolver `actualizada` en el GET y exigirla en el POST, o guardar por sección.
- **Prueba de regresión:** dos guardados con la misma versión dan uno 200 y otro 409.

**BUG-024: «Cambiar N°» puede tomar el número que una emisión en curso ya reservó**

- **Severidad:** P2.
- **Categoría:** Persistencia.
- **Estado:** Confirmado con un intercalado controlado (PDF demorado).
- **Ubicación:** `cambiar_numero` durante otra emisión.
- **Archivo y líneas:** `src/servidor/almacen.ts:1131-1140` (`validarNumeroCotizacion` mira solo números confirmados) y `:903`; `src/servidor/servicio.ts:1962-2061` (no consulta `emisiones_en_curso`), `:1264` y `:1296`; `src/servidor/pdf.ts:805`.
- **Pasos:** B emite y su número 324 queda reservado mientras se genera el PDF. Mientras tanto, se cambia la N° 323 a la 324.
- **Esperado:** `numero_usado` para el cambio; B se emite como 324.
- **Obtenido:**
  - Una variante: el cambio se queda con la 324 y B responde 503, porque su PDF ya existe.
  - Otra variante: B confirma después y responde 500 `error_interno` (UNIQUE de `cotizaciones.numero`).
  - En las dos, B queda en borrador y se pierde un número. No hay números duplicados.
- **Frecuencia:** 1/1 en cada variante, dentro de la ventana de 1 a 3 s del PDF.
- **Evidencia:** `evidencia/persistencia/concurrencia.test.ts` (N1, N2) → `salida-concurrencia.txt`.
- **Causa raíz:** confirmada. Un número reservado no se distingue de uno saltado y libre.
- **Impacto:** la emisión falla con un mensaje engañoso y queda un salto en la numeración.
- **Solución (media):** guardar el número en `emisiones_en_curso` y rechazarlo en `validarNumero*`; convertir el error UNIQUE en `ErrorConflicto`.
- **Prueba de regresión:** N1 y N2.

**BUG-025: Una revisión restaurada desde la papelera puede quedar vinculada a otra cotización después de renumerar**

- **Severidad:** P2.
- **Categoría:** Persistencia.
- **Estado:** Confirmado.
- **Ubicación:** papelera → restaurar.
- **Archivo y líneas:** `src/servidor/almacen.ts:1243` (la papelera guarda `origen` como número), `:1181-1196` (`renumerarReferencias` no actualiza la papelera); `src/servidor/servicio.ts:597-601` (`porNumero(origen)`).
- **Pasos:**
  1. Abrir la revisión R de O (N° 323) y eliminarla.
  2. Renumerar O a 400 y P (N° 324) a 323.
  3. Restaurar R y emitirla.
- **Esperado:** R vuelve como revisión de O.
- **Obtenido:** R queda vinculada a P, sin aviso. Al emitirla, P pasa a «reemplazada» y O sigue emitida.
- **Frecuencia:** 1/1. El escenario es raro.
- **Evidencia:** `evidencia/persistencia/papelera-numero.test.ts` → `salida-papelera-numero.txt`.
- **Causa raíz:** confirmada.
- **Impacto:** se reemplaza una cotización ajena.
- **Solución (baja):** guardar `origen_id` en la papelera y resolver por id.
- **Prueba de regresión:** el escenario R1.

**BUG-026: El asistente puede ejecutar operaciones destructivas que el mensaje no pide (quitar, borrar el flete, reemplazar la lista, quitar la fábrica)**

- **Severidad:** P2.
- **Categoría:** Lógica (IA).
- **Estado:** Confirmado en el validador, con un modelo simulado.
- **Ubicación:** chat.
- **Archivo y líneas:** `src/servidor/chat.ts:745-749` (quitar), `:968-986` (todavía se acepta `actualizar_cotizacion`, que reemplaza la lista completa) y `:939` (`fabrica === null` sin comprobar el mensaje); `src/asistente/flete.ts:24` (`flete:null`).
- **Pasos:**
  - «agrega 3 coz coz…» respondido con `quitar:[0]`;
  - `flete:null` sin que el mensaje hable del flete;
  - `actualizar_cotizacion` con un solo ítem;
  - `asignar_fabricas` con `fabrica:null`;
  - una instrucción inyectada en el nombre del cliente o en las observaciones, que viaja en el contexto del modelo.
- **Esperado:** se exige respaldo en el mensaje, o se avisa.
- **Obtenido:** se aplican todas, sin aviso. Del flete solo queda la línea «Flete … $0».
- **Frecuencia:** 100 % con esas tool-calls.
- **Evidencia:** `evidencia/ia/t01-adversarial.test.ts` (S1.10, S1.12, S1.13, S1.18), `t04-malformadas-concurrencia.test.ts` (S5.02).
- **Causa raíz:** confirmada.
- **Impacto:** ítems, flete o fábricas que desaparecen de la cotización.
- **Solución (baja-media):** exigir en el mensaje un verbo de quitar junto al modelo o al flete; dejar de aceptar `actualizar_cotizacion` desde la IA; anclar el `null` de la fábrica.
- **Prueba de regresión:** S1.10, S1.12, S1.13 y S1.18.

**BUG-027: La fábrica se asigna si «Santiago» o «Pangui» aparecen en cualquier turno, aunque sea la comuna o el modelo**

- **Severidad:** P2.
- **Categoría:** Lógica (IA) / Integración.
- **Estado:** Confirmado en el validador, con un modelo simulado.
- **Ubicación:** chat, `fabrica` de un ítem.
- **Archivo y líneas:** `src/servidor/chat.ts:150-155` (`fabricaEscrita` busca la palabra suelta en todo el historial) y `:930`. El prompt (`llm.ts:168`) prohíbe justamente deducir la fábrica.
- **Pasos:** «…, cliente de Santiago» con `fabrica:'santiago'`; «3 panguipulli en lenga…» (el modelo) con `fabrica:'panguipulli'`; la comuna dicha en un turno anterior.
- **Esperado:** la fábrica solo se asigna si se nombra como fábrica («fábrica de …», «van a …»).
- **Obtenido:** la fábrica queda asignada, sin aviso.
- **Frecuencia:** 100 % con esa tool-call.
- **Evidencia:** `evidencia/ia/t01-adversarial.test.ts` (S1.14, S1.14b, S1.14c).
- **Causa raíz:** confirmada.
- **Impacto:** la nota de pedido va a la fábrica equivocada. Contradice la regla «la IA no la deduce» (`docs/reglas-negocio.md`).
- **Solución (baja):** usar el patrón `FABRICA_DICHA` sobre la frase del ítem o el mensaje actual.
- **Prueba de regresión:** S1.14, S1.14b y S1.14c.

**BUG-028: No se comprueba si el precio o el flete se dijeron netos o con IVA: el modelo puede invertirlo**

- **Severidad:** P2.
- **Categoría:** Lógica (IA).
- **Estado:** Confirmado en el validador, con un modelo simulado.
- **Ubicación:** chat: precio de un ítem y flete.
- **Archivo y líneas:** `src/servidor/chat.ts:503`; `src/asistente/flete.ts:39-45`. Solo se avisa cuando `iva` es null.
- **Pasos:**
  - «a $600.000 + iva» respondido con `iva:'incluido'`;
  - «iva incluido» respondido con `iva:'neto'`;
  - un flete «$380.000 + iva» respondido con `incluido`.
- **Esperado:** aviso o corrección cuando el texto contradice al modelo.
- **Obtenido:**
  - El primer precio queda en $504.202 neto.
  - El segundo queda en $600.000 neto (19 % más), con el aviso tranquilizador «Usé el precio que indicaste…».
  - El flete queda en $319.328, sin aviso.
- **Frecuencia:** 100 % con esa tool-call.
- **Evidencia:** `evidencia/ia/t01-adversarial.test.ts` (S1.06), `t02-adversarial2.test.ts` (S1.06b, S1.06c).
- **Causa raíz:** confirmada.
- **Impacto:** un 19 % de diferencia en el precio o en el flete.
- **Solución (baja):** detectar «+ iva», «neto», «iva incluido» y «con iva» en la línea, y comparar con lo que dijo el modelo.
- **Prueba de regresión:** S1.06, S1.06b y S1.06c.

**BUG-029: Cualquier número de la línea o de la conversación sirve para respaldar un precio**

- **Severidad:** P2.
- **Categoría:** Lógica (IA).
- **Estado:** Confirmado en el validador, con un modelo simulado.
- **Ubicación:** chat, `precioUnitario`.
- **Archivo y líneas:** `src/asistente/montos.ts:15-16` y `:148-159` (`MONTO` toma cifras sueltas); `src/servidor/chat.ts:488-489` (se valida contra la línea entera o contra toda la conversación). Su propio docstring (`:449-451`) dice «debe estar en la frase del propio ítem».
- **Pasos y resultados:**
  - Los $300.000 de la Molco se aplican a la Coz Coz de la misma línea.
  - El flete de un turno anterior queda como precio de un producto.
  - El «2» de la cantidad queda como precio de $2.
  - «90x210» da un ítem libre de $210; «Los Aromos 4500», $4.500; «depto 450000», la Molco a $450.000.
- **Esperado:** el precio se exige dentro de la frase del ítem, junto a un marcador de monto.
- **Obtenido:** se acepta con el aviso «Usé el precio que indicaste…».
- **Frecuencia:** 100 % con esa tool-call.
- **Evidencia:** `evidencia/ia/t01-adversarial.test.ts` (S1.04, S1.05, S1.17), `t02-adversarial2.test.ts` (S1.25).
- **Causa raíz:** confirmada.
- **Impacto:** un precio absurdo o ajeno, con un aviso que suena a confirmación.
- **Solución (media):** exigir la cifra en la frase del ítem, junto a «$», «mil», «lucas», «a», «por» o «precio», y excluir las cifras de cantidad y de medidas.
- **Prueba de regresión:** S1.04, S1.05, S1.17 y S1.25.

**BUG-030: El filtro que impide al asistente decir montos en el chat deja pasar «450 mil», «450 lucas» o «Precio: 450.000»**

- **Severidad:** P2.
- **Categoría:** Lógica (IA).
- **Estado:** Confirmado.
- **Ubicación:** respuesta de texto del chat (`responder`).
- **Archivo y líneas:** `src/servidor/chat.ts:132-133` y `:1013`. La intención está en `tests/servicio.test.ts:620-632`.
- **Pasos:** el modelo responde «sale 450 mil más IVA», «Precio: 450.000 + IVA», «cuatrocientos cincuenta mil pesos» o «rebaja de 20 mil».
- **Esperado:** se filtran, como los montos con «$».
- **Obtenido:** llegan tal cual a la persona. El HTML se muestra como texto plano y no se interpreta (esa parte pasa).
- **Frecuencia:** 100 % con esa salida.
- **Evidencia:** `evidencia/ia/t04-malformadas-concurrencia.test.ts` (S5.01).
- **Causa raíz:** confirmada.
- **Impacto:** un precio que dice el chat y que no coincide con el del panel. La vendedora puede repetírselo al cliente.
- **Solución (baja):** reutilizar `montosDelTexto` y `porcentajesDelTexto`.
- **Prueba de regresión:** S5.01.

**BUG-031: Un ítem libre acepta nombres que se parecen a un modelo del catálogo, y esa puerta no va a la nota de pedido**

- **Severidad:** P2.
- **Categoría:** Lógica (IA).
- **Estado:** Confirmado.
- **Ubicación:** chat, `libre:true`.
- **Archivo y líneas:** el comentario de `src/servidor/chat.ts:441` dice «ni se parece a», pero `:445` acepta `modelo_posible`.
- **Pasos:** `libre:true` con «molko», «Molco lenga», «Puerta Molco» y «Neltume enchapada».
- **Esperado:** se rechaza como ítem libre, como ya pasa con MOLCO, Mólco, MOLCOS y Coz-Coz.
- **Obtenido:** quedan como ítems libres («no va a fábrica»). Hay un aviso visible.
- **Frecuencia:** 100 % con esos nombres.
- **Evidencia:** `evidencia/ia/t02-adversarial2.test.ts` (S1.23).
- **Causa raíz:** confirmada.
- **Impacto:** una puerta cobrada que nunca se pide a la fábrica.
- **Solución (baja):** excluir `modelo_posible` y los nombres que contienen un modelo resuelto.
- **Prueba de regresión:** S1.23.

**BUG-032: Las autocorrecciones del tipo «3 molco…, no, mejor 4» se resuelven mal**

- **Severidad:** P2.
- **Categoría:** Lógica (IA).
- **Estado:** Confirmado.
- **Ubicación:** anclaje de cantidades.
- **Archivo y líneas:** `src/asistente/anclaje.ts:756-766` (manda la cantidad escrita justo antes del modelo).
- **Pasos:** «3 molco de 80x200, no, mejor 4».
- **Esperado:** se cotizan 4, o se avisa de la contradicción.
- **Obtenido:**
  - En «corregir», el modelo lee 4 y el servidor lo cambia a 3, con un aviso.
  - En «avisar» (el modo de producción), leer 4 da una falsa alarma y leer 3 pasa en silencio.
- **Frecuencia:** 100 % con ese mensaje.
- **Evidencia:** `evidencia/ia/t03-mensajes.test.ts` (S2.02).
- **Causa raíz:** confirmada.
- **Impacto:** una cantidad incorrecta, o un aviso que confunde.
- **Solución (media):** detectar «no, mejor», «perdón» y «digo», y avisar en vez de corregir.
- **Prueba de regresión:** S2.02.

**BUG-033: El foco del teclado se pierde después de agregar el primer producto, emitir, aprobar y registrar un pago**

- **Severidad:** P2.
- **Categoría:** UI (accesibilidad, WCAG 2.4.3).
- **Estado:** Confirmado.
- **Ubicación:** Cotizar.
- **Archivo y líneas:** `src/app/dialogo.tsx:50` (devuelve el foco a `previo` solo si sigue en el DOM); el disparador `cotizacion-panel.tsx:445` se desmonta.
- **Pasos:** emitir con el teclado y mirar `document.activeElement`.
- **Esperado:** el foco va al título de la cotización o a la acción siguiente, como ya pasa al abrir una cotización desde Historial (`tests/flujo.e2e.ts:135`).
- **Obtenido:** `document.activeElement === body`. Hay que volver a recorrer la cabecera, unas 30 tabulaciones.
- **Frecuencia:** 2/2.
- **Evidencia:** `evidencia/ui/19-aviso-foco-404.ts`, `18-teclado-pendientes.ts`; `capturas/ui/18-teclado-emitida.png`.
- **Causa raíz:** confirmada.
- **Impacto:** el flujo es muy lento con teclado y desorienta a quien usa un lector de pantalla.
- **Solución (baja):** después de crear, emitir, aprobar y pagar, llevar el foco al h2 del panel.
- **Prueba de regresión:** después de cada una de esas acciones, `activeElement` no es `body`.

### P3 · Bajo

**BUG-034: El precio con margen redondea el medio peso hacia abajo por coma flotante**

- **Severidad:** P3.
- **Categoría:** Lógica.
- **Estado:** Confirmado.
- **Ubicación:** margen especial de la cotización o de la línea.
- **Archivo y líneas:** `src/negocio/precios.ts:233` y `src/servidor/items-vigentes.ts:132`. El mismo defecto ya se corrigió para el descuento (`precios.ts:262-263`).
- **Pasos:** costo $10.990 con margen 15 %.
- **Esperado:** round(12.638,5) = $12.639, la regla de `precios.ts:7`.
- **Obtenido:** $12.638, porque `10990*1.15` da 12.638,4999… (verificado en la consolidación). Pasa en el 0,68 % de las combinaciones de costo y margen manual (márgenes de 13, 15, 17, 41, 57–63 %…). Los márgenes por categoría y el IVA no están afectados.
- **Frecuencia:** 0,68 % con un margen manual.
- **Evidencia:** `evidencia/logica/redondeo2.ts`, `salida-redondeo2.txt`, `salida-redondeo-iva.txt`.
- **Causa raíz:** confirmada.
- **Impacto:** $1 menos por unidad y una diferencia con la planilla.
- **Solución (baja):** `Math.round(precioNeto * Math.round((1 + m) * 10000) / 10000)` en los dos lugares.
- **Prueba de regresión:** 10.990 × 15 % = 12.639 y 1.050 × −33 % = 704.

**BUG-035: «$350.00» vale $350 en los formularios y $350.000 en el chat**

- **Severidad:** P3.
- **Categoría:** Lógica.
- **Estado:** Confirmado.
- **Ubicación:** formularios de precio.
- **Archivo y líneas:** `src/negocio/cifras.ts:17-21` y `:27-30` (`leerPesos`), contra `src/asistente/montos.ts:16-20`.
- **Pasos:** escribir «350.00» como precio de un ítem libre.
- **Esperado:** la misma lectura que en el chat, o un rechazo por ambiguo.
- **Obtenido:** se acepta $350, sin el aviso de monto bajo.
- **Frecuencia:** siempre.
- **Evidencia:** `evidencia/logica/salida-lectura-cifras.txt`, `salida-lectura-chat.txt`.
- **Causa raíz:** confirmada.
- **Impacto:** un ítem libre o un especial a $350, porque no tiene rango que lo frene.
- **Solución (baja):** leer `^\d{1,3}(\.\d{3})*\.0{1,2}$` igual que el chat.
- **Prueba de regresión:** «350.00» da la misma cifra en los dos lectores.

**BUG-036: Agregar o cambiar un ítem libre invalida la tarifa de Starken aunque el bulto no cambie**

- **Severidad:** P3.
- **Categoría:** Lógica.
- **Estado:** Mejora.
- **Archivo y líneas:** `src/negocio/starken.ts:360-382` (la huella incluye las líneas OTRO, que el bulto excluye en `:155`).
- **Pasos:** cotizar Starken y luego agregar «Instalación».
- **Obtenido:** «El pedido cambió. Vuelve a cotizar el despacho», con el mismo bulto.
- **Evidencia:** `evidencia/logica/a3-especiales-starken.audit.ts` (S2).
- **Causa raíz:** confirmada. `tests/starken.test.ts:749` deja como intencional que la huella cambie con el pedido.
- **Impacto:** un paso extra para la vendedora.
- **Solución (baja):** excluir OTRO de la huella.
- **Prueba de regresión:** S2.

**BUG-037: El costo de fábrica de un especial no se puede completar sin abrir una revisión, ni después de aprobar**

- **Severidad:** P3.
- **Categoría:** UX.
- **Estado:** Problema de UX.
- **Archivo y líneas:** `src/servidor/edicion.ts:172-179`, `src/servidor/servicio.ts:345-351` y `:455-492`. En cambio, `asignarFabricas` (`:1883`) no abre revisión.
- **Obtenido:**
  - En una emitida, escribir el costo, que es un dato interno, abre una revisión.
  - En una aprobada responde «no se puede editar», y la nota sale con «Por definir» y $0 en ese especial.
- **Evidencia:** `evidencia/logica/a6-costo-especial.audit.ts`, `salida-a6.txt`.
- **Impacto:** la nota de pedido llega a la fábrica sin el costo del especial.
- **Solución (media):** una acción sin revisión, como la de las fábricas, disponible hasta generar las notas.
- **Prueba de regresión:** G3.

**BUG-038: Con descuento general y flete, el «−» del descuento queda en una línea y el monto en la siguiente**

- **Severidad:** P3.
- **Categoría:** PDF.
- **Estado:** Problema de UX (visual, confirmado).
- **Archivo y líneas:** `src/servidor/pdf.ts:325-327` y `:433` (los `dd` de los totales no llevan `nowrap`).
- **Obtenido:** «Descuento 9,99 % sobre −» y, debajo, «productos $237.042».
- **Frecuencia:** siempre que hay descuento general y flete a la vez.
- **Evidencia:** `capturas/pdf/b3a-p1.png`.
- **Solución (baja):** `.totales dd{white-space:nowrap}`.
- **Prueba de regresión:** «−$n» sale como un solo fragmento.

**BUG-039: Las descripciones y nombres escritos en MAYÚSCULAS cambian de significado en el PDF y en el pedido («MODELO X» → «Modelo ×»)**

- **Severidad:** P3.
- **Categoría:** PDF.
- **Estado:** Confirmado.
- **Archivo y líneas:** `src/servidor/pdf.ts:76-88` (`descripcionLegible`), usada en `:272`, `:298` y en `integracion-pedido.ts:58`. El panel usa otra función, `src/app/formato.ts:88-111`.
- **Obtenido:** «PUERTA ESPECIAL MODELO X CON VIDRIO … TIPO A» sale en el PDF como «… Modelo × Con … Tipo a»; el panel muestra «Modelo X con … Tipo A».
- **Evidencia:** `evidencia/pdf/x-pantalla-vs-pdf.ts`, `x-nombres.ts`, `runs/b4/texto.txt`, `runs/b5/texto.txt`.
- **Causa raíz:** confirmada. El «Oregon» sin tilde está documentado (`tests/pdf.test.ts:480`); el cambio en textos escritos a mano no lo documenta ninguna prueba.
- **Impacto:** el documento no dice lo que escribió la persona.
- **Solución (baja):** no normalizar `descripcionDocumento` ni los nombres de especiales y libres, y usar un solo normalizador para la pantalla y el PDF.
- **Prueba de regresión:** «MODELO X TIPO A» se imprime tal cual.

**BUG-040: Los saltos de línea de las observaciones se pierden en el PDF**

- **Severidad:** P3.
- **Categoría:** PDF.
- **Estado:** Confirmado.
- **Archivo y líneas:** `src/servidor/servicio.ts:1040` y `src/servidor/edicion.ts:36-37` (`limpiarTexto` colapsa `\s+`). El PDF usa `white-space:pre-line` (`pdf.ts:438`, `:445`), pero nunca recibe saltos.
- **Obtenido:** tres párrafos escritos en el textarea salen en una sola línea.
- **Evidencia:** `evidencia/pdf/runs/b4/texto.txt`.
- **Solución (baja):** colapsar los espacios pero conservar `\n`.
- **Prueba de regresión:** un `\n` en las observaciones se ve como salto de línea en el texto del PDF.

**BUG-041: Si falta el archivo de una referencia, el PDF imprime el rótulo «Ítem n · …» sin imagen**

- **Severidad:** P3.
- **Categoría:** PDF.
- **Estado:** Confirmado.
- **Archivo y líneas:** `src/servidor/pdf.ts:294-301` (el grupo se arma antes de comprobar el archivo); `:588-596` y `:761-764` (quitan solo el `<img>`).
- **Pasos:** borrar `referencias/<sha>.jpg` y regenerar.
- **Evidencia:** `capturas/pdf/f1-referencia-perdida-p1.png`.
- **Solución (baja):** quitar el grupo cuando queda vacío.
- **Prueba de regresión:** sin el archivo, no aparece el rótulo del ítem.

**BUG-042: Los montos de 10 dígitos o más no caben en el PDF**

- **Severidad:** P3.
- **Categoría:** PDF.
- **Estado:** Confirmado.
- **Archivo y líneas:** `src/servidor/pdf.ts:431`, `:436` y `:424`.
- **Obtenido:** el total «$1.047.680.915» se recorta en el margen. En la nota, el total de línea pisa al unitario.
- **Frecuencia:** muy baja, desde $1.000 millones.
- **Evidencia:** `capturas/pdf/h1-p1.png`; `evidencia/pdf/h-montos-grandes.ts`, `h2-nota-grande.ts`.
- **Solución (baja):** reducir el tamaño de la cifra según su largo.
- **Prueba de regresión:** un total de 13 caracteres cabe completo en la página.

**BUG-043: `npm run integracion -- encolar <N>` sobre una nota ya entregada crea una revisión idéntica**

- **Severidad:** P3.
- **Categoría:** Integración.
- **Estado:** Confirmado.
- **Archivo y líneas:** `scripts/integracion.ts:66-80`.
- **Obtenido:** la fábrica recibe las revisiones 1 y 2 con los mismos ítems. Si el pedido ya está en producción, queda «pendiente de revisión».
- **Evidencia:** `evidencia/fabrica/s03-revisiones.log` (F24).
- **Solución (baja):** rechazar si ya existe un envío, salvo con `--forzar`.
- **Prueba de regresión:** F24.

**BUG-044: Si se pierde la respuesta de la fábrica y el PDF comercial se regenera entre intentos, el envío queda «fallido» con 409, aunque la fábrica ya lo tiene**

- **Severidad:** P3.
- **Categoría:** Integración.
- **Estado:** Confirmado (caso borde).
- **Archivo y líneas:** `src/servidor/integracion-envio.ts:183-185` y `:202` (lee `data/pdf` en cada intento); `src/servidor/documentos.ts:95-105` (al regenerar, los bytes cambian).
- **Evidencia:** `evidencia/fabrica/s07-extra.log` (F28).
- **Solución (baja):** copiar el PDF comercial a `data/integracion/pdf` al encolar, como la OT.
- **Prueba de regresión:** F28.

**BUG-045: Dos administradoras que se desactivan a la vez pueden dejar cero cuentas activas**

- **Severidad:** P3.
- **Categoría:** Persistencia.
- **Estado:** Riesgo técnico (TOCTOU).
- **Archivo y líneas:** `src/app/api/usuarios/route.ts:151-157` (leer, comprobar y actualizar fuera de una transacción).
- **Obtenido:** con el intercalado forzado, 200 y 200 y ninguna cuenta activa. Por HTTP real, 0 de 10: la segunda pierde la sesión antes.
- **Evidencia:** `evidencia/persistencia/acceso.test.ts` (S2), `salida-acceso-2.txt`, `salida-http-carreras.txt`.
- **Impacto:** nadie puede entrar hasta reactivar una cuenta por terminal.
- **Solución (baja):** contar y actualizar dentro de una transacción `IMMEDIATE`.
- **Prueba de regresión:** S2.

**BUG-046: `limpiar-borradores` puede eliminar un borrador que alguien retomó entre la lista y el borrado**

- **Severidad:** P3.
- **Categoría:** Persistencia.
- **Estado:** Riesgo técnico (confirmado en una prueba unitaria).
- **Archivo y líneas:** `src/servidor/almacen.ts:1461-1471`; `scripts/limpiar-borradores.ts:145`.
- **Evidencia:** `evidencia/persistencia/transacciones.test.ts` (P2), `salida-transacciones.txt`.
- **Impacto:** el borrador va a la papelera y se puede recuperar. La ventana es de milisegundos.
- **Solución (baja):** comprobar `actualizada` dentro del bloqueo.
- **Prueba de regresión:** P2.

**BUG-047: El servidor no tiene idempotencia para «crear» ni «duplicar»**

- **Severidad:** P3.
- **Categoría:** Persistencia.
- **Estado:** Riesgo técnico.
- **Archivo y líneas:** `src/servidor/servicio.ts:707` y `:711`. Las guardas del navegador usan estado de React (`historial/pantalla-historial.tsx:51`, `cotizador.tsx:1132`).
- **Obtenido:** dos `agregar_producto` sin id crean 2 borradores, y dos `duplicar` crean 2 copias. En el navegador, los dobles clics se contuvieron (9 de 9 escenarios).
- **Evidencia:** `evidencia/persistencia/concurrencia.test.ts` (D1); `evidencia/ui/08-doble-clic.ts`.
- **Solución (baja):** un `nuevoId`, como el del chat.
- **Prueba de regresión:** D1.

**BUG-048: `/api/auth/list-sessions` devuelve al navegador los tokens de sesión**

- **Severidad:** P3.
- **Categoría:** Otra (seguridad).
- **Estado:** Mejora.
- **Archivo y líneas:** `src/app/api/sesiones/route.ts:26-29` dice «Los tokens no salen del servidor», pero la ruta de Better Auth los devuelve.
- **Evidencia:** `evidencia/persistencia/acceso.test.ts` (S3).
- **Impacto:** bajo. Sin el plugin bearer, un token sin firma no autentica.
- **Solución (baja):** bloquear o filtrar esa ruta, o corregir el comentario.
- **Prueba de regresión:** la respuesta de la ruta no contiene `token`.

**BUG-049: Casos límite de descuentos en el chat: «$20.000 en total» se toma por unidad; «descuento de 2 molco» respalda un 2 %; el descuento de un ítem se aplica a otro de la misma línea**

- **Severidad:** P3.
- **Categoría:** Lógica (IA).
- **Estado:** Confirmado. En los tres casos se muestra un aviso.
- **Archivo y líneas:** `src/servidor/chat.ts:577-644` (`descuentosEscritos` no usa `montoTotal`).
- **Evidencia:** `evidencia/ia/t01-adversarial.test.ts` (S1.07b, S1.07c, S1.07d).
- **Solución (media):** reconocer «en total» y exigir el descuento en la frase del ítem.
- **Prueba de regresión:** S1.07b a S1.07d.

**BUG-050: El anclaje se apoya en todo el historial, aunque el modelo solo ve los últimos 6 turnos**

- **Severidad:** P3.
- **Categoría:** Lógica (IA).
- **Estado:** Confirmado.
- **Archivo y líneas:** `src/servidor/chat.ts:1020` (`base.historial` completo); `src/asistente/llm.ts:247` (6 turnos).
- **Obtenido:** un «7» dicho seis turnos atrás respalda en silencio la cantidad de un ítem nuevo.
- **Evidencia:** `evidencia/ia/t03-mensajes.test.ts` (S2.07).
- **Solución (baja):** anclar contra la misma ventana que ve el modelo.
- **Prueba de regresión:** S2.07.

**BUG-051: `aprobar_cotizacion` no exige que el número de la cotización esté escrito en el mensaje**

- **Severidad:** P3.
- **Categoría:** Lógica (IA).
- **Estado:** Confirmado. Lo mitiga el diálogo de confirmación.
- **Archivo y líneas:** `src/servidor/chat.ts:890-928`. En cambio, `cambiar_numero` sí lo exige.
- **Obtenido:** «el cliente aprobó la cotización» con `numero:323` propone confirmar la N° 323.
- **Evidencia:** `evidencia/ia/t02-adversarial2.test.ts` (S1.26).
- **Solución (baja):** exigir el número escrito, como en `cambiar_numero`.
- **Prueba de regresión:** S1.26.

**BUG-052: Un solo campo mal tipado hace descartar toda la respuesta del modelo**

- **Severidad:** P3.
- **Categoría:** Lógica (IA).
- **Estado:** Riesgo técnico.
- **Archivo y líneas:** `src/asistente/esquemas.ts:4` y `:43` (`.strict()`).
- **Obtenido:** basta `"cantidad":"2"`, una `fuente` de más de 300 caracteres o 101 ítems para que, tras el reintento, la persona vea «No entendí».
- **Evidencia:** `evidencia/ia/t04-malformadas-concurrencia.test.ts` (S3.01), `t05-proveedor.test.ts` (S3.10), `t03-mensajes.test.ts` (S2.04).
- **Solución (baja):** convertir los números que llegan como texto y recortar `fuente`.
- **Prueba de regresión:** S3.01.

**BUG-053: Mensajes engañosos del asistente**

- **Severidad:** P3.
- **Categoría:** UX.
- **Estado:** Problema de UX.
- **Obtenido:**
  - «Tu borrador está guardado» cuando todavía no existe ningún borrador.
  - «No aparece escrito en su línea» para «$450,000» o «33,333 %», que sí están escritos.
  - «corresponde a otro ítem del pedido» cuando el pedido tiene un solo ítem.
- **Evidencia:** `evidencia/ia/t03-mensajes.test.ts` (S2.03, S2.05, S2.06), `t05-proveedor.test.ts` (S3.02, S3.10).
- **Solución (baja):** ajustar los textos a cada caso.
- **Prueba de regresión:** los mismos escenarios, comprobando el texto del aviso.

**BUG-054: La API acepta un mensaje de chat sin `actualizada`, sobre una versión que el cliente nunca vio**

- **Severidad:** P3.
- **Categoría:** Persistencia.
- **Estado:** Riesgo técnico. Solo afecta a llamadas directas a la API: la interfaz siempre envía la versión (`cotizador.tsx:1273-1274`).
- **Archivo y líneas:** `src/app/api/accion/route.ts:156` (`actualizada` es opcional).
- **Evidencia:** `evidencia/ia/t04-malformadas-concurrencia.test.ts` (S4.04).
- **Solución (baja):** exigirla cuando hay `id`.
- **Prueba de regresión:** S4.04 responde 400.

**BUG-055: «Atrás» deja la URL en «/» pero sigue mostrando Historial si la cotización se abrió por enlace directo**

- **Severidad:** P3.
- **Categoría:** UX.
- **Estado:** Confirmado.
- **Archivo y líneas:** probablemente `src/app/cotizador.tsx:280` (`history.replaceState(null,'','/')`). Es una hipótesis.
- **Pasos:** abrir `/?cotizacion=<id>` directamente, ir a Historial y pulsar Atrás.
- **Frecuencia:** 4/4.
- **Evidencia:** `evidencia/ui/09c-atras.ts`, `09b-atras-sinred.ts`; `capturas/ui/09b-B1-atras.png`.
- **Solución (baja):** `router.replace` de `next/navigation`.
- **Prueba de regresión:** después de Atrás, el h1 corresponde a la URL.

**BUG-056: La página 404 sin sesión muestra el logo roto**

- **Severidad:** P3.
- **Categoría:** UI.
- **Estado:** Confirmado.
- **Archivo y líneas:** `src/app/not-found.tsx:10` usa `/api/logo`, que sin sesión responde 401.
- **Frecuencia:** 2/2.
- **Evidencia:** `capturas/ui/19-404-sin-sesion.png`.
- **Solución (baja):** usar `/logo-neltume.svg`, como el login.
- **Prueba de regresión:** la 404 sin sesión no registra errores de consola.

**BUG-057: En el mismo formulario, unos campos se guardan al salir y otros no**

- **Severidad:** P3.
- **Categoría:** UX.
- **Estado:** Problema de UX.
- **Obtenido:** «Ganancia de la línea» y «Descuento especial» se guardan al perder el foco. Descripción, observación, cantidad y medidas quedan abiertas con Guardar y Cancelar. Se pueden tener varios campos abiertos a la vez. Esto agrava BUG-010 y BUG-011.
- **Evidencia:** `evidencia/ui/18-teclado-pendientes.ts`, `05-edicion.ts`.
- **Solución (media):** unificar el criterio, o marcar «sin guardar» en el campo.
- **Prueba de regresión:** todos los campos del detalle siguen el mismo criterio al perder el foco.

**BUG-058: El aviso «Documento listo» tapa «Fecha del pago» y «Registrar pago»**

- **Severidad:** P3.
- **Categoría:** UI.
- **Estado:** Problema de UX.
- **Obtenido:** con 1440×900, unos 4 s después de generar la nota, el aviso cubre esos controles.
- **Frecuencia:** 2/2.
- **Evidencia:** `capturas/ui/19-aviso-sobre-pagos.png`, `04-13-nota.png`.
- **Solución (baja):** ubicar los avisos fuera del formulario y de la barra fija.
- **Prueba de regresión:** el rectángulo del aviso no se cruza con ningún control activo.

**BUG-059: «Cliente opcional · puedes completarlo después» aparece en cotizaciones ya bloqueadas**

- **Severidad:** P3.
- **Categoría:** UX.
- **Estado:** Problema de UX.
- **Archivo y líneas:** `src/app/cotizacion-panel.tsx:615`.
- **Evidencia:** `capturas/ui/04-13-nota.png`.
- **Solución (baja):** mostrarlo solo si la cotización es editable.
- **Prueba de regresión:** el texto no aparece en una cotización aprobada.

**BUG-060: Los placeholders tienen un contraste de 3,1:1**

- **Severidad:** P3.
- **Categoría:** UI (accesibilidad, WCAG 1.4.3).
- **Estado:** Confirmado.
- **Archivo y líneas:** solo algunos selectores definen `::placeholder` (`src/app/globals.css:594`). `globals.css:7` promete un contraste de 5:1 o más.
- **Obtenido:** ≈ 3,06:1 en «0» de Descuento especial y en «Ej.: raulí, willow». Probable en otros placeholders, no medidos.
- **Evidencia:** `evidencia/ui/12-a11y-manual.ts`, `contraste.js`.
- **Solución (baja):** `input::placeholder, textarea::placeholder { color: var(--subtle) }`.
- **Prueba de regresión:** el contraste medido de cada placeholder es de 4,5:1 o más.

**BUG-061: Referencias ARIA rotas y un `aria-label` en un `<div>` sin rol**

- **Severidad:** P3.
- **Categoría:** UI (accesibilidad).
- **Estado:** Confirmado. axe-core los deja como «incompletas».
- **Archivo y líneas:** `src/app/selector-desplegable.tsx:110` (`aria-controls` apunta a una lista que no existe mientras está cerrada); `src/app/cotizacion-panel.tsx:512` (`aria-label` en un div sin rol).
- **Evidencia:** `evidencia/ui/axe-resultados.json`.
- **Solución (baja):** `aria-controls` solo con la lista abierta, y `role="group"` en el div.
- **Prueba de regresión:** axe sin «incompletas» de ese tipo.

**BUG-062: Los errores del formulario «Producto personalizado» podrían no anunciarse en un lector de pantalla**

- **Severidad:** P3.
- **Categoría:** UI (accesibilidad).
- **Estado:** Probable. No se verificó con un lector real.
- **Obtenido:** se marca `aria-invalid`, pero el foco se queda en el botón y no hay región viva. El alta manual del catálogo, en cambio, lleva el foco al primer campo inválido.
- **Evidencia:** `evidencia/ui/10-entradas-navegacion.ts` (X4); `capturas/ui/10-X4-personalizado-vacio.png`.
- **Solución (baja):** enfocar el primer campo inválido.
- **Prueba de regresión:** con el formulario vacío, `activeElement` es el primer campo inválido.

**BUG-063: Catálogo → «Agregar producto» pierde el formulario manual sin aviso al ir a Cotizar**

- **Severidad:** P3.
- **Categoría:** UX.
- **Estado:** Problema de UX.
- **Archivo y líneas:** `src/app/catalogo/pantalla-catalogo.tsx:80` (solo vigila `configuracionSucia`).
- **Frecuencia:** 1/1.
- **Evidencia:** `evidencia/ui/16-catalogo-ajustes.ts` (ALTA4).
- **Solución (baja):** incluir ese formulario en `useAvisoSalida`.
- **Prueba de regresión:** con el formulario modificado, navegar pide confirmar.

**BUG-064: Un rango de fechas invertido en Historial solo dice «Sin resultados»**

- **Severidad:** P3.
- **Categoría:** UX.
- **Estado:** Problema de UX.
- **Archivo y líneas:** `src/app/historial.tsx:298-316` (`min`/`max` no lo impiden si se escribe con el teclado).
- **Evidencia:** `capturas/ui/15-H3-rango-invertido.png`.
- **Solución (baja):** avisar del rango invertido o intercambiar las fechas.
- **Prueba de regresión:** «Desde» posterior a «Hasta» muestra el motivo.

**BUG-065: Se aceptan caracteres de control bidi, y Ajustes → Conexión no explica por qué está deshabilitado «Enviar PDF de prueba»**

- **Severidad:** P3.
- **Categoría:** UI.
- **Estado:** Mejora.
- **Obtenido:**
  - Un U+202E pegado desde WhatsApp o un correo invierte el texto de la descripción («oditrevni»), que va al PDF.
  - El botón deshabilitado no tiene `aria-describedby` con el motivo.
  - «Actualizar lista» no da ninguna señal de haber actualizado.
- **Evidencia:** `capturas/ui/10-X2-recorte.png`.
- **Solución (baja):** quitar los controles bidi al guardar; asociar el motivo al botón.
- **Prueba de regresión:** un U+202E en la descripción no llega al PDF.

### Decisiones a confirmar con Neltume (no se cuentan como bugs)

- **El descuento general, también el automático por cantidad de puertas, rebaja los ítems libres.** Con 2 Molco + «Instalación $100.000» y el 10 %, el descuento es de $41.000; sin la instalación serían $31.000. `docs/reglas-negocio.md` no dice nada sobre ítems libres. Evidencia: `evidencia/logica/a2-documentos.audit.ts` (F2).
- **Duplicar una cotización copia también la fábrica asignada a cada ítem.** Hay que confirmar que es lo deseado. Evidencia: `a1-calculo.audit.ts` (D2).
- **El tope de $100.000.000 se aplica solo a los precios escritos a mano.** Uno calculado con margen llega a $600.000.000 sin desbordar (X3).

---

## D. Matriz de pruebas

Leyenda: **PASS** = se comportó como se esperaba; **FAIL** = defecto (con su BUG); **BLOCKED** = no se pudo correr; **NOT RUN** = fuera de alcance. Las filas agrupan escenarios afines; el detalle de cada uno está en la evidencia de su área.

| ID | Funcionalidad | Escenario | Resultado | Evidencia |
|---|---|---|---|---|
| BASE-01 | Pruebas del repo | `vitest run`: 95 archivos, 1.541 pruebas | PASS | `evidencia/vitest.log` |
| BASE-02 | Pruebas del repo | `npm run test:e2e` con la integración vacía: 102 pasan, 1 omitida a propósito (`movil.e2e.ts:81`, gesto CDP solo en Chromium), 6,9 min | PASS | `evidencia/e2e-1.log` |
| LOG-A1 | Cálculo base | 2 Molco con margen de categoría 55 %: $155.000; IVA $58.900; total $368.900 | PASS | `logica/a1-calculo.audit.ts` |
| LOG-A2 | Redondeo del margen | Margen manual 15 % sobre $10.990 | FAIL (BUG-034) | `logica/redondeo2.ts` |
| LOG-B1–B7 | Descuento por ítem | Después cambiar la cantidad, el precio o el margen; monto mayor que el precio; quitar el ítem; límites 0 / 0,005 / 99,99 / 100 / 100,01 / −1 | PASS | `logica/a1-calculo.audit.ts` |
| LOG-C1–C5 | Límites | Descuento general 0–50; cantidad 0, −1, 1,5, 10.000, 10.001; flete; IVA 21 % y 0 %; 100 y 101 líneas | PASS | `logica/a1-calculo.audit.ts` |
| LOG-D1–D3 | Persistencia de montos | Reabrir; duplicar sin referencias compartidas; revisión de una emitida | PASS | `logica/a1-calculo.audit.ts` |
| LOG-E1 | Paridad | Panel = base = HTML del PDF = texto copiado, peso a peso | PASS | `logica/registro.log` [E1] |
| LOG-E2 | Notas | Precio de fábrica sin descuentos; ítem libre fuera; especial a su costo | PASS | `logica/a2-documentos.audit.ts` |
| LOG-F1–F5 | Ítem libre | $1 y $100M × 10.000; no cuenta como puerta; el margen especial no lo toca | PASS | `logica/a2-documentos.audit.ts` |
| LOG-G1 | Especial | Costo de fábrica mayor que el precio | FAIL (BUG-014) | `logica/a3-especiales-starken.audit.ts` |
| LOG-H1–H2 | Tramos por cantidad | Cruzar umbrales; el descuento manual no se pisa; una puerta pendiente deja de contar | PASS | `logica/a2-documentos.audit.ts` |
| LOG-R1/R3 | Catálogo cambiado | Una edición recotiza en silencio | FAIL (BUG-012) | `logica/a4-catalogo-cambiado.audit.ts` |
| LOG-R2 | Catálogo cambiado | Emitir un borrador desactualizado da 409 | PASS | idem |
| LOG-S1 | Starken | Neto desde la tarifa con IVA (101.150 → 85.000) | PASS | `logica/a3-especiales-starken.audit.ts` |
| LOG-S3 | Starken | La tarifa aplicada no cambia con el pedido | FAIL (BUG-013) | `logica/a5-starken-aplicada.audit.ts` |
| LOG-L1/L2 | Lectura de cifras | «1.490,5», «1,490», «$1.490.000», «1490.00»; «$350.00» | PASS / FAIL (BUG-035) | `logica/salida-lectura-*.txt` |
| LOG-X2–X3 | Redondeo y desborde | IVA exhaustivo con 9 tasas; peor caso de 1,2e15 | PASS | `logica/salida-redondeo-iva.txt`, `salida-maximos.txt` |
| PER-C1–C2 | Concurrencia optimista | Dos pestañas; mismo milisegundo; reloj −1 h | PASS | `persistencia/salida-concurrencia.txt` |
| PER-C3–C4 | Revisión abierta | Editar la emitida | FAIL (BUG-002) | `persistencia/salida-http-revision.txt` |
| PER-D1 | Duplicados | Crear o duplicar dos veces | PASS funcional / riesgo (BUG-047) | `persistencia/salida-concurrencia.txt` |
| PER-D2–D3 | Duplicados | Emitir, pagar y generar la nota dos veces a la vez | PASS | idem |
| PER-N1–N2 | Numeración | Renumerar durante una emisión | FAIL (BUG-024) | idem |
| PER-N3–N4 | Numeración | Dos renumeraciones a la vez; número usado, fuera de rango, menor libre | PASS | idem |
| PER-R1 | Papelera | Restaurar después de renumerar | FAIL (BUG-025) | `persistencia/salida-papelera-numero.txt` |
| PER-P1/P3 | Papelera | Restaurar dos veces a la vez; vaciar | PASS | `persistencia/salida-transacciones.txt` |
| PER-P2 | Limpieza | Borrador retomado | FAIL (BUG-046) | idem |
| PER-T1–T6 | Transacciones | Falla el PDF, la plantilla o la 2.ª fábrica; marca «en emisión» de un proceso caído; número ocupado | PASS | idem |
| PER-M1–M2 | Estados | 32 transiciones inválidas por la API; cadena completa y retrocesos | PASS | idem |
| PER-K1–K3 | Clientes | Editar uno no afecta a otros; `% _ \ ' "`, emoji, inyección SQL; autocompletar | PASS | `persistencia/salida-clientes.txt` |
| PER-A1–A2 | Acceso | 26 rutas `/api` sin sesión (401) y con rol `user` en rutas de admin (403) | PASS | `persistencia/salida-acceso*.txt` |
| PER-H1–H2 | Cabeceras | Host, rebinding, Origin, `Sec-Fetch-Site`; cuerpo de 70 KB y Content-Length falso | PASS | `persistencia/salida-acceso.txt` |
| PER-F1–F2 | Archivos | Recorrido de rutas en `/api/documento`; SVG, PDF con HTML, más de 10 MB, CRLF en el nombre | PASS | idem |
| PER-S1 | Ajustes | Guardar desde dos pantallas | FAIL (BUG-023) | `persistencia/salida-http-carreras.txt` |
| PER-S2 | Cuentas | Desactivación mutua | FAIL con intercalado forzado (BUG-045) / PASS 10/10 por HTTP | `persistencia/salida-acceso-2.txt` |
| PER-S3 | Better Auth | Admin bloqueado, alta cerrada, rol no editable | PASS (BUG-048) | `persistencia/salida-acceso.txt` |
| PER-X | Script | `limpiar-borradores` por tsx | BLOCKED (ruta del socket IPC demasiado larga en el TMPDIR de la auditoría; es del entorno, no un bug) | — |
| IA-S1.01/03/07 | Anclaje | Cantidad, precio o descuento inventados | PASS | `ia/t01-adversarial.test.ts` |
| IA-S1.02 | Anclaje | Valor de otro ítem del borrador | FAIL (BUG-006) | idem |
| IA-S1.04–05, 17, 25 | Precio | Respaldo por un número ajeno | FAIL (BUG-029) | `ia/t01`, `t02` |
| IA-S1.06 | IVA | Neto o con IVA invertido | FAIL (BUG-028) | idem |
| IA-S1.08 | Índices | Fuera de rango | PASS | `ia/t01` |
| IA-S1.09 | Duplicados | Ítem repetido | FAIL (BUG-008) | idem |
| IA-S1.10–18 | Operaciones destructivas y campos sin anclaje | Quitar, flete null, fábrica null, `actualizar_cotizacion`, descripción, observaciones, cliente | FAIL (BUG-009, BUG-026) | idem |
| IA-S1.14 | Fábrica | Deducida de la comuna o del modelo | FAIL (BUG-027) | idem |
| IA-S1.19–20, 28 | Índices | Ítem equivocado | FAIL (BUG-007) | `ia/t01`, `t02` |
| IA-S1.21 | Nombres | Una edición cambia el modelo a uno no dicho | PASS | `ia/t01` |
| IA-S1.23 | Ítem libre | Nombres del catálogo | FAIL parcial (BUG-031) | `ia/t02` |
| IA-S1.24 | Ítem libre | Precio 0, negativo, enorme o con decimales | PASS | idem |
| IA-S1.26–27 | Números | Aprobar sin número / cambiar número | FAIL (BUG-051) / PASS | idem |
| IA-S2.01, 03–06, 08–09 | Mensajes difíciles | «2 de 80 y 3 de 70», ortografía, montos y porcentajes, regresiones conocidas | PASS (textos de BUG-053) | `ia/t03`, `t07` |
| IA-S2.02 | Mensajes difíciles | «… no, mejor 4» | FAIL (BUG-032) | `ia/t03` |
| IA-S2.07 | Anclaje | Historial lejano | FAIL (BUG-050) | idem |
| IA-S3.01–S3.11 | Proveedor | 20 formatos inválidos; 429, 500, 401, timeout, respaldo, JSON roto, respuesta vacía, dos tool-calls | PASS (BUG-052, BUG-053) | `ia/t04`, `t05` |
| IA-S4.01–S4.03 | Concurrencia | Chat mientras se edita a mano; dos chats a la vez; el mismo `nuevoId` | PASS | `ia/t04` |
| IA-S4.04 | Concurrencia | Chat sin `actualizada` | Riesgo (BUG-054) | idem |
| IA-S5.01 | Salida | Montos en `responder` / escape de HTML | FAIL (BUG-030) / PASS | idem |
| PDF-M01–M02 | Cotización | 1 producto; 4 líneas y 3 familias | PASS | `pdf/a1-prototipo.ts`, `pdf/resultados.jsonl`, `pdf/runs/b1` |
| PDF-M03–M05 | Cotización | Descuentos por ítem, por cantidad y manual con flete | PASS montos / FAIL visual (BUG-015, BUG-038) | `capturas/pdf/b2-p1.png`, `b3a-p1.png` |
| PDF-M06–M09 | Cotización | Textos largos; MAYÚSCULAS; saltos de línea; especiales e ítem libre | PASS / FAIL (BUG-039, BUG-040) | `pdf/runs/b4`, `b5` |
| PDF-M10 | Cotización | Tildes, ñ, comillas, `< > &`, emoji, RTL | PASS | `capturas/pdf/b6-p1.png` |
| PDF-M11–M12 | Cotización | Textos sin espacios y URL | FAIL (BUG-018) / PASS hasta 95 caracteres | `pdf/runs/d*` |
| PDF-M13 | Cotización | 60 y 100 ítems: encabezado repetido, «Página n de m», totales en la última | PASS | `pdf/runs/b7-*` |
| PDF-M14–M15 | Cotización | Campos opcionales vacíos; nombre de 300 caracteres | PASS | `pdf/runs/b8`, `b9` |
| PDF-M16–M17 | Notas y OT | Panguipulli y Santiago; precio de fábrica; ítem libre fuera; OT sin precios | PASS | `pdf/runs/c1` |
| PDF-M18 | Notas | «Aprobada por» | FAIL (BUG-017) | `pdf/runs/c2` |
| PDF-M19–M20 | Anulada y renumerada | Contenido | FAIL (BUG-016) / PASS marca y nombres | `pdf/runs/c2`, `c3` |
| PDF-M21–M23 | Regenerar y emitir | PDF perdido; 5 regeneraciones a la vez; emitir ×3 a la vez | PASS | `pdf/c-notas.ts`, `pdf/f-varios.ts`, `pdf/resultados-1.jsonl` |
| PDF-M24–M27 | Imágenes | 4032×3024, WEBP, PNG transparente, EXIF; 28 imágenes; archivo perdido | PASS / FAIL (BUG-004, BUG-041) | `pdf/runs/e*`, `f1` |
| PDF-M28–M29 | Notas | Ítem sin fábrica; solo ítems libres; nota de 100 ítems | PASS | `pdf/f-varios.ts`, `pdf/resultados-1.jsonl` |
| PDF-M30 | Especial | Accesorio con ancho | FAIL (BUG-005) | `pdf/runs/g1` |
| PDF-M31 | Montos | $1.000 millones o más | FAIL (BUG-042) | `capturas/pdf/h1-p1.png` |
| PDF-M32 | Dibujos | Ningún dibujo del catálogo ni `neltume-dibujo` en los snapshots | PASS | `pdf/x-dibujos.ts` |
| PDF-M33 | Ruta | `/api/documento`: descarga, inline, 401 y recorrido de rutas | PASS | `pdf/ruta-documento.audit.test.ts` |
| FAB-F01, F29 | Selección | Solo Santiago no se encola; con variables de Santiago, solo Panguipulli | PASS | `fabrica/s01-basico.log`, `s07-extra.log` |
| FAB-F02 | Correspondencia | Pedido mixto: 27 comprobaciones (ítems, medidas, observaciones, referencias, Σ, firma) | PASS | `fabrica/s01-basico.log` |
| FAB-F03–F09 | Red y respuestas | Timeout con duplicado; reloj +400 s; 307; ECONNREFUSED; cuerpo infinito; 2 MB; 24 códigos de estado | PASS | `fabrica/s02-errores.log` |
| FAB-F10 | Reintentos | 15 intentos → «fallido» en ~33 h | PASS según el código / FAIL en documentación y aviso (BUG-004) | idem |
| FAB-F11–F12, F23 | Idempotencia | «Generar notas» doble o repetido; solo ítems libres | PASS | `fabrica/s01-basico.log` |
| FAB-F13–F18 | Revisiones y cancelación | Renumerar; anular antes, durante y después del envío; reinicio del proceso | PASS | `fabrica/s03-revisiones.log` |
| FAB-F17b | Orden | Anulación detrás de un 503 con Retry-After de 6 h | FAIL (BUG-019) | `fabrica/s10-anulacion-retenida.log` |
| FAB-F19–F20 | OT | Renumeraciones o restauración de un respaldo | FAIL (BUG-003) | `fabrica/s03`, `s04`, `s08` |
| FAB-F20b | Restauración | Volver a generar después de restaurar | FAIL (BUG-020) | `fabrica/s08-restaurar.log` |
| FAB-F21 | Tamaño | 10, 20 y 30 fotos | FAIL (BUG-004) | `fabrica/s04-limites.log` |
| FAB-F21b | Tamaño | 100 ítems con observaciones de 1.000 caracteres | PASS | idem |
| FAB-F22 | Revisiones | Configuración incompleta | FAIL (BUG-021) | idem |
| FAB-F24, F28 | CLI e idempotencia | `encolar` repetido; PDF regenerado entre intentos | FAIL (BUG-043, BUG-044) | `fabrica/s03`, `s07` |
| FAB-F25 | Prueba de conexión | 18 casos de recepción y 5 de envío | PASS | `fabrica/s05-conexion.log` |
| FAB-F26 | Entorno E2E | Integración de `.env.local` activa | FAIL (BUG-022) | `fabrica/s06-e2e-env.log` |
| UI-L1–L3, R1–R2 | Login y permisos | Errores de login; rutas protegidas; rol `user` en rutas de admin | PASS | `ui/01-recorrido.ts`, `21-login.ts` |
| UI-R3 | 404 | Con sesión / sin sesión | PASS / FAIL (BUG-056) | `capturas/ui/19-404-sin-sesion.png` |
| UI-F1 | Flujo típico | 2 Molco + marco + flete + descuento → emitir → aprobar → pago → nota | PASS | `ui/04-flujo-tipico.ts` |
| UI-E1–E4 | Edición | Editar parte de la descripción sin saltos del cursor; Esc, Enter, Cancelar; el ítem 2 no altera al 1 ni al 3 | PASS | `ui/05-edicion.ts` |
| UI-K1, K2, K4 | Claves de React | Quitar, cambiar la madera o mover con un borrador abierto | FAIL (BUG-001) | `capturas/ui/06-K1-*.png` |
| UI-K3 | Claves de React | Quitar con modelos distintos | PASS | `ui/06-claves-react.ts` |
| UI-D1–D7 | Descuento por ítem | Aplicar, validar, monto, red lenta, quitar | PASS | `ui/07-descuento-duplicar.ts` |
| UI-D5b | Descuento por ítem | Cambiar el tipo y salir | FAIL (BUG-010) | `capturas/ui/07-D5b-cambiar-tipo-salir.png` |
| UI-DU1 | Duplicar | Editar la copia no cambia la original | PASS | idem |
| UI-A1–A8 | Doble clic | 9 acciones: una sola operación en cada una | PASS | `ui/08-doble-clic.ts` |
| UI-T1, O1–O3, S1–S2, RL1 | Pestañas, red y recarga | 409 entre pestañas; sin red en chat, guardado y emisión; red lenta; recargar a mitad de la emisión | PASS | `ui/09-concurrencia-red.ts`, `20-durante-operacion.ts` |
| UI-B1 | Atrás | Después de abrir por URL directa | FAIL (BUG-055) | `capturas/ui/09b-B1-atras.png` |
| UI-X1–X4 | Entradas | Emoji, HTML, 5.000 caracteres, campos obligatorios vacíos | PASS (BUG-062, BUG-065) | `ui/10-entradas-navegacion.ts` |
| UI-M1–M2 | Modales | 15 aperturas y cierres; contención del foco | PASS | idem |
| UI-N1–N2 | Sin guardar | Navegar o emitir con un campo modificado | FAIL (BUG-011) | `capturas/ui/17-*.png` |
| UI-AJ1, AL1, AL4 | Sin guardar | Ajustes, alias / alta del catálogo | PASS / FAIL (BUG-063) | `ui/16-catalogo-ajustes.ts` |
| UI-H1–H5 | Historial | Búsqueda, filtros, memoria; rango invertido | PASS / FAIL (BUG-064) | `ui/15-historial.ts` |
| UI-AN1, PA1, CL1 | Anular, papelera, clientes | Confirmaciones, Deshacer, búsqueda sin tildes | PASS | idem |
| UI-CAT, US1, FAB | Catálogo, usuarios, fábrica | Alta con errores; Excel falso; estado «Falta» | PASS | `ui/16*.ts` |
| UI-AX | a11y | axe WCAG 2.0/2.1/2.2 A/AA en 40 pantallas y estados: 0 violaciones | PASS | `ui/axe-resultados.json` |
| UI-FV, FO, TS, LV | a11y | Foco visible; foco no tapado (2.4.11); tamaño de los objetivos (2.5.8); regiones vivas | PASS | `ui/12-a11y-manual.ts`, `14-foco-tapado.ts` |
| UI-CT | a11y | Contraste | PASS textos / FAIL placeholders (BUG-060) | `ui/contraste.js` |
| UI-KB, FL | a11y | Flujo solo con teclado; foco después de las acciones | PASS con fricción / FAIL (BUG-033) | `ui/18-teclado-pendientes.ts` |
| UI-RS | Responsive | 6 tamaños × 18 pantallas: sin scroll horizontal; los diálogos caben | PASS | `ui/13-responsive.ts` |
| UI-CON | Consola y HTTP | Sin `pageerror`; respuestas ≥ 400 solo las esperadas (más BUG-056) | PASS | `ui/registro-*.log` |
| NR-01 | IA real | Frecuencia con que un modelo real comete BUG-006 a BUG-009 | NOT RUN (exige gasto) | — |
| NR-02 | Fábrica real | Comportamiento del lector de la fábrica (5 MiB, 50 páginas) | NOT RUN (prohibido enviar) | — |
| NR-03 | Starken real | Tarifas reales | NOT RUN | — |
| NR-04 | Navegadores | Safari, Firefox, lector de pantalla real, teléfono físico | NOT RUN | — |
| NR-05 | Importación | Importar una planilla válida desde la interfaz | NOT RUN (lo cubren las pruebas del repo) | — |
| NR-06 | Login | Bloqueo por intentos, sesión vencida | NOT RUN | — |
| NR-07 | Procesos | Varios procesos sobre la misma base, `kill -9`, disco lleno | NOT RUN | — |

---

## E. Problemas de UI y UX

Las capturas están en `auditoria-2026-10-26/capturas/ui/` y `auditoria-2026-10-26/capturas/pdf/`.

| Problema | Captura | Por qué dificulta el uso |
|---|---|---|
| BUG-001: el campo abierto salta a otro producto | `ui/06-K1-antes.png`, `ui/06-K1-despues.png`, `ui/06-K1-guardado.png` | La vendedora ve un campo abierto bajo otra puerta y no tiene cómo saber que cambió de dueño. Guardar parece correcto. |
| BUG-010: cambiar el tipo de descuento lo borra | `ui/07-D5b-cambiar-tipo-salir.png` | Mirar una opción no debería tener efectos. El único rastro es «Total actualizado». |
| BUG-011: emitir con un campo abierto | `ui/17-dialogo-emitir-con-campo-abierto.png`, `ui/17-emitida-sin-observacion.png` | El diálogo de confirmación es justo el momento de avisar, y no lo hace. |
| BUG-033: el foco se pierde | `ui/18-teclado-emitida.png` | Con teclado o lector de pantalla, cada acción principal obliga a volver a recorrer la cabecera. |
| BUG-055: «Atrás» incoherente | `ui/09b-B1-atras.png` | La URL y la pantalla no coinciden; recargar lleva a otra pantalla. |
| BUG-056: logo roto en la 404 | `ui/19-404-sin-sesion.png` | Da sensación de sitio roto justo cuando la persona ya está perdida. |
| BUG-058: el aviso tapa el pago | `ui/19-aviso-sobre-pagos.png` | Tapa el siguiente paso del flujo (registrar el pago) durante unos segundos. |
| BUG-059: «Cliente opcional» en una bloqueada | `ui/04-13-nota.png` | Invita a completar algo que ya no se puede editar. |
| BUG-062: errores del producto personalizado | `ui/10-X4-personalizado-vacio.png` | El foco no lleva al error; con lector de pantalla, nada parece pasar. |
| BUG-064: rango de fechas invertido | `ui/15-H3-rango-invertido.png` | «Sin resultados» hace creer que no hay cotizaciones. |
| BUG-065: controles bidi | `ui/10-X2-recorte.png` | Un texto pegado puede leerse al revés en el PDF. |
| BUG-015: montos pegados en el PDF | `pdf/b2-p1.png`, `pdf/d7-p1.png` | «3$182.688» se puede leer como 3.182.688. |
| BUG-018: maqueta rota por textos sin espacios | `pdf/d6-80-p1.png`, `pdf/d2-p1.png` | Hoja reducida, o sin precios por línea. |
| BUG-016: copia anulada y renumerada | `pdf/c2-cotizacion-anulada-p1.png`, `pdf/c3-cot-900-p1.png` | El mismo número de documento con otro contenido. |
| BUG-005: medida de un especial | `pdf/g1-nota-p1.png`, `pdf/g1-cot-p1.png` | «× 2,10 m» no dice el ancho. |

**Conteo del flujo típico** (2 Molco + marco + flete + descuento por ítem → emitir → aprobar → pago → nota): 30 acciones con ratón y teclado, o 26 sin el nombre del cliente, que es opcional. Con solo teclado son 85 pulsaciones para 1 producto, descuento, emitir y aprobar.

Fricciones principales:

1. El foco se pierde (BUG-033).
2. El descuento por ítem está escondido en «Editar detalles».
3. «La medida corresponde a» empieza en «Por confirmar» y bloquea con «Resolver medida»: un paso extra por puerta.
4. «Monto recibido» no sugiere el anticipo del 50 %.
5. Hay dos reglas de guardado distintas en el mismo formulario (BUG-057).
6. Al generar la nota, ningún ítem trae fábrica, así que siempre hay que elegirla. Es lo decidido, pero suma un paso.

Lo que funciona bien:

- No hay scroll horizontal en ninguno de los 6 tamaños (1920×1080 a 390×844).
- Los diálogos caben en la ventana y retienen el foco.
- El foco es visible (contorno de 2 px) y los objetivos miden 24 px o más.
- axe no encontró violaciones.
- El texto del chat se escapa y nunca se interpreta como HTML.

---

## F. Propuesta de correcciones

### Soluciones rápidas (dificultad baja, alto impacto)

1. **BUG-003:** nombrar la OT por envío y verificar su sha256 antes de reutilizarla.
2. **BUG-002:** aplicar los cambios sobre la revisión (`destino`), o responder 409 `revision_abierta`.
3. **BUG-001 (mitigación):** cerrar las ediciones abiertas al quitar, mover o cambiar un ítem, mientras se hace la solución definitiva.
4. **BUG-010:** un campo vacío tras cambiar de tipo no quita el descuento.
5. **BUG-022:** vaciar `NELTUME_FABRICA_*` en `webServer.env`. Es una línea y protege cada corrida del deploy.
6. **BUG-008:** descartar o avisar los ítems idénticos que agrega la IA.
7. **BUG-017:** usar `copia.aprobadaPor`.
8. **BUG-019, BUG-021:** dos guardas en la bandeja.
9. **BUG-027, BUG-028, BUG-030, BUG-031:** endurecer los patrones del validador de la IA.
10. **BUG-015, BUG-018, BUG-038:** CSS del PDF (`nowrap`, `table-layout:fixed`, `overflow-wrap`). Para la nota, avisar antes a la fábrica.
11. **BUG-033, BUG-056, BUG-059, BUG-060, BUG-061:** retoques de interfaz y accesibilidad.
12. **BUG-034, BUG-035:** redondeo del margen y lectura de «350.00».

### Cambios estructurales (dificultad media o alta)

1. **Identidad estable por ítem** (BUG-001): un `id` en `SolicitudItem`, migración y `key`. También simplifica BUG-007.
2. **Estado del envío visible en la nota** (BUG-004): API más pantalla de solo lectura, aviso a administración y presupuesto de peso para las fotos.
3. **Ancho de los especiales en documentos y contrato** (BUG-005): exige acordarlo con la fábrica.
4. **Anclaje por frase del ítem** (BUG-006, BUG-007, BUG-009, BUG-026, BUG-029): que la frase de cada ítem le gane a los valores conocidos; comprobación cruzada entre índice y modelo; exigir respaldo para los textos libres y las operaciones destructivas. Conviene sumar estos casos a `evals/` y medirlos con el modelo de producción antes de cambiar umbrales.
5. **Campos abiertos a nivel del panel** (BUG-011, BUG-057): un solo criterio de guardado y aviso al emitir o al salir.
6. **Recotización con constancia** (BUG-012, BUG-013, BUG-014): comparar contra las líneas previas, guardar la huella de Starken y el costo del especial.
7. **Copias desde el snapshot** (BUG-016): la anulada y la renumerada parten del HTML emitido.
8. **Restauración consciente de la integración** (BUG-020, BUG-003 camino B): una «época» en las claves y la carpeta `data/integracion/` dentro del respaldo.
9. **Versión en Ajustes** (BUG-023) y **número reservado** (BUG-024).

---

## G. Evaluación de preparación

| Dimensión | Nota | Justificación |
|---|---|---|
| Lógica comercial | 7 | Las reglas documentadas se cumplen. Fallan los casos de cambio: recotizar en silencio (BUG-012), Starken desactualizado (BUG-013), especial bajo el costo (BUG-014), medio peso (BUG-034). |
| Fiabilidad de cálculos | 8 | Ni un peso de diferencia entre base, panel, generador y PDF en decenas de escenarios; IVA exacto en 9 tasas; sin desbordes. Solo el redondeo del margen manual en el 0,68 % de los casos. |
| Integridad de datos | 5 | Buena concurrencia optimista, transacciones y estados. Pero hay pérdidas silenciosas en flujos comunes (BUG-001, BUG-002), copias con datos vigentes (BUG-016), Ajustes sin versión (BUG-023) y casos de renumeración y restauración. |
| UI visual | 7 | Coherente, sin scroll horizontal y con 0 violaciones de axe. Defectos visibles en el PDF con descuentos (BUG-015) y detalles menores. |
| UX y usabilidad | 6 | El flujo completo cabe en ~26 a 30 acciones y aguanta los errores de red. Pero lo escrito se pierde sin aviso (BUG-011), las reglas de guardado se mezclan (BUG-057) y el foco se pierde (BUG-033). |
| Calidad de documentos | 6 | Montos exactos, multipágina correcta, sin dibujos, escape correcto. Fallan la medida del especial (BUG-005), las copias (BUG-016), «Aprobada por» (BUG-017) y la maqueta con descuentos o URL (BUG-015, BUG-018). |
| Resistencia a errores | 7 | Doble clic, sin red, plazos, JSON roto y caídas a mitad de una operación pasan. Fallan el validador de la IA frente a errores típicos y los fallos de envío invisibles. |
| Mantenibilidad | 7 | 1.541 pruebas unitarias y 102 E2E, documentación de reglas y contratos. Hay archivos muy grandes (`servicio.ts` con 2.102 líneas, `cotizador.tsx` con 1.833, `cotizacion-panel.tsx` con 1.807), normalizadores duplicados entre la pantalla y el PDF (BUG-039) y expresiones de redondeo copiadas (BUG-034). |
| Preparación para producción | 6 | Ya está en uso y el núcleo es sólido, pero cuatro P1 de dificultad baja o media afectan lo que recibe la fábrica. |

**Nota global ponderada: 6,5 / 10.** Pesos según el riesgo comercial: lógica 20 %, integridad 20 %, cálculos 15 %, documentos 15 %, resistencia 10 %, UX 8 %, producción 5 %, UI 4 %, mantenibilidad 3 %.

**Veredicto: APTO CON OBSERVACIONES.** No hay P0: no se encontraron cobros mal calculados, accesos indebidos ni corrupción de la base. El sistema puede seguir en uso. Antes del próximo deploy que active o amplíe el envío automático a la fábrica, conviene cerrar BUG-003 y BUG-022 (dificultad baja) y aplicar la mitigación de BUG-001 y la corrección de BUG-002. Mientras no se resuelvan BUG-006 a BUG-009, la vendedora debería revisar el panel después de cada mensaje al asistente.

---

## Los 10 problemas de mayor impacto

| # | Hallazgo | Corrección recomendada | Dificultad |
|---|---|---|---|
| 1 | BUG-001 · Una observación sin guardar se guarda en otra puerta del mismo modelo | `id` estable por ítem como `key` (mitigación: cerrar las ediciones al cambiar el orden) | Media (baja la mitigación) |
| 2 | BUG-003 · Viaja la orden de trabajo de otro pedido | Nombrar la OT por envío y verificar su sha256; incluir `data/integracion/` en la restauración | Baja |
| 3 | BUG-002 · Editar la emitida borra fotos, fábrica y correcciones de su revisión | Aplicar los cambios sobre la revisión o responder 409 `revision_abierta` | Baja-media |
| 4 | BUG-005 · El ancho de un marco o moldura especial no llega a la fábrica | Imprimir y enviar el ancho (acordar el contrato) u ocultar el campo | Media |
| 5 | BUG-004 · Un pedido que no llega a la fábrica no se avisa | Estado del envío visible en la nota, aviso a administración, tope de peso para las fotos | Media |
| 6 | BUG-006 · La IA copia valores de otro ítem sin aviso | Que la frase del ítem le gane a los valores conocidos | Media |
| 7 | BUG-010 · Cambiar el tipo de descuento lo borra | No interpretar el campo vacío como «quitar» | Baja |
| 8 | BUG-012 · Recotización silenciosa tras reimportar | Comparar con las líneas previas y dejar constancia | Media |
| 9 | BUG-013 · Starken calculado para otro pedido | Guardar la huella con la tarifa y avisar al cambiar | Media |
| 10 | BUG-011 · Lo escrito sin guardar se pierde al emitir | Registro de campos abiertos en el panel y aviso en el diálogo | Media |

Les siguen de cerca BUG-007, BUG-008 y BUG-009, los otros errores de la IA que el validador deja pasar, y BUG-019, la anulación retenida hasta 6 h.

---

## Notas de entorno

- **Cuidado con los puertos en `.env.local`.** `BETTER_AUTH_URL=http://127.0.0.1:3000` y la fábrica en `http://localhost:3000` usan el mismo puerto. Si el cotizador corre en el 3000, se enviaría los pedidos a sí mismo.
- **Repositorio intacto.** Durante la auditoría, `next dev` modificó `tsconfig.json` y `next-env.d.ts`. Al terminar se restauraron con `git checkout` y se borraron las cachés `.next-e2e/auditoria*`. El único cambio que dejó la auditoría es este informe, sin commit; la evidencia está fuera del repositorio.
