# 01 · Auditoría completa del Cotizador Neltume

**Fecha:** 9–10 de noviembre de 2026 · **Rama:** `main` en `a641645`, con el árbol limpio · **Tipo:** auditoría y pruebas no destructivas. No se corrigió nada, no hubo commits ni deploy y no se tocaron `data/cotizador.sqlite` ni `datos-privados/`.

**Documentos de esta carpeta**

| Documento | Contenido |
|---|---|
| `01_AUDITORIA_COMPLETA.md` | Este informe: resumen, arquitectura, cobertura, inventario, hallazgos consolidados, causas raíz y riesgos |
| `02_PLAN_DE_MEJORAS.md` | Hoja de ruta P0–P3 con criterios de aceptación |
| `03_MATRIZ_QA.md` | Escenarios, pruebas existentes y faltantes, resultados reales |
| `04_PROPUESTA_UX.md` | Recorridos, fricciones, flujos propuestos, mejoras para la IA e indicadores |
| `05_REDISENO_FAMILIAS_CATALOGO.md` | Rediseño del catálogo y las familias |
| `anexos/A-*.md` | Los seis informes especializados completos, con todos los campos de cada hallazgo |

Los anexos se copiaron tal como los entregó cada especialista. Donde este informe consolidado los corrige (§5.2), **manda este informe**.

---

## 1. Resumen ejecutivo

El cotizador está bien construido en lo que se ve menos:

- los cálculos son exactos y la pantalla, la base y el PDF coinciden;
- los conflictos entre pestañas, el doble clic y la red cortada están bien resueltos;
- no hay rutas API sin autenticación ni inyecciones;
- pasan 1.567 pruebas unitarias y 103 de las 104 E2E que se pudieron correr (la que falló no se reprodujo al repetirla sola).

Los problemas que reporta la clienta son reales y casi ninguno es de cálculo. Vienen de tres causas de fondo:

1. **El catálogo expone su estructura interna.** No existe una «puerta» ni un «modelo» como ficha: cada combinación de modelo, madera, tramo de ancho y alto es una fila suelta con su precio. Ranco son 252 filas y el catálogo tiene 8.866 en total. La «familia» es un valor fijo entre cuatro (Puerta, Marco, Piezas T, Moldura) que se deduce del nombre del modelo al importar, y la categoría de ganancia se deduce de palabras escritas a mano. Crear, duplicar, renombrar o pausar una puerta no tiene una acción propia. Por eso la clienta no entiende el catálogo: no hay nada que entender a su nivel, solo filas.
2. **Guardas pensadas contra errores de la IA que bloquean a la persona.** El chat descarta toda línea idéntica a otra (Problema A), reemplaza cualquier respuesta que contenga un número y muestra a la usuaria sus correcciones internas (Problema D). Cada guarda nació de un hallazgo real de la auditoría anterior (BUG-008, BUG-026, BUG-030), pero no distingue entre lo que repitió la IA y lo que pidió la persona.
3. **Faltan operaciones de edición básicas.** No hay «duplicar línea» (Problema B), una línea con precio no se puede pasar a especial conservando ese precio, Deshacer solo cubre los productos, y hay cinco caminos distintos para cotizar algo que no está en el catálogo (Problema C).

Además se encontraron **dos defectos P0**:

- **«Corregir pedido» en una cotización aprobada vuelve a cotizar todo el pedido con el catálogo vigente**, sin aviso, y regenera el PDF con el mismo número (N-01).
- **El alta de productos promete un precio de venta que la cotización no cobra.** Usa el ajuste general en vez del margen de la categoría, y probablemente originó el precio mal cargado del incidente de Los Ríos (N-02).

### Respuesta directa a los problemas reportados

