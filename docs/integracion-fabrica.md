# Integración tienda → fábrica de Panguipulli · contrato v1

Contrato entre el **cotizador de la tienda Neltume** (este repositorio, emisor) y la **aplicación de la fábrica de Panguipulli** (repositorio aparte, receptor). Las dos aplicaciones siguen siendo independientes: repositorios, bases de datos, usuarios y despliegues separados. Se comunican solo de servidor a servidor, por HTTPS, con solicitudes firmadas.

La fuente de verdad del contrato en este repositorio son los esquemas Zod de [`src/servidor/integracion-contrato.ts`](../src/servidor/integracion-contrato.ts) y la firma de [`src/servidor/integracion-firma.ts`](../src/servidor/integracion-firma.ts). Si este documento y el código difieren, manda el código; avisa para corregir el documento.

## 1. Cuándo se envía

| Situación en la tienda | ¿Se envía? | Evento |
| --- | --- | --- |
| Se generan las notas de pedido (`generar_nota`) y una es de **Panguipulli** | Sí, solo esa nota | `order.ready`, revisión 1 |
| Nota de **Santiago** | Nunca | — |
| Borrador, cotización emitida o aprobada sin nota de pedido | Nunca | — |
| Se cambia el número de la nota de Panguipulli, de la de Santiago (la de Panguipulli la nombra) o de la cotización: se reimprime la nota | Sí, si el pedido ya se había enviado | `order.ready`, revisión siguiente |
| Se anula la cotización (la nota queda anulada) | Sí, si el pedido ya se había enviado | `order.cancelled`, revisión siguiente |
| Notas generadas antes de activar la integración | No (se pueden encolar a mano: `npm run integracion -- encolar <N° cotización>`) | — |

La nota de pedido se genera solo con la cotización aprobada, con al menos el 50 % pagado y con la fábrica asignada a cada ítem: nunca sale un pedido preliminar o incompleto. La fábrica se identifica por su identificador interno (`panguipulli`), no por el nombre que se muestra.

La persona que cotiza no hace nada distinto: no hay botón ni confirmación. El envío corre en segundo plano y nunca demora ni hace fallar la nota.

## 2. Endpoints que implementa la fábrica

| Método y ruta | Cuerpo | Para qué |
| --- | --- | --- |
| `PUT /api/integrations/neltume/attachments/{sha256}` | bytes del archivo (`Content-Type`: `image/jpeg`, `image/png`, `image/webp` o `application/pdf`; hasta 10 MB) | Referencias del cliente (fotos, croquis). Se suben **antes** del pedido que las nombra. |
| `POST /api/integrations/neltume/orders` | JSON del mensaje (sección 4; hasta 20 MB) | Pedido nuevo, revisión o anulación. |

Ambos solo por HTTPS con certificado válido (la tienda no acepta certificados inválidos ni sigue redirecciones). No exponer estas rutas a usuarios ni sesiones: se autentican solo con la firma. La prueba de conexión (sección 12) es una tercera ruta, que implementan las dos aplicaciones.

### Adjuntos

- `{sha256}` es el SHA-256 hexadecimal (minúsculas) del contenido. La fábrica debe **verificar** que `sha256(cuerpo) == {sha256}` y rechazar con 422 si no coincide.
- Es idempotente: si ya tiene ese archivo, responde 200 sin hacer nada. Respuesta esperada: `200`, `201` o `204` (cuerpo indiferente).
- `X-Idempotency-Key: neltume-store:attachment:{sha256}`.

## 3. Cabeceras y firma

| Cabecera | Valor |
| --- | --- |
| `X-Neltume-Timestamp` | Segundos Unix (entero en decimal) del momento del envío. |
| `X-Neltume-Signature` | `v1=` + HMAC-SHA256 en hexadecimal minúsculo. Puede traer varias separadas por coma (`v1=…,v1=…`). |
| `X-Idempotency-Key` | Pedidos: `neltume-store:{sourceOrderId}:{destinationFactoryCode}:{sourceOrderRevision}`. Adjuntos: `neltume-store:attachment:{sha256}`. |
| `Content-Type` | `application/json` (pedidos) o el tipo del archivo (adjuntos). |

