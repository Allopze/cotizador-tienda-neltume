# Estilo común de los documentos v1 (tienda ↔ fábrica)

**Estado:** acordado entre los agentes de los dos repositorios y aprobado por el usuario el 25-10-2026. La fábrica lo aplicó y lo desplegó (fase F22, el lector tolerante, y F23, el restilo de sus cuatro PDF; su ADR-0025). En la tienda está implementado en la rama `feat/estandar-documentos`, pendiente de mergear y desplegar.

**Alcance:** el aspecto de los PDF que emite cada aplicación (cotización, nota de pedido, orden de trabajo y prueba de conexión). No cambia el contrato de la integración ([`integracion-fabrica.md`](integracion-fabrica.md)) ni qué datos lleva cada documento: cada aplicación conserva sus campos propios (sección 9).

**Fuente de verdad:** este archivo y [`estilo-documentos-tokens.json`](estilo-documentos-tokens.json), idénticos en los dos repositorios (en la fábrica, en `docs/contratos/`). Un cambio se acuerda en los dos repos antes de aplicarse; si altera algo de la sección 8, se avisa antes de publicarlo.

## 1. Hoja

- A4 vertical. Márgenes: 14 mm arriba, a la izquierda y a la derecha; 17 mm abajo (el pie).
- Tinta sobre fondo blanco. El único relleno es el fondo suave de las cajas (sección 6).

## 2. Colores

| Token | Valor | Uso |
| --- | --- | --- |
| `tinta` | `#1d2b24` | Texto, filetes fuertes |
| `gris` | `#58615a` | Etiquetas, texto secundario, pie |
| `filete` | `#dcddd3` | Líneas entre filas |
| `fondoSuave` | `#f2f3ec` | Cajas («Para fábrica», «Para aceptar», avisos) |
| `verde` | `#2d4938` | Acento principal: filete del encabezado, insignia de la fábrica, cifra del total |
| `rauli` | `#9a4524` | Acento cálido: ahorro por descuento especial (el texto del ítem y la línea «Ahorro desc. especiales»), rótulo y marca de la prueba de conexión |
| `anulada` | `#aa1e1e` | Solo ANULADA: aviso y marca de agua |

## 3. Tipografía

| Fuente | Archivo | Uso |
| --- | --- | --- |
| Fraunces 500 | `fraunces-latin-500-normal.woff` | Tipo y número del documento, títulos, cifras grandes |
| Instrument Sans 400 | `instrument-sans-latin-400-normal.woff` | Texto, etiquetas, pie |
| Instrument Sans 600 | `instrument-sans-latin-600-normal.woff` | Énfasis, encabezado de tabla, valores del encabezado |
| JetBrains Mono 400 | `jetbrains-mono-latin-400-normal.woff` | Códigos que van solos en su campo |

- Los cuatro archivos son los mismos, byte a byte, en las dos aplicaciones (licencia SIL Open Font 1.1, `OFL`); el sha256 de cada uno está en el archivo de tokens y cada repositorio lo comprueba.
- Tamaños y colores por rol: sección `roles` del archivo de tokens (texto 9,2 pt; etiqueta 7,3 pt; tipo 11 pt; número 29 pt; título de bloque 15 pt; cifra del total 22 pt; pie 7,5 pt).
- **Sin ligaduras, sin separación silábica y sin interletrado** en los textos que lee la fábrica (sección 8) y, por uniformidad, en los demás. Con un interletrado grande pdfjs parte el texto por letras (en los PDF de Chromium, desde unos 0,12 em); en los PDF de la fábrica también ocurre con ligaduras.
- **Mono solo cuando el código es un campo propio** (el código del producto en la cotización, el código de la prueba de conexión). Dentro de una frase («Referencia de catálogo: MOL-O-3-A · 0,80–0,85 × 2,00 m») va en la fuente del texto: cambiar de fuente parte el fragmento que lee la fábrica.
- El encabezado de la tabla no se fuerza a mayúsculas.

## 4. Encabezado

