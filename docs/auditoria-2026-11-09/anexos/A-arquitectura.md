> **Anexo de la auditoría del 9–10 nov 2026.** Informe especializado tal como se entregó. Donde `../01_AUDITORIA_COMPLETA.md` §5.2 lo corrige (por ejemplo, los permisos de la vendedora: en producción todas las cuentas son administradoras), manda el informe consolidado. Las rutas `scratchpad/…` remiten a la evidencia de la sesión de auditoría, que no se guarda en el repositorio.

# Auditoría de arquitectura y seguridad · Cotizador Neltume (tienda)

- **Fecha:** 9-11-2026 · **Commit auditado:** `a641645` (rama `main`, árbol limpio)
- **Alcance:** solo lectura. No se modificó el repo, no se escribió en `data/` ni `datos-privados/`, no se levantaron
  servidores, no se llamó a la IA, a la fábrica ni a Starken. El único archivo generado fuera del informe es una base
  SQLite vacía en el scratchpad (`arquitectura/datos/esquema.sqlite`) para leer el esquema final.
- **Relación con la auditoría del 26-10:** esa auditoría (`AUDITORIA_COTIZADOR_NELTUME.md`, seguimiento en
  `docs/auditoria-2026-10-26.md`) fue sobre todo funcional; sus 65 hallazgos figuran cerrados. Ninguno se repite aquí. El
  hallazgo S-03 es una variante pendiente de BUG-048.

## Resumen

La base es **madura y defensiva**. Cada ruta API autentica en su propio handler. Hay filtro de Host contra DNS
rebinding, defensa CSRF por `Origin` y `Sec-Fetch-Site`, cuerpos leídos con tope, Zod estricto y SQL siempre
parametrizado. No hay `dangerouslySetInnerHTML`. El HTML del PDF se escapa y Chromium imprime sin red. Los archivos
subidos se nombran por su sha256 y el tipo se deduce del contenido. El SVG pasa por una lista blanca con un parser real.
La firma HMAC de la fábrica se compara en tiempo constante. La clave de IA se guarda cifrada con AES-GCM. Los respaldos
se verifican con `integrity_check`.

**No se encontraron hallazgos críticos ni altos explotables.** Lo más relevante:

1. Dependencias con avisos publicados: `better-auth` 1.7.6 tiene uno crítico y uno alto, y `zod` 4.6.5 uno alto. En
   esta configuración no son explotables (no se usan los plugins afectados y los cuerpos tienen tope), pero conviene
   actualizar.
2. **Hay un solo rol en la práctica: toda cuenta es administradora.** Los controles `rol: 'admin'` existen, pero hoy no
   separan nada.
3. Hay deuda de mantenibilidad concentrada en 5 archivos (≈9.600 líneas) y la saga de emisión de documentos está
   repetida 4 veces.

| Severidad | Cantidad |
|---|---|
| Crítica | 0 |
| Alta | 0 |
| Media | 4 |
| Baja | 11 |

**Verificaciones ejecutadas (resultados reales):**

- `npx tsc --noEmit`: **0 errores** (código de salida 0).
- `npx eslint .`: **0 errores, 2 avisos** (`src/app/dialogo.tsx:27` `eyebrow` sin usar; `tests/notas-por-fabrica.test.ts:122`
  `_despacho` sin usar). Son los mismos «2 avisos previos» que menciona el seguimiento del 26-10.
- `npm audit --omit=dev`: **6 avisos** (1 crítico, 2 altos, 2 moderados, 1 bajo). Detalle en S-01.

---

## 1. Mapa de arquitectura

### 1.1 Capas

| Capa | Ruta | Tamaño | Responsabilidad | Depende de |
|---|---|---|---|---|
| UI (cliente y servidor) | `src/app/**` (páginas + componentes `'use client'`) | 96 archivos / 20.189 líneas | Pantallas, diálogos, chat, panel de la cotización. Todo el HTTP pasa por `src/app/solicitud.ts` (`pedirJSON`, `pedirArchivo`) | `negocio`, `catalogo/tipos`; tipos de `servidor` (y 1 import de valores: `historial.tsx:16` ← `servidor/exportar`) |
| API (route handlers) | `src/app/api/**/route.ts` (25 rutas) | — | Autenticación (`exigirSesion`), Zod, armado de respuestas | `servidor` |
| Servicios / persistencia | `src/servidor/**` | 53 archivos / 16.897 líneas | `Servicio` (casos de uso), `chat.ts` (orquestación de la IA), `Almacen`/`Unidad` (unidad de trabajo + bloqueo), `base-datos.ts` (SQLite y migraciones), PDF (Chromium), integración con la fábrica, Starken, autenticación | `negocio`, `catalogo`, `asistente` |
| Reglas puras | `src/negocio/**` | 16 / 2.985 | Precios, IVA, descuentos, vigencia, feriados, estados, límites | — (sin imports de `servidor` ni `app`: capa limpia) |
| Catálogo | `src/catalogo/**` | 12 / 2.291 | Lectura de XLSX (fflate + saxes con topes de descompresión), resolución de modelos, tipos | `negocio` |
| Asistente IA | `src/asistente/**` | 20 / 4.042 | Cliente LLM (CommandCode, proveedor fijo), esquemas de herramientas, anclaje y verificación de cifras, evaluación | `negocio`, `catalogo` (y un `import type` de `servidor/servicio` en `evaluacion.ts:4`) |
| Arranque | `src/instrumentation.ts` | — | `register()` en Node: si hay integración configurada, arranca el reintento periódico de envíos a la fábrica (cada minuto) | `servidor/integracion-envio` |
| Proxy | `src/proxy.ts` | — | Filtro de Host en **páginas**. El matcher excluye `/api/`, `_next/static`, `_next/image` y `favicon.ico`; cada ruta API valida el Host por su cuenta | `servidor/acceso` |

### 1.2 Diagrama

```mermaid
flowchart LR
  subgraph Navegador
    UI[Pantallas React<br/>cotizador.tsx · cotizacion-panel.tsx · historial.tsx…]
    SOL[solicitud.ts<br/>pedirJSON / pedirArchivo]
    UI --> SOL
  end
  CF[Cloudflare Tunnel<br/>cf-connecting-ip] --> PX
  SOL -->|HTTPS + cookie SameSite=Lax| CF
  PX[src/proxy.ts<br/>Host permitido · solo páginas] --> PAGES[page.tsx<br/>auth.api.getSession → redirect /login]
  CF --> API
  subgraph Next[Proceso único next start]
    API[/api/**/route.ts<br/>exigirSesion: Host → Origin/Sec-Fetch-Site → sesión → rol/]
    API --> SRV[Servicio.ejecutar<br/>servicio.ts]
    SRV --> CHAT[chat.ts procesarChat]
    CHAT -->|fuera del bloqueo| LLM[asistente/llm.ts<br/>CommandCode]
    SRV --> NEG[negocio/* reglas puras]
    SRV --> ALM[Almacen.transaccion<br/>proper-lockfile data/.estado.lock]
    ALM --> UNI[Unidad: lee, compara versiones<br/>confirmar() en BEGIN IMMEDIATE]
    UNI --> DB[(SQLite WAL<br/>data/cotizador.sqlite v29)]
    SRV -->|fuera del bloqueo| PDF[pdf.ts Chromium<br/>sin red: route.abort]
    PDF --> FS[(data/pdf · data/referencias<br/>data/integracion)]
    INS[instrumentation.ts] --> ENV[integracion-envio.ts<br/>bandeja + reintentos]
    ENV --> DB
  end
  ENV -->|HMAC v1 firmado| FAB[App de la fábrica<br/>repo no disponible]
  FAB -->|POST firmado connection.test| API
  API -->|/api/starken/*| STK[Starken]
```

