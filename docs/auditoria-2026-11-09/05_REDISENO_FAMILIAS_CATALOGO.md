# 05 · Rediseño de familias y catálogo

**Objetivo:** que la clienta entienda el catálogo y pueda trabajar con él sin ayuda, sin romper lo que usan la nota de pedido, el PDF y la integración con la fábrica.

**Para quién es este documento:** para quien implemente los cambios. Está escrito para que no tenga que redescubrir los problemas. La evidencia completa (scripts, salidas y líneas) está en `anexos/A-catalogo.md`. Los hallazgos se citan con su id consolidado `N-xx` (ver `01`) y su id del anexo `Hx`.

**Corrección respecto del anexo:** el anexo afirma que la vendedora «no puede corregir ni borrar» lo que crea (H7). **En producción todas las cuentas son administradoras:** `autenticacion-config.ts:276` convierte todos los roles en `admin` en cada arranque, y la base local solo tiene cuentas `admin`. Hoy la vendedora sí puede editar y borrar. El problema real es otro: cualquiera crea filas globales con un clic, sin revisión, y hay controles de rol que no separan nada (N-17). Este documento ya tiene en cuenta esta corrección.

---

## 1. Cómo funciona hoy

### 1.1 Las piezas

| Concepto | Qué es en el código | Evidencia |
|---|---|---|
| **Producto (fila)** | La única entidad real: `codigo, modelo, familia, tipo, madera, medida, anchoMin/Max, altoMin/Max, largo, precioNeto, descripcion, filaOrigen`. **Una fila = un modelo × una madera × un tramo de ancho × un alto.** | `src/catalogo/tipos.ts:12-28` |
| **Modelo** | **No es una entidad.** Es un texto que agrupa filas (`GROUP BY modelo`), sin tabla, ficha, estado, foto ni atributos. | `repositorio-catalogo.ts:437-452,539-555` |
| **Familia** | Enum fijo: `PUERTA`, `MARCO`, `PIEZAS_T` y `MOLDURA`, más `OTRO` solo para ítems libres. Se muestra como Puerta, Marco, Piezas T y Moldura. **No se puede crear una familia.** | `tipos.ts:6,11`; `catalogo/familias.ts:4-9` |
| **De dónde sale la familia** | Al importar, se deduce del nombre del modelo con `familiasPorModelo` (MARCO, PIEZAS T, ENDOLADO, GUARDAPOLVO, PILASTRA). **Cualquier otro nombre queda como `PUERTA`.** | `catalogo/importar.ts:85-90,110` |
| **Subfamilia** | No existe. El campo libre `tipo` cumple ese papel: PUERTA PANEL, BLOQUE, ESPECIAL (= ancho de 1,10 m o más), PREPINTADA, ENCHAPADA y SET DE MARCO. | datos; `enchapadas.ts` |
| **Variante** | No existe. La fila es la variante. | `catalogo/mapa.ts:16-21` (solo agrupa para la IA) |
| **Madera** | Lista global con `nombre`, `codigo` (letra que se usa en el código del producto) y `alias`. Las terminaciones (prepintada, enchapada, finger) también son «maderas». | `catalogo/configuracion.ts:49-53,84-130` |
| **Código** | Planilla principal: `ABREV-MADERA-ANCHO#-LETRA DE ALTO` (por ejemplo, `RAN-O-3-B`). Enchapadas: `HUIL-PP-070-220`. Alta manual: `IA-` + 10 caracteres hexadecimales. | `importar.ts:91-98`; `alta-catalogo.ts:358` |
| **Origen** | `principal`, `enchapadas` o manual. Una importación reemplaza solo su origen. | `catalogo/origenes.ts`; `repositorio-catalogo.ts:249-366` |

**Herencia de características: no hay.** Cada fila repite todos sus datos. Lo que parece compartido se aplica **por nombre o por texto**:

- alias de modelo (por nombre);
- alias de madera (globales);
- maderas equivalentes, fijas en el código;
- familia por modelo (solo al importar);
- categoría de ganancia, deducida con expresiones regulares sobre `modelo + tipo + madera + descripcion` (`negocio/precios.ts:312-338`).

