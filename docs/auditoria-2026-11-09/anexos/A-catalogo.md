> **Anexo de la auditoría del 9–10 nov 2026.** Informe especializado tal como se entregó. Donde `../01_AUDITORIA_COMPLETA.md` §5.2 lo corrige (por ejemplo, los permisos de la vendedora: en producción todas las cuentas son administradoras), manda el informe consolidado. Las rutas `scratchpad/…` remiten a la evidencia de la sesión de auditoría, que no se guarda en el repositorio.

# Auditoría del catálogo y las familias: cómo funciona y propuesta de rediseño

**Fecha:** 2026-11-09 · **Rama:** `main` (a641645) · **Modo:** solo lectura. No se modificó el repositorio, `data/` ni `datos-privados/`.
**Alcance:** modelo de datos del catálogo, importación, alta, edición y búsqueda, precio, ciclo de vida y su relación con las cotizaciones, la nota de pedido y la integración con la fábrica.
**Pruebas ejecutadas:** tres scripts en `scratchpad/catalogo/` (ver Anexo A), que importan las funciones reales con `npx tsx`. Corrieron contra una **copia** de `data/cotizador.sqlite`, borrada al terminar, y contra `datos-privados/COTIZADOR_2026.xlsx`, que solo se leyó. La salida completa está en `scratchpad/catalogo/salida-pruebas.txt`.

Leyenda de confianza: **confirmado** = lo ejecuté o lo leí tal cual en el código · **probable** = lo deduje del código o de los datos sin reproducirlo de punta a punta · **hipótesis** = falta verificarlo.

---

## 0. Resumen para la clienta (en una página)

El sistema no tiene «puertas» ni «modelos» como fichas. **Cada combinación de modelo × madera × ancho × alto es una fila suelta** con su propio precio. En esta base hay **8.866 filas para 39 modelos**. Un modelo típico como Ranco son **252 filas** (4 maderas × 9 anchos × 7 altos). Las palabras «familia», «modelo», «tipo», «medida», «especial» y «precio base» significan cosas distintas según la pantalla. Por eso confunde.

Lo más grave:

1. **Crear una puerta nueva significa llenar un formulario por cada fila.** Una puerta como Ranco son 252 formularios. No hay «duplicar» ni plantilla, y el formulario se vacía después de cada alta. *Una trabajadora nueva no puede crear correctamente una puerta nueva sin ayuda* (las barreras están en §3.1).
2. **El alta muestra un precio de venta que no es el que se cotiza.** Para calcularlo usa el ajuste general (+50 % en esta base), pero la cotización usa el margen de cada categoría. Una puerta de pino oregón con costo $100.000 se anuncia a $150.000 y se cotiza a $185.000. Una de cedro se anuncia a $150.000 y se cotiza a $125.000 (**confirmado**).
3. **El margen depende de palabras escritas a mano.** Si el «Tipo» o el nombre del modelo dice «prepintada» o «enchapada», la puerta cambia de categoría de margen sin aviso: una puerta de oregón pasa de 85 % a 140 % (**confirmado**).
4. **Hay dos buscadores que no se ponen de acuerdo.** El asistente entiende «ranko», «willow», «coscos», «molcos» y «0,82». La búsqueda de *Catálogo → Consultar* y de *Agregar producto* devuelve **0 resultados** para todas esas, y también para «puertas», «moldura», «prepintado» y «marco 4x2» (**confirmado**).
5. **La vendedora puede crear productos, pero no corregirlos ni borrarlos.** Desde un pendiente, el botón «Agregar al catálogo» o «Es un modelo nuevo» crea con un clic filas permanentes que comparte todo el equipo. Así pasó el incidente de Los Ríos del 6 de noviembre: tres filas manuales, una con el **precio de venta escrito como costo** (124.080 = 51.700 × 2,4, el margen de prepintada). Esa relación es **probable**, deducida de las cifras.

La propuesta (§6) mantiene intacto lo que usan la nota de pedido, el PDF y la fábrica: las filas, los códigos y la `familia` interna. Encima agrega una capa para personas:

- **Tipo de producto → Modelo → tabla de precios por madera** (grilla de anchos × altos).
- **Duplicar un modelo** y **agregar una madera copiando otra**.
- **Categoría de precio explícita** por modelo y madera.
- **Una sola puerta de entrada para «no está en el catálogo»**: un *producto especial solo para esta cotización*.
- **Un solo buscador** que usa los mismos alias y la misma tolerancia que el asistente.

---

## 1. Cómo funciona realmente (reconstrucción con evidencia)

### 1.1 Las piezas del modelo de datos

| Concepto | Qué es en el código | Evidencia |
|---|---|---|
| **Producto (fila)** | La única entidad real. Lleva `codigo, modelo, familia, tipo, madera, medida, anchoMin/Max, altoMin/Max, largo, precioNeto, descripcion, filaOrigen`. **Una fila = un modelo en una madera, un tramo de ancho y un alto.** | `src/catalogo/tipos.ts:12-28` |
| **Modelo** | **No es una entidad**: es un texto que agrupa filas. Se agrupa por `modelo_normalizado` y no tiene tabla propia ni ficha, foto, estado ni atributos. | `src/servidor/repositorio-catalogo.ts:539-555` (`productosDeModelo`), `:437-452` (`modelos()` = `GROUP BY modelo`) |
| **Familia** | Uno de 4 valores fijos: `PUERTA`, `MARCO`, `PIEZAS_T` y `MOLDURA`. Más `OTRO` solo para ítems libres, que el catálogo nunca produce. Se ve como «Puerta / Marco / Piezas T / Moldura». | `tipos.ts:6,11`; `src/catalogo/familias.ts:4-9` |
| **De dónde sale la familia** | Al importar la planilla principal, la familia **se deduce del nombre del modelo**: si el modelo está en `familiasPorModelo` (MARCO, PIEZAS T, ENDOLADO, GUARDAPOLVO, PILASTRA), toma esa familia; **cualquier otro nombre es `PUERTA`**. | `src/catalogo/importar.ts:85-90,110`; `config/catalogo.json` → `familiasPorModelo` |
| **Subfamilia** | No existe como concepto. En la práctica, el campo libre **`tipo`** hace de subfamilia: «PUERTA PANEL», «PUERTA BLOQUE», «PUERTA ESPECIAL» (= anchos de 1,10 a 1,45 m), «PUERTA PREPINTADA», «PUERTA ENCHAPADA», «SET DE MARCO DESNUDO/ENCHAPADO». | consulta SQL de solo lectura (§1.2); `src/catalogo/enchapadas.ts` (`tipo: 'PUERTA PREPINTADA'…`) |
| **Madera** | Lista global en la configuración: `nombre`, **`codigo`** (letra con la que se arma el código del producto: O, L, M, R, PP, EM, PF, FE) y `alias`. Las «terminaciones» (prepintada, enchapada, finger) también son maderas. | `src/catalogo/configuracion.ts:49-53,84-130`; `config/catalogo.json` |
| **Variante** | No existe como concepto. La «variante» es la fila: madera × medida. Solo el mapa que se le pasa a la IA las agrupa (`variantes`), y únicamente para accesorios. | `src/catalogo/mapa.ts:16-21,54-71` |
| **Código del producto** | En la planilla principal: `ABREV-MADERA-ANCHO#-LETRA DE ALTO` («RAN-O-3-B»). En la planilla de enchapadas: `HUIL-PP-070-220`. En un alta manual: **`IA-` + 10 caracteres hexadecimales al azar**, se haga a mano o con IA. | `importar.ts:91-98`; `enchapadas.ts:251`; `src/servidor/alta-catalogo.ts:358` |
| **Origen** | `principal`, `enchapadas` o manual (`productos_adicionales`). Importar una planilla **reemplaza solo su origen** y no toca los manuales. | `src/catalogo/origenes.ts:1-10`; `repositorio-catalogo.ts:249-366` |

**Herencia de características: no hay.** Cada fila repite todos sus datos. Lo que se comparte «por arriba» vive en otros lugares y se aplica por nombre:

- **Alias de modelo** (por ejemplo, Huilo Huilo ← willow y huilo; Coz Coz ← coscos): en la configuración, por nombre de modelo. `configuracion.ts:138-156`.
- **Alias de madera**: globales, no por modelo. `configuracion.ts:124-130`.
- **Madera equivalente** codificada en el programa: un marco en «MARA ENCHAPADA» se cotiza como «PINO FINGER ENCHAPADO MARA». `configuracion.ts:36-38`; `resolver.ts:249-254`.
- **Familia por modelo**: solo actúa al **importar**. Ver hallazgo H5.
- **Categoría de margen**: se **deduce del texto** (modelo, tipo, madera y descripción) con expresiones regulares. `src/negocio/precios.ts:312-338`.
- **Dónde trabaja cada modelo**: no existe por modelo; la fábrica se elige ítem por ítem en la cotización. `tipos.ts:77-81`.

**Medidas y espesores:**

- **Puertas:** el ancho es un tramo (`anchoMin`–`anchoMax`, por ejemplo 0,80–0,85) y el alto es exacto (`largo`) o un rango (`altoMin`–`altoMax`, como en las enchapadas, 2,00–2,20).
- **Accesorios:** la `medida` es la escuadría, en tres sistemas de unidades: «2X4» en pulgadas para marcos y piezas T, «12X1» en centímetros para molduras y «30X70» en milímetros para los marcos finger. El largo va en metros. `escalones.ts:43-68`.
- **Espesor:** no existe como campo en ninguna familia. El incidente de Los Ríos lo terminó escribiendo en el nombre del modelo: «LOS RIOS ESPECIAL (40 MM ESPESOR)» (`AUDITORIA_INCIDENTE_LOS_RIOS.md`, tabla de productos manuales).

### 1.2 Los datos reales (copia de solo lectura de `data/cotizador.sqlite`)

| Origen | Familia | Filas | Modelos |
|---|---|---:|---:|
| principal | PUERTA | 8.316 | 33 |
| principal | MOLDURA | 216 | 3 |
| principal | MARCO | 128 | 1 («MARCO») |
| principal | PIEZAS_T | 112 | 1 («PIEZAS T») |
| enchapadas | PUERTA | 82 | 5 |
| enchapadas | MARCO | 12 | 1 |
| manual | — | 0 en esta copia. **En producción había 6** (3 de Los Lagos usados en cotizaciones emitidas; 3 de Los Ríos, ya en la papelera). | |

- Un modelo de puerta estándar = **252 filas**: 4 maderas × 9 tramos de ancho (5 «PANEL/BLOQUE» de 0,60 a 1,05 y 4 «ESPECIAL» de 1,10 a 1,45) × 7 altos (2,0 a 2,6).
- En los accesorios, **la familia y el modelo son la misma palabra**: familia Marco y modelo «MARCO»; familia Piezas T y modelo «PIEZAS T». En las puertas no: familia Puerta y modelo «Ranco». Esta doble lectura es una fuente de confusión.

### 1.3 Cómo se calcula el precio

1. **`precioNeto` es el costo de fábrica neto**, no el precio de venta. La planilla de enchapadas lo dice («solo se leen… medida y costo neto de fábrica», `enchapadas.ts:1-4`). En el alta se llama «Precio base sin IVA» y la ayuda aclara «Costo de fábrica, sin la ganancia de venta» (`alta-producto.tsx:478-481`).
2. **Precio unitario** = `round(costo × (1 + margen))`. El margen se toma, en este orden de prioridad: margen escrito en la línea > margen especial de la cotización > margen de la categoría. Un precio unitario escrito a mano reemplaza todo eso. `precios.ts:21-22,231-247`.
3. **Categorías de margen** (11, configurables en Ajustes): por ejemplo, oregón 85 %, mara/lenga 55 %, prepintada 140 %, enchapada en mara 75 % y «otros» 25 %. La categoría se decide **leyendo el texto** de `modelo + tipo + madera + descripción`. `precios.ts:59-73,312-352`. En esta base: `ajuste` = 0,5; márgenes iguales a los iniciales (salida del script).
4. **Escalones** (`resolver.ts:119-161`):
   - una medida dentro de un tramo usa ese tramo;
   - una medida en el hueco entre dos tramos usa el siguiente hacia arriba;
   - **sobre la medida mayor no hay precio**: el ítem queda pendiente y se puede cotizar como especial (confirmado: Ranco de 1,50 m → `medida_no_disponible`);
   - una puerta hasta 5 cm más chica que la menor del catálogo usa la menor (`REBAJE_PUERTA`);
   - un marco más corto que el set menor usa ese set;
   - marcos y piezas T de menos de 3 m van como kit y desde 3 m como pieza lineal (`escalones.ts:24-31`).
5. **Después del precio unitario:** descuento especial del ítem, descuento general (el escrito o el del tramo por cantidad de puertas; solo cuentan las de familia PUERTA), flete y finalmente IVA (`precios.ts:5-14`).
6. **Pedido especial y producto personalizado:** el precio unitario lo escribe la persona; el costo de fábrica es opcional y, si falta, la línea va «Por definir» en la nota de pedido. `tipos.ts:50-51,63-72`; `personalizados.ts:4-7`.

---

## 2. Ciclo de vida: editar, eliminar, importar y su efecto en las cotizaciones

| Acción | Qué pasa | Evidencia |
|---|---|---|
| **Editar un producto manual** | Solo administración: la API rechaza `editar` a quien no es admin, con un mensaje que habla de «productos importados» aunque sea manual. Cada fila se edita por separado. **La descripción no se regenera** al cambiar medidas o madera. | `api/catalogo/route.ts:201-211`; `repositorio-catalogo.ts:742-900` (`:809`) |
| **Editar un producto de planilla** | Se permite (solo administración). Queda en `catalogo_ediciones` y **se pierde en la próxima importación** de esa planilla; la vista previa lo avisa. | `repositorio-catalogo.ts:306-309`; `gestion-manuales.tsx:484-487`; `importar-catalogo.tsx:351-357` |
| **Eliminar** | Solo los productos manuales, y van a la papelera, desde donde se pueden restaurar. **Un producto de planilla no se puede eliminar ni ocultar.** | `repositorio-catalogo.ts:729-740,1068-1081` |
| **Renombrar un modelo o cambiar su familia** | No existe como acción. Hay que editar fila por fila: 252 ediciones para un modelo, y las filas de planilla vuelven al nombre original al reimportar. | ausencia en `route.ts:59-81` |
| **Importar una planilla** | Reemplaza todas las filas de su origen en una transacción. Exige `forzar` si quedan muchos menos productos, guarda una copia para «volver a la planilla anterior» y **no toca los productos manuales** (falla si alguno choca por código o atributos). | `repositorio-catalogo.ts:249-366` |
| **Cotizaciones guardadas** | Cada línea guarda una **copia completa** del producto (`cotizacion_lineas`: código, modelo, madera, medida, costo, margen, precio y descripción). La nota de pedido también (`nota_lineas`). | esquema SQLite (§1.2) |
| **…pero los borradores y las emitidas se recalculan** | El ítem guarda **modelo, madera y medidas, no el código** (`servicio.ts:896-904`). Al editar cualquier cosa, `recalcular` vuelve a resolverlo contra el **catálogo vigente** (`servicio.ts:326-334`) y avisa si cambió el precio (`:603-620`, arreglo de BUG-012). Una cotización **emitida sigue siendo editable** (`:357-358`). Las aprobadas, reemplazadas y anuladas quedan fijas. | |
| **Consecuencia de renombrar o borrar** | Un borrador que usaba un producto manual borrado o un modelo renombrado **queda pendiente** al recalcular: «modelo desconocido». Lo dice el comentario de `eliminarManual` (`repositorio-catalogo.ts:1067`). | |
| **Integración con la fábrica** | Envía `productCode`, `family` (enum de las 4 familias), `model` y `wood` (`integracion-pedido.ts:51-56`). Un código `IA-…` llega a la fábrica como ítem «a pedido» para revisión manual (`docs/integracion-fabrica.md:331`). **Cambiar la `familia` interna o los códigos de planilla rompe el contrato.** | |

---

## 3. Recorridos de uso, paso a paso

Pasos contados desde la pantalla de inicio de la persona con rol de vendedora, salvo que se indique otra cosa.

### 3.1 Crear una puerta nueva (modelo nuevo, por ejemplo «Roble» en 4 maderas)