**Cálculo de la firma** (idéntico en ambos repositorios):

```
mensaje_firmado = UTF8(timestamp) ‖ UTF8(".") ‖ bytes_originales_del_cuerpo
firma           = hex( HMAC-SHA256( clave = UTF8(secreto), mensaje_firmado ) )
cabecera        = "v1=" + firma
```

**Verificación en la fábrica**, en este orden y antes de interpretar el JSON:

1. Leer el cuerpo como bytes crudos (sin parsear ni normalizar).
2. Rechazar con **401** si falta alguna cabecera, si el timestamp no es un entero o si difiere en más de **300 s** del reloj de la fábrica.
3. Calcular la firma con cada secreto vigente y compararla en **tiempo constante** con cada `v1=` de la cabecera. Sin coincidencia: **401**.
4. Recién entonces parsear y validar el JSON.

La referencia es `verificarFirma` en [`integracion-firma.ts`](../src/servidor/integracion-firma.ts). Vector de prueba:

```
secreto   = clave-de-ejemplo-de-32-caracteres!!
timestamp = 1700000000
cuerpo    = {"a":1}
firma     = v1=b0803f898b2ee4c6ca49b967fce6ecac5066ef75f4c37f9785b92a47269b7552
```

**Rotación del secreto:** la fábrica acepta dos secretos durante el cambio (el nuevo y el anterior); se cambia en la tienda; cuando la bandeja quedó al día, la fábrica retira el anterior.

## 4. Mensaje (`POST /api/integrations/neltume/orders`)

Claves en inglés, como el contrato acordado; los textos (modelos, maderas, descripciones) van tal como los guarda el cotizador, en español. Montos en pesos chilenos enteros, netos (sin IVA). Fechas ISO 8601 en UTC. Las medidas van en milímetros enteros.

### Sobre

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `schemaVersion` | `"1.0"` | Versión del contrato. Una fábrica que no la conoce responde 422. |
| `eventType` | `"order.ready"` \| `"order.cancelled"` | `order.ready` trae el pedido completo (también en revisiones); `order.cancelled`, la anulación. |
| `eventId` | UUID | Único por evento; estable en todos los reintentos del mismo evento. La confirmación debe devolverlo. |
| `source` | `"neltume-store"` | Emisor. |
| `sourceOrderId` | string (hoy un UUID) | Id del pedido en la tienda (su cotización). Junto con `destinationFactoryCode` identifica el pedido. Estable entre revisiones. |
| `sourceOrderRevision` | entero ≥ 1 | 1, 2, 3… por pedido. Una revisión mayor reemplaza a las anteriores. |
| `destinationFactoryCode` | `"PANGUIPULLI"` | Fábrica destino. |
| `issuedAt` | fecha ISO | Cuándo la tienda registró el evento (no cambia al reintentar). |
| `order` | objeto | Solo en `order.ready`. |
| `documents` | objeto | Solo en `order.ready`. |
| `cancellation` | objeto | Solo en `order.cancelled`. |

