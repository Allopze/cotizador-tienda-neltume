# Neltume · Asistente cotizador interno

Demo local para Paula y Paulette: pedido por chat, cotización revisable, PDF con correlativo y nota de pedido a fábrica al aprobar. Solo puertas sólidas y accesorios. No envía mensajes ni documentos a clientes.

## Arranque inicial

Requisitos: Node.js 22.13+ (verificado con 24), npm y Google Chrome/Chromium. Coloca la planilla oficial en `datos-privados/COTIZADOR_2026.xlsx`. Las cinco planillas y la transcripción entregadas ya quedaron resguardadas en `datos-privados/`, sin modificar su contenido.

Crea `.env.local` a partir de `.env.example` y genera `BETTER_AUTH_SECRET` para sesiones y cifrado con `openssl rand -base64 32`. La clave de CommandCode es opcional en el archivo: una persona administradora puede guardarla desde **Ajustes**. En producción, configura también `BETTER_AUTH_URL` con el origen HTTPS público. Sin clave de IA, el login y la pantalla siguen disponibles, pero el chat explica cómo configurar el asistente.

```sh
npm install
npm run importar -- datos-privados/COTIZADOR_2026.xlsx
npm run auth:migrar
npm run usuarios -- crear admin@example.com Admin
npm run dev
```

Reemplaza `admin@example.com` por el correo real de la persona responsable. Todas las cuentas tienen rol `admin`: quien administra puede crear otras desde **Ajustes → Usuarios**. Cada persona puede cambiar su propia contraseña desde **Cuenta → Cambiar contraseña** (cierra sus otras sesiones). El comando local `npm run usuarios` sigue disponible para crear cuentas, desactivar, activar y restablecer claves. Al actualizar una instalación existente, ejecuta `npm run auth:migrar` antes de iniciar la aplicación para convertir las cuentas existentes a rol `admin`. Si la instalación todavía tiene `estado.json` o `catalogo.json` antiguos, ejecuta primero `npm run migrar:sqlite`.

