> **Anexo de la auditoría del 9–10 nov 2026.** Informe especializado tal como se entregó. Donde `../01_AUDITORIA_COMPLETA.md` §5.2 lo corrige (por ejemplo, los permisos de la vendedora: en producción todas las cuentas son administradoras), manda el informe consolidado. Las rutas `scratchpad/…` remiten a la evidencia de la sesión de auditoría, que no se guarda en el repositorio.

# Auditoría de lógica comercial del editor manual — Cotizador Neltume (9 nov 2026)

Alcance: el editor manual (agregar producto, detalle editable, deshacer, reordenar, quitar, especiales e ítems libres), el cálculo (precios, márgenes, descuentos, flete, IVA, redondeo), la máquina de estados (borrador → emitida → revisión/reemplazada → aprobada → nota), los conflictos de versión, el doble clic, las notas por fábrica, el PDF y el comportamiento de las cotizaciones históricas cuando cambia el catálogo. El asistente IA queda fuera de alcance; solo anoto en qué se diferencia del editor manual.

Método: leí el código y lo ejecuté de verdad. Los scripts usan `Servicio`, `Almacen`, `cotizar` y la plantilla del PDF reales. El catálogo se importó de `datos-privados/COTIZADOR_2026.xlsx` (8.772 productos) y cada corrida usó una base SQLite propia en el scratchpad (`…/scratchpad/cotizaciones/datos*`). La emisión usó Chrome real. No toqué `data/cotizador.sqlite`, no levanté el servidor, no llamé a la IA y no modifiqué el repo. Antes de cada hallazgo comprobé que no estuviera en la auditoría del 26 oct o, si estaba, que siguiera vigente.

Scripts y salidas (todo en `/private/tmp/claude-501/-Users-allopze-dev-Neltume-tienda-puertas-Cotizador/8966eded-8fcc-4676-8be7-0eb3db948605/scratchpad/cotizaciones/`): `escenarios.mts`, `escenarios2.mts`, `escenarios3.mts`, `escenarios4.mts`, `resultados-*.json`, el HTML emitido `snapshot-cot.html`, `snapshot-especiales.html` y las notas `nota-pedido-*.html`.

Nota ajena a esta auditoría: `git status` muestra `tsconfig.json` y `next-env.d.ts` modificados a las 23:49, con rutas `.next-e2e/qa3123`. Los escribió el `next dev` de otro agente, no estos scripts.

---

## Respuestas directas a lo que reportó la clienta

**A) Cuatro líneas repetidas (Ranco Pino Oregón 0,85/1,00/0,85/1,00 × 2,20): SÍ se puede en el editor manual.** `agregar_producto` (`servicio.ts:962-985`, `agregarItem`) siempre hace `push` del ítem. No hay deduplicación en el camino manual, ni en los esquemas Zod (`route.ts:121-133`), ni en `persistencia-esquemas.ts`, ni en la base. Lo probé: quedan 4 líneas, cada una con su `id`, sus montos y su fila en el PDF. Editar la cantidad o la observación de una no afecta a su gemela (escenarios A1-A5). Deshacer (`restaurar_items`) con ids repetidos asigna un id nuevo y conserva las 4 líneas (`edicion.ts:58-71`, `conIds`).
- Diferencia con el asistente: `chat.ts:946-963` descarta un ítem que repite modelo, madera, ancho, alto, medida, cantidad y tipo, y avisa «No dupliqué…». Por chat no se pueden pedir de una vez dos líneas idénticas (0,85 y 0,85 con cantidad 1). A mano sí. Si a la clienta le falla, lo más probable es que haya usado el chat (lo cubre el otro agente).

