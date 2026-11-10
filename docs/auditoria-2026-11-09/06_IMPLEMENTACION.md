# 06 · Implementación de las mejoras

**Rama:** `mejoras-auditoria-2026-11`, creada desde `main` en `a641645`. **Sin commits, sin merge, sin deploy:** esos pasos los da el responsable del proyecto.

**Decisiones tomadas por la tienda** (según la regla «la tienda decide lo suyo»):

| Decisión pendiente (02, etapa 0) | Decisión aplicada |
|---|---|
| Roles (N-17) | Se mantiene una sola cuenta-administradora, como hoy. Las funciones nuevas que crean cosas para todas las cotizaciones (crear en el catálogo, duplicar o renombrar modelos) dicen explícitamente que el cambio es permanente. |
| Revisión con precios acordados (N-28) | Se mantiene la decisión M3: una revisión toma los precios del catálogo vigente y los avisa. |
| Hoja o vano por omisión (N-40) | No se pone un valor por omisión. Se agrega «todas de hoja / todas de vano» para confirmar una sola vez, y el diálogo de agregar recuerda la última elección. |
| Modo cliente (N-15) | Es un interruptor «Ocultar costos», apagado por omisión y recordado en cada navegador. |
| Categoría de ganancia (N-09) | Se probó que la categoría de los 8.866 productos reales depende solo del tipo de producto y la madera, pero las pruebas documentan que el «Tipo» de la planilla puede traer la terminación. La regla no se cambió. La vista previa del alta ahora muestra la categoría y la ganancia antes de guardar, y el campo «Estilo» advierte que «prepintada» y «enchapada» cambian la ganancia. |

## Hecho