### 1.3 Flujo de una acción (de la UI a SQLite)

1. **UI:** un componente llama `pedirJSON('/api/accion', { json: { tipo, id, actualizada, … } })`
   (`src/app/solicitud.ts:130`). Las acciones de edición mandan la versión que vio la persona (`actualizada`).
   `solicitud.ts` traduce 401 (aviso global de sesión vencida), 409 (conflicto: recarga la versión actual), 413, 5xx y
   las páginas HTML del proxy en mensajes en español.
2. **Ruta:** `POST /api/accion` (`src/app/api/accion/route.ts:546`):
   - `exigirSesion(req, { escritura: true })` valida el Host, el `Origin` y `Sec-Fetch-Site`, la sesión de better-auth y
     opcionalmente el rol.
   - `leerJson` lee con tope de 64 KiB (`src/servidor/cuerpo.ts:2`).
   - `accionSchema.safeParse` es una unión discriminada estricta de 27 tipos (`route.ts:36-398`).
   - Las acciones de administración (`regenerar_pdf`, `cambiar_numero`, `emitir` con número manual) se rechazan si el
     rol no es `admin` (`route.ts:555`).
   - Luego `cargarCatalogo()` y se crea `new Servicio(catalogo, llm, new Almacen(), autor, registrarTurno).ejecutar(...)`.
3. **Servicio:** `src/servidor/servicio.ts:621` despacha con un `switch` por `tipo`. Las mutaciones simples llaman a
   `this.almacen.transaccion(u => …)`. El chat (`chat.ts:974`) llama al LLM **antes** de tomar el bloqueo
   (`chat.ts:1038` → `transaccion` en `chat.ts:1080`).
4. **Almacén:** `Almacen.transaccion` (`almacen.ts:1889`) hace lo siguiente:
   - Toma `data/.estado.lock` con proper-lockfile (stale 30 s, hasta 60 reintentos). Ninguna transacción ejecuta código
     asíncrono dentro (no hay `transaccion(async`).
   - Crea una `Unidad` (`almacen.ts:949`) que lee las cotizaciones y anota la versión `actualizada` de cada una.
   - `unidad.confirmar()` abre `BEGIN IMMEDIATE` y vuelve a comparar cada versión. Si alguna cambió, lanza
     `ErrorConflicto` (HTTP 409). Si no, escribe filas, eventos, snapshots y la papelera (`almacen.ts:1253-1286`).
   - Al terminar despierta la bandeja de integración si se encolaron envíos.
5. **SQLite:** `abrirBaseDatos` (`base-datos.ts:1149`) mantiene una conexión por proceso cacheada en `globalThis` con
   `foreign_keys=ON`, `busy_timeout=5000`, `journal_mode=WAL`, `synchronous=FULL` y el archivo en `0600`. Las
   migraciones corren al abrir (`crearEsquema`, `user_version`), cada una en `BEGIN IMMEDIATE`, y se niega a abrir una
   base de una versión más nueva.

**Emisión de documentos** (emitir, generar nota, cambiar número, editar pedido) sigue una saga en tres pasos:

1. `prepararPdf()` comprueba Chromium fuera del bloqueo.
2. Una transacción reserva el número y la marca `emisiones_en_curso`.
3. `generarPdf()` se ejecuta fuera del bloqueo (archivo temporal + `link`, sin sobrescribir nunca). Después una
   segunda transacción confirma, o se borra el PDF si falla. Siempre se libera la marca en `finally`.

### 1.4 Esquema de la base (v29) y cómo se guarda una cotización

`VERSION_ESQUEMA = 29` (`base-datos.ts:10`). Las migraciones v1→v29 son incrementales e idempotentes: usan
`columnasDe`/`table_info` antes de cada `ALTER`. Las tablas de better-auth (`user`, `session`, `account`,
`verification`, `rateLimit`) las crea aparte `npm run auth:migrar` (`autenticacion-config.ts:270`), que se ejecuta al
iniciar el contenedor (`docker/iniciar.sh`).

| Grupo | Tablas |
|---|---|
| Cotización (relacional) | `cotizaciones` (52 columnas: cliente, estados comercial/operativo/facturación, despacho, descuento, flete, `reglas_json`, `busqueda` normalizada), `solicitudes` (ítems pedidos, `item_id` estable con índice único), `cotizacion_lineas` (34 columnas: precio calculado), `cotizacion_montos`, `incompletos` (`rechazo_json`), `historial` (chat), `referencias_item`, `pagos`, `comentarios_internos`, `eventos` (actividad) |
| Notas de pedido | `notas_pedido`, `nota_lineas` (por fábrica), `correlativos`, `correlativos_nota` |
| Documentos | `documentos_snapshot` (HTML emitido, para anular o renumerar sin reimprimir), `emisiones_en_curso` (reserva con ficha y vencimiento) |
| Papelera | `papelera` (borrador completo en JSON) |
| Catálogo | `productos_catalogo`, `productos_adicionales`, `productos_pendientes` (JSON), `catalogo_meta`, `catalogo_origenes`, `catalogo_anterior` (JSON), `catalogo_configuracion` (JSON), `catalogo_ediciones` |
| Configuración | `ajustes` (clave → `valor_json`; la clave de IA cifrada), feriados (3 tablas) |
| Integración | `integracion_envios` (bandeja con `clave_idempotencia`, lease `en_curso_hasta`, backoff, hasta 15 intentos), `integracion_pruebas` (incluye el PDF como BLOB; se poda por antigüedad en `limpieza.ts:131`) |
| Auditoría | `auditoria_cuentas`, `migraciones_datos` |

**Conclusión:** la cotización vive **en tablas relacionales**. El JSON se usa solo en piezas auxiliares (reglas,
papelera, ajustes, propuestas del catálogo). Los PDF y las referencias del cliente se guardan en disco (`data/pdf`,
`data/referencias/<sha256>.<ext>`, `data/integracion`).

### 1.5 Inventario de pantallas

| Ruta | Archivo | Autorización | Contenido |
|---|---|---|---|
| `/` | `src/app/page.tsx` | `getSession` → `/login` | `Cotizador` (chat + panel de la cotización) |
| `/historial` | `src/app/historial/page.tsx` | sesión | `PantallaHistorial` (listado, filtros, CSV, papelera) |
| `/catalogo` | `src/app/catalogo/page.tsx` | sesión | `PantallaCatalogo` (secciones: importar, alta, manuales, configuración) |
| `/clientes` | `src/app/clientes/page.tsx` | sesión | `PantallaClientes` |
| `/ajustes` | `src/app/ajustes/page.tsx` | sesión | `PantallaAjustes` (IA, empresa, Starken, cuentas, sesiones, conexión) |
| `/ayuda` | `src/app/ayuda/page.tsx` | sesión | Ayuda estática |
| `/configuracion` | `src/app/configuracion/page.tsx` | (solo redirige) | Redirecciones heredadas a `/ajustes` o `/catalogo` |
| `/login` | `src/app/login/page.tsx` | sin sesión (con sesión → `/`) | `LoginForm` / `PrimeraCuenta` |