| Problema | Causa confirmada | Dónde |
|---|---|---|
| **A · Productos repetidos** | **Solo el chat** descarta las líneas iguales a otra. La clave compara modelo, madera, ancho, alto, medida, cantidad y tipo de medida, tanto entre turnos como dentro del mismo turno. A mano, por Zod o en la base no hay ningún bloqueo. Con «4 Ranco… 0,85; 1,00; 0,85; 1,00» quedan 2 líneas. | `src/servidor/chat.ts:944-970` (guarda de BUG-008). Ejecutado con respuestas simuladas (anexo IA, H1) y con Playwright a mano (anexo QA, escenario a) |
| **B · Duplicar para modificar** | **No existe «duplicar línea»** ni en la pantalla ni en el chat: «Duplicar» copia la cotización entera. Al renombrar la copia a «Ranco vidriada», se descarta el precio y la línea queda pendiente. En el chat, la copia idéntica se descarta por la guarda de A. | `cotizacion-panel.tsx:1050-1085`, `:1741-1749`; anexo Cotizaciones H-04 y H-05; anexo IA H2 y H6 |
| **C · Fuera de catálogo** | **Ya se puede sin tocar el catálogo** (ítem libre o personalizado), pero hay cinco caminos con nombres parecidos. Uno de ellos («Agregar al catálogo» o «Es un modelo nuevo», desde un pendiente) crea filas permanentes para todo el equipo. No existe un campo para el espesor. | anexo Catálogo §3.8 y H17; anexo QA escenario c |
| **D · Respuestas confusas** | El modelo manda `fabrica: null` o `flete: null` como relleno, y el servidor lo informa como si la persona hubiera pedido algo: «No quité la fábrica de RANCO: el mensaje no lo pide». El aviso se repite una vez por ítem. Además, toda respuesta con una cifra se reemplaza por «Los montos se muestran en la cotización». | `chat.ts:229-260`, `flete.ts:28`, `chat.ts:143-146` y `:1261`; anexo IA H4 y H5 y su clasificación de unos 30 avisos |
| **E · Familias y catálogo** | Ver §1 y el documento 05. | anexo Catálogo |

---

## 2. Arquitectura

**Stack:** Next.js 16.4 (App Router), React 19.2, TypeScript, better-sqlite3 (esquema v29, WAL), better-auth 1.7, Zod 4, PDF con Chromium a través de Playwright y la IA a través de CommandCode con herramientas. Corre en un solo proceso `next start` detrás de Cloudflare Tunnel. Se integra con la app de la fábrica (otro repositorio, no disponible para esta auditoría) mediante mensajes firmados con HMAC, y con Starken.

| Capa | Ruta | Responsabilidad |
|---|---|---|
| UI | `src/app/**` (96 archivos, ~20.200 líneas) | Pantallas; todo el HTTP pasa por `src/app/solicitud.ts` |
| API | `src/app/api/**/route.ts` (25 rutas) | Sesión (`exigirSesion`), validación con Zod y respuesta |
| Servicios y persistencia | `src/servidor/**` (53 archivos, ~16.900 líneas) | `Servicio` (casos de uso), `chat.ts` (orquesta la IA), `Almacen` (unidad de trabajo con bloqueo de archivo y transacción), `base-datos.ts` (migraciones), PDF, integración con la fábrica y Starken |
| Reglas puras | `src/negocio/**` | Precios, IVA, descuentos, estados y límites. No importa nada de `servidor` ni de `app` |
| Catálogo | `src/catalogo/**` | Importación de XLSX, resolución de modelo, madera y medida, y tipos |
| Asistente | `src/asistente/**` | Cliente del modelo, esquemas de herramientas, anclaje (verificar que cada dato esté en el mensaje) y evaluación |

**Flujo de una acción:**

1. La UI llama a `pedirJSON('/api/accion', {tipo, id, actualizada…})`.
2. La ruta `route.ts:546` hace, en orden:
   - verifica el Host, el Origin y la sesión;
   - lee el cuerpo, con un tope de 64 KiB;
   - valida contra una unión de 27 acciones.
3. `Servicio.ejecutar` aplica la acción dentro de `Almacen.transaccion`, que:
   - toma un bloqueo de archivo;
   - compara las versiones en `BEGIN IMMEDIATE` y responde 409 si cambiaron.
4. La IA y Chromium corren **fuera** del bloqueo.
5. La emisión de documentos sigue tres pasos:
   - se reserva el número;
   - se genera el PDF;
   - se confirma, o se borra el PDF si algo falla.

**Cómo se guarda una cotización:** en tablas (`cotizaciones`, `cotizacion_lineas`, `nota_lineas`, …). Cada línea emitida guarda una copia del producto (código, costo, margen, precio y descripción). La solicitud editable guarda **modelo, madera y medidas, sin el código**, y se vuelve a cotizar contra el catálogo vigente cada vez que se edita (`servicio.ts:326-334`, `:896-904`).

El diagrama completo, el inventario de pantallas y la tabla de las 25 rutas con su autorización están en `anexos/A-arquitectura.md` §1.

---

## 3. Cobertura de la auditoría

