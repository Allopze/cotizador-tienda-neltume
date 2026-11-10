# 02 · Plan de mejoras

Los hallazgos se citan por su id consolidado (`N-xx`, ver `01_AUDITORIA_COMPLETA.md`). Esfuerzo: XS menos de 2 h · S hasta 1 día · M de 2 a 5 días · L de 1 a 3 semanas.

**Reglas para todas las etapas:**

- Antes de cambiar un comportamiento, buscar si una E2E documenta la intención (`grep` en `tests/`). Si existe, decidir explícitamente y actualizar la prueba en el mismo cambio.
- Cada cambio en `src/servidor/chat.ts` o `src/asistente/` termina con `npm run evaluar:regresion`, usando el modelo de producción. Tiene costo: hay que aprobarlo antes de correrlo.
- El deploy lo corre el responsable del proyecto, con la suite completa en verde.

---

## Etapa 0 · Requisitos previos (antes de tocar código)

| # | Acción | Por qué | Responsable |
|---|---|---|---|
| 0.1 | Confirmar que existen respaldos diarios en producción y hacer uno manual verificado (`npm run respaldar` + `integrity_check`) | El informe de Los Ríos indica que no había respaldos después del 28 de octubre; las etapas 4 y 5 migran el catálogo | Responsable del servidor |
| 0.2 | Confirmar qué modelo de IA atiende en producción (Qwen o Haiku) | Las guardas y las evaluaciones dependen del modelo | Responsable |
| 0.3 | Decidir los roles (N-17): una sola cuenta-administradora documentada, o un rol «Vendedora» | Lo necesitan las etapas 3 y 5 | Neltume |
| 0.4 | Decidir: revisión con precios acordados (N-28), valor por omisión de hoja o vano (N-40), «modo cliente» (N-15) | Son reglas comerciales, no técnicas | Neltume |
| 0.5 | Puertos configurables en `scripts/e2e-paralelo.mjs` (N-31) | La suite es la compuerta del deploy y hoy choca con la E2E de la fábrica | Dev (XS) |

---

## P0 · Críticos (primera semana)

### P0-1 · «Corregir pedido» no recotiza lo aprobado (N-01)

- **Solución:** en `editarPedido` (`servicio.ts:2217-2245`), antes de `recalcular`, fijar `precioUnitario` y `costoFabrica` de cada línea **no editada** desde su copia en `cotizacion_lineas`. Recalcular solo las líneas cuyo modelo, madera o medida cambió. Si cambia el total, devolver la diferencia y pedir confirmación («El total pasa de $X a $Y por el cambio de medida del ítem 2»).
- **Archivos:** `src/servidor/servicio.ts`, `src/servidor/almacen.ts`; pruebas `tests/pedido-corregido.e2e.ts` y una unitaria nueva.
- **Dependencias:** ninguna. **Esfuerzo:** S–M.
- **Beneficio:** el monto aceptado por el cliente y enviado a la fábrica no cambia en silencio.
- **Criterios de aceptación:**
  1. Con el catálogo modificado un ±10 %, cambiar una observación deja idénticos el total, las notas y los montos por fábrica.
  2. Cambiar la medida de un ítem cambia solo ese ítem y muestra la diferencia antes de confirmar.
  3. El PDF regenerado muestra los mismos montos que la copia.
- **Riesgo de regresión:** medio. Toca la saga de emisión (N-37); cubrirla con `pedido-corregido.e2e.ts` y `notas-por-fabrica.test.ts`.

### P0-2 · Vista previa del alta con el margen real (N-02)

- **Solución:** el servidor devuelve en la propuesta `precioVenta = precioConMargen(costo, margenProducto(propuesta, reglas))` y la categoría usada. La pantalla muestra «Costo de fábrica $X → precio de venta $Y (Puertas sólidas oregón, ganancia 85 %)». Se quita `REGLAS.ajuste` de `alta-producto.tsx` y la frase «suman 50 % automáticamente».
- **Archivos:** `src/app/alta-producto.tsx`, `src/servidor/alta-catalogo.ts`, `src/app/api/catalogo/route.ts`. **Esfuerzo:** S.
- **Criterios de aceptación:** en las 11 categorías, la vista previa, la confirmación y la línea cotizada muestran el mismo número (prueba unitaria por categoría + E2E de alta → cotizar).
- **Riesgo de regresión:** bajo.

---

## P1 · Alta prioridad

Ordenados por dependencia y valor. Las semanas son orientativas para una persona.

### Bloque P1-A · El chat deja de bloquear a la persona (semana 1–2)