- **Dónde empieza:** *Catálogo → Agregar producto* (visible para todos, `pantalla-catalogo.tsx:30`).
- **Pasos por fila:**
  1. Elegir la familia.
  2. Escribir el modelo, la madera y el tipo (opcional).
  3. Escribir el ancho mínimo, el ancho máximo y el alto.
  4. Escribir el «precio base sin IVA».
  5. Pulsar **Revisar propuesta**.
  6. Pulsar **Confirmar y guardar**.
  7. Confirmar en el diálogo.
  8. Pulsar **Agregar otro producto**, que **vacía todo el formulario** (`alta-producto.tsx:317`).

  Son ~10 acciones y 8 campos por fila. **Un modelo como los existentes = 252 filas ≈ 2.500 acciones.** Con 4 maderas y solo los 5 anchos estándar a 2,0/2,1 m serían 40 filas.
- **Términos técnicos a la vista:** Familia, Modelo, Tipo, Medida o escuadría, Ancho mínimo/máximo, Alto/Largo, Precio base sin IVA, Código interno asignado (`IA-…`), «Piezas T», «escuadría: grosor por ancho».
- **Decisiones sin guía:**
  - qué familia elegir;
  - si «Tipo» importa (sí: cambia el margen, H3);
  - qué tramos de ancho usar (deben ser contiguos; el sistema rechaza los que dejan un hueco de más de 25 cm, `repositorio-catalogo.ts:604-628`);
  - qué escribir como precio: el costo, no el precio de venta.
- **Errores posibles:**
  - escribir el precio de venta en lugar del costo (el incidente de Los Ríos);
  - un nombre de modelo con un error de tipeo, que crea otro modelo;
  - tramos que se cruzan, que el sistema rechaza;
  - meter un atributo en el nombre («40 MM ESPESOR»);
  - no poder cargar un rango de alto: el alta no tiene `altoMin/altoMax` (`alta-catalogo.ts:17-35,347-373`).
- **Deshacer:** la vendedora **no puede**. Editar y Gestionar son solo de administración (`route.ts:201-211`; `pantalla-catalogo.tsx:30`). La administradora puede mandar el producto a la papelera, fila por fila.
- **Lo que la persona ve:** una vista previa con el «Unitario en cotizaciones (+50 %)», que **no es el precio real** (H2). Si el precio está a más de 3 veces de la mediana del modelo o la familia, aparece un aviso (`alta-catalogo.ts:499-506`).
- **Veredicto: no.** Una trabajadora nueva no puede crear correctamente una puerta nueva sin ayuda. Barreras:
  1. Tendría que repetir el formulario por cada combinación.
  2. No hay plantilla ni duplicar.
  3. El formulario se vacía después de cada alta.
  4. «Precio base» se confunde con el precio de venta.
  5. El precio de venta que muestra la vista previa es falso.
  6. «Tipo» libre cambia el margen sin decirlo.
  7. No sabe qué tramos de ancho usa la fábrica.
  8. No puede cargar rangos de alto ni espesor.
  9. No puede corregir lo que guardó.
  10. El código `IA-…` no le dice nada, y la fábrica tampoco lo reconoce.
  11. No existe documentación del concepto (H15).

### 3.2 Agregar una madera o una medida a un modelo existente

Es el mismo alta, con una fila por cada tramo y alto. Para sumar «Raulí» a Ranco serían 63 filas. No se puede copiar la grilla de otra madera. Una medida suelta fuera de la lista (por ejemplo, 1,50 cuando el máximo es 1,45) se rechaza si deja un hueco de más de 25 cm, y el mensaje sugiere el pedido especial (`repositorio-catalogo.ts:871-875`). Es correcto, pero exige entender la idea de «escalón».

### 3.3 Fijar o cambiar un precio

- **En el catálogo:** *Gestionar catálogo* (solo administración) → buscar → **Editar** → «Precio base sin IVA», una fila a la vez. No hay ajuste masivo («subir 5 % a Ranco»). En la planilla, el cambio se pierde al reimportar.
- **En la cotización:** precio unitario o margen de la línea, o margen especial de la cotización. Lleva otros nombres y es otra pantalla.

### 3.4 Editar un producto

Diálogo con 12 campos (`gestion-manuales.tsx:482-537`):

- La familia, el modelo y la madera se pueden cambiar en una sola fila, **sin revisar que el modelo siga teniendo una sola familia** (H9).
- «Medida (texto)» y «Ancho mínimo/máximo» son dos fuentes del mismo dato que pueden no coincidir.
- La «Descripción» dice ser «el texto que aparece en la cotización y el PDF», pero en las líneas con medidas pedidas el PDF la **arma de nuevo** a partir de los campos (`precios.ts:151-158`). Es probable que casi nunca se vea (H8).
- Deshacer: no hay historial de cambios por producto, solo la marca «editado a mano».

### 3.5 Duplicar un producto o un modelo

**No existe.** Ningún componente ni ruta lo ofrece (`grep duplicar` vacío en `gestion-manuales.tsx`, `alta-producto.tsx`, `catalogo-consulta.tsx` y `repositorio-catalogo.ts`).

### 3.6 Buscar un producto

*Catálogo → Consultar*, o el diálogo *Agregar producto* de la cotización. Hay un cuadro de texto y un filtro de familia (Consultar), pero no hay filtros de madera ni de medida. La lista es plana, una fila por producto: «Ranco» devuelve 252. En el diálogo de la cotización se muestran **solo los primeros 24** (`agregar-producto.tsx:124-133`). Detalle en §4.

### 3.7 Agregar un producto a una cotización

*Agregar producto* → buscar → elegir **una fila exacta** → escribir cantidad, ancho y alto (deben caer dentro del tramo de esa fila; si no, «Este producto se cotiza con un ancho entre…», `agregar-producto.tsx:196-220`) → **Agregar**. La alternativa es escribirlo en el chat, que resuelve modelo, madera y medida sola y es más tolerante. La persona tiene que entender que la fila elegida ya fija madera, tramo y alto: si quiere otro alto, vuelve a buscar.

### 3.8 Cotizar algo que no está en el catálogo

Hay **cinco caminos** con nombres distintos:

| Camino | Dónde | Qué crea | Va a fábrica | Precio que se escribe |
|---|---|---|---|---|
| **Producto personalizado** | *Agregar producto → Crear producto personalizado* | Ítem solo en esta cotización, código `ESPECIAL`; el selector se llama «**Tipo de producto**» | Sí | «Precio unitario sin IVA» = **precio de venta** |
| **Ítem libre** | Lo mismo, con «Otro (ítem libre, no va a fábrica)» | Código `OTRO` | No | Precio de venta |
| **Cotizar como especial** | Pregunta pendiente en el panel | Lo mismo que «personalizado» | Sí | «Precio sin IVA para cotizar como especial» |
| **Cotizar como ítem libre** | Pregunta pendiente | Ítem libre | No | Precio de venta |
| **Agregar al catálogo / Es un modelo nuevo** | Pregunta pendiente (`preguntas-pendientes.tsx:78-81`), cuando falta modelo o madera (`pendientes.ts:260-283`) | **Filas permanentes del catálogo**, visibles para todos | Sí, con código `IA-…` | «Precio base sin IVA» = **costo** |

`agregar-producto.tsx:152-160,307-308,475`; `cotizacion-panel.tsx:837-876`; `personalizados.ts:4-7`.

Los dos campos de precio se ven casi iguales («… sin IVA») y significan cosas opuestas: venta en un caso, costo en el otro.

---

## 4. La búsqueda, con pruebas reales

**Cómo busca** *Consultar*, *Agregar producto* y *Gestionar* (`src/servidor/busqueda.ts:3-50`; `route.ts:111-149`; `repositorio-catalogo.ts:688-727`):

- quita tildes y mayúsculas;
- divide en palabras, y **todas** tienen que aparecer como fragmento en el texto `codigo + modelo + madera + tipo + medida + descripcion`;
- los números se comparan enteros, y un entero entre 30 y 400 se lee también en centímetros («80» busca «0,8»);
- **no** usa alias, tolerancia a errores, plurales, el nombre de la familia ni medidas dentro de un tramo.

**Cómo resuelve el asistente** (`resolverItem`, `resolver.ts:273-443`; `configuracion.ts:341-451`): usa alias seguros y dudosos, una clave tolerante (letras dobles, palabras repetidas), plurales, una distancia de 1 letra (para sugerir, no para reemplazar), escuadrías en cualquier orden y escalones.

**Resultados reales** (8.866 productos; `scratchpad/catalogo/salida-pruebas.txt`):