**B) Duplicar una línea y modificar la copia: NO existe «duplicar línea».** Cada línea tiene solo ↑, ↓ y × (`cotizacion-panel.tsx:1052-1085`). «Duplicar» copia la cotización completa (`servicio.ts`, `case 'duplicar'`). La forma de hacerlo hoy es volver a agregar el producto del catálogo y, después, renombrar la copia. Al hacerlo pasa esto (escenarios B1-B3):
- Si la copia tenía precio manual, cambiar el modelo (Ranco → «Ranco vidriada») **descarta el precio** y lo avisa (`items.ts:96-114`, `descartarDelProducto`). Si el modelo nuevo no está en el catálogo, la línea queda pendiente (`modelo_desconocido`).
- Para valorizarla hay que usar «Cotizar como especial», que pide el precio desde cero: el campo está vacío (`valor=""`, `cotizacion-panel.tsx:836-842`). No se ofrece el precio de partida.
- El original queda intacto y las líneas son independientes: cada una tiene id propio y los objetos se copian con `structuredClone`, así que no comparten nada mutable (B2, B4).
- Campos editables por línea en borrador/emitida: modelo, madera, ancho, alto (o sección), hoja/vano, descripción del documento, observación, precio unitario, ganancia (margen), descuento especial (% o monto por unidad), referencias/fotos, «cotizar como especial / ítem libre» (solo si la línea está pendiente) y costo de fábrica (solo especiales). La fábrica se asigna aparte (`asignar_fabricas`). Después de generar la nota, `editar_pedido` solo permite cambiar cantidad, medidas, hoja/vano, descripción y observación.

**C) Cotizar fuera de catálogo sin tocar el catálogo general: SÍ** (C1-C7, el catálogo sigue con 8.772 productos):
- Ítem libre (familia OTRO, p. ej. «Instalación»): nombre, cantidad y precio. No va a fábrica.
- Personalizado: familia, nombre, madera, medidas opcionales, precio y fotos. Va a la nota «Por definir» si no tiene costo de fábrica.
- Medida especial entre tramos (0,87): se cobra el tramo siguiente (RAN-O-4-C) y se avisa. Pero desde «Agregar producto» se rechaza si el ancho no cabe en el tramo elegido (C6); hay que agregarla y después editar el ancho.
- Sobre la máxima (1,60): queda pendiente («Ranco no viene en 1,60 m…») y se ofrece cotizar como especial. Es la decisión del 26 oct.
- Espesor distinto: no hay un campo de espesor. Solo se puede como especial con precio a mano y el espesor escrito en la descripción u observación.

---

## Hallazgos

### H-01 — «Corregir pedido» en una aprobada vuelve a cotizar TODO el pedido con el catálogo vigente, sin aviso
- **Severidad:** Alta · **Prioridad:** P0
- **Archivo/líneas:** `src/servidor/servicio.ts:2195-2290` (`editarPedido`), en concreto `:2238` `const calculo = this.recalcular(copia);`. No se llama a `avisosRecotizacion` ni a `diferenciasPrecio`. Los avisos devueltos (`calculo.avisos`) solo hablan de siguiente medida y precio bajo el costo.
- **Evidencia (ejecutada, escenario I1):** se emitió y aprobó la cotización N° 324 con el catálogo A, con notas Panguipulli 577 y Santiago 59. Después el catálogo bajó 10 % y en «Corregir pedido» solo se cambió **la observación del ítem 1**. Resultado: el total pasó de **$2.800.288 a $2.593.493** (−$207.795) y la nota Panguipulli de $467.105 a $424.641. Se regeneró `cotizacion-324-2.pdf` **con el mismo número**. `avisos` llegó `undefined` y la actividad solo dice «Pedido corregido: ítem 1 (observación)». La nota Santiago no se tocó, pero las líneas de Santiago en la cotización sí se recotizaron: la cotización y su nota ya no calzan.
- **Por qué importa:** el cliente aprobó y pagó un anticipo sobre un total. Corregir una observación cambia en silencio el precio acordado y reemite el documento con el mismo número. Si el catálogo subió, se le cobra de más. El e2e `tests/pedido-corregido.e2e.ts:24` documenta la intención contraria: «El precio no se corrige aquí: sigue siendo el aprobado».
- **Arreglo recomendado:** en `editar_pedido`, recalcular solo con los productos ya guardados en `q.montos.lineas` (snapshot de `producto.precioNeto`, `precioUnitario`, margen y descuento) y cambiar solo cantidad o medidas. Si una medida nueva cae en otro tramo, mostrar la diferencia y pedir confirmación. Nunca tomar el precio de un catálogo nuevo para las líneas no tocadas.
- **Categoría:** integridad de precios / estado aprobado · **Causa raíz:** se reutiliza `recalcular` (pensado para borradores) sobre una aprobada.
- **Observado vs esperado:** cambia el total y no avisa ↔ el total solo cambia por la cantidad o medida corregida, al precio aprobado.
- **Pruebas requeridas:** unitaria: aprobada con notas, cambio de catálogo, `editar_pedido` solo de observación ⇒ total y notas iguales; con cantidad +1 ⇒ el total sube exactamente un unitario aprobado. Extender `pedido-corregido.e2e.ts` con un catálogo reimportado.
- **Esfuerzo:** M · **Confianza:** confirmado (ejecutado).

