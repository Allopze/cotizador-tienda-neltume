# Auditoría forense · incidente «Los Ríos Prepintada»

**Fecha del informe:** 2026-11-07
**Repositorio:** `/Users/allopze/dev/Neltume/tienda_puertas/Cotizador`
**Rama:** `main` · último commit `714c465` (2026-10-28)
**Producción:** `chome:/srv/cotizador-neltume` · contenedor `neltume-cotizador-cotizador-1`
**Base:** SQLite `esquema v29`, `/app/data/cotizador.sqlite`
**Modo:** auditoría de solo lectura **hasta el cierre del informe**. La corrección posterior autorizada se registra en la actualización de abajo.

---

## Actualización post-auditoría · 2026-11-07

La auditoría cerró sin escrituras. Después, con autorización expresa para implementar el arreglo, se ejecutó esta corrección controlada:

- **Respaldo creado antes de tocar datos:** `/app/respaldos/cotizador-2026-11-07T19-24-17-742Z` (85 cotizaciones, 78 PDF, 0 referencias, 11 archivos de integración).
- **Papelera de catálogo:** se enviaron a la papelera los tres productos manuales huérfanos `IA-81C1CC812F`, `IA-B5600602A0` y `IA-5CBE54E42D`, usando `eliminarManual` de la aplicación (transaccional y reversible). No estaban usados en ninguna `cotizacion_linea`.
- **Catálogo resultante:** 8.869 productos (antes 8.872). Las **8 filas importadas de Los Ríos Prepintada siguen intactas**; no hay productos manuales de Los Ríos y el rango de ancho del modelo volvió a **0,70–0,90 m**.
- **Resoluciones verificadas contra la base real:** `0,75 × 2,315` → `medida_no_disponible` de alto con rango **2,00–2,20**; `0,75 × 2,185` → `LOSR-PP-075-220`; `0,80 × 2,315` → `LOSR-PP-080-240`; `1,20 × 2,185` ya no resuelve y `0,60 × 2,00` informa el rango correcto **0,70–0,90**.
- **Código implementado en el repositorio, aún no desplegado:** `pendientes.ts` y `cotizacion-panel.tsx` (medida fuera de lista, sin «Falta: alto» ni «Agregar al catálogo», con pedido especial), `repositorio-catalogo.ts` (rechazo de huecos grandes de ancho y protección del rango de alto), `gestion-manuales.tsx` y `api/catalogo/route.ts` (`altoMin`/`altoMax` editables), más tests. `typecheck`, lint y 254 pruebas focalizadas pasan.
- **Pendiente:** desplegar el código, instalar/verificar el respaldo diario, resolver los cuatro borradores (0,75 × 2,315 como 2,185 estándar o ítem especial con costo de fábrica; 0,60 × 2,00 como especial o modelo distinto). Las secciones 1–12 describen el estado al cierre de la auditoría; esta actualización registra lo ejecutado después.

---

## 1. Resumen ejecutivo

La aplicación no se “echó”. El catálogo importado de Los Ríos está intacto y el código de producción es exactamente el de `main`. Lo que ocurrió es una combinación de tres cosas:

1. **La medida consultada no existe en la lista de fábrica.** Para Los Ríos Prepintada, el ancho 0,75 m solo tiene el rango de alto **2,00–2,20 m**. El rango 2,21–2,40 m existe, pero solo para anchos 0,70, 0,80 y 0,90. Por eso un ítem de **0,75 × 2,315 m** queda pendiente: no es un dato faltante, es una combinación que la fábrica no cotiza.
2. **La interfaz lo comunica como si faltara un dato.** Muestra «Falta: alto» y ofrece «Agregar al catálogo», cuando el alto está presente y el producto sí existe. Ese botón abre un alta prellenada con la medida exacta del ítem (`anchoMin = anchoMax = 0,75`, `largo = 2,315`), es decir, invita a crear una fila de catálogo que la fábrica no lista.
3. **La usuaria creó tres productos manuales como solución.** Dos quedaron con nombres de modelo nuevos («LOS RIOS ESPECIAL (40 MM ESPESOR)» y «LOS RIOS PREPINTADA ESPECIAL (40 MM ESPESOR)») y uno quedó bajo el modelo existente «LOS RIOS» con ancho 1,50 y alto 2,185. **Ninguno se usó en una línea valorizada.** El que coincide exactamente con 0,75 × 2,315 quedó bajo un modelo distinto, por lo que el ítem pendiente siguió sin resolverse. El que quedó bajo «LOS RIOS» ensanchó el rango aparente del modelo a 1,50 m y introdujo un riesgo latente de cotizar medidas inexistentes con el precio del producto de 1,50.

**Alcance real:** cuatro **borradores** (`db13534c…`, `1afa8c87…`, `355a0ac9…`, `b81d6540…`). **No hay cotizaciones emitidas, PDF ni totales históricos afectados.** Las cotizaciones emitidas del 5 y 6 de noviembre son de otros modelos. Los tres productos manuales de Los Ríos están huérfanos: no aparecen en ninguna `cotizacion_linea`. Los tres productos manuales de Los Lagos se usaron en las cotizaciones emitidas 379 y 389 y en sus reemplazos 378 y 386; **no deben tocarse**.

**Severidad global: P1.** Afecta la integridad del catálogo (una fila manual contamina el rango del modelo estándar), bloquea cuatro borradores y deja un riesgo latente de precio incorrecto. No hay corrupción de documentos emitidos. La recuperación es sencilla y reversible: enviar a la papelera los tres productos manuales de Los Ríos, verificar que las 8 filas importadas siguen intactas y resolver los borradores como medida estándar o pedido especial.

**Hallazgo operativo independiente y urgente:** el servidor **no tiene respaldos después del 28 de octubre de 2026**; el usuario de despliegue no tiene `crontab` y no se encontró la copia externa en `/mnt/respaldos/neltume`. El respaldo diario que describe la documentación no está operativo. Esto no causó el incidente, pero elimina la red de seguridad.

---

## 2. Estado de la investigación

### 2.1 Fuentes inspeccionadas

| Fuente | Qué se verificó | Resultado |
|---|---|---|
| Código fuente (`src/`) | Catálogo, resolver, precios, pendientes, UI, endpoints, persistencia | Leído completo en las áreas relevantes |
| Esquema SQLite v29 | Tablas, columnas, claves, migraciones | Confirmado en producción con `PRAGMA table_info` |
| Producción `chome` | Contenedor, versión, base, catálogo, cotizaciones, eventos, respaldos | **Consultado en solo lectura** |
| `productos_catalogo` | Filas de Los Ríos en ambas terminaciones | 8 filas PREPINTADA + 10 filas MARA ENCHAPADA, intactas |
| `productos_adicionales` | Productos creados a mano | 6 en total: 3 de Los Lagos (usados) y 3 de Los Ríos (huérfanos) |
| `catalogo_ediciones` | Ediciones de filas importadas | **Vacía** |
| `catalogo_anterior` | Copia para «volver a la planilla anterior» | **Vacía** |
| `papelera` | Productos eliminados | **Vacía** |
| `catalogo_meta` / `catalogo_origenes` | Última mutación e importaciones | Última mutación 2026-11-07T00:19:00.503Z; importaciones del 2026-10-02 |
| `cotizaciones` / `solicitudes` / `incompletos` | Estado de los borradores | 4 borradores de Los Ríos; ninguno emitido |
| `eventos` | Actividad del 5 al 7 de noviembre | Reconstrucción minuto a minuto de las ediciones |
| `auditoria_cuentas` | Inicios de sesión | Solo se usó para confirmar la ventana; no se exponen datos personales |
| Respaldos | `/app/respaldos` y `/mnt/respaldos/neltume` | 15 respaldos del 15 al 28 de octubre; **ninguno de noviembre**; sin cron del usuario de despliegue; sin copia externa visible |
| Hashes de producción | 6 archivos clave | **Idénticos a `main`** |
| Planilla oficial de enchapadas | `VALORES PUERTAS ENCHAPADAS_NELTUME.CO.xlsx` | Fuente de verdad de las 8 filas de Los Ríos |
| Planilla principal | `COTIZADOR_2026.xlsx` | No contiene Los Ríos; confirma que el modelo viene de enchapadas |

### 2.2 Limitaciones

- No se dispone de un respaldo anterior al 6 de noviembre: la reconstrucción se hizo con timestamps de `productos_adicionales`, `catalogo_meta`, eventos y la planilla oficial.
- No se conserva el valor anterior de las filas importadas porque nunca se editaron (`catalogo_ediciones` vacía). No hay nada que restaurar en ellas.
- No se dispone del archivo de la captura original; se contrastó con los ítems reales de los borradores.
- No se ejecutaron pruebas E2E ni se levantó la aplicación. Todo el análisis de comportamiento se basa en el código de producción, que coincide con `main`.
- No se expone información de clientes, correos, IPs ni secretos. Los identificadores de cotización son UUID internos.

---

## 3. Cronología reconstruida

Horas en **UTC** y en **hora de Chile** (UTC-3 en noviembre de 2026). La fuente son `eventos`, `productos_adicionales.creada` y `catalogo_meta.fecha`.

