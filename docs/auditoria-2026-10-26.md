# Seguimiento de la auditoría del 26-10-2026

Estado de cada hallazgo de `AUDITORIA_COTIZADOR_NELTUME.md` tras la implementación del plan
(`implementacion-auditoria-cotizador-neltume.md`). **Los 65 hallazgos quedaron cerrados.** El acuerdo con
Panguipulli sobre el ancho de los especiales se cerró el 27-10; queda correr la evaluación completa con el modelo de
producción.

Verificación al cerrar: `npm run typecheck` sin errores, `npm run lint` sin errores (2 avisos previos),
**1.557 pruebas unitarias verdes** (97 archivos; antes eran 1.541) y las suites E2E de flujo, edición del detalle,
descuento por ítem, operación, catálogo por secciones, accesibilidad, reparto de fábricas, Starken, historial, ítem
libre, pedido especial, PDF regenerado y referencias verdes. La suite E2E completa y `evals/` no se corrieron en este
entorno; `evals/` sí se ejecutó a través de `tests/ia-perfecta.test.ts` (100 % en ambos modos).

> La evidencia de la auditoría (scripts de reproducción, salidas y capturas) se sacó del repositorio el 27-10 a
> `~/Documents/auditoria-cotizador-2026-10-26/`. Por eso `tsconfig.json` y `eslint.config.mjs` ya no necesitan excluirla.

---

## Fase 0 · Preparación

| BUG | Estado | Qué se hizo |
|---|---|---|
| 022 | ✅ | `playwright.config.ts` anula `NELTUME_FABRICA_PANGUIPULLI_URL` y `_SECRETO`: la E2E ya no puede enviar pedidos a la fábrica de `.env.local`. |

## Fase 1 · Integridad de datos

| BUG | Estado | Qué se hizo |
|---|---|---|
| 001 | ✅ | `item_id` estable por ítem (esquema **v29**, con backfill e índice único), `conIds` en cada alta/edición y la pantalla usa `key={s.id}`. |
| 002 | ✅ | `mismoContenido` compara cliente exacto, fábrica, `costoFabrica` y referencias; si la revisión difiere, responde 409 `revision_abierta` en vez de pisarla. |
| 023 | ✅ | Ajustes devuelve `actualizada` y exige `If-Match`; dos guardados simultáneos dan 409. Igual en la configuración del catálogo (huella del documento). |
| 024 | ✅ | La emisión en curso anota el número reservado y `validarNumeroCotizacion` lo rechaza hasta liberarlo. |
| 025 | ✅ | `origenId` persiste junto a `origen`; la papelera y la restauración resuelven la revisión por id, no por número. |
| 045 | ✅ | Las operaciones de cuentas se serializan en una cola: dos desactivaciones simultáneas ya no dejan cero administradoras. |
| 046 | ✅ | `eliminarBorradores` recibe la versión vista y no borra un borrador retomado. |
| 047 | ✅ | «Crear» y «Duplicar» aceptan `nuevoId`; un reintento devuelve la copia ya creada. |
| 048 | ✅ | `/api/auth/list-sessions` queda bloqueado (el cotizador tiene `/api/sesiones`, que no entrega tokens). |
| 054 | ✅ | La ruta de acciones ya exigía `actualizada` con `id` (`refine`); se documentó como garantía de la API. |

## Fase 2 · Lo que va a la fábrica

| BUG | Estado | Qué se hizo |
|---|---|---|
| 003 | ✅ | La OT se nombra por `evento_id`; su sha256 se guarda y se verifica antes de reutilizarla; el respaldo incluye `data/integracion/`. |
| 004 | ✅ | `GET /api/integracion/envios?cotizacion=` y el seguimiento muestran «Enviada / Pendiente / No llegó»; `integracion` pasó al healthcheck básico; las fotos se reparten un presupuesto de 4 MiB por documento y se avisa en el registro si el PDF supera 5 MiB. |
| 005 | ✅ | `medidaPedida` imprime «0,90 m × 2,10 m» para un especial con ancho; el pedido a la fábrica lo lleva en `requested` y, acordado con la fábrica el 27-10, también en `widthMm`. |
| 019 | ✅ | Una anulación ya no espera detrás de un `order.ready`; al fallar se recalcula si hay una revisión más nueva antes de reprogramar. |
| 020 | ✅ | La restauración conserva los envíos posteriores al respaldo y sube los correlativos; el comando avisa que hay que conciliar con la fábrica. |
| 021 | ✅ | Una revisión de un pedido ya encolado se encola aunque falte la configuración (sale cuando vuelva). |
| 043 | ✅ | `integracion encolar` rechaza una nota ya entregada salvo `--forzar`. |
| 044 | ✅ | El PDF comercial se congela en `data/integracion/pdf` al encolar: un reintento manda los mismos bytes. |

## Fase 3 · Precios con constancia