### 1.2 Los datos reales (copia de solo lectura)

| Origen | Familia | Filas | Modelos |
|---|---|---:|---:|
| principal | PUERTA | 8.316 | 33 |
| principal | MOLDURA | 216 | 3 |
| principal | MARCO | 128 | 1 |
| principal | PIEZAS_T | 112 | 1 |
| enchapadas | PUERTA | 82 | 5 |
| enchapadas | MARCO | 12 | 1 |

Un modelo de puerta estándar son **252 filas**: 4 maderas × 9 tramos de ancho (de 0,60 a 1,45) × 7 altos (de 2,0 a 2,6). En los accesorios, la familia y el modelo son la misma palabra (familia Marco, modelo «MARCO»); en las puertas no (familia Puerta, modelo «Ranco»).

### 1.3 Medidas, espesores y precio

- **Medidas.** En las puertas, el ancho es un tramo y el alto es exacto o un rango. En los accesorios, la medida es la escuadría, con tres sistemas de unidades: pulgadas, cm y mm.
- **Espesor.** No existe como campo. Terminó escrito en el nombre de un modelo («LOS RIOS ESPECIAL (40 MM ESPESOR)»).
- **`precioNeto` = costo de fábrica.** El precio de venta es `round(costo × (1 + margen))`. El margen sale, en orden de prioridad, de: la línea, luego la cotización, luego la categoría (11 categorías: oregón 85 %, prepintada 140 %, «otros» 25 %…). Un precio escrito a mano reemplaza todo (`precios.ts:21-22,231-247`).
- **Escalones** (`resolver.ts:119-161`):
  - una medida dentro de un tramo usa ese tramo;
  - una medida en un hueco entre tramos usa el tramo siguiente;
  - una medida sobre la máxima queda pendiente o se cotiza como especial;
  - una medida hasta 5 cm menor que la mínima usa la mínima.

### 1.4 Respuestas a las preguntas de la auditoría

| # | Pregunta | Respuesta |
|---|---|---|
| 1 | ¿Qué representa una familia? | Una de 4 categorías fijas que deciden cómo se pide la medida (ancho × alto o escuadría × largo), qué cuenta para el descuento por cantidad y qué se envía a la fábrica (`family`). |
| 2 | ¿Qué es un producto? | Una fila con su precio: modelo × madera × tramo × alto. |
| 3 | ¿Qué es una variante? | No existe; la fila es la variante. |
| 4 | ¿Hay subfamilias? | No; el campo libre `tipo` cumple ese papel de hecho. |
| 5 | ¿Cómo se heredan características? | No se heredan: se aplican por nombre o por texto. |
| 6 | ¿Dónde viven medidas y espesores? | Las medidas, en cada fila. El espesor, en ninguna parte. |
| 7 | ¿Cómo se calcula el precio? | Costo × (1 + margen de la categoría deducida del texto), o el precio manual. |
| 8 | ¿Qué propiedades se comparten? | Los alias, los códigos de madera y los márgenes por categoría (globales). |
| 9 | ¿Qué propiedades son individuales? | Todo lo demás, fila por fila. |
| 10 | ¿Qué pasa si «cambia una familia»? | «Familia de cada modelo» solo actúa en la próxima importación (N-20). Editar la familia de una fila no se valida y puede dejar un modelo con dos familias (N-32). |
| 11 | ¿Cómo se relaciona con las cotizaciones? | Una línea emitida guarda una copia del producto. Los borradores y las emitidas editables guardan nombre, madera y medidas, y **se vuelven a resolver** contra el catálogo vigente (`servicio.ts:326-334,896-904`). |
| 12 | ¿Se pueden crear productos fuera de una familia? | En el catálogo, no. En una cotización, sí: un personalizado con familia elegida o un ítem libre con familia `OTRO`. |
| 13 | ¿Qué restricciones responden a una necesidad comercial? | Familia → forma de medir; escalones de medida; costo y margen; códigos que la fábrica reconoce; tramos contiguos (no más de 25 cm de hueco). |
| 14 | ¿Qué decisiones de implementación complican el uso? | Que no haya entidad modelo; la familia deducida del nombre; el margen deducido del texto; el código de madera editable; dos buscadores; cinco caminos para lo especial; descripción y medida guardadas aparte de los datos (desincronizadas). |

