> **Anexo de la auditoría del 9–10 nov 2026.** Informe especializado tal como se entregó. Donde `../01_AUDITORIA_COMPLETA.md` §5.2 lo corrige (por ejemplo, los permisos de la vendedora: en producción todas las cuentas son administradoras), manda el informe consolidado. Las rutas `scratchpad/…` remiten a la evidencia de la sesión de auditoría, que no se guarda en el repositorio.

# Auditoría de usabilidad del cotizador Neltume (vendedora sin conocimientos técnicos)

**Fecha:** 9 de noviembre de 2026 · **Rama:** `main` @ `a641645` · **Tipo:** solo lectura, sin cambios en el repositorio.
**Usuaria objetivo:** vendedora de tienda que atiende clientes cara a cara toda la jornada, con rol `user` (no administradora).
**Principio rector:** la aplicación se adapta a ella; cada vez que tiene que llamar a Alejandro, la interfaz falló.

## 0. Método, alcance y límites

- **Código leído:** `src/app/page.tsx`, `cotizador.tsx`, `cotizacion-panel.tsx`, `panel-totales.tsx`, `agregar-producto.tsx`, `alta-producto.tsx`, `dialogos-cotizacion.tsx`, `campo-editable.tsx`, `margenes.tsx`, `descuento-item.tsx`, `preguntas-pendientes.tsx`, `referencias-item.tsx`, `seguimiento-operacion.tsx`, `avisos.tsx`, `catalogo-consulta.tsx`, `configuracion-catalogo.tsx`, `gestion-manuales.tsx`, `catalogo/*`, `ajustes/secciones.ts`, `ayuda/page.tsx`, `clientes/*`, `login/*`, `globals.css`, `cotizacion*.css`, `cotizador-pantalla.css`. En el servidor: `api/catalogo/route.ts`, `api/accion/route.ts`, `servidor/chat.ts`, `servidor/servicio.ts` (permisos), `asistente/errores.ts`, `asistente/configuracion.ts`.
- **Capturas usadas:** `capturas/escritorio/*` y `capturas/telefono/*` (23-10-2026), `ui-audit/2026-10-22/shots/*` (22-10-2026), `docs/propuesta-visual-cotizador.png`. **Todas son anteriores** a los cambios de UI del 26–28 oct (13 commits en `src/app` desde el 23-10). Por eso ningún hallazgo se apoya *solo* en una captura: cuando uso una, verifiqué el comportamiento en el código actual y lo indico.
- **No hice:** levantar la app, `npm run ss`, pruebas con usuarias, ni medir tiempos reales. Los conteos de pasos salen de leer el código (clics/teclas mínimos, sin contar escribir texto libre).
- **Auditoría del 26-10:** sus 65 hallazgos figuran cerrados (`docs/auditoria-2026-10-26.md`). Solo repito los que siguen vigentes en el código (están marcados «sigue vigente»).
- **Confianza:** «confirmado» = leído literalmente en el código actual (o en una captura cuyo comportamiento confirmé en el código). «Probable» = deducido de varias lecturas sin ejecutarlo. «Hipótesis» = requiere observar usuarias.

---

## 1. Resumen ejecutivo

El cotizador es honesto y cuidadoso: mensajes en español claro, confirmación antes de lo irreversible, deshacer de productos, papelera, foco y teclado trabajados, y una ayuda que explica los estados. **El problema no es la calidad, es el reparto del poder:** lo que la vendedora necesita para salir de un apuro (corregir un producto que creó, enseñarle al asistente un nombre que no entiende, entender qué es una «familia») está detrás del rol administrador o en ninguna parte. Y el chat y el editor manual ofrecen **capacidades distintas sin decirlo**: lo rápido (varios productos de una vez, «otra igual») solo existe por chat; lo seguro (deshacer, reordenar, fotos, pagos) solo a mano.

Los cinco hallazgos de mayor impacto:

1. **La vendedora no puede corregir un producto que ella misma agregó al catálogo** (UX-01, P0). «Gestionar catálogo» es solo admin, y el alta pide «precio base sin IVA, no el de venta»: un error de precio queda vivo en todas las cotizaciones nuevas hasta que Alejandro lo corrija.
2. **No puede enseñarle al asistente una palabra que no entiende** (UX-02, P1). «Nombres y alias» es solo admin; no hay «recordar este nombre» desde el pendiente.
3. **Agregar varios productos a mano es lento**: el diálogo se cierra tras cada producto y no existe «duplicar línea» (UX-03, UX-04, P1).
4. **Mientras el asistente piensa (hasta 60–90 s), toda la cotización queda bloqueada**, la navegación también (UX-06, P1).
5. **Costo de fábrica y ganancia a la vista del cliente** en la misma pantalla en que se atiende de frente (UX-07, P1).

---

## 2. Mapa de recorridos: actuales vs propuestos

Conteo = acciones mínimas (clic, tecla Enter/Tab que confirma, elección en lista). No cuenta escribir el texto en sí. Fuente: lectura del código citado.

| # | Tarea | Hoy (pasos) | Dónde se traba | Propuesto (pasos) | Cambio que lo logra |
|---|---|---|---|---|---|
| T1 | Primera cotización por chat (1 puerta, cliente, PDF) | **5**: escribir + Enter · «Medida de hoja/vano» · «Emitir y generar PDF» · confirmar diálogo · (ver/descargar PDF) | El bloqueo «Resolver medida» (sigue vigente, `cotizacion-panel.tsx:1698-1702`) | **4** | Hoja/vano con valor por omisión configurable o pregunta dentro del diálogo de emisión (UX-12) |
| T2 | Primera cotización a mano (1 puerta + nombre del cliente) | **13**: «Agregar producto del catálogo» · buscar · elegir resultado · cantidad · ancho · alto · hoja/vano · «Agregar al pedido» · abrir «Cliente y facturación» · clic en Nombre · Guardar · «Emitir» · confirmar | Cada campo del cliente es clic + escribir + «Guardar» (`campo-editable.tsx:207-220`) | **9** | Ficha de cliente como formulario normal con autoguardado (UX-10) |
| T3 | Agregar 4 productos distintos a mano | **≈24** (6 por producto: abrir diálogo, buscar, elegir, ajustar 2 medidas, agregar) | El diálogo se cierra tras cada alta (`cotizador.tsx:1156`) | **≈14** | «Agregar y seguir» que conserva búsqueda y deja el diálogo abierto (UX-03) |
| T4 | Duplicar una línea cambiando solo el ancho | **≈8** a mano (rehacer el alta completa) o 1 mensaje de chat con «otra igual pero de 90» | No hay «Duplicar línea» (`grep duplicar` solo encuentra duplicar cotización) | **3**: menú de la fila → «Duplicar» → cambiar ancho | UX-04 |
| T5 | Cambiar la medida de una puerta | **5**: «Editar detalles» · clic Ancho · escribir · «Guardar» · (si sale del catálogo) decidir «Cotizar como especial» | Medidas escondidas en un desplegable y sin sugerencia de medidas válidas | **3** | Medida editable en la propia fila, con las medidas del catálogo como opciones (UX-11) |
| T6 | Cotizar algo especial (puerta según foto) | **≈12**: «Agregar producto» · «Crear producto personalizado» · 8 campos · foto · «Agregar al pedido» | Funciona, pero no se descubre desde el chat ni desde la ayuda | **≈10** | Botón «No está en el catálogo» visible en el resultado vacío y mención en la ayuda (UX-15) |
| T7 | Modificar una cotización emitida | **4+**: «Modificar» · cambios · «Emitir» · confirmar | Por chat no hace falta «Modificar»: el primer mensaje ya crea la revisión (dos reglas distintas, UX-13) | **4** | Misma regla en ambos caminos |
| T8 | Modificar una aprobada con anticipo | **No se puede**: «Duplicar» → número nuevo, o pedir a admin | «Deshacer aprobación» solo sin pagos (`seguimiento-operacion.tsx:456-458`) | Igual + explicación | Diálogo que explica las salidas posibles (UX-21) |
| T9 | Crear una puerta nueva en el catálogo | **≈12**: Catálogo · Agregar producto · familia · modelo · madera · ancho mín · ancho máx · alto · precio · «Revisar propuesta» · «Confirmar y guardar» | No puede corregirla después (UX-01); «familia», «ancho mínimo/máximo» sin explicar | **≈9** y corregible | UX-01, UX-09 |
| T10 | Encontrar un producto desde Catálogo y cotizarlo | **Callejón sin salida**: «Consultar» no tiene «Agregar a la cotización»; hay que ir a Cotizar y buscar de nuevo | `catalogo-consulta.tsx` sin acción por fila | **2** | «Cotizar este» en cada fila (UX-16) |
| T11 | Recuperarse de un descuento o dato de cliente mal puesto | Reescribirlo; «Deshacer» no lo cubre (`ayuda/page.tsx` «se corrigen escribiéndolos de nuevo») | Historial de deshacer solo guarda `solicitudes` (`cotizador.tsx:163-175`) | **1** (Ctrl+Z) | UX-08 |
| T12 | El asistente no entiende «willow» | Llamar a admin para que lo agregue en «Nombres y alias» | Sección solo admin (`catalogo/page.tsx:22-26`) | **2**: en el pendiente, «Es Huilo Huilo» + «Recordar» | UX-02 |