| Fecha/hora Chile | Fecha/hora UTC | Evento | Entidad | Evidencia | Confianza |
|---|---|---|---|---|---|
| 2026-11-06 20:42:02 | 2026-11-06T23:42:02Z | Se crea el borrador `db13534c…` con 8 ítems (Los Ríos, marcos y Baker) | Cotización | `cotizaciones.creada`; evento 783 | Alta |
| 2026-11-06 20:42:10 | 2026-11-06T23:42:10Z | Se duplica como `1afa8c87…` | Cotización | `cotizaciones.creada`; evento 784 | Alta |
| 2026-11-06 20:42:24 | 2026-11-06T23:42:24Z | Se ajustan marcos a 2,40 m | Cotización | eventos 785-786 | Alta |
| 2026-11-06 20:52:45 | 2026-11-06T23:52:45Z | Se crea el producto manual `IA-81C1CC812F` bajo el modelo **LOS RIOS**, 1,50 × 2,185, costo 51.700 | Catálogo manual | `productos_adicionales.creada` | Alta |
| 2026-11-06 20:53:12 | 2026-11-06T23:53:12Z | El ítem 0,75 × 2,31 se cambia a 2,19 y vuelve a 2,31 | Cotización | eventos 787-788 | Alta |
| 2026-11-06 20:55:11 | 2026-11-06T23:55:11Z | Se fija precio cliente $51.700 para el ítem 0,75 × 2,31 | Cotización | evento 789 | Alta |
| 2026-11-06 20:56:46 | 2026-11-06T23:56:46Z | Se reemplaza por un ítem libre «LOS RIOS PREPINTADA (40 MM ESPESOR) DE 0.90X2.185 MT (HOJA CORREDERA)» | Cotización | evento 791 | Alta |
| 2026-11-06 20:57:35 | 2026-11-06T23:57:35Z | Se fija costo de fábrica $51.700 al ítem especial | Cotización | evento 792 | Alta |
| 2026-11-06 21:01:08 | 2026-11-07T00:01:08Z | Se agrega un ítem de 0,90 × 2,19 | Cotización | evento 795 | Alta |
| 2026-11-06 21:02:34 | 2026-11-07T00:02:34Z | Se fija precio cliente $124.080 al ítem 0,90 × 2,19 (costo 51.700 → margen 140 %) | Cotización | evento 798 | Alta |
| 2026-11-06 21:04:20 | 2026-11-07T00:04:20Z | Se agrega 0,80 × 2,40; luego se cambia a 0,75 × 2,40 y a 0,75 × 2,31 | Cotización | eventos 801-804 | Alta |
| 2026-11-06 21:06:46 | 2026-11-07T00:06:46Z | Se quita el ítem 0,75 × 2,31 | Cotización | evento 807 | Alta |
| 2026-11-06 21:09:57 | 2026-11-07T00:09:57Z | Se vuelve a agregar 0,75 × 2,31 | Cotización | evento 808 | Alta |
| 2026-11-06 21:13:04 | 2026-11-07T00:13:04Z | Se crea el borrador `355a0ac9…` con los mismos ítems | Cotización | `cotizaciones.creada`; evento 809 | Alta |
| 2026-11-06 21:16:50 | 2026-11-07T00:16:50Z | Se crea el producto manual `IA-B5600602A0` bajo el modelo **LOS RIOS ESPECIAL (40 MM ESPESOR)**, 0,90 × 2,185, costo 51.700 | Catálogo manual | `productos_adicionales.creada` | Alta |
| 2026-11-06 21:19:00 | 2026-11-07T00:19:00Z | Se crea el producto manual `IA-5CBE54E42D` bajo el modelo **LOS RIOS PREPINTADA ESPECIAL (40 MM ESPESOR)**, 0,75 × 2,315, precio 124.080. Es la **última mutación del catálogo** | Catálogo manual | `productos_adicionales.creada`; `catalogo_meta.fecha` | Alta |
| 2026-11-07 10:41:45 | 2026-11-07T13:41:45Z | En `355a0ac9…` se quita 0,75 × 2,31; se quita el ítem sin medidas; se agrega 0,60 × 2,00 | Cotización | eventos 812-814 | Alta |
| 2026-11-07 10:43:00 | 2026-11-07T13:43:00Z | El ítem 0,60 × 2,00 queda pendiente: «anchos entre 0,70 y 1,50» (el 1,50 aparece por el producto manual `IA-81C1…`) | Cotización | `incompletos` de `355a0ac9…` | Alta |
| 2026-11-07 10:46:11 | 2026-11-07T13:46:11Z | Se crea el borrador `b81d6540…` con 0,75 × 2,31 pendiente, 0,90 × 2,19 y 0,89 × 2,205 | Cotización | `cotizaciones.creada`; evento 815 | Alta |
| 2026-11-07 10:46:18 | 2026-11-07T13:46:18Z | El ítem 0,75 × 2,315 queda pendiente; la interfaz sugiere 2,185 «como el ítem 8» (el 0,90 × 2,185) | Cotización | `incompletos` de `b81d6540…`; captura | Alta |
| 2026-11-07 | — | La usuaria reporta el problema | — | Transcripción | Alta |

**Hecho confirmado:** no hay commits ni despliegues entre el 28 de octubre y el 7 de noviembre. Los hashes de los seis archivos clave de producción son idénticos a `main`. El incidente no es una regresión de código.

---

## 4. Estado actual de producción

### 4.1 Catálogo importado: intacto

`productos_catalogo` contiene exactamente las 8 filas de **LOS RIOS PREPINTADA** que define la planilla oficial:

| Código | Madera | Medida | Alto mín–máx | Largo | Precio neto | Origen | Fila |
|---|---|---|---:|---:|---:|---|---:|
| `LOSR-PP-070-220` | PREPINTADA | 0,70 | 2,00–2,20 | 2,20 | 34.230 | enchapadas | 6 |
| `LOSR-PP-075-220` | PREPINTADA | 0,75 | 2,00–2,20 | 2,20 | 42.083 | enchapadas | 7 |
| `LOSR-PP-080-220` | PREPINTADA | 0,80 | 2,00–2,20 | 2,20 | 42.083 | enchapadas | 8 |
| `LOSR-PP-085-220` | PREPINTADA | 0,85 | 2,00–2,20 | 2,20 | 42.083 | enchapadas | 9 |
| `LOSR-PP-090-220` | PREPINTADA | 0,90 | 2,00–2,20 | 2,20 | 42.083 | enchapadas | 10 |
| `LOSR-PP-070-240` | PREPINTADA | 0,70 | 2,21–2,40 | 2,40 | 46.500 | enchapadas | 12 |
| `LOSR-PP-080-240` | PREPINTADA | 0,80 | 2,21–2,40 | 2,40 | 52.500 | enchapadas | 13 |
| `LOSR-PP-090-240` | PREPINTADA | 0,90 | 2,21–2,40 | 2,40 | 52.500 | enchapadas | 14 |

También están intactas las 10 filas de **LOS RIOS MARA ENCHAPADA** (`LOSR-EM-…`), que sí tienen 0,75 y 0,85 en el tramo 2,21–2,40.

**No existe** `LOSR-PP-075-240` ni `LOSR-PP-085-240`. No es un dato perdido: la planilla de fábrica no los tiene. Es la causa comercial del bloqueo.

### 4.2 Productos manuales

`productos_adicionales` tiene 6 filas. Tres son de Los Lagos y **se usaron en cotizaciones emitidas y en sus reemplazos**; no deben modificarse. Las tres de Los Ríos son las del incidente:

| Código | Modelo | Madera | Medida | Ancho | Largo | Precio neto | Creada (UTC) | Creada por | ¿Usada en línea? |
|---|---|---|---|---:|---:|---:|---|---|---|
| `IA-81C1CC812F` | **LOS RIOS** | PREPINTADA | 1,50 A 1,50 | 1,50 | 2,185 | 51.700 | 2026-11-06T23:52:45.701Z | Cuenta de la usuaria | **No** |
| `IA-B5600602A0` | **LOS RIOS ESPECIAL (40 MM ESPESOR)** | PREPINTADA | 0,90 A 0,90 | 0,90 | 2,185 | 51.700 | 2026-11-07T00:16:50.112Z | Cuenta de la usuaria | **No** |
| `IA-5CBE54E42D` | **LOS RIOS PREPINTADA ESPECIAL (40 MM ESPESOR)** | PREPINTADA | 0,75 A 0,75 | 0,75 | 2,315 | 124.080 | 2026-11-07T00:19:00.503Z | Cuenta de la usuaria | **No** |

La consulta `manuales_no_usados` devuelve exactamente estas tres filas. La consulta `lineas_manuales` devuelve solo los tres productos de Los Lagos. **Las tres filas de Los Ríos no aparecen en ninguna `cotizacion_linea`.**

### 4.3 Por qué la fila `IA-81C1CC812F` contamina el modelo estándar

`IA-81C1CC812F` quedó bajo el modelo **LOS RIOS** (el modelo estándar), con ancho 1,50 y alto 2,185. El resolver agrupa las filas por modelo y madera y, para un ancho pedido, elige la fila que lo contiene o, si no hay ninguna, **la siguiente hacia arriba** (`porEscalon`, `resolver.ts:130-160`). Consecuencias:

1. El rango aparente del modelo pasa de 0,70–0,90 a **0,70–1,50**. Prueba directa: el ítem 0,60 × 2,00 de `355a0ac9…` quedó pendiente con `disponibles: ["0,70","0,75","0,80","0,85","0,90","1,50 A 1,50"]` y `rango: {min:0.7, max:1.5}`, aunque 1,50 no es una medida estándar de Los Ríos Prepintada.
2. Cualquier ancho entre 0,91 y 1,50 m que se cotice a 2,185 m puede resolverse con la fila de 1,50 como «siguiente medida», con el precio de esa fila (51.700 de costo). No hay filas intermedias que lo impidan. El sistema avisaría «medida especial», pero cotizaría una puerta que la fábrica no lista.
3. El alto 2,185 de la fila manual está dentro del rango 2,00–2,20 de las filas importadas; la comprobación `rangoSuperpuesto` no lo detecta porque compara **anchos** solo entre filas cuyos rangos de **alto** se tocan, y el ancho 1,50 no se cruza con 0,70–0,90 (`repositorio-catalogo.ts:589-602`). El hueco queda abierto.

Este es el daño real al modelo: no se perdió ninguna fila, pero se agregó un “puente” de precio que no corresponde a la lista de fábrica.

### 4.4 `IA-5CBE54E42D`: precio mal cargado

El precio neto de esta fila es **124.080**, que **coincide con el precio de venta** que la usuaria fijó para el ítem especial de 0,90 × 2,185 y no con el costo de fábrica (51.700); es probable que se haya copiado el precio de venta en el campo de costo. Si esta fila se usara para cotizar, el margen de prepintadas (140 %) se aplicaría sobre 124.080 y daría un precio de venta de ~297.792, muy superior al real. Hoy está huérfana, pero es un riesgo latente.

### 4.5 Cotizaciones afectadas

Las cuatro son **borradores**. Ninguna tiene número ni PDF:

| Cotización | Estado | Creada (UTC) | Última edición (UTC) | Ítems pendientes | Total neto actual |
|---|---|---|---:|---|---:|
| `db13534c-c5c3-4a51-b8fe-f8fc18a628e9` | borrador | 2026-11-06T23:42:02Z | 2026-11-06T23:42:08Z | orden 6 (0,75×2,315), orden 7 (sin medidas), marcos sin alto | 682.335 |
| `1afa8c87-475d-4aec-a671-2decd938c90e` | borrador | 2026-11-06T23:42:10Z | 2026-11-07T00:09:57Z | orden 7 (0,75×2,315) | 986.160 |
| `355a0ac9-26df-4570-8229-2ecaa9ab79a8` | borrador | 2026-11-07T00:13:04Z | 2026-11-07T13:43:00Z | orden 6 (0,60×2,00) | 862.080 |
| `b81d6540-1d20-4754-812b-6d28fa80bce1` | borrador | 2026-11-07T13:46:11Z | 2026-11-07T13:46:33Z | orden 6 (0,75×2,315); orden 8 (0,89×2,205) sin línea ni rechazo | 1.089.079 |

**La captura corresponde con alta probabilidad a `b81d6540…`:** el ítem pendiente 0,75 × 2,315 es el orden 6 (ítem 7) y el ítem 8 es el 0,90 × 2,185 que la interfaz ofrece como sugerencia «2,185 m, como el ítem 8». Encaja con el texto de la captura.

**Observación secundaria:** en `b81d6540…` el ítem orden 8 (0,89 × 2,205) existe en `solicitudes` pero no tiene línea en `cotizacion_lineas` ni rechazo en `incompletos`, y no suma al total. Es una inconsistencia de estado del borrador (posible desincronización entre `solicitudes`, `cotizacion_lineas` e `incompletos` tras las últimas ediciones). No afecta a documentos emitidos, pero conviene reproducirla.

### 4.6 Lo que NO cambió

- `catalogo_ediciones`: **vacía**. Ninguna fila importada fue editada.
- `papelera`: **vacía**. Nada fue eliminado.
- `catalogo_anterior`: **vacía**. No hay copia para «volver a la planilla anterior».
- Las filas importadas de Los Ríos: intactas, con sus 8 códigos y precios.
- Las cotizaciones emitidas del 5 y 6 de noviembre: son de otros modelos (Los Lagos, Baker, marcos); no contienen Los Ríos.
- El código de producción: hashes idénticos a `main` en los seis archivos clave.

---

## 5. Hallazgos técnicos

### H-01 · P1 · «Falta: alto» y «Agregar al catálogo» para una medida que existe pero está fuera de la lista

- **File/lines:**
  - `src/catalogo/resolver.ts:397-405` — `medida_no_disponible` con `campo: 'alto'` y `rango`.
  - `src/negocio/pendientes.ts:206-216` — convierte el rechazo en una `Parte` con `campo: r.campo`.
  - `src/negocio/pendientes.ts:366-370` — `faltantesItem()` devuelve ese campo como faltante.
  - `src/app/cotizacion-panel.tsx:818-824` — imprime «Incompleto · no suma al total» y «Falta: …».
  - `src/negocio/pendientes.ts:241-257` — `prefillAlta()` incluye `medida_no_disponible`.
  - `src/app/preguntas-pendientes.tsx:78-82` — muestra «Agregar al catálogo».
- **Evidence:** para 0,75 m de ancho, el único alto de Los Ríos Prepintada es 2,00–2,20. El ítem 0,75 × 2,315 de `b81d6540…` tiene `rechazo_json` `medida_no_disponible`, `campo: "alto"`, `rango: {min:2,max:2.2}`, y la pregunta real es «Los Rios no viene en 2,315 m de alto o largo. Se cotizan altos o largos entre 2,00 y 2,20 m.». La UI lo resume como «Falta: alto».
- **Why it matters:** confunde un límite comercial con un dato ausente e invita a “arreglar” el catálogo creando una fila que la fábrica no cotiza. Fue el disparador del incidente.
- **Recommended fix:** agregar un motivo tipificado (`falta_dato` vs `fuera_de_lista`); no mostrar «Falta: alto» cuando el alto está presente; no ofrecer alta de catálogo para `medida_no_disponible` si el modelo y la madera existen; ofrecer «Cotizar como pedido especial» y «Revisar medida».

### H-02 · P1 · Una fila manual con un ancho nuevo amplía el rango del modelo y crea un “puente” de precio

- **File/lines:** `src/servidor/repositorio-catalogo.ts:589-602` (`rangoSuperpuesto` solo compara mismos altos), `src/catalogo/resolver.ts:130-160` (`porEscalon` elige la siguiente medida), `src/catalogo/escalones.ts:20-23,69-74`.
- **Evidence:** `IA-81C1CC812F` (LOS RIOS, 1,50 × 2,185, 51.700) se creó el 2026-11-06T23:52:45Z. El ítem 0,60 × 2,00 de `355a0ac9…` quedó pendiente con `disponibles` que incluye `"1,50 A 1,50"` y `rango: {min:0.7,max:1.5}`. Sin esa fila, el rango sería 0,70–0,90. Cualquier ancho 0,91–1,50 a 2,185 puede resolverse con la fila de 1,50 como «siguiente medida».
- **Why it matters:** una fila manual pensada para un pedido puntual contamina todo el modelo estándar y puede cotizar medidas inexistentes con un precio que no corresponde.
- **Recommended fix:** validar el alta/edición contra la **cobertura completa** del modelo (todos los anchos y altos, no solo el mismo alto); rechazar o marcar como `fueraDeLista` una fila que abra un hueco; excluir esas filas del resolver estándar; ejecutar una comprobación de ambigüedad/cobertura después de cada cambio.

### H-03 · P1 · Los tres productos manuales de Los Ríos están huérfanos y uno tiene el precio equivocado

- **File/lines:** `src/servidor/repositorio-catalogo.ts:1037-1102` (`agregarProductoManual`), `src/servidor/alta-catalogo.ts:347-373` (construcción y código `IA-…`), `src/servidor/base-datos.ts:970-988` (`productos_adicionales`).
- **Evidence:** `manuales_no_usados` devuelve `IA-81C1CC812F`, `IA-B5600602A0` y `IA-5CBE54E42D`; `lineas_manuales` solo devuelve los tres productos de Los Lagos. El ítem especial de `1afa8c87…` es `codigo: "ESPECIAL"` (ítem libre), no uno de los manuales. `IA-5CBE54E42D` tiene `precio_neto: 124.080`, que **coincide con el precio de venta** del ítem especial de 0,90 × 2,185 y no con el costo de fábrica (51.700); es probable que se haya copiado el precio de venta en el campo de costo.
- **Why it matters:** los productos manuales no resuelven el ítem pendiente, ensucian el catálogo y, si alguien los selecciona, pueden cotizar con un precio 2,4× superior. `IA-5CBE54E42D` coincide exactamente con 0,75 × 2,315 pero bajo un modelo distinto, que es la razón directa de «no puedo hacer nada con los ríos».
- **Recommended fix:** enviar los tres a la papelera (`eliminarManual`), previa verificación de que no estén en ninguna línea (ya verificada); conservar `IA-5CBE…` en la papelera como evidencia; no reutilizar su precio.

### H-04 · P1 · No hay auditoría de cambios del catálogo