### H-02 — Recotización silenciosa sigue vigente en quitar, agregar, reordenar y deshacer (BUG-012 corregido solo en `editar`)
- **Severidad:** Media · **Prioridad:** P1
- **Archivo/líneas:** `servicio.ts:739-760` (`quitar`, `recalcular` en `:749`), `:962-985` (`agregarItem`, `:971`), `:988-1008` (`reordenar`, `:1003`), `:1012-1031` (`restaurarItems`, `:1025`). Solo `editar` llama a `avisosRecotizacion` (`:1232`). La emisión compara contra `q.montos` ya actualizados (`:1286`), así que tampoco detecta el cambio.
- **Evidencia (escenarios R-*):** borrador con el catálogo A y luego catálogo +10 %. Con `quitar`, `agregar_producto`, `reordenar` y `restaurar_items`, la línea 1 pasa de $317.834 a $349.618 con `avisos: null`, y la actividad solo dice «Quitado…», «Se reordenaron los productos», etc. Después se emite **sin pedir confirmación**. Con `editar` sí avisa («Recotizado: …»).
- **Por qué importa:** tras reimportar la lista de precios, mover o borrar una línea cambia todos los precios sin que la vendedora lo vea, y el PDF sale con montos que no revisó. BUG-012 parecía cerrado.
- **Arreglo recomendado:** centralizar en `recalcular` (o en un envoltorio común) la comparación con `previa.montos`, con los índices tocados. En `reordenar` los índices cambian, así que conviene comparar por `id` de ítem. Devolver los avisos y registrarlos en la actividad desde todas las acciones.
- **Categoría:** precios / trazabilidad · **Causa raíz:** el arreglo de BUG-012 quedó dentro de `editar` y no en el punto común.
- **Observado vs esperado:** cambio de precio sin aviso ↔ aviso «cambió de … a … según el catálogo vigente» y registro en la actividad.
- **Pruebas requeridas:** unitaria parametrizada por acción (quitar, agregar_producto, agregar_personalizado, reordenar, restaurar_items) con cambio de catálogo ⇒ avisos y evento.
- **Esfuerzo:** S-M · **Confianza:** confirmado (ejecutado).