| # | Solución | Hallazgos | Archivos | Esfuerzo |
|---|---|---|---|---|
| A1 | **Detector de montos que no confunda medidas ni cantidades.** Aplicar `textoMonetario` solo a cifras con forma de dinero (`$`, «mil», «lucas», «pesos», «+ IVA», separador de miles ≥ 1.000 junto a una palabra de precio), y siempre permitir las medidas del catálogo y las cantidades enteras pequeñas. Mejor todavía: comparar contra los montos de la cotización y bloquear solo un monto **que no exista** en ella. | N-04 | `chat.ts:143-146,1259-1264`; `asistente/montos.ts` | S |
| A2 | **Los `null` de relleno son no-op silenciosos.** `fabrica: null` o `flete: null` sin pedido explícito se ignoran sin aviso; quitar algo pasa a ser una operación explícita (`quitar_fabrica`, `quitar_flete`, o un valor `"quitar"`). Se agrega la categoría de diagnóstico `interno` (`marcar`, `DiagnosticoTurno`), que se registra y no se muestra. Se reclasifican los avisos según la tabla del anexo IA. | N-10 | `chat.ts:229-260`; `asistente/flete.ts`; `asistente/esquemas.ts` | S |
| A3 | **Duplicados según su origen.** Un ítem agregado se descarta **en silencio** solo si es un reenvío: su `fuente` coincide con la de un ítem existente o no aparece en el mensaje actual. Si la frase está en este mensaje, se agrega, aunque sea idéntico a otro. La clave de reenvío se normaliza (tildes, cm ↔ m) para cerrar también N-23. | N-03, N-23 | `chat.ts:944-970` | S–M |
| A4 | **Operación declarativa `duplicar`** en `modificar_cotizacion`: `duplicar: [{indice, veces?, cambios?}]`. El servidor copia el ítem completo (precio especial, descuento, observaciones, fábrica, referencias) y aplica los cambios a la copia. La usa el mismo servicio que P1-B1. | N-05 (IA), H6 IA | `asistente/esquemas.ts`; `llm.ts` (prompt); `chat.ts` | M |
| A5 | **Rechazo parcial:** aplicar las partes válidas del turno y explicar el motivo concreto de la que no pasó; no hablar de fábricas si la causa fue el índice. | N-22 | `chat.ts` (`aplicarModificacion`) | M |

**Criterios de aceptación P1-A** (pruebas unitarias con respuestas simuladas, basadas en `scratchpad/ia/escenarios.test.ts`, más casos nuevos en `evals/cotizacion.json`):

1. «4 Ranco pino oregón: 0,85×2,20; 1,00×2,20; 0,85×2,20; 1,00×2,20» → 4 líneas.
2. «Agrega otra igual a la primera» → 2 líneas independientes.
3. «Duplica la Ranco y que la copia sea vidriada» → 2 líneas; la copia con la observación o descripción «vidriada» y el original intacto.
4. «Tres iguales, pero separadas» → 3 líneas.
5. La IA reenvía un ítem de un turno anterior, con tilde o en cm → no se duplica y no se avisa.
6. Ningún mensaje contiene «No quité…» cuando la persona no pidió quitar nada.
7. «¿Te refieres a la de 0,80 × 2,00?» llega tal cual a la usuaria; un monto inventado («sale $450.000») sigue bloqueado.
8. `evaluar:regresion` pasa los umbrales actuales con el modelo de producción.

**Riesgo de regresión:** alto en el chat; es la zona más vigilada por las evaluaciones. Hacer un cambio por PR y correr la evaluación en cada uno.

### Bloque P1-B · Edición de la cotización (semana 2–3)