| Área | Qué se hizo | Evidencia |
|---|---|---|
| Catálogo y familias | Reconstrucción del modelo desde el código y desde conteos de solo lectura en una copia de la base. Tres scripts con las funciones reales (búsqueda, resolución, márgenes e importación). | `anexos/A-catalogo.md`; scripts en el scratchpad de la sesión |
| Cotizaciones y PDF | Funciones reales (`Servicio`, `Almacen`, `cotizar`, plantilla del PDF y Chrome) sobre bases nuevas con el catálogo de `COTIZADOR_2026.xlsx`. 44 escenarios. | `anexos/A-cotizaciones.md` |
| Asistente de IA | 36 escenarios con **respuestas de modelo simuladas** pasadas por el `Servicio` y `procesarChat` reales con el catálogo real. **La interpretación del modelo real no se probó** (tiene costo y requiere la aprobación de la usuaria). | `anexos/A-ia.md` |
| Arquitectura y seguridad | Lectura de las 25 rutas, `tsc`, `eslint` y `npm audit --omit=dev`. | `anexos/A-arquitectura.md` |
| QA | Vitest completo, E2E en serie, aceptación y WebKit; 8 recorridos nuevos con Playwright sobre una base aislada (puerto 3123, IA en modo `fijo`); 70 capturas a 1440, 768 y 390 px; axe. | `anexos/A-qa.md` |
| UX y UI | Heurísticas de Nielsen y WCAG 2.2 AA sobre el código y las capturas; contraste calculado desde los tokens. | `anexos/A-ux.md` |

**No se pudo inspeccionar:**

- el repositorio de la app de la fábrica;
- el servidor de producción (`.env`, Cloudflare, cron de respaldos);
- el comportamiento del modelo real;
- la subida real de fotos;
- la reacción de la pantalla a un 409 real;
- Firefox, roto en macOS 27;
- la E2E paralela: los puertos 3201–3203 los ocupaba la E2E de la app de la fábrica (N-31).

---

## 4. Inventario funcional

| Módulo | Pantalla o entrada | Capacidades principales |
|---|---|---|
| Cotizar | `/` (`cotizador.tsx`, `cotizacion-panel.tsx`) | Chat, agregar producto, personalizado o ítem libre, editar detalle, descuentos, ganancia, flete o Starken, pendientes (hoja o vano, medida), emitir PDF, modificar emitida, aprobar, notas de pedido por fábrica, pagos, producción y despacho, Deshacer |
| Historial y clientes | `/historial`, `/clientes` | Filtros, papelera, duplicar cotización, exportar |
| Catálogo | `/catalogo` | Consultar, Agregar producto (formulario o asistente), Gestionar (solo los productos manuales), Importar planilla, Nombres y alias, Familia de cada modelo |
| Ajustes | `/ajustes`, `/configuracion` | Negocio (márgenes por categoría, IVA, tramos), IA, usuarios, Starken, integración con la fábrica |
| Ayuda | `/ayuda` | Guía de uso |
| Integraciones | `api/integracion/*`, `instrumentation.ts` | Envío firmado de pedidos a la fábrica con reintentos, prueba de conexión, Starken |

---

## 5. Hallazgos consolidados

### 5.1 Convenciones

- **Prioridad:** P0 = corrupción de datos o error crítico de cálculo · P1 = bloquea una operación habitual o la UX es muy confusa · P2 = productividad, consistencia o accesibilidad · P3 = refinamiento.
- **Confianza:** *confirmado* = ejecutado o leído literalmente · *probable* · *hipótesis*.
- **Id:** `N-xx` es el id consolidado. Entre paréntesis va el id del anexo donde está la evidencia completa (Cat = catálogo, Cot = cotizaciones, IA, Arq = arquitectura, QA, UX).

### 5.2 Contradicciones resueltas entre informes

| Tema | Lo que decían | Resolución, con evidencia |
|---|---|---|
| **Permisos de la vendedora** | UX-01 y Cat H7 (P0): «la vendedora crea productos pero no puede corregirlos». Arq S-02: «toda cuenta es administradora». | **Arq tiene razón para producción.** `migrarEsquemaAutenticacion` ejecuta `UPDATE "user" SET role='admin'` en cada arranque (`autenticacion-config.ts:276`), el plugin usa `defaultRole: 'admin'` (`:231`) y la base local solo tiene 2 cuentas, ambas `admin` (consulta de solo lectura). La E2E sí siembra una cuenta `user`, así que prueba una configuración que producción nunca tiene. **Hoy la vendedora sí puede corregir y borrar.** El problema real es el inverso, y queda como N-17 (sin separación de roles) y N-08 (alta global sin revisión). UX-01 y Cat H7 bajan de P0 a P1 y se reformulan. |
| **«+50 %» o «+25 %» en el alta** | Cat H2: +50 %. QA H-01: +25 %. | Es el mismo defecto con dos configuraciones: la base local tiene `ajuste = 0,5` y la base de la E2E, 0,25. La pantalla muestra `REGLAS.ajuste` y la cotización usa el margen de la categoría (N-02). |
| **Severidad del alta** | Cat: P0. QA: P1. | **P0.** El número que ve quien carga el producto es falso en casi todas las categorías (de −17 % a +60 %). Lo más probable es que originara un precio mal cargado en producción (124.080 = 51.700 × 2,4; incidente de Los Ríos). Se corrige en ½ día. |
| **«Duplicar línea»** | Cot H-04: P1. QA H-04: P2. UX-04: P1. | **P1.** Es el Problema B que reportó la clienta y una operación diaria en pedidos de obra. |
| **«Otra igual» por chat** | UX §3.2: «el chat sí repite valores de otra línea». IA H1 y H6: «se descarta». | **IA tiene razón.** El anclaje (`anclaje.ts:134`) entiende «igual», pero la guarda de `chat.ts:944-970` descarta la línea después. Comprobado con respuestas simuladas. |