- **Izquierda: solo el logo, el de cada aplicación** (imagen vectorial; el estándar fija dónde va, no cuál es: la tienda pone la caja NEL/TU/ME o el que se guarde en Ajustes; la fábrica, el suyo). Ningún texto a la izquierda a la altura del tipo y del número (en la nota de la tienda, que lee la fábrica, es el ancla 1 de la sección 8). Los datos de la empresa van en el bloque «Emisor» o «Cliente» y en el pie; la fábrica, además, puede llevar un bloque con sus datos bajo el logo, siempre más abajo que el número.
- **Derecha, en dos líneas:** el tipo del documento («Nota de pedido», «Cotización», «Orden de trabajo», «Prueba de conexión») en gris, y debajo su número como `N.º 577` en un solo fragmento. En una nota, la insignia verde `Fábrica Panguipulli`.
- **Debajo, en columnas con la etiqueta arriba y el valor abajo** (alineadas a la derecha): Fecha, Cotización, Válida hasta, Aprobada por, Emitida por… según el documento.
- Un filete verde de 0,7 pt cierra el encabezado.

## 5. Cuerpo

- **Bloques de partes** (Cliente, Obra, Despacho, Emisor, Destino): etiqueta pequeña, título en Fraunces 15 pt y, debajo, los datos como pares etiqueta (gris) y valor.
- **Tabla:** encabezado en Instrument Sans 600 de 7,3 pt, gris, con filete de tinta debajo; filas con filete suave de 0,5 pt. Cantidad, unitario y total alineados a la derecha. Repetir el encabezado en las páginas siguientes es propio de cada aplicación (la tienda lo repite; la fábrica, hoy, no); si se repite, va en una sola línea.
- **Totales:** a la derecha, con `Neto` / `Subtotal`, `IVA`, y `Total` en Fraunces 12 pt junto a la cifra en Fraunces 22 pt, verde, sobre un filete de tinta. El ahorro por descuento especial, en raulí; la línea del descuento general, en gris y tinta.
- **Montos** `$1.234`, un solo fragmento. Un precio que aún no existe se imprime `Por definir`, nunca `$0`.

## 6. Cajas, pie y marcas de agua

- **Cajas** (observaciones a mano, «Para fábrica», «Para aceptar»): fondo suave, título en Fraunces 14 pt; el campo para escribir a mano lleva borde de gris y fondo blanco.
- **Pie de cada página** a 7,5 pt, Instrument Sans, gris: a la izquierda los datos de Neltume y a la derecha `Página n de m`. Si los datos no caben en una línea (con la dirección configurada), pasan a dos y `Página n de m` queda en la última.
- **Marcas de agua** en diagonal (−28°), Instrument Sans 600 y muy tenues: `ANULADA` en `anulada` (opacidad 0,16) y `PRUEBA` en `rauli` (0,09).

## 7. Formatos

| Dato | Formato |
| --- | --- |
| Número de documento | `N.º 577` (con `º`, U+00BA) |
| Fecha del encabezado | En palabras: `25 de octubre de 2026` |
| Fecha en tablas y campos («Entrega», vigencias) | `dd-mm-aaaa` |
| Fecha y hora (solo la prueba de conexión) | `dd-mm-aaaa hh:mm`, hora de Chile, en vez de la fecha en palabras |
| Monto | `$1.234` |
| Sin precio | `Por definir` |
| Nombre de descarga | `Neltume - {Tipo} N.º {n}[ {Fábrica}][ (anulada)].pdf`, p. ej. `Neltume - Nota de pedido N.º 577 Panguipulli.pdf`. La fábrica no lleva segmento de fábrica (es la fábrica) ni el sufijo « (anulada)» (en sus pedidos el término es «cancelada» y hoy no se usa); en las dos, `Content-Disposition` lleva además un `filename` ASCII de respaldo |
| Título del PDF | `{Tipo} N.º {n}[ · {Fábrica}] · Neltume`; sin segmento de fábrica en la fábrica. En su orden de trabajo, `n` es el número de la nota |