Abre [http://127.0.0.1:3000](http://127.0.0.1:3000). Los scripts de desarrollo y producción escuchan solo en `127.0.0.1`.

Si no tienes Chrome/Chromium instalado, ejecuta `npx playwright install chromium`. El generador detecta Chrome en macOS y Chromium/Chrome en Linux; puedes indicar otro ejecutable con `CHROMIUM_PATH`. Si npm arroja `Cannot read properties of null (reading 'edgesOut')`, agrega `legacy-peer-deps=true` a `.npmrc` y vuelve a instalar.

## Configuración

| Variable                                                                       | Uso                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CMD_API_KEY`                                                                  | Clave opcional de CommandCode. Se usa como fallback mientras no se guarde ni quite una clave desde Ajustes.                                                                                                                                                                                                   |
| `BETTER_AUTH_SECRET`                                                           | Secreto aleatorio de al menos 32 caracteres para sesiones y para cifrar la clave guardada en Ajustes; necesario para guardar esa clave en cualquier entorno y obligatorio para sesiones en producción o cuando `NELTUME_HOSTS` esté definido. Mantenlo estable o vuelve a guardar la clave API si lo cambias. |
| `BETTER_AUTH_URL`                                                              | Origen del cotizador; en producción debe ser HTTPS y su hostname debe figurar en `NELTUME_HOSTS` (se valida al atender la primera solicitud).                                                                                                                                                                 |
| `CMD_MODEL`                                                                    | Modelo inicial de CommandCode mientras no se guarde otro desde **Configuración**; predeterminado `claude-sonnet-5`. Claude usa `/messages`; Laguna y los otros modelos de chat usan `/chat/completions`. El modelo debe admitir herramientas y estar habilitado en tu cuenta.                                 |
| `CMD_TIMEOUT_MS`                                                               | Plazo por solicitud de IA en milisegundos; predeterminado 60000, configurable entre 1000 y 120000. Sin reintentos automáticos.                                                                                                                                                                                |
| `CHROMIUM_PATH`                                                                | Ruta opcional a Chrome/Chromium.                                                                                                                                                                                                                                                                              |
| `NELTUME_PLANILLA`                                                             | Ruta alternativa a la planilla real para importación y tests.                                                                                                                                                                                                                                                 |
| `NELTUME_DATA_DIR`                                                             | Directorio de datos y PDF; predeterminado `data/`. La base se guarda allí si no se configura otra ruta.                                                                                                                                                                                                       |
| `NELTUME_DB_PATH`                                                              | Ruta opcional del archivo SQLite; predeterminado `NELTUME_DATA_DIR/cotizador.sqlite`.                                                                                                                                                                                                                         |
| `NELTUME_CATALOGO_CONFIG`                                                      | Ruta opcional del archivo de maderas, códigos, alias y familias; predeterminado `config/catalogo.json`.                                                                                                                                                                                                       |
| `NELTUME_CATALOGO`                                                             | Ruta del JSON de catálogo anterior, usada solo por `npm run migrar:sqlite`; predeterminado `data/catalogo.json`.                                                                                                                                                                                              |
| `NELTUME_FERIADOS_SYNC`                                                        | `0` desactiva la sincronización diaria de feriados con `api.boostr.cl` (p. ej. sin salida a internet); se usan solo las reglas legales calculadas. Activa por omisión.                                                                                                                                        |
| `NELTUME_EMPRESA_NOMBRE`, `_RUT`, `_DIRECCION`, `_TELEFONO`, `_WEB`            | Datos de Neltume que se imprimen bajo el logo en cotizaciones y notas. Opcionales.                                                                                                                                                                                                                            |
| `NELTUME_EMPRESA_CORREO`                                                       | Correo de contacto del pie de los PDF; predeterminado `Neltume.co@gmail.com`.                                                                                                                                                                                                                                 |
| `NELTUME_CONDICIONES_PAGO`, `NELTUME_PLAZO_ENTREGA`, `NELTUME_DATOS_BANCARIOS` | Condiciones comerciales que se imprimen en el bloque **Condiciones** de la cotización. Opcionales: sin valor, la línea no aparece.                                                                                                                                                                            |
| `NELTUME_HOSTS`                                                                | Hosts adicionales permitidos, separados por coma (p. ej. el de Cloudflare Access); acepta `host`, `host:puerto` o `https://host`. Siempre se aceptan `127.0.0.1`, `localhost` y `[::1]`; cualquier otro Host recibe 403 en páginas y APIs (defensa contra DNS rebinding).                                     |
| `NELTUME_RESPALDO_DIR`                                                         | Carpeta de `npm run respaldar`; predeterminado `respaldos/`. Conviene que esté en otro disco.                                                                                                                                                                                                                 |

### Modelo y clave de IA desde la interfaz

En **Ajustes**, quien administra puede cambiar el modelo de CommandCode, guardar o quitar la clave API. El modelo y la clave cifrada se guardan en la tabla `ajustes` de SQLite y aplican al chat y al alta de productos. La clave nunca se devuelve al navegador. `CMD_API_KEY` se mantiene como fallback compatible hasta que se guarde o quite una clave en Ajustes.

CommandCode es el único proveedor. Se conserva `@anthropic-ai/sdk` como cliente para modelos Claude; los otros modelos usan Chat Completions. Ambos apuntan exclusivamente a CommandCode; no se llama directamente a Anthropic ni se usan su clave, token o URL de entorno. La selección del modelo no cambia el proveedor.

Los márgenes por categoría, el IVA, la vigencia y el descuento máximo se configuran en **Ajustes** (valores iniciales en `src/negocio/precios.ts`: puertas sólidas Mara/Lenga 55 %, Pino Oregón 85 %, prepintadas 140 %, enchapadas Mara 75 %, marcos Pino Finger desnudos 100 % y enchapados 75 %; Raulí 55 %; accesorios de madera sólida y otros 25 %; IVA 19 %, 10 días hábiles y 50 %). Cada cotización congela las reglas vigentes al crearse, y admite un margen especial por cotización o por línea. Los días hábiles excluyen fines de semana y feriados nacionales de Chile (fijos, Semana Santa, traslados de las leyes 19.668, 20.215, 20.299 y 20.983 y el solsticio de invierno); los decretados por única vez (leyes puntuales, elecciones) se sincronizan solos desde la fuente pública [boostr.cl](https://api.boostr.cl/holidays.json): al emitir, si los datos tienen más de un día, se refrescan el año en curso y el siguiente en segundo plano (la primera vez se espera hasta 3 s). Lo sincronizado se guarda en SQLite (esquema 8) y se suma a lo calculado, nunca lo reemplaza; sin conexión se usan las reglas y lo último guardado. `npm run feriados` sincroniza a pedido y muestra el estado. El descuento acepta hasta dos decimales con coma o punto («2,5» y «2.5» son 2,5 %). **Descuento por cantidad:** en **Ajustes → Descuento por cantidad** se definen tramos «desde N puertas, X %» (N entero ≥ 2, 0 < X ≤ descuento máximo, umbrales distintos; sin tramos por omisión) que se congelan con el resto de las reglas al crear la cotización. Cuenta el total de puertas valorizadas (marcos, molduras, piezas T e ítems pendientes no cuentan) y rige el tramo de mayor umbral alcanzado; el descuento se recalcula solo cada vez que cambian las líneas y el panel explica por qué («14 puertas → 5 %», con el siguiente tramo). Editar el descuento lo fija a mano (respeta el máximo y no cambia con las líneas) hasta que se pulsa **Restaurar automático**; la actividad registra el tramo aplicado, el valor manual y la restauración. La IA nunca lo ve ni lo fija, y la nota de pedido sigue sin descuento. La tasa mostrada en pantalla y en los PDF se deriva de `REGLAS`. Redondeo, siempre a pesos enteros: unitario = round(precio fábrica × (1 + margen)); línea = cantidad × unitario; descuento = round(subtotal × %), calculado en centésimas de punto para que un medio peso exacto (2,3 % de $1.500 = $34,5) redondee a $35; neto = subtotal − descuento + flete; IVA = round(neto × 0,19). La nota de pedido usa ajuste cero, sin descuento ni flete, manteniendo el mismo redondeo por unidad.

### Despacho con Starken

Con **Starken** como transportista, el despacho de una cotización editable tiene el botón **Cotizar con Starken**: consulta la API de tarifas, muestra las opciones de agencia y domicilio (con IVA, neto y días de entrega) y, solo si la persona elige una, deja su valor **neto** (`costoTotal / 1,19`, en pesos enteros) como valor de despacho. El valor se sigue pudiendo escribir a mano, y la tarifa elegida (tipo de entrega, días, costo total y ciudad de destino) queda en la actividad de la cotización. Sin configuración, el botón aparece desactivado con «Starken no está configurado»; nunca es una página de error.

Las credenciales salen solo de variables de entorno del servidor (no se guardan en la base ni viajan al navegador):

| Variable                                                     | Uso                                                                                                                                           |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `STARKEN_URL`                                                | Base del servicio, sin el nombre del método: `…/starkenservices/rest`. Debe ser `https` (`http` solo hacia localhost o 127.0.0.1) y no se siguen redirecciones. Sin valor por omisión, para no apuntar a QA o producción por accidente. |
| `STARKEN_RUT`, `STARKEN_CLAVE`                               | Credenciales de la integración (cabeceras `rut` y `clave`).                                                                                   |
| `STARKEN_CUENTA_CORRIENTE`, `STARKEN_CUENTA_CORRIENTE_DV`    | Cuenta corriente y su dígito verificador. Si se usan, no se envía el RUT del cliente.                                                         |
| `STARKEN_RUT_CLIENTE`                                        | RUT del cliente en Starken; solo se usa sin cuenta corriente.                                                                                 |

- **QA y producción** se distinguen únicamente por `STARKEN_URL` y las credenciales. QA: `https://restservices-qa.starken.cl/apiqa/starkenservices/rest`. La URL de producción y sus credenciales las entrega Starken al activar la cuenta (ver `documentacion_integracion_starken.pdf`, que **no está en el repositorio**: los PDF están en `.gitignore`, pídelo al equipo o a Starken); cámbialas y reinicia el servidor. No pruebes contra producción con datos reales de clientes sin acordarlo con Starken.
- Las listas de ciudades de origen y destino se descargan una vez cada 24 horas y quedan en memoria del servidor (si una descarga falla se usa la anterior). Cada consulta tiene un plazo de 10 s.
- El destino se busca por nombre de comuna o ciudad (sin tildes ni mayúsculas) en el destino del despacho y, si no, en la comuna del cliente. Si no se encuentra o hay varias ciudades posibles, la persona elige de una lista con búsqueda.
- **Ajustes → Despacho con Starken** (administración): ciudad de origen y, como el catálogo no trae pesos, el **peso por unidad (kg) y el espesor (cm)** de cada familia (puertas, marcos, molduras, piezas T). Parten vacíos y no se inventan: mientras falten los de alguna familia del pedido, el botón queda desactivado con «Configura peso y espesor en Ajustes».
- El bulto se calcula con las líneas de la cotización: las unidades se apilan (espesores y pesos se suman; el ancho y el largo son los mayores) y se muestra para revisarlo, p. ej. «14 puertas · 3 líneas · total 84 × 90 × 240 cm, 420 kg» (espesor apilado × ancho × largo; cada línea de la cotización es un bulto). Marcos, molduras y piezas T se toman con sección cuadrada del espesor indicado.
- Cada tarifa llega firmada por el servidor (HMAC con una clave derivada de `BETTER_AUTH_SECRET`, ligada a la cotización, al destino y a los datos de la tarifa; vale 15 minutos) y la acción `editar` la verifica antes de aceptar el valor y de dejarlo en la actividad: el costo no se puede alterar desde el navegador. Si cambias `BETTER_AUTH_SECRET`, las tarifas pendientes dejan de valer y hay que volver a cotizar.
- Pruebas: `NELTUME_STARKEN=fijo` (solo con `NELTUME_TEST_MODE=1`) reemplaza la API por un Starken simulado con ciudades y tarifas fijas, sin red. Los tests unitarios simulan `fetch`; ninguna prueba llama a la API real.

## Guion de cinco minutos

1. Escribe: «Cotiza 3 Huilo Huilo en oregón de 80 × 2,10 para Juan Pérez, Temuco».
2. Escribe: «Agrega marcos de oregón». El asistente pide escuadría, largo y cantidad. Si escribes solo «Agrega marcos», también pide la madera.
3. Responde: «3 de 2x4 de 2,1».
4. Revisa y pulsa **Generar PDF**. La primera cotización emitida será la **323**.
5. Escribe: «Se aprobó la 323, haz la nota de pedido». El asistente pide confirmar; al aceptar se descarga la nota **1** y la cotización queda bloqueada.
6. Crea una nueva cotización y prueba «Una Molco de 1,60 de ancho»: muestra los anchos disponibles, sin inventar un producto.

Los datos del cliente son opcionales. Los ítems incompletos no suman y deben completarse o quitarse antes de emitir. Una cotización emitida puede descargarse siempre; modificarla crea un nuevo borrador (solo si hay cambios reales), conserva el PDF original y asigna un nuevo número cuando se emite. Una aprobada no admite cambios.

Aprobar es irreversible: solo se puede aprobar una cotización ya emitida, y tanto el botón como la aprobación pedida por chat exigen confirmación explícita. «Nueva cotización» limpia la pantalla; el borrador se guarda recién cuando la IA responde al primer mensaje con un pedido o datos del cliente. Un saludo, una pregunta o una aprobación pedida desde una pantalla nueva se responden sin crear un borrador vacío, y ese intercambio se envía como contexto con el siguiente mensaje. Si la persona cancela la espera del primer mensaje y lo reenvía, el servidor reconoce el mismo mensaje (`nuevoId`) y abre la cotización que ya había creado en vez de duplicarla. Nombrar una cotización inexistente («la cotización 999») responde 404 sin tocar la cotización abierta.

### Ciclo de vida de una cotización

| Estado        | Significado                                                                                                                                                                           | Acciones                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `borrador`    | Sin número, editable.                                                                                                                                                                 | chat, `editar`, `quitar`, `emitir`, `duplicar`, `eliminar`                    |
| `emitida`     | Tiene número y PDF; vence 10 días hábiles (lunes a viernes, sin feriados nacionales) después de emitirse.                                                                             | chat o `editar` crean/reutilizan su revisión; `aprobar`, `anular`, `duplicar` |
| `aprobada`    | Tiene nota de pedido.                                                                                                                                                                 | `anular` (la nota queda marcada como anulada), `duplicar`                     |
| `reemplazada` | Se emitió una revisión suya o se aprobó otra de la misma serie; no es aprobable ni editable.                                                                                          | `duplicar`                                                                    |
| `anulada`     | Definitiva; conserva números y PDF. Sus documentos se descargan con la marca «ANULADA» (el PDF original queda intacto). Una revisión en borrador abierta queda como cotización nueva. | `duplicar`                                                                    |

- Toda acción que modifica una cotización existente envía su `actualizada`; si no coincide, responde 409 y no cambia nada. Los mensajes del chat sobre una emitida se guardan en el historial sin cambiar su versión.
- Una emitida tiene a lo más una revisión abierta: los cambios siguientes se aplican sobre esa revisión. Emitir la revisión deja la original como `reemplazada`; aprobar una cotización deja `reemplazada` a las demás emitidas de su serie y bloquea emitir borradores de esa serie. Así nunca hay dos notas de pedido para un mismo pedido.
- Al emitir, los montos se recalculan con el catálogo vigente. Si cambió algún precio o el total, **no se emite**: el borrador se actualiza con los montos vigentes, queda registrado en su actividad y la respuesta es 409 `precios_cambiaron` con los avisos y el nuevo total; la interfaz los muestra y pide confirmar antes de emitir con la versión nueva. No se consume número. El diálogo de emisión muestra el total que se emitirá. Se guarda la versión del catálogo usada.
- Aprobar una cotización vencida exige confirmarlo explícitamente. La aprobación acepta dirección de despacho y medio de transporte, que se imprimen en la nota junto al giro del cliente.
- La operación parte de la aprobación del cliente. Los pagos solo se registran en una cotización `aprobada` y se anulan (`anular_pago`, con motivo opcional y registro en la actividad) mientras la operación no llegue a «Lista para despacho»; el anticipo y el saldo pagado se recalculan al anular. Iniciar y terminar la producción exigen al menos 50 % pagado (el mismo umbral de la nota de pedido), así que anular el anticipo después de la nota frena la producción hasta volver a registrarlo; el diálogo de anulación lo advierte. Con la cotización aprobada y hasta registrar el despacho se editan los datos logísticos (`despacho`: transportista, destino, dirección y entrega comprometida); el valor del flete queda fijo desde la emisión y la nota de pedido conserva el despacho con que se generó. Registrar el despacho exige un transportista. Anular una cotización deja su estado comercial en «rechazada». La facturación (`facturacion`: factura o boleta, N° y fecha) se marca a mano en una cotización aprobada, sin integración externa.
- Descuento (0–50 %; automático por cantidad de puertas o fijado a mano, con `descuentoAutomatico: true` en `editar` para volver al automático) y flete (neto) se editan por cotización y solo afectan a la cotización, nunca a la nota. Las líneas guardan el ancho, alto y escuadría pedidos, que se imprimen en ambos PDF.
- Duplicar copia ítems, cliente, descuento y flete en un borrador nuevo.
- Cada cotización guarda su registro de **Actividad** (tabla `eventos`, esquema 7): creación, revisiones, cambios con su detalle, emisión, aprobación, reemplazo y anulación, con fecha y cuenta.
- Se registra quién creó, emitió, aprobó y anuló cada cotización (nombre de la cuenta). El RUT se normaliza a «12.345.678-5» si su dígito verificador es válido; si no, se conserva con un aviso.

El contrato completo de `/api/accion` y `/api/catalogo` está descrito en los tipos de `src/servidor/servicio.ts`, `src/negocio/estado.ts` y en los esquemas Zod de cada ruta. El listado (`GET /api/accion`) devuelve páginas de resúmenes con búsqueda por N°, cliente, RUT, comuna, proyecto, modelo y madera, ordenadas, agrupadas y filtradas por una sola fecha de referencia (anulación, aprobación, emisión o, en un borrador, su última edición); con `formato=csv` descarga el listado filtrado (hasta 5.000 filas) para Excel. `GET /api/accion?id=` devuelve la cotización completa y su actividad. `GET /api/catalogo?q=&familia=` consulta el catálogo con el precio unitario de la cotización; en la interfaz está en **Catálogo → Consultar**.

## Separación de responsabilidades

- `src/catalogo/xlsx.ts`: lectura selectiva del XML de XLSX con `fflate` y `saxes`. No construye un Workbook que materialice costos; solo decodifica valores y fórmulas de celdas permitidas.
- `src/catalogo/importar.ts`: tablas de `Categorias`, normalización, hipótesis de corrección, duplicados, descripción, SHA-256, catálogo y reporte.
- `src/catalogo/enchapadas.ts` y `src/catalogo/planilla.ts`: lectura de la planilla de enchapadas, prepintadas y marcos Pino Finger (bloques por hoja, solo columnas B a D) y detección de cuál de las dos planillas es un libro, por la forma de sus hojas.
- `src/servidor/importacion-catalogo.ts`: vista previa de una importación, comparada solo con los productos de su planilla.
- `config/catalogo.json`: maderas, códigos para SKU, alias y familias especiales, guardados en SQLite junto con cada importación.
- `src/catalogo/resolver.ts`: modelos, alias, medidas, rangos y rechazos determinísticos.
- `src/negocio/precios.ts`: precios, redondeo, IVA y validaciones.
- `src/asistente/llm.ts`: adaptador de CommandCode y proyección explícita del contexto sin precios. Usa el [Provider API de CommandCode](https://commandcode.ai/docs/provider) con `/messages` para Claude y `/chat/completions` para los otros modelos de chat, con una única herramienta por turno y validación estricta con Zod. No se reenvían montos, catálogo completo, historial de precios ni respuestas de cálculo.
- `src/servidor/alta-catalogo.ts`: conversación de alta de producto, extracción de atributos, validación del precio explícito y confirmación transaccional.
- `src/app/api/catalogo/route.ts`: endpoint interno para proponer y confirmar productos nuevos.
- `src/asistente/preguntas.ts`: preguntas determinísticas a partir de los rechazos, sin segunda llamada al modelo.
- `src/negocio/vigencia.ts` y `src/negocio/cliente.ts`: días hábiles y vencimiento; saneamiento del cliente y RUT.
- `src/servidor/almacen.ts`: unidad de trabajo por cotización, reserva de correlativos (`UPDATE … RETURNING`), listado y búsqueda.
- `src/servidor/errores.ts`: errores con estado HTTP y `codigo` estable (400, 404, 409, 503).
- `src/servidor/`: flujo, persistencia, plantillas HTML y PDF A4 con Playwright.
- `src/servidor/autenticacion.ts`: sesiones y verificación de acceso con Better Auth sobre la misma base SQLite.
- `scripts/usuarios.ts`: alta, desactivación, activación y restablecimiento de cuentas desde terminal.
- `src/app/`: pantalla y [Route Handlers de Next.js](https://nextjs.org/docs/app/api-reference/file-conventions/route).

En una cotización nueva, el LLM extrae la lista completa de solicitudes y los datos del cliente; al modificar una anterior devuelve solo los cambios pedidos. El servidor puede resolver una referencia por número, nombre, proyecto o comuna con búsqueda local insensible a tildes. Si encuentra varias, muestra opciones sin modificarlas. En el flujo de cotización, los montos siempre se calculan en el servidor y no se envían al LLM. En el alta de producto, la IA extrae solo atributos; el servidor interpreta el precio neto desde el texto original y exige confirmación. La consulta a la IA se hace fuera del bloqueo del estado: si la cotización cambió mientras tanto, la respuesta no se aplica y se pide reenviar el mensaje. Una salida inválida no modifica las solicitudes, el cliente ni los montos y responde «No entendí, ¿puedes reformularlo?». Una cantidad no entera o fuera de 1–10.000 queda pendiente con un aviso. Los cambios reales se detectan comparando los ítems resueltos (código, cantidad y medidas pedidas) y el cliente normalizado, no el texto del modelo; la respuesta incluye `cambios` (ítems agregados, quitados y modificados) para mostrar la diferencia.

Referencias: solo cuentan «cotización 450», «cotización N° 450», «nro de cotización 450» o «la 450» fuera de una dirección; un «#450» o «N° 450» suelto (p. ej. «Los Carrera #450») no es una referencia. Entre varias coincidencias por nombre se prefiere la conversación abierta. Medidas: hasta 10 se interpretan en metros, hasta 300 en centímetros y hasta 3000 en milímetros; fuera de 0,3–3 m el asistente pregunta. Si dos productos manuales cubren el mismo ancho, pregunta cuál en vez de elegir.

## Archivos y persistencia

- `datos-privados/`: originales confidenciales, excluidos de Git junto con todo `*.xlsx`.
- `data/cotizador.sqlite`: base activa con catálogo normalizado, cotizaciones, solicitudes e historial, montos calculados, snapshots de productos, correlativos y notas de pedido. Se excluye de Git junto con sus archivos WAL/SHM.
- `productos_adicionales` en SQLite: productos confirmados desde el alta con IA. El precio se extrae del texto original del usuario en el servidor; no se envían precios existentes al modelo.
- `data/respaldo-migracion/<fecha>/`: copia privada e inactiva de los JSON anteriores, creada después de verificar la migración y excluida de Git.
- [Reporte de importación](data/reporte-importacion.md): 29 correcciones, cero exclusiones y errores de plantilla, sin costos ni márgenes.
- [Verificación de fuentes](data/verificacion-fuentes.md): cinco planillas, comparación de columnas permitidas con rev-4F y lectura de las siete páginas de la transcripción. Para repetir la revisión de planillas: `npx tsx scripts/verificar-fuentes.ts`.
- `public/logo-neltume.svg`: logo original extraído de `xl/media/image2.svg`.
- `data/pdf/`: documentos emitidos; sus nombres se guardan en SQLite. El E2E usa su propia base y carpeta PDF en `data/test-e2e/`.

### Agregar modelos y maderas

No hay un panel de administración: el catálogo se mantiene con la planilla y `config/catalogo.json`.

1. Para agregar un modelo de puerta, agrega su nombre y código en `Categorias!O:P` y sus productos en la hoja `Precio`. Se admiten filas de categorías hasta la 500. Los nombres de modelo y madera se normalizan sin distinguir mayúsculas ni tildes.
2. Para una madera nueva, agrega su nombre en `Categorias!G`, sus productos en `Precio!G` y una entrada en `config/catalogo.json` con `nombre`, `codigo` único y los `alias` que se usan al pedirla. El código se usa en los SKU importados.
3. Para clasificar un modelo como marco, piezas T o moldura, agrega su familia en `familiasPorModelo`. Los modelos sin entrada se consideran puertas. Las familias disponibles son `PUERTA`, `MARCO`, `PIEZAS_T` y `MOLDURA`.
4. Si la gente usa nombres alternativos para un modelo, agrégalos en `aliasModelos`, bajo el nombre canónico. Si un nombre solo se parece y puede ser otra cosa (por ejemplo «Pillo»), agrégalo en `aliasPosiblesModelos`: el cotizador no lo sustituye ni se lo envía a la IA como alias; deja el ítem pendiente y pregunta «¿Te refieres a…?» hasta que se confirme el modelo con el botón «Confirmar» del panel. Un modelo real del catálogo siempre gana sobre cualquier alias.
5. Importa la planilla actualizada con `npm run importar -- ruta.xlsx`. La operación reemplaza productos y configuración juntos en una transacción; si la validación falla, ambos quedan como estaban. Las cotizaciones existentes conservan sus snapshots. La importación se rechaza completa si más de 5 filas (y más del 1 %) de `Precio` tienen datos incompletos o un precio inválido, si un mismo producto aparece dos veces con precios distintos (una repetición idéntica solo se reporta) o si la planilla trae menos del 90 % de los productos del catálogo actual; en este último caso, si la reducción es intencional, repite con `npm run importar -- ruta.xlsx --forzar`.

### Planillas por origen: puertas sólidas y enchapadas

El catálogo se arma con dos planillas, cada una un *origen* de productos:

- **Planilla de puertas sólidas** (`COTIZADOR_2026.xlsx`: hojas `Precio`, `Categorias` y `Cotización`).
- **Planilla de enchapadas, prepintadas y marcos finger** (`VALORES PUERTAS ENCHAPADAS…xlsx`): una hoja por modelo con bloques «<MODELO> PREPINTADA» y «<MODELO> ENCHAPE EN MARA» (rango de altura × ancho → costo) y la hoja de marcos con sets Pino Finger desnudos y enchapados en Mara. Solo se leen las columnas de medida y **costo «+ IVA»** (neto de fábrica); venta, margen y descuento especial no se leen: el precio sale del costo por el margen de cada categoría (prepintadas 140 %, enchapadas en Mara 75 %, marcos finger desnudos 100 % y enchapados 75 %). Los bloques que no son de estas terminaciones (por ejemplo los sets de endolado MDF) no se importan y quedan en las incidencias. Los productos son las maderas `PREPINTADA`, `MARA ENCHAPADA`, `PINO FINGER` y `PINO FINGER ENCHAPADO MARA`, con códigos estables como `HUIL-EM-085-240` (modelo, madera, ancho en cm y alto máximo en cm) y `MARC-PF-30X70-220` (escuadría en mm y largo en cm).

En **Catálogo → Importar** el formato se reconoce solo y la vista previa compara únicamente con los productos de esa planilla; la otra y los productos agregados a mano no se modifican. El control del 90 % de productos conservados es por planilla, y un código o producto repetido en la otra planilla se rechaza. La versión del catálogo cambia con cada importación de cualquiera de las dos. `npm run importar -- ruta.xlsx` acepta ambas (el reporte de las enchapadas va a `data/reporte-importacion-enchapadas.md`). Al importar las enchapadas, las maderas nuevas se suman a la configuración guardada si no estaban.

Ejemplo de entrada para una madera: `{ "nombre": "ROBLE", "codigo": "RB", "alias": ["ROBLE AMERICANO"] }`. Configuración y catálogo aplicados quedan en la base SQLite; el JSON es la fuente editable para la próxima importación. El cambio de esquema añade esta configuración de forma compatible al abrir una base existente.

En la aplicación también puedes abrir **Catálogo → Agregar producto** y describirlo en lenguaje natural. El precio que se ingresa es el neto base: la cotización le suma el margen de su categoría, como a los productos de la planilla, y la vista previa muestra ambos valores. Indica familia, modelo, madera, medidas y precio neto unitario; la IA pregunta los datos que falten. El precio debe aparecer explícitamente en el texto. El servidor genera un código, presenta una vista previa y guarda el producto solo después de tu confirmación. El precio acepta «45.990», «45,990» (miles), «45,99», «1.5 mil», «3 mil quinientos» y «1,2 millones»; «+ IVA» o «neto» se toman como neto, y «IVA incluido», «con IVA» o «bruto» se convierten a neto dividiendo por 1,19 con un aviso en la vista previa. Si el precio está a más de 3 veces (o menos de un tercio) de la mediana del mismo modelo o familia, la vista previa lo advierte. Se rechaza un rango de ancho que se cruce con otro del mismo modelo, madera y alto. Cada propuesta pendiente pertenece a la cuenta que la inició. Al confirmar, el producto queda disponible en **Catálogo → Consultar** junto con los de la planilla. Estos productos permanecen en SQLite y sobreviven a futuras importaciones de Excel; si la planilla contiene el mismo código o combinación de atributos, se rechaza la importación completa.

Para actualizar una instalación que todavía tiene `catalogo.json` o `estado.json`, detén el servidor y ejecuta `npm run migrar:sqlite`. El comando valida una base temporal, conserva los JSON en un respaldo fechado y no sobrescribe una base SQLite existente que no haya sido migrada. No inicializa una base vacía ignorando JSON anteriores. En una instalación nueva, `npm run importar -- datos-privados/COTIZADOR_2026.xlsx` carga catálogo y configuración directamente en SQLite.

Los cambios se confirman con transacciones SQLite y cada operación lee y escribe solo las cotizaciones que toca; las lecturas de varias tablas se hacen dentro de una transacción. El bloqueo en `data/.estado.lock` serializa las escrituras. El correlativo se reserva (`UPDATE … RETURNING`) antes de generar cada documento; el PDF se genera fuera del bloqueo, con un plazo total de 30 s, y al terminar se vuelve a tomar el bloqueo para confirmar solo si la cotización no cambió. Un fallo puede dejar un salto, nunca reutilizar un número, y un PDF existente nunca se sobrescribe (`data/pdf` con permisos 0700 y archivos 0600). Una fila dañada se omite del listado y se registra en el servidor sin afectar a las demás. El esquema 6 (estados «reemplazada» y «anulada», autoría, vigencia, descuento, flete, giro, medidas pedidas y despacho) se aplica solo al abrir una base anterior; las filas existentes quedan con valores nulos o cero y las originales cuya revisión ya se había emitido pasan a «reemplazada». El esquema 15 agrega `descuento_manual` (qué cotizaciones tienen el descuento fijado a mano): las que ya tenían descuento quedan como manuales y las demás como automáticas; los tramos viven en las reglas congeladas (`reglas_json`), así que las anteriores no los tienen. Las notas y cotizaciones conservan sus snapshots de precios aunque el catálogo cambie. No borres la base para reiniciar los correlativos.

### Respaldo y restauración

`npm run respaldar` copia en caliente, sin detener el servidor, la base (API de respaldo de SQLite, verificada con `integrity_check`), los PDF emitidos y `config/catalogo.json` a `respaldos/cotizador-<fecha>/`, y conserva los 30 más recientes. `--destino ruta` (o `NELTUME_RESPALDO_DIR`) cambia la carpeta —conviene otro disco o una carpeta sincronizada— y `--conservar N` la cantidad. Para que sea diario, prográmalo, por ejemplo con cron: `0 21 * * * cd /ruta/al/cotizador && npm run respaldar -- --destino /Volumes/Respaldo/neltume`.

Para restaurar: detén el servidor, borra `data/cotizador.sqlite-wal` y `data/cotizador.sqlite-shm` si existen, copia `cotizador.sqlite` del respaldo a `data/`, reemplaza `data/pdf/` por la carpeta `pdf` del respaldo, copia `catalogo.json` a `config/` e inicia el servidor. Restaura siempre base y PDF del mismo respaldo: si la carpeta `pdf` tuviera documentos más nuevos que la base, emitir fallaría al intentar reutilizar un número ya impreso (el cotizador nunca sobrescribe un PDF).

### Limpieza de borradores

`npm run limpiar-borradores` lista los borradores vacíos (sin ítems ni cliente) sin actividad en 30 días; `--dias N` cambia el plazo, `--con-items` incluye borradores con ítems y `--confirmar` los elimina. Nunca toca cotizaciones con número.

## Errores confirmados y supuestos

Se corrigieron por consistencia, no por una lista fija de filas:

- Fila 1193: `LLAG-O-2-A` → `LLAG-O-2-C`; el código duplicaba el alto 2,0, pero sus atributos indican 2,2.
- Filas 7883–7910: 28 marcos de raulí con largo 2; se restauran 2,1…2,6 y 3 según su código.
- `P25`: cero fijo en lugar de fórmula.
- `C8:C32`: búsquedas limitadas a fila 603.
- `Q8`: +25 % solo en la primera línea, frente al −25 % de rev-4F.

Supuestos: margen por categoría, medidas tal como se piden (hoja o vano se registra, sin conversión), cliente opcional, cuentas admin autenticadas con un espacio compartido y ninguna entrega automática. No hay registro ni recuperación por correo: quien administra crea las cuentas desde Ajustes e inicializa sus contraseñas; la terminal conserva las tareas de administración avanzada. Todas las cuentas pueden operar las mismas cotizaciones y catálogo. Los montos visibles se redondean a pesos enteros; esa es la diferencia intencional con el cálculo decimal de Excel. El precio neto importado conserva cuatro decimales.

## Verificación

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

`npm test` ejecuta toda la suite Vitest y después Playwright, sin filtros. La integración **falla** con un mensaje explícito si no está la planilla real; no se omite ni se sustituye por un catálogo inventado.

Incluye los ocho oráculos de precios (neto $4.523.269, IVA $859.421, total $5.382.690), conteos, 29 correcciones, campos permitidos, errores de plantilla, normalización, huecos de ancho, tolerancia de altos, cantidades, redondeo, ajustes, preguntas, contexto sin precios, respuesta inválida, correlativos concurrentes, reinicio, fallos de PDF, inmutabilidad y bloqueo de aprobación.

El E2E recorre los cinco pasos secuencialmente, con respuestas fijas del adaptador, descarga ambos PDF y extrae su texto para verificar títulos, referencias, totales y precios de fábrica. Comprueba persistencia tras recargar y ancho móvil. Las respuestas fijas solo se activan con **ambas** variables internas `NELTUME_TEST_MODE=1` y `NELTUME_LLM=fijo`; el navegador no puede seleccionarlas.

`tests/aceptacion.e2e.ts` recorre el escenario de aceptación completo sobre el catálogo del E2E: «Cotiza 3 puertas Huilo Huilo en Mara de 83,5 x 236 medida vano para Juan Pérez.» (referencia HUIL-M-3-E, siguiente medida del catálogo, precio = fábrica × 1,55), descripción de documento y margen de línea editados a mano, emisión y PDF del cliente, aprobación, anticipo del 50 %, nota de pedido a precio de fábrica, producción, saldo, despacho con transportista y destino, operación completada y rastro de actividad tras recargar. Emite cotizaciones y notas, así que `playwright.config.ts` lo corre al final, como proyecto `aceptacion` que depende de `flujos`; para correrlo solo, sobre una base ya preparada: `npx playwright test --project=aceptacion --no-deps`.

## Límites y diferencias documentadas

- Se usó un lector selectivo de XML en lugar de `exceljs` para mantener la restricción de no leer las columnas H–N. Las tablas auxiliares sí se obtienen del archivo.
- Se bloquea la emisión con ítems incompletos para impedir una cotización parcial accidental. Editar una emitida abre una nueva revisión como borrador.
- LibreOffice no está instalado: no se ejecutó el recálculo aleatorio opcional de 600 líneas. La paridad se valida contra los ocho oráculos sobre la planilla real.
- La meta de respuesta en menos de cinco segundos depende de la disponibilidad de CommandCode y del modelo. El E2E prueba un adaptador fijo; no acredita latencia del proveedor. Un vencimiento del plazo devuelve HTTP 504 (`ia_timeout`) y conserva el borrador. Los errores de acceso, configuración, límite y disponibilidad se muestran con mensajes específicos sin revelar la respuesta cruda ni las credenciales.
- No incluye enchapadas, prepintadas, Puertas Flores SPA, muebles, registro público, recuperación de contraseñas por correo, un panel de administración ni envíos. Los tipos de familia y las reglas de precios siguen limitados a los valores documentados.

## Prueba remota con acceso restringido

No hay túnel configurado. Sigue la [guía oficial de aplicaciones protegidas con Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/). Para una demostración remota, crea en Cloudflare Zero Trust una aplicación **Access** para el hostname, con una política Allow limitada a los correos autorizados. Después configura un Cloudflare Tunnel cuyo servicio sea `http://127.0.0.1:3000`, asociado a ese hostname; configura `NELTUME_HOSTS` con el hostname, `BETTER_AUTH_URL` con su origen `https://` y un `BETTER_AUTH_SECRET` propio. El túnel debe apuntar a la versión de producción (`npm run build && npm start`), nunca a `npm run dev`: el modo desarrollo confía en orígenes loopback adicionales, muestra errores detallados y no exige las validaciones de producción. La aplicación exige además una cuenta local. No uses un Quick Tunnel público ni expongas el puerto directamente.

Medidas de seguridad activas: todas las cuentas tienen rol `admin`; las rutas `/api/auth/admin/*` siguen respondiendo 404 y la creación se limita a la ruta propia de Ajustes; el inicio de sesión se limita a 5 intentos por IP (se lee `cf-connecting-ip` o `x-forwarded-for`) y a 10 fallos por correo cada 15 minutos; todas las respuestas incluyen `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: same-origin` y, en producción, HSTS. Los PDF se descargan por defecto; `?ver=1` los abre en el navegador.
