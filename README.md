# Neltume · Asistente cotizador interno

Demo local para Paula y Paulette: pedido por chat, cotización revisable, PDF con correlativo y nota de pedido a fábrica al aprobar. Solo puertas sólidas y accesorios. No envía mensajes ni documentos a clientes.

## Arranque inicial

Requisitos: Node.js 22.13+ (verificado con 24), npm y Google Chrome/Chromium. Coloca la planilla oficial en `datos-privados/COTIZADOR_2026.xlsx`. Las cinco planillas y la transcripción entregadas ya quedaron resguardadas en `datos-privados/`, sin modificar su contenido.

Crea `.env.local` a partir de `.env.example`, agrega tu clave de API de CommandCode y genera un secreto para las sesiones con `openssl rand -base64 32`. En producción, configura también `BETTER_AUTH_URL` con el origen HTTPS público. Sin clave de IA, el login y la pantalla siguen disponibles, pero el chat explica cómo configurar el asistente.

```sh
npm install
npm run importar -- datos-privados/COTIZADOR_2026.xlsx
npm run auth:migrar
npm run usuarios -- crear admin@example.com Admin --admin
npm run dev
```

Reemplaza `admin@example.com` por el correo real de la persona responsable. El comando solicita la contraseña sin mostrarla ni incluirla en el historial de la terminal. Crea las demás cuentas con `npm run usuarios -- crear correo@neltume.cl Nombre`; también permite `desactivar`, `activar` y `restablecer-clave`. La primera cuenta debe llevar `--admin` para habilitar la gestión local de cuentas. Si la instalación todavía tiene `estado.json` o `catalogo.json` antiguos, ejecuta primero `npm run migrar:sqlite`.