Todas las páginas pasan antes por el filtro de Host de `src/proxy.ts`.

### 1.6 Inventario de rutas API

`S` = sesión, `A` = rol admin, `W` = escritura (`Origin` y `Sec-Fetch-Site` same-origin). Todas validan el Host.

| Ruta | Métodos | Autorización | Notas |
|---|---|---|---|
| `/api/accion` | GET, POST | GET: S · POST: S+W; A en `regenerar_pdf`, `cambiar_numero`, `emitir` con número, `GET ?numeracion` | Casi toda la lógica de la cotización; exporta CSV con neutralización de fórmulas (`exportar.ts:67`) |
| `/api/ajustes` | GET, POST | GET: S · POST: S+W+A | `If-Match` contra pisadas |
| `/api/ajustes/modelos` | GET | S | Lista de modelos (llamada externa a CommandCode) |
| `/api/ajustes/probar` | POST | S+W+A | Consume cuota de la IA |
| `/api/ajustes/conexion` | GET, POST | GET: S+A · POST: S+W+A | Envía la prueba firmada a la fábrica |
| `/api/ajustes/conexion/pruebas/[id]` | GET | S+A | PDF recibido; `id` validado con `^\d{1,12}$` |
| `/api/auth/[...all]` | GET, POST | Host + W en POST | better-auth; bloquea `/admin/*` y `/list-sessions` (también codificados) |
| `/api/catalogo` | GET, POST | GET: S · POST: S+W (A para productos importados y `volver_planilla`) | |
| `/api/catalogo/importar` | GET, POST | S(+W)+A | Tope de cuerpo y de descompresión del XLSX |
| `/api/catalogo-configuracion` | GET, POST | GET: S · POST: S+W+A | |
| `/api/clientes` | GET | S | |
| `/api/configuracion-negocio` | GET, POST | GET: S · POST: S+W+A | |
| `/api/documento/[archivo]` | GET | S | Lista blanca por regex: no hay path traversal |
| `/api/integracion/envios` | GET | S | |
| `/api/integrations/neltume/connection-tests` | POST (resto 405) | **Sin sesión: firma HMAC** | Host, Content-Type y tope 2 MiB; sin leer el cuerpo si faltan cabeceras; 8 lecturas simultáneas, plazo de 10 s, idempotencia, registro con tope |
| `/api/logo` | GET | S | SVG con CSP `sandbox` |
| `/api/primer-arranque` | GET, POST | **Sin sesión**; solo existe sin cuentas; código de un solo uso (hash + sal, 24 h, 10 intentos, `enExclusiva`) | |
| `/api/referencias` | POST | S+W | 10 MB, tipo por firma de bytes |
| `/api/referencias/[archivo]` | GET | S | `^[0-9a-f]{64}\.(jpg\|png\|webp\|pdf)$` |
| `/api/salud` | GET | **Sin sesión** → `{ok}`; con sesión de admin → detalle | El arranque de Chromium se cachea (no se puede usar para DoS) |
| `/api/sesiones` | GET, POST | S / S+W | No devuelve tokens |
| `/api/starken` | GET, POST | GET: S · POST: S+W+A | |
| `/api/starken/ciudades` | GET | S | Caché de 24 h |
| `/api/starken/cotizar` | POST | S+W | Tarifa firmada con HMAC (clave derivada por HKDF) |
| `/api/usuarios` | GET, PATCH, POST | S(+W)+A | Confirmación con contraseña y tope de intentos; serializado con `enSerie` |

**No se encontró ninguna ruta sin verificación.** Las tres públicas (`connection-tests`, `primer-arranque`, `salud`)
lo son a propósito y están protegidas por otros medios.

---

## 2. Hallazgos

### S-01 · Dependencias de producción con avisos publicados (better-auth crítico/alto, zod alto)

- **Severidad:** Media · **Prioridad:** P2 · **Categoría:** Seguridad / dependencias
- **Archivo/líneas:** `package.json` (`better-auth ^1.7.6`, `zod ^4.0.0`); instalados: `better-auth@1.7.6`, `zod@4.6.5`.
- **Evidencia:** `npm audit --omit=dev` reporta:
  - better-auth `<1.7.7`:
    - GHSA-965c-763c-88jm, crítico: «OAuth state can be used as a Magic Link to sign in as another user».
    - GHSA-r4xp-prcw-77qf, alto: «OAuth Proxy lets an attacker sign in as another user».
    - GHSA-44jh-23m7-hpcf, bajo: Postgres.
  - zod `<4.6.6`: GHSA-mrhx-c7xc-m3w5, alto: agotamiento de memoria al validar colecciones grandes con restricciones.
  - vitest/vite aparecen porque `vitest` es peer opcional de better-auth. Son herramientas de desarrollo; en la imagen,
    `npm prune --omit=dev` las deja fuera.
- **Por qué importa:** en la configuración actual el riesgo efectivo es bajo:
  - `autenticacion-config.ts:209-231` usa solo `emailAndPassword` y el plugin `admin`. No hay OAuth, OAuth Proxy ni
    magic link.
  - Los cuerpos JSON tienen tope de 64 KiB (`cuerpo.ts:2`) y `.max()` en las listas. El de la integración solo se
    interpreta después de validar el HMAC.

  Aun así, un aviso crítico en la biblioteca de autenticación es un riesgo latente: basta con activar un plugin más
  adelante para quedar expuesto, y los auditores externos lo marcarán.
- **Arreglo recomendado:** subir `better-auth` a ≥1.7.7 y `zod` a ≥4.6.6 (`npm audit fix` dice que hay arreglo para
  ambos). Luego correr las pruebas de login y sesiones y la suite completa.
- **Causa raíz:** rangos `^` sin una actualización reciente del lockfile.
- **Observado vs esperado:** 1 crítico y 2 altos en dependencias directas frente a 0 en producción.
- **Pruebas requeridas:** `npm audit --omit=dev` sin altos ni críticos; `tests/login.e2e.ts`, `tests/sesiones-rutas.test.ts`,
  pruebas de `usuarios`; la E2E completa.
- **Esfuerzo:** S (≤½ día, más la verificación) · **Confianza:** confirmado (avisos); no explotable aquí (probable).

### S-02 · Hay un solo rol: toda cuenta es administradora, y los controles `rol: 'admin'` no separan nada

- **Severidad:** Media · **Prioridad:** P2 · **Categoría:** Seguridad / autorización (decisión de diseño a confirmar)
- **Archivo/líneas:**
  - Todas las cuentas se crean y normalizan como `admin`: `src/servidor/autenticacion-config.ts:231`
    (`admin({ defaultRole: 'admin' })`), `:276` (`UPDATE "user" SET role = 'admin' WHERE role IS NULL OR role <> 'admin'`),
    `src/app/api/usuarios/route.ts:219` (`role: 'admin'`), `src/app/api/primer-arranque/route.ts:73`, `scripts/usuarios.ts:101`.
  - El rol nulo se interpreta distinto según el archivo: `'user'` en `acceso-autenticado.ts:33`, `app/page.tsx:19`,
    `ajustes/page.tsx:20` y `catalogo/page.tsx:21`; `'admin'` en `usuarios/route.ts:92` y `:170` (al contar las
    administradoras activas).