- **File/lines:** `src/servidor/base-datos.ts:422-424` (`catalogo_ediciones (codigo, fecha)`), `src/servidor/repositorio-catalogo.ts:847-849` (solo código y fecha), `src/servidor/base-datos.ts:1001-1017` (`productos_catalogo` sin `updated_at`).
- **Evidence:** `catalogo_ediciones` está vacía y no guarda autor, valores anteriores ni operación. La reconstrucción dependió de `productos_adicionales.creada` y `catalogo_meta.fecha`. Si el cambio hubiera sido una edición de fila importada, no habría forma de saber qué valores había antes.
- **Why it matters:** sin traza no se puede auditar, revertir con precisión ni distinguir un error de usuario de un error de sistema.
- **Recommended fix:** tabla `catalogo_auditoria` (`fecha`, `actor`, `accion`, `codigo`, `origen`, `antes_json`, `despues_json`, `detalle`), escrita en alta, edición, eliminación, restauración, importación y cambio de configuración.

### H-05 · P1 operativo · No hay respaldos después del 28 de octubre y el cron no está operativo

- **File/lines:** `scripts/respaldar.ts`, `scripts/respaldo-diario.sh`, `docker/LEEME.md:301-319`.
- **Evidence:** `/app/respaldos` contiene 15 carpetas del 2026-10-15 al 2026-10-28; ninguna del 4 al 7 de noviembre. `crontab -l` del usuario de despliegue responde `SIN_CRONTAB`. No se encontró `/mnt/respaldos/neltume`. `catalogo_anterior` está vacía.
- **Why it matters:** no hay punto de restauración anterior al incidente. La recuperación depende de la papelera y de la planilla oficial, no de un respaldo. Si el incidente hubiera afectado filas importadas, no habría forma de volver atrás.
- **Recommended fix:** instalar el cron de `respaldo-diario.sh` con copia a otro disco, verificar el primer respaldo y monitorear `/api/salud`; documentar la retención; probar una restauración en un entorno aislado.

### H-06 · P2 · El alta no detecta modelos casi duplicados

- **File/lines:** `src/servidor/alta-catalogo.ts:462-498` (`familiaExistente`, `productoDuplicado`, `rangoSuperpuesto`), `src/servidor/repositorio-catalogo.ts:572-587`.
- **Evidence:** `modelos_parecidos` devuelve `LOS RIOS`, `LOS RIOS ESPECIAL (40 MM ESPESOR)` y `LOS RIOS PREPINTADA ESPECIAL (40 MM ESPESOR)`. El alta aceptó los tres sin advertir que eran variantes del mismo modelo.
- **Why it matters:** crea modelos paralelos, confunde la búsqueda y hace que el ítem del modelo correcto siga pendiente.
- **Recommended fix:** comparación tolerante (`modeloParecido` ya existe en `configuracion.ts`) y confirmación explícita «¿Es el mismo modelo que LOS RIOS?» antes de crear uno nuevo.

### H-07 · P2 · El alta desde un pendiente crea un rango de ancho de un solo punto

- **File/lines:** `src/negocio/pendientes.ts:247-255` (`anchoMin = anchoMax = ancho`, `largo = alto`), `src/app/alta-producto.tsx:44-98`, `src/servidor/alta-catalogo.ts:347-373`.
- **Evidence:** el alta de «Agregar al catálogo» prellena exactamente la medida consultada. Para 0,75 × 2,315 crea una fila de 0,75 a 0,75 y 2,315 de alto, fuera de la lista de fábrica; para 1,50 × 2,185 crea la fila que contamina el modelo.
- **Why it matters:** convierte un problema de medida en un producto de catálogo; no hay comprobación contra la planilla de origen.
- **Recommended fix:** separar «crear modelo» de «agregar medida a un modelo existente»; no prellenar un rango de un punto; exigir confirmación de fábrica para productos fuera de lista; validar la cobertura.

### H-08 · P2 · Editar «Alto» en un producto de rango no cambia el rango efectivo

- **File/lines:** `src/app/gestion-manuales.tsx:36-48` (solo `largo`), `471-474` («Alto»), `src/app/api/catalogo/route.ts:59-79` (sin `altoMin/Max`), `src/servidor/repositorio-catalogo.ts:731-735,824-846`, `src/catalogo/escalones.ts:20-23`.
- **Evidence:** las filas importadas de enchapadas tienen `alto_min=2.00`, `alto_max=2.20`; el formulario solo expone `largo`. Cambiar «Alto» a 2,315 actualiza `largo` pero el resolver sigue viendo 2,00–2,20. En este incidente no hubo ediciones de filas importadas (`catalogo_ediciones` vacía), pero el defecto es real y coincide con el relato «le modifiqué las medidas y no cambió nada».
- **Why it matters:** el usuario cree que cambió el rango y el sistema sigue cotizando el anterior; además deja `largo` incoherente con `altoMin/Max`.
- **Recommended fix:** exponer `altoMin`/`altoMax` en la edición o bloquear «Alto» cuando el producto tiene rango; en el servidor, rechazar un `largo` que contradiga el rango o actualizar ambos de forma atómica.

### H-09 · P2 · Permisos asimétricos en el catálogo

- **File/lines:** `src/app/api/catalogo/route.ts:199-231` (`editar` exige admin; `eliminar`, `restaurar`, `listar_eliminados`, `manual`, `confirmar` no), `src/servidor/autenticacion-config.ts:275-276`.
- **Why it matters:** hoy todas las cuentas son admin, pero si se incorpora una vendedora sin permisos, podría crear/eliminar productos y no corregirlos. Es un riesgo de gobernanza.
- **Recommended fix:** permisos de catálogo uniformes (`leer`, `crear`, `editar`, `eliminar`, `importar`).

### H-10 · P3 · Inconsistencia de estado en el borrador `b81d6540…`

- **File/lines:** `src/servidor/servicio.ts:241-319` (`calcular`), `src/servidor/almacen.ts` (persistencia de `solicitudes`, `cotizacion_lineas`, `incompletos`).
- **Evidence:** el ítem orden 8 (0,89 × 2,205) existe en `solicitudes`, no está en `cotizacion_lineas` ni en `incompletos`, y no suma al total. Puede ser un estado transitorio tras las últimas ediciones.
- **Why it matters:** un ítem visible que no se valora ni se marca como pendiente es una inconsistencia de UI/datos.
- **Recommended fix:** reproducir con una edición equivalente; si se confirma, asegurar que `calcular` reconstruya las tres colecciones de forma atómica y que la UI muestre el estado real.

### H-11 · P3 · `catalogo_anterior` vacía: no se puede «volver a la planilla anterior»

- **File/lines:** `src/servidor/repositorio-catalogo.ts:285-305`, `936-1005`.
- **Evidence:** `anterior: []`. La función `deshacerImportacion` no tiene copia.
- **Why it matters:** se pierde una vía de recuperación barata. En este caso no se necesita porque las filas importadas están intactas, pero es una debilidad.
- **Recommended fix:** conservar la copia de la última importación por origen y verificar su presencia tras cada importación.

---

## 6. Causa raíz

### 6.1 Cadena causal confirmada

1. **La combinación 0,75 × 2,315 m no existe en la lista de fábrica.** La planilla de enchapadas tiene, para LOS RIOS PREPINTADA, 0,75 solo en el rango 2,00–2,20. El tramo 2,21–2,40 tiene 0,70, 0,80 y 0,90. No es un dato perdido: es una política comercial.
2. **El resolver aplica correctamente la restricción.** `resolverItem` devuelve `medida_no_disponible` con `campo: 'alto'`, `rango: {2.00, 2.20}`. El ítem no suma al total. Eso es correcto.
3. **La UI traduce mal el rechazo.** `faltantesItem` convierte el campo del rechazo en «Falta: alto»; `prefillAlta` genera un alta para `medida_no_disponible`; el botón «Agregar al catálogo» aparece. El usuario interpreta que el producto no existe o que le falta un dato, cuando en realidad la medida está fuera de la lista.
4. **La usuaria creó tres productos manuales.** El primero, `IA-81C1CC812F`, quedó bajo el modelo estándar «LOS RIOS» con 1,50 × 2,185. Los otros dos, `IA-B5600602A0` y `IA-5CBE54E42D`, quedaron bajo modelos nuevos. Ninguno se usó en una línea valorizada.
5. **El producto que coincide con la medida está bajo el modelo equivocado.** `IA-5CBE54E42D` es 0,75 × 2,315, exactamente la medida pendiente, pero su modelo es «LOS RIOS PREPINTADA ESPECIAL (40 MM ESPESOR)», no «LOS RIOS». Por eso el ítem de `b81d6540…` sigue en `medida_no_disponible`: el resolver busca «LOS RIOS» y no encuentra esa fila.
6. **El primer producto manual contamina el modelo estándar.** `IA-81C1CC812F` (1,50 × 2,185) amplía el rango aparente de «LOS RIOS» a 0,70–1,50. Prueba directa: el ítem 0,60 × 2,00 de `355a0ac9…` ahora informa «anchos entre 0,70 y 1,50» e incluye `1,50 A 1,50` en las opciones. Además, cualquier ancho 0,91–1,50 a 2,185 puede resolverse con esa fila como «siguiente medida».
7. **El resultado se percibe como «Los Ríos quedó modificado y no puedo hacer nada».** Las filas importadas no cambiaron, pero el modelo ahora tiene tres “variantes” manuales, una de ellas contaminando el rango, y el ítem pendiente no se resuelve porque la fila correcta está bajo otro nombre.

### 6.2 Qué NO es la causa

