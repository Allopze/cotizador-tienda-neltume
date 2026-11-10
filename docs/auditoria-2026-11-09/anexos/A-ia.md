> **Anexo de la auditoría del 9–10 nov 2026.** Informe especializado tal como se entregó. Donde `../01_AUDITORIA_COMPLETA.md` §5.2 lo corrige (por ejemplo, los permisos de la vendedora: en producción todas las cuentas son administradoras), manda el informe consolidado. Las rutas `scratchpad/…` remiten a la evidencia de la sesión de auditoría, que no se guarda en el repositorio.

# Auditoría del asistente (LLM, herramientas y guardas): cotizador Neltume

Fecha: 9 nov 2026. Alcance: solo lectura. No se cambió el repositorio, no se llamó a ningún modelo real y no se tocó `data/cotizador.sqlite`: se leyó una copia temporal para extraer el catálogo, y esa copia ya se borró.

## Cómo se probó

- **Capa de ejecución (servidor):** 36 escenarios con **respuestas de modelo simuladas** (`llm.interpretar` es un `vi.fn`, con `verificarCifras: true` y anclaje `avisar`, como en producción; A1 se repitió en `corregir`). Pasan por el `Servicio` real y por `procesarChat`, el anclaje, los precios y `recalcular`, con el **catálogo real** (8.772 productos de la planilla principal). Todos los escenarios corren en verde: las pruebas registran lo que pasa y no afirman lo que debería pasar.
  - Pruebas: `scratchpad/ia/escenarios.test.ts` y `scratchpad/ia/extra.test.ts`.
  - Resultados: `scratchpad/ia/resultados.json` y `scratchpad/ia/resultados-extra.json`.
  - Se corren con `npx vitest run --config <scratchpad>/ia/vitest.config.ts`.
- **Capa de interpretación (modelo):** **no se probó**. Lo que se dice de la respuesta «correcta» del modelo es una suposición explícita en cada escenario.
- **Notas de contexto:**
  - `.env.local` tiene `CMD_MODEL=claude-haiku-5-5`, y las últimas evaluaciones de `data/test-evaluar-ia/` (7 nov) son de Haiku. La memoria del proyecto dice que en producción corre Qwen 3.7 Flash. Conviene confirmar qué modelo atiende hoy.
  - Durante la auditoría, otro proceso (`next dev` en `.next-e2e/qa3123`, con cwd en este repo) modificó `next-env.d.ts` y `tsconfig.json`. **No fue esta auditoría** y no se revirtió, para no romper esa ejecución.

Rutas completas:
- `/private/tmp/claude-501/-Users-allopze-dev-Neltume-tienda-puertas-Cotizador/8966eded-8fcc-4676-8be7-0eb3db948605/scratchpad/ia/escenarios.test.ts`
- `/private/tmp/claude-501/-Users-allopze-dev-Neltume-tienda-puertas-Cotizador/8966eded-8fcc-4676-8be7-0eb3db948605/scratchpad/ia/extra.test.ts`
- `/private/tmp/claude-501/-Users-allopze-dev-Neltume-tienda-puertas-Cotizador/8966eded-8fcc-4676-8be7-0eb3db948605/scratchpad/ia/resultados.json`
- `/private/tmp/claude-501/-Users-allopze-dev-Neltume-tienda-puertas-Cotizador/8966eded-8fcc-4676-8be7-0eb3db948605/scratchpad/ia/resultados-extra.json`

## Arquitectura relevante (resumen)

- **Una sola llamada por turno.** `llm.ts:95` dice «Llama exactamente una herramienta»; `commandcode-chat.ts:47` fija `parallel_tool_calls:false`.
  - El contexto viaja como un JSON en un único mensaje de usuario: no hay bucle de herramientas ni resultados intermedios.
  - El modelo no puede buscar en el catálogo y luego actuar; solo ve `catalogo` (el mapa de modelos, maderas y medidas) dentro del contexto.
- **Herramientas** (`llm.ts:277-298`): `modificar_cotizacion` (agregar, items, quitar, cliente, flete), `aprobar_cotizacion`, `asignar_fabricas`, `cambiar_numero` y `responder`.
  - El servidor todavía acepta `actualizar_cotizacion`, aunque ya no se ofrece.
  - **No hay** herramientas para duplicar o copiar un ítem, buscar en el catálogo, reordenar, fijar el margen, el descuento general, las observaciones de la cotización o el despacho, ni para crear un producto o una familia.
- **Reintento** (`llm.ts:426-454`): un reintento con `correccion` si `problemaSalida` o `revisarSalida` objetan la respuesta. En modo `avisar` solo se reintenta por formato, índices, `responder` en vez de registrar y fábricas dichas sin asignar.
- **Cadena del servidor** (`chat.ts:1218-1405`):
  1. `productoNoPedido`
  2. `fabricasDichas`
  3. `aplicarModificacion` (índices, `indiceCoherente`, quitar y **deduplicación**)
  4. `anclarFrases`, `anclarCifras` y `anclarNombres`
  5. `anclarTextos` y `anclarCliente`
  6. `preciosEscritos` y `descuentosEscritos`
  7. `sanearSolicitudes`
  8. `recalcular`

  Los avisos se unen en el texto del asistente en el historial (`chat.ts:1452-1468`) y además se muestran como aviso emergente (`cotizador.tsx:598`).

---

## Hallazgos

### H1. El chat no puede agregar líneas idénticas: la guarda de BUG-008 descarta pedidos legítimos (Problema A)