- **Evidencia:** la migración de autenticación deja todas las cuentas en `admin` («Neltume no tiene cuentas de rol
  usuario»). Por eso cualquier vendedora puede:
  - cambiar o borrar la clave de IA y la configuración de la empresa, Starken y el catálogo;
  - importar y revertir planillas;
  - fijar números de cotización y de nota a mano y regenerar PDF;
  - crear y desactivar cuentas y **restablecer la contraseña de otra cuenta** (con su propia contraseña;
    `usuarios/route.ts:135-141`);
  - ver el detalle de `/api/salud`.
- **Por qué importa:** si se compromete una sola cuenta (o se equivoca una persona), el impacto es total y no hay
  mínimo privilegio. El código además sugiere una separación que no existe: 15 rutas comprueban `rol: 'admin'` y la UI
  oculta botones según el rol. Quien revise o pruebe confiará en ella. La interpretación distinta del rol nulo hoy no
  se alcanza (se normaliza en cada arranque), pero si llegara a existir una cuenta con `role` nulo, esa cuenta contaría
  como «última administradora» para `desactivar` y a la vez recibiría 403 en las rutas de administración.
- **Arreglo recomendado:** decidirlo con Neltume.
  - (a) Si un solo rol es lo deseado, documentarlo como decisión (ADR) y quitar o centralizar las comprobaciones
    decorativas.
  - (b) Si no, introducir un rol `vendedora` (`defaultRole: 'user'`, sin normalizar todo a admin). Restringir a admin
    Ajustes, cuentas, catálogo, Starken y numeración. Unificar en una sola función `rolDe(user)` cómo se interpreta el
    rol nulo.
- **Causa raíz:** se simplificó a «todas administran» y quedaron las comprobaciones de rol.
- **Observado vs esperado:** cualquier cuenta tiene todos los permisos, cuando lo esperable es mínimo privilegio, o al
  menos una decisión documentada.
- **Pruebas requeridas:** una matriz de autorización por ruta y rol (prueba que recorra `src/app/api/**/route.ts`,
  ver M-05); una prueba de `desactivar` con una cuenta de rol nulo.
- **Esfuerzo:** S para documentar · M para dos roles · **Confianza:** confirmado.

### S-03 · `/api/auth/get-session` entrega el token de sesión (el mismo motivo por el que se bloqueó `list-sessions`)

- **Severidad:** Baja · **Prioridad:** P3 · **Categoría:** Seguridad / sesiones
- **Archivo/líneas:** `src/servidor/autenticacion-config.ts:55-56` (solo `esRutaSesionesCruda` para `list-sessions`);
  `src/app/api/auth/[...all]/route.ts:11-23`. En better-auth: `node_modules/better-auth/dist/api/routes/session.mjs:225-228`
  responde `parseSessionOutput(session)`. El campo `token` de la sesión no lleva `returned: false`
  (`node_modules/@better-auth/core/dist/db/get-tables.mjs:105`).
- **Evidencia:** BUG-048 bloqueó `/api/auth/list-sessions` porque devolvía tokens al navegador. `GET /api/auth/get-session`,
  que sigue expuesta, devuelve `{ session: { token, … }, user }` con el mismo filtro de campos.
- **Por qué importa:** la cookie es `httpOnly`. Si alguna vez hubiera una XSS (hoy no se encontró ninguna), el token
  podría leerse de esta respuesta y robarse la sesión fuera del navegador. Es el mismo razonamiento que ya se aplicó a
  BUG-048.
- **Arreglo recomendado:** las páginas usan `auth.api.getSession` en el servidor, así que conviene verificar si el
  navegador usa `get-session`. Si no la usa, bloquearla como `list-sessions`. Si la usa, quitar `session.token` con un
  hook `after` sobre `/get-session`.
- **Causa raíz:** se bloqueó el síntoma en un endpoint y no el campo.
- **Observado vs esperado:** el token sale en el JSON, cuando no debería salir en ningún endpoint accesible desde el
  navegador.
- **Pruebas requeridas:** prueba unitaria que llame al handler con una cookie válida y verifique que la respuesta no
  contiene el token (ni en `get-session` ni en `list-sessions`).
- **Esfuerzo:** XS · **Confianza:** probable (lectura del código de better-auth 1.7.6; no se ejecutó).

### S-04 · `.gitignore` no cubre `data/referencias/` (fotos de clientes) ni otros archivos de `data/`

- **Severidad:** Baja · **Prioridad:** P2 · **Categoría:** Seguridad / privacidad de datos
- **Archivo/líneas:** `.gitignore:1-25` (ignora `data/pdf/`, `*.sqlite`, `*.pdf`, `data/test-*/`, etc., pero no
  `data/` completo).
- **Evidencia:** `git check-ignore` devuelve **NO ignorado** para `data/referencias/abc.jpg`, `data/referencias/abc.png`,
  `data/integracion/x.json`, `data/ajustes.json` y `data/logo.svg`. Sí ignora `data/integracion/pdf/x.pdf` (por `*.pdf`)
  y `datos-privados/`. Hoy `data/referencias/` no existe en esta máquina, pero la app la crea en cuanto se adjunta una
  foto (`archivos-referencia.ts:19`).
- **Por qué importa:** un `git add -A` o `git add data` en una máquina de desarrollo con datos reales versionaría fotos,
  croquis o planos de clientes (datos personales) y quedarían en el historial.
- **Arreglo recomendado:** cambiar a `data/*` con excepciones explícitas (`!data/reporte-importacion.md`,
  `!data/verificacion-fuentes.md`).
- **Causa raíz:** un ignore por archivo en vez de por carpeta.
- **Observado vs esperado:** solo algunos archivos de `data/` están ignorados, cuando todo `data/` debería estarlo salvo
  las excepciones.
- **Pruebas requeridas:** `git check-ignore` sobre las rutas anteriores dentro de `scripts/verificar.mjs`.
- **Esfuerzo:** XS · **Confianza:** confirmado.

### S-05 · `.env.local` legible por todos (644) con secretos de servicios reales

- **Severidad:** Baja · **Prioridad:** P3 · **Categoría:** Seguridad / secretos
- **Archivo/líneas:** `/Users/allopze/dev/Neltume/tienda_puertas/Cotizador/.env.local`. Permisos `-rw-r--r--`. Contiene
  `CMD_API_KEY`, `BETTER_AUTH_SECRET`, `STARKEN_CLAVE` y `NELTUME_FABRICA_PANGUIPULLI_SECRETO` (no se copian valores).
  Está ignorado por git (`.gitignore: .env*`) y nunca se versionó (`git log --all -- .env.local` vacío).
- **Evidencia:** el grep de patrones de clave en el repo versionado no encontró nada. La base local sí está en `0600`.
- **Por qué importa:** en una máquina con más usuarios o procesos, la clave de la IA, la de Starken y el secreto
  compartido con la fábrica quedan legibles. Si son los mismos que en producción (la memoria del proyecto indica un
  cruce real con la fábrica), su fuga permite firmar mensajes como la tienda.
