# Neltume · Asistente cotizador interno

Demo local para Paula y Paulette: pedido por chat, cotización revisable, PDF con correlativo y nota de pedido a fábrica al aprobar. Solo puertas sólidas y accesorios. No envía mensajes ni documentos a clientes.

## Arranque en tres comandos

Requisitos: Node.js 22.13+ (verificado con 24), npm y Google Chrome/Chromium. Coloca la planilla oficial en `datos-privados/COTIZADOR_2026.xlsx`. Las cinco planillas y la transcripción entregadas ya quedaron resguardadas en `datos-privados/`, sin modificar su contenido.

Crea `.env.local` a partir de `.env.example` e ingresa tu propia clave de API de CommandCode antes de usar el chat. Sin clave, la pantalla funciona y explica cómo configurarla; no se simula una respuesta real.

```sh
npm install
npm run importar -- datos-privados/COTIZADOR_2026.xlsx
npm run dev
```

Abre [http://127.0.0.1:3000](http://127.0.0.1:3000). Los scripts de desarrollo y producción escuchan solo en `127.0.0.1`.

Si no tienes Chrome/Chromium instalado, ejecuta `npx playwright install chromium`. El generador detecta Chrome en macOS y Chromium/Chrome en Linux; puedes indicar otro ejecutable con `CHROMIUM_PATH`. Si npm arroja `Cannot read properties of null (reading 'edgesOut')`, agrega `legacy-peer-deps=true` a `.npmrc` y vuelve a instalar.

## Configuración

| Variable | Uso |
|---|---|
| `CMD_API_KEY` | Clave propia de CommandCode, únicamente en `.env.local`. |
| `CMD_MODEL` | Modelo servido por CommandCode; predeterminado `claude-sonnet-5`. Claude usa `/messages`; Laguna y los otros modelos de chat usan `/chat/completions`. El modelo debe admitir herramientas y estar habilitado en tu cuenta. |
| `CMD_TIMEOUT_MS` | Plazo por solicitud de IA en milisegundos; predeterminado 60000, configurable entre 1000 y 120000. Sin reintentos automáticos. |
| `CHROMIUM_PATH` | Ruta opcional a Chrome/Chromium. |
| `NELTUME_PLANILLA` | Ruta alternativa a la planilla real para importación y tests. |
| `NELTUME_DATA_DIR` | Directorio de persistencia y PDF; predeterminado `data/`. |
| `NELTUME_CATALOGO` | Ruta del catálogo importado; predeterminado `data/catalogo.json`. Se recarga solo si cambia el archivo. |
| `NELTUME_HOSTS` | Hostnames adicionales permitidos, separados por coma (p. ej. el de Cloudflare Access). Siempre se aceptan `127.0.0.1`, `localhost` y `[::1]`; cualquier otro Host recibe 403 (defensa contra DNS rebinding). |

CommandCode es el único proveedor de IA configurado. Se conserva `@anthropic-ai/sdk` como cliente para modelos Claude; los otros modelos usan Chat Completions. Ambos apuntan exclusivamente a CommandCode; no se llama directamente a Anthropic ni se usan su clave, token o URL de entorno. La selección del modelo no cambia el proveedor.

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
- `src/catalogo/resolver.ts`: modelos, alias, medidas, rangos y rechazos determinísticos.
- `src/negocio/precios.ts`: precios, redondeo, IVA y validaciones.
- `src/asistente/llm.ts`: adaptador de CommandCode y proyección explícita del contexto sin precios. Usa el [Provider API de CommandCode](https://commandcode.ai/docs/provider) con `/messages` para Claude y `/chat/completions` para los otros modelos de chat, con una única herramienta por turno y validación estricta con Zod. No se reenvían montos, catálogo completo, historial de precios ni respuestas de cálculo.
- `src/asistente/preguntas.ts`: preguntas determinísticas a partir de los rechazos, sin segunda llamada al modelo.
- `src/servidor/`: flujo, persistencia, plantillas HTML y PDF A4 con Playwright.
- `src/app/`: pantalla y [Route Handlers de Next.js](https://nextjs.org/docs/app/api-reference/file-conventions/route).

El LLM extrae la lista completa de solicitudes y los datos del cliente; todo precio proviene del catálogo. Recibe además los últimos seis turnos de la conversación (solo texto, recortado), para poder responder a una pregunta previa del asistente, por ejemplo el número de la cotización a aprobar. La consulta a la IA se hace fuera del bloqueo del estado: si la cotización cambió mientras tanto, la respuesta no se aplica y se pide reenviar el mensaje. Una salida inválida no modifica las solicitudes, el cliente ni los montos y responde «No entendí, ¿puedes reformularlo?».

## Archivos y persistencia

- `datos-privados/`: originales confidenciales, excluidos de Git junto con todo `*.xlsx`.
- `data/catalogo.json`: 8.772 productos, fuente, hash y fecha. También se excluye de Git.
- [Reporte de importación](data/reporte-importacion.md): 29 correcciones, cero exclusiones y errores de plantilla, sin costos ni márgenes.
- [Verificación de fuentes](data/verificacion-fuentes.md): cinco planillas, comparación de columnas permitidas con rev-4F y lectura de las siete páginas de la transcripción. Para repetir la revisión de planillas: `npx tsx scripts/verificar-fuentes.ts`.
- `public/logo-neltume.svg`: logo original extraído de `xl/media/image2.svg`.
- `data/estado.json`: solicitudes, cliente, historial, copias de productos/precios calculados, documentos, fechas (incluida la de emisión) y correlativos. Escritura temporal con `fsync` + rename, validación estructural al leer y bloqueo entre procesos en `data/.estado.lock`.
- `data/pdf/cotizacion-323.pdf`, `data/pdf/nota-pedido-1.pdf`: documentos emitidos. El E2E usa `data/test-e2e/` (estado, PDF y su propio catálogo) para no consumir los números reales ni reescribir `data/catalogo.json`.

El número se reserva en disco antes de generar el PDF. Un fallo puede dejar un salto, nunca reutilizar un correlativo. La nota usa los precios de lista guardados en la cotización, aunque el catálogo haya cambiado. Respalda `data/estado.json` y `data/pdf/` juntos. No borres el estado para reiniciar los números de una operación real.

## Errores confirmados y supuestos

Se corrigieron por consistencia, no por una lista fija de filas:

- Fila 1193: `LLAG-O-2-A` → `LLAG-O-2-C`; el código duplicaba el alto 2,0, pero sus atributos indican 2,2.
- Filas 7883–7910: 28 marcos de raulí con largo 2; se restauran 2,1…2,6 y 3 según su código.
- `P25`: cero fijo en lugar de fórmula.
- `C8:C32`: búsquedas limitadas a fila 603.
- `Q8`: +25 % solo en la primera línea, frente al −25 % de rev-4F.

Supuestos: +25 % uniforme, medidas de la puerta (sin conversión de vano), cliente opcional, un usuario sin login y ninguna entrega automática. Los montos visibles se redondean a pesos enteros; esa es la diferencia intencional con el cálculo decimal de Excel. El precio neto importado conserva cuatro decimales.

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
- No incluye enchapadas, prepintadas, Puertas Flores SPA, muebles, cuentas de usuario, base de datos, edición del catálogo ni envíos. Catálogo, resolución y precios están separados para extender líneas en el futuro.

## Prueba remota con acceso restringido

No hay túnel configurado. Sigue la [guía oficial de aplicaciones protegidas con Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/). Si se necesita una demostración remota, crea en Cloudflare Zero Trust una aplicación **Access** para el hostname, con una política Allow limitada a los correos autorizados y denegación para los demás. Después configura un Cloudflare Tunnel cuyo servicio sea `http://127.0.0.1:3000`, asociado a ese mismo hostname, y agrega ese hostname a `NELTUME_HOSTS` en `.env.local` (si no, la app responde 403). Verifica en una ventana privada que Access exija autenticación antes de compartir la URL. No uses un Quick Tunnel público ni expongas el puerto directamente: la demo no tiene login propio.