### 5.3 Registro de hallazgos

#### P0 · Críticos

##### N-01 · «Corregir pedido» en una cotización aprobada recalcula todo el pedido con el catálogo vigente (Cot H-01)

- **Severidad:** Crítica · **Prioridad:** P0 · **Categoría:** Integridad de datos / cálculo · **Confianza:** confirmado (ejecutado)
- **Archivo/líneas:** `src/servidor/servicio.ts:2217-2245` (`editarPedido` → `this.recalcular(copia)` en `:2238`)
- **Evidencia:** se bajó el catálogo un 10 % y luego se cambió **solo una observación** en una aprobada:
  - el total pasó de $2.800.288 a $2.593.493;
  - la nota de Panguipulli pasó de $467.105 a $424.641;
  - no hubo aviso y el PDF se regeneró con el mismo número;
  - la nota de Santiago, que no se tocó, quedó descuadrada respecto de la cotización.

  Contradice `tests/pedido-corregido.e2e.ts:24` («el precio sigue siendo el aprobado»).
- **Por qué importa:** cambia el monto que el cliente aceptó y que la fábrica ya recibió, sin que nadie lo note, y deja documentos con el mismo número y montos distintos.
- **Observado / esperado:** el total cambia / los precios aprobados se mantienen; solo cambia lo que se edita, y un cambio de medida se valoriza explícitamente.
- **Causa raíz:** `recalcular` resuelve de nuevo contra el catálogo todas las líneas sin precio fijado, y la aprobada no fija el precio en su solicitud.
- **Arreglo:**
  - al corregir un pedido, fijar el `precioUnitario` y el `costoFabrica` de cada línea no editada a partir de su copia en `cotizacion_lineas`;
  - recalcular solo las líneas cuya medida o modelo cambió;
  - mostrar la diferencia y pedir confirmación si cambia el total.
- **Archivos:** `servicio.ts`, `almacen.ts` (lectura de la copia).
- **Pruebas:** unitaria (catálogo −10 % y cambio de observación → total idéntico); E2E `pedido-corregido` con un cambio de catálogo de por medio.
- **Esfuerzo:** S–M.

##### N-02 · El alta de productos muestra un precio de venta que la cotización no cobra (Cat H2, QA H-01)

- **Severidad:** Crítica · **Prioridad:** P0 · **Categoría:** Precio / UX · **Confianza:** confirmado (ejecutado con un script y de punta a punta con Playwright); la relación con el incidente es probable
- **Archivo/líneas:** `src/app/alta-producto.tsx:90,127-128,142-147,274-281,378-379,520-522` (usa `reglas.ajuste`), frente a `src/negocio/precios.ts:233,243,312-352` (margen de la categoría)
- **Evidencia:**
  - Con costo $100.000: el alta anuncia $150.000; la cotización cobra $185.000 en pino oregón, $240.000 en prepintada y $125.000 en cedro.
  - En la E2E: se prometieron $237.488 y se cobraron $351.482 (`qa/capturas/d-13-precio-real.png`).
  - El texto «las cotizaciones le suman 50 % automáticamente, igual que a los productos de la planilla» es falso.
- **Por qué importa:** quien carga la puerta decide el costo mirando un precio de venta falso. Si «corrige» el costo para llegar al precio que cree, el cliente recibe otro precio.
- **Causa raíz:** la pantalla quedó de cuando había un ajuste único, antes de los márgenes por categoría.
- **Arreglo:** calcular la vista previa en el servidor con `margenProducto` (la misma función de la cotización) y mostrar «Categoría: Puertas sólidas oregón · ganancia 85 % → $185.000».
- **Pruebas:** unitaria que compare la vista previa con `cotizar()` para cada una de las 11 categorías; E2E que dé de alta, cotice y compare.
- **Esfuerzo:** S.

#### P1 · Alta prioridad

En esta tabla, **Sev.** es la severidad: A = Alta, M = Media, B = Baja. La evidencia completa de cada hallazgo está en el anexo indicado.