**Metadatos del PDF:** título común (arriba). Autor, creador y productor «Neltume.co» solo donde el generador lo permita: la fábrica sí; la tienda no, porque Chromium fija el creador y el productor (`Skia/PDF`) y no los deja cambiar. Es una brecha conocida; se cierra solo si la tienda incorpora una librería que reescriba los metadatos.

## 8. No cambiar sin avisar: anclas de lectura de la nota de pedido

La fábrica lee la **nota de pedido comercial** de la tienda con pdfjs, por fragmentos de texto y posiciones (respaldo manual, ADR-0008, y validación de lo que llega por la API). La **cotización** no se lee; la **orden de trabajo** solo se verifica (sección 8.4). Cualquier cambio de tipografía, tamaños, márgenes, columnas o textos que mueva algo de esta lista se avisa a la otra parte antes de publicarlo. En la tienda, las anclas se comprueban en `tests/pdf-estandar.test.ts` (sobre el PDF real) y los estilos que las sostienen (sin interletrado ni ligaduras, versión del estilo) en `tests/pdf.test.ts`.

### 8.1 Encabezado

1. **«Nota de pedido» y su número.** El fragmento `Nota de pedido` va seguido, dentro de los 3 fragmentos siguientes en el orden de lectura (de arriba abajo, de izquierda a derecha), de un fragmento propio `N.º n`. Nada de la columna izquierda debe quedar entre el tipo y el número: con el logo (imagen) a la izquierda y el bloque de tipo y número a la derecha, ningún texto lo interrumpe. Requisito del lector de la fábrica: a partir de su fase F22 acepta `N.º` y también `N°`; hasta que esa fase esté desplegada solo lee `N°`, por eso la tienda no publica `N.º` antes (sección 11).
2. **`Fábrica X`** (p. ej. `Fábrica Panguipulli`): fragmento exacto; la fábrica toma la **primera** coincidencia en el orden de lectura, así que ningún texto que empiece por `Fábrica ` va más arriba que la insignia. Una nota vigente no lleva el texto `ANULADA`.
3. **`Cotización` y `Despacho`:** fragmentos exactos; el valor va justo debajo (a ≤ 15 pt en x). La fábrica toma la **primera** coincidencia del documento: `Despacho` no se repite como título de un bloque más arriba.
4. **La fecha en palabras** va entera en un solo fragmento, y la primera que aparece sobre el encabezado de la tabla es la de la nota (no `Válida hasta`).

### 8.2 Tabla de ítems

5. **Encabezado de la tabla:** `Cant.`, `Precio fábrica` y `Total` (columna) en una sola línea, con la misma línea base. Si se repite en las páginas siguientes, también va en una sola línea con `Cant.` y `Precio fábrica` en la misma línea base. Requisito del lector de la fábrica: a partir de su F22 ignora toda línea que lleve `Cant.` al buscar descripción, cantidad y totales (hasta entonces, el `Total` de la columna de las páginas siguientes deja el total de la nota en `null`, que nadie usa).
6. **Cantidad:** un fragmento de solo dígitos cuya x de inicio queda a menos de 20 pt de la x de `Cant.` (la fábrica prevé ensanchar su tolerancia a 30 pt, pero no se depende de ello hasta que lo avise). Si ambas van alineadas a la derecha, el margen es estrecho: no se ensanchan las columnas. Requisito del lector de la fábrica (F22, sin desplegar): la cantidad queda a ≤ 120 pt sobre la `Referencia de catálogo` del ítem y por debajo de la referencia del ítem anterior de la misma página; con descripciones largas la fila crece y la cantidad, que va al centro, se aleja (el límite anterior, 40 pt, lo superaba una descripción de unos 200 caracteres).
7. **Montos:** cada monto es un solo fragmento (`$159.485`, no `$` aparte). En la línea del ítem la fábrica lee al menos 2 montos: el primero es el unitario y el último el total. Un pedido especial sin costo de fábrica lleva `Por definir` en los dos lugares.
8. **Misma línea base (±3 pt)** entre la cantidad y los montos del ítem, y entre la etiqueta `Total` y su cifra (la cifra grande en verde y la etiqueta de menor tamaño comparten línea base).
9. **Referencia de catálogo:** `Referencia de catálogo: CÓDIGO · medidas` en un solo fragmento, en la fuente del texto. Es el ancla del ítem: una línea sin ella no se lee (los pedidos especiales llevan `Producto personalizado, fuera de catálogo`; hoy el respaldo manual de la fábrica los omite sin avisar; su F22 propone leerlos como «a pedido, revisar» o, como mínimo, avisar, y lo decide el usuario).
10. **Descripción:** la fábrica toma el fragmento más alto en la misma x que la referencia (±3 pt), dentro de 20 pt sobre la línea de la cantidad. Ahí no debe haber otro texto (por ejemplo, la referencia del ítem anterior más cerca de 20 pt). De una descripción de dos líneas se lee solo la primera; con filas muy altas el lector toma una línea intermedia, y no importa: la descripción de la nota no se usa (el pedido toma la del catálogo por el código).