---

## 2. Problemas funcionales detectados

| Id | Prio. | Problema | Archivo/líneas | Anexo |
|---|---|---|---|---|
| N-02 | **P0** | La vista previa del alta muestra un precio de venta falso (usa `REGLAS.ajuste` y no el margen de la categoría): costo $100.000 → anuncia $150.000 → cobra $185.000 (oregón) o $125.000 (cedro). Probable origen del costo mal cargado en Los Ríos (124.080 = 51.700 × 2,4). | `alta-producto.tsx:90,127-128,378-379,520-522` vs `precios.ts:345-352` | H2 |
| N-06 | P1 | No hay ficha de modelo: una puerta nueva son 252 formularios, sin plantilla ni duplicar; el formulario se vacía después de cada alta. | `tipos.ts:12-28`; `alta-producto.tsx:317` | H1 |
| N-07 | P1 | Dos buscadores incoherentes (§10). | `servidor/busqueda.ts:17-50` | H4 |
| N-08 | P1 | Cinco caminos para lo especial; desde un pendiente se crean filas globales con un clic, incluso ante «ranko». | `preguntas-pendientes.tsx:78-81`; `pendientes.ts:260-283` | H7, H17 |
| N-09 | P1 | El margen cambia según palabras escritas a mano: «PUERTA PREPINTADA» en el tipo hace que oregón pase del 85 % al 140 %. | `precios.ts:312-338` | H3 |
| N-20 | P1 | «Familia de cada modelo» no tiene efecto hasta la próxima importación. | `configuracion-catalogo.tsx:602-635` | H5 |
| N-21 | P1 | Cambiar el código de madera re-codifica 2.193 productos en la siguiente importación. | `configuracion-catalogo.tsx:509-521` | H6 |
| N-32 | P2 | Editar una fila puede dejar un modelo con dos familias; la descripción y la medida en texto no se regeneran. | `repositorio-catalogo.ts:742-900,809` | H8, H9 |
| N-33 | P2 | No se puede renombrar, pausar ni dar de baja un modelo; lo editado sobre la planilla se pierde al reimportar. | `servicio.ts:896-904`; `repositorio-catalogo.ts:306-309,729-740` | H10, H14 |
| N-34 | P2 | El alta no admite rango de alto ni espesor. | `alta-catalogo.ts:20-35` | H12 |
| N-35 | P2 | Un modelo nuevo de la planilla se importa como PUERTA por defecto. | `importar.ts:110-116` | H13 |
| — | P3 | Consultar usa otra fórmula de precio (hoy sin diferencias); no hay documentación del catálogo para la usuaria. | `api/catalogo/route.ts:167`; `manual-operativo.md:280-287` | H15, H16 |

## 3. Problemas de comprensión y terminología

| Hoy | Problema | Propuesta |
|---|---|---|
| **Familia** (alta y Gestionar) vs **Tipo de producto** (personalizado) vs **Tipo (opcional)** (alta) | Las dos primeras son lo mismo con otro nombre; la tercera es otra cosa y además cambia el margen | **Tipo de producto** = Puerta · Marco · Pieza T · Moldura. El viejo `tipo` pasa a **Estilo (opcional)** y no afecta el precio |
| «Especial» | Cuatro sentidos: PUERTA ESPECIAL (ancho de 1,10 m o más), código `ESPECIAL` (fuera de catálogo), descuento especial, margen especial | «Especial» **solo** para «fuera de catálogo». Los otros pasan a **Puerta ancha**, **Descuento de esta línea** y **Ganancia de esta cotización** |
| «Precio base sin IVA» vs «Precio unitario sin IVA» | Uno es costo y el otro venta, con etiquetas casi iguales | **Costo de fábrica (neto)**, siempre acompañado de «→ precio de venta $X»; y **Precio de venta (neto)** |
| Medida o escuadría | Jerga, con tres sistemas de unidades | **Sección** (por ejemplo, 2 × 4 pulgadas), con la unidad visible |
| Ancho mínimo y máximo, tramo, escalón | No se explica | **Medida de catálogo: «para anchos entre 0,80 y 0,85 m»** |
| Alias | Técnico | **Otros nombres** |
| Personalizado, pedido especial, ítem libre | Tres nombres para dos cosas | **Producto especial** (va a la fábrica) · **Otro cargo** (no va a la fábrica) |
| Código interno `IA-…` | No dice nada y la fábrica no lo reconoce | Oculto para la vendedora; código legible para los productos nuevos (§13) |
| Piezas T | Sin definición | **Pieza T (jamba)**, o como la llame la tienda, con definición y dibujo |