| Id | Mejora | Archivos principales | Prueba |
|---|---|---|---|
| **N-01** (P0) | «Corregir pedido» conserva el producto y el costo aprobados de cada línea que sigue siendo el mismo producto; solo se valoriza de nuevo lo que cambió, y avisa si cambia el total | `servidor/servicio.ts` (`calcular`/`recalcular` con `congelados`, `editarPedido`) | `tests/notas-por-fabrica.test.ts` (falla con el código anterior y pasa con el arreglo) |
| **N-02** (P0) | La vista previa del alta usa la misma ganancia por categoría que la cotización, y muestra el precio de venta, la ganancia y la categoría | `app/alta-producto.tsx`, `negocio/precios.ts` (`NOMBRES_CATEGORIA_MARGEN`) | `tests/alta-desde-pendiente.e2e.ts` (precio de la revisión = precio de la línea) |
| **N-03, N-23** | Duplicados del chat según su origen: los reenvíos de la IA se descartan en silencio (también con tildes o en cm); lo pedido en el mensaje se agrega aunque sea igual a otra línea | `servidor/chat.ts` | `tests/lineas-repetidas-chat.test.ts` |
| **N-04** | El asistente puede responder con medidas y cantidades; solo se bloquean los montos | `asistente/montos.ts` (`hablaDeDinero`), `servidor/chat.ts` | `tests/habla-de-dinero.test.ts` |
| **N-05** | «Duplicar línea» en cada fila (copia todo y abre la copia) y la operación `duplicar` del asistente | `servidor/servicio.ts` (`duplicar_item`), `app/cotizacion-panel.tsx`, `asistente/esquemas.ts`, `asistente/llm.ts`, `servidor/chat.ts` | `tests/duplicar-linea.test.ts`, `tests/lineas-repetidas-chat.test.ts` |
| **N-07** | Un solo buscador con las reglas del asistente: alias, plurales, «¿Quisiste decir…?», medidas dentro del tramo, «1 metro», «85x210», tipo de producto. Muestra cómo leyó la búsqueda y, con muchos resultados, agrupa por modelo | `catalogo/busqueda.ts`, `app/api/catalogo/route.ts`, `app/lectura-busqueda.tsx`, `app/agregar-producto.tsx`, `app/catalogo-consulta.tsx` | `tests/busqueda-interpretada.test.ts`; comprobado contra una copia de la base real |
| **N-08** | Lo que crea filas permanentes lo dice: «Crear en el catálogo» o «Es otro modelo: crearlo en el catálogo», con un aviso de que queda para todas las cotizaciones. «Producto especial» con «Otro cargo» reemplaza a «personalizado» e «ítem libre» | `app/preguntas-pendientes.tsx`, `app/agregar-producto.tsx` | `tests/pendientes.test.ts` y las E2E actualizadas |
| **N-10** | Los `null` de relleno de la IA (fábrica, flete) se ignoran sin mensajes internos | `servidor/chat.ts`, `asistente/flete.ts` | `tests/lineas-repetidas-chat.test.ts` |
| **N-11, H15** | Glosario aplicado: «Tipo de producto», «Estilo», «Costo de fábrica», «Precio de venta», «Producto especial», «Otro cargo». Ayuda con «Líneas repetidas, copias y productos especiales», «El catálogo en 5 minutos» y «Qué significa cada palabra» | `app/alta-producto.tsx`, `app/gestion-manuales.tsx`, `app/configuracion-catalogo.tsx`, `app/ayuda/page.tsx`, mensajes del servidor | `tests/ayuda.e2e.ts` y las E2E actualizadas |
| **N-12** | Aviso de recotización también al quitar, reordenar, agregar, duplicar y deshacer, comparando por identidad del ítem | `servidor/servicio.ts` (`avisosPreciosPorId`) | `tests/duplicar-linea.test.ts` |
| **N-13** | El PDF al cliente imprime la medida de los especiales y de las líneas con nombre propio | `servidor/pdf.ts` (`medidaParaCliente`) | `tests/pdf.test.ts` |
| **N-14** (parcial) | Mientras el asistente responde, un contador de segundos indica que se puede cancelar y seguir a mano. El bloqueo de la edición se mantiene: protege el borrador nuevo | `app/cotizador.tsx` | Pase visual |
| **N-15** | «Ocultar costos» (modo cliente) | `app/cotizacion-panel.tsx`, `app/memoria-pantalla.ts` | Pase visual |
| **N-16** | Deshacer y Rehacer cubren también el cliente, el descuento, el flete, la ganancia y las observaciones | `app/cotizador.tsx` | E2E de deshacer existentes y pase visual |
| **N-18** | «Agregar y seguir», que recuerda hoja o vano | `app/agregar-producto.tsx`, `app/cotizador.tsx` | Pase visual |
| **N-19** | «Convertir en producto especial» conserva el precio de partida; la línea se puede renombrar sin quedar pendiente | `app/cotizacion-panel.tsx` | `tests/duplicar-linea.test.ts` |
| **N-20, N-21** | «Tipo de producto al importar la planilla» dice que solo se aplica al importar; cambiar el código de una madera advierte que cambia los códigos que reconoce la fábrica | `app/configuracion-catalogo.tsx` | — |
| **N-22, N-24** | El chat aplica lo que puede y explica lo que omite; la posición dicha («la puerta 4 igual a la Molco») manda sobre el modelo nombrado como referencia, también en el validador previo al modelo | `servidor/chat.ts`, `asistente/anclaje.ts` (`posicionesDichas`), `asistente/llm.ts` | `tests/lineas-repetidas-chat.test.ts` |
| **N-26** | «No incluye» del PDF sin lo que la cotización sí cobra; con flete, no dice «puestos en fábrica» | `servidor/pdf.ts` (`textoNoIncluye`), `app/cotizacion-panel.tsx` | `tests/pdf-no-incluye.test.ts` |
| **N-27** | El primer producto agregado a mano lleva un id: un reintento no crea dos borradores | `servidor/servicio.ts`, `app/api/accion/route.ts`, `app/cotizador.tsx` | `tests/duplicar-linea.test.ts` |
| **N-29** | El aviso «Producto agregado» ya no se estira sobre la tabla | `app/cotizador-pantalla.css` | Pase visual |
| **N-30, N-40** | Confirmar hoja o vano mueve el foco a la siguiente puerta pendiente; «todas de hoja / todas de vano» | `app/cotizacion-panel.tsx` | Pase visual |
| **N-31, QA H-12** | Puerto base de la E2E paralela configurable (`NELTUME_E2E_PORT_BASE`); login de la E2E con plazo de 30 s | `scripts/e2e-paralelo.mjs`, `tests/login-e2e.ts` | — |
| **N-06, N-33** | Catálogo → «Modelos»: ficha por modelo con sus maderas y medidas; «Duplicar» (con ajuste ±% del costo y elección de maderas) crea un modelo nuevo listo para cotizar; «Renombrar» un modelo agregado aquí deja el nombre anterior como alias. En el alta, «Agregar otra medida o madera» conserva el modelo | `servidor/repositorio-catalogo.ts`, `app/api/catalogo/route.ts`, `app/modelos-catalogo.tsx`, `app/catalogo/*`, `app/alta-producto.tsx` | `tests/modelos-catalogo.test.ts` |
| **N-36, N-48** (parcial) | `better-auth` 1.7.14 y `zod` 4.6.7 (sin avisos de producción en `npm audit --omit=dev`); `data/referencias/` y `data/integracion/` en `.gitignore`; `.env.local` con permisos 600 | `package.json`, `.gitignore` | Suite completa |
| **N-42** | «Cotizar» desde Catálogo → Consultar abre la cotización con el producto ya elegido | `app/catalogo-consulta.tsx`, `app/page.tsx`, `app/cotizador.tsx`, `app/agregar-producto.tsx` | Pase visual |
| **N-44** | Borde de controles con contraste ≥ 3:1 | `app/globals.css` | — |
| IA H10 | La confirmación del chat dice qué cambió («Agregué 4 productos y cambié 1») | `servidor/chat.ts` | Suite |
| QA H-03, H-06, H-09, H-13 | Aviso que no tapa; Escape cierra el buscador; un doble clic no cierra el diálogo recién abierto; historial con medidas; campos de puerta por omisión en el alta | varios | Pase visual |
| Evaluaciones | 4 casos nuevos en `evals/cotizacion.json`: líneas repetidas, «otra igual», «duplica y vidriada», «tres separadas» | `evals/cotizacion.json` | Pendiente de correr con el modelo real |