- **Severidad:** Alta. **Prioridad:** P1.
- **Archivo:** `src/servidor/chat.ts:944-970` (`claveItem`, `vistos`, `duplicados`).
- **Evidencia (respuesta simulada, catálogo real):**
  - **A1** (avisar y corregir). «Cotiza 4 Ranco en pino oregón de 2 m de alto, una por línea: 0,85; 1,00; 0,85; 1,00», con 4 ítems en `agregar`, da 2 ítems: «No dupliqué 1 × RANCO PINO OREGON 0,85 × 2,00, 1 × RANCO PINO OREGON 1,00 × 2,00: ya estaba en la cotización con la misma cantidad.» y luego «Cotización actualizada.».
  - **A2.** En un turno posterior, «agrega otra Ranco pino oregón 85x200 para el baño» se descarta.
  - **E1a.** «Agrega otra puerta igual a la primera» se descarta.
  - **E5a.** «Agrega tres puertas iguales, pero separadas» descarta las 3.
  - **E5b.** «3 Ranco … cada una en una línea separada» descarta 2.
  - **E3.** «Duplica esta Ranco y haz que la copia sea vidriada» se descarta: ver H2.
  - **E6b.** A mano (`agregar_producto`, `servicio.ts:882-911`) sí se pueden tener dos Ranco iguales, porque no hay deduplicación.
- **Por qué importa para la clienta:**
  - Las obras piden la misma puerta en líneas separadas (una por vano o recinto). El chat nunca puede crearlas, ni aunque lo repita: cada reintento se vuelve a descartar.
  - El total y el **descuento por cantidad** (que cuenta puertas) quedan por debajo de lo pedido.
  - El único camino es la interfaz manual.
- **Causa raíz:**
  - Se resolvió BUG-008 («la IA reenvía un ítem de un turno anterior») con una regla de igualdad de valores. Esa regla no distingue el origen.
  - La clave compara 7 campos crudos de la IA y descarta tanto contra los ítems existentes como contra los demás ítems del mismo turno.
  - Contradice a `anclaje.ts:134-138` (`diceIgual`), que **sí** admite «otra igual» y «las mismas» como respaldo de las cifras copiadas.
  - Contradice también al prompt (`llm.ts:105`: «Registra en agregar cada producto del mensaje como un ítem propio, aunque … se repita el modelo»).
- **Observado vs esperado:** se descartan todas las líneas repetidas, aunque las pida la persona. Lo esperado es descartar solo el reenvío de la IA y conservar lo que la persona pide en este mensaje.
- **Arreglo recomendado (servidor y esquema, no prompt).** Distinguir el **origen**, que el servidor sí puede verificar:
  1. **Reenvío de la IA** (descartar en silencio y registrarlo solo en el diagnóstico):
     - la `fuente` del agregado coincide, normalizada, con la `fuente` de un ítem existente (el caso de BUG-008: la IA copia el ítem con su frase antigua; A3); o
     - la `fuente` no está en el mensaje actual (`fraseDelMensaje` es falso), y la clave normalizada es igual a la de un ítem existente.
  2. **Pedido de la persona** (conservar): la `fuente` está en el mensaje actual. Dentro del mismo turno, se aceptan N copias iguales cuando hay N frases ubicadas en posiciones distintas del mensaje, o cuando la frase repetida aparece N veces, o con marcadores de multiplicidad («otra», «iguales», «separadas», «cada una», «una por línea»). Si queda una duda, **se agrega y se avisa** («Agregué 2 líneas iguales (ítems 1 y 3); si sobra una, quítala»), con botón de quitar. Nunca se descarta algo escrito en este mensaje: el riesgo de BUG-008 era el **silencio**, y un aviso con deshacer lo cubre.
  3. **Operación declarativa de copia** en `modificar_cotizacion`: `duplicar: [{ indice, veces?, cambios? }]`.
     - El servidor copia el ítem del borrador con todos sus datos (precio especial, margen, descuento, observaciones, referencias; la fábrica la decide el negocio) y aplica `cambios` con el anclaje habitual.
     - Así «igual a la 2», «duplica y que la copia sea vidriada» y «tres iguales separadas» dejan de depender de que la IA reescriba el ítem completo. Ver H6.
- **Categoría:** Lógica (servidor) / Diseño de herramienta. **Causa raíz:** confirmada.
- **Pruebas requeridas:**
  - unitarias con modelo simulado: A1, A2, E1a, E3, E5a, E5b (se agregan) y A3 (se sigue descartando, sin aviso visible);
  - un caso nuevo en `evals/` con líneas idénticas, «otra igual» y «duplica». **Hoy no hay ninguno**: ningún caso de `evals/cotizacion.json` tiene ítems esperados repetidos. La corrida con el modelo real requiere aprobar el costo.
- **Esfuerzo:** medio (2 a 3 días con la operación `duplicar` y las pruebas). **Confianza:** confirmado.

### H2. La clave de duplicado ignora observaciones, descripción, precio, descuento y fábrica: una copia distinta se descarta

- **Severidad:** Media. **Prioridad:** P1, se corrige junto con H1.
- **Archivo:** `src/servidor/chat.ts:946-947`.
- **Evidencia:** en E3, la copia con `observaciones:'vidriada'` (texto que sí está en el mensaje) se descarta por igual. Lo mismo pasaría con otro precio escrito, otro descuento u otra fábrica.
- **Por qué importa:** la variante que pidió la persona se pierde, y el aviso le dice que «ya estaba».
- **Causa raíz:** la clave solo usa modelo, madera, medidas, cantidad y tipo de medida.
- **Observado vs esperado:** se descarta una copia distinta; lo esperado es conservar toda línea que difiera en cualquier dato que llegue al documento.
- **Arreglo:** si se mantiene alguna deduplicación (para el reenvío, H1.1), la clave debe incluir todo lo que llega al documento o a la nota, y ya normalizado (ver H3).
- **Categoría:** Lógica. **Pruebas:** E3. **Esfuerzo:** bajo. **Confianza:** confirmado.