## 4. Operaciones que hoy son difíciles

| Operación | Dónde empieza | Pasos | Errores posibles | ¿Se puede deshacer? | Retroalimentación |
|---|---|---|---|---|---|
| Crear una puerta nueva (modelo) | Catálogo → Agregar producto | ≈10 por fila × 252 | Precio de venta escrito como costo; error de tipeo que crea otro modelo; espesor escrito en el nombre; tramos que se cruzan (rechazados) | Fila por fila, en Gestionar | Precio de venta **falso** en la vista previa |
| Agregar una madera a un modelo | Igual | 63 filas para Ranco | No se puede copiar la grilla de otra madera | Igual | Igual |
| Cambiar un precio | Gestionar → Editar | Una fila a la vez; sin ajuste masivo | Se pierde al reimportar | No hay historial | Aviso al importar |
| Editar un producto | Gestionar → Editar (12 campos) | — | Dejar el modelo con dos familias; descripción desincronizada | No | «Editado a mano» |
| Duplicar | — | **No existe** | — | — | — |
| Renombrar, pausar o dar de baja un modelo | — | **No existe** (N filas; la planilla lo revierte) | Borradores con «modelo desconocido» | — | — |
| Buscar | Consultar, o el diálogo de la cotización | 1 | 0 resultados para lo que el cliente dice; solo se ven 24 | — | «No encontramos productos» |
| Agregarlo a una cotización | Agregar producto → elegir **una fila exacta** → medidas dentro del tramo | 5–6 | Elegir el tramo equivocado (la 0,60 aparece primero) | Sí (×) | Error si la medida no cae en el tramo |
| Cotizar algo que no existe | 5 caminos | 8–12 | Elegir el que crea filas globales | Depende del camino | Cada camino con sus términos |

**Pregunta central: ¿una trabajadora nueva puede crear correctamente una puerta nueva sin ayuda? No.** Las barreras, en orden:

1. Hay que repetir el formulario por cada combinación.
2. No hay plantilla ni duplicar.
3. El formulario se vacía después de cada alta.
4. «Precio base» se confunde con el precio de venta.
5. La vista previa muestra un precio de venta falso.
6. El campo «Tipo» cambia el margen sin decirlo.
7. Nada dice qué tramos usa la fábrica.
8. No se pueden cargar rangos de alto ni espesor.
9. Un error se corrige fila por fila.
10. El código `IA-…` no significa nada.
11. No hay documentación.

## 5. Modelo conceptual simplificado

```
Tipo de producto  (Puerta · Marco · Pieza T · Moldura)         ← hoy «familia»: enum interno, SIN CAMBIOS
   └─ Modelo       (Ranco, Huilo Huilo, Marco, Guardapolvo…)    ← NUEVA ficha: nombre, tipo, otros nombres,
        │                                                        estado (borrador / activo / pausado), origen
        │                                                        (planilla / se mantiene aquí), estilo, foto y nota
        └─ Madera o terminación  (Pino oregón, Lenga, Prepintada…) ← por modelo: categoría de precio EXPLÍCITA
              └─ Tabla de costos: anchos × altos → costo            ← hoy: filas `Producto` (se conservan tal cual)
                   (accesorios: secciones × largos)

Fuera del catálogo:  Producto especial (solo esta cotización) · Otro cargo
```

**¿Se mantienen las familias?** **Sí, como «Tipo de producto»**, y **no como algo que la clienta administre**. Tienen dependencias reales:

- deciden cómo se pide la medida;
- deciden qué suma al descuento por cantidad;
- se envían a la fábrica (`integracion-pedido.ts:51-56`, `family`);
- las usan la nota de pedido y el PDF.