### H-03 — En el PDF de la cotización, un especial (y una línea con descripción propia) no lleva medida: «Ranco vidriada» 0,85 y 1,00 salen idénticas
- **Severidad:** Media-Alta (para la clienta) · **Prioridad:** P1
- **Archivo/líneas:** `src/negocio/personalizados.ts:134` (`descripcion: \`${nombre} · ${madera}\``), `src/negocio/precios.ts:151-159` (`descripcionLinea`: una descripción escrita a mano reemplaza todo) y `src/servidor/pdf.ts:273-290` (`producto()`: la cotización no imprime «Medida solicitada» porque «el nombre ya lleva la medida pedida»).
- **Evidencia (escenarios J1/J2, `snapshot-especiales.html`):** filas impresas: `Ranco vidriada · PINO OREGON | ESPECIAL | 1 | $360.000` y `Ranco vidriada · PINO OREGON | ESPECIAL | 1 | $380.000`. No hay ninguna medida, aunque se guardaron 0,85 × 2,20 y 1,00 × 2,20. La línea de catálogo con descripción «Puerta baño Ranco» también pierde su 0,85 × 2,20. La nota de pedido sí imprime «Medida solicitada: 850 × 2200 mm (Hoja)».
- **Por qué importa:** es justo el caso de la clienta (las mismas puertas vidriadas en dos anchos). El cliente recibe dos líneas iguales con precios distintos y no puede saber cuál es cuál. Contradice la decisión del 28 oct («el nombre conserva su medida»).
- **Arreglo recomendado:** en la cotización, si la descripción no viene de `describirProducto` (especial o escrita a mano) y la línea tiene `anchoSolicitado` o `altoSolicitado`, agregar la medida en el nombre o en un `<span>`, sin hoja/vano (el formato acordado). Revisar `tests/pdf.test.ts:317-335`, que hoy fija lo contrario para «Puerta con cerradura»; confirmar con el usuario antes de cambiar ese test.
- **Categoría:** documento al cliente · **Causa raíz:** la medida solo vive dentro de la descripción generada desde el catálogo.
- **Observado vs esperado:** sin medida ↔ «Ranco vidriada · Pino Oregón 0,85 m × 2,20 m».
- **Pruebas requeridas:** `pdf.test.ts` con dos especiales de medidas distintas y una línea con descripción propia ⇒ cada fila muestra su medida. E2E visual opcional.
- **Esfuerzo:** S · **Confianza:** confirmado (HTML emitido).

### H-04 — No existe «duplicar línea»; la copia hay que rehacerla y pierde precio, descuento, observación y fotos
- **Severidad:** Media · **Prioridad:** P1
- **Archivo/líneas:** `cotizacion-panel.tsx:1052-1085` (solo ↑ ↓ ×). `route.ts` no tiene una acción de duplicar ítem. `servicio.ts` `case 'duplicar'` duplica la cotización completa.
- **Evidencia:** leído literalmente y simulado en B1-B2 (agregar de nuevo, renombrar, especial con precio escrito a mano).
- **Por qué importa:** la clienta tiene que volver a buscar el producto, escribir las medidas y repetir el precio manual, el descuento especial, las observaciones y las fotos de cada variante. Es lento y fácil equivocarse.
- **Arreglo recomendado:** acción de servidor `duplicar_item {id, actualizada, indice}` que inserte bajo la línea un `structuredClone` sin `id` (para que `conIds` le dé uno nuevo), copiando precio, margen, descuento, descripción, observación, referencias y fábrica. Botón «Duplicar» junto a ↑ ↓ ×. Debe registrarse en Deshacer (cambian las solicitudes) y en la actividad.
- **Categoría:** capacidad faltante (UX comercial) · **Causa raíz:** no se diseñó.
- **Observado vs esperado:** no existe ↔ un clic crea una copia independiente.
- **Pruebas requeridas:** unitaria (ids distintos; editar la copia no toca el original; referencias compartidas pero inmutables) y e2e (duplicar, renombrar a especial, emitir ⇒ dos filas).
- **Esfuerzo:** S-M · **Confianza:** confirmado (leído).