---

## 3. El asistente y el editor manual

### 3.1 ¿El chat tapa o compite con la cotización?

- **En escritorio no la tapa, pero le quita espacio fijo.** La grilla da `minmax(340px, .85fr)` al chat y `1.35fr` a la cotización (`cotizador-pantalla.css:10`); entre 801 y 1100 px el chat sigue con 285 px (`:612`). Se puede contraer («← Contraer asistente», `cotizador.tsx:1512-1522`) y la preferencia es **por cotización**: al abrir otra, vuelve a expandirse (`cotizador.tsx:183-186`). Quien trabaja a mano tiene que contraerlo cada vez. (Confirmado.)
- **En teléfono compiten por la pantalla**: dos pestañas «Pedido / Cotización» (`cotizador.tsx:1488-1505`). Tras un mensaje de chat la vista **no cambia sola** a la cotización (solo al agregar un producto, `:1155`, o al duplicar); el aviso es el contador «(N pendientes)» en la pestaña y el botón «Ver cotización →». (Confirmado.)
- **Compiten de verdad mientras el asistente responde**: `ocupado = enCurso !== null` (`cotizador.tsx:253`) deshabilita todo el editor, y el encabezado bloquea la navegación con «Espera la respuesta del asistente o cancélala» (`encabezado.tsx:26`). El plazo por intento es 60 s y el total hasta intento + 30 s (`asistente/configuracion.ts:4-12`). Ver UX-06.
- **Los pendientes se responden en tres sitios a la vez**: botones bajo la última respuesta del chat (`cotizador.tsx:1617-1631`), el mismo `PreguntasPendientes` dentro de «Completar producto» de cada fila (`cotizacion-panel.tsx:1110-1117`), el aviso hoja/vano de la fila (`:907-925`) y la lista del pie (`:1774-1797`). Es útil que cualquiera sirva, pero nada dice que son **la misma pregunta**. La captura `ui-audit/2026-10-22/shots/chat-faltantes.png` lo muestra (botones 2,40/2,50 m en el chat y «Falta confirmar la medida» en la fila); el código actual mantiene ambos. (Confirmado en código; la captura es anterior al agrupado del 26-10.)

### 3.2 Qué se puede hacer solo por chat, solo a mano o en ambos

| Capacidad | Chat | A mano | Nota |
|---|---|---|---|
| Varios productos en un mensaje | ✔ | ✘ (de a uno, el diálogo se cierra) | UX-03 |
| «Otra igual», repetir valores de otra línea | ✔ (`asistente/anclaje.ts:134-165`) | ✘ (no hay «Duplicar línea») | UX-04 |
| Buscar y reabrir una cotización anterior por cliente («la de Juan Pérez») | ✔ (selector de referencias, `cotizador.tsx:1675-1730`) | Historial | — |
| Registrar aprobación | ✔ («el cliente aprobó la N° 325») | ✔ | — |
| Repartir ítems entre fábricas | ✔ | ✔ «Repartir entre fábricas» | — |
| Cambiar número de cotización o nota | Solo admin (el servidor lo rechaza, `servicio.ts:2037-2038`) | Solo admin («Cambiar N°») | La pantalla promete «Por chat puedes… cambiar su número» a todas (UX-20) |
| Precio especial, «+ IVA», descuento por ítem | ✔ | ✔ | — |
| Deshacer | ✘ (no hay intención de deshacer) | ✔ Ctrl+Z, solo productos | UX-08 |
| Ganancia por línea / de la cotización | ✘ («Los montos se muestran en la cotización») | ✔ | Bien: protege del error del modelo |
| Reordenar, quitar con confirmación | quitar ✔ / reordenar ✘ | ✔ | — |
| Fotos del cliente (referencias) | ✘ | ✔ | — |
| Pagos, notas de pedido, producción, despacho, facturación | ✘ | ✔ | Correcto |
| Enseñar un alias que no entiende | ✘ | Solo admin | UX-02 |
| Preguntar «¿qué maderas hay del Molco?» | Parcial (responde sin montos) | Catálogo → Consultar | La capacidad no se anuncia (UX-17) |

**Conclusión:** hoy el chat es la vía rápida para *armar*, y el editor la vía segura para *corregir y operar*. Está bien, pero la interfaz no lo dice y deja huecos en ambos sentidos (repetir líneas a mano; deshacer por chat).

---

## 4. «¿Por qué necesitaría ayuda de Alejandro?»

| Tarea | ¿Puede sola? | Por qué no / qué falta | Hallazgo |
|---|---|---|---|
| Crear una puerta | Sí, crearla | No puede corregirla ni borrarla después; si puso precio de venta en vez de base, sobrecotiza un 25 % hasta que admin la arregle | UX-01 |
| Entender una familia | No | «Familia» con opciones Puerta / Marco / Piezas T / Moldura sin definición en el formulario, en la ayuda ni en el glosario (no hay glosario) | UX-09 |
| Encontrar un producto | Sí | Callejón sin salida en Catálogo → Consultar; máximo 24 resultados | UX-16 |
| Cambiar medidas | Sí | Escondido en «Editar detalles»; si cae fuera del catálogo, aparece «Cotizar como especial» sin explicar qué precio poner | UX-11 |
| Cotizar algo especial | Sí | Poco descubrible | UX-15 |
| Duplicar una línea | Solo por chat | — | UX-04 |
| Productos repetidos | Por chat sí; a mano lento | — | UX-03 |
| Modificar emitida | Sí | Reglas distintas chat vs. mano | UX-13 |
| Modificar aprobada con pagos | No | Duplicar o admin | UX-21 |
| Recuperarse de un error | Parcial | Deshacer solo productos y solo en esa sesión de esa cotización | UX-08 |
| Usar la IA | Sí | Si no entiende un nombre, no puede enseñárselo; 25 mensajes del sistema mandan a «quien administra» | UX-02, UX-18 |
| Olvidó la contraseña | No | Solo otra cuenta admin la restablece (`ayuda/page.tsx`) | Aceptable en uso interno |