### H3. La misma guarda deja pasar el reenvío real si la IA cambia la forma: madera con tilde o medidas en cm

- **Severidad:** Media. **Prioridad:** P2.
- **Archivo:** `src/servidor/chat.ts:946-948`, que compara valores crudos antes de `recalcular`.
- **Evidencia:** en A4, la IA reenvía la Ranco del turno 1 como `{modelo:'Ranco', madera:'pino oregón', ancho:85, alto:200}` junto con la Molco nueva. Resultado: **3 ítems**, con la Ranco duplicada, `avisos: []` y «Cotización actualizada».
- **Por qué importa:** BUG-008 sigue abierto en su forma real: el pedido duplicado y el total al doble, sin aviso.
- **Causa raíz:** la comparación es literal (minúsculas, pero sin quitar tildes ni normalizar unidades) contra ítems ya normalizados.
- **Observado vs esperado:** el reenvío se agrega en silencio; lo esperado es reconocerlo como reenvío.
- **Arreglo:** usar el criterio de origen de H1 (la `fuente` antigua es la señal fuerte) y una clave normalizada con `resolverItem` o `metros` y `normalizar`.
- **Categoría:** Lógica (IA). **Pruebas:** A3 y A4. **Esfuerzo:** bajo. **Confianza:** confirmado.

### H4. El chat no puede responder nada que lleve una cifra: regresión del arreglo de BUG-030

- **Severidad:** Alta. **Prioridad:** P1.
- **Archivo:** `src/servidor/chat.ts:142-145` (`textoMonetario`) y `:1258-1264`; la causa está en `src/asistente/montos.ts:125-143`.
- **Evidencia:**
  - `montosDelTexto` devuelve **cualquier** número como monto: «0,80 × 2,00 m» da `[1, 2]`, «Tienes 2 Molco» da `[2]` y «medida 2x4» da `[2, 4]`.
  - **E6c.** La respuesta simulada «¿Qué medida debe tener la segunda puerta (Molco lenga 0,80 × 2,00 m)?» llega como «Puedo ayudarte con modelos, maderas, medidas, cantidades y datos del cliente. Los montos se muestran en la cotización.».
  - **E7a.** «En pino oregón de 1,00 m de ancho hay Ranco, Molco y Rupanco…» se reemplaza igual.
  - Las pruebas existentes (`tests/servicio.test.ts:620-632`) solo usan frases sin dígitos.
- **Por qué importa:**
  - El prompt manda preguntar cuando hay ambigüedad (`llm.ts:103`: «Si no puedes identificar con seguridad a qué ítem se refiere, usa responder para preguntar cuál»).
  - Con dos Ranco (0,85 y 1,00), la pregunta natural lleva cifras y se convierte en un texto genérico que no responde nada. Lo mismo ocurre al explicar el catálogo o al confirmar cantidades.
- **Causa raíz:** BUG-030 recomendó reutilizar `montosDelTexto`, que fue hecho para **anclar** (acepta números sueltos), no para **detectar** dinero.
- **Observado vs esperado:** se bloquea toda respuesta con dígitos; lo esperado es bloquear solo los montos o porcentajes reales.
- **Arreglo:** un detector propio de dinero (marca `$`, «mil», «lucas», «millones», «pesos», «CLP», «+ IVA», «precio:» o cifras de 4 o más dígitos fuera de una medida) y `porcentajesDelTexto`. Quitar antes las medidas con `sinMedidas` (`chat.ts:868`) y las cantidades seguidas de un modelo.
- **Categoría:** Lógica / Regresión. **Pruebas:** E6c y E7a pasan; «Cuesta $120.000», «450 lucas» y «Precio: 450.000 + IVA» siguen filtrados (S5.01). **Esfuerzo:** bajo. **Confianza:** confirmado.

### H5. Correcciones internas se muestran a la usuaria como mensajes (Problema D) y además ensucian el contexto del modelo

- **Severidad:** Media. **Prioridad:** P1.
- **Archivo:** `src/servidor/chat.ts:229-260` (`fabricasDichas`, líneas 243 y 249) y `src/asistente/flete.ts:24-29`.
- **Evidencia:**
  - **D1.** «1 Molco lenga 80x200» con `fabrica:null` y `flete:null` (relleno típico de un modelo que completa todos los campos) da «No quité el flete: tu mensaje no habla de él.» y «No quité la fábrica de MOLCO: el mensaje no lo pide.», en un borrador **sin flete y con un ítem nuevo sin fábrica**: no había nada que quitar.
  - **A1b.** El aviso aparece repetido **4 veces** (una por ítem).
  - **D2.** En una edición de cantidad: «No quité la fábrica de 1 × RANCO PINO OREGON 0,85 × 2,00…».
  - **R1.** Ver H7.
- **Por qué importa:**
  - Ruido que parece un error o un rechazo de algo que la persona no pidió, y que tapa los avisos útiles.
  - Estos textos entran al historial que vuelve al modelo (`TURNOS_HISTORIAL=6`, 500 caracteres por respuesta del asistente) y le quitan espacio a lo relevante.
- **Causa raíz:**
  - `null` está sobrecargado: significa a la vez «no dijo nada» y «quitar», en `fabrica` de `agregar` y `cambios` (`esquemas.ts:41`, `:79` y `:112`) y en `flete` (`esquemas.ts:154`).
  - La guarda de BUG-026 avisa en vez de ignorar en silencio.