### 8.3 Totales y despacho

11. **Etiquetas con el valor a la derecha:** `Neto`, `Total`, `Entrega comprometida`, `Dirección de despacho` y `Transporte`. El valor es **todo** lo que queda a la derecha de la etiqueta en esa línea (la fábrica une los fragmentos): nada más en esa línea (un `IVA` al lado de `Neto` rompería el monto). Montos `$1.234`; la entrega en `dd-mm-aaaa`, nunca en fecha larga.

### 8.4 Orden de trabajo y límites

12. **Orden de trabajo:** no contiene un `$` seguido de un dígito y muestra el número del pedido. No lleva datos del cliente ni nombres del personal.
13. **Documento comercial:** muestra los dígitos del número de la nota.
14. **Texto de las anclas:** sin interletrado ni ligaduras (un interletrado grande hace que pdfjs parta el texto por letras).
15. **Archivo:** ≤ 5 MiB y ≤ 20 páginas.

## 9. Qué conserva cada aplicación

- **Las dos:** su logo y sus precios. El estándar no toca ni uno ni otro: solo fija el aspecto.
- **Tienda:** precios al cliente (de venta en la cotización, de fábrica en la nota); encabezado de la tabla repetido en cada página; condiciones de pago, validez y datos bancarios; caja «Para aceptar esta cotización»; dibujo de cada modelo y planos con cotas en la nota; casilla «Listo»; bloque «Para fábrica» con firmas; logo personalizable desde Ajustes; descuentos por ítem y por cantidad.
- **Fábrica:** sus precios (su lista); sus campos de producción; los códigos en mono; las líneas Pagado/Saldo y Descuento con motivo bajo «Total» del pedido; la caja vacía para escribir a mano en pedido y orden de trabajo.

## 10. Documentos ya emitidos

- **Tienda:** guarda el HTML de cada documento emitido (`documentos_snapshot`). Un documento del estándar lleva `<meta name="neltume-estilo" content="1">`; uno sin la marca es anterior y se reimprime como se emitió, con sus fuentes (`newsreader.woff2` y `host-grotesk.woff2` se conservan por eso) y su pie de entonces.
- **Fábrica:** no guarda los PDF (ADR-0004): se generan al descargar desde datos congelados. Una cotización ya emitida que se descargue después del restilo sale con el estilo nuevo, con los mismos precios, texto y fecha.

## 11. Verificación

- Cada repositorio lleva una prueba de conformidad que imprime los documentos con datos inventados y los lee con pdfjs: fuentes del estándar (y sus sha256), márgenes, pie y las anclas de la sección 8.
- Los PDF de ejemplo para probar el lector de la fábrica se generan con datos inventados, nunca con datos reales.
- La tienda no despliega el cambio de `N°` a `N.º` antes de que el lector tolerante de la fábrica esté desplegado y probado con sus PDF.