### `order`

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `orderNumber` | string | N° de la nota de pedido de Panguipulli (correlativo propio de la fábrica, p. ej. `"577"`). Puede cambiar en una revisión (renumeración). |
| `orderDate` | fecha ISO | Fecha de la nota. |
| `quoteNumber` | entero | N° de la cotización de la tienda. |
| `approvedBy`, `issuedBy` | null | Siempre null: la fábrica no guarda las cuentas de la tienda (D1). |
| `customer` | objeto | Solo `project` (la obra, string \| null). `name`, `taxId`, `businessActivity`, `phone`, `address` y `commune` van siempre null: la fábrica no guarda datos personales del cliente final (D1 del ADR-0023 de la fábrica). Siguen dentro del PDF comercial. |
| `delivery` | objeto | `address` (dirección de despacho), `carrier` (transporte), `destination`, `committedDelivery` (texto o fecha acordada). Todos string \| null. Sin el valor del flete. |
| `items` | arreglo (1–100) | Las filas de la nota de esta fábrica, en el mismo orden y numeración que los PDF. Ver abajo. |
| `notes` | string | Observaciones de la nota ("" si no hay). |
| `relatedOrders` | arreglo | Otras notas de la misma cotización para otras fábricas: `{ factoryCode, orderNumber, itemCount }`. Solo informativo. |
| `commercial` | objeto | Datos comerciales, **separados de los ítems** para que producción no los vea. Ver abajo. |

### `order.items[]`

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `lineNumber` | entero ≥ 1 | N° de la fila en ambos PDF. |
| `sourceItemIndex` | entero ≥ 0 \| null | Posición del ítem en la cotización (desde 0). |
| `productCode` | string | Código del catálogo (`"MOL-O-3-A"`) o `"ESPECIAL"` para un producto fuera de catálogo. |
| `catalogReference` | string \| null | Producto base del catálogo con sus medidas de lista (`"MOL-O-3-A · 0,80–0,85 × 2,00 m"`); null en un especial. |
| `isCustom` | boolean | Producto fuera de catálogo (pedido especial). |
| `family` | `"PUERTA"` \| `"MARCO"` \| `"PIEZAS_T"` \| `"MOLDURA"` | Familia. |
| `model`, `wood`, `productType` | string / string \| null | Modelo (o nombre del especial), madera y tipo de catálogo. |
| `description` | string | Lo que imprime la nota: la descripción escrita a mano o el producto con la medida pedida. |
| `descriptionEdited` | boolean | `true` si la descripción la escribió la vendedora (siempre en un pedido especial); `false` si es la del catálogo. |
| `quantity` | entero ≥ 1 | Cantidad. |
| `dimensions.widthMm` | entero \| null | Ancho pedido en mm; en PUERTA, el de la hoja o el vano; en MARCO y MOLDURA especiales, el que escribe la vendedora, o `null` si no lo escribe. |
| `dimensions.heightMm` | entero \| null | Alto pedido de una puerta. |
| `dimensions.lengthMm` | entero \| null | Largo de un marco, moldura o pieza T. |
| `dimensions.section` | string \| null | Escuadría o sección de un marco, moldura o pieza T (`"2X4"`). |
| `dimensions.measureType` | `"hoja"` \| `"vano"` \| `"no_especificado"` \| null | Si la medida es de la hoja o del vano (hueco del muro). **Dato crítico para fabricar.** |
| `dimensions.requested` | string \| null | La medida como la imprime la nota (`"820 × 2000 mm (Hoja)"`). |
| `observations` | string \| null | Observación del ítem. |
| `references` | arreglo (0–10) | Referencias del cliente: `{ attachmentId (sha256), filename, mimeType, sizeBytes }`. El archivo ya se subió con `PUT …/attachments/{attachmentId}`. |

### `order.commercial`

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `currency` | `"CLP"` | |
| `basis` | `"factory_price_net"` | Precios de fábrica, netos: los mismos del documento comercial. Nunca el precio de venta al cliente ni su margen. |
| `lines[]` | `{ lineNumber, unitPrice, lineTotal }` | Por fila. `unitPrice` y `lineTotal` son `null` en un pedido especial «Por definir» (sin costo de fábrica conocido; no suma). |
| `subtotal`, `discount`, `net`, `vat`, `total` | enteros | Totales de la nota. `discount` es hoy siempre 0: la nota va a precio de fábrica sin descuentos (los descuentos son del cliente). |
| `vatRate` | número | Tasa de IVA (0,19). |

### `documents`

`commercial` y `production`, cada uno `{ filename, mimeType: "application/pdf", contentBase64, sha256 }`. La fábrica debe verificar el `sha256` de los bytes decodificados.