## No hecho, y por qué

| Id | Qué falta | Motivo |
|---|---|---|
| N-14 (completo) | Editar mientras responde el asistente | El bloqueo está documentado como protección del borrador que crea el primer mensaje. Quitarlo exige reordenar el flujo del chat |
| N-17 | Rol «Vendedora» | Decisión de la tienda: se mantiene una sola cuenta-administradora |
| N-25 (resto) | Herramienta `buscar_catalogo` del asistente | El buscador único ya existe y es el paso previo. Agregar la herramienta cambia el prompt y requiere una evaluación pagada |
| N-28 | Revisión con precios acordados | Se mantiene la decisión M3 |
| N-34 | Rango de alto y espesor en el alta | Requiere columnas nuevas y la grilla de la ficha de modelo (05, etapa 5) |
| 05 etapas 3–5 (resto) | Grilla editable de costos en la ficha, categoría de precio guardada, borrador o publicación de modelos | Se hizo la parte que no exige migrar el esquema (vista por modelo, duplicar, renombrar). El resto exige migración con respaldo verificado (02, etapa 0.1) |
| N-38, N-39, N-41, N-43, N-46, N-47 | Autoguardado único, medida editable en la fila, regla única para modificar emitidas, salida propia en los mensajes «quien administra», alias desde el pendiente, línea de tiempo del seguimiento | Fuera del alcance de esta pasada; están en 02 como P2 |
| N-37, Arq M-01…M-06, S-03, S-06…S-09 | Refactorizaciones y seguridad de bajo impacto | P2/P3, sin riesgo explotable hoy; conviene hacerlas con los cambios ya integrados |
| IA H11 | «un metro» en el anclaje y la pregunta «para Producto» | Toca el anclaje; bajo impacto |

## Verificación (10 de noviembre de 2026)

| Verificación | Resultado |
|---|---|
| `npx tsc --noEmit` | 0 errores |
| `npx eslint .` | 0 errores, 2 avisos (los mismos de antes: `dialogo.tsx:27` y una prueba) |
| `npx vitest run` | **1.618 aprobadas, 0 fallidas** (103 archivos; 7 archivos de prueba nuevos) |
| `npm run test:e2e` (puerto 3141), dos corridas | **104 aprobadas, 1 omitida a propósito** en ambas |
| `npm audit --omit=dev` | Sin avisos de `better-auth` ni `zod`; quedan avisos de `vite` y `vitest`, que son herramientas de desarrollo |
| Pase visual con Playwright, 1440 × 900 y 390 × 844 (base aislada, IA `fijo`) | 4 de 4 recorridos aprobados: buscador con grupos y sugerencia, agregar y seguir, duplicar línea, convertir en especial, ocultar costos, Modelos → Duplicar, Consultar → Cotizar, revisión del alta, glosario |
| Evaluación con el modelo real (`npm run evaluar:regresion`) | **No ejecutada:** tiene costo y requiere tu aprobación. Los 4 casos nuevos de `evals/` ya pasan con el modelo «perfecto» de `tests/ia-perfecta.test.ts` |