| Consulta | Consultar / Agregar | Asistente (`resolverItem` / `modeloDelCatalogo`) |
|---|---:|---|
| `ranco` / `Ranco` | 252 | RANCO, canónico |
| `Ranco pino oregon` / `ranco pino oregón` / `ranco oregon` | 63 | RAN-O-3-B (con 0,80 × 2,10) |
| `pino oregón 1 metro` | **0** (la palabra «metro» no aparece) | — |
| `pino oregon 1 m` | 480 (36 modelos) | — |
| `puerta de 100` | **0** (la palabra «de» no aparece) | — |
| `puerta 100` | 1.848 (34 modelos) | — |
| `ranco 100` | 56 | Ranco, 1,00 × 2,10 → RAN-O-5-B |
| `ranko` | **0** | sugiere RANCO («¿Te refieres a…?») |
| `oregon` / `oregón` / `rauli` / `raulí` | 2.193 cada una | alias OK |
| `pino` | 2.205 (oregón + finger) | alias → PINO OREGON |
| `willow` | **0** | Huilo Huilo (alias) |
| `huilo` / `huilo huilo` | 268 | OK |
| `coscos` | **0** | Coz Coz (alias) |
| `pangipulli` | **0** | Panguipulli (alias) |
| `punir` / `rinihue` | 252 / 252 | OK |
| `ancacomo` | 0 | sugiere ANCACOMOE |
| `enchapada` | 40 | — |
| `enchapado` | **4** (solo marcos finger) | alias de MARA ENCHAPADA |
| `prepintada` / `prepintado` | 42 / **0** | alias OK |
| `puertas` / `moldura` | **0** / **0** | la familia no se busca |
| `ranco 80` / `ranco 0,80` | 28 | — |
| `ranco 82` / `ranco 0,82` | **0** | 0,82 → tramo 0,80–0,85 (RAN-O-3-B) |
| `ranco 80 210` | 4 | — |
| `ranco 85x210` | **0** | — |
| `marco 2x4` / `marco 4x2` | 32 / **0** | 4x2 → MAR-O-2X4-B |
| `guarda polvo` | 72 | — |
| `puerta especial` | 3.696 (las de 1,10 m o más; no tiene nada que ver con el «pedido especial») | — |
| `RAN-O-3-A` / `ran-o-3` | 28 | — |
| Asistente: `molcos`, `tolteen`, `calafquén` | — | Molco, Tolten y Calafquen, por alias o tolerancia |
| Asistente: `oregn`, `roble` | — | `madera_desconocida` |
| Asistente: `ranco` + `enchapada` | — | `madera_no_disponible` |

---

## 5. Hallazgos

### H1. No hay ficha de modelo: crear o ampliar una puerta exige una fila por combinación, sin plantilla ni duplicar

- **Severidad:** Alta · **Prioridad:** P1 · **Categoría:** Modelo de datos / UX
- **Archivo y líneas:** `src/catalogo/tipos.ts:12-28`; `src/servidor/repositorio-catalogo.ts:437-452,539-555,1083-1153`; `src/servidor/alta-catalogo.ts:347-373`; `src/app/alta-producto.tsx:305-324` (`reiniciar` → `setCampos(VACIO)`, `:317`)
- **Evidencia:** SQL: 252 filas por modelo estándar (4 maderas × 9 tramos × 7 altos). El alta crea un solo `Producto` por confirmación. Tras guardar, «Agregar otro producto» vacía modelo, madera y familia. No hay acción de duplicar en la API (`route.ts:38-94`) ni en la interfaz.
- **Por qué importa (clienta):** sumar un modelo nuevo de la fábrica es, en la práctica, imposible desde la aplicación: hay que pedir que lo agreguen a la planilla Excel e importarla. Por eso «el catálogo» se siente como algo que no controla.
- **Arreglo recomendado:** ficha de **Modelo** con una **grilla de precios** (anchos × altos por madera); «Duplicar modelo»; «Agregar madera copiando otra»; carga pegando desde Excel (§6).
- **Causa raíz:** el esquema reproduce la hoja «Precio» de la planilla (una fila por SKU) y la aplicación solo agregó un formulario por fila.
- **Observado vs esperado:** 252 formularios / 1 formulario más una grilla.
- **Pruebas requeridas:** e2e que crea un modelo duplicando Ranco y lo cotiza; unitarias de generación de filas desde la grilla, sin solapes ni huecos.
- **Esfuerzo:** L · **Confianza:** confirmado

### H2. La vista previa del alta muestra un precio de venta que no es el que se cotiza

- **Severidad:** Alta · **Prioridad:** P0 · **Categoría:** Precio / UX
- **Archivo y líneas:** `src/app/alta-producto.tsx:90,127-128,142-147,274-281,378-379,520-522` (usa `reglas.ajuste`); el cálculo real está en `src/negocio/precios.ts:233,243,345-352` (margen de la categoría)
- **Evidencia (script, base real con `ajuste=0,5`):**

  | Costo $100.000 | El alta muestra | La cotización usa |
  |---|---:|---:|
  | Puerta pino oregón | 150.000 | **185.000** |
  | Puerta prepintada | 150.000 | **240.000** |
  | Puerta cedro | 150.000 | **125.000** |
  | Marco finger | 150.000 | **200.000** |
  | Moldura raulí | 150.000 | **125.000** |

  El texto dice «las cotizaciones le suman 50 % automáticamente, igual que a los productos de la planilla» (`:378-379`), y eso es falso para casi todo.
- **Por qué importa (clienta):** confirma un producto creyendo que se venderá a un precio, y la cotización sale a otro (hasta +60 % o −17 %). Esto alimenta la confusión entre costo y venta. En el incidente de Los Ríos se escribió **124.080 como costo de un ítem cuyo costo era 51.700** (124.080 / 51.700 = 2,4 = 1 + 140 %): casi seguro se escribió el precio de venta en el campo de costo.
- **Arreglo recomendado:** calcular la vista previa con `margenProducto(propuesta, reglas)` en el servidor y devolverla en la propuesta; mostrar «Categoría de precio: Puertas sólidas oregón · 85 % → $185.000»; quitar «+ ajuste». A corto plazo, dejar que se escriba el precio de venta y que el sistema calcule el costo.
- **Causa raíz:** la pantalla quedó de cuando había un ajuste único (antes de los márgenes por categoría).
- **Observado vs esperado:** 150.000 / 185.000.
- **Pruebas requeridas:** unitaria por cada categoría, comparando vista previa y `cotizar()`; e2e que da de alta y agrega a una cotización y compara las cifras.
- **Esfuerzo:** S · **Confianza:** confirmado (la relación 2,4 del incidente es probable)

### H3. La categoría de margen depende de palabras escritas a mano (modelo, tipo, descripción)

- **Severidad:** Alta · **Prioridad:** P1 · **Categoría:** Precio / Modelo de datos
- **Archivo y líneas:** `src/negocio/precios.ts:312-338` (`contexto = modelo + tipo + madera + descripcion`)
- **Evidencia (script):**
  - PUERTA, oregón, tipo vacío → `puertas_solidas_oregon`, $185.000;
  - la misma con tipo «PUERTA PREPINTADA» → `puertas_prepintadas`, **$240.000**;
  - modelo «ROBLE ENCHAPADA» en lenga → `otros`, **$125.000**;
  - una madera nueva («CEDRO», «ROBLE») → `otros`, 25 %.
- **Por qué importa (clienta):** escribir «enchapada» en el nombre o en el tipo cambia el margen sin avisar, y una madera nueva se vende con el 25 % de «otros».
- **Arreglo recomendado:** campo **«Categoría de precio»** explícito por modelo y madera (o por fila), propuesto por la regla actual pero **visible y editable**; la regla de texto queda solo como sugerencia y para datos antiguos.
- **Causa raíz:** las categorías se agregaron sin un campo propio en el producto.
- **Observado vs esperado:** el margen cambia según el texto / el margen se elige y se muestra.
- **Pruebas requeridas:** unitarias de migración (la categoría derivada de los 8.866 productos coincide con la actual); e2e: cambiar el tipo no cambia el precio.
- **Esfuerzo:** M · **Confianza:** confirmado

### H4. Dos buscadores con reglas distintas: Consultar y Agregar producto no entienden lo que entiende el asistente