- **`commercial`**: el PDF de la nota de pedido exactamente como lo emitió la tienda (el mismo archivo que se descarga), con precios de fábrica y totales. Nombre: `nota-pedido-panguipulli-{orderNumber}-comercial.pdf`.
- **`production`**: la **orden de trabajo**, generada con la misma plantilla, los mismos datos y la misma fecha que la nota: mismas filas, planos con cotas, medidas, observaciones y referencias, **sin** precios, totales, IVA ni descuentos (no están en el contenido, no solo ocultos) y **sin** los datos del cliente (nombre, RUT, giro, teléfono, dirección) ni los nombres del personal de la tienda: lleva solo la obra y el despacho, como `customer` (la fábrica no guarda datos personales). Su aspecto sigue el estilo común de los documentos ([`estilo-documentos-v1.md`](estilo-documentos-v1.md)). Nombre: `nota-pedido-panguipulli-{orderNumber}-produccion.pdf`.

Ambos documentos y `order` son la misma versión del pedido.

### `cancellation` (`order.cancelled`)

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `orderNumber` | string | N° vigente de la nota. |
| `quoteNumber` | entero \| null | N° de la cotización. |
| `cancelledAt` | fecha ISO | Cuándo se anuló. |
| `cancelledBy` | null | Siempre null (D1). |
| `reason` | string \| null | Motivo escrito, si lo hay. |

### Ejemplo (datos anonimizados)

```json
{
  "schemaVersion": "1.0",
  "eventType": "order.ready",
  "eventId": "6f1c2a7e-3b9d-4c51-9a0e-2d7b8f41c6aa",
  "source": "neltume-store",
  "sourceOrderId": "0b6f7d0c-5a43-4f7e-b1f6-8e2c9d3a7f10",
  "sourceOrderRevision": 1,
  "destinationFactoryCode": "PANGUIPULLI",
  "issuedAt": "2026-10-24T15:02:11.384Z",
  "order": {
    "orderNumber": "577",
    "orderDate": "2026-10-24T15:02:10.912Z",
    "quoteNumber": 329,
    "approvedBy": null,
    "issuedBy": null,
    "customer": {
      "name": null,
      "taxId": null,
      "businessActivity": null,
      "phone": null,
      "address": null,
      "commune": null,
      "project": "Edificio Los Robles"
    },
    "delivery": {
      "address": "Camino a Niebla km 3",
      "carrier": "Starken",
      "destination": null,
      "committedDelivery": "15 de noviembre"
    },
    "items": [
      {
        "lineNumber": 1,
        "sourceItemIndex": 0,
        "productCode": "MOL-O-3-A",
        "catalogReference": "MOL-O-3-A · 0,80–0,85 × 2,00 m",
        "isCustom": false,
        "family": "PUERTA",
        "model": "MOLCO",
        "wood": "PINO OREGON",
        "productType": "PUERTA PANEL",
        "description": "Puerta Molco oregón, panel liso",
        "descriptionEdited": true,
        "quantity": 2,
        "dimensions": { "widthMm": 820, "heightMm": 2000, "lengthMm": null, "section": null, "measureType": "hoja", "requested": "820 × 2000 mm (Hoja)" },
        "observations": "Bisagras a la derecha",
        "references": []
      },
      {
        "lineNumber": 2,
        "sourceItemIndex": 1,
        "productCode": "MAR-O-2X4-A",
        "catalogReference": "MAR-O-2X4-A · 2,10 m",
        "isCustom": false,
        "family": "MARCO",
        "model": "MARCO",
        "wood": "PINO OREGON",
        "productType": null,
        "description": "Marco Pino Oregon 2x4 pulg. kit",
        "descriptionEdited": false,
        "quantity": 3,
        "dimensions": { "widthMm": null, "heightMm": null, "lengthMm": 2100, "section": "2X4", "measureType": "no_especificado", "requested": "2x4 pulg. × 2,10 m" },
        "observations": null,
        "references": []
      },
      {
        "lineNumber": 3,
        "sourceItemIndex": 2,
        "productCode": "ESPECIAL",
        "catalogReference": null,
        "isCustom": true,
        "family": "PUERTA",
        "model": "Puerta según diseño cliente",
        "wood": "Roble",
        "productType": null,
        "description": "Puerta según diseño cliente · Roble",
        "descriptionEdited": true,
        "quantity": 1,
        "dimensions": { "widthMm": 900, "heightMm": 2100, "lengthMm": null, "section": null, "measureType": "vano", "requested": "900 × 2100 mm (Vano)" },
        "observations": "Copiar el tallado de la foto",
        "references": [
          { "attachmentId": "3f0a…(64 hex)…", "filename": "foto-puerta-cliente.png", "mimeType": "image/png", "sizeBytes": 482113 }
        ]
      }
    ],
    "notes": "Entregar en obra, coordinar con el jefe de obra.",
    "relatedOrders": [{ "factoryCode": "SANTIAGO", "orderNumber": "59", "itemCount": 1 }],
    "commercial": {
      "currency": "CLP",
      "basis": "factory_price_net",
      "lines": [
        { "lineNumber": 1, "unitPrice": 100000, "lineTotal": 200000 },
        { "lineNumber": 2, "unitPrice": 20000, "lineTotal": 60000 },
        { "lineNumber": 3, "unitPrice": null, "lineTotal": null }
      ],
      "subtotal": 260000,
      "discount": 0,
      "net": 260000,
      "vatRate": 0.19,
      "vat": 49400,
      "total": 309400
    }
  },
  "documents": {
    "commercial": { "filename": "nota-pedido-panguipulli-577-comercial.pdf", "mimeType": "application/pdf", "contentBase64": "JVBERi0xLjQK…", "sha256": "9c1e…(64 hex)…" },
    "production": { "filename": "nota-pedido-panguipulli-577-produccion.pdf", "mimeType": "application/pdf", "contentBase64": "JVBERi0xLjQK…", "sha256": "a47d…(64 hex)…" }
  }
}
```