- **Observado vs esperado:** se muestran avisos sin acción posible; lo esperado es que la usuaria no vea correcciones que no le piden hacer nada.
- **Arreglo (esquema y servidor):**
  1. En `agregar`, `fabrica` es solo el enum, opcional, y un `null` es un no-op.
  2. En `cambios`, un `null` sobre un ítem sin fábrica es un no-op silencioso.
  3. Quitar fábrica o flete con una operación explícita (`asignar_fabricas` con `null`, que ya existe, o `quitar_flete: true`) en vez de `null`.
  4. Cuando la guarda anule algo que existía, registrarlo en `diagnostico` con una categoría nueva `interno`, sin mostrarlo.
  5. Deduplicar avisos idénticos.
- **Categoría:** UX / Diseño de herramienta. **Pruebas:** D1, D2 y A1b sin avisos; S1.13 y S1.18 de la auditoría (quitar sin pedirlo) siguen sin aplicarse. **Esfuerzo:** bajo. **Confianza:** confirmado en la ejecución; la frecuencia con el modelo de producción es **probable** (las evaluaciones guardadas no contienen estos avisos).

### H6. «Otra igual» no funciona por ninguna de sus dos lecturas correctas, y la copia pierde el precio especial

- **Severidad:** Media. **Prioridad:** P1.
- **Archivo:** `chat.ts:944-970` (agregar) y `anclaje.ts:148-189` (`anclarCifras`, que exige la cifra escrita).
- **Evidencia:**
  - **E1a.** Leído como copia (`agregar`), se descarta (H1).
  - **E1b.** Leído como `items[0].cantidad: 2`, queda «El asistente propuso la cantidad 2 … pero esa cifra no aparece en tu mensaje: quedó pendiente» y el ítem pasa a pendiente (cantidad `?`).
  - **E1c.** Solo funciona si la original tenía otra cantidad (3 + 1).
  - **E1d.** La copia de un especial («agrega 2 más iguales a la Pillán», que costaba $300.000) queda pendiente (`modelo_desconocido`), con «No apliqué el precio del ítem 2: no aparece escrito como precio en su línea».
- **Por qué importa:** es el pedido más natural para repetir una puerta, y deja la cotización incompleta o sin la línea.
- **Causa raíz:** no existe una operación de copia. La IA tiene que reescribir el ítem, y el anclaje (correctamente) no acepta cifras ni precios que no estén escritos. «Otra» como +1 no se deriva.
- **Observado vs esperado:** el pedido queda descartado o pendiente; lo esperado es que el servidor copie el ítem y aplique las diferencias.
- **Arreglo:** la operación `duplicar` de H1.3. El servidor copia, así que no hay cifras nuevas que anclar, y el precio especial, el descuento y las referencias se conservan. Para «otra» como +1, derivar en el servidor (`cantidad = previa + 1` si la frase dice «otra» o «una más») en vez de exigirle la cifra a la IA.
- **Categoría:** Diseño de herramienta / Anclaje. **Pruebas:** E1a a E1d. **Esfuerzo:** medio (dentro de H1). **Confianza:** confirmado.

### H7. Si una parte del cambio no pasa, se rechaza el turno completo y el mensaje que ve la usuaria puede ser engañoso

- **Severidad:** Media. **Prioridad:** P2.
- **Archivo:**
  - `chat.ts:879-937`: los `return null` por índice fuera de rango, índice repetido, cambios vacíos, `indiceCoherente`, quitar en conflicto y más de 100 ítems;
  - `chat.ts:1243-1250`: el texto que se muestra.
- **Evidencia:**
  - **R2.** «que la Coz Coz sean 3 y agrega 1 Molco lenga 80x210», con el índice equivocado en la edición, da solo «No entendí, ¿puedes reformularlo?». **También se pierde la Molco**, que era válida.
  - **R1.** Lo mismo con `fabrica:null` en la Molco da «No quité la fábrica de MOLCO: el mensaje no lo pide. ¿A qué fábrica va cada ítem? …». Se le pregunta por fábricas cuando el problema fue el índice.
- **Por qué importa:** la persona repite el mensaje sin saber qué falló, o asigna fábricas sin necesidad.
- **Causa raíz:** `aplicarModificacion` es todo o nada y no informa por qué rechazó. La rama `!aplicado` supone que, si hubo avisos de fábrica, la causa fue la fábrica.
- **Observado vs esperado:** se pierde todo el turno con un mensaje que no explica la causa; lo esperado es aplicar lo válido y explicar lo que se descartó.
- **Arreglo:**
  - Devolver `{ aplicado, rechazos: [{ indice, motivo }] }`.
  - Aplicar las partes independientes (agregar no depende de una edición) y explicar cada rechazo en palabras de la usuaria: «No cambié la cantidad: no sé si te refieres a la Molco (ítem 2) o a la Coz Coz (ítem 4)».
  - Mostrar la pregunta de fábricas solo si la causa fue la fábrica.
- **Categoría:** Manejo de errores / UX. **Pruebas:** R1 y R2. **Esfuerzo:** medio. **Confianza:** confirmado en la ejecución. En producción, `problemaSalida` intentaría una corrección antes (ver H8).

### H8. `indiceCoherente` y `problemaSalida` rechazan referencias válidas que nombran otro modelo, y la corrección empuja al modelo al ítem equivocado