| Id | Sev. | Título | Archivo/líneas | Anexo | Confianza |
|---|---|---|---|---|---|
| **N-03** | A | **El chat descarta líneas repetidas legítimas (Problema A).** «4 Ranco 0,85/1,00/0,85/1,00» deja 2; también se descartan «otra igual a la primera» y «tres iguales separadas». | `src/servidor/chat.ts:944-970` | IA H1 | confirmado (simulado) |
| **N-04** | A | **El chat no puede responder nada con una cifra.** `textoMonetario` usa `montosDelTexto`, que trata cualquier número como monto, así que «¿la de 0,80 × 2,00?» o «Tienes 2 Molco» se reemplazan por «Los montos se muestran en la cotización». Bloquea justo las preguntas de desambiguación que exige el prompt (regresión del arreglo de BUG-030). | `chat.ts:143-146`, `:1259-1264`; `asistente/montos.ts:125` | IA H4 | confirmado (simulado y leído) |
| **N-05** | A | **No existe «duplicar línea», ni a mano ni por chat (Problema B).** La copia hecha a mano pierde el precio especial, el descuento, la observación y las fotos. | `cotizacion-panel.tsx:1050-1085`, `:1741-1749` | Cot H-04, QA H-04, UX-04, IA H6 | confirmado (Playwright) |
| **N-06** | A | **El catálogo no tiene ficha de modelo.** Una puerta nueva son hasta 252 formularios, sin plantilla ni duplicar, y el formulario se vacía después de cada alta. Una trabajadora nueva no puede crear una puerta sin ayuda. | `catalogo/tipos.ts:12-28`; `repositorio-catalogo.ts:437-452`; `alta-producto.tsx:317` | Cat H1, QA H-07 | confirmado |
| **N-07** | A | **Hay dos buscadores incoherentes.** Consultar y Agregar devuelven 0 para «ranko», «willow», «coscos», «pangipulli», «prepintado», «puertas», «moldura», «marco 4x2», «ranco 0,82», «ranco 85x210», «1 metro» y «puerta de 100», que el chat sí entiende. «ranco 1,00 2,20» muestra primero una puerta de 0,60 m (el «1» coincide con el código). El diálogo muestra solo 24 resultados. | `servidor/busqueda.ts:17-50`; `api/catalogo/route.ts:118-126`; `agregar-producto.tsx:124-133` | Cat H4, QA H-02 | confirmado (ejecutado) |
| **N-08** | A | **Hay cinco caminos para «no está en el catálogo»**, y uno de ellos («Agregar al catálogo» o «Es un modelo nuevo», desde un pendiente) crea con un clic filas globales sin revisión. Se ofrece incluso ante un error de tipeo como «ranko». | `preguntas-pendientes.tsx:78-81,115-130`; `negocio/pendientes.ts:260-283`; `agregar-producto.tsx:152-160` | Cat H7, H17; UX-01, UX-15 (reformulados, §5.2) | confirmado |
| **N-09** | A | **La categoría de ganancia depende de palabras escritas a mano.** «PUERTA PREPINTADA» en el tipo pasa una puerta de oregón del 85 % al 140 %, y una madera nueva cae en «otros» (25 %). | `negocio/precios.ts:312-338` | Cat H3 | confirmado (script) |
| **N-10** | M | **Las correcciones internas se muestran como mensajes (Problema D).** «No quité la fábrica…» y «No quité el flete…» aparecen aunque no haya nada que quitar, una vez por ítem, y vuelven al historial que lee el modelo. | `chat.ts:229-260`; `asistente/flete.ts:28` | IA H5 | confirmado (simulado) |
| **N-11** | A | **La terminología choca.** «Familia», «Tipo de producto» y «Tipo» nombran cosas distintas en pantallas vecinas; «especial» tiene cuatro sentidos (y «puerta especial» = ancho de 1,10 m o más); «Precio base sin IVA» es costo y «Precio unitario sin IVA» es venta; no hay glosario. | `alta-producto.tsx:439,478`; `agregar-producto.tsx:444,475`; `gestion-manuales.tsx:491` | Cat H11, UX-09 | confirmado |
| **N-12** | M | **La recotización silenciosa sigue en quitar, agregar, reordenar y deshacer.** BUG-012 solo se corrigió en `editar`: un borrador toma los precios del catálogo nuevo sin aviso. | `servicio.ts:749,971,1003,1025` | Cot H-02 | confirmado |
| **N-13** | M | **En el PDF al cliente, los especiales y las líneas con descripción propia salen sin medida.** Dos «Ranco vidriada» de 0,85 y 1,00 se imprimen idénticas. | `negocio/personalizados.ts:134`; `precios.ts:151`; `servidor/pdf.ts:273-290` (hoy fijado por `tests/pdf.test.ts:317-335`) | Cot H-03 | confirmado (Chrome) |
| **N-14** | M | **Mientras responde el asistente se bloquean el editor y la navegación**, hasta 60 s por intento más 30 s. | `cotizador.tsx:253`; `encabezado.tsx:26`; `asistente/configuracion.ts:4-12` | UX-06 | confirmado en código; la duración en producción es una hipótesis |
| **N-15** | M | **El costo de fábrica y la ganancia se ven en la misma pantalla con la que se atiende al cliente.** | `cotizacion-panel.tsx:1156-1157`; `margenes.tsx` | UX-07 | confirmado en código; que la pantalla quede de cara al cliente es una hipótesis |
| **N-16** | M | **Deshacer solo cubre los productos.** No deshace el cliente, el descuento, el flete, la ganancia ni las observaciones, y se pierde al cambiar de cotización. | `cotizador.tsx:163-175` | Cot H-09, UX-08 | confirmado |
| **N-18** | M | **El diálogo «Agregar producto» se cierra después de cada producto:** cuatro productos son unas 24 acciones. | `cotizador.tsx:1156` | UX-03 | confirmado |
| **N-19** | M | **Una línea con precio no se puede pasar a especial conservando su precio**, y el campo del especial no propone el precio de partida (ruta Ranco → Ranco vidriada). | `cotizacion-panel.tsx:837-876` | Cot H-05 | confirmado |
| **N-20** | M | **«Familia de cada modelo» (Nombres y alias) no tiene efecto hasta la próxima importación**, y sus filas base no se pueden quitar. | `configuracion-catalogo.tsx:602-635`; `catalogo/importar.ts:85-90,110` | Cat H5 | confirmado |
| **N-21** | M | **Cambiar el «Código» de una madera re-codifica unos 2.200 productos** en la siguiente importación. Son los códigos que reconoce la fábrica. | `configuracion-catalogo.tsx:509-521`; `importar.ts:91-98` | Cat H6 | confirmado (script) |
| **N-22** | M | **Un rechazo parcial pierde el turno entero.** Si una parte del cambio no pasa, se descarta todo, y el mensaje puede culpar a la fábrica cuando el problema fue el índice. | `chat.ts` (`return null` en `aplicarModificacion`; `:1245`) | IA H7 | confirmado (simulado) |