Anulación:

```json
{
  "schemaVersion": "1.0",
  "eventType": "order.cancelled",
  "eventId": "c2d4…",
  "source": "neltume-store",
  "sourceOrderId": "0b6f7d0c-5a43-4f7e-b1f6-8e2c9d3a7f10",
  "sourceOrderRevision": 2,
  "destinationFactoryCode": "PANGUIPULLI",
  "issuedAt": "2026-10-26T12:40:00.000Z",
  "cancellation": { "orderNumber": "577", "quoteNumber": 329, "cancelledAt": "2026-10-26T12:40:00.000Z", "cancelledBy": null, "reason": "El cliente desistió" }
}
```

## 5. Respuestas de la fábrica

La fábrica responde **2xx solo después de guardar** el evento de forma durable (en su base, en una transacción). Recién con esa confirmación la tienda lo da por entregado.

**Éxito** (`200`, `201` o `202`):

```json
{ "status": "accepted", "eventId": "6f1c2a7e-…", "factoryOrderId": "F-2026-0142", "receivedAt": "2026-10-24T15:02:12Z" }
```

- `status`: `"accepted"` (nuevo) o `"duplicate"` (ya lo tenía: misma `X-Idempotency-Key` y mismo contenido). Ambos cuentan como entregado.
- `eventId`: **obligatorio**, el del mensaje. Un 2xx sin `eventId` igual al enviado no cuenta como entregado y se reintenta.
- `factoryOrderId`, `receivedAt`: opcionales, para diagnóstico.

**Error**: cuerpo `{ "error": { "code": "…", "message": "…" } }` (se guarda para diagnóstico; nunca incluir datos sensibles).