| BUG | Estado | Qué se hizo |
|---|---|---|
| 012 | ✅ | `editar` compara las líneas previas de los ítems no tocados y avisa «Recotizado: … según el catálogo vigente»; queda en la actividad. |
| 013 | ✅ | El despacho guarda la huella del bulto con la tarifa; si el pedido cambia, se avisa al recalcular y al emitir. |
| 014 | ✅ | El costo de fábrica viaja en la línea (`precioFabrica`), se compara al avisar de una venta bajo el costo y el rango de precio se mide contra ese costo. |
| 034 | ✅ | `precioConMargen` calcula en diezmilésimas enteras: 10.990 × 15 % = 12.639. Se usa en precios y en `items-vigentes`. |
| 035 | ✅ | `leerPesos` lee «350.00» como 350.000, igual que el chat. |
| 036 | ✅ | Los ítems libres (`OTRO`) no entran en la huella de Starken. |
| 037 | ✅ | Cambiar solo el costo de fábrica no abre revisión y se permite en una aprobada sin notas. |

## Fase 4 · Validador de la IA

| BUG | Estado | Qué se hizo |
|---|---|---|
| 006 | ✅ | Un valor de otro ítem solo respalda si es la edición del mismo índice o si la frase dice «otra igual / las mismas». |
| 007 | ✅ | `problemaSalida` y `aplicarModificacion` verifican que el índice sea el del modelo que nombra el mensaje/frase. |
| 008 | ✅ | `agregar` descarta el ítem idéntico (mismo modelo, madera, medidas y cantidad) con un aviso. |
| 009 | ✅ | `anclarTextos` y `anclarCliente` descartan descripción, observaciones y datos del cliente que no están escritos. |
| 026 | ✅ | `actualizar_cotizacion` ya no puede quitar una puerta que el mensaje no nombra; quitar la fábrica o el flete exige que el mensaje lo pida. |
| 027 | ✅ | La fábrica solo se asigna si se nombra como tal («fábrica de…», «van/para/a …», «las hace…»): «cliente de Santiago» o el modelo Panguipulli ya no la asignan. |
| 028 | ✅ | «+ IVA» se lee como neto e «IVA incluido» como incluido, en el precio y en el flete; si el modelo dijo lo contrario, manda el texto. |
| 029 | ✅ | El precio debe estar en la frase del ítem, no en la de otro de la misma línea, con una marca de monto, y las medidas («90x210») se excluyen. |
| 030 | ✅ | El filtro de la respuesta usa `montosDelTexto` y `porcentajesDelTexto`: «450 mil», «450 lucas» y «Precio: 450.000 + IVA» ya no pasan. |
| 031 | ✅ | `libre:true` solo vale con `modelo_desconocido`: un `modelo_posible` ya no se convierte en ítem libre. |
| 032 | ✅ | «no, mejor 4», «perdón» o «digo» mandan la cifra de la corrección, no la de antes del modelo. |
| 049 | ✅ | Un descuento «en total» no se aplica por unidad, «descuento de 2 molco» sin «%» no respalda un 2 % y el descuento de otro ítem de la línea no se toma. |
| 050 | ✅ | El anclaje usa la misma ventana de 6 turnos que ve el modelo. |
| 051 | ✅ | `aprobar_cotizacion` exige el número escrito en el mensaje. |
| 052 | ✅ | `normalizarSalida` convierte números que llegan como texto, recorta `fuente` y trunca las listas antes de validar (sin romper el JSON Schema de las herramientas). |
| 053 | ✅ | «$450,000» se lee como 450.000; los mensajes de error ya no prometen un borrador inexistente y las medidas de un solo ítem no se atribuyen a «otro ítem». |
| 054 | ✅ | Ver Fase 1. |

## Fase 5 · PDF y documentos

| BUG | Estado | Qué se hizo |
|---|---|---|
| 015 | ✅ | Con descuento, el precio original va en su propia línea encima del rebajado. |
| 016 | ✅ | La copia anulada se marca sobre el snapshot emitido; la renumerada reemplaza solo `N.º <antiguo>` en el HTML emitido. |
| 017 | ✅ | «Aprobada por» usa `copia.aprobadaPor`, no quien genera la nota. |
| 018 | ✅ | `table-layout:fixed` y `overflow-wrap:anywhere` en producto, datos y observaciones. |
| 038 | ✅ | `.totales dd{white-space:nowrap}`: el «−» y el monto van juntos. |
| 039 | ✅ | Las descripciones escritas a mano y los nombres de especiales e ítems libres no se normalizan. El 27-10 se completó: `descripcionImpresa` (pdf.ts) se usa también en el rótulo «Ítem n · …» de las fotos y en `items[].description` del pedido a la fábrica, que seguían convirtiendo «MODELO X … TIPO A» en «Modelo × … Tipo a». |
| 040 | ✅ | Las observaciones conservan sus saltos de línea al guardarse. |
| 041 | ✅ | Un grupo de imágenes sin ninguna imagen ya no imprime su rótulo. |
| 042 | ✅ | Las cifras de 11+ caracteres se achican tanto en los totales como en el unitario y el total de cada línea. |