**Hallazgos durante la verificación, ya corregidos:**

- «Convertir en producto especial» respondía «Solicitud inválida» porque los costos de la planilla traen decimales (155.600,575). Ahora se redondean.
- Con el modelo «perfecto», «4 Ranco… una por línea: 0,85; 1,00; 0,85; 1,00» dejaba 2 líneas, porque ese modelo usa una sola frase para todos los ítems. La regla del mismo turno ahora cuenta también cuántas veces se escribe la medida y reconoce «una por línea» y «por separado».
- `next start` exige `BETTER_AUTH_URL` con HTTPS: el pase visual se hizo con `next dev`, igual que la E2E del proyecto. No es un defecto.

## Evaluación con el modelo real (claude-haiku-5-5, 10 de noviembre de 2026)

`npm run evaluar:regresion` (80 casos × 3), tres corridas, ≈ US$ 0,21 cada una. Informes en `data/test-evaluar-ia/2026-11-10T12-26…`, `…12-38…` y `…12-46-claude-haiku-5-5`.

| Corrida | Perfectos | Precisión | Falsas alarmas | Silenciosos | Nota |
|---|---|---|---|---|---|
| 1 (rama tal cual) | 78/80 | 99,8 % | 3/234 | 1 | falsas alarmas en `lineas-repetidas` |
| 2 (con arreglo de lista) | 75/80 | 98,7 % | 0/231 | 0 | 2 sin respuesta del proveedor (plazo de 60 s) |
| 3 (con «una por línea») | 77/80 | 99,8 % | 0/234 | 1 | no pasa el umbral de 0 silenciosos |

Arreglos que salieron de la evaluación:
- `anclarFrases` ubica la frase «encabezado: elemento» que la IA arma de una lista («4 Ranco …, una por línea: 1,00»), y en un pedido «una por línea» / «separadas» el 4 es el total que se reparte: sin «No pude verificar» ni «parece decir 4».
- `enLineasSeparadas` (chat.ts): si el mensaje pide líneas separadas y la IA agrupó («2 Ranco de 0,85»), se separa en líneas de 1.

Fallas que no vienen de la rama: `con-su-marco` (Haiku deja el marco con cantidad 1) y `flete-antes-de-productos` (deja vacío el ancho de «80x200») fallan igual en `main` con el mismo modelo hoy, y el 7 de noviembre pasaban: es un cambio de comportamiento del modelo. El prompt ya lo pide (llm.ts, «Con su marco»). Ambas quedan avisadas en la pantalla; el único error silencioso de la corrida 3 es una de esas corridas o `pedir-precio-no-es-escribirlo` (1 de 3, Huilo Huilo sin cantidad).

### Razonamiento del modelo (CMD_RAZONAMIENTO)

Antes Haiku no razonaba: el proxy rechaza `temperature` y la herramienta forzada (`tool_choice: any`) deja el razonamiento en 0 tokens. Ahora los modelos Claude se piden con `thinking: {type: "adaptive"}` y `output_config: {effort}`, con la herramienta en `auto` (src/asistente/llm.ts, `razonamientoIA()` en configuracion.ts). El predeterminado es `high`, y `CMD_RAZONAMIENTO=no` vuelve a la petición anterior. Si un proveedor rechaza el razonamiento, la petición se repite sin él (opciones-peticion.ts). La variable llega al contenedor por compose.yaml.

| Corrida (Haiku, 80 × 3) | Perfectos | Precisión | Falsas alarmas | Silenciosos | Costo | p90 |
|---|---|---|---|---|---|---|
| Sin razonamiento (corrida 3) | 77/80 | 99,8 % | 0 | 1 | US$ 0,207 | 5,3 s |
| high, primera | 78/80 | 99,4 % | 1 | 4 | US$ 0,234 | 5,0 s |
| high, con los dos arreglos | **80/80** | **100 %** | **0** | **0** | US$ 0,232 | 5,3 s |