| Status | Cuándo | La tienda… |
| --- | --- | --- |
| 400 / 422 | JSON inválido, versión desconocida, campo que no cumple | No reintenta (queda «fallido»). |
| 409 | Misma clave de idempotencia con otro contenido (`idempotency_conflict`) o revisión menor que la ya recibida (`stale_revision`) | No reintenta. |
| 413 | Cuerpo demasiado grande | No reintenta. |
| 401 / 403 | Firma o timestamp inválidos | Reintenta (suele ser configuración) hasta el tope de intentos. |
| 404 / 405 | Ruta mal configurada | Reintenta hasta el tope. |
| 408 / 429 / 5xx / sin respuesta | Pasajero | Reintenta. Respeta `Retry-After` (segundos o fecha HTTP), hasta 6 h. |

Códigos de error que usa la fábrica (`error.code`, acordados con ella):

| Status | `error.code` | Significado | La tienda… |
| --- | --- | --- | --- |
| 400 | `schema_invalid` | El JSON no cumple el esquema. | No reintenta. |
| 401 | `invalid_signature` | Falta una cabecera, el timestamp es inválido o está fuera de ±300 s, o la firma no coincide (el motivo detallado queda solo en el registro de la fábrica). | Reintenta hasta el tope. |
| 409 | `idempotency_conflict`, `stale_revision` | Ver arriba. | No reintenta. |
| 413 | `payload_too_large` | Más de 20 MB de cuerpo o más de 8 MB decodificados en un documento. | No reintenta. |
| 415 | `unsupported_media_type` | `Content-Type` no admitido. | No reintenta. |
| 422 | `unsupported_schema_version` | `schemaVersion` desconocida (se revisa antes que el resto). | No reintenta. |
| 422 | `destination_mismatch` | `destinationFactoryCode` no es `PANGUIPULLI`. | No reintenta. |
| 422 | `document_invalid` | Base64, sha256, cabecera `%PDF-` o PDF ilegible. | No reintenta. |
| 422 | `attachment_hash_mismatch`, `attachment_type_mismatch` | El sha256 del adjunto no coincide, o sus bytes mágicos no calzan con el `Content-Type`. | No reintenta. |
| 503 | `not_configured` | La fábrica no tiene configurada la integración (con `Retry-After`). | Reintenta. |
| 500 | `internal` | Error interno. | Reintenta. |

Un **código de producto desconocido** para la fábrica (un producto dado de alta con IA en la tienda, `IA-XXXXXXXXXX`, o una planilla más nueva que la de la fábrica) **no** rechaza el pedido: la fábrica lo recibe como ítem «a pedido», armado con los campos estructurados, y lo marca para que una persona lo revise.

## 6. Entrega confiable (lado tienda)

- **Bandeja de salida** (patrón *transactional outbox*): tabla `integracion_envios` de la base SQLite de la tienda (esquema 26). El evento se inserta en la **misma transacción** que guarda la nota de pedido: si la nota no se guarda, no hay envío; si se guarda, el envío no se pierde aunque el servidor se reinicie.
- **Envío automático**: al confirmar la nota se despierta el envío en segundo plano; además, una pasada cada minuto retoma reintentos y lo que quedó de un reinicio (`src/instrumentation.ts`).
- **Reintentos**: espera exponencial de 30 s, 1, 2, 4… minutos hasta 6 h, ±20 % al azar; tope de **15 intentos** (unas **32,5 h**). Después queda «fallido».
- **Sin duplicados**: `eventId` y `X-Idempotency-Key` son estables por pedido y revisión en todos los reintentos; un envío en curso queda tomado (no lo toma otra pasada ni otro proceso); la orden de trabajo se imprime una vez y cada reintento manda los mismos bytes.
- **Orden**: por pedido, las revisiones salen en orden; una revisión nueva deja «reemplazada» a la anterior que aún no había salido (la fábrica recibe directamente el pedido vigente).
- **Diagnóstico**: cada intento guarda status, error y respuesta; el registro del servidor anota solo identificadores y motivo (`[integracion]`), nunca el pedido ni el secreto. `/api/salud` (sesión administradora) avisa si hay envíos fallidos o pendientes por más de una hora. `npm run integracion` muestra el estado y permite `reintentar <id>`.