## Fase 6 · UI, UX y accesibilidad

| BUG | Estado | Qué se hizo |
|---|---|---|
| 010 | ✅ | Un campo vacío después de cambiar el tipo de descuento ya no lo borra. |
| 011 | ✅ | El panel registra los campos abiertos con cambios: el diálogo de emisión los lista y salir de Cotizar pide confirmación. |
| 033 | ✅ | Si el disparador del diálogo desapareció, el foco vuelve al título de la cotización. |
| 055 | ✅ | «Atrás» usa `router.replace('/')`. |
| 056 | ✅ | La 404 usa `/logo-neltume.svg` (no `/api/logo`). |
| 057 | ✅ | Cada campo abierto con cambios se marca «Sin guardar» mientras conviven los dos criterios de guardado. |
| 058 | ✅ | En Cotizar los avisos van bajo la cabecera, no sobre los controles de pago. |
| 059 | ✅ | «Cliente opcional…» solo aparece si la cotización es editable. |
| 060 | ✅ | Regla global de `::placeholder` con `--subtle` y `opacity:1`. |
| 061 | ✅ | `aria-controls` solo con la lista abierta; `role="group"` en el historial de edición. |
| 062 | ✅ | El formulario de producto personalizado enfoca el primer campo inválido. |
| 063 | ✅ | El alta manual del catálogo entra en `useAvisoSalida`: no se pierde sin aviso al cambiar de sección. |
| 064 | ✅ | Un rango de fechas invertido se explica, en vez de decir solo «sin resultados». |
| 065 | ✅ | Se quitan los controles bidi al guardar, el botón deshabilitado de Conexión explica el motivo y «Actualizar lista» confirma que actualizó. |

---

## Regresiones corregidas el 27-10

La E2E completa, corrida antes del commit, encontró tres defectos más en los arreglos:

- **Deshacer y Rehacer no funcionaban (BUG-001).** El esquema estricto de `restaurar_items` (`api/accion/route.ts`) no
  admitía el `id` que desde v29 llevan todos los ítems: cualquier Deshacer respondía 400 y no cambiaba nada. Tampoco
  admitía `fabrica` ni `costoFabrica`, así que ya fallaba antes con ítems que tenían fábrica o costo asignado. Ahora
  los admite, y `conIds` le da un id nuevo a uno repetido, porque el índice es único.
- **Guardar Ajustes sin `If-Match` respondía 409 (BUG-023).** `headers.get` da `null` sin la cabecera y la ruta lo
  comparaba como si fuera una versión. Ahora la falta de cabecera se acepta, como dice el comentario de la ruta.
- **«Nombres y alias» no enviaba su versión (BUG-023).** La ruta del catálogo comprobaba `If-Match`, pero la pantalla
  nunca lo mandaba: dos guardados simultáneos seguían pisándose. Ahora la pantalla guarda la versión que leyó y la envía.

El presupuesto de fotos de BUG-004 agregó una función con nombre (`codificar`) dentro de `page.evaluate`. Bajo `tsx`,
esbuild la envuelve con `__name`, que no existe en la página: **ningún PDF se imprimía desde un script de terminal**
(`npm run integracion -- enviar` imprime la orden de trabajo). Next y vitest no lo notaban. Ahora `generarPdf` define
`__name` en la página antes de evaluar. Se comprobó: con `tsx`, `main` imprimía, la versión sin arreglar fallaba y
la arreglada imprime.

## Notas y acuerdos pendientes

No queda ningún defecto de los 65. Quedan estas notas:

- **BUG-005 · contrato con Panguipulli.** Acordado el 27-10: el ancho de un marco o moldura especial viaja en
  `widthMm` (§4 del contrato). El presupuesto de fotos de 4 MiB entró en la sección 5 del estándar común.
- **Evaluación con el modelo real.** `tests/ia-perfecta.test.ts` da 100 % en ambos modos con el corpus del repo, pero
  conviene correr `evals/` con el modelo de producción antes de cambiar umbrales.
- **Escenarios S1.x como pruebas fijas.** Se cerraron en el código; los casos S1.02, S1.06, S1.09, S1.15, S1.19/20/28 y
  S2.02 se cubren hoy con `tests/regresion-chat-auditoria.test.ts` (029/032/049) y las pruebas del anclaje; falta
  llevarlos todos a `tests/chat-fiabilidad.test.ts` y a `evals/cotizacion.json`.
- **Migración v29.** La cubren la migración JSON→SQLite (asigna ids) y la prueba de identidad por ítem; un test
  dedicado partiendo de una base v28 con filas queda como mejora.
- **Suite E2E completa.** Corrida el 27-10 antes del commit: 102 pasan y 1 se omite a propósito.