---

## 5. Hallazgos

Formato: Severidad (Crítica/Alta/Media/Baja) · Prioridad (P0–P3) · Esfuerzo (S ≤1 día, M 2–4 días, L >1 semana).

### UX-01 · La vendedora no puede corregir el producto que ella misma agregó al catálogo
- **Severidad:** Alta · **Prioridad:** P0 · **Categoría:** Prevención/recuperación de errores, permisos · **Esfuerzo:** S–M · **Confianza:** confirmado
- **Archivo/líneas:** `src/app/catalogo/page.tsx:22-26` (secciones `manuales`, `configuracion`, `importar` solo admin); `src/app/catalogo/pantalla-catalogo.tsx:30` (rol user ve solo «Consultar» y «Agregar producto»); `src/app/api/catalogo/route.ts:201-210` (`editar` y `listar_productos` → 403 «Solo quien administra el catálogo puede modificar productos importados.»); `src/app/alta-producto.tsx:376-380` («Ingresa el precio base sin IVA, no el de venta: las cotizaciones le suman 25 %…»); `src/app/preguntas-pendientes.tsx:78-81,115-130` (alta directa desde un pendiente del chat).
- **Evidencia:** captura `capturas/escritorio/16-catalogo-agregar.png` (vigente en código: textos idénticos en `alta-producto.tsx:376-480`). El mensaje 403 habla de «productos importados» incluso para uno agregado a mano.
- **Por qué importa:** la alta se ofrece en dos sitios (Catálogo y el botón «Agregar al catálogo»/«Es un modelo nuevo» del pendiente), el formulario pide un dato fácil de confundir (costo vs. venta) y el error se propaga a todas las cotizaciones nuevas. La única salida es llamar a Alejandro.
- **Arreglo recomendado:** permitir que una cuenta `user` edite y elimine **los productos manuales que ella creó** (o todos los manuales) durante N días; los de planilla siguen siendo de admin. Mostrar en la revisión el precio que verá el cliente («Así quedará en la cotización: $181.250 sin IVA») para que el error salte antes de guardar. Corregir el texto del 403.
- **Causa raíz:** el permiso se pensó por sección, no por propiedad del dato.
- **Observado vs esperado:** observado: crea y no puede deshacer. Esperado: quien crea, corrige.
- **Pruebas requeridas:** e2e con cuenta `user`: crear producto manual, editar su precio, eliminarlo y restaurarlo; API: `user` no puede editar uno de planilla; unitaria del texto de 403.

### UX-02 · No hay forma de enseñarle al asistente un nombre que no entiende sin ser admin
- **Severidad:** Alta · **Prioridad:** P1 · **Categoría:** IA, autonomía · **Esfuerzo:** M · **Confianza:** confirmado
- **Archivo/líneas:** `src/app/catalogo/page.tsx:23` (`configuracion` = «Nombres y alias», solo admin); `src/app/configuracion-catalogo.tsx:486-487` («Aquí se le enseña al asistente esas otras formas de decirlo»); `src/servidor/chat.ts` respuestas «No encontré el modelo “…”», «¿Te refieres a …? Confírmalo para cotizar.»
- **Evidencia:** captura `capturas/escritorio/18-catalogo-configuracion.png` (la pantalla existe y es buena, pero solo para admin).
- **Por qué importa:** cada vez que un cliente dice «willow», «pino», «enchapada», la vendedora resuelve el pendiente a mano y al día siguiente vuelve a pasar. Es la fricción de IA más repetitiva.
- **Arreglo recomendado:** cuando la vendedora elige «¿Te refieres a Huilo Huilo?» o corrige el modelo en la fila, ofrecer **«Recordar que “willow” es Huilo Huilo»** (una casilla). Guardarlo como propuesta que aplica de inmediato a su cuenta y que admin aprueba o revierte en «Nombres y alias» (cola «Sugeridos por vendedoras»).
- **Causa raíz:** el diccionario de alias se trata como configuración global y no como aprendizaje del uso.
- **Observado vs esperado:** observado: pendiente recurrente. Esperado: aprendizaje en un clic.
- **Pruebas requeridas:** e2e: pendiente «modelo_posible» → «Recordar» → nueva cotización con la misma palabra no queda pendiente; admin ve la sugerencia y puede rechazarla.

### UX-03 · Agregar varios productos a mano obliga a reabrir el diálogo y repetir la búsqueda
- **Severidad:** Media · **Prioridad:** P1 · **Categoría:** Eficiencia · **Esfuerzo:** S · **Confianza:** confirmado
- **Archivo/líneas:** `src/app/cotizador.tsx:1144-1172` (`agregarItem` → `setAgregandoProducto(false)`); `src/app/agregar-producto.tsx:30-62` (la búsqueda vive en el diálogo y se pierde al cerrarlo).
- **Evidencia:** `setAgregandoProducto(false); setVistaMobile('cotizacion');` tras cada alta.
- **Por qué importa:** un pedido típico de obra trae 3–10 líneas (puertas de 70, 80 y 90; marcos; molduras). A mano son ~6 acciones por línea.
- **Arreglo recomendado:** dos botones en `SeleccionProducto`: «Agregar y cerrar» y «Agregar y seguir» (vuelve a resultados con la búsqueda intacta y un contador «3 agregados»).
- **Causa raíz:** diseño pensado para el producto suelto.
- **Observado vs esperado:** 24 acciones para 4 líneas vs ~14.
- **Pruebas requeridas:** e2e agregando 3 productos sin cerrar el diálogo; foco vuelve al buscador; Escape cierra.

### UX-04 · No existe «Duplicar línea»
- **Severidad:** Media · **Prioridad:** P1 · **Categoría:** Eficiencia, paridad chat/manual · **Esfuerzo:** S · **Confianza:** confirmado
- **Archivo/líneas:** `src/app/cotizacion-panel.tsx:1051-1084` (acciones por fila: ↑, ↓, ×); `grep -n duplicar src/app/*.tsx` solo devuelve duplicar cotización (`cotizacion-panel.tsx:1746`, `cotizador.tsx:1175`).
- **Evidencia:** la fila solo tiene mover y quitar.
- **Por qué importa:** «la misma pero de 90» es el caso más común; por chat se puede («otra igual»), a mano no.
- **Arreglo recomendado:** botón «Duplicar» (icono + texto en el menú de la fila) que inserta una copia debajo con foco en su ancho; cubierto por Deshacer.
- **Causa raíz:** acciones por fila mínimas.
- **Observado vs esperado:** 8 pasos vs 3.
- **Pruebas requeridas:** unitaria de la acción `duplicar_item` (nuevo `id`, referencias copiadas o no según decisión); e2e + Deshacer.