## 7. Lo que debe garantizar la fábrica

1. Verificar la firma sobre los bytes crudos antes de parsear (sección 3).
2. **Idempotencia**: guardar `X-Idempotency-Key` con el hash del cuerpo. Si llega de nuevo con el mismo hash → `200 {"status":"duplicate", "eventId": …}` sin crear nada. Con otro hash → `409 idempotency_conflict`.
3. Identificar el pedido por `(source, sourceOrderId, destinationFactoryCode)` y guardar la revisión mayor recibida.
4. **Revisiones** (`order.ready` con revisión > guardada): ver «Política de actualización» abajo. Nunca sobrescribir en silencio un pedido en producción.
5. Revisión ≤ la guardada con otro `eventId` → `409 stale_revision` (o `200 duplicate` si es el mismo evento).
6. Aceptar un `order.ready` con revisión > 1 aunque no conozca el pedido (la revisión anterior pudo reemplazarse antes de salir): créalo como nuevo.
7. Aceptar `order.cancelled` de un pedido desconocido con 2xx y recordarlo, para ignorar un `order.ready` de revisión menor que llegue después.
8. Verificar `sha256` de documentos y adjuntos; guardar los adjuntos por su sha256.
9. Responder 2xx solo tras persistir; nunca exponer el secreto ni datos del pedido en mensajes de error o registros públicos.
10. No usar el texto de los PDF como fuente de datos: los datos estructurados están en `order`. Un `productCode` desconocido no se rechaza (ver sección 5).
11. Guardar `order.commercial` separado de lo que ve producción.

## 8. Política de actualización

En la tienda, una cotización aprobada **no admite cambios en sus ítems**, y las notas se generan una sola vez. Después de generarlas solo puede pasar:

- **Cambio de número** de una nota o de la cotización (solo administradoras): se reimprimen las notas (cada una nombra la cotización y la otra nota) y se envía una revisión nueva (`order.ready`, revisión + 1) con los mismos ítems y los números nuevos.
- **Anulación** de la cotización (posible mientras no esté despachada, completada ni facturada; puede ocurrir con el pedido en producción): se envía `order.cancelled`.

Un cambio de productos o medidas se hace hoy anulando y creando otra cotización: llega como una anulación más un pedido nuevo (otro `sourceOrderId`). Comportamiento de la fábrica (aprobado en su ADR-0023):

| Estado del pedido en la fábrica | Revisión (`order.ready` n+1) | Anulación |
| --- | --- | --- |
| Pendiente (sin pagos ni orden de producción) | Reemplaza la versión anterior (201). | Lo cancela y libera la reserva (200). |
| En producción o más allá | No sobrescribe: responde 202 y deja la revisión **pendiente de revisión** para una persona. | No lo anula solo: responde 202 y lo deja como «anulación solicitada». |

Si la revisión N+1 llega mientras la N espera a una persona, la N queda descartada («superada por la revisión N+1»). Una revisión anterior a la última recibida responde 409 `stale_revision`, aunque reutilice su clave de idempotencia. Un PDF de producción que traiga «$ + cifras» (texto libre escrito a mano) no rechaza el pedido: la fábrica retiene ese PDF e imprime su propia orden de trabajo.

Abierto: la tienda no se entera de lo que decide la fábrica sobre una revisión o anulación en espera (el contrato es solo tienda → fábrica).

## 9. Configuración (lado tienda)