| # | Solución | Hallazgos | Archivos | Esfuerzo |
|---|---|---|---|---|
| B1 | **«Duplicar línea»** en el menú de cada fila. Una acción de servidor `duplicar_item {id, indice, nuevoItemId}`, idempotente, inserta la copia debajo con todos los datos (precio especial, descuento, observaciones, referencias, fábrica, hoja o vano) y un `id` nuevo. El foco va a la copia, con el panel de detalle abierto. | N-05 | `cotizacion-panel.tsx`; `api/accion/route.ts`; `servicio.ts`; `negocio/items.ts` | M |
| B2 | **«Convertir en especial» conservando el precio.** En una línea con precio, la acción «Cambiar a producto especial» copia el precio unitario y el costo de fábrica actuales como punto de partida, y permite cambiar el nombre y la descripción. «Cotizar como especial» propone el precio de la línea de origen si existe. | N-19 | `cotizacion-panel.tsx:837-876`; `servicio.ts` | S–M |
| B3 | **Avisar la recotización en todas las acciones:** extender el aviso de BUG-012 a `quitar`, `agregar`, `reordenar` y `restaurar_items`, o mejor, no recotizar las líneas no tocadas en esas acciones. | N-12 | `servicio.ts:749,971,1003,1025` | S |
| B4 | **Medida en el PDF de especiales y líneas con descripción propia**, con «0,85 × 2,20 m» como subtítulo. Actualizar `tests/pdf.test.ts:317-335`, que hoy fija lo contrario. | N-13 | `negocio/personalizados.ts:134`; `precios.ts:151`; `servidor/pdf.ts:273-290` | S |
| B5 | **«Agregar y seguir»** en el diálogo de agregar producto: conserva la búsqueda y deja el diálogo abierto, con un contador «3 agregados». | N-18 | `cotizador.tsx:1156`; `agregar-producto.tsx` | S |
| B6 | **Deshacer completo:** el historial guarda la cotización editable completa (cliente, descuentos, flete, ganancia, observaciones), no solo `solicitudes`. | N-16 | `cotizador.tsx:163-175`; `servicio.ts` (`restaurar`) | M |
| B7 | **El aviso no tapa la tabla:** CSS `bottom: auto` en `.con-pedido .avisos`. | N-29 | `cotizador-pantalla.css:491-499` | XS |

**Criterios de aceptación P1-B:**

1. Duplicar la línea 1 y cambiar en la copia la medida, la descripción y el precio deja el original idéntico, y ambas persisten tras recargar desde el Historial (E2E).
2. Ranco → «Ranco vidriada» conserva el precio de partida y la línea no queda pendiente.
3. Borrador con el catálogo cambiado, luego quitar un ítem: sin aviso, los precios de las otras líneas no cambian; con aviso, se explica cuáles cambiaron.
4. El PDF de dos especiales con distinta medida las muestra distintas.
5. Cuatro productos a mano en 14 acciones o menos.
6. Ctrl+Z deshace un descuento general y un dato del cliente.

### Bloque P1-C · Catálogo comprensible, primera parte (semana 3–5)

Detalle completo en `05_REDISENO_FAMILIAS_CATALOGO.md`, etapas 1 a 3.

| # | Solución | Hallazgos | Esfuerzo |
|---|---|---|---|
| C1 | **Un solo buscador:** las palabras pasan por el resolutor de la IA (alias, tolerancia, plurales); se ignoran las palabras vacías; dos números se leen como ancho × alto y filtran por tramo; el código no participa en la comparación numérica; resultados **agrupados por modelo**, con «¿Quisiste decir…?». | N-07 | M |
| C2 | **Un solo camino para lo que no está en el catálogo:** «Producto especial (solo esta cotización)», con la pregunta «¿Lo fabrica Neltume?» (sí → especial que va a la fábrica; no → otro cargo). Desde un pendiente ya no se crean filas globales; en su lugar, «Pedir que se agregue al catálogo», que queda como solicitud. | N-08 | M |
| C3 | **Glosario y etiquetas** aplicados en toda la interfaz (tabla en 05 §3): «Tipo de producto», «Costo de fábrica», «Precio de venta», «Puerta ancha», «Otros nombres». | N-11 | S–M |
| C4 | **Ocultar o corregir los ajustes engañosos:** «Familia de cada modelo» indica «se aplica al importar la planilla» o se mueve a la ficha; el código de madera queda protegido, con un aviso que cuenta cuántos códigos cambiarían. | N-20, N-21 | S |

**Criterios de aceptación P1-C:** las 14 consultas que hoy dan 0 encuentran el producto o lo sugieren; «ranco 1,00 2,20» muestra primero RAN-x-5; con el rol de vendedora no existe un camino de un clic que cree filas globales; las etiquetas clave las verifica una E2E.

### Bloque P1-D · Asistente y pantalla (semana 5–6)

| # | Solución | Hallazgos | Esfuerzo |
|---|---|---|---|
| D1 | **El editor sigue usable mientras responde la IA:** bloquear solo las acciones que entran en conflicto (la emisión); la edición local va a una cola o la protege el 409 existente. Permitir navegar con un aviso. | N-14 | M |
| D2 | **«Modo cliente»:** costo y ganancia ocultos por omisión, con un interruptor visible. | N-15 | S |
| D3 | **Categoría de precio explícita** por modelo y madera (05, etapa 4). | N-09 | M |

---

## P2 · Media prioridad (después de P1, en paralelo con el rediseño del catálogo)