### H-05 — Una línea valorizada no se puede pasar a «especial» conservando su precio, y el campo de especial no propone el precio de partida
- **Severidad:** Media · **Prioridad:** P2
- **Archivo/líneas:** `cotizacion-panel.tsx:827-842`: «Cotizar como especial» solo aparece con `pendiente && SIN_CATALOGO` y el campo trae `valor=""`. En el servidor, `edicion.ts:203-215` sí acepta `personalizado` en cualquier ítem. `items.ts:96-114` descarta el precio manual al cambiar de modelo.
- **Evidencia:** B1. Al renombrar la copia, el aviso dice «se descartó su precio unitario manual». La línea queda pendiente sin precio y hay que escribirlo de nuevo.
- **Por qué importa:** la clienta quiere partir del precio de la Ranco y ajustarlo (vidrio). Hoy pierde ese precio y lo tiene que recordar o recalcular.
- **Arreglo recomendado:** en el detalle de una línea de catálogo, una acción «Convertir en especial» que envíe `personalizado` junto con `precioUnitario` igual al precio vigente de la línea, antes de renombrarla. En el campo de especial, proponer el último precio conocido de la línea.
- **Categoría:** UX comercial · **Causa raíz:** la UI solo expone el especial como salida de un pendiente.
- **Observado vs esperado:** precio perdido ↔ precio de partida propuesto y editable.
- **Pruebas requeridas:** e2e: línea de catálogo → convertir en especial → renombrar ⇒ conserva el precio. Unitaria del servidor: `personalizado` + `precioUnitario` sobre una línea valorizada.
- **Esfuerzo:** S · **Confianza:** confirmado (leído y ejecutado).

### H-06 — El PDF dice «No incluye: Instalación… vidrios» aunque la cotización cobra instalación o puertas vidriadas
- **Severidad:** Media · **Prioridad:** P2
- **Archivo/líneas:** `src/servidor/pdf.ts:375-378` (condición fija «No se considera: Instalación, pintura, barniz, protecciones metálicas, vidrios…»). En `:359` también es fijo «Valores en pesos chilenos, puestos en fábrica.», aunque la cotización incluya flete.
- **Evidencia (`snapshot-cot.html`, cotización 323):** el detalle tiene «Instalación | OTRO | 2 | $45.000» y «Ranco vidriada», y las condiciones dicen «No incluye … Instalación … vidrios». También aparece «puestos en fábrica» con una línea «Flete Starken $30.000».
- **Por qué importa:** el documento se contradice frente al cliente y abre un reclamo («¿la instalación va o no?»).
- **Arreglo recomendado:** armar «No incluye» quitando lo que aparece en el detalle (instalación si hay un ítem libre con ese nombre; vidrios si una línea los menciona), o dejarlo editable por cotización. Con flete > 0, usar «Valores en pesos chilenos, despacho incluido según detalle».
- **Categoría:** documento al cliente · **Causa raíz:** texto legal fijo.
- **Observado vs esperado:** contradicción ↔ condiciones coherentes con el detalle.
- **Pruebas requeridas:** `pdf.test.ts` con un ítem libre «Instalación» y flete ⇒ ni «Instalación» en «No incluye» ni «puestos en fábrica».
- **Esfuerzo:** S · **Confianza:** confirmado (HTML emitido).

### H-07 — Doble envío del PRIMER producto crea dos borradores (variante de BUG-047 no cubierta)
- **Severidad:** Baja-Media · **Prioridad:** P2
- **Archivo/líneas:** `route.ts:121-148`: `agregar_producto` y `agregar_personalizado` aceptan `id` opcional pero no `nuevoId`. `servicio.ts:963` (`accion.id ? … : this.nueva()`). En la UI, `cotizador.tsx:1145-1152` (`agregarItem`) no envía un id de reintento.
- **Evidencia (E3):** dos `agregar_producto` simultáneos sin `id` ⇒ `borradoresCreados: 2`, los dos «fulfilled». Con `id` y versión, el segundo da 409 (E2, correcto). En la UI, `if (ocupado) return false` evita el doble clic local, pero no un reintento tras un corte de red: el diálogo queda abierto con error y la persona vuelve a enviar.
- **Por qué importa:** quedan borradores fantasma con el mismo producto y la vendedora puede seguir en uno y emitir el otro.
- **Arreglo recomendado:** aceptar `nuevoId` en las dos acciones, como `nueva`, `duplicar` y `chat` (BUG-047). Si el borrador ya existe con ese id, devolverlo sin volver a agregar el ítem.
- **Categoría:** idempotencia · **Causa raíz:** el arreglo de BUG-047 no incluyó crear desde «Agregar producto».
- **Pruebas requeridas:** unitaria con dos envíos con el mismo `nuevoId` ⇒ un borrador y un ítem.
- **Esfuerzo:** S · **Confianza:** confirmado en el servidor (ejecutado); el impacto en la UI es probable.