#### P2 · Media prioridad

| Id | Título | Archivo/líneas | Anexo |
|---|---|---|---|
| N-17 | Hay un solo rol en la práctica: toda vendedora puede cambiar la clave de IA, el catálogo, la numeración y las contraseñas de otras. Los controles `admin` no separan nada y el rol vacío se interpreta distinto según el archivo. **Es una decisión de negocio** (ver §7). | `autenticacion-config.ts:231,276`; `catalogo/page.tsx:21` | Arq S-02 |
| N-23 | La guarda de duplicados no detecta un reenvío real de la IA si cambia la forma (tilde, medidas en cm): el pedido se duplica en silencio, que es el BUG-008 original. | `chat.ts:946-950` | IA H3 |
| N-24 | `indiceCoherente` y `problemaSalida` rechazan referencias válidas («la puerta 4 igual a la Molco»), y la corrección enviada al modelo lo empuja al ítem equivocado. | `chat.ts` (`indiceCoherente`) | IA H8 |
| N-25 | La IA tiene mucho menos alcance que la interfaz: no puede buscar en el catálogo, duplicar, reordenar, fijar la ganancia o el descuento general, ni editar una aprobada. Tampoco deriva a la acción manual cuando no puede. | `asistente/esquemas.ts`; `llm.ts` | IA H9, UX-05, UX-17 |
| N-26 | El PDF dice «No incluye: instalación… vidrios» aunque se cobre instalación o se vendan puertas vidriadas, y «puestos en fábrica» aunque incluya flete. | `servidor/pdf.ts:359,375-378` | Cot H-06 |
| N-27 | Dos envíos del primer producto crean dos borradores: `agregar_producto` y `agregar_personalizado` no aceptan `nuevoId` (variante de BUG-047). | `api/accion/route.ts`; `servicio.ts` | Cot H-07 |
| N-28 | Una revisión de una emitida recotiza todas las líneas al catálogo vigente (decisión M3); no se pueden mantener los precios acordados. | `servicio.ts` | Cot H-08 |
| N-29 | El aviso «Producto agregado» mide 440 × 676 px y tapa las cantidades, los precios y los botones (conflicto de especificidad CSS). | `cotizador-pantalla.css:491-499` | QA H-03 |
| N-30 | El foco del teclado se pierde al elegir hoja o vano. | `cotizacion-panel.tsx:~907` | QA H-05 |
| N-31 | `test:e2e:paralelo` usa puertos fijos (3201 en adelante) que chocan con la E2E de la fábrica, y el deploy usa la suite como compuerta. | `scripts/e2e-paralelo.mjs:47` | QA H-11 |
| N-32 | Editar una fila puede dejar un modelo con dos familias, y la descripción y la medida en texto se desincronizan de los anchos. | `repositorio-catalogo.ts:742-900,809` | Cat H8, H9 |
| N-33 | No se puede renombrar, pausar ni dar de baja un modelo; un renombre deja borradores con «modelo desconocido». | `servicio.ts:896-904`; `repositorio-catalogo.ts:729-740,1067` | Cat H10, H14 |
| N-34 | El alta no admite rango de alto ni espesor, y el espesor termina escrito en el nombre del modelo. | `servidor/alta-catalogo.ts:20-35` | Cat H12, Cot H-11 |
| N-35 | Un modelo nuevo en la planilla se importa como PUERTA si nadie lo registró antes. | `catalogo/importar.ts:110-116` | Cat H13 |
| N-36 | Dependencias con avisos publicados: `better-auth` 1.7.6 (uno crítico y uno alto) y `zod` 4.6.5 (uno alto). Hoy no son explotables (sin OAuth ni magic link, cuerpos ≤ 64 KiB). | `package.json` | Arq S-01 |
| N-37 | Archivos gigantes: `procesarChat` tiene unas 527 líneas en una sola función; `Cotizador` tiene unas 1.750 líneas con 23 `useState`; la secuencia de emisión de documentos está copiada 4 veces. | `chat.ts:974-1500`; `cotizador.tsx`; `servicio.ts` | Arq M-01, M-02 |
| N-38 | Dos reglas de guardado en la misma pantalla (algunos campos guardan al salir y otros piden «Guardar»). | `campo-editable.tsx:207-220` | UX-10 |
| N-39 | Las medidas están escondidas en «Editar detalles» y no se ofrecen las medidas válidas. | `cotizacion-panel.tsx` | UX-11 |
| N-40 | «Resolver medida» (hoja o vano) bloquea la emisión una vez por cada puerta (sigue vigente de la auditoría anterior). | `cotizacion-panel.tsx:1698-1702` | UX-12 |
| N-41 | Modificar una emitida tiene reglas distintas por chat y a mano, y modificar una aprobada con anticipo no tiene un camino explicado. | `seguimiento-operacion.tsx:456-458` | UX-13, UX-21 |
| N-42 | Catálogo → Consultar es un callejón sin salida: no tiene «Cotizar este». | `catalogo-consulta.tsx` | UX-16 |
| N-43 | 25 mensajes mandan a «quien administra» sin ofrecer antes una salida propia. | varios | UX-18 |
| N-44 | Los bordes de los campos tienen un contraste de 1,5:1, por debajo del 3:1 que exige WCAG 1.4.11. | `globals.css:9-40` | UX-19 |
| N-45 | La pantalla promete «por chat puedes cambiar su número» y el servidor solo lo permite a admin. Hoy todas las cuentas son admin, así que solo sería falso con roles reales. | `servicio.ts:2037-2038` | UX-20 |
| N-46 | No se puede enseñar al asistente un nombre que no entiende desde el mismo pendiente. | `catalogo/page.tsx:22-26` | UX-02 |
| N-47 | Tres sistemas de estado paralelos en el seguimiento. | `seguimiento-operacion.tsx` | UX-14 |
| N-48 | Seguridad de bajo impacto: `get-session` devuelve el token de sesión (deducido, no ejecutado); `.gitignore` no cubre `data/referencias/` (fotos de clientes); `.env.local` tiene permisos 644; no hay límite por usuario en el chat, Starken ni las subidas; la CSP es mínima; los PDF se abren en el mismo origen. | varios | Arq S-03 a S-10 |