### UX-05 · Las capacidades del asistente no se anuncian y su límite aparece tarde
- **Severidad:** Media · **Prioridad:** P2 · **Categoría:** Descubrimiento, IA · **Esfuerzo:** S · **Confianza:** confirmado
- **Archivo/líneas:** `src/app/cotizador.tsx:1563-1595` (bienvenida: solo «Indica el modelo, la madera, las medidas y la cantidad…» y un ejemplo); `src/servidor/chat.ts` «Puedo ayudarte con modelos, maderas, medidas, cantidades y datos del cliente. Los montos se muestran en la cotización.»
- **Evidencia:** la bienvenida desaparece en cuanto hay conversación (`conConversacion`, `:1544`).
- **Por qué importa:** no sabe que puede pedir «otra igual», «las Coz Coz van a Santiago», «el cliente aprobó la 325», «la de Juan Pérez, cámbiale la cantidad»: son los atajos que más ahorran.
- **Arreglo recomendado:** chips contextuales sobre el compositor según el estado (borrador: «Agregar otra igual», «Poner flete», «Datos del cliente»; emitida: «El cliente aprobó»; aprobada: «Repartir entre fábricas»). Al tocar, rellenan el texto, no envían.
- **Causa raíz:** el chat es una caja de texto vacía tras el primer turno.
- **Observado vs esperado:** capacidades ocultas vs sugeridas en contexto.
- **Pruebas requeridas:** e2e por estado verificando chips; métrica de uso (sección 8).

### UX-06 · Mientras el asistente responde, se bloquea toda la cotización y la navegación
- **Severidad:** Alta · **Prioridad:** P1 · **Categoría:** Control y libertad, rendimiento percibido · **Esfuerzo:** M · **Confianza:** confirmado (bloqueo) / probable (duración en producción)
- **Archivo/líneas:** `src/app/cotizador.tsx:253` (`const ocupado = enCurso !== null`); `cotizacion-panel.tsx:454` (`editable = admiteCambios && !ocupado`); `encabezado.tsx:26` (`MOTIVO_BLOQUEO`); `asistente/configuracion.ts:4-12` (60 s por intento, hasta +30 s).
- **Evidencia:** cualquier operación en curso, incluido el chat, deshabilita todos los campos y botones del panel.
- **Por qué importa:** con un cliente al frente, 20–60 s sin poder corregir una cantidad ni abrir otra cotización se siente como un cuelgue. Solo existe «Cancelar».
- **Arreglo recomendado:** durante `enCurso === 'chat'`, dejar la cotización en **solo lectura visible con un aviso** («El asistente está aplicando tu mensaje… puedes seguir mirando») y permitir navegar a Historial en otra pestaña; mostrar segundos transcurridos a partir de 10 s y «Sigue trabajando» a los 30 s.
- **Causa raíz:** un único semáforo `ocupado` para todo.
- **Observado vs esperado:** todo bloqueado vs lectura disponible y progreso visible.
- **Pruebas requeridas:** e2e con LLM simulado lento: el panel se puede leer, la ayuda de progreso aparece, cancelar sigue funcionando; ninguna edición concurrente se pierde (409 controlado).

### UX-07 · Costo de fábrica y ganancia visibles en la pantalla que ve el cliente
- **Severidad:** Alta · **Prioridad:** P1 · **Categoría:** Contexto de uso, privacidad comercial · **Esfuerzo:** S · **Confianza:** confirmado (lo que se muestra) / hipótesis (que la pantalla mire al cliente)
- **Archivo/líneas:** `src/app/cotizacion-panel.tsx:1154-1160` («Costo de fábrica $X · Precio al cliente $Y»); `margenes.tsx:96-125` («Ganancia de la línea (%)», «Ganancia estándar: 55 % · Ganancia aplicada…»); `margenes.tsx:161-163` («Ganancia especial de la cotización · Por categoría»); `catalogo-consulta.tsx:141-142` («costo de fábrica + ganancia»).
- **Evidencia:** captura `capturas/escritorio/03-cotizacion-borrador.png` muestra «Ganancia especial de la cotización · Por categoría · Editar» bajo la tabla (la fila sigue en `cotizacion-panel.tsx:1607`).
- **Por qué importa:** atendiendo de frente o girando el monitor, el cliente lee el margen. También es ruido para la tarea principal.
- **Arreglo recomendado:** «Modo cliente» (por omisión) que oculta costo y ganancia tras un botón «Ver costos» que se vuelve a ocultar al cambiar de cotización; en teléfono, siempre oculto.
- **Causa raíz:** la vista de trabajo interno y la vista para mostrar son la misma.
- **Observado vs esperado:** margen siempre visible vs visible a pedido.
- **Pruebas requeridas:** e2e: por omisión no aparece «Costo de fábrica» ni «Ganancia»; tras «Ver costos» sí; lector de pantalla anuncia el cambio.

### UX-08 · Deshacer cubre solo productos y se pierde al cambiar de cotización (sigue vigente)
- **Severidad:** Media · **Prioridad:** P1 · **Categoría:** Recuperación de errores · **Esfuerzo:** M · **Confianza:** confirmado
- **Archivo/líneas:** `src/app/cotizador.tsx:144-175` (`HistorialEdicion` guarda `SolicitudItem[][]`; `registrarCambioItems` compara solo `solicitudes`); `:657` (`vaciarHistorialEdicion` al abrir otra); `ayuda/page.tsx` «Los datos del cliente, el descuento o el despacho se corrigen escribiéndolos de nuevo.»; en teléfono «Deshacer» va dentro de «Editar ▾» (`cotizacion-panel.tsx:658-661`, captura `capturas/telefono/03-cotizacion-borrador.png`).
- **Por qué importa:** un descuento general, un flete o el nombre del cliente cambiados por error (o por el chat) no se revierten; el miedo a equivocarse frena el uso de la IA.
- **Arreglo recomendado:** ampliar el historial a cliente, descuento, flete, observaciones y ganancia (mismo mecanismo `restaurar_items` extendido); en teléfono, «Deshacer» como aviso con acción tras cada cambio («Cantidad cambiada a 4 · Deshacer»), que ya existe para borrar borradores.
- **Causa raíz:** el deshacer se implementó sobre la lista de ítems.
- **Pruebas requeridas:** e2e: cambiar descuento → Ctrl+Z lo restaura; cambio del chat sobre el cliente → deshacer; persistencia mientras la cotización está abierta.

### UX-09 · Términos internos sin explicar (familia, Piezas T, escuadría, hoja/vano, revisión, nota de pedido…)
- **Severidad:** Media · **Prioridad:** P1 · **Categoría:** Terminología, ayuda · **Esfuerzo:** S · **Confianza:** confirmado
- **Archivo/líneas:** `src/catalogo/familias.ts:4-9` (Puerta, Marco, Piezas T, Moldura); `alta-producto.tsx:440-447` («Familia», «Elige una familia»), `:453` «Tipo (opcional)», `:456-460` «Ancho mínimo / Ancho máximo»; `negocio/pendientes.ts:66` («Sección o escuadría»); `configuracion-catalogo.tsx:60` («Familia de cada modelo»); `ayuda/page.tsx` sin glosario ni definición de familia.
- **Evidencia:** lista en la sección 6.
- **Por qué importa:** «familia» decide cómo se cotiza (medidas, flete, fábrica). Sin definición, la vendedora elige al azar o pregunta.
- **Arreglo recomendado:** glosario en Ayuda + ayuda en línea junto al selector («Puerta: hoja con ancho y alto. Marco: kit de jambas y dintel. Piezas T: … Moldura: …»); renombrar «Familia» → «Tipo de producto» (ya se usa así en `agregar-producto.tsx` «Tipo de producto») y «Tipo (opcional)» → «Variante (opcional, ej. “con vidrio”)»; explicar «Ancho mínimo/máximo» como «Este código sirve para anchos entre … y …».
- **Causa raíz:** el vocabulario del modelo de datos subió a la interfaz.
- **Pruebas requeridas:** prueba de comprensión con 3 vendedoras (5 min, sección 8); prueba de contenido que el glosario contenga cada término de la tabla.