- **Severidad:** Media. **Prioridad:** P2.
- **Archivo:** `src/servidor/chat.ts:854-863` y `src/asistente/llm.ts:376-391`.
- **Evidencia:**
  - **E2b.** «Quiero la puerta 4 igual a la Molco» (editar el índice 3, la Coz Coz) da «No entendí, ¿puedes reformularlo?».
  - **R3.** «la segunda puerta, la que va al lado de la Coz Coz, que sean 3» (índice 1, la Molco) también da «No entendí».
  - **P1.** La corrección que recibiría el modelo es «El índice 1 es MOLCO, pero el mensaje habla de COZ COZ: usa el índice del ítem que nombra el mensaje…». Lo empuja a editar la Coz Coz (índice 3), y esa respuesta **sí** pasaría `indiceCoherente`, porque la Coz Coz está nombrada.
  - **E2a** («la puerta 4 igual a la puerta 2», sin nombres) funciona.
- **Por qué importa:** una referencia por posición con un punto de referencia hablado no se aplica, o, tras el reintento, puede cambiar el ítem equivocado (que es justo lo que BUG-007 quería evitar).
- **Causa raíz:** basta con que el modelo del índice no esté entre los nombrados en todo el texto. No se distingue el ítem **objetivo** del ítem **de referencia** («igual a», «al lado de», «como la»).
- **Observado vs esperado:** se rechaza la referencia válida; lo esperado es aceptar el índice dicho por posición y usar el modelo nombrado solo como referencia.
- **Arreglo:**
  - Que la herramienta declare el objetivo y la referencia por separado. Con `duplicar` o `copiar_de: { indice }`, el servidor valida el objetivo contra el ordinal dicho («puerta 4», «la segunda») y la referencia contra el modelo nombrado.
  - Si el mensaje trae un ordinal explícito que coincide con el índice, aceptarlo aunque nombre otro modelo.
  - Ante una duda real, preguntar con `responder`, que hoy no puede llevar cifras (H4).
- **Categoría:** Lógica (guardas). **Pruebas:** E2a, E2b y R3, más S1.19, S1.20 y S1.28 de la auditoría (que deben seguir rechazados). **Esfuerzo:** medio. **Confianza:**
  - confirmado: el rechazo y el texto de la corrección;
  - probable: que el modelo real termine editando el ítem equivocado (no se llamó a ningún modelo).

### H9. La IA tiene muchas menos capacidades que la interfaz manual, y no hay búsqueda en el catálogo

- **Severidad:** Media. **Prioridad:** P2.
- **Archivo:** `src/asistente/llm.ts:277-298` (herramientas) frente a `src/servidor/acciones.ts:8-128` (acciones de la interfaz).
- **Evidencia:** ver la tabla «Manual vs IA». E7a y E7b muestran que «busca una puerta de pino oregón de 1 m» solo puede responderse con texto, y ese texto se bloquea por H4.
- **Por qué importa:** la persona no sabe qué puede pedir por chat. Los pedidos fuera del alcance acaban en «No entendí» o en un texto genérico, en vez de una derivación clara.
- **Causa raíz:** el diseño es de extracción de un solo paso. No hay herramientas de lectura ni de operaciones declarativas.
- **Observado vs esperado:** varias funciones de la interfaz no tienen equivalente en el chat, y el chat no lo dice; lo esperado es cubrir lo frecuente y derivar con claridad lo demás.
- **Arreglo, por prioridad y sin resolverlo con el prompt:**
  1. `duplicar` (H1 y H6).
  2. `buscar_catalogo` de solo lectura, resuelta en el servidor (`busqueda.ts` ya existe): filtros de modelo, madera y medida; devuelve opciones **sin precios** y el servidor arma la respuesta (con botones «Agregar»). Requiere permitir dos pasos o que el servidor responda directamente.
  3. En `agregar`, un campo `familia` (PUERTA, MARCO, PIEZAS_T, MOLDURA) para los especiales, en vez de inferirla.
  4. Las respuestas fuera de alcance (margen, descuento general, reordenar, observaciones de la cotización, editar una aprobada) deben derivar a la acción de la interfaz con un texto fijo del servidor.
- **Categoría:** Diseño de herramientas / Capacidad. **Pruebas:** casos de `evals/` por capacidad (con costo que aprobar) y unitarias de la derivación. **Esfuerzo:** alto si se hace completo; `duplicar` y la derivación cuestan poco. **Confianza:** confirmado (lectura de código).

### H10. Textos de éxito y de duplicado que no dicen la verdad

- **Severidad:** Baja. **Prioridad:** P3.
- **Archivo:** `chat.ts:968` y `chat.ts:1447-1466`.
- **Evidencia:**
  - En A1, la cotización estaba vacía y aun así se lee «ya estaba en la cotización con la misma cantidad» (era un duplicado del mismo turno).
  - En A2, E1a, E3 y E5a no cambió nada y la respuesta igual termina en «Cotización actualizada. Revisa el detalle…».
- **Por qué importa:** la persona cree que se aplicó lo que pidió.
- **Causa raíz:** el texto de éxito se emite sin comparar el antes y el después en un borrador; `sinCambios` solo se revisa fuera del borrador o en `modificacion_anterior` (`chat.ts:1413-1424`).
- **Observado vs esperado:** se anuncia un éxito sin cambios; lo esperado es decir que no se cambió nada y por qué.
- **Arreglo:** si `cambios` queda vacío, responder «No cambié nada: …» con la causa.
- **Categoría:** UX. **Pruebas:** A2 y E1a. **Esfuerzo:** bajo. **Confianza:** confirmado.

### H11. Las medidas en palabras («un metro») no se anclan, y la pregunta dice «para Producto»

- **Severidad:** Baja. **Prioridad:** P3.
- **Archivo:** `anclaje.ts:84-94` (`cifrasDelTexto(t, false)` para las medidas: solo dígitos) y la pregunta de `faltan_datos` sin modelo.
- **Evidencia (E7b):**
  - «una puerta de pino oregón de un metro de ancho» da «El asistente propuso el ancho 1 m … esa cifra no aparece en tu mensaje», junto a «tu mensaje parece decir la cantidad 1 y no lo anoté».
  - La pregunta queda como «¿Qué modelo necesitas para Producto?».