#### P3 · Refinamientos

Se resumen aquí; el detalle está en los anexos.

| Tema | Anexo |
|---|---|
| Escape en el buscador | QA H-06 |
| Doble clic en «Emitir» abre y cierra el diálogo | QA H-09 |
| Aviso de red repetido | QA H-10 |
| F5 vuelve al inicio (documentado como intencional en `descuento-item.e2e.ts:56`) | QA H-08 |
| Historial sin medidas por línea | QA H-13 |
| «Oregon» sin tilde en el PDF | QA H-13 |
| Código `IA-` en altas hechas a mano | QA H-13 |
| Campos de accesorio visibles antes de elegir la familia | QA H-13 |
| Actividad duplicada en la recotización | Cot H-10 |
| «Cotización actualizada» sin cambios | IA H10 |
| «un metro» no se acepta, y la pregunta dice «para Producto» | IA H11 |
| Consultar usa otra fórmula de redondeo (hoy sin diferencias) | Cat H16 |
| Sin documentación del catálogo para la usuaria | Cat H15 |
| Avisos que desaparecen a los 7 s | UX-23 |
| Preferencia del asistente contraído no se recuerda | UX-24 |
| «Monto recibido» no sugiere el anticipo | UX-22 |
| Ejemplo del chat distinto del que se inserta | UX-26 |
| «Nueva cotización para este cliente» desde Clientes | UX-28 |
| Logs sin id de solicitud | Arq M-04 |
| Falta una prueba de autenticación de todas las rutas | Arq M-05 |
| Falta `server-only` | Arq M-06 |
| Plazo de 5 s del login en la E2E | QA H-12 |