- **No es una regresión de código:** producción tiene los mismos hashes que `main`; no hubo despliegue el 6 de noviembre.
- **No es una corrupción del catálogo importado:** las 8 filas PREPINTADA y las 10 MARA ENCHAPADA están intactas; `catalogo_ediciones` está vacía.
- **No es una cotización histórica alterada:** las cuatro afectadas son borradores; las emitidas son de otros modelos y conservan su snapshot.
- **No es un problema de conversión vano/hoja:** el sistema no convierte vano a hoja; cobra el ancho pedido y avisa si está a menos de 5 cm del inicio del tramo. El ítem es vano, pero eso no cambia el precio ni la disponibilidad.
- **No es un problema de unidades:** 2,315 m es una medida válida de la familia PUERTA (0,3–3 m); el rechazo es por el rango del catálogo, no por el lector.

### 6.3 Hipótesis residuales

| Hipótesis | Confianza | Estado |
|---|---|---|
| La usuaria quiso un pedido especial de 40 mm y creó los manuales como puente | Alta | Los tres manuales tienen `tipo`/nombres de 40 mm; el ítem especial `ESPECIAL` de 0,90 × 2,185 tiene costo 51.700 y venta 124.080 |
| La usuaria creía que «Agregar al catálogo» corregía el ítem pendiente | Alta | El botón se muestra en el pendiente y el alta se prellena con la medida |
| El nombre «LOS RIOS PREPINTADA ESPECIAL…» fue un intento de describir el producto, no un modelo nuevo | Alta | El nombre incluye terminación y espesor, no solo el modelo |
| La fila `IA-5CBE…` se creó para que el ítem 0,75 × 2,315 resolviera | Alta | Medida exacta; quedó bajo otro modelo y no resolvió |
| El ítem 0,60 × 2,00 es un error de tipeo (0,60 en vez de 0,70) | Media | La usuaria lo agregó el 7-11 a las 10:43; el sistema lo rechaza por mínimo 0,70 |
| Hay más borradores duplicados que conviene archivar | Alta | Cuatro borradores con los mismos ítems base; el usuario debe elegir uno |

---

## 7. Alcance del impacto

| Ámbito | Impacto | Evidencia |
|---|---|---|
| Catálogo importado | **Sin cambios**: 8 filas PREPINTADA + 10 MARA ENCHAPADA intactas | `productos_catalogo` |
| Catálogo manual | 3 filas de Los Ríos huérfanas; 1 contamina el rango del modelo estándar | `productos_adicionales`, `modelos_parecidos` |
| Borradores | 4 borradores con ítems pendientes; totales parciales sin esos ítems | `cotizaciones`, `solicitudes`, `incompletos` |
| Cotizaciones emitidas | **Sin impacto**: las del 5–6 de noviembre son de otros modelos | `cotizaciones`, `eventos` |
| PDF y documentos | **Sin impacto**: no hay emisión de Los Ríos | `documentos_snapshot`, `pdf` |
| Precios históricos | **Sin impacto**: las líneas emitidas conservan snapshot; los manuales no se usaron | `cotizacion_lineas` |
| Otros modelos | Sin impacto directo; el riesgo de “puente” es específico de LOS RIOS PREPINTADA | `resolver.ts` |
| Otras terminaciones de Los Ríos | MARA ENCHAPADA intacta; no se tocó | `productos_catalogo` |
| Procesos que consumen el catálogo | Importación, alta, cotizador, integración a fábrica; el catálogo manual no se usa en la nota si no hay línea | `integracion-pedido.ts` |
| Respaldo / recuperación | **Sin respaldo desde el 28-10**; sin cron del usuario de despliegue; sin copia externa visible | `/app/respaldos`, `crontab` |

---

## 8. Plan de reparación

> Ninguna acción de esta sección se ejecutó durante la auditoría. Requieren aprobación humana y respaldo previo. No se debe inventar ningún precio: el costo de 0,75 × 2,315 debe confirmarlo la fábrica.

| Prioridad | Acción | Archivos o datos afectados | Riesgo | Validación |
|---|---|---|---|---|
| P0 | Respaldar base + WAL + PDF + configuración y verificar `integrity_check` | `npm run respaldar` en el contenedor | Bajo | Copia íntegra; conteo de cotizaciones coincide |
| P1 | Enviar a papelera los 3 productos manuales de Los Ríos | `productos_adicionales`: `IA-81C1CC812F`, `IA-B5600602A0`, `IA-5CBE54E42D` | Bajo | `productos_adicionales` sin filas de Los Ríos; `papelera` conserva las 3; ninguna `cotizacion_linea` las referencia (verificado) |
| P1 | Verificar que las 8 filas PREPINTADA siguen intactas | `productos_catalogo` | Bajo | Códigos, medidas, rangos y precios = planilla oficial |
| P1 | Resolver el ítem 0,75 × 2,315 de `b81d6540…` y `1afa8c87…` | `solicitudes` / `incompletos` del borrador | Medio | O se ajusta a 2,185 (estándar 0,75×2,00–2,20) o se cotiza como ítem `ESPECIAL` con costo confirmado por fábrica; no como fila de catálogo |
| P1 | Resolver el ítem 0,60 × 2,00 de `355a0ac9…` | `solicitudes` / `incompletos` | Medio | Pedido especial o modelo distinto; no hay ancho 0,60 en la lista |
| P1 | Elegir un solo borrador y archivar los duplicados | `cotizaciones` (`db13534c…`, `1afa8c87…`, `355a0ac9…`, `b81d6540…`) | Bajo | Un borrador vigente; los demás en la papelera de borradores, sin emitir |
| P1 | Instalar y verificar el respaldo diario + copia externa | `scripts/respaldo-diario.sh`, `crontab`, `/mnt/respaldos/neltume` | Bajo | Primer respaldo del día; alerta si falla |
| P1 | Distinguir «fuera de lista» de «falta dato» en la UI y no ofrecer alta de catálogo en ese caso | `src/negocio/pendientes.ts`, `src/app/cotizacion-panel.tsx`, `src/app/preguntas-pendientes.tsx` | Medio | 0,75×2,315 muestra «fuera de lista» + «pedido especial»; no muestra «Falta: alto» ni «Agregar al catálogo» |
| P1 | Validar que una fila manual no abra un hueco en el rango del modelo | `src/servidor/repositorio-catalogo.ts:589-602`, `src/catalogo/resolver.ts` | Alto | 1,20×2,185 no resuelve a 1,50 sin marca de especial; 0,60 informa 0,70–0,90 |
| P1 | Añadir auditoría de catálogo con actor y antes/después | `src/servidor/base-datos.ts` (nueva tabla/migración v30), `src/servidor/repositorio-catalogo.ts` | Medio | Alta/edición/baja dejan fila con actor y valores |
| P2 | Exponer `altoMin`/`altoMax` o bloquear «Alto» en productos de rango | `src/app/gestion-manuales.tsx`, `src/app/api/catalogo/route.ts:59-79`, `src/servidor/repositorio-catalogo.ts:717-853` | Alto | Editar el rango cambia el resolver; no queda `largo` incoherente |
| P2 | Separar «crear modelo» de «agregar medida a un modelo existente» | `src/app/alta-producto.tsx`, `src/servidor/alta-catalogo.ts` | Medio | El flujo de variante no crea modelos paralelos |
| P2 | Detectar modelos casi duplicados y pedir confirmación | `src/servidor/alta-catalogo.ts:462-498`, `src/catalogo/configuracion.ts` | Bajo | «LOS RIOS PREPINTADA ESPECIAL…» pide confirmación |
| P2 | Uniformar permisos de catálogo | `src/app/api/catalogo/route.ts:199-231`, `src/servidor/acceso-autenticado.ts` | Bajo | Eliminar/restaurar exigen admin |
| P3 | Reporte de cobertura de medidas por importación | `src/catalogo/enchapadas.ts:446-467`, `src/servidor/importacion-catalogo.ts` | Bajo | Matriz de anchos por rango de alto; avisa huecos |
| P3 | Reproducir y corregir el ítem huérfano de `b81d6540…` | `src/servidor/servicio.ts`, `src/servidor/almacen.ts` | Medio | Todo ítem está en línea o en incompletos, nunca en ninguno |

### 8.1 Fase A · Recuperación de datos

- **No reimportar** la planilla de enchapadas: las filas importadas están intactas. Reimportar borraría `catalogo_ediciones` (vacía) y exigiría un respaldo; no aporta nada.
- **No editar** las filas importadas: no hay nada que corregir en ellas.
- **Sí eliminar** (papelera) las tres filas manuales de Los Ríos. La papelera guarda el contenido completo y permite restaurarlas; no hay líneas de cotización que las referencien.
- **No tocar** los tres productos manuales de Los Lagos: están usados en cotizaciones emitidas y en sus reemplazos.
- **No inventar** el costo de 0,75 × 2,315. Si la fábrica lo confirma, crear un ítem `ESPECIAL` con ese costo y el margen de prepintadas; si no, usar 0,75 × 2,185 (estándar) o un modelo distinto.
- **Conservar** el ítem `ESPECIAL` de 0,90 × 2,185 de `1afa8c87…`: es un pedido especial legítimo, con costo 51.700 y venta 124.080 (140 %).
- **Conservar** los UUID de las cotizaciones y no emitir los borradores duplicados.

### 8.2 Fase A · Procedimiento de reversión

- La eliminación de los tres manuales es reversible desde **Catálogo → Productos eliminados** (papelera), mientras el código no se ocupe.
- Si se corrige un borrador, el cambio es reversible con «Deshacer» o volviendo a editar; no hay documento emitido.
- Si se despliega código, el rollback es `npm run restaurar` con el respaldo P0 y el redeploy de `.version-anterior/`.
- No borrar `data/antes-de-restaurar-<fecha>/` hasta validar.