- **Severidad:** Alta · **Prioridad:** P1 · **Categoría:** Búsqueda
- **Archivo y líneas:** `src/servidor/busqueda.ts:24-50`; `src/app/api/catalogo/route.ts:118-126`; `src/servidor/repositorio-catalogo.ts:712-727`; `src/app/agregar-producto.tsx:124-133` (límite de 24)
- **Evidencia:** tabla de §4. Devuelven 0 resultados: «ranko», «willow», «coscos», «pangipulli», «prepintado», «puertas», «moldura», «marco 4x2», «ranco 0,82», «ranco 85x210», «pino oregón 1 metro», «puerta de 100». Una búsqueda útil como «ranco» trae 252 filas planas, de las que el diálogo muestra 24.
- **Por qué importa (clienta):** la vendedora busca como habla el cliente y «no aparece», aunque el chat lo entiende. Termina creando un producto nuevo o un especial que no hacía falta.
- **Arreglo recomendado:**
  - pasar cada palabra por los resolutores de modelo y madera (alias, tolerancia, plural, sugerencia a 1 letra) antes de filtrar;
  - ignorar palabras vacías («de», «metro», «m», «puerta»/«puertas» como filtro de familia);
  - leer «0,82» y «85x210» como medida → tramo;
  - **agrupar los resultados por modelo** («Ranco · 4 maderas · 0,60–1,45 × 2,0–2,6») con filtros de madera, ancho y alto;
  - mostrar «¿Quisiste decir Ranco?».
- **Causa raíz:** la búsqueda es un filtro de texto escrito aparte del resolutor del asistente.
- **Observado vs esperado:** 0 resultados / el mismo producto que resolvería el chat.
- **Pruebas requeridas:** convertir la tabla de §4 en prueba unitaria de la búsqueda; e2e del diálogo «Agregar producto» con «willow 82».
- **Esfuerzo:** M · **Confianza:** confirmado

### H5. «Familia de cada modelo» (Nombres y alias) no hace lo que dice

- **Severidad:** Media · **Prioridad:** P1 · **Categoría:** Configuración / UX
- **Archivo y líneas:** `src/app/configuracion-catalogo.tsx:60,602-635` («Qué tipo de producto es cada modelo, para cotizarlo con la tabla de precios correcta»); el único uso real está en `src/catalogo/importar.ts:85-90,110`; la fusión con la base está en `src/catalogo/configuracion.ts:205-208`
- **Evidencia:** `grep familiasPorModelo src` → solo importación y configuración. El script muestra que `validarConfiguracionCatalogo({familiasPorModelo:{}})` devuelve igual las 5 filas base: **las filas base no se pueden quitar**.
- **Por qué importa (clienta):** cambiar aquí la familia de un modelo no cambia nada hasta la próxima importación de la planilla principal, y no afecta a los modelos manuales ni a los de la planilla de enchapadas. La pantalla da a entender lo contrario.
- **Arreglo recomendado:** sacar esta tabla de «Nombres y alias». La familia se define en la ficha del modelo (§6) y se aplica en el momento a todas sus filas; la importación usa la ficha.
- **Causa raíz:** es un parámetro del importador que quedó expuesto en la interfaz.
- **Observado vs esperado:** sin efecto / efecto inmediato y visible.
- **Pruebas requeridas:** e2e: cambiar la familia de un modelo actualiza sus filas y el mapa de la IA.
- **Esfuerzo:** S (ocultar) o M (ficha) · **Confianza:** confirmado

### H6. Cambiar el «Código» de una madera re-codifica miles de productos en la siguiente importación

- **Severidad:** Media · **Prioridad:** P1 · **Categoría:** Configuración / Integración
- **Archivo y líneas:** `src/app/configuracion-catalogo.tsx:509-521` (columna «Código» editable); `src/catalogo/importar.ts:91-98,178-218` (corrige el código de la planilla al «calculado»)
- **Evidencia (script de importación, solo lectura):** con PINO OREGON `O→PO` salen **2.221 correcciones y 2.193 códigos nuevos** («ANC-PO-1-A…»). La vista previa los mostraría como 2.193 nuevos y 2.193 eliminados, sin explicar por qué.
- **Por qué importa (clienta):** un cambio que parece cosmético rompe los códigos que reconoce la fábrica (`productCode`, `integracion-pedido.ts:51`) y desordena la comparación con la importación anterior.
- **Arreglo recomendado:**
  - código de madera de solo lectura una vez que hay productos con él, o con una advertencia que cuente cuántos códigos cambiarían;
  - en la vista previa, un caso específico: «X códigos cambian solo por el código de madera».
- **Causa raíz:** el código del producto se deriva de la configuración, y esa configuración se puede editar libremente.
- **Observado vs esperado:** edición sin aviso / bloqueo o aviso cuantificado.
- **Pruebas requeridas:** unitaria de `validarConfiguracion` con productos existentes; e2e de la vista previa.
- **Esfuerzo:** S · **Confianza:** confirmado

### H7. La vendedora crea filas permanentes con un clic, pero no puede corregirlas ni borrarlas

- **Severidad:** Alta · **Prioridad:** P0 · **Categoría:** Permisos / Flujo
- **Archivo y líneas:**
  - `src/app/catalogo/pantalla-catalogo.tsx:30` (sin administración solo ve Consultar y Agregar);
  - `src/app/api/catalogo/route.ts:201-211` (`editar` solo administración, con un mensaje que habla de «importados»);
  - `src/negocio/pendientes.ts:260-283` y `src/app/preguntas-pendientes.tsx:78-81,115-130` («Agregar al catálogo» o «Es un modelo nuevo» desde un pendiente)
- **Evidencia:** `AUDITORIA_INCIDENTE_LOS_RIOS.md` (§1 y la tabla de productos manuales): 3 filas manuales creadas en 27 minutos, dos con un modelo nuevo que mete el espesor en el nombre y otra con un ancho de 1,50 m que «contaminó» el rango del modelo. Se corrigió en parte (huecos de más de 25 cm, ya no se ofrece el alta para una medida de puerta fuera de lista), pero **se sigue ofreciendo para un modelo o una madera desconocidos**, incluido «Es un modelo nuevo» ante una sugerencia por error de tipeo («ranko»).
- **Por qué importa (clienta):** un error de una vendedora queda en el catálogo de todas, y ella no lo puede arreglar.
- **Arreglo recomendado:**
  - desde un pendiente, ofrecer solo «**Cotizar como especial (solo esta cotización)**» y «**Pedir que se agregue al catálogo**», una solicitud que revisa administración;
  - el alta directa queda para administración;
  - la vendedora puede editar o borrar lo que creó durante 24 horas o mientras no se haya usado.
- **Causa raíz:** el alta se pensó como herramienta de catálogo y se reutilizó como atajo para resolver pendientes.
- **Observado vs esperado:** una fila global creada sin revisión / una solicitud o un ítem especial local.
- **Pruebas requeridas:** e2e con rol vendedora: el pendiente «ranko» no ofrece crear un modelo; una vendedora edita su alta reciente.
- **Esfuerzo:** M · **Confianza:** confirmado

### H8. Al editar, la descripción y la medida en texto se desincronizan; el texto de ayuda promete algo que el PDF casi nunca hace

- **Severidad:** Media · **Prioridad:** P2 · **Categoría:** Consistencia de datos / UX
- **Archivo y líneas:** `src/servidor/repositorio-catalogo.ts:809` (la descripción no se regenera); `src/app/gestion-manuales.tsx:504` («Medida (texto)» aparte de los anchos), `:523` (la ayuda dice que la descripción va en el PDF); `src/negocio/precios.ts:151-158` (si hay medidas pedidas, la línea usa `describirProducto` armado desde los campos, no la descripción guardada)
- **Evidencia:** lectura de código. Cambiar «Ancho máximo» de 0,85 a 0,88 deja la `medida` «0,80 A 0,85» y una descripción con la medida antigua. La consulta y la vista sin medidas pedidas muestran la vieja. Las líneas con medidas pedidas muestran la nueva.
- **Por qué importa (clienta):** edita un dato, lo ve guardado y en otra pantalla aparece el anterior.
- **Arreglo recomendado:** derivar siempre `medida` y `descripcion` de los campos estructurados; la descripción libre pasa a ser «Nombre en documentos (opcional)» y gana siempre si se escribe.
- **Causa raíz:** campos denormalizados heredados de la planilla.
- **Observado vs esperado:** dos versiones del mismo dato / una sola fuente.
- **Pruebas requeridas:** unitaria de `editarProducto` (cambiar el ancho regenera medida y descripción).
- **Esfuerzo:** S · **Confianza:** confirmado (el efecto en el PDF es probable)

### H9. Editar una fila puede dejar un modelo con dos familias