---

## 6. Causas raíz

| # | Causa raíz | Hallazgos que explica |
|---|---|---|
| CR-1 | **El esquema del catálogo copia la hoja «Precio» de la planilla** (una fila por SKU), sin una entidad «modelo». La interfaz solo agregó formularios por fila. | N-06, N-09, N-20, N-21, N-32, N-33, N-34, N-35 |
| CR-2 | **Guardas contra errores de la IA que no saben el origen del dato.** Un `null` significa a la vez «no dicho» y «quitar»; una línea igual puede ser un reenvío o un pedido; un número puede ser una medida o un monto. | N-03, N-04, N-10, N-22, N-23, N-24 |
| CR-3 | **La solicitud editable guarda nombres, no precios ni códigos**, y `recalcular` se aplica por defecto: cualquier camino que recalcule sin fijar el precio cambia montos. | N-01, N-12, N-28 |
| CR-4 | **Cada camino nació por separado:** personalizado, especial, ítem libre, alta desde pendiente; buscador manual y resolutor de la IA; ajuste único y márgenes por categoría. | N-02, N-07, N-08, N-11, N-25 |
| CR-5 | **El vocabulario de la planilla y del código pasó a la interfaz.** | N-11, N-20, N-40 |
| CR-6 | **La edición de la cotización tiene operaciones de alto nivel, pero no las básicas** (duplicar, convertir, deshacer completo). | N-05, N-16, N-18, N-19 |

---

## 7. Riesgos y decisiones abiertas (antes de aplicar cambios)

1. **Respaldos de producción.** Según `AUDITORIA_INCIDENTE_LOS_RIOS.md`, no había respaldos después del 28 de octubre. Hay que confirmarlo y tener un respaldo verificado antes de cualquier migración del catálogo.
2. **Qué modelo de IA atiende hoy.** `.env.local` dice `CMD_MODEL=claude-haiku-5-5` y las evaluaciones del 7 de noviembre son de Haiku, pero la memoria del proyecto dice Qwen 3.7 Flash. Los cambios en las guardas del chat deben evaluarse con el modelo de producción (`evaluar:regresion` tiene costo y necesita aprobación).
3. **Roles (N-17).** Hay que decidir con Neltume si se mantiene una sola cuenta-administradora (y se documenta) o se crea un rol de vendedora. Varias propuestas de catálogo (revisión de altas, «pedir que se agregue») dependen de esa decisión.
4. **Contrato con la fábrica.** `integracion-pedido.ts:51-56` envía `productCode`, `family`, `model` y `wood`. El rediseño **no debe cambiar** el enum de familia ni los códigos de planilla sin coordinarlo con la fábrica (plan conjunto P0–P4).
5. **Comportamientos fijados por pruebas.** `tests/pdf.test.ts:317-335` (PDF sin medida en especiales), `descuento-item.e2e.ts:56` (F5 vuelve al inicio) y `pedido-corregido.e2e.ts:24`, que contradice N-01. Antes de cambiar algo, hay que revisar la intención documentada.
6. **Decisiones de negocio pendientes:**
   - si una revisión debe conservar los precios acordados (N-28);
   - si hoja o vano puede tener un valor por omisión (N-40);
   - si la pantalla del cotizador se gira hacia el cliente (N-15).

---

## 8. Lo que está bien (verificado)

- La aritmética de las líneas, los descuentos (porcentaje y monto), el tramo por cantidad, el flete, el IVA y el redondeo coinciden entre la pantalla, la base, la recarga y el PDF (escenario f: total $1.076.523).
- Hay concurrencia y versionado: 409 entre pestañas, emisión de a una a la vez, y el doble clic en agregar o confirmar no duplica nada.
- Con la red cortada se avisa, no se pierde lo escrito y no se consume un número de documento.
- Una cotización emitida no cambia si cambia el catálogo; las notas por fábrica usan el costo congelado.
- El SQL está parametrizado, no hay `dangerouslySetInnerHTML`, el PDF se genera sin red, el SVG pasa por una lista blanca, los archivos se nombran por su sha256 y la firma HMAC compara en tiempo constante.
- axe no encontró violaciones en 21 combinaciones de pantalla y ancho, y no hay desborde horizontal a 390 px.
- `tsc` da 0 errores y `eslint` da 0 errores con 2 avisos.