### UX-10 · Dos reglas de guardado en la misma pantalla y un clic «Guardar» por campo (sigue vigente)
- **Severidad:** Media · **Prioridad:** P2 · **Categoría:** Consistencia, eficiencia, autoguardado · **Esfuerzo:** M · **Confianza:** confirmado
- **Archivo/líneas:** `campo-editable.tsx:207-220` (envío explícito con «Guardar»/Enter), `:360-366` («Sin guardar», «Guardar», «Cancelar»); `margenes.tsx:108` (`onBlur={() => void guardar()}`); `descuento-item.tsx:146` (`onBlur={guardarEscrito}`).
- **Evidencia:** la auditoría 26-10 (BUG-057) agregó la marca «Sin guardar» «mientras conviven los dos criterios»; siguen conviviendo.
- **Por qué importa:** en un campo salir guarda; en el de al lado salir **no** guarda. El cliente se completa con 3 acciones por dato.
- **Arreglo recomendado:** un solo criterio: autoguardado al salir del campo (con validación y «Guardado ✓» discreto), Escape cancela. Mantener el registro de campos sucios para el aviso al emitir.
- **Causa raíz:** componentes construidos en momentos distintos.
- **Pruebas requeridas:** e2e: editar nombre del cliente y hacer Tab → guardado; Escape → sin cambios; error de validación conserva el texto.

### UX-11 · Cambiar medidas está escondido y no ofrece las medidas válidas
- **Severidad:** Media · **Prioridad:** P2 · **Categoría:** Edición en línea, prevención de errores · **Esfuerzo:** M · **Confianza:** confirmado
- **Archivo/líneas:** `cotizacion-panel.tsx:1087-1105` (desplegable «Editar detalles»), `:1213-1281` (Ancho/Alto como texto libre); `agregar-producto.tsx:229-235` (el rango sí se conoce: «Este producto se cotiza con un ancho entre …»).
- **Por qué importa:** es la edición más frecuente tras la cantidad; el rango se descubre equivocándose.
- **Arreglo recomendado:** mostrar la medida en la fila como control editable y, al abrirlo, botones con las medidas del catálogo para ese modelo y madera (ya existen como opciones en `PreguntasPendientes`), más «Otra medida (especial)».
- **Pruebas requeridas:** e2e: cambiar 0,80 → 0,90 con un clic; medida fuera de catálogo muestra la opción especial con explicación.

### UX-12 · «Resolver medida» (hoja/vano) bloquea la emisión una vez por puerta (sigue vigente)
- **Severidad:** Media · **Prioridad:** P2 · **Categoría:** Eficiencia · **Esfuerzo:** S · **Confianza:** confirmado
- **Archivo/líneas:** `negocio/medidas.ts:5-18`; `cotizacion-panel.tsx:1698-1702`; `agregar-producto.tsx:220` (por omisión `'no_especificado'`, etiqueta «Por confirmar»), frente a `cotizacion-panel.tsx:1298` («No especificado»): **mismo valor con dos nombres**.
- **Arreglo recomendado:** preguntar hoja/vano una vez para toda la cotización en el diálogo de emisión («¿Las medidas son de hoja o de vano? Aplicar a las 6 puertas»), y unificar la etiqueta («Por confirmar»).
- **Pruebas requeridas:** e2e con 3 puertas sin tipo: una sola elección en el diálogo; texto idéntico en ambos sitios.

### UX-13 · Reglas distintas para modificar una emitida por chat y a mano
- **Severidad:** Baja · **Prioridad:** P2 · **Categoría:** Consistencia · **Esfuerzo:** S · **Confianza:** confirmado
- **Archivo/líneas:** a mano exige «Modificar» (`cotizacion-panel.tsx:592-611`); por chat basta escribir (`cotizador.tsx:1548-1551`, «Si escribes un cambio, se creará una revisión»).
- **Arreglo recomendado:** mismo modelo mental: el editor también puede crear la revisión al primer cambio con el aviso ámbar ya existente, o el chat pide «¿Crear revisión?» en el primer mensaje. Recomiendo lo primero (menos pasos).
- **Pruebas requeridas:** e2e de ambos caminos con el mismo resultado.

### UX-14 · Tres sistemas de estado paralelos en el seguimiento
- **Severidad:** Media · **Prioridad:** P2 · **Categoría:** Terminología, modelo mental · **Esfuerzo:** M · **Confianza:** confirmado
- **Archivo/líneas:** `negocio/estado.ts:45-80` (comercial: Pendiente, Enviada, En seguimiento, Aprobada, Rechazada/cancelada, Vendida; operativo: 9 estados); `seguimiento-operacion.tsx:449-451` («Comercial: … Operación: … Facturación: …»), `:463-465` («Marcar seguimiento», «Marcar rechazada»); la barra de pasos de 8 etapas (captura `capturas/escritorio/07-aprobada-seguimiento.png`).
- **Por qué importa:** «Aprobada» aparece como estado del documento y como estado comercial; «Marcar seguimiento» no dice qué hace; «Marcar rechazada» **anula** el documento (`:465`).
- **Arreglo recomendado:** una sola línea de tiempo (la barra de pasos) como verdad visible; ocultar «Comercial/Operación» a `user`; renombrar «Marcar seguimiento» → «Anotar que la estoy siguiendo» y «Marcar rechazada» → «El cliente la rechazó (anula)».
- **Pruebas requeridas:** prueba de comprensión; e2e de textos.

### UX-15 · Cotizar algo fuera de catálogo es posible pero poco descubrible
- **Severidad:** Baja · **Prioridad:** P2 · **Categoría:** Descubrimiento · **Esfuerzo:** S · **Confianza:** confirmado
- **Archivo/líneas:** `agregar-producto.tsx:156-165` (al pie del diálogo «¿El cliente pide un diseño que no está en el catálogo?»); `cotizacion-panel.tsx:818-890` («Cotizar como especial» / «Cotizar como ítem libre» como campos sin etiqueta visible, `etiquetaOculta`); la ayuda no menciona especiales ni ítems libres.
- **Arreglo recomendado:** en «No encontramos productos», el botón primario debe ser «Cotizarlo como especial con «<búsqueda>»»; en la fila pendiente, dos botones con explicación de una línea («Especial: va a fábrica con el precio que escribas · Ítem libre: no va a fábrica, p. ej. instalación»). Sección en Ayuda.
- **Pruebas requeridas:** e2e de búsqueda vacía → especial prellenado.

### UX-16 · Catálogo → Consultar es un callejón sin salida
- **Severidad:** Baja · **Prioridad:** P2 · **Categoría:** Navegación · **Esfuerzo:** S · **Confianza:** confirmado
- **Archivo/líneas:** `catalogo-consulta.tsx:94-142` (solo filtros, «Limpiar filtros», «Reintentar»; ninguna acción por fila).
- **Arreglo recomendado:** «Cotizar» en cada fila → abre Cotizar con el diálogo `SeleccionProducto` de ese código (cotización actual o nueva).
- **Pruebas requeridas:** e2e Catálogo → Cotizar → producto agregado.