- **Severidad:** Media · **Prioridad:** P2 · **Categoría:** Integridad
- **Archivo y líneas:** `src/servidor/repositorio-catalogo.ts:742-900` (`editarProducto` no comprueba la familia del modelo; el alta sí, `:1098-1102` y `alta-catalogo.ts:478-486`); consumidores que asumen una sola familia: `src/catalogo/resolver.ts` (`opciones[0].familia` en `resolverItem`), `src/catalogo/mapa.ts:42`, `repositorio-catalogo.ts:585-587`
- **Evidencia:** lectura de código.
- **Por qué importa (clienta):** un cambio en una sola fila hace que el modelo entero se cotice o se le describa a la IA con la familia equivocada, según qué fila salga primero.
- **Arreglo recomendado:** la familia se fija a nivel de modelo; editar una fila no la cambia.
- **Causa raíz:** no existe la entidad «modelo» que guarde la invariante.
- **Observado vs esperado:** familias mezcladas posibles / imposibles.
- **Pruebas requeridas:** unitaria: `editarProducto` rechaza un cambio de familia que no se aplique a todo el modelo.
- **Esfuerzo:** S · **Confianza:** confirmado (lectura)

### H10. Renombrar, reclasificar o dar de baja un modelo no existe; las cotizaciones abiertas dependen del nombre

- **Severidad:** Media · **Prioridad:** P2 · **Categoría:** Ciclo de vida
- **Archivo y líneas:** `src/servidor/servicio.ts:896-904` (el ítem guarda modelo y madera, no el código), `:326-334` (`recalcular`); `src/servidor/repositorio-catalogo.ts:729-740` (las filas de planilla no se eliminan), `:1067` (un borrador queda pendiente al borrar)
- **Evidencia:** lectura de código. Para renombrar hay que editar N filas y la planilla lo revierte; para «descontinuar Ranco Raulí» hay que tocar la planilla.
- **Por qué importa (clienta):** no puede mantener al día la oferta (un modelo que la fábrica dejó de hacer sigue apareciendo), y un renombre deja borradores con «modelo desconocido».
- **Arreglo recomendado:**
  - acciones de modelo: **Renombrar**, que guarda el nombre viejo como alias para que los borradores sigan resolviendo;
  - **Pausar u ocultar** (estado `activo/pausado`, que no se ofrece en la búsqueda ni en el chat pero sí resuelve en cotizaciones abiertas);
  - **Cambiar el tipo de producto**.
- **Causa raíz:** no existe la entidad «modelo».
- **Observado vs esperado:** N ediciones frágiles / una acción con efecto controlado.
- **Pruebas requeridas:** e2e: renombrar un modelo con un borrador abierto lo deja valorizado; un modelo pausado no aparece en la búsqueda.
- **Esfuerzo:** M · **Confianza:** confirmado (lectura)

### H11. La terminología choca: «familia», «tipo», «especial», «precio sin IVA»

- **Severidad:** Alta · **Prioridad:** P1 · **Categoría:** Lenguaje
- **Archivo y líneas:**
  - «Familia» en el alta y en Gestionar (`alta-producto.tsx:439`, `gestion-manuales.tsx:491`) vs «**Tipo de producto**» para la misma cosa en el personalizado (`agregar-producto.tsx:444`), mientras «**Tipo (opcional)**» del alta es otra cosa (texto libre que cambia el margen, H3);
  - «especial» con cuatro significados: `tipo` «PUERTA ESPECIAL» = anchos ≥ 1,10 (datos), código `ESPECIAL` = fuera de catálogo (`personalizados.ts:5`), «pedido especial», «descuento especial» y «margen especial» (`precios.ts:174`);
  - «Precio base sin IVA» = costo (`alta-producto.tsx:478`) vs «Precio unitario sin IVA» = venta (`agregar-producto.tsx:475`);
  - «Piezas T», «escuadría», «PULG KIT», «Código interno asignado IA-…», «Se cambia solo / Podría ser».
- **Evidencia:** lectura literal; la búsqueda «puerta especial» devuelve 3.696 puertas anchas.
- **Por qué importa (clienta):** la misma palabra nombra cosas distintas en pantallas contiguas, y es justo lo que ella describe como «muy confuso».
- **Arreglo recomendado:** glosario único (§6.2) aplicado a etiquetas, ayudas y mensajes; la palabra «especial» solo para «fuera de catálogo».
- **Causa raíz:** el vocabulario de la planilla y el del código se filtraron a la interfaz.
- **Observado vs esperado:** 4 sentidos / 1 sentido.
- **Pruebas requeridas:** revisión de textos; e2e que verifica las etiquetas clave; prueba con usuarias (§6.9).
- **Esfuerzo:** S–M · **Confianza:** confirmado

### H12. El alta no permite rango de alto ni espesor, y los atributos sin campo terminan en el nombre del modelo

- **Severidad:** Media · **Prioridad:** P2 · **Categoría:** Modelo de datos
- **Archivo y líneas:** `src/servidor/alta-catalogo.ts:20-35` (`productoSchema` sin `altoMin/altoMax`), `:347-373`; `src/app/alta-producto.tsx:454-466`
- **Evidencia:** las 82 puertas de la planilla de enchapadas usan rangos de alto (2,00–2,20). El incidente creó «LOS RIOS ESPECIAL (40 MM ESPESOR)».
- **Por qué importa (clienta):** no puede cargar una puerta como las que ya existen, e inventa nombres que después no encuentra ni el buscador ni el chat.
- **Arreglo recomendado:** la grilla del modelo admite filas de alto como rango; un campo opcional «Espesor» o «Variante» que forma parte de la ficha (y, más adelante, del código).
- **Causa raíz:** el formulario de alta se diseñó para la planilla principal.
- **Observado vs esperado:** alto exacto, espesor en el nombre / rango de alto y espesor como dato.
- **Pruebas requeridas:** unitaria de alta con rango de alto; e2e que cotiza una puerta de 2,15 m en un rango 2,00–2,20 creado a mano.
- **Esfuerzo:** M · **Confianza:** confirmado

### H13. Un modelo nuevo en la planilla principal se importa como PUERTA si nadie lo registró antes

- **Severidad:** Media · **Prioridad:** P2 · **Categoría:** Importación
- **Archivo y líneas:** `src/catalogo/importar.ts:110-116`
- **Evidencia:** `familiaModelo.get(...) ?? 'PUERTA'`. Una moldura nueva («CORNISA») se leería como puerta y su `medida` saldría de la columna D como si fuera un ancho.
- **Por qué importa (clienta):** el catálogo puede recibir accesorios disfrazados de puertas que suman al descuento por cantidad y piden ancho.
- **Arreglo recomendado:** en la vista previa, listar los «modelos nuevos» y pedir su tipo de producto antes de confirmar.
- **Causa raíz:** la familia se deduce del nombre.
- **Observado vs esperado:** PUERTA por defecto / una pregunta explícita.
- **Pruebas requeridas:** unitaria del importador con un modelo desconocido.
- **Esfuerzo:** S · **Confianza:** confirmado (lectura)

### H14. Los productos de planilla no se pueden pausar, y sus ediciones se pierden al reimportar

- **Severidad:** Media · **Prioridad:** P2 · **Categoría:** Ciclo de vida
- **Archivo y líneas:** `src/servidor/repositorio-catalogo.ts:306-309,729-740`; `src/app/gestion-manuales.tsx:484-487`
- **Evidencia:** lectura de código; la vista previa lo avisa (`importar-catalogo.tsx:351-357`).
- **Por qué importa (clienta):** un ajuste de precio hecho en la aplicación «desaparece» al importar, y no sabe cuál manda, si la aplicación o el Excel.
- **Arreglo recomendado:** declarar una sola fuente de verdad por modelo («viene de la planilla» o «se mantiene aquí»), visible en la ficha; las ediciones locales sobre la planilla se conservan como «ajustes» con opción de mantenerlas al importar.
- **Causa raíz:** dos fuentes de verdad sin regla de precedencia visible.
- **Observado vs esperado:** se pierde con un aviso / el origen se ve y la persona elige.
- **Pruebas requeridas:** e2e de importación con ajustes locales.
- **Esfuerzo:** M · **Confianza:** confirmado

### H15. No hay documentación del catálogo para la usuaria