| Tema | Hallazgos | Solución resumida | Esfuerzo |
|---|---|---|---|
| Ficha de modelo, crear y duplicar modelos | N-06, N-32, N-33, N-34, N-35 | Documento 05, etapas 2–3 y 5 | L |
| Roles | N-17, N-45 | Según la decisión 0.3: documentarlo o crear el rol «Vendedora», con una prueba de autorización de todas las rutas (Arq M-05) | M |
| IA con alcance similar a la interfaz | N-24, N-25 | Herramienta `buscar_catalogo` (usa C1); separar objetivo y referencia en «igual a la Molco»; derivar a la acción manual cuando la IA no puede; eco «Voy a agregar…» en cambios grandes | M |
| PDF honesto | N-26 | «No incluye» y «puestos en fábrica» según el contenido real (instalación, vidrio, flete) | S |
| Idempotencia del primer producto | N-27 | `nuevoId` en `agregar_producto` y `agregar_personalizado` | S |
| Revisión con precios acordados | N-28 | Según la decisión 0.4: opción «Mantener precios de la versión emitida» | M |
| Accesibilidad | N-30, N-44 | Foco tras hoja o vano; bordes de 3:1 | S |
| Edición fluida | N-38, N-39, N-40, N-41, N-42, N-43 | Autoguardado uniforme; medida editable en la fila con las medidas válidas; hoja o vano dentro del diálogo de emisión; una sola regla para modificar emitidas; «Cotizar este» desde Consultar; salida propia antes de «quien administra» | M |
| Enseñar alias desde el pendiente | N-46 | «Es Huilo Huilo» + «Recordar», sujeto a revisión | M |
| Seguridad | N-36, N-48 | `better-auth` ≥ 1.7.7, `zod` ≥ 4.6.6; agregar `data/referencias/` a `.gitignore`; `chmod 600 .env.local`; límite por usuario en el chat, Starken y las subidas; quitar el token de `get-session`; CSP básica; PDF con `Content-Disposition: attachment` o en otro origen | S–M |
| Mantenibilidad | N-37 | Extraer la secuencia de emisión (4 copias → 1); dividir `procesarChat` y `Cotizador` **después** de P1-A y P1-B, con las pruebas como red | L |

## P3 · Refinamientos

Los de la tabla P3 de `01` §5.3: Escape en el buscador, doble clic en «Emitir», aviso de red repetido, historial con medidas, «Oregón» con tilde, código legible en lugar de `IA-`, actividad duplicada, «Cotización actualizada» sin cambios, «un metro», `precioConMargen` en Consultar, documentación del catálogo, avisos de 7 s, preferencia del asistente, anticipo sugerido, logs con id de solicitud, `server-only`, plazo del login E2E. Cada uno es XS–S.

---

## Orden recomendado de implementación

```
Semana 0  Etapa 0 (respaldos, modelo, roles, decisiones comerciales, puertos E2E)
Semana 1  P0-1 Corregir pedido · P0-2 Vista previa del alta · B7 aviso CSS
Semana 1-2  P1-A chat: A1 montos → A2 avisos internos → A3 duplicados por origen → A4 duplicar → A5 rechazo parcial
Semana 2-3  P1-B edición: B1 duplicar línea → B2 convertir a especial → B4 PDF con medida → B3 recotización → B5 → B6
Semana 3-5  P1-C catálogo: C1 buscador único → C2 producto especial único → C3 glosario → C4 ajustes
Semana 5-6  P1-D: D1 editor libre durante la IA → D2 modo cliente → D3 categoría de precio
Luego       P2 (ficha de modelo y creación con grilla, roles, alcance de la IA, seguridad) · P3
```

**Por qué en este orden:** primero lo que cambia dinero sin aviso (P0). Después, los bloqueos que la clienta reporta a diario, que son baratos (A1–A3, B1). A4 depende de B1 (el mismo servicio de copia). El rediseño del catálogo empieza por el buscador y el camino único del especial, que no tocan el esquema, y solo después migra el esquema (ficha de modelo), con respaldos verificados.

## Riesgos de regresión transversales

| Riesgo | Mitigación |
|---|---|
| Cambiar las guardas del chat reabre BUG-008, BUG-026 o BUG-030 | Casos de reenvío, `null` y montos inventados en las pruebas simuladas y en `evals/`; `evaluar:regresion` en cada PR |
| El rediseño del catálogo cambia precios | Migración con comparación de los 8.866 productos (precio, código, familia y descripción idénticos) |
| La integración con la fábrica espera los mismos códigos y familias | No tocar el enum `FamiliaCatalogo` ni los códigos de planilla; coordinar con la fábrica los códigos nuevos |
| Los archivos gigantes hacen difícil revisar los cambios | PRs pequeños; extraer la secuencia de emisión antes de tocar P0-1, si se puede |
| Pruebas que fijan el comportamiento actual | Actualizarlas en el mismo PR, con la decisión escrita |