- **Arreglo recomendado:** `chmod 600 .env.local`. Usar secretos distintos para desarrollo y producción, sobre todo el
  de la fábrica. Rotarlos si se compartieron.
- **Causa raíz:** el archivo se creó con el umask por defecto.
- **Observado vs esperado:** permisos 644, cuando deberían ser 600 y con secretos de desarrollo propios.
- **Pruebas requeridas:** ninguna automatizada; revisión manual.
- **Esfuerzo:** XS · **Confianza:** confirmado (permisos); hipótesis (que sean los de producción).

### S-06 · Sin límite por usuario en acciones que cuestan dinero o disco

- **Severidad:** Baja · **Prioridad:** P3 · **Categoría:** Seguridad / disponibilidad y costo
- **Archivo/líneas:**
  - `src/app/api/accion/route.ts:557-583` (chat con `crearLLM()`, sin límite).
  - `src/app/api/starken/cotizar/route.ts:32`.
  - `src/app/api/referencias/route.ts:50-85` (10 MB por archivo, sin cuota; las huérfanas se borran solo con
    `limpiar-borradores`, tras 24 h de gracia; `archivos-referencia.ts:105`).
  - `src/app/api/ajustes/modelos/route.ts:7` (llamada externa por cada GET).
- **Evidencia:** solo el login (`autenticacion-config.ts:221-229`), la confirmación de contraseña
  (`usuarios/route.ts:30-79`) y la recepción de la fábrica tienen topes. El chat solo está acotado por el plazo de la IA
  y `max_tokens: 8192` (`llm.ts:588`).
- **Por qué importa:** una cuenta comprometida, un script o un bucle de reintentos en la UI pueden generar costo de IA
  o llenar el disco. `comprobarDisco` avisa, pero no frena las subidas.
- **Arreglo recomendado:** un token bucket en memoria por usuario (el proceso es único) para `chat`, `starken/cotizar` y
  `referencias`. Rechazar subidas por debajo del umbral crítico de disco. Opcionalmente, una cuota diaria de turnos de
  IA.
- **Causa raíz:** el modelo de amenaza es «usuarias internas de confianza».
- **Observado vs esperado:** sin tope, cuando lo esperable es un tope razonable por cuenta.
- **Pruebas requeridas:** una prueba unitaria del limitador (N+1 → 429 con `Retry-After`); una prueba de la ruta de
  referencias con poco disco.
- **Esfuerzo:** S · **Confianza:** confirmado.

### S-07 · La firma HMAC no cubre método, ruta ni sentido; el mismo secreto se usa en ambos sentidos

- **Severidad:** Baja · **Prioridad:** P3 · **Categoría:** Seguridad / integración
- **Archivo/líneas:** `src/servidor/integracion-firma.ts:22-27` (firma = HMAC(secreto, `timestamp.` ‖ cuerpo));
  `integracion-prueba-recepcion.ts:126-133` (se prueba el secreto de cada fábrica); `integracion-configuracion.ts:53`
  (un `_SECRETO` por fábrica).
- **Evidencia:** lo que está bien:
  - la comparación es en tiempo constante (`timingSafeEqual`, con chequeo de largo);
  - la ventana es de ±300 s;
  - la idempotencia se hace por `eventId`, con detección de conflicto por sha256 del cuerpo;
  - el receptor exige `source: 'neltume-factory'` y `.strict()`, así que un mensaje firmado por la tienda no se puede
    reinyectar en la tienda.

  Sin embargo, la cadena firmada no incluye método, ruta, host ni sentido. La separación entre tipos de mensaje
  (pedidos tienda→fábrica, pruebas de conexión, eventuales «pull» del plan P0–P4) depende solo de los campos del
  cuerpo y de los esquemas del otro lado.
- **Por qué importa:** si en la app de la fábrica dos endpoints aceptaran cuerpos compatibles, un mensaje firmado
  válido podría reproducirse contra otro endpoint durante 5 minutos. No se pudo verificar: el repo de la fábrica no
  está disponible.
- **Arreglo recomendado:** para `v2`, firmar `método\nruta\ntimestamp\ncuerpo` y derivar subclaves por sentido con HKDF
  (`tienda→fábrica` y `fábrica→tienda`). Mientras tanto, confirmar con la fábrica que cada endpoint valida `eventType` y
  `source` estrictos.
- **Causa raíz:** el contrato v1 se diseñó con un solo tipo de mensaje por sentido.
- **Observado vs esperado:** la firma está ligada solo al cuerpo, cuando debería estar ligada también al endpoint y al
  sentido.
- **Pruebas requeridas:** vectores de prueba compartidos entre ambos repos para v2; una prueba que rechace una firma
  válida presentada en otra ruta.
- **Esfuerzo:** M (coordinado con la fábrica) · **Confianza:** hipótesis (depende del otro repo).

### S-08 · CSP mínima: solo `frame-ancestors`

- **Severidad:** Baja · **Prioridad:** P3 · **Categoría:** Seguridad / cabeceras (defensa en profundidad)
- **Archivo/líneas:** `next.config.ts:3-13`.
- **Evidencia:** las cabeceras globales son `X-Frame-Options: DENY`, `CSP: frame-ancestors 'none'`, `nosniff`,
  `Referrer-Policy: same-origin` y HSTS en producción (180 días, sin `includeSubDomains`). El comentario dice que una CSP
  completa exigiría nonces. Las rutas de logo y referencias sí tienen CSP estricta propia.
- **Por qué importa:** hoy no hay vector de XSS conocido (React escapa, no hay `dangerouslySetInnerHTML`). Una CSP
  limitaría el daño de una regresión futura.
- **Arreglo recomendado:** agregar ya las directivas que no necesitan nonce: `object-src 'none'; base-uri 'self';
  form-action 'self'`. Más adelante, CSP con nonce desde `src/proxy.ts` (Next 16 lo admite; ver
  `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`).
- **Causa raíz:** el costo de los nonces.
- **Observado vs esperado:** CSP de 1 directiva, cuando lo esperable es al menos `object-src`, `base-uri` y `form-action`.
- **Pruebas requeridas:** E2E que verifique las cabeceras y que las pantallas no tengan violaciones de CSP en consola.
- **Esfuerzo:** XS (directivas básicas) · M (nonces) · **Confianza:** confirmado.

### S-09 · PDFs de terceros servidos inline en el mismo origen

- **Severidad:** Baja · **Prioridad:** P3 · **Categoría:** Seguridad / contenido subido
- **Archivo/líneas:**
  - `src/app/api/referencias/[archivo]/route.ts:41-47`: un PDF del cliente se sirve con `inline`, CSP solo
    `frame-ancestors`, sin `sandbox`.
  - `src/app/api/ajustes/conexion/pruebas/[id]/route.ts:28-34`: el PDF recibido de la fábrica se sirve con `inline`,
    sin CSP.
- **Evidencia:** las imágenes sí llevan `sandbox`. El comentario explica que Chrome no muestra un PDF bajo `sandbox`. El
  PDF de la fábrica pasa firma, sha256 y `motivoPdfInvalido`; el del cliente solo se valida por la cabecera `%PDF-`.