### H-08 — Una revisión de una emitida recotiza todas las líneas al catálogo vigente; no se pueden mantener los precios acordados
- **Severidad:** Baja-Media (decisión a confirmar) · **Prioridad:** P2
- **Archivo/líneas:** `servicio.ts:412-445` (`abrirEdicion` copia la emitida) y luego `recalcular`. Lo justifica el comentario «M3» en `:1263`.
- **Evidencia (G2):** emitida N° 323, catálogo +10 % y luego cambio solo de la cantidad del ítem 4. La revisión sube los ítems 1-4 (p. ej. $317.834 → $349.618; la línea con ganancia 30 % pasa de $223.343 a $245.677). Avisa «cambió de … según el catálogo vigente». Los especiales y los libres no cambian. La emitida original conserva sus montos (G1 aprobado: el snapshot está bien).
- **Por qué importa:** ajustar la cantidad de un pedido ya conversado obliga a volver a escribir a mano todos los precios antiguos (uno por línea). Además, un precio manual antiguo puede quedar fuera del rango −50 %/500 % del costo nuevo.
- **Arreglo recomendado:** confirmarlo con el usuario. Si lo quiere, al abrir la revisión ofrecer «mantener precios de la N° X» (fijar `precioUnitario` desde las líneas emitidas) o «actualizar al catálogo».
- **Categoría:** regla comercial · **Causa raíz:** decisión de diseño M3 aplicada a toda revisión.
- **Pruebas requeridas:** según lo que se decida.
- **Esfuerzo:** M · **Confianza:** confirmado (comportamiento); es una decisión, no un bug seguro.

### H-09 — Deshacer/Rehacer solo cubre los ítems: descuento general, flete, ganancia de la cotización, cliente y observaciones no se deshacen
- **Severidad:** Baja · **Prioridad:** P3
- **Archivo/líneas:** `cotizador.tsx:163-174` (`registrarCambioItems` solo registra si cambian las `solicitudes`) y `:879-908` (`restaurar_items` solo envía ítems).
- **Evidencia:** leído literalmente.
- **Por qué importa:** la clienta espera que «Deshacer» revierta, por ejemplo, un descuento general mal escrito. No pasa nada, o se deshace un cambio de ítem anterior.
- **Arreglo recomendado:** guardar en la pila también `descuento/descuentoManual/flete/fleteCantidad/fleteDescripcion/margenCotizacion` (una acción `restaurar_estado`), o mostrar en el botón qué se va a deshacer.
- **Categoría:** UX · **Causa raíz:** alcance del historial · **Pruebas:** e2e de deshacer un descuento general. **Esfuerzo:** M · **Confianza:** confirmado (leído).

### H-10 — Actividad duplicada: cada recotización queda dos veces («Recotizado: X · Aviso: X»)
- **Severidad:** Baja · **Prioridad:** P3
- **Archivo/líneas:** `servicio.ts:1233` (`todos` incluye `avisosCatalogo`) y `:1243` (`extras.unshift(...avisosCatalogo.map('Recotizado: '))`). Después se registra `textoCambios(cambios, [...extras, ...todos.map('Aviso: ')])`.
- **Evidencia (R-editar):** la actividad muestra «Recotizado: El precio unitario de RAN-O-3-C cambió… · … · Aviso: El precio unitario de RAN-O-3-C cambió…».
- **Arreglo:** excluir `avisosCatalogo` del `todos` que se registra con «Aviso:». **Esfuerzo:** XS · **Confianza:** confirmado.