### UX-17 · El asistente no orienta cuando no entiende
- **Severidad:** Media · **Prioridad:** P2 · **Categoría:** Mensajes de IA · **Esfuerzo:** S · **Confianza:** confirmado
- **Archivo/líneas:** `servidor/chat.ts`: «No entendí, ¿puedes reformularlo?»; «No agregué productos y tu mensaje parece un pedido. Escríbelo de nuevo con modelo, madera, medidas y cantidad.»; `La cotización N° ${numero} está ${objetivo.estado} y no se puede aprobar.` (inserta el valor interno del estado, p. ej. «reemplazada», en minúsculas).
- **Arreglo recomendado:** cada «no entendí» debe decir **qué entendió** y ofrecer el camino manual («Entendí: 3 puertas Huilo Huilo. No entendí la madera “olivillo”. [Elegir madera] [Agregar a mano]»); usar `etiquetaEstado` en vez del valor interno.
- **Pruebas requeridas:** casos en `evals/` para mensajes ambiguos con aserción sobre la presencia de «Entendí»; unitaria del texto con estado.

### UX-18 · 25 mensajes mandan a «quien administra el cotizador»
- **Severidad:** Media · **Prioridad:** P2 · **Categoría:** Mensajes de error, autonomía · **Esfuerzo:** S · **Confianza:** confirmado
- **Archivo/líneas:** `grep -rn "quien administra" src` = 25 apariciones; p. ej. `asistente/errores.ts:47,68`, `api/accion/route.ts:408`, `servidor/almacen.ts:1958`, `cotizador.tsx:91`.
- **Por qué importa:** son correctos técnicamente, pero varios casos tienen salida propia: un tiempo de espera («vuelve a enviar» ya está; el «si se repite, pide…» llega demasiado pronto), el asistente caído (se puede seguir **a mano**: no se dice).
- **Arreglo recomendado:** en cada uno, primero la salida propia («Mientras tanto puedes agregar productos con “Agregar producto”») y al final un botón «Avisar a Alejandro» que copie N°, hora y mensaje (sin enviar datos sensibles) para WhatsApp/correo.
- **Pruebas requeridas:** revisión de contenido de los 25 textos; e2e asistente no configurado → aparece el camino manual.

### UX-19 · Bordes de campos y controles con contraste 1,5:1
- **Severidad:** Media · **Prioridad:** P2 · **Categoría:** WCAG 2.2 · 1.4.11 Contraste no textual · **Esfuerzo:** S · **Confianza:** confirmado (cálculo) / probable (que sea el único indicador)
- **Archivo/líneas:** `globals.css:24` (`--line-strong: #cfd5c4`), usado como borde de campos y selectores en `cotizacion-interfaz.css:15,64,285`, `chat.css:49,85,151,211,413,449,650`, y en los campos del detalle del ítem (`cotizacion-interfaz.css:280-285`).
- **Evidencia:** sección 7: `--line-strong` sobre blanco 1,50:1; `--line` 1,34:1; `--accent-line` 2,88:1. Los campos tienen fondo blanco sobre panel blanco: el borde es su único contorno.
- **Arreglo recomendado:** borde de controles ≥3:1 (p. ej. `#8f9886` ≈ 3,0:1 sobre blanco; verificar) manteniendo `--line` para divisores decorativos.
- **Pruebas requeridas:** prueba automática de contraste de tokens (script como el de la sección 7) en CI; axe con regla de contraste no textual revisada a mano.

### UX-20 · La pantalla promete cambiar números por chat a cuentas que no pueden
- **Severidad:** Baja · **Prioridad:** P2 · **Categoría:** Prevención de errores, consistencia · **Esfuerzo:** S · **Confianza:** confirmado
- **Archivo/líneas:** `cotizador.tsx:1752-1756` («Por chat puedes repartir sus ítems entre las fábricas o cambiar su número o el de sus notas de pedido.», sin condición de rol); `cotizador.tsx:1584-1586` placeholder de aprobada; `servicio.ts:2037-2038` («Solo una cuenta administradora puede cambiar el número de un documento.»); `ayuda/page.tsx` «o pídeselo al asistente».
- **Arreglo recomendado:** condicionar el texto a `admin`; en la ayuda, «(solo cuentas administradoras, también por chat)».
- **Pruebas requeridas:** e2e con `user`: el texto no menciona números.

### UX-21 · Modificar una aprobada con anticipo no tiene camino explicado
- **Severidad:** Media · **Prioridad:** P2 · **Categoría:** Recuperación · **Esfuerzo:** S (texto) / L (flujo) · **Confianza:** confirmado
- **Archivo/líneas:** `seguimiento-operacion.tsx:456-458` («Deshacer aprobación… Disponible mientras no haya pagos, nota de pedido ni factura.»); `cotizador.tsx:1752-1754` («duplícala si necesitas una nueva versión»); `cotizacion-panel.tsx:614-622` («Corregir pedido», solo cantidad, medidas, hoja/vano, descripción y observación tras la nota).
- **Por qué importa:** el cliente que pagó el anticipo y cambia de madera es habitual; «Duplicar» crea otro número y deja el pago en la primera.
- **Arreglo recomendado (corto):** un botón «El cliente quiere cambiar algo» que explica en un diálogo las tres salidas según el estado (corregir pedido / deshacer aprobación / duplicar y trasladar el pago) y lleva a la que corresponde. **(Largo):** trasladar pagos al duplicar.
- **Pruebas requeridas:** e2e por estado: el diálogo ofrece solo las salidas válidas.

### UX-22 · El «Monto recibido» no sugiere el anticipo (sigue vigente)
- **Severidad:** Baja · **Prioridad:** P3 · **Categoría:** Eficiencia · **Esfuerzo:** S · **Confianza:** confirmado
- **Archivo/líneas:** `seguimiento-operacion.tsx:65` (`useState('')`), `:478` (`placeholder="0"`); `:269` ya calcula `pagoMinimoNP`.
- **Arreglo recomendado:** botones «Anticipo 50 % ($171.278)» y «Saldo total» que rellenan el monto.
- **Pruebas requeridas:** e2e del botón.

### UX-23 · Avisos informativos desaparecen a los 7 s
- **Severidad:** Baja · **Prioridad:** P3 · **Categoría:** WCAG 2.2.1 Tiempo ajustable, mensajes · **Esfuerzo:** S · **Confianza:** confirmado (duración) / probable (pérdida de información)
- **Archivo/líneas:** `avisos.tsx:14-16,31-33` (info 7 s, éxito 4 s); `cotizador.tsx:548,598` (los `avisos` del servidor, p. ej. «No apliqué el precio…», «Recotizado…», van como info). Para ediciones directas se copian al chat (`:601-608`), para respuestas del chat quedan en el historial; los de `efimera` (`:548`) no.
- **Arreglo recomendado:** los avisos que dicen «no apliqué» o «cambié un precio» deben persistir hasta cerrarlos (o en un registro visible «Cambios de esta cotización»).
- **Pruebas requeridas:** unitaria de `avisar` con categoría «advertencia» persistente.