- **Por qué importa:** el ancho se pierde en un pedido dictado por voz, y la pregunta se lee rara.
- **Causa raíz:** el respaldo de medidas solo acepta dígitos, y la etiqueta usa «Producto» cuando el modelo es null.
- **Observado vs esperado:** se pierde el ancho y la pregunta se lee rara; lo esperado es leer «un metro» como 1,00 m y nombrar el ítem por lo que se sabe.
- **Arreglo:** aceptar «un metro», «metro y medio» y «medio metro» en `cifrasDelTexto(…, false)` solo cuando van junto a una unidad; nombrar el ítem por su madera y medida («la puerta de pino oregón»).
- **Categoría:** Anclaje / UX. **Pruebas:** E7b. **Esfuerzo:** bajo. **Confianza:** confirmado.

### H12. Falta cobertura de pruebas y de evaluaciones para estos comportamientos

- **Severidad:** Baja. **Prioridad:** P2, porque protege los arreglos.
- **Archivo:** `evals/cotizacion.json` (76 casos: solo `agrega-igual` toca «igual», y con otra medida), `tests/servicio.test.ts:620` y no hay ninguna prueba de BUG-008 en `tests/` (`grep BUG-008 tests` no encuentra nada).
- **Evidencia:** ningún caso esperado tiene líneas repetidas; no hay pruebas de `responder` con cifras ni de avisos internos.
- **Por qué importa:** estos errores no se ven en `evaluar:regresion`.
- **Arreglo:**
  - incorporar los escenarios de este informe como pruebas unitarias (sin costo);
  - agregar a `evals/` los casos «4 Ranco 0,85/1,00/0,85/1,00», «otra igual», «duplica y que la copia sea vidriada», «tres iguales separadas», «la puerta 4 igual a la 2», «la segunda, al lado de la Coz Coz» y «busca…». Correrlos con el modelo real requiere **aprobar el costo** antes.
- **Categoría:** Pruebas. **Esfuerzo:** bajo. **Confianza:** confirmado.

---

## Tabla de escenarios

**Columnas:**
- **Interpretación:** si el problema está en lo que entiende el modelo.
- **Ejecución:** si el problema está en lo que hacen el servidor y sus guardas.
- **Resultado:** cómo se obtuvo; «Simulado» es una respuesta de modelo simulada ejecutada en el servidor real, y en ningún caso se probó el modelo real.

| # | Mensaje | Llamada «correcta» supuesta | Qué hace el servidor | Interpretación | Ejecución | Resultado |
|---|---|---|---|---|---|---|
| A1 | «4 Ranco pino oregón … 0,85; 1,00; 0,85; 1,00» | `agregar` con 4 ítems | Deja 2. «No dupliqué …». | — | **Error** (H1) | Simulado (avisar y corregir) |
| A1b | Igual, con `fabrica:null` | Igual | Deja 2, más 4 × «No quité la fábrica de RANCO». | — | **Error** (H1, H5) | Simulado |
| A2 | «agrega otra Ranco pino oregón 85x200 para el baño» | `agregar` 1 | Descartada. | — | **Error** (H1) | Simulado |
| A3 | Control BUG-008: la IA reenvía la Ranco con su frase antigua | (error del modelo) | Descartada. | Error del modelo | Correcto | Simulado |
| A4 | Igual a A3, con tilde y medidas en cm | (error del modelo) | **Duplica en silencio**. | Error del modelo | **Error** (H3) | Simulado |
| 1 | «Agrega otra puerta igual a la primera» | (a) `agregar` copia | Descartada (E1a). | — | **Error** (H1, H6) | Simulado |
| 1 | Igual | (b) `cantidad: 2` en el ítem 0 | La cantidad queda pendiente (E1b). | — | **Error** (H6) | Simulado |
| 1 | Igual, con la original en 3 unidades | `agregar` 1 | Funciona (E1c). | — | OK | Simulado |
| 1 | «agrega 2 más iguales a la Pillán» (especial) | `agregar` con precio | Pendiente; el precio no se aplica (E1d). | — | **Error** (H6) | Simulado |
| 2 | «Quiero la puerta 4 igual a la puerta 2» | Editar el ítem 3 con los datos del 1 | Funciona: la puerta 4 queda como Molco (E2a). | — | OK | Simulado |
| 2b | «… la puerta 4 igual a la Molco» | Igual | «No entendí» (E2b). La corrección empuja al ítem equivocado (P2). | — | **Error** (H8) | Simulado, más `problemaSalida` real |
| 3 | «Duplica esta Ranco y haz que la copia sea vidriada» | `agregar` copia con `observaciones:'vidriada'` | Descartada (E3). | — | **Error** (H1, H2) | Simulado |
| 4 | «Necesito cotizar una puerta con otro espesor» | `responder` pidiendo los datos | Llega el texto (E4a). Con un espesor concreto, va como observación del ítem (E4b). No existe el campo «espesor» en el catálogo; un espesor distinto con otro precio requiere un especial. | Depende del modelo | OK (si el texto no lleva cifras: H4) | Simulado |
| 5 | «Agrega tres puertas iguales, pero separadas» | `agregar` con 3 copias | Las 3 descartadas (E5a); desde cero, quedan 1 de 3 (E5b). | — | **Error** (H1) | Simulado |
| 6 | «Cambia solamente la medida de la segunda puerta a 1,00 de ancho» | Editar `ancho` del ítem 1 | Funciona (E6a). Con dos Ranco iguales hechas a mano también (E6b). | Que «segunda puerta» sea el ítem 1 depende del modelo (hay marcos y otros ítems intercalados) | OK | Simulado |
| 6c | Igual, sin la medida nueva | `responder` «¿Qué medida…? (Molco 0,80 × 2,00)» | **El texto se reemplaza** por «Los montos se muestran…». | — | **Error** (H4) | Simulado |
| 7 | «Busca una puerta de pino oregón de un metro de ancho» | No hay herramienta de búsqueda; `responder` con modelos | **El texto se bloquea** (E7a). Con `agregar` y modelo null, pregunta «para Producto» y se pierde el ancho (E7b). | Sin herramienta | **Error** (H4, H9, H11) | Simulado |
| 8 | «Agrega un producto que no existe en el catálogo» | `responder` pidiendo nombre y precio | OK (E8a). Concreto y con precio: especial OK (E8b). Sin precio: pendiente con ayuda (E8c). Ítem libre: OK (E8d). | Depende del modelo | OK | Simulado |
| 9 | «Necesito crear una nueva familia de productos» | `responder` («no se puede») | OK (E9). Las familias son un enum fijo; ni la interfaz ni la IA pueden crear una. | Depende del modelo | OK | Simulado |
| 10 | «¿En qué familia debo poner esta puerta?» | `responder` | OK (E10), mientras no lleve cifras (H4). | Depende del modelo | OK o H4 | Simulado |
| D1 | «1 Molco lenga 80x200» con `flete:null` y `fabrica:null` | Llamada con campos de relleno | Agrega la Molco y muestra 2 avisos de ruido. | — | **Ruido** (H5) | Simulado |
| R1, R2 | «que la Coz Coz sean 3 y agrega 1 Molco…» con el índice errado | (error del modelo) | Pierde todo el turno; mensaje engañoso. | Error del modelo | **Error** (H7) | Simulado |
| R3 | «la segunda puerta, la que va al lado de la Coz Coz, que sean 3» | Editar el ítem 1 | «No entendí». | — | **Error** (H8) | Simulado |