Son cuatro y estables, así que la clienta solo elige una al crear un modelo. **No hace falta crear familias**, y el asistente debe responder eso cuando se lo pidan.

**¿Plantillas?** Sí: «Partir de un modelo existente» cumple esa función sin una entidad nueva.

**¿Herencia?** Solo a nivel de modelo (tipo, otros nombres, estado) y de madera dentro del modelo (categoría de precio). Las filas no heredan: se generan desde la grilla. Así se evita que editar un padre cambie hijos sin aviso.

## 6. Navegación propuesta

```
Catálogo
 ├─ Buscar            (vista agrupada por modelo, con filtros de tipo, madera y medida; «Cotizar este»)
 ├─ Modelos           (lista de fichas; filtros de tipo y estado; «Nuevo modelo»)
 ├─ Importar planilla (administración)
 ├─ Otros nombres     (solo los nombres de maderas; los de modelo van en la ficha)
 └─ Papelera
```

Desaparecen como secciones «Agregar producto» y «Gestionar catálogo»: se crea desde *Modelos → Nuevo modelo* y se edita dentro de la ficha. «Familia de cada modelo» se va de «Nombres y alias»: el tipo se define en la ficha y se aplica en el acto.

## 7. Flujos nuevos para crear modelos (y tipos)

**Nuevo modelo**, en cuatro pasos:

1. **Nombre y tipo de producto.** Si el nombre se parece a uno existente, avisa: «¿No será Ranco?» (usa `modeloParecido`).
2. **Partir de…:** un modelo existente (copia maderas, tramos y altos y, opcionalmente, los costos con un factor de ±%) o una tabla vacía.
3. **Tabla de costos por madera.** Grilla editable, que admite pegar desde Excel y «copiar de otra madera ±%». Arriba de cada madera va su **categoría de precio**, con el margen y un ejemplo del precio de venta calculado con `margenProducto`, la misma función que usa la cotización.
4. **Revisar y publicar.** Muestra cuántas filas se crean, el rango de medidas y el precio de venta mínimo y máximo. Hasta que se publica, el modelo queda en borrador y no se cotiza.

**Tipos de producto:** no se crean (§5). Si el negocio necesitara uno nuevo, por ejemplo «Ventana», es un cambio de desarrollo coordinado con la fábrica.

## 8. Modificar, duplicar y personalizar

| Acción | Dónde | Efecto | Reglas |
|---|---|---|---|
| **Duplicar modelo** | Ficha → Duplicar | Nuevo modelo en borrador con las mismas maderas y tramos; los costos, con un factor opcional | Códigos nuevos; el original no cambia |
| **Agregar madera** | Ficha → «+ Madera» → «copiar medidas de: Oregón» | Filas nuevas para esa madera | Se elige su categoría de precio |
| **Agregar medida** | Grilla → «+ ancho» / «+ alto» | Filas nuevas | La regla de contigüidad se explica en la grilla («entre 1,45 y 1,50 falta un tramo»); se reutilizan `rangoSuperpuesto` y `anchoNoContiguo` |
| **Ajustar precios** | Ficha → seleccionar → «±%» | Cambia los costos seleccionados | Vista previa antes y después; historial |
| **Renombrar** | Ficha → Renombrar | Cambia el nombre en todas las filas | **El nombre viejo pasa a ser un alias**, así los borradores siguen resolviendo |
| **Cambiar tipo** | Ficha | Aplica a todas las filas | Nunca fila por fila (cierra N-32) |
| **Pausar** | Ficha | No se ofrece en la búsqueda ni en el chat | Sigue resolviendo en las cotizaciones abiertas |
| **Producto especial** | Cotización → Agregar → «Producto especial» | Solo esa cotización | No toca el catálogo; ver 04 §5.3 |
| **Pedir que se agregue** | Desde un especial o un pendiente | Solicitud para administración | Reemplaza «Agregar al catálogo» y «Es un modelo nuevo» del pendiente (cierra N-08) |

## 9. Formularios recomendados

**Ficha de modelo:**