- **Por qué importa:** el visor de Chrome (PDFium) aísla el JS del PDF. Otros visores (pdf.js de Firefox, con
  scripting) ejecutan en un sandbox propio. El riesgo es bajo, pero es contenido no confiable abierto en el origen de la
  app.
- **Arreglo recomendado:** servir los PDF de referencia como `attachment` por omisión, o desde un subdominio sin
  cookies. Agregar `Content-Security-Policy: sandbox; frame-ancestors 'none'` en la ruta de pruebas, donde la vista
  inline es solo para administración.
- **Causa raíz:** la usabilidad (ver el PDF en el navegador).
- **Observado vs esperado:** PDF inline en el mismo origen, cuando lo esperable es descarga o un origen aislado.
- **Pruebas requeridas:** prueba de cabeceras de ambas rutas.
- **Esfuerzo:** XS–S · **Confianza:** hipótesis (depende del visor).

### S-10 · Lectura de cuerpos sin plazo en rutas autenticadas, implementada tres veces

- **Severidad:** Baja · **Prioridad:** P3 · **Categoría:** Disponibilidad / mantenibilidad
- **Archivo/líneas:** `src/servidor/cuerpo.ts:24-49` (`leerBytes`, plazo opcional); `src/app/api/referencias/route.ts:23-44`
  (`leerConTope`, copia sin plazo); `src/app/api/catalogo/importar/route.ts:30-54` (`leerFormulario`, otra copia sin
  plazo); `leerJson` (`cuerpo.ts:52`) llama a `leerBytes` sin plazo.
- **Evidencia:** solo la ruta pública de la fábrica pasa `plazoLecturaMs` y limita lecturas simultáneas.
- **Por qué importa:** una conexión autenticada lenta retiene hasta 10 MB y un handler indefinidamente (slowloris
  autenticado; Cloudflare mitiga en parte). Tener tres copias del mismo bucle invita a corregir una y olvidar las otras.
- **Arreglo recomendado:** usar `leerBytes(req.body, max, 30_000)` en las tres rutas y borrar las copias.
- **Causa raíz:** cada ruta implementó su propio lector.
- **Observado vs esperado:** 3 implementaciones, 1 con plazo, cuando lo esperable es 1 implementación con plazo en todas.
- **Pruebas requeridas:** las pruebas existentes de subida y de importación; una prueba de cuerpo lento que dé 408.
- **Esfuerzo:** S · **Confianza:** confirmado.

### I-01 · Correctitud ligada a un único proceso Node (límites y colas en memoria)

- **Severidad:** Baja · **Prioridad:** P3 · **Categoría:** Integridad / concurrencia (riesgo arquitectónico)
- **Archivo/líneas:**
  - Topes de fallos de login por correo: `autenticacion-config.ts:120-141`.
  - Confirmaciones de contraseña y cola `enSerie`: `usuarios/route.ts:30-50`.
  - `lecturasEnCurso` y topes del registro: `integracion-prueba-recepcion.ts:62-63`.
  - Firma de Starken con clave aleatoria si falta el secreto: `starken-firma.ts:19-24`.
  - Chromium compartido: `pdf.ts:653`.
  - Intervalo de integración: `instrumentation.ts`.
- **Evidencia:** las escrituras sí se coordinan entre procesos: `proper-lockfile` sobre `data/.estado.lock`, `BEGIN
  IMMEDIATE` y un lease `en_curso_hasta` en la bandeja. Eso protege a los scripts de terminal. Pero la cola que impide
  dejar cero administradoras (BUG-045) y los topes anti fuerza bruta viven en memoria.
- **Por qué importa:** con dos réplicas o un `next start` en cluster, BUG-045 podría reaparecer y los topes se
  dividirían entre procesos. Hoy no pasa (Compose con 1 contenedor, `next start`), pero no está escrito como
  restricción de despliegue.
- **Arreglo recomendado:** documentar «un solo proceso» en `docker/LEEME.md` y en el README. Si se escala, mover la
  serialización de cuentas a una transacción SQLite (`BEGIN IMMEDIATE` + conteo) y los topes a la tabla `rateLimit`.
- **Causa raíz:** el despliegue tiene una sola instancia por diseño.
- **Observado vs esperado:** el supuesto es implícito, cuando debería estar declarado o eliminado.
- **Pruebas requeridas:** prueba de `desactivar` concurrente desde dos `Almacen`/conexiones distintas.
- **Esfuerzo:** XS (documentar) · M (eliminar el supuesto) · **Confianza:** confirmado.

### M-01 · Archivos y funciones gigantes concentran el riesgo de regresión

- **Severidad:** Media · **Prioridad:** P2 · **Categoría:** Mantenibilidad
- **Archivo/líneas:**
  - `src/servidor/servicio.ts` (2.367 líneas): `ejecutar` 214 líneas (`:621-835`), `editar` 166 (`:1090`),
    `editarPedido` 134 (`:2195`), `cambiarNumero` 118 (`:2077`).
  - `src/servidor/chat.ts` (1.569): `procesarChat` ≈527 líneas en una sola función (`:974-1500`).
  - `src/app/cotizador.tsx` (1.884): el componente `Cotizador` ocupa ≈1.750 líneas (`:130-1884`), con 23 `useState` y
    19 `useEffect`.
  - `src/app/cotizacion-panel.tsx` (1.836): `CotizacionPanel` ≈1.500 líneas (`:337`).
  - `src/servidor/almacen.ts` (1.967): mezcla carga/serialización, `Unidad` (`:949`), `Almacen` (`:1304`), listados y
    papelera.
- **Evidencia:** el incidente más reciente (commit `a641645`, «prevent mistaking delivery destinations…») y la mayoría
  de los BUG del 26-10 caen en `chat.ts` y `servicio.ts`.
- **Por qué importa:** funciones de cientos de líneas con muchas ramas son difíciles de revisar y de probar por
  partes, y concentran los cambios de varias personas y agentes. Es el principal factor de costo para corregir sin
  romper.
- **Arreglo recomendado:** refactor incremental, sin cambiar comportamiento y con las E2E como red:
  - `servicio.ts` → un módulo por caso de uso (`emision.ts`, `notas.ts`, `numeracion.ts`, `edicion.ts`) y que
    `ejecutar` sea solo un despachador.
  - `procesarChat` → etapas con nombre: interpretar → anclar → validar → aplicar → responder.
  - `Cotizador` → hooks `useCotizacionAbierta`, `useChat`, `useEmision`.
  - `almacen.ts` → `serializacion.ts`, `unidad.ts`, `consultas.ts`.
- **Causa raíz:** el crecimiento por funcionalidad sin pausas de reestructuración.
- **Observado vs esperado:** 5 archivos suman ≈9.600 líneas (≈21 % del código de `src`), cuando lo razonable son
  módulos de menos de 600 líneas y funciones de menos de 100.
- **Pruebas requeridas:** las existentes (97 archivos de vitest y 40 E2E) antes y después de cada paso; la evaluación
  de la IA (`evaluar:regresion`) después de tocar el chat.
- **Esfuerzo:** L (por etapas) · **Confianza:** confirmado.

### M-02 · La saga de emisión de documentos está duplicada cuatro veces