### H-11 — Espesor y otras variantes no tienen un atributo propio; solo se pueden expresar como especial con precio escrito a mano
- **Severidad:** Baja · **Prioridad:** P3
- **Archivo/líneas:** `route.ts:134-157` (`agregar_personalizado` sin espesor ni vidrio), `catalogo/tipos.ts` (`Producto` sin espesor).
- **Por qué importa:** «Ranco 50 mm» o «Ranco vidriada» siempre se cotizan a mano, sin «precio de catálogo + recargo». Es coherente con «sin tocar el catálogo general», pero es lento.
- **Arreglo:** si es frecuente, un recargo por línea (monto o %) sobre una línea de catálogo, que la mantenga en el catálogo y en la nota. **Confianza:** confirmado (leído). **Esfuerzo:** M.

---

## Verificado y correcto (sin hallazgo)
- La aritmética coincide con la regla documentada en `precios.ts:6-13`: total de línea = cantidad × (unitario − descuento por unidad); descuento general = round(subtotal × %); neto = subtotal − descuento + flete; IVA = round(neto × 0,19). Probado con descuento del 10 % y de $5.000 por ítem, tramo del 5 %, manual del 7,5 %, flete 2 × $15.000 (D4-D5). Se rechazan 3 decimales en el descuento (D6) y los precios fuera de −50 %/500 % con el rango en pesos (D9). Prioridad de margen: línea > cotización > categoría (D7-D8).
- Descuento por cantidad: el tramo se aplica al llegar a 4 puertas y el especial PUERTA cuenta; el ítem libre no (D1-D3).
- Conflictos entre pestañas: una versión vieja da 409 `version_obsoleta` (E1). Doble clic en agregar con versión: solo entra uno (E2). Doble emisión: un solo número y la otra recibe «Ya se está generando el PDF…» (G6).
- Emisión: con precios desactualizados da 409 `precios_cambiaron` cuando no hubo una edición intermedia (G4). Una medida sin hoja/vano bloquea la emisión desde la ruta de la pantalla (J0). El PDF emitido contiene cada total de línea, descuento, flete, IVA y total guardados (F1). Snapshot del HTML guardado en `documentos_snapshot`; la emitida no cambia al cambiar el catálogo (G1). Al emitir la revisión, la original pasa a «reemplazada» (G3).
- Notas por fábrica: una por fábrica (577 Panguipulli / 59 Santiago), a precio de fábrica con la ganancia en 0, sin descuento ni flete. El especial sin costo va «Por definir» y no suma, y el ítem libre queda fuera (H1). Los costos salen de `linea.producto.precioNeto` congelado, no del catálogo vigente.
- Eliminar solo funciona en borradores sin número (K2). Reordenar mantiene los montos con su ítem (E4).
- Pruebas existentes: `npx vitest run` de edicion-detalle, descuento-item, montos, agregar-producto, pedidos-especiales, notas-por-fabrica, restaurar y descuento-cantidad: 8 archivos y 151 pruebas, todas pasan.

---

## Tabla de escenarios ejecutados