### UX-24 · La preferencia de asistente contraído no se recuerda entre cotizaciones
- **Severidad:** Baja · **Prioridad:** P3 · **Categoría:** Personalización · **Esfuerzo:** S · **Confianza:** confirmado
- **Archivo/líneas:** `cotizador.tsx:179-186` (clave por `actual.id`), `:657` (`setAsistentePreferencia(null)` en «Nueva cotización»).
- **Arreglo recomendado:** recordar la preferencia por usuaria en `localStorage` (con try/catch), salvo aprobadas.
- **Pruebas requeridas:** e2e: contraer → nueva cotización → sigue contraído.

### UX-25 · Selección de modelo y madera en el detalle es texto libre sin sugerencias
- **Severidad:** Media · **Prioridad:** P2 · **Categoría:** Prevención de errores · **Esfuerzo:** M · **Confianza:** confirmado
- **Archivo/líneas:** `cotizacion-panel.tsx:1181-1210` (Modelo y Madera `CampoEditable` sin `sugerir`; solo el cliente tiene sugerencias, `:484-497` y `:1452`).
- **Por qué importa:** un error de tipeo deja el ítem pendiente; el catálogo ya conoce modelos y maderas válidos.
- **Arreglo recomendado:** usar `sugerir` con `/api/catalogo?q=` filtrado por familia.
- **Pruebas requeridas:** e2e: escribir «hui» → «Huilo Huilo»; elegir aplica y valoriza.

### UX-26 · El ejemplo que se ve no es el que se inserta
- **Severidad:** Baja · **Prioridad:** P3 · **Categoría:** Consistencia · **Esfuerzo:** S · **Confianza:** confirmado
- **Archivo/líneas:** `cotizador.tsx:78` (`'Cotiza 3 Huilo Huilo…'`) vs `:1577-1578` (muestra «“3 Huilo Huilo…”»).
- **Arreglo:** usar la misma constante en ambos. **Pruebas:** unitaria/e2e del texto insertado.

### UX-27 · Mensaje de validación confuso en la gestión de productos
- **Severidad:** Baja · **Prioridad:** P3 · **Categoría:** Mensajes · **Esfuerzo:** S · **Confianza:** confirmado
- **Archivo/líneas:** `gestion-manuales.tsx:107` («Con un rango de alto, el alto de referencia se toma del alto máximo.» presentado como error); `:504` «Medida (texto)» además de ancho mín/máx.
- **Arreglo:** convertirlo en ayuda, no en error, y explicar qué es «Medida (texto)» («cómo se imprime la medida, p. ej. 80-85 × 210»). **Pruebas:** unitaria de validación.

### UX-28 · Sin «Nueva cotización para este cliente» desde Clientes
- **Severidad:** Baja · **Prioridad:** P3 · **Categoría:** Navegación · **Esfuerzo:** S · **Confianza:** confirmado
- **Archivo/líneas:** `clientes/pantalla-clientes.tsx:85-179` (solo enlaces a cotizaciones existentes y al historial).
- **Arreglo:** botón que abre Cotizar con el cliente precargado. **Pruebas:** e2e.

---

## 6. Términos técnicos o internos expuestos

| Término | Dónde se ve | Riesgo | Propuesta |
|---|---|---|---|
| Familia | `alta-producto.tsx:440`, `catalogo-consulta.tsx:12,81` («Todas las familias»), `configuracion-catalogo.tsx:60` | Alto: decide cómo se cotiza | «Tipo de producto» + definición |
| Piezas T | `catalogo/familias.ts:7` | Alto: no se explica | Definición y dibujo |
| Moldura / Marco | ídem | Medio | Definición breve |
| PIEZAS_T, PUERTA, MARCO, MOLDURA (claves) | No visibles: `familias.ts` las traduce | — | Correcto |
| Escuadría / «Sección o escuadría» | `negocio/pendientes.ts:66`, `alta-producto.tsx:468-470` | Bajo para el rubro | Mantener con ejemplo «2×4» |
| Hoja / vano | `cotizacion-panel.tsx:909-912,1296-1300` | Medio; ya explicado | Unificar «Por confirmar» vs «No especificado» |
| Ancho mínimo / máximo (escalón) | `alta-producto.tsx:456-460`, `gestion-manuales.tsx:505` | Alto | «Este código sirve para anchos entre … y …» |
| Alias / «Se cambia solo» / «Podría ser» | `configuracion-catalogo.tsx:548-556` | Bajo (admin) | Bien explicado |
| Canónico | Solo comentarios (`configuracion-catalogo.tsx:207`) | — | — |
| Origen | No visible en Cotizar (solo código); «Formato detectado / etiquetaOrigen» en Importar (admin) | Bajo | — |
| Margen → «Ganancia», «Ganancia especial», «Por categoría», «Ganancia estándar/aplicada» | `margenes.tsx:18-27,96,161-163` | Medio + privacidad (UX-07) | «Ganancia de Neltume»; oculta por omisión |
| Costo de fábrica / Precio base sin IVA / Neto | `cotizacion-panel.tsx:1157`, `alta-producto.tsx:478-480`, `panel-totales.tsx` «Total sin IVA» | Alto en alta (UX-01) | Mostrar precio resultante |
| Descuento especial / Descuento / Descuento por cantidad / tramo / «Restaurar automático» | `descuento-item.tsx:128`, `panel-totales.tsx` | Medio: tres descuentos distintos | «Descuento de esta línea», «Descuento a todo», «Descuento por volumen (automático)» |
| Ítem libre / Personalizado / Especial | `cotizacion-panel.tsx:766-770`, `agregar-producto.tsx:300` | Medio | Ver UX-15 |
| Revisión / Reemplazada | `cotizacion-panel.tsx:584,598-600`, ayuda | Medio; explicado | Bien |
| Nota de pedido / fábrica / «Fábrica integrada» | `cotizacion-panel.tsx:617-620`, `seguimiento-operacion.tsx` | Bajo (vocabulario del negocio) | — |
| Comercial / Operación / Facturación; «Marcar seguimiento» | `seguimiento-operacion.tsx:449-465` | Medio (UX-14) | Una línea de tiempo |
| Pendiente / «Incompleto · no suma al total» / «Total parcial» | `cotizacion-panel.tsx:813-819,1672` | Bajo | Bien |
| Código interno asignado | `alta-producto.tsx:509` | Bajo | — |
| N° o identificador externo | `seguimiento-operacion.tsx:533` | Bajo | «N° de factura o boleta» |
| Exportar CSV | Historial (captura 12) | Bajo | «Descargar planilla (Excel)» |
| «Valores puestos en fábrica» | `cotizacion-panel.tsx:1816` | Bajo | Mantener (va al cliente) |

---

## 7. Contraste de tokens (`src/app/globals.css:9-40`)

Calculado con la fórmula WCAG (`scratchpad/ux/contraste.py`).

| Par | Ratio | Uso | Resultado |
|---|---|---|---|
| ink / blanco | 14,75 | texto | ✔ |
| muted / blanco | 5,93 | texto secundario | ✔ |
| muted / tonal (botón secundario) | 4,85 | texto | ✔ |
| subtle / blanco · papel · panel | 5,41 · 5,17 · 5,02 | placeholders | ✔ |
| subtle / pale | 4,70 | ✔ justo | ✔ |
| subtle / disabled-bg | 4,28 | texto deshabilitado | exento (1.4.3) |
| green / blanco | 9,90 | primario | ✔ |
| warm / blanco | 4,06 | solo bordes/adornos (no hallé `color: var(--warm)`) | vigilar |
| warm-text / blanco | 5,84 | «Agregar…», lápiz | ✔ |
| pending / amber-bg | 4,69 | pendientes | ✔ justo |
| danger / blanco | 7,03 | ✔ | ✔ |
| **line-strong / blanco** | **1,50** | **borde de campos y selectores** | **✘ 1.4.11 (UX-19)** |
| line / blanco | 1,34 | divisores | decorativo |
| accent-line / blanco | 2,88 | borde de ejemplo / cita | decorativo, ✘ si indica foco o estado |