- **Severidad:** Media · **Prioridad:** P2 · **Categoría:** Mantenibilidad / integridad
- **Archivo/líneas:** `src/servidor/servicio.ts` en cuatro lugares: emitir `:1257-1408`; generar nota `:1813-1970`;
  `cambiarNumero` `:2077-2195`; `editarPedido` `:2195-2326`.
- **Evidencia:** los cuatro repiten la misma secuencia:
  1. `transaccion(preparar)`;
  2. `prepararPdf()`;
  3. `transaccion(reservar + marca en emisión)`;
  4. `generarPdf()`, uno o varios;
  5. `transaccion(confirmar)`;
  6. `rm` de los PDF si falla;
  7. `liberarEmision` en `finally`.

  Ejemplo en `:1329-1408`. Varios BUG del 26-10 (024 «número reservado», 044 «PDF congelado», 016 «renumerada») se
  corrigieron en esta zona.
- **Por qué importa:** las invariantes (no reutilizar un número, no dejar PDF huérfanos, liberar la marca) se mantienen
  a mano en cuatro lugares. Un arreglo futuro aplicado en solo uno produce una inconsistencia que las pruebas
  difícilmente cubren completa.
- **Arreglo recomendado:** extraer `conDocumentosReservados({ preparar, reservar, imprimir, confirmar })` que garantice
  el orden, la limpieza y la liberación, y dejar en cada caso de uso solo sus partes específicas.
- **Causa raíz:** los casos de uso se agregaron copiando el primero.
- **Observado vs esperado:** 4 copias, cuando lo esperable es 1 plantilla probada.
- **Pruebas requeridas:** una prueba de la plantilla con fallas inyectadas en cada paso (Chromium no arranca, falla
  la confirmación, conflicto de versión) que verifique que no queda PDF, la marca se libera y el correlativo no se
  repite. Después, las E2E de emisión, nota, PDF regenerado y renumerado.
- **Esfuerzo:** M · **Confianza:** confirmado.

### M-03 · El esquema Zod de `/api/accion` y el tipo `Accion` se mantienen por separado

- **Severidad:** Baja · **Prioridad:** P3 · **Categoría:** Mantenibilidad
- **Archivo/líneas:** `src/app/api/accion/route.ts:36-398` (27 variantes `tipo: z.literal`); `src/servidor/acciones.ts:8-130`
  (28 variantes; `nueva` es solo de pruebas).
- **Evidencia:** no hay `z.infer` ni `satisfies`. `tsc` solo comprueba que la salida del esquema sea asignable a
  `Accion` en `ejecutar(parsed.data)`. Un campo nuevo opcional en `Accion` que no se agregue al esquema no lo detecta
  nadie: el esquema `.strict()` lo rechaza con 400 en producción. Pasó con `restaurar_items` (regresión del 27-10 en el
  seguimiento).
- **Arreglo recomendado:** definir `Accion = z.infer<typeof accionSchema>` (más `nueva` aparte) o declarar
  `accionSchema satisfies z.ZodType<AccionApi>` con una prueba de tipos en ambos sentidos.
- **Causa raíz:** el tipo es anterior al esquema.
- **Observado vs esperado:** dos fuentes de verdad, cuando debería haber una.
- **Pruebas requeridas:** una prueba de tipos (`expectTypeOf`) de equivalencia.
- **Esfuerzo:** S · **Confianza:** confirmado.

### M-04 · Observabilidad: registro de texto libre, sin id de solicitud ni captura central de errores

- **Severidad:** Baja · **Prioridad:** P3 · **Categoría:** Observabilidad
- **Archivo/líneas:** `src/servidor/errores.ts:73-77` (`console.error` con el stack); `route.ts:571-575` (el diagnóstico
  del asistente es la única línea JSON); `src/instrumentation.ts` (sin `onRequestError`).