| Campo | Tipo | Ayuda que se muestra |
|---|---|---|
| Nombre | texto, con aviso de parecido | «Como lo conoce el cliente» |
| Tipo de producto | 4 opciones con dibujo y definición | «Define cómo se mide: ancho × alto, o sección × largo» |
| Otros nombres | etiquetas | «Cómo lo escriben los clientes: willow, huilo…» |
| Estilo (opcional) | texto | «Solo informativo; no cambia el precio» |
| Espesor o variante (opcional) | texto corto | Forma parte de la ficha, no del nombre |
| Estado | Borrador / Activo / Pausado | — |
| Origen | Planilla / Se mantiene aquí (solo lectura) | «Si viene de la planilla, la próxima importación lo actualiza» |

**Bloque de madera dentro de la ficha:** la madera, en un selector; la **categoría de precio**, en un selector que viene propuesto por la regla actual y muestra «Ganancia 85 %»; y la **grilla de costos**, con los anchos en filas, los altos en columnas, cada celda con el costo y el precio de venta en gris, y altos que pueden ser rangos.

**Producto especial (en la cotización):** ver 04 §5.3. Son dos etiquetas de precio inconfundibles: «Precio de venta» (obligatorio) y «Costo de fábrica» (opcional).

## 10. Sistema de búsqueda propuesto

**Cómo busca hoy** (`servidor/busqueda.ts`): quita tildes, exige que todas las palabras aparezcan como fragmento de `codigo + modelo + madera + tipo + medida + descripcion`, y compara los números enteros. No usa alias, tolerancia a errores, plurales, familia ni tramos.

**Resultados reales** (8.866 productos):

| Consulta | Hoy (Consultar / Agregar) | Lo que entiende el chat | Esperado |
|---|---:|---|---|
| `ranco` | 252 (se muestran 24, empieza por Lenga) | RANCO | 1 grupo «Ranco · 4 maderas · 0,60–1,45 × 2,0–2,6» |
| `ranko` | **0** | sugiere RANCO | «¿Quisiste decir Ranco?» |
| `willow` / `coscos` / `pangipulli` | **0** | alias OK | Huilo Huilo / Coz Coz / Panguipulli |
| `prepintado` / `enchapado` | **0** / 4 | alias OK | Las puertas prepintadas / enchapadas |
| `puertas` / `moldura` | **0** | — | Filtrar por tipo de producto |
| `ranco 1,00 2,20` | Primero **RAN-L-1-C (0,60 m)** | — | RAN-x-5-C primero |
| `ranco 0,82` / `ranco 85x210` | **0** | tramo 0,80–0,85 | El tramo correcto |
| `marco 4x2` | **0** (2x4 sí) | OK | MAR-x-2X4 |
| `pino oregón 1 metro` / `puerta de 100` | **0** | — | Las de 1,00 m en oregón |
| `puerta especial` | 3.696 puertas anchas | — | Sin ambigüedad tras renombrar a «puerta ancha» |

**Diseño:**

1. Cada palabra pasa por los resolutores de modelo y madera (alias seguros y dudosos, clave tolerante, plurales, sugerencia a una letra). Un alias dudoso **sugiere** y no reemplaza, igual que en el chat.
2. Se ignoran las palabras vacías: «de», «metro», «m», «cm», «para».
3. Las medidas se reconocen: «0,82», «82», «85x210», «1 metro», «100», y filtran por tramo (`anchoMin ≤ a ≤ anchoMax`).
4. «puerta» o «puertas», «marco», «moldura» y similares funcionan como filtro de tipo de producto.
5. El código solo se compara si el término tiene forma de código.
6. Los resultados se **agrupan por modelo**, con chips de madera y el rango de medidas. Al elegir uno aparecen los selectores de madera, ancho y alto, que llevan a la fila exacta. En el diálogo de la cotización, «willow mara 82 210» propone `HUIL-M-3-B`.
7. Un mismo motor para Consultar, Agregar producto y la herramienta `buscar_catalogo` del chat.
8. La tabla de arriba es la prueba de aceptación.

## 11. Compatibilidad con las cotizaciones existentes