| ID | Escenario | Resultado |
|---|---|---|
| A1 | 4 líneas Ranco Oregón 0,85/1,00/0,85/1,00 × 2,20 por agregar_producto | aprobado |
| A2 | Cantidad de la línea 3 → 3 sin tocar la gemela 1 | aprobado |
| A3 | Observación/descripción de la línea 1 no se propaga a la 3 | aprobado |
| A4 | Volver a igualarlas: siguen 4 líneas independientes | aprobado |
| A5 | Deshacer (`restaurar_items`) con id repetido: reasigna el id | aprobado |
| B1 | Copia renombrada a «Ranco vidriada»: pendiente, precio manual descartado, original intacta | aprobado (con H-04/H-05) |
| B2 | Copia cotizada como especial con su precio; el original conserva el suyo | aprobado |
| B3 | Ranco → Lanco con precio manual: descarta el precio y avisa | aprobado (por diseño) |
| B4 | Ids propios por línea | aprobado |
| C1 | Ítem libre «Instalación» $45.000 | aprobado |
| C2 | Puerta personalizada «espesor 50 mm» sin tocar el catálogo | aprobado |
| C3 | Ancho 0,87 → siguiente medida (RAN-O-4-C) con aviso | aprobado |
| C4 | Ancho 1,60 sobre la máxima → pendiente | aprobado |
| C5 | Alto 2,00 → tramo A (RAN-O-5-A) | aprobado |
| C6 | Agregar producto con ancho fuera del tramo elegido: se rechaza | aprobado (fricción, ver respuesta C) |
| C7 | Catálogo general intacto | aprobado |
| D1-D3 | Descuento por cantidad (sin tramo / tramo 5 % / especial cuenta) | aprobado |
| D4 | Aritmética completa (desc. ítem % y monto, global, flete, IVA) | aprobado |
| D5-D6 | Descuento manual 7,5 % / 3 decimales rechazado | aprobado |
| D7-D9 | Ganancia de cotización y de línea; precio fuera de rango rechazado | aprobado |
| E1 | Pestaña con versión vieja → 409 | aprobado |
| E2 | Doble clic en agregar con versión → uno entra | aprobado |
| E3 | Doble envío del primer producto sin id | **fallido** (H-07) |
| E4 | Reordenar | aprobado |
| F1 | Emitir; el snapshot del PDF reproduce los montos guardados | aprobado |
| G1 | Catálogo +10 %: la emitida conserva sus montos | aprobado |
| G2 | Revisión tras cambio de catálogo re-precia todas las líneas | aprobado con observación (H-08) |
| G3 | Emitir la revisión → la original queda reemplazada | aprobado |
| G4 | Borrador desactualizado → 409 precios_cambiaron | aprobado |
| G5 | Emitir puerta con «medida por defecto» sin hoja/vano (solo por API, sin ancho) | aprobado (por diseño: `medidas.ts:13` exime `medidaPorDefecto`) |
| G6 | Doble clic en Emitir | aprobado |
| H1 | Notas por fábrica, «Por definir», libre fuera | aprobado |
| I1 | Corregir pedido aprobado (solo observación) con catálogo cambiado | **fallido** (H-01) |
| J0 | Emitir con medida no_especificado (ruta de la pantalla) se bloquea | aprobado |
| J1 | PDF: dos «Ranco vidriada» 0,85/1,00 distinguibles | **fallido** (H-03) |
| J2 | PDF: línea con descripción propia conserva la medida | **fallido** (H-03) |
| K1 | Duplicar la cotización completa | aprobado |
| K2 | Eliminar una emitida se rechaza | aprobado |
| R-quitar | Catálogo cambiado + quitar: avisa la recotización | **fallido** (H-02) |
| R-agregar_producto | ídem + agregar | **fallido** (H-02) |
| R-reordenar | ídem + reordenar | **fallido** (H-02) |
| R-restaurar_items | ídem + deshacer | **fallido** (H-02) |
| R-editar | ídem + editar | aprobado (actividad duplicada, H-10) |
| — | Conflicto en la UI al recibir 409 (si se pierde lo escrito) | no ejecutado (requiere navegador) |
| — | Validación Zod por HTTP de las acciones | no ejecutado (sin servidor); revisada leyendo `route.ts` |
| — | Fotos/referencias reales en una línea duplicada | no ejecutado (no hay subida sin servidor); leído: se copian con `structuredClone` y los archivos son inmutables (sha256) |