- **Evidencia:** lo que está bien:
  - el registro tiene tope por minuto en la integración;
  - nunca registra texto del chat, contraseñas ni la clave de IA (`commandcode-chat.ts:77` y `llm.ts:613` redactan la
    clave);
  - `/api/salud` revisa la base, la versión del esquema, el disco, Chromium, la integración, la IA, Starken, los
    feriados y el último respaldo.

  Lo que falta: correlación por solicitud, niveles estructurados y captura de errores no manejados de Server
  Components y route handlers. Next 16 ofrece el hook `onRequestError` en `instrumentation.ts`
  (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md`).
- **Por qué importa:** con `docker compose logs` (10 MB × 3) es difícil reconstruir una falla de una vendedora
  concreta o encontrar errores que hoy terminan en la página 500 por defecto.
- **Arreglo recomendado:** un registrador JSON mínimo (`{ts, nivel, origen, reqId, usuario?, msg}`) con `reqId`
  generado en `exigirSesion` y devuelto en la cabecera `X-Request-Id`; exportar `onRequestError` en
  `instrumentation.ts`.
- **Causa raíz:** registro ad hoc por módulo (21 llamadas a `console.*` en `src`).
- **Observado vs esperado:** registro de texto sin correlación, cuando lo esperable es un registro estructurado y
  correlacionable.
- **Pruebas requeridas:** prueba unitaria del registrador; verificación manual en los logs de Compose.
- **Esfuerzo:** S · **Confianza:** confirmado.

### M-05 · No hay una prueba que recorra todas las rutas API y exija autenticación

- **Severidad:** Baja · **Prioridad:** P3 · **Categoría:** Seguridad / pruebas
- **Archivo/líneas:** `tests/` (97 `*.test.ts`, 40 `*.e2e.ts`). Las pruebas de rutas son por ruta
  (`tests/sesiones-rutas.test.ts`, `tests/starken-rutas.test.ts`, `tests/subidas-logo.test.ts`, …).
- **Evidencia:** hoy las 25 rutas están bien protegidas (tabla 1.6), pero eso depende de que cada ruta nueva recuerde
  llamar a `exigirSesion`. El proxy no cubre `/api/*` a propósito.
- **Por qué importa:** una ruta nueva sin `exigirSesion` quedaría pública sin que ninguna prueba lo note.
- **Arreglo recomendado:** una prueba que haga `glob('src/app/api/**/route.ts')`, importe cada handler y verifique tres
  cosas:
  - sin cookie, todo método exportado responde 401/403/404/405 (con una lista blanca explícita para
    `connection-tests`, `primer-arranque`, `salud` y `auth`);
  - con un Host ajeno responde 403;
  - una escritura con `Sec-Fetch-Site: cross-site` responde 403.
- **Causa raíz:** la autenticación se aplica en cada handler, sin un guardián central.
- **Observado vs esperado:** la cobertura de autenticación depende de la disciplina, cuando debería garantizarla una
  prueba.
- **Esfuerzo:** S · **Confianza:** confirmado.

### M-06 · Límite UI/servidor sin `server-only`; un componente de cliente importa valores de `src/servidor`

- **Severidad:** Baja · **Prioridad:** P3 · **Categoría:** Arquitectura / mantenibilidad
- **Archivo/líneas:** `src/app/historial.tsx:16` (`'use client'`) importa `{ MAX_EXPORTACION, partesExportacion }` de
  `@/servidor/exportar`. Otros 4 componentes de cliente importan solo tipos (`import type`). `grep server-only src`
  no devuelve nada.
- **Evidencia:** `exportar.ts` hoy solo importa de `negocio/` (es puro), así que el bundle no arrastra código de
  servidor.
- **Por qué importa:** si `exportar.ts` (o cualquier módulo de `servidor/` importado por valor) incorporara mañana
  `base-datos` o lecturas de `process.env`, el error aparecería en el build o, peor, terminaría en el bundle del
  navegador. Nada marca qué módulos son solo de servidor.
- **Arreglo recomendado:** mover `MAX_EXPORTACION` y `partesExportacion` a `src/negocio/`. Agregar
  `import 'server-only'` a los módulos de `servidor/` con efectos (base de datos, secretos, Chromium).
- **Causa raíz:** la convención de carpetas no se hace cumplir.
- **Observado vs esperado:** límite implícito, cuando debería ser explícito y verificado por el bundler.
- **Pruebas requeridas:** `next build` (falla si un componente de cliente importa un módulo `server-only`).
- **Esfuerzo:** XS · **Confianza:** confirmado.

---

## 3. Lo que se revisó y está bien (sin hallazgo)

- **Autenticación y CSRF:**
  - `rechazoAcceso` (`src/servidor/acceso.ts`): Host en lista explícita (DNS rebinding); en escrituras, `Origin == Host`
    y `Sec-Fetch-Site == same-origin`.
  - Cookie `SameSite=Lax`; `disableCSRFCheck: false` y `disableOriginCheck: false` fijados explícitamente.
  - Registro deshabilitado; sesión de 12 h; `revokeOtherSessions` al cambiar la contraseña.
  - Límite de intentos por IP (5 cada 15 min) y por correo (10).
  - Una cuenta desactivada responde igual que una contraseña incorrecta (con hash para igualar el tiempo).
  - Endpoints `/admin/*` del plugin bloqueados (también codificados).
  - En producción no arranca sin un secreto de ≥32 caracteres, HTTPS y `TEST` sin definir.
- **Inyección SQL:** todo está parametrizado. Las únicas interpolaciones son nombres de tabla constantes o literales
  del código (`almacen.ts:780`, `base-datos.ts:53/386/618`, `repositorio-catalogo.ts:477`, `clientes.ts:66`) y
  `WHERE` armados con `?` (`almacen.ts:1680-1730`). `LIKE` escapa `\ % _`.
- **XSS:**
  - No hay `dangerouslySetInnerHTML`, `innerHTML` ni `eval`.
  - `pdf.ts` escapa con `esc()` todo dato de usuario (cliente, observaciones, descripción, anulación, empresa).
  - Chromium imprime con `page.route('**/*') → abort` salvo las referencias validadas por regex.
  - `svg-seguro.ts` usa una lista blanca de elementos y atributos con parser XML: sin DOCTYPE ni PI, `href` solo
    interno o `data:image`, `url()` solo `#id`. El logo además se sirve con CSP propia.
- **Subida de archivos:** tope de bytes por `Content-Length` y por bytes leídos; tipo deducido por la firma del
  contenido; nombre = sha256 + extensión fija; lectura con regex `^[0-9a-f]{64}\.(…)$` (sin path traversal); escritura
  `wx` con `0600`; nombre original saneado para `Content-Disposition` (RFC 6266). El XLSX se descomprime con topes por
  entrada y totales (`catalogo/xlsx.ts:53-70`).
- **CSV:** neutraliza fórmulas `= + - @ \t \r` (`exportar.ts:67`).
- **Secretos:**
  - El repo versionado no tiene claves (grep de patrones `sk-`, `AKIA`, `PRIVATE KEY`, `ghp_`, `xox*` y asignaciones
    largas a `secret|password|token|api_key`).
  - `.env*` está ignorado salvo `.env.example`; `.dockerignore` excluye `.env*`, `data`, `datos-privados` y `*.sqlite*`.
  - `compose.yaml` pasa una lista explícita de variables (el token de Cloudflare no entra al contenedor).
  - La imagen corre como `node`.
  - La clave de IA guardada se cifra con AES-256-GCM con una clave derivada de `BETTER_AUTH_SECRET` y sal.
  - Las claves se redactan en los mensajes de error del proveedor.
- **SSRF:** todas las URL salientes (CommandCode, Starken, fábrica) vienen de constantes o de variables de entorno
  validadas (HTTPS obligatorio). Ningún dato de usuario elige destinos.
- **Firma de Starken:** HMAC con clave derivada por HKDF, mensaje canónico en arreglo JSON, `timingSafeEqual` y
  vencimiento de 15 min.
- **Integridad y concurrencia:**
  - Bloqueo de archivo entre procesos, `BEGIN IMMEDIATE` y comparación de versiones (409).
  - El LLM y Chromium corren fuera del bloqueo.
  - Los correlativos se reservan en una transacción antes de imprimir (puede quedar un salto, nunca una repetición).
  - Marca de emisión con ficha y vencimiento.
  - La bandeja de integración tiene lease, backoff exponencial con jitter, 15 intentos e idempotencia.
  - Las migraciones van en transacciones, con guardia contra bajar de versión.
- **Respaldos:**
  - `scripts/respaldar.ts` usa la API `backup` de SQLite en caliente, `integrity_check`, pasa la copia a
    `journal_mode=DELETE` y copia PDF, referencias, integración y config con fecha preservada.
  - `respaldo-diario.sh` copia a otro disco con `rsync --link-dest`, conserva N copias y valida que el destino esté
    fuera de la instalación.
  - `actualizar.sh` y `deploy.mjs` respaldan antes de actualizar y abortan si el respaldo falla.
  - `/api/salud` vigila la antigüedad del último respaldo.

---

## 4. Lo que no se pudo inspeccionar

- **El repo de la app de la fábrica:** verificación de firma del otro lado, endpoints, esquemas y anti-repetición. Por
  eso S-07 es una hipótesis.
- **El servidor de producción** (`chome`, `/srv/cotizador-neltume`, puerto 3010): el `.env` real, la configuración de
  Cloudflare (WAF, `cf-connecting-ip`), el cron de respaldos, los permisos de volúmenes y si el despliegue es un solo
  proceso.
- **Pruebas dinámicas:** no se levantó ningún servidor (los puertos 3101 y 3010 están reservados), así que no hubo
  pruebas HTTP reales de cabeceras, CSRF ni sesión. Tampoco se ejecutaron `vitest` ni las E2E en esta auditoría: los
  resultados de pruebas citados son los del seguimiento del 26-10.
- **El comportamiento de la IA** (prompt injection, calidad del anclaje): fuera de alcance y sin llamadas a la IA.
- **better-auth en ejecución:** S-03 se dedujo leyendo `node_modules`. No se verificó si el cliente del navegador usa
  `get-session`.
- **fflate ante un ZIP con `originalSize` falso:** no se probó si el tope de descompresión del XLSX (`xlsx.ts:57-70`)
  resiste cabeceras que mienten. La ruta es solo de administración.
- **Starken:** no se revisó el contrato real (`documentacion_integracion_starken.pdf`) ni se hicieron llamadas.
- **La UI en ejecución:** accesibilidad y render no se revisaron. Lo cubrió la auditoría del 26-10.