- **Aprobadas, reemplazadas y anuladas:** usan su copia (`cotizacion_lineas`, `nota_lineas`). **Sin cambios.** Antes, eso sí, hay que corregir N-01 («Corregir pedido» recotiza las aprobadas).
- **Borradores y emitidas editables:** siguen resolviendo por nombre. Renombrar agrega un alias y pausar no impide resolver, así que no aparecen pendientes nuevos. Mejora opcional: guardar el `codigo` en la solicitud y usarlo primero, con el nombre como respaldo.
- **Notas de pedido y la integración:** reciben el mismo `productCode`, `family`, `model` y `wood`.
- **Productos `IA-…` existentes:** se conservan con su código.

## 12. Riesgos de los cambios de esquema

| Riesgo | Mitigación |
|---|---|
| Al hacer explícita la categoría de precio, cambian precios | Migración que la llena con `categoriaMargen()` actual y verifica 0 diferencias en los 8.866 productos |
| La integración espera las 4 familias y los códigos de planilla | No tocar el enum `FamiliaCatalogo` ni los códigos; los nombres nuevos son solo de interfaz |
| Un modelo con familias mezcladas en los datos | La migración lo **informa** y no lo adivina; se resuelve a mano antes de publicar la ficha |
| La grilla genera solapes o huecos | Validar con `rangoSuperpuesto` y `anchoNoContiguo` |
| La planilla pisa lo editado en la aplicación | Origen visible por modelo; la importación pregunta por los modelos «mantenidos aquí» |
| La búsqueda tolerante confunde modelos parecidos | Mismas reglas del resolutor: lo dudoso sugiere, no reemplaza |
| Se migra sin respaldo | Requisito previo: respaldo verificado (02, etapa 0.1) |
| Más código en archivos ya grandes | Módulos nuevos (`catalogo/modelos.ts`, `servidor/repositorio-modelos.ts`), no más líneas en `repositorio-catalogo.ts` |

## 13. Estrategia de migración

1. **Tabla `modelos`** (nueva): `id`, `nombre`, `nombre_normalizado`, `familia`, `estado`, `origen`, `estilo`, `variante`, `alias_json`, `creado_en`, `creado_por`. Se llena con `SELECT DISTINCT modelo, familia` de `productos_catalogo ∪ productos_adicionales`.
2. **Tabla `modelo_maderas`** (nueva): `modelo_id`, `madera`, `categoria_margen`. Se llena con `categoriaMargen()` sobre una fila representativa; si las filas de un par modelo-madera dan categorías distintas, se informa.
3. **Las filas `Producto` no cambian.** Opcionalmente se agrega `modelo_id` como clave foránea, que se llena por nombre normalizado.
4. **La categoría explícita reemplaza a la deducida** en `margenProducto`, con la deducida como respaldo para las filas sin modelo. Verificación: el precio de los 8.866 productos es idéntico antes y después.
5. Los alias de modelo de `catalogo_configuracion` pasan a `modelos.alias_json`; la configuración global queda solo para las maderas.
6. **Códigos de las altas nuevas:** el mismo patrón de la planilla (`ABREV-MADERA-ANCHO#-ALTO`) con un sufijo que no choque. Hay que coordinarlo con la fábrica (plan conjunto P0–P4, «catálogo versionado») para que no los trate como «a pedido».
7. **Respaldo** verificado antes de migrar, y migración en `BEGIN IMMEDIATE`, como las actuales de `base-datos.ts`.
8. La importación usa la ficha: un modelo nuevo de la planilla aparece en la vista previa como «modelo nuevo», con la pregunta de su tipo (cierra N-35).

## 14. Plan de implementación gradual