### 8.3 Fase B · Corrección de código (detalle por archivo)

| Archivo | Cambio concreto | Validación |
|---|---|---|
| `src/negocio/pendientes.ts` | Añadir `motivo: 'falta_dato' \| 'fuera_de_lista' \| 'especial'` a `Parte`/`PreguntaPendiente`; en `medida_no_disponible` marcar `fuera_de_lista` y no devolverlo como faltante en `faltantesItem`; limitar `prefillAlta` a modelo/madera desconocidos, no a medida fuera de lista | 0,75×2,315 no produce «Falta: alto»; no ofrece alta |
| `src/app/cotizacion-panel.tsx` | Renderizar «Medida fuera de la lista de fábrica» con el rango del ancho; añadir acción «Cotizar como pedido especial» que abra el flujo de ítem libre | El ítem muestra el motivo y la salida correcta |
| `src/app/preguntas-pendientes.tsx` | Ocultar «Agregar al catálogo» cuando `motivo === 'fuera_de_lista'`; mostrar «Pedido especial» y «Revisar medida» | No hay alta de catálogo para medidas fuera de lista |
| `src/app/alta-producto.tsx` | Modo «Modelo nuevo» vs «Agregar medida a modelo existente»; en el segundo, mostrar el modelo/madera y los rangos actuales; pedir `altoMin/Max`; no prellenar `anchoMin = anchoMax`; advertir si la combinación no está en la planilla | El flujo de variante no crea modelos paralelos |
| `src/app/gestion-manuales.tsx` | Añadir `altoMin`/`altoMax` para PUERTA; si existen, explicar que «Alto» es la referencia y no el rango; mostrar diff antes/después y confirmación | Editar el rango cambia el resolver; no queda `largo` incoherente |
| `src/app/api/catalogo/route.ts` | Ampliar el esquema `editar` con `altoMin`/`altoMax` y validar coherencia con `largo`; exigir admin en `eliminar`/`restaurar` | Payload inválido rechazado; permisos uniformes |
| `src/servidor/repositorio-catalogo.ts` | En `editarProducto`, rechazar o actualizar atómicamente `largo` vs `altoMin/Max`; en `rangoSuperpuesto`, comprobar todos los altos y detectar huecos; en `agregarProductoManual`, exigir `confirmadoPorFabrica` para fuera de lista; escribir auditoría en cada mutación | 1,20×2,185 no resuelve a 1,50; 0,60 informa 0,70–0,90; cada cambio deja traza |
| `src/servidor/base-datos.ts` | Migración v30: `catalogo_auditoria (id, fecha, actor, accion, codigo, origen, antes_json, despues_json, detalle)` | La tabla existe y se escribe en alta/edición/baja/importación |
| `src/servidor/servicio.ts` | Añadir `avisoFueraDeLista` en `calcular` cuando el modelo existe y la combinación no; no bloquear la cotización especial | Aviso claro; el ítem especial se puede cotizar |
| `src/catalogo/enchapadas.ts` | Añadir al reporte de importación una matriz de cobertura por modelo, madera y rango de alto | El reporte muestra los huecos (p. ej. 0,75 ausente en 2,21–2,40) |
| `tests/` | Nuevo `catalogo-los-rios.test.ts` con las 8 filas y los casos de §9.1; pruebas de cobertura y de auditoría | Todos los casos pasan |

### 8.4 Fase C · Mejoras UI/UX

1. **Separar «Crear producto» de «Agregar medida a un modelo existente»**; mostrar modelo, madera y rangos actuales antes de pedir datos.
2. **Mostrar el registro que se modifica**: código, modelo, madera, rango de ancho, rango de alto y precio; diff antes/después.
3. **Advertir el alcance**: «Este cambio afecta a las cotizaciones nuevas; las emitidas conservan su copia».
4. **Distinguir «falta dato» de «fuera de lista»**; no usar «Falta: alto» cuando el alto está presente.
5. **Reemplazar «Agregar al catálogo»** por «Cotizar como pedido especial» y «Revisar medida» cuando el modelo existe.
6. **Explicar el hueco comercial**: «Para 0,75 m de ancho, la lista de fábrica llega a 2,20 m; 0,80 × 2,315 m sí existe».
7. **Confirmación explícita** antes de guardar un cambio de medidas o un producto fuera de lista.
8. **Enlace «Ver todas las variantes»** del modelo/madera con su matriz de anchos y altos.

---

## 9. Fase D · Plan de pruebas

### 9.1 Casos unitarios del resolver (Los Ríos)

| Caso | Medida | Resultado esperado |
|---|---|---|
| Estándar exacto | 0,75 × 2,185 | `ok`, `LOSR-PP-075-220`, precio 42.083 + margen |
| Fuera de lista por alto | 0,75 × 2,315 | `medida_no_disponible`, campo `alto`, rango 2,00–2,20 |
| Fuera de lista por alto | 0,85 × 2,315 | `medida_no_disponible` (0,85 no existe en 2,21–2,40) |
| Estándar alto | 0,80 × 2,315 | `ok`, `LOSR-PP-080-240`, precio 52.500 + margen |
| Estándar alto | 0,90 × 2,315 | `ok`, `LOSR-PP-090-240` |
| Bajo el mínimo | 0,60 × 2,00 | `medida_no_disponible`, campo `ancho`, rango 0,70–0,90 (no 1,50) |
| Borde de tramo | 0,75 × 2,20 | `ok`, `LOSR-PP-075-220` |
| Borde de tramo | 0,75 × 2,40 | `medida_no_disponible` |
| Fila manual contaminante | 1,20 × 2,185 con `IA-81C1…` presente | Debe **no** resolver a 1,50 sin marca de pedido especial |
| Fila manual contaminante | 1,50 × 2,185 | Si se conserva como especial, resolver con aviso; si se elimina, no disponible |

### 9.2 Casos de alta/edición

| # | Escenario | Resultado esperado |
|---|---|---|
| 1 | Crear producto nuevo con modelo inexistente | Se crea; código `IA-…`; auditoría con actor |
| 2 | Editar producto importado | Se actualiza; auditoría con antes/después |
| 3 | Agregar medida a un modelo existente | Se agrega la fila; no se crea un modelo paralelo |
| 4 | Crear una fila de 1,50 en un modelo 0,70–0,90 | Se rechaza o se marca `fueraDeLista`; no amplía el rango estándar |
| 5 | Crear una fila con nombre «LOS RIOS PREPINTADA ESPECIAL…» | Pide confirmación de modelo existente |
| 6 | Editar «Alto» de una fila con `altoMin/Max` | O se rechaza, o se actualiza el rango; el resolver usa el nuevo |
| 7 | Eliminar y restaurar un manual | La fila vuelve a la papelera/catálogo; no cambia cotizaciones emitidas |
| 8 | Dos variantes del mismo modelo | Editar una no cambia las demás |
| 9 | Producto fuera de lista | Exige confirmación de fábrica y queda auditado |
| 10 | Importación de la planilla oficial | Reproduce las 8 filas; el reporte muestra cobertura |

### 9.3 Casos de cotización e integridad

| # | Escenario | Resultado esperado |
|---|---|---|
| 11 | Cotización estándar de Los Ríos | Precio y total correctos; líneas con código `LOSR-PP-…` |
| 12 | Cotización de medida especial dentro del siguiente escalón | Se usa la siguiente medida y se avisa; no se inventa producto |
| 13 | Cotización fuera de lista | Ítem pendiente con motivo «fuera de lista»; no suma; ofrece pedido especial |
| 14 | Cotizaciones emitidas antes del incidente | No cambian; conservan líneas y PDF |
| 15 | Borradores después de eliminar los manuales | Se recalculan; 0,60 vuelve a informar 0,70–0,90 |
| 16 | Ítem huérfano de `b81d6540…` | Todo ítem está en línea o en incompletos; nunca en ninguno |
| 17 | Auditoría de catálogo | Cada alta/edición/baja deja actor, antes y después |
| 18 | Respaldo y restauración | Un respaldo del día se puede restaurar en un entorno aislado |

### 9.4 Criterios de aprobación

- Las 8 filas PREPINTADA coinciden exactamente con la planilla oficial.
- No quedan productos manuales de Los Ríos en `productos_adicionales` (salvo que se cree un modelo separado o un ítem especial con marca explícita, nunca bajo el modelo estándar «LOS RIOS»).
- 0,75 × 2,315 ya no muestra «Falta: alto» ni «Agregar al catálogo»; muestra «fuera de lista» y la salida correcta.
- 0,60 × 2,00 informa 0,70–0,90, no 0,70–1,50.
- Ninguna cotización emitida cambia.
- El respaldo diario queda operativo y verificado.
- Todos los tests unitarios/E2E pasan.

---

## 10. Fase E · Plan de despliegue y reversión

### 10.1 Orden seguro