## Manual vs IA

| Capacidad | Interfaz manual | IA (chat) |
|---|---|---|
| Agregar un producto del catálogo | Sí (búsqueda y `agregar_producto`, sin deduplicación) | Sí (`agregar`), pero **no una línea idéntica a otra** (H1) |
| Línea repetida o duplicar una línea | Indirecto (volver a agregarla; no hay botón para duplicar la línea) | **No** (H1, H6) |
| Copiar «igual a la N» con cambios | Agregar y luego editar | Parcial: falla si queda idéntica, si nombra otro modelo (H8) o si es un especial con precio (H6) |
| Editar modelo, madera, medidas o cantidad | Sí | Sí; las cifras deben estar escritas («otra» como +1 no sirve) |
| Precio especial | Sí (precio unitario y margen) | Solo si el precio está escrito; margen, no |
| Costo de fábrica de un especial | Sí | No |
| Especial con familia, fotos o referencias | Sí (`agregar_personalizado`: familia elegida, referencias) | Parcial: familia inferida, sin referencias y solo con precio escrito |
| Ítem libre (familia OTRO) | Sí | Sí |
| Observaciones o descripción del ítem | Sí | Sí, si el texto está literal en el mensaje |
| Descuento por ítem | Sí | Sí |
| Descuento general, automático o margen de la cotización | Sí | No |
| Flete | Sí | Sí (con su valor escrito) |
| Despacho o Starken | Sí | No |
| Observaciones de la cotización | Sí | No |
| Datos del cliente | Sí | Sí (anclados) |
| Quitar un ítem | Sí | Sí (`indiceCoherente`) |
| Reordenar | Sí | No |
| Asignar fábricas | Sí | Sí |
| Cambiar número | Sí | Sí (con confirmación) |
| Emitir o generar el PDF | Sí | No |
| Aprobar | Sí | Sí (con confirmación) |
| Corregir un pedido aprobado (`editar_pedido`) | Sí | No (`NO_EDITABLE_APROBADA`) |
| Buscar en el catálogo | Sí (pantalla y búsqueda) | **No hay herramienta**; solo `responder`, que se bloquea si lleva cifras (H4) |
| Explicar el catálogo o las familias | Pantalla Catálogo | `responder`, sin cifras |
| Proponer un producto nuevo al catálogo | Sí (alta, con su propio asistente `proponer_producto`) | No desde el chat |
| Crear una familia | No (enum fijo) | No |
| Duplicar la cotización | Sí | No |

Conclusión: la IA es **menos capaz** que la interfaz. Lo crítico no es todo lo que falta, sino tres puntos:
- no puede repetir ni copiar líneas (lo más común en obra);
- no puede responder con cifras;
- cuando no puede hacer algo, no deriva a la acción de la interfaz.

## Clasificación de avisos

**Clasificación:**
- **Útil:** la persona tiene que actuar o le conviene saberlo.
- **Ruido interno:** una corrección de la IA sin acción para la persona.
- **Técnico:** jerga o identificadores internos.