Teclado y foco: contorno de 2 px, diálogos con trampa de foco, flechas para reordenar, atajos Alt+N y Ctrl/⌘+K y Ctrl+Z (confirmado en `cotizador.tsx:1430-1444`, `cotizacion-panel.tsx:396-415`). Regiones vivas para el chat (`cotizador.tsx:1735-1737`). Tamaños de objetivo ≥36 px (`cotizacion.css:382-388`). Sin hallazgos nuevos de teclado más allá de lo ya corregido el 26-10.

---

## 8. Mejoras por pantalla

| Pantalla | Mejoras (por orden) |
|---|---|
| **Cotizar · vacío** | Dos puertas de entrada del mismo peso: «Contar el pedido» (chat) y «Elegir del catálogo»; chips de ejemplo; recordar si la vendedora trabaja con el asistente contraído (UX-05, UX-24). |
| **Cotizar · borrador** | «Agregar y seguir» (UX-03); «Duplicar línea» (UX-04); medida editable en la fila con opciones (UX-11); Modelo/Madera con sugerencias (UX-25); autoguardado único (UX-10); costos ocultos (UX-07); hoja/vano una vez (UX-12). |
| **Cotizar · emitida** | Misma regla de revisión que el chat (UX-13). |
| **Cotizar · aprobada / seguimiento** | Una línea de tiempo (UX-14); botones de monto (UX-22); «El cliente quiere cambiar algo» (UX-21). |
| **Chat** | Chips contextuales; «Entendí / No entendí» con salida manual (UX-17); «Recordar este nombre» (UX-02); progreso con segundos (UX-06). |
| **Agregar producto (diálogo)** | Resultado vacío → especial prellenado (UX-15); mostrar el rango de medidas en cada resultado. |
| **Catálogo · Consultar** | «Cotizar» por fila (UX-16); definición de cada tipo de producto en el filtro (UX-09). |
| **Catálogo · Agregar producto** | Precio final visible en la revisión; poder corregir lo propio (UX-01); términos (UX-09). |
| **Catálogo · Gestionar / Nombres y alias** | Abrir lo propio a `user`; cola de sugerencias (UX-01, UX-02). |
| **Historial** | Mantener; renombrar «Exportar CSV». |
| **Clientes** | «Nueva cotización para este cliente» (UX-28). |
| **Ayuda** | Glosario; cómo cotizar especiales e ítems libres; qué puede hacer el asistente; «qué hacer si…» con los errores frecuentes (UX-09, UX-15, UX-05). |
| **Ajustes** | Las secciones de solo lectura para `user` deberían decir «Lo cambia la administración» arriba, no al final. |
| **Login** | Sin cambios de usabilidad relevantes. |

---

## 9. Propuestas para la IA en la interfaz

1. **Chips de intención por estado** (UX-05): rellenan el compositor; medir cuáles se usan.
2. **Eco de lo entendido** antes de aplicar cambios grandes: si el mensaje agrega ≥3 ítems o cambia el cliente, mostrar «Voy a agregar: … [Aplicar] [Corregir]». Hoy se aplica directo y se confía en Deshacer (que no cubre al cliente, UX-08).
3. **Aprendizaje de alias desde el pendiente** con revisión de admin (UX-02).
4. **«No entendí esta respuesta»** (pulgar abajo) en cada mensaje del asistente: guarda solo la categoría y la herramienta usada (el servidor ya registra `herramienta`, `avisos` y `ms` por turno sin texto, `api/accion/route.ts:569-575`). Da el indicador «mensajes no entendidos».
5. **Panel de cambios del asistente**: cada respuesta que modifica la cotización resalta las filas (ya existe `cambioVisual` 4,5 s, `cotizador.tsx:189-199`) y deja un resumen persistente con «Deshacer este cambio».
6. **Modo «solo editor»**: si la vendedora contrae el asistente, que se recuerde (UX-24) y que el compositor siga disponible como una barra de una línea («Pídele algo al asistente…») para no perder la vía rápida.
7. **Salida manual en cada fallo de la IA** (UX-18): el chat nunca debe ser el único camino.

---

## 10. Indicadores de usabilidad medibles

| Indicador | Definición | Cómo medirlo | Meta inicial |
|---|---|---|---|
| Tiempo a la primera cotización emitida | Desde «Nueva cotización» (o primer mensaje) hasta `emitir` OK | Eventos ya existentes en la actividad de la cotización (creación y emisión) | Mediana < 3 min para 1–3 líneas |
| Tasa de éxito sin ayuda | % de tareas de la sección 2 completadas sin intervención | Prueba moderada con 3–5 vendedoras, 12 tareas | ≥ 85 % |
| Llamadas a Alejandro | Nº de consultas por semana, por motivo | Registro manual simple (planilla) durante 4 semanas antes y después | −50 % |
| Pasos por tarea | Acciones mínimas por tarea (tabla de la sección 2) | Prueba e2e que cuenta clics por recorrido | Cumplir columna «Propuesto» |
| Errores por tarea | Validaciones fallidas + 409 + quitar/deshacer inmediatos | Contador de errores de validación por campo (cliente) y códigos de error (servidor) | Tendencia a la baja |
| Uso de Deshacer | Deshacer por cotización emitida | Contar `restaurar_items` por cotización | Señal: alto = errores frecuentes; ninguno = no se descubre |
| Pendientes por cotización | `incompletos` al emitir/primer mensaje | Servidor | Bajar con alias aprendidos |
| Pendientes recurrentes por palabra | Misma palabra no reconocida en ≥3 cotizaciones | Registro del turno (`categoria` de aviso) | Tendencia a cero tras UX-02 |
| Mensajes de la IA no entendidos | Pulgar abajo / respuestas seguidas de edición manual inmediata del mismo ítem | Propuesta 4 de la sección 9 | < 10 % de turnos |
| Proporción chat vs manual | Ítems creados por chat vs por «Agregar producto» | Origen del ítem (`fuente` presente = chat) | Observacional |
| Abandono de espera del asistente | «Cancelar» o tiempo agotado / turnos | Registro del turno (`ms`) | < 3 % |
| Productos manuales corregidos por admin | Ediciones de admin sobre productos creados por `user` | Registro del catálogo | Bajar tras UX-01 |

---

## 11. Orden de trabajo sugerido

- **P0:** UX-01.
- **P1:** UX-02, UX-03, UX-04, UX-06, UX-07, UX-08, UX-09.
- **P2:** UX-05, UX-10, UX-11, UX-12, UX-13, UX-14, UX-15, UX-16, UX-17, UX-18, UX-19, UX-20, UX-21, UX-25.
- **P3:** UX-22, UX-23, UX-24, UX-26, UX-27, UX-28.

Antes de construir P1, validar con una sesión de 45 minutos con 2–3 vendedoras las tareas T2, T3, T4, T9 y T12 (hipótesis de que son las que generan llamadas). Cada cambio de comportamiento debe revisar primero si una e2e documenta la intención actual (p. ej. el bloqueo hoja/vano y el cierre del diálogo tras agregar).