1. **Aprobación humana** de la corrección de datos, del retiro de los manuales y del texto de la salida especial.
2. **Respaldo P0** de la base, WAL, PDF y configuración; verificar `integrity_check` y contar cotizaciones.
3. **Congelar ediciones de catálogo** mientras se corrige; avisar a las usuarias.
4. **Corrección de datos en un entorno aislado**: copiar la base, eliminar los tres manuales, verificar que las 8 filas siguen y que 0,60 vuelve a 0,70–0,90.
5. **Corrección de los borradores**: decidir con la usuaria qué medida usar para 0,75 × 2,315 y 0,60 × 2,00; no inventar precios. Si la fábrica confirma, crear un ítem `ESPECIAL`; si no, ajustar a la medida estándar.
6. **Desarrollo y pruebas del código** (H-01, H-02, H-04, H-06, H-07, H-08, H-09, H-10) en una rama; ejecutar `npm run typecheck`, `npm run lint`, `npm test` y las pruebas nuevas.
7. **Despliegue** con `npm run deploy` (verifica tipos, lint, tests y evaluación de IA); comprobar `/api/salud`.
8. **Verificación funcional en producción**: solo consultas y una prueba controlada en un entorno aislado; no crear cotizaciones reales de prueba.
9. **Monitoreo 48 h**: logs, `/api/salud`, ítems pendientes, errores de catálogo, respaldos.
10. **Rollback** si algo falla: `npm run restaurar` con el respaldo P0; redeploy de `.version-anterior/`; restaurar los manuales desde la papelera si hiciera falta.

### 10.2 Pasos que requieren aprobación humana

- Ejecutar el respaldo y cualquier escritura en producción.
- Enviar a la papelera los tres productos manuales.
- Corregir los borradores y decidir qué medida usar.
- Crear un ítem especial con un costo confirmado por fábrica.
- Desplegar código.
- Instalar el cron de respaldo y la copia externa.

### 10.3 Rollback

- **Datos:** la papelera conserva los manuales; se pueden restaurar si el código sigue libre. El respaldo P0 permite `npm run restaurar`.
- **Código:** `.version-anterior/` conserva la versión previa; `npm run deploy` puede volver a desplegarla.
- **Documentos:** no hay emisiones de Los Ríos; no hay PDF que revertir.
- **No borrar** `data/antes-de-restaurar-<fecha>/` hasta validar.

---

## 11. Riesgos pendientes

| Riesgo | Impacto | Mitigación |
|---|---|---|
| La fábrica sí cotiza 0,75 × 2,21–2,40 y la planilla está incompleta | Se bloquea una venta legítima | Confirmar con fábrica antes de cerrar; si confirma, agregar la fila con precio oficial y auditoría, no como manual |
| El costo de 0,75 × 2,315 no está confirmado | No se puede cotizar el especial | No inventarlo; pedirlo a fábrica; mientras tanto, usar 2,185 estándar o dejar el ítem pendiente |
| `IA-5CBE54E42D` tiene el precio de venta (124.080) como si fuera costo | Sobreprecio 2,4× si se usa | Eliminarla; no reutilizarla |
| `IA-81C1CC812F` contamina el rango del modelo | Cotizar 1,20–1,50 como si fueran estándar | Eliminarla; validar cobertura; prueba de regresión |
| Los cuatro borradores son duplicados | La usuaria puede emitir el equivocado | Elegir uno; archivar los otros; revisar totales |
| No hay respaldo desde el 28-10 | Sin red de seguridad | Instalar cron + copia externa; respaldar antes de tocar datos |
| `catalogo_anterior` vacía | No se puede «volver a la planilla anterior» | Conservar copia por origen; verificar tras cada importación |
| El ítem huérfano de `b81d6540…` | Estado inconsistente del borrador | Reproducir; corregir la reconstrucción atómica de líneas/incompletos |
| Todas las cuentas tienen rol admin | Cualquier cuenta puede editar catálogo | Definir permisos antes de incorporar vendedoras |
| El texto de la captura no coincide literalmente con el código | Diagnóstico de UI impreciso | Confirmar el texto exacto con la usuaria; el código dice «altos o largos», no «alturas» |

---

## 12. Conclusión

- **¿Qué ocurrió?** La usuaria intentó cotizar Los Ríos Prepintada en 0,75 × 2,315 m, una combinación que no está en la lista de fábrica. El cotizador la dejó pendiente correctamente, pero la interfaz la presentó como «Falta: alto» y le ofreció «Agregar al catálogo». Ella creó tres productos manuales para resolverlo; dos con nombres de modelo nuevos y uno bajo «LOS RIOS» con 1,50 × 2,185. Ninguno se usó en una línea valorizada. El que coincide con 0,75 × 2,315 quedó bajo un modelo distinto, por lo que el ítem siguió pendiente. El de 1,50 amplió el rango aparente del modelo estándar a 0,70–1,50.
- **¿Por qué ocurrió?** Por la combinación de un hueco real de la lista de fábrica (0,75 no existe en 2,21–2,40), una UI que confunde «medida fuera de lista» con «dato faltante», un alta que crea productos fuera de lista con un rango de un solo punto y una validación de superposición que no detecta el ensanchamiento del modelo.
- **¿Qué información cambió?** Se crearon tres filas en `productos_adicionales`: `IA-81C1CC812F` (LOS RIOS, 1,50 × 2,185, 51.700), `IA-B5600602A0` (LOS RIOS ESPECIAL…, 0,90 × 2,185, 51.700) y `IA-5CBE54E42D` (LOS RIOS PREPINTADA ESPECIAL…, 0,75 × 2,315, 124.080). No se editaron filas importadas, no se eliminó nada, no se alteraron cotizaciones emitidas.
- **¿Qué tan grave es?** P1: integridad del catálogo y cuatro borradores bloqueados; riesgo latente de cotizar medidas inexistentes o con precio erróneo. No hay corrupción de documentos emitidos ni de totales históricos.
- **¿Qué debemos corregir?** Enviar a la papelera los tres manuales de Los Ríos; verificar las 8 filas importadas; resolver los borradores como medida estándar (2,185) o pedido especial con costo de fábrica; corregir la UI y el alta; validar la cobertura del modelo; agregar auditoría; instalar el respaldo diario.
- **¿Cómo evitaremos que vuelva a suceder?** Con un motivo tipificado «fuera de lista» distinto de «falta dato», sin ofrecer alta de catálogo cuando el modelo existe, con un flujo separado de «agregar medida a un modelo existente», con validación de cobertura completa, con confirmación de fábrica para productos fuera de lista, con auditoría de catálogo y con respaldos verificados.

---

## Anexo A · Consultas de lectura usadas

Todas se ejecutaron dentro del contenedor con `better-sqlite3` en `readonly: true` y `PRAGMA query_only=ON`. No se ejecutó ninguna escritura.

```sql
-- Catálogo importado de Los Ríos
SELECT codigo, modelo, familia, tipo, madera, medida, ancho_min, ancho_max,
       alto_min, alto_max, largo, precio_neto, origen, fila_origen
FROM productos_catalogo
WHERE modelo_normalizado LIKE '%RIOS%' OR modelo LIKE '%RÍOS%'
ORDER BY madera, medida, alto_min;

-- Productos manuales de Los Ríos
SELECT codigo, modelo, familia, tipo, madera, medida, ancho_min, ancho_max,
       alto_min, alto_max, largo, precio_neto, creada, creada_por, actualizada
FROM productos_adicionales
WHERE modelo_normalizado LIKE '%RIOS%' OR modelo LIKE '%RÍOS%'
ORDER BY creada;

-- Modelos parecidos
SELECT DISTINCT modelo, 'catalogo' AS tabla FROM productos_catalogo
WHERE modelo_normalizado LIKE '%RIO%'
UNION ALL
SELECT DISTINCT modelo, 'manual' FROM productos_adicionales
WHERE modelo_normalizado LIKE '%RIO%';

-- Ediciones de filas importadas
SELECT e.codigo, e.fecha, p.modelo, p.madera, p.medida, p.largo
FROM catalogo_ediciones e
LEFT JOIN productos_catalogo p ON p.codigo = e.codigo
ORDER BY e.fecha DESC;

-- Cotizaciones del 5 al 8 de noviembre
SELECT id, orden, numero, estado, creada, actualizada, version_catalogo, creada_por
FROM cotizaciones
WHERE actualizada >= '2026-11-05' AND actualizada < '2026-11-08'
ORDER BY actualizada;

-- Ítems de esas cotizaciones
SELECT c.id, c.estado, s.orden, s.modelo, s.madera, s.ancho, s.alto, s.tipo_medida,
       s.cantidad, s.precio_unitario, s.costo_fabrica, s.fuente, s.item_id,
       i.indice AS incompleto, i.rechazo_json
FROM cotizaciones c
JOIN solicitudes s ON s.cotizacion_id = c.id
LEFT JOIN incompletos i ON i.cotizacion_id = c.id AND i.indice = s.orden
WHERE c.id IN ('db13534c-c5c3-4a51-b8fe-f8fc18a628e9',
               '1afa8c87-475d-4aec-a671-2decd938c90e',
               '355a0ac9-26df-4570-8229-2ecaa9ab79a8',
               'b81d6540-1d20-4754-812b-6d28fa80bce1')
ORDER BY c.creada, s.orden;

-- Líneas valorizadas
SELECT cotizacion_id, orden, codigo, modelo, madera, medida, largo,
       precio_neto, cantidad, precio_unitario, total
FROM cotizacion_lineas
WHERE cotizacion_id IN ('db13534c-c5c3-4a51-b8fe-f8fc18a628e9',
                        '1afa8c87-475d-4aec-a671-2decd938c90e',
                        '355a0ac9-26df-4570-8229-2ecaa9ab79a8',
                        'b81d6540-1d20-4754-812b-6d28fa80bce1')
ORDER BY cotizacion_id, orden;

-- Líneas que usaron productos manuales
SELECT cotizacion_id, orden, codigo, modelo, madera, medida, largo,
       precio_neto, cantidad, precio_unitario, total
FROM cotizacion_lineas
WHERE codigo LIKE 'IA-%'
ORDER BY cotizacion_id, orden;

-- Productos manuales no usados en ninguna línea
SELECT p.codigo, p.modelo, p.madera, p.medida, p.largo, p.precio_neto, p.creada
FROM productos_adicionales p
WHERE p.codigo NOT IN (SELECT DISTINCT codigo FROM cotizacion_lineas)
ORDER BY p.creada;

-- Metadatos del catálogo y orígenes
SELECT * FROM catalogo_meta;
SELECT * FROM catalogo_origenes;

-- Papelera y copia anterior
SELECT tipo, id, eliminada FROM papelera;
SELECT origen, version,
       json_extract(contenido, '$.fecha') AS fecha,
       json_extract(contenido, '$.fuente') AS fuente,
       json_array_length(json_extract(contenido, '$.productos')) AS productos
FROM catalogo_anterior;

-- Eventos del 5 al 7 de noviembre
SELECT id, cotizacion_id, fecha, usuario, tipo, detalle
FROM eventos
WHERE fecha >= '2026-11-05'
ORDER BY fecha;
```