Abre [http://127.0.0.1:3000](http://127.0.0.1:3000). Los scripts de desarrollo y producción escuchan solo en `127.0.0.1`.

Si no tienes Chrome/Chromium instalado, ejecuta `npx playwright install chromium`. El generador detecta Chrome en macOS y Chromium/Chrome en Linux; puedes indicar otro ejecutable con `CHROMIUM_PATH`. Si npm arroja `Cannot read properties of null (reading 'edgesOut')`, agrega `legacy-peer-deps=true` a `.npmrc` y vuelve a instalar.

## Configuración

| Variable           | Uso                                                                                                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CMD_API_KEY`      | Clave propia de CommandCode, únicamente en `.env.local`.                                                                                                                                                                    |
| `BETTER_AUTH_SECRET` | Secreto aleatorio de al menos 32 caracteres para sesiones; obligatorio en producción. |
| `BETTER_AUTH_URL` | Origen del cotizador; en producción debe ser HTTPS y coincidir con el hostname permitido. |
| `CMD_MODEL`        | Modelo inicial de CommandCode mientras no se guarde otro desde **Configuración**; predeterminado `claude-sonnet-5`. Claude usa `/messages`; Laguna y los otros modelos de chat usan `/chat/completions`. El modelo debe admitir herramientas y estar habilitado en tu cuenta. |
| `CMD_TIMEOUT_MS`   | Plazo por solicitud de IA en milisegundos; predeterminado 60000, configurable entre 1000 y 120000. Sin reintentos automáticos.                                                                                              |
| `CHROMIUM_PATH`    | Ruta opcional a Chrome/Chromium.                                                                                                                                                                                            |
| `NELTUME_PLANILLA` | Ruta alternativa a la planilla real para importación y tests.                                                                                                                                                               |
| `NELTUME_DATA_DIR` | Directorio de datos y PDF; predeterminado `data/`. La base se guarda allí si no se configura otra ruta.                                                                                                                     |
| `NELTUME_DB_PATH`  | Ruta opcional del archivo SQLite; predeterminado `NELTUME_DATA_DIR/cotizador.sqlite`.                                                                                                                                       |
| `NELTUME_CATALOGO_CONFIG` | Ruta opcional del archivo de maderas, códigos, alias y familias; predeterminado `config/catalogo.json`.                                                                                                           |
| `NELTUME_CATALOGO` | Ruta del JSON de catálogo anterior, usada solo por `npm run migrar:sqlite`; predeterminado `data/catalogo.json`.                                                                                                            |
| `NELTUME_HOSTS`    | Hostnames adicionales permitidos, separados por coma (p. ej. el de Cloudflare Access). Siempre se aceptan `127.0.0.1`, `localhost` y `[::1]`; cualquier otro Host recibe 403 (defensa contra DNS rebinding).                |

### Modelo de IA desde la interfaz

El botón con el nombre del modelo, arriba a la derecha, abre **Configuración del asistente**. Ahí se escribe el modelo de CommandCode; la clave sigue solo en `.env.local`. La elección se guarda en la tabla `ajustes` de SQLite y aplica al chat y al alta de productos.

CommandCode es el único proveedor. Se conserva `@anthropic-ai/sdk` como cliente para modelos Claude; los otros modelos usan Chat Completions. Ambos apuntan exclusivamente a CommandCode; no se llama directamente a Anthropic ni se usan su clave, token o URL de entorno. La selección del modelo no cambia el proveedor.

El ajuste y el IVA se configuran en `REGLAS`, en `src/negocio/precios.ts`: +25 % e IVA 19 %. La tasa mostrada en pantalla y en los PDF se deriva de `REGLAS`. La nota de pedido usa ajuste cero, manteniendo el mismo redondeo por unidad.

## Guion de cinco minutos

1. Escribe: «Cotiza 3 Huilo Huilo en oregón de 80 × 2,10 para Juan Pérez, Temuco».
2. Escribe: «Agrega marcos de oregón». El asistente pide escuadría, largo y cantidad. Si escribes solo «Agrega marcos», también pide la madera.
3. Responde: «3 de 2x4 de 2,1».
4. Revisa y pulsa **Generar PDF**. La primera cotización emitida será la **323**.
5. Escribe: «Se aprobó la 323, haz la nota de pedido». El asistente pide confirmar; al aceptar se descarga la nota **1** y la cotización queda bloqueada.
6. Crea una nueva cotización y prueba «Una Molco de 1,60 de ancho»: muestra los anchos disponibles, sin inventar un producto.

Los datos del cliente son opcionales. Los ítems incompletos no suman y deben completarse o quitarse antes de emitir. Una cotización emitida puede descargarse siempre; modificarla crea un nuevo borrador (solo si hay cambios reales), conserva el PDF original y asigna un nuevo número cuando se emite. Una aprobada no admite cambios.

Aprobar es irreversible: solo se puede aprobar una cotización ya emitida, y tanto el botón como la aprobación pedida por chat exigen confirmación explícita. «Nueva cotización» limpia la pantalla; el borrador se guarda recién con el primer mensaje.

## Separación de responsabilidades

- `src/catalogo/xlsx.ts`: lectura selectiva del XML de XLSX con `fflate` y `saxes`. No construye un Workbook que materialice costos; solo decodifica valores y fórmulas de celdas permitidas.
- `src/catalogo/importar.ts`: tablas de `Categorias`, normalización, hipótesis de corrección, duplicados, descripción, SHA-256, catálogo y reporte.
- `config/catalogo.json`: maderas, códigos para SKU, alias y familias especiales, guardados en SQLite junto con cada importación.
- `src/catalogo/resolver.ts`: modelos, alias, medidas, rangos y rechazos determinísticos.
- `src/negocio/precios.ts`: precios, redondeo, IVA y validaciones.
- `src/asistente/llm.ts`: adaptador de CommandCode y proyección explícita del contexto sin precios. Usa el [Provider API de CommandCode](https://commandcode.ai/docs/provider) con `/messages` para Claude y `/chat/completions` para los otros modelos de chat, con una única herramienta por turno y validación estricta con Zod. No se reenvían montos, catálogo completo, historial de precios ni respuestas de cálculo.
- `src/servidor/alta-catalogo.ts`: conversación de alta de producto, extracción de atributos, validación del precio explícito y confirmación transaccional.
- `src/app/api/catalogo/route.ts`: endpoint interno para proponer y confirmar productos nuevos.
- `src/asistente/preguntas.ts`: preguntas determinísticas a partir de los rechazos, sin segunda llamada al modelo.
- `src/servidor/`: flujo, persistencia, plantillas HTML y PDF A4 con Playwright.
- `src/servidor/autenticacion.ts`: sesiones y verificación de acceso con Better Auth sobre la misma base SQLite.
- `scripts/usuarios.ts`: alta, desactivación, activación y restablecimiento de cuentas desde terminal.
- `src/app/`: pantalla y [Route Handlers de Next.js](https://nextjs.org/docs/app/api-reference/file-conventions/route).

En una cotización nueva, el LLM extrae la lista completa de solicitudes y los datos del cliente; al modificar una anterior devuelve solo los cambios pedidos. El servidor puede resolver una referencia por número, nombre, proyecto o comuna con búsqueda local insensible a tildes. Si encuentra varias, muestra opciones sin modificarlas. En el flujo de cotización, los montos siempre se calculan en el servidor y no se envían al LLM. En el alta de producto, la IA extrae solo atributos; el servidor interpreta el precio neto desde el texto original y exige confirmación. La consulta a la IA se hace fuera del bloqueo del estado: si la cotización cambió mientras tanto, la respuesta no se aplica y se pide reenviar el mensaje. Una salida inválida no modifica las solicitudes, el cliente ni los montos y responde «No entendí, ¿puedes reformularlo?».

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
4. Si la gente usa nombres alternativos para un modelo, agrégalos en `aliasModelos`, bajo el nombre canónico.
5. Importa la planilla actualizada con `npm run importar -- ruta.xlsx`. La operación reemplaza productos y configuración juntos en una transacción; si la validación falla, ambos quedan como estaban. Las cotizaciones existentes conservan sus snapshots.

Ejemplo de entrada para una madera: `{ "nombre": "ROBLE", "codigo": "RB", "alias": ["ROBLE AMERICANO"] }`. Configuración y catálogo aplicados quedan en la base SQLite; el JSON es la fuente editable para la próxima importación. El cambio de esquema añade esta configuración de forma compatible al abrir una base existente.

En la aplicación también puedes pulsar **Agregar producto** y describirlo en lenguaje natural. Indica familia, modelo, madera, medidas y precio neto unitario; la IA pregunta los datos que falten. El precio debe aparecer explícitamente en el texto. El servidor genera un código, presenta una vista previa y guarda el producto solo después de tu confirmación. Estos productos permanecen en SQLite y sobreviven a futuras importaciones de Excel; si la planilla contiene el mismo código o combinación de atributos, se rechaza la importación completa.

Para actualizar una instalación que todavía tiene `catalogo.json` o `estado.json`, detén el servidor y ejecuta `npm run migrar:sqlite`. El comando valida una base temporal, conserva los JSON en un respaldo fechado y no sobrescribe una base SQLite existente que no haya sido migrada. No inicializa una base vacía ignorando JSON anteriores. En una instalación nueva, `npm run importar -- datos-privados/COTIZADOR_2026.xlsx` carga catálogo y configuración directamente en SQLite.

Los cambios se confirman con transacciones SQLite; el bloqueo en `data/.estado.lock` se mantiene para coordinar operaciones que generan PDFs. El correlativo se confirma antes de generar cada documento: un fallo puede dejar un salto, nunca reutilizar un número. Las notas y cotizaciones conservan sus snapshots de precios aunque el catálogo cambie. Para respaldar una operación real, detén el servidor y copia juntos `data/cotizador.sqlite`, `data/pdf/` y `config/catalogo.json`. No borres la base para reiniciar los correlativos.

## Errores confirmados y supuestos

Se corrigieron por consistencia, no por una lista fija de filas:

- Fila 1193: `LLAG-O-2-A` → `LLAG-O-2-C`; el código duplicaba el alto 2,0, pero sus atributos indican 2,2.
- Filas 7883–7910: 28 marcos de raulí con largo 2; se restauran 2,1…2,6 y 3 según su código.
- `P25`: cero fijo en lugar de fórmula.
- `C8:C32`: búsquedas limitadas a fila 603.
- `Q8`: +25 % solo en la primera línea, frente al −25 % de rev-4F.

Supuestos: +25 % uniforme, medidas de la puerta (sin conversión de vano), cliente opcional, usuarios autenticados con un espacio compartido y ninguna entrega automática. No hay registro ni recuperación por correo: el responsable administra las cuentas desde terminal. Todas las cuentas pueden operar las mismas cotizaciones y catálogo. Los montos visibles se redondean a pesos enteros; esa es la diferencia intencional con el cálculo decimal de Excel. El precio neto importado conserva cuatro decimales.

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

## Límites y diferencias documentadas

- Se usó un lector selectivo de XML en lugar de `exceljs` para mantener la restricción de no leer las columnas H–N. Las tablas auxiliares sí se obtienen del archivo.
- Se bloquea la emisión con ítems incompletos para impedir una cotización parcial accidental. Editar una emitida abre una nueva revisión como borrador.
- LibreOffice no está instalado: no se ejecutó el recálculo aleatorio opcional de 600 líneas. La paridad se valida contra los ocho oráculos sobre la planilla real.
- La meta de respuesta en menos de cinco segundos depende de la disponibilidad de CommandCode y del modelo. El E2E prueba un adaptador fijo; no acredita latencia del proveedor. Un vencimiento del plazo devuelve HTTP 504 (`ia_timeout`) y conserva el borrador. Los errores de acceso, configuración, límite y disponibilidad se muestran con mensajes específicos sin revelar la respuesta cruda ni las credenciales.
- No incluye enchapadas, prepintadas, Puertas Flores SPA, muebles, registro público, recuperación de contraseñas por correo, un panel de administración ni envíos. Los tipos de familia y las reglas de precios siguen limitados a los valores documentados.

## Prueba remota con acceso restringido

No hay túnel configurado. Sigue la [guía oficial de aplicaciones protegidas con Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/). Para una demostración remota, crea en Cloudflare Zero Trust una aplicación **Access** para el hostname, con una política Allow limitada a los correos autorizados. Después configura un Cloudflare Tunnel cuyo servicio sea `http://127.0.0.1:3000`, asociado a ese hostname; configura `NELTUME_HOSTS` con el hostname y `BETTER_AUTH_URL` con su origen `https://`. La aplicación exige además una cuenta local. No uses un Quick Tunnel público ni expongas el puerto directamente.