| Variable | Obligatoria | Descripción |
| --- | --- | --- |
| `NELTUME_FABRICA_PANGUIPULLI_URL` | Sí, para activar | Origen de la aplicación de la fábrica, sin ruta (`https://fabrica.example.cl`). Solo HTTPS (HTTP únicamente para `localhost`/`127.0.0.1`/`[::1]` en desarrollo). |
| `NELTUME_FABRICA_PANGUIPULLI_SECRETO` | Sí, para activar | Secreto HMAC compartido solo con la fábrica, ≥ 32 caracteres (`openssl rand -base64 32`). Distinto de `BETTER_AUTH_SECRET`. |
| `NELTUME_FABRICA_TIMEOUT_MS` | No | Plazo de cada solicitud (1.000–120.000 ms; 20.000 por omisión). |

Sin las dos primeras la integración está apagada y el cotizador funciona exactamente como antes. Para **recibir** la prueba de conexión de la fábrica (sección 12) basta el secreto. En Docker van en el `.env` del servidor; `compose.yaml` ya las pasa al contenedor. La fábrica guarda el mismo secreto en su propia variable de entorno.

## 10. Prueba en desarrollo

La fábrica corre en `http://localhost:3000`, el mismo puerto que usa `npm run dev` del cotizador: levanta el cotizador en otro puerto (`npm run dev -- --port 3001` y `BETTER_AUTH_URL=http://127.0.0.1:3001` en `.env.local`). En el `.env.local` del cotizador: `NELTUME_FABRICA_PANGUIPULLI_URL=http://localhost:3000` y el secreto en `NELTUME_FABRICA_PANGUIPULLI_SECRETO`. En el de la fábrica, el mismo secreto en `INTEGRACION_TIENDA_SECRETO` (y `INTEGRACION_TIENDA_SECRETO_ANTERIOR` para rotar) y el RUT del cliente tipo tienda en `INTEGRACION_TIENDA_CLIENTE_RUT`. Mientras la fábrica no tenga secreto responde 503 `not_configured` y la tienda reintenta.

## 11. Puesta en marcha

1. La fábrica implementa y despliega los dos endpoints (secciones 2–5 y 7) y prueba la firma con el vector de la sección 3.
2. Se genera un secreto y se configura en ambos servidores.
3. En la tienda se definen las variables y se reinicia (`docker compose up -d`).
4. Prueba controlada: generar una nota de Panguipulli de prueba y revisar `npm run integracion` (debe quedar «entregado») y la fábrica.
5. Opcional: encolar notas generadas antes de activar con `npm run integracion -- encolar <N° cotización>`.

## 12. Prueba de conexión

Además de los pedidos, cada aplicación puede enviar a la otra un PDF de prueba desde sus Ajustes (en la tienda, **Ajustes → Conexión con la fábrica**, solo administración): `POST /api/integrations/neltume/connection-tests`, con el mismo secreto y la misma firma que los pedidos. Quien aprieta el botón ve el resultado al instante, y el PDF queda en la lista de la otra aplicación con el mismo código corto de evento. Es una familia de eventos aparte (`eventType: "connection.test"`): no cambia `schemaVersion`, no crea pedidos y no toca la bandeja.

El contrato (cuerpo, orden de validación, respuestas, diagnóstico común de las dos pantallas y conservación) está en [prueba-conexion-v1.md](prueba-conexion-v1.md). Lo que importa para operar la tienda:

- La tienda es **receptora** además de emisora: la ruta no pide sesión (la protege la firma) y valida que el `Host` esté en `NELTUME_HOSTS` (el hostname público, `cotizador.puertasneltume.cl`, que ya está para los usuarios). Hoy el hostname no está detrás de Cloudflare Access; si alguna vez lo estuviera, `/api/integrations/*` necesitaría una regla **Bypass** (o un service token que la fábrica tendría que enviar), porque sin ella la fábrica vería una redirección o un 403 antes de llegar a la tienda.
- Para recibir basta `NELTUME_FABRICA_PANGUIPULLI_SECRETO`; para enviar hacen falta también la URL.
- Se guarda el PDF de las últimas 20 pruebas enviadas y las últimas 20 recibidas (tabla `integracion_pruebas`, esquema 27); el resto queda sin PDF un año, como auditoría.