## Anexo B · Evidencia de producción (resumen)

- `PRAGMA user_version` = **29**; `journal_mode` = **wal**.
- `catalogo_meta`: `fecha = 2026-11-07T00:19:00.503Z`, `cantidad_productos = 8872`.
- `catalogo_origenes`: `principal` 8772 productos (2026-10-02), `enchapadas` 94 productos (2026-10-02).
- `catalogo_ediciones`: **0 filas**.
- `catalogo_anterior`: **0 filas**.
- `papelera`: **0 filas**.
- `productos_adicionales`: **6 filas** (3 Los Lagos usados; 3 Los Ríos huérfanos).
- `cotizaciones` con Los Ríos: **4 borradores**, ninguna emitida.
- `lineas_manuales` con `IA-%`: **5 líneas en 4 cotizaciones**, todas de Los Lagos (dos emitidas y dos reemplazadas).
- `respaldos`: 15 carpetas del 2026-10-15 al 2026-10-28; **ninguna de noviembre**.
- `crontab -l` del usuario de despliegue: **SIN_CRONTAB**.
- `/mnt/respaldos/neltume`: **no se encontró**.
- Hashes de producción = hashes locales de `main` en:
  - `src/servidor/repositorio-catalogo.ts`
  - `src/app/gestion-manuales.tsx`
  - `src/negocio/pendientes.ts`
  - `src/catalogo/resolver.ts`
  - `src/catalogo/enchapadas.ts`
  - `src/app/api/catalogo/route.ts`

## Anexo C · Funciones y flujos localizados

| # | Función pedida | Dónde vive | Observación |
|---|---|---|---|
| 1 | Crear un producto desde el catálogo | `ServicioAltaCatalogo.proponerManual` (`src/servidor/alta-catalogo.ts:519-531`), `construir` (`347-373`), `confirmar` (`533-545`); `RepositorioCatalogoSqlite.agregarProductoManual` (`src/servidor/repositorio-catalogo.ts:1037-1102`); `POST /api/catalogo` (`src/app/api/catalogo/route.ts:47-56, 241-261`) | Crea una fila nueva en `productos_adicionales` con código `IA-…`; no crea una variante de un modelo existente |
| 2 | Agregar productos al catálogo desde una cotización | `prefillAlta` (`src/negocio/pendientes.ts:241-257`), botón (`src/app/preguntas-pendientes.tsx:78-82`), `AltaProducto` (`src/app/alta-producto.tsx:89`), `alGuardar` (`preguntas-pendientes.tsx:115-131`), recálculo (`src/servidor/servicio.ts:1178-1200`) | Prellena la medida del ítem pendiente; es el flujo que usó la usuaria |
| 3 | Editar las dimensiones de un producto | `cambiosDe`/`EditorProducto` (`src/app/gestion-manuales.tsx:51-82, 403-490`), `POST /api/catalogo {tipo:'editar'}` (`src/app/api/catalogo/route.ts:59-79, 221`), `editarProducto` (`src/servidor/repositorio-catalogo.ts:717-853`) | Expone `anchoMin/anchoMax/largo`; no expone `altoMin/Max` |
| 4 | Actualizar variantes y terminaciones | `modelo`, `madera`, `medida`, `tipo` en `editarProducto` (`src/servidor/repositorio-catalogo.ts:727-730, 768-770, 802-845`); alias en `src/catalogo/configuracion.ts`; `productosDeModelo` (`repositorio-catalogo.ts:535-552`) | No hay tabla de variantes: cada fila es una variante comercial |
| 5 | Interpretar dimensiones del usuario | `leerMedida` (`src/app/formato.ts:151-168`), `metros` (`src/catalogo/resolver.ts:23-28`), `normalizarMedida` (`src/catalogo/resolver.ts`), `escalon`/`enEscalon` (`src/catalogo/escalones.ts:18-23, 69-74`) | Acepta m, cm, mm, coma o punto; redondea a 1/10.000 m |
| 6 | Validar dimensiones permitidas | `resolverItem` (`src/catalogo/resolver.ts:357-405`), `rangoMedidas`/`errorMedida` (`src/negocio/limites.ts:7, 24-30`), `validar` del alta (`src/servidor/alta-catalogo.ts:322-345`), validación de edición (`src/servidor/repositorio-catalogo.ts:737-767`) | Distingue rango de cordura (0,3–3 m) de rango comercial por fila |
| 7 | Determinar si un producto puede cotizarse | `itemsVigentes` (`src/servidor/items-vigentes.ts:49-167`), `resolverItem` (`src/catalogo/resolver.ts:273-443`), `calcular` (`src/servidor/servicio.ts:241-319`) | Devuelve `ok`, `incompletos` o `personalizado` |
| 8 | Marcar un ítem como incompleto | `itemsVigentes` (`src/servidor/items-vigentes.ts:97-101`), persistencia en `incompletos` (`src/servidor/almacen.ts`), `faltantesItem` (`src/negocio/pendientes.ts:366-370`), UI (`src/app/cotizacion-panel.tsx:818-824`) | `medida_no_disponible` se rotula como «Falta: alto» |
| 9 | Excluir un ítem del total | `calcular` cotiza solo `vigentes.validos` (`src/servidor/servicio.ts:289-295`); `montos.lineas` no incluye `incompletos` | El total parcial se muestra en la UI |
| 10 | Persistir modificaciones | `Almacen.guardar`/`insertarLineas` (`src/servidor/almacen.ts:544-605, 782-826`); tablas `solicitudes`, `cotizacion_lineas`, `incompletos`, `cotizacion_montos` (`src/servidor/base-datos.ts:1050-1104`) | Todo se guarda en una transacción del almacén |

**Flujo A · Ítem pendiente → alta de catálogo → recálculo**

`Acción` (botón «Agregar al catálogo») → `PreguntasPendientes` (`preguntas-pendientes.tsx:78-82`) → `AltaProducto` con `prefillAlta` (`pendientes.ts:241-257`) → `POST /api/catalogo {tipo:'manual'}` → `ServicioAltaCatalogo.proponerManual` → `evaluar` (`alta-catalogo.ts:462-512`) → `POST /api/catalogo {tipo:'confirmar'}` → `agregarProductoManual` (`repositorio-catalogo.ts:1037-1102`) → `INSERT productos_adicionales` → `alGuardar` → `POST /api/accion {tipo:'editar', sin cambios}` → `Servicio.editar` → `calcular` → `itemsVigentes` → `resolverItem` → si la fila coincide, el ítem sale de `incompletos` y suma al total; si no, sigue pendiente.

**Flujo B · Edición de un producto de rango**

`Acción` (Gestionar catálogo → Editar) → `EditorProducto` (`gestion-manuales.tsx:403-490`) → `POST /api/catalogo {tipo:'editar', codigo, cambios}` → `editarProducto` (`repositorio-catalogo.ts:717-853`) → valida duplicado/superposición → `UPDATE productos_catalogo` o `productos_adicionales` → `catalogo_ediciones` (solo código y fecha) → `tocarMetadata` → la próxima cotización recalcula con el nuevo valor. Para las filas de rango, el campo «Alto» actualiza `largo`, pero el resolver sigue usando `altoMin/Max`; por eso una edición de «Alto» no cambia el rango efectivo.

**Flujo C · Cotización de una medida fuera de lista**

`Acción` (agregar 0,75 × 2,315) → panel/chat → `POST /api/accion {tipo:'editar'}` → `Servicio.editar` → `calcular` → `itemsVigentes` → `resolverItem` → `porEscalon` no encuentra altura y devuelve `medida_no_disponible` con `rango` → `incompletos` → UI muestra «Incompleto · no suma al total» y «Falta: alto» (incorrecto) → ofrece «Agregar al catálogo» (incorrecto) → el ítem no suma al total. La salida correcta es «fuera de lista» + pedido especial.

---

**Fin del informe.** No se modificó producción. Las acciones de la sección 8 quedan pendientes de autorización expresa.