- **Severidad:** Baja · **Prioridad:** P2 · **Categoría:** Documentación
- **Archivo y líneas:** `docs/manual-operativo.md:280-287` (3 viñetas técnicas); `src/app/ayuda/page.tsx:57` (una línea)
- **Evidencia:** grep de «familia» o «agregar un producto» en el manual y la ayuda: sin explicación de qué son familia, modelo, madera, tramo, costo vs venta ni cómo crear una puerta.
- **Por qué importa (clienta):** no tiene dónde aprenderlo sola.
- **Arreglo recomendado:** una página de ayuda «Catálogo en 5 minutos» con el glosario de §6.2 y los recorridos de §6.4, y ayudas en contexto en la ficha.
- **Causa raíz:** el catálogo se documentó para soporte, no para quien vende.
- **Pruebas requeridas:** la prueba con usuarias (§6.9) sin ayuda verbal.
- **Esfuerzo:** S · **Confianza:** confirmado

### H16. Consultar calcula el precio con otra fórmula que la cotización (hoy sin diferencias)

- **Severidad:** Baja · **Prioridad:** P3 · **Categoría:** Precio
- **Archivo y líneas:** `src/app/api/catalogo/route.ts:167` (`Math.round(p.precioNeto * (1 + margen))`) vs `src/negocio/precios.ts:21-22` (`precioConMargen`, el arreglo de BUG-034)
- **Evidencia:** script con 8.866 productos y los márgenes reales: **0 diferencias hoy**. Un margen como 0,15 sobre ciertos costos sí puede diferir en $1 (justo el caso de BUG-034).
- **Por qué importa (clienta):** «el catálogo dice $X y la cotización $X+1».
- **Arreglo recomendado:** usar `precioConMargen`.
- **Causa raíz:** fórmula duplicada.
- **Pruebas requeridas:** unitaria con 10.990 × 1,15.
- **Esfuerzo:** S · **Confianza:** confirmado (riesgo latente)

### H17. Cinco caminos para «no está en el catálogo»

- **Severidad:** Alta · **Prioridad:** P1 · **Categoría:** Flujo / Lenguaje
- **Archivo y líneas:** tabla de §3.8 (`agregar-producto.tsx:152-160,307-308,475`; `cotizacion-panel.tsx:837-876`; `preguntas-pendientes.tsx:78-81`)
- **Evidencia:** lectura literal; en el incidente, la usuaria pasó por el ítem libre y por el alta antes de pedir ayuda (`AUDITORIA_INCIDENTE_LOS_RIOS.md`, cronología, eventos 791 y siguientes).
- **Por qué importa (clienta):** tiene que elegir entre cinco opciones parecidas, una de las cuales cambia el catálogo de todas.
- **Arreglo recomendado:** un solo botón, «**Producto especial (solo esta cotización)**», con una pregunta: «¿Lo fabrica Neltume?». Sí → especial que va a fábrica, con costo opcional. No → ítem libre. Y un enlace aparte, «Pedir que se agregue al catálogo».
- **Causa raíz:** cada camino nació por separado.
- **Observado vs esperado:** 5 caminos / 1 camino con una pregunta.
- **Pruebas requeridas:** e2e de los dos desenlaces; las notas de pedido siguen igual.
- **Esfuerzo:** M · **Confianza:** confirmado

---

## 6. Propuesta de rediseño

### 6.1 Modelo conceptual simplificado (para personas)

```
Tipo de producto  (Puerta · Marco · Pieza T · Moldura)        ← hoy «familia» (enum interno, sin cambios)
   └─ Modelo       (Ranco, Huilo Huilo, Marco, Guardapolvo…)   ← NUEVA ficha: nombre, tipo, otros nombres (alias),
        │                                                       estado (activo/pausado), origen (planilla/aquí),
        │                                                       foto y nota opcionales
        └─ Madera o terminación  (Pino oregón, Lenga, Prepintada…)  ← por modelo: categoría de precio (margen) explícita
              └─ Tabla de precios: anchos × altos → costo           ← hoy: filas `Producto` (se conservan tal cual)
                   (accesorios: secciones × largos)
```

- **«Producto especial (solo esta cotización)»**: no toca el catálogo. Reemplaza los caminos personalizado, especial y libre desde la pantalla (H17).
- **Plantilla**: duplicar un modelo existente (la estructura y, opcionalmente, los costos con un factor ±%).
- Las **filas** siguen existiendo por debajo: el resolutor, la nota de pedido, el PDF y la integración no cambian.

### 6.2 Terminología para no técnicos (glosario único)

| Hoy | Propuesta | Nota |
|---|---|---|
| Familia | **Tipo de producto** | Puerta, Marco, Pieza T («Piezas T» → «Pieza T (jamba)» si así la llama la tienda), Moldura |
| Tipo (texto libre: PANEL, BLOQUE, ESPECIAL…) | **Estilo** (opcional, informativo) | No afecta el precio |
| PUERTA ESPECIAL (anchos ≥ 1,10) | **Puerta ancha** | «Especial» queda solo para «fuera de catálogo» |
| Precio base sin IVA | **Costo de fábrica (neto)** | Siempre junto a «→ precio de venta $X (margen Y %)» |
| Precio unitario sin IVA (personalizado) | **Precio de venta (neto)** | |
| Medida o escuadría | **Sección** (ej. 2×4 pulgadas) | Con la unidad visible |
| Tramo / escalón / rango | **Medida de catálogo** («0,80 a 0,85 m») | |
| Alias | **Otros nombres** | Por modelo, en la ficha |
| Producto personalizado / pedido especial / ítem libre | **Producto especial** (va a fábrica) / **Otro cargo** (no va a fábrica) | |
| Código interno IA-… | Oculto para la vendedora; código legible para lo nuevo (ver 6.7) | |

### 6.3 Navegación

*Catálogo* →

1. **Buscar** (vista agrupada por modelo, con filtros).
2. **Modelos** (lista de fichas, con filtro por tipo y estado).
3. **Importar planilla** (administración).
4. **Nombres que entiende el asistente** (los alias globales de madera; los de modelo pasan a la ficha).
5. **Papelera**.

Desaparecen «Agregar producto» y «Gestionar catálogo» como secciones: se crea desde *Modelos → Nuevo modelo* y se edita dentro de la ficha.

### 6.4 Formularios y recorridos

- **Nuevo modelo (asistente de 4 pasos):**
  1. Nombre y tipo de producto, con aviso si se parece a un modelo existente (usa `modeloParecido`).
  2. **«Partir de…»**: un modelo existente (copia maderas y medidas) o vacío.
  3. **Tabla de costos** por madera: grilla editable, pegar desde Excel, «copiar de otra madera ±%». Arriba de cada madera, su **categoría de precio** con el margen y un ejemplo de precio de venta calculado con `margenProducto`.
  4. Revisar (n filas, rango de medidas, precio mínimo y máximo de venta) y **Publicar**. Hasta publicarse, el modelo está en borrador y no se cotiza.
- **Ficha de modelo:** pestañas «Precios» (grilla), «Otros nombres», «Historial». Acciones: Duplicar, Renombrar (agrega el nombre viejo como alias), Cambiar tipo (aplica a todas las filas), Pausar, Ajustar precios (±% a la selección).
- **Agregar una madera:** botón en la ficha → elegir la madera → «copiar medidas de: Oregón» → costos.
- **Agregar una medida:** botón «+ ancho» o «+ alto» en la grilla. La regla de contigüidad se explica en la grilla misma («entre 1,45 y 1,50 falta un tramo»).

### 6.5 Reglas de crear, editar y duplicar

- La familia (tipo de producto) es del **modelo**; ninguna edición de fila la cambia (cierra H9).
- `medida` y `descripcion` se **derivan** de los datos estructurados; el «nombre en documentos» es opcional y aparte (cierra H8).
- La **categoría de precio** se guarda; la regla de texto actual solo la propone (cierra H3). El precio de venta de cualquier vista previa sale de la misma función que la cotización (cierra H2 y H16).
- **Permisos:** la vendedora busca, crea productos especiales y envía «pedir que se agregue». Administración crea y publica modelos. La autora puede corregir su borrador.
- **Duplicar** copia filas con códigos nuevos y deja el modelo en borrador.

### 6.6 Búsqueda

- Un solo motor, que use el resolutor del asistente (alias, tolerancia, plural, sugerencia a una letra) y palabras vacías.
- Reconoce medidas: «0,82», «82», «85x210» → tramo.
- Reconoce el tipo de producto: «puertas», «molduras».
- **Resultados agrupados por modelo**, con chips de madera y los rangos de medida; al elegir uno, selectores de madera, ancho y alto que llevan a la fila exacta. En el diálogo de la cotización basta escribir «willow mara 82 210» para que proponga la fila HUIL-M-3-B.
- La tabla de §4 se usa como prueba de aceptación.