Con razonamiento, el modelo usó la operación `duplicar` y la herramienta libre de dos maneras nuevas, que se corrigieron del lado de la tienda:
- «agrega 1 igual pero de 90» a «2 Palena»: la copia lleva la cantidad dicha (`cantidadDeLaCopia`).
- «despacho a Riñihue para 3 pallets»: la carga del despacho no es un ítem libre (`productoNoPedido`).

Con razonamiento hubo la mitad de llamadas (312 contra 630), porque se necesitaron menos reintentos.

#### Selector junto al chat

El nivel se elige en el compositor del cotizador, junto a «Enviar»: Rápido (sin razonar), Poco, Medio, Alto o Máximo. La opción marcada «(predeterminado)» es la del modelo configurado. La elección se recuerda en el navegador **por modelo** (`neltume:preferencia:razonamiento:<modelo>`), así un nivel pensado para Claude no pasa a Qwen. Viaja con cada mensaje (`razonamiento` en la acción `chat`), y el registro `[asistente]` lo anota.

**Vale para todos los modelos** (desde el 10 nov 2026):

- **Claude** (API de Anthropic): `thinking: {type: "adaptive"}` + `output_config: {effort}`.
- **Los demás** (Qwen, DeepSeek, GPT, Kimi…, por Chat Completions): `reasoning_effort`. El proxy de CommandCode lo valida y acepta `off|low|medium|high|xhigh|max`. Con razonamiento no se envía temperature, la herramienta queda en `auto` y `max_tokens` sube a 16 384, porque el razonamiento se descuenta de ahí.
- **Predeterminado** (`razonamientoPredeterminado()`): `CMD_RAZONAMIENTO` si es válido, para cualquier modelo. Si no está, `high` en Claude (el evaluado) y `no` en los demás. Con `no` la petición es igual a la de antes del selector, así producción no cambia si nadie toca el selector.
- **Si un modelo rechaza el nivel**, responde con un 400 que nombra thinking, output_config o effort, y la petición se repite sin razonamiento.
- **Modelo de respaldo**: usa el nivel elegido o, sin elección, su propio predeterminado.

Pruebas directas al proxy (10 nov 2026, una muestra por nivel, con una herramienta):

| Modelo | `required` (como hoy) | `auto` + nivel |
|---|---|---|
| Qwen 3.7 Flash | 0 tokens de razonamiento, 2 s, cálculo errado | low 1.024 tokens (errado) · medium 1.488 · high 2.185 · max 1.782; 10–21 s, aciertan |
| DeepSeek v4.1 Flash | razona ~80 tokens, acierta | 80–110 tokens, 2,5–5 s; `off` no razona y erra |
| GPT-5.5 / 5.4 mini | no están en el plan de CommandCode (403 `MODEL_NOT_IN_PLAN`) | el proxy valida los niveles; no aceptan `off` |

Pendiente: ningún nivel distinto de «no» está evaluado en Qwen ni en DeepSeek. Antes de cambiar el predeterminado de un modelo, corre `npm run evaluar:regresion` con ese nivel (`CMD_RAZONAMIENTO=<nivel>`). Con Qwen hay que vigilar la latencia frente a `CMD_TIMEOUT_MS`.

#### GPT-6 Luna (evaluación del 10 nov 2026, 80 casos × 3)

| Nivel | Casos perfectos | Precisión | Falsas alarmas | Silenciosos | Costo | p90 |
|---|---|---|---|---|---|---|
| Rápido (sin nivel) | 75/80 | 98,5 % | 0 | 4 | US$ 0,329 | 6,6 s |
| Alto | 76/80 | 99,3 % | 2 | 1 | US$ 0,331 | 7,7 s |

Ninguno pasa la regresión. Haiku con «Alto» dio 80/80 por US$ 0,21–0,23 y p90 5,3 s.

- **Arreglado en la tienda:** el error silencioso de «Alto» era el flete anotado dos veces, como flete y como ítem libre «flete» (`flete-iva-incluido`). Ahora, si la respuesta trae flete, se quita el ítem libre «flete/despacho/envío/transporte» (`esElFlete` en chat.ts).
- **Sin arreglar:** Luna deja vacío el ancho de «1 metro» y de «1,90». Esos casos salen con aviso, no en silencio; el modo «avisar» no los completa por su cuenta.