| Origen | Texto (abreviado) | Clase | Recomendación |
|---|---|---|---|
| `chat.ts:243` | «No quité la fábrica de X: el mensaje no lo pide.» | **Ruido interno** | No-op silencioso; solo diagnóstico (H5) |
| `chat.ts:249` | «No asigné fábrica a X: el mensaje no dice a cuál va.» | Ruido interno (la IA la dedujo) | Silencio y diagnóstico; avisar solo si el mensaje menciona «fábrica» o una forma no reconocida |
| `flete.ts:28` | «No quité el flete: tu mensaje no habla de él.» | **Ruido interno** | Ídem; con más razón si no hay flete |
| `chat.ts:968` | «No dupliqué …: ya estaba en la cotización con la misma cantidad.» | Hoy **dañino** (H1); falso en el mismo turno | Reenvío: silencio. Pedido de la persona: agregar con aviso y deshacer |
| `chat.ts:1226` | «No registré «X» como producto: tu mensaje no lo pide…» | Útil | Mantener |
| `chat.ts:1238` | «No registré la fábrica de X que indicaste: revisa a qué ítems va.» | Útil | Mantener |
| `chat.ts:1366` | «No registré: «…». Revisa si falta…» | Útil | Mantener |
| `chat.ts:138` (`PEDIDO_SIN_REGISTRAR`) | «No agregué productos y tu mensaje parece un pedido…» | Útil | Mantener |
| `chat.ts:134` (`NO_ENTENDI`) en un rechazo de `aplicarModificacion` | «No entendí, ¿puedes reformularlo?» | Útil pero **opaco** | Explicar el motivo concreto (H7) |
| `chat.ts:1245` | Avisos de fábrica más `PREGUNTA_FABRICA` en un rechazo | **Engañoso** | Solo si la causa fue la fábrica (H7) |
| `chat.ts:817` | «No guardé la descripción/observación que el asistente agregó al ítem N…» | Ruido interno (salvo que la persona sí la escribiera con otras palabras) | Diagnóstico; mostrar solo si el texto se parece a algo del mensaje |
| `chat.ts:840` | «No guardé el dato del cliente que el asistente agregó (telefono)…» | **Técnico** (nombre de campo sin tilde) | Etiquetas en español («teléfono») o solo diagnóstico |
| `anclaje.ts:181`, `:800`, `:836`, `:864` | «El asistente propuso la cantidad o medida X … no aparece en tu mensaje: quedó pendiente…» | Útil (hay un pendiente), pero expone el mecanismo | Reescribir en función del dato: «Falta la cantidad de la Ranco: ¿cuántas?» (la pregunta pendiente ya lo hace, así que se duplica) |
| `anclaje.ts:360`, `:655`, `:692`, `:702` | «El asistente interpretó el modelo o la madera como «X», pero…» | Útil; mismo comentario | Ídem |
| `anclaje.ts:622` | «No pude verificar el ítem N contra tu mensaje; revísalo.» | **Ruido o técnico** (vago) | Diagnóstico; mostrar solo con una diferencia concreta |
| `anclaje.ts:630`, `:978` | «Revisa el ítem N: anoté X, pero tu mensaje parece decir Y» | Útil | Mantener |
| `anclaje.ts:678` y `avisosDePalabras` | «No reconocí «encha» en el ítem…» | Útil | Mantener |
| `anclaje.ts:735`, `:859`, `:888` | «El asistente propuso la sección…» o «usó la escuadría o la cantidad también como largo…» | Útil (pendiente); jerga moderada | Ídem a `:181` |
| `chat.ts:393` | «La cantidad 2,5 de X no es válida…» | Útil | Mantener |
| `chat.ts:526`, `:595` | «Agregué «X» como ítem libre…» | Útil | Mantener |
| `chat.ts:529`, `:563` | «Escribiste un precio total…; indica el valor por unidad» | Útil | Mantener |
| `chat.ts:547-583` | «No apliqué el precio del ítem N: …» | Útil | Mantener |
| `chat.ts:575`, `:578`, `:587` | «Escribiste «+ IVA»…» o «Tomé $X como precio sin IVA…» | Útil (el de `:587` se repite en cada precio) | Mantener; agrupar si hay varios |
| `chat.ts:592` | «…revisa si le faltan ceros» | Útil | Mantener |
| `chat.ts:617` | «Usé el precio que indicaste…; el de catálogo es $Y» | Útil | Mantener |
| `chat.ts:640` | ««X» no está en el catálogo: lo cotizo como pedido especial…» | Útil | Mantener |
| `chat.ts:682-738` | Avisos de descuento | Útil | Mantener |
| `chat.ts:757-763` | Confirmaciones de descuento | Útil | Mantener |
| `chat.ts:1386` | «Tomé la comuna del cliente del despacho: X.» | Útil | Mantener |
| `flete.ts:44-83` | Valor o IVA del flete, ceros, cantidad no escrita, falta el valor | Útil | Mantener |
| `chat.ts:1263` (`responder` filtrado) | «Puedo ayudarte con modelos… Los montos se muestran en la cotización.» | Hoy **reemplaza respuestas útiles** (H4) | Corregir el detector |
| `chat.ts:1449-1450` | «Cotización actualizada…» sin cambios | **Engañoso** (H10) | «No cambié nada: …» |

Ya existe la infraestructura para separar estos tipos de avisos: `marcar(categoria, …)` y `DiagnosticoTurno` (`chat.ts:1078-1083`, `:1509-1514`). Se propone una categoría `interno` que se registre y no se muestre.

## Prioridades sugeridas

1. **P1:**
   - H4: el detector de dinero (bajo, y desbloquea las preguntas de desambiguación).
   - H5: los no-op silenciosos y la categoría `interno`.
   - H1, H2 y H6: el criterio de origen y la operación `duplicar`.
2. **P2:**
   - H3: la clave normalizada y la `fuente` antigua.
   - H7: el rechazo parcial con su motivo.
   - H8: separar el objetivo de la referencia.
   - H9: buscar en el catálogo y derivar a la interfaz.
   - H12: pruebas y evaluaciones.
3. **P3:** H10 y H11.

Las evaluaciones con el modelo real de los casos nuevos (`evaluar:ia` o `evaluar:regresion`) **no se corrieron**: requieren que la usuaria apruebe el costo.