### 6.7 Migración sin perder datos

1. **Tabla `modelos`** (nueva): `nombre`, `nombre_normalizado`, `familia`, `estado`, `origen`, `alias_json`, `creado/por`. Se llena con `SELECT DISTINCT modelo, familia` de `productos_catalogo ∪ productos_adicionales`. Si un modelo tiene familias mezcladas, se **informa** y no se adivina.
2. **Categoría de precio por modelo y madera** (nueva tabla o columna en las filas): se llena con `categoriaMargen()` actual. Una prueba verifica que el precio de los 8.866 productos no cambia.
3. Las **filas `Producto`, sus códigos y la `familia` interna no cambian**: lo exige la integración (`integracion-pedido.ts:51-56`; `docs/integracion-fabrica.md:114-117`) y lo usan la nota de pedido y el PDF.
4. Los alias de modelo de `catalogo_configuracion` pasan a la ficha. La configuración global queda para las maderas.
5. **Códigos de altas nuevas:** usar el mismo patrón de la planilla (`ABREV-MADERA-SEC-ALTO`) con un sufijo que no choque. Los `IA-…` existentes se conservan. Coordinar con la fábrica (plan P0–P4 «catálogo versionado») para que reconozca los nuevos en vez de tratarlos como «a pedido».
6. Hacer respaldo antes de migrar (el informe de Los Ríos indica que **no había respaldos en producción después del 28 de octubre**).

### 6.8 Compatibilidad con cotizaciones existentes

- Las aprobadas, reemplazadas y anuladas usan su copia (`cotizacion_lineas`, `nota_lineas`): **sin cambios**.
- Los borradores y las emitidas editables siguen resolviendo por nombre. Renombrar agrega un alias y pausar no impide resolver, así que no quedan pendientes nuevos. Como mejora opcional, guardar también el `codigo` en la solicitud y usarlo primero, con el nombre como respaldo.
- Mientras convivan las dos vías, «Agregar al catálogo» desde un pendiente queda solo para administración.

### 6.9 Riesgos

| Riesgo | Mitigación |
|---|---|
| Cambiar la categoría de margen cambia precios | Migración con verificación de 0 diferencias; categoría visible antes de publicar |
| La integración espera las 4 familias y los códigos de planilla | No cambiar el enum ni los códigos; los nombres nuevos son solo de interfaz |
| La grilla genera solapes o huecos | Reutilizar `rangoSuperpuesto` y `anchoNoContiguo` como validación de la grilla |
| La planilla reemplaza lo editado aquí | Origen visible por modelo; la importación pregunta por los modelos «mantenidos aquí» |
| La búsqueda tolerante confunde modelos parecidos | Usar las mismas reglas del resolutor: un alias dudoso **sugiere** («¿Quisiste decir…?») y no reemplaza |
| Más superficie de código | Por etapas, con la tabla de §4 y los escenarios de §6.11 como pruebas |

### 6.10 Plan por etapas

| Etapa | Contenido | Hallazgos | Esfuerzo |
|---|---|---|---|
| **0 · Arreglos rápidos (1–2 días)** | Vista previa del alta con el margen real; etiquetas «Costo de fábrica» y «Precio de venta»; en los pendientes, quitar «Es un modelo nuevo» y «Agregar al catálogo» para vendedoras; el aviso de «Familia de cada modelo» dice que solo aplica al importar; código de madera protegido; `precioConMargen` en Consultar | H2, H5, H6, H7, H11 (en parte), H16 | S |
| **1 · Un solo buscador** | Alias, tolerancia, medidas y familia en la búsqueda; resultados agrupados por modelo; filtros | H4 | M |
| **2 · Ficha de modelo (lectura)** | Tabla `modelos` y migración; lista de modelos; ficha con grilla de solo lectura; renombrar y pausar | H9, H10, H13 | M |
| **3 · Crear y duplicar** | Asistente «Nuevo modelo», duplicar, agregar madera o medida, grilla editable con rango de alto, ajuste de precios ±% | H1, H8, H12 | L |
| **4 · Categoría de precio explícita** | Columna, migración con verificación, edición en la ficha | H3 | M |
| **5 · Producto especial único** | Un solo camino especial/otro cargo + «Pedir que se agregue al catálogo» | H17, H7 | M |
| **6 · Ayuda y glosario** | Página de ayuda, ayudas en contexto, manual | H15, H11 | S |

### 6.11 Criterios de aceptación

1. Una persona nueva crea «Roble» (4 maderas, misma estructura que Ranco) en **menos de 10 minutos y menos de 40 acciones**, sin ayuda, y lo cotiza desde el chat y desde «Agregar producto».
2. Toda vista previa de precio de venta coincide con la línea cotizada en el 100 % de las categorías.
3. Cambiar el estilo, el nombre o la descripción no cambia el precio.
4. Las 14 consultas que hoy dan 0 en §4 encuentran el producto esperado, o sugieren el correcto («¿Quisiste decir…?»), y «enchapado» encuentra las puertas enchapadas.
5. Renombrar o pausar un modelo no deja pendientes nuevos en los borradores existentes.
6. La migración no cambia el precio, el código, la familia ni la descripción de ninguno de los 8.866 productos (comparación antes y después).
7. Las cotizaciones aprobadas y anuladas, las notas de pedido y los pedidos a fábrica se generan idénticos a hoy (comparación de PDF y JSON del contrato).
8. Con el rol de vendedora no existe ningún camino de un clic que cree filas globales en el catálogo.

### 6.12 Escenarios de prueba de usabilidad (con la clienta y una persona nueva, sin ayuda verbal)

1. «La fábrica sacó el modelo Roble, igual a Ranco pero 10 % más caro. Agrégalo.»
2. «Ranco ahora también viene en Raulí, con los mismos precios que Lenga. Agrégalo.»
3. «La fábrica subió 5 % las puertas Huilo Huilo en Oregón. Actualízalo.»
4. «Un cliente pide una “willow de 82 por 210 en mara”. Búscala y agrégala a una cotización sin usar el chat.»
5. «Un cliente quiere una puerta de 1,60 m de ancho. Cotízala.» Se espera un producto especial y que no se toque el catálogo.
6. «El cliente quiere además la instalación por $80.000.» Se espera «Otro cargo», que no va a fábrica.
7. «Te equivocaste: el modelo nuevo se llama Robles, no Roble. Corrígelo.» El borrador abierto debe seguir valorizado.
8. «La fábrica dejó de hacer Ranco en Raulí. Haz que no se ofrezca.»
9. «¿A cuánto se vende una Lenga de 0,80 × 2,10 de Ranco y cuánto cuesta en fábrica?»

Medir: éxito o fracaso, tiempo, errores, palabras que la persona no entiende (registrarlas literalmente) y confianza declarada (1 a 5).

---

## Anexo A · Scripts y reproducción

- `scratchpad/catalogo/prueba-busqueda.ts`: búsqueda de Consultar y Agregar (`terminosBusquedaCatalogo` / `coincideBusquedaCatalogo` / `textoBusquedaCatalogo`), `resolverItem`, `modeloDelCatalogo`, comparación de precios entre consulta y cotización, y vista previa del alta vs margen real. Necesita una **copia** de la base en `scratchpad/catalogo/db/` (copiar `cotizador.sqlite` con `-wal` y `-shm`; la copia se borró al terminar).
- `scratchpad/catalogo/prueba-importar.ts`: `importar()` sobre `datos-privados/COTIZADOR_2026.xlsx` (solo lectura) con la configuración base y con el código de madera O→PO; prueba que las filas base de `familiasPorModelo` no se pueden quitar.
- `scratchpad/catalogo/prueba-margen-texto.ts`: `categoriaMargen` con distintos textos.
- La salida completa está en `scratchpad/catalogo/salida-pruebas.txt`.
- Ejecución: `cd <repo> && npx tsx <script>`.

## Anexo B · Fuera de alcance o ya resuelto

- BUG-012 (recotización silenciosa): resuelto con avisos (`servicio.ts:603-620`). La relación catálogo vivo ↔ emitidas editables se describe en §2.
- Incidente de Los Ríos: el ancho no contiguo y la medida de puerta fuera de lista ya no ofrecen alta (`pendientes.ts:262-267`; `repositorio-catalogo.ts:604-628`). Siguen vigentes los puntos de H7 y H12.
- No se abrieron datos de clientes en este informe; solo se usaron conteos agregados.