| Etapa | Contenido | Cierra | Toca el esquema | Esfuerzo |
|---|---|---|---|---|
| **0 · Arreglos rápidos** | Vista previa del alta con el margen real; etiquetas «Costo de fábrica» y «Precio de venta»; quitar «Agregar al catálogo» y «Es un modelo nuevo» de los pendientes (o pedir confirmación con advertencia, según la decisión de roles); aviso «solo aplica al importar» en Familia de cada modelo; código de madera protegido; `precioConMargen` en Consultar | N-02, N-08 (en parte), N-11 (en parte), N-20, N-21, H16 | No | 1–2 días |
| **1 · Un solo buscador** | §10; resultados agrupados; filtros; «Cotizar este» | N-07, N-42 | No | M |
| **2 · Producto especial único** | Un camino con «¿Lo fabrica Neltume?»; «Pedir que se agregue» | N-08 | No (una tabla pequeña de solicitudes) | M |
| **3 · Ficha de modelo (lectura)** | Tablas `modelos` y `modelo_maderas` con su migración; lista de modelos; ficha con grilla de solo lectura; renombrar, pausar y cambiar tipo | N-32, N-33, N-35 | Sí | M |
| **4 · Categoría de precio explícita** | Columna, migración con verificación y edición en la ficha | N-09 | Sí | M |
| **5 · Crear y duplicar** | Asistente «Nuevo modelo», duplicar, agregar madera o medida, grilla editable con rango de alto y espesor, ajuste ±% | N-06, N-34 | Sí (columnas opcionales) | L |
| **6 · Ayuda y glosario** | «Catálogo en 5 minutos», ayudas en contexto, manual; el asistente explica el catálogo | N-11, H15 | No | S |

Las etapas 0, 1 y 2 no tocan el esquema y dan casi todo el alivio inmediato. Las 3 a 5 requieren el respaldo y la decisión de roles.

## 15. Criterios de aceptación

1. Una persona nueva crea «Roble» (4 maderas, la misma estructura que Ranco) **en menos de 10 minutos y menos de 40 acciones**, sin ayuda, y lo cotiza desde el chat y desde «Agregar producto».
2. Toda vista previa de precio de venta coincide con la línea cotizada en el 100 % de las categorías.
3. Cambiar el estilo, el nombre o la descripción no cambia el precio.
4. Las consultas de §10 que hoy dan 0 encuentran el producto esperado o sugieren el correcto, y «ranco 1,00 2,20» muestra primero el tramo de 1,00.
5. Renombrar o pausar un modelo no deja pendientes nuevos en los borradores existentes.
6. La migración no cambia el precio, el código, la familia ni la descripción de ninguno de los 8.866 productos (comparación antes y después).
7. Las cotizaciones aprobadas y anuladas, las notas de pedido y el JSON enviado a la fábrica son idénticos a los de hoy.
8. Ningún camino de un clic desde un pendiente crea filas globales sin confirmación explícita (y sin revisión, si se crea el rol de vendedora).
9. Cotizar una puerta de otro espesor, o de 1,60 m, no cambia el catálogo.
10. El asistente responde «¿En qué familia va esta puerta?» con el glosario, y «crear una familia» con «los tipos de producto son fijos; puedo ayudarte a crear un modelo».

## 16. Escenarios de prueba de usabilidad

Con la clienta y con una persona nueva, sin ayuda verbal. Se mide el éxito, el tiempo, los errores, **las palabras que no se entienden (literales)** y la confianza declarada (de 1 a 5).

1. «La fábrica sacó el modelo Roble, igual a Ranco pero un 10 % más caro. Agrégalo.»
2. «Ranco ahora también viene en Raulí, con los mismos precios que Lenga. Agrégalo.»
3. «La fábrica subió un 5 % las puertas Huilo Huilo en Oregón. Actualízalo.»
4. «Un cliente pide una “willow de 82 por 210 en mara”. Búscala y agrégala a una cotización sin usar el chat.»
5. «Un cliente quiere una puerta de 1,60 m de ancho. Cotízala.» Se espera un producto especial, sin tocar el catálogo.
6. «Un cliente quiere una Ranco de 45 mm de espesor.» Se espera un producto especial con la variante, o duplicar la línea y convertirla.
7. «El cliente quiere además la instalación por $80.000.» Se espera «Otro cargo», que no va a la fábrica.
8. «Te equivocaste: el modelo nuevo se llama Robles, no Roble. Corrígelo.» El borrador abierto debe seguir con su precio.
9. «La fábrica dejó de hacer Ranco en Raulí. Haz que no se ofrezca.»
10. «¿A cuánto se vende una Ranco Lenga de 0,80 × 2,10 y cuánto cuesta en fábrica?»
11. «Explícale a una compañera nueva qué es un “tipo de producto” y qué es un “modelo”.» Mide la comprensión.
