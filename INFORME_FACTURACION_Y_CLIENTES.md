# Informe de implementación: Facturación (Boleta / Factura) y Registro de Clientes

Rama de trabajo: `feat/facturacion-y-clientes`  
Estado general: **Fase 1 y Fase 2 completadas y verificadas**

> **Nota de alcance:** El cotizador **no emite boletas ni facturas electrónicas (DTE)** ni se conecta con el SII ni con un facturador externo. Guarda la preferencia del cliente y los datos del receptor para tenerlos listos al facturar fuera de la aplicación.

---

## Fase 1 — Boleta o factura, receptor y mejora rápida de autocompletar (`B0`, `A1–A6`)

### 1. Resumen por tarea (un commit por tarea)

| Tarea | Commit | Qué se implementó | Archivos principales |
| --- | --- | --- | --- |
| **B0** | `020c239` | Ayuda visible de autocompletar en **Nombre** y **RUT** del cliente: «Escribe el nombre o el RUT para buscar clientes anteriores». Se extrajo la sección cliente del panel principal. | `src/app/clientes/bloque-cliente-cotizacion.tsx`, `src/app/campo-editable.tsx`, `src/app/cotizacion-panel.tsx`, `src/app/cotizacion-interfaz.css` |
| **A1** | `865684e` | Ampliación de `Facturacion` con `documento` (`'boleta' \| 'factura' \| null`) y `receptor` (`razonSocial`, `rut`, `giro`, `direccion`, `comuna`, `correo`), migración SQLite `user_version = 30`, lectura/escritura en almacén y respaldo/restauración zod. | `src/negocio/facturacion.ts`, `src/negocio/estado.ts`, `src/servidor/facturacion-esquemas.ts`, `src/servidor/base-datos.ts`, `src/servidor/almacen.ts`, `src/servidor/persistencia-esquemas.ts`, `tests/migracion-v30.test.ts` |
| **A2** | `16a5d99` | Nueva acción `datos_facturacion` (`tipo: 'datos_facturacion'`), extensión opcional de `aprobar` con `facturacion` en la misma transacción, validación módulo 11 (RUT inválido rechazado con `rut_invalido`), bloqueo tras facturar y evento dedicado `'facturacion_actualizada'`. | `src/servidor/acciones.ts`, `src/servidor/facturacion.ts`, `src/servidor/errores.ts`, `src/app/api/accion/route.ts`, `src/servidor/servicio.ts`, `tests/facturacion.test.ts` |
| **A3** | `2422065` | Selector opcional **Aún no sabe / Boleta / Factura** (por defecto «Aún no sabe») y formulario de receptor en el diálogo de aprobación, precargado desde el cliente de la cotización y validando RUT/correo antes de enviar. | `src/app/dialogos-cotizacion.tsx`, `src/app/receptor-facturacion.tsx`, `src/app/cotizador.tsx`, `src/app/cotizacion-interfaz.css`, `tests/facturacion-ui.test.ts` |
| **A4** | `dda4396` | Bloque **Facturación** extraído a componente propio en seguimiento: selector editable mientras está pendiente, receptor con validación en vivo, aviso **«Faltan datos para facturar»** con campos faltantes, bloqueo de **«Marcar como facturada»** con Factura si faltan datos o hay cambios sin guardar, botón **«Copiar datos para facturar»** (texto plano, una línea por campo) y confirmación cuando el documento emitido difiere del pedido. | `src/app/facturacion-operacion.tsx`, `src/app/seguimiento-operacion.tsx`, `src/app/compartir.ts`, `src/app/receptor-facturacion.tsx`, `src/app/cotizacion-interfaz.css`, `tests/facturacion-ui.test.ts` |
| **A5** | `006878e` | Resumen `Documento:` en seguimiento (incluyendo etiqueta `Factura` para cotizaciones ya facturadas pre-v30), filtro **«Por facturar»** e insignia discreta `Factura`/`Boleta` en Historial, y 5 columnas del receptor en la exportación CSV. | `src/negocio/facturacion.ts`, `src/app/seguimiento-operacion.tsx`, `src/servidor/almacen.ts`, `src/app/api/accion/route.ts`, `src/app/historial.tsx`, `src/app/cotizacion.css`, `src/servidor/exportar.ts`, `tests/auditoria.test.ts` |
| **A6** | `914fc2d` | Actualización de la guía **Cómo funciona** y del **Manual operativo**: elección de boleta o factura al aprobar o en seguimiento, uso de «Copiar datos para facturar», corrección vía «Volver a pendiente» y aclaración explícita de que no se emiten documentos ante el SII. | `src/app/ayuda/page.tsx`, `docs/manual-operativo.md` |
| **E2E** | `d125c24` | Actualización de la E2E de operación para reflejar la exigencia de receptor completo al marcar Factura, más nueva suite E2E específica de facturación y diseño móvil en `390 px`. | `tests/operacion.e2e.ts`, `tests/facturacion.e2e.ts` |

---

### 2. Reglas de arquitectura y tamaño de archivos cumplidas

Ninguno de los archivos grandes existentes creció (todos disminuyeron al extraer lógica nueva a módulos propios):

| Archivo | Estado después de Fase 1 |
| --- | --- |
| `src/app/cotizacion-panel.tsx` | 1.902 líneas (bajó desde ≈1.956 al extraer `bloque-cliente-cotizacion.tsx`) |
| `src/servidor/servicio.ts` | 2.443 líneas (bajó desde ≈2.457 al extraer `servidor/facturacion.ts`) |
| `src/app/seguimiento-operacion.tsx` | 522 líneas (bajó desde ≈556 al extraer `facturacion-operacion.tsx`) |
| Módulos nuevos de código | Todos ≤ 300 líneas: `bloque-cliente-cotizacion.tsx` (84), `negocio/facturacion.ts` (98), `servidor/facturacion-esquemas.ts` (32), `receptor-facturacion.tsx` (201), `servidor/facturacion.ts` (215), `facturacion-operacion.tsx` (287) |

---

### 3. Decisiones aplicadas y ajustes implementados

1. **Evento de auditoría propio (`'facturacion_actualizada'`):** Se creó el evento específico `'facturacion_actualizada'` (`Datos de facturación actualizados` en la actividad), separado de `'facturada'`, siguiendo el patrón de `'despacho_actualizado'`. Registra `antes → después` (por ejemplo: `Datos de facturación: Sin definir → Factura · Constructora Lingue SpA (76.543.210-3)`), y también se registra cuando `aprobar` recibe datos de facturación.
2. **Cotizaciones aprobadas antes de v30 (aprobadas y pendientes):** En la interfaz (`FacturacionOperacion`), el aviso **«Faltan datos para facturar»** muestra los campos faltantes (`RUT válido`, `giro`, `dirección`, etc.) antes de pulsar **«Marcar como facturada»**, y el botón queda deshabilitado cuando el documento emitido seleccionado es **Factura** mientras falten datos guardados o haya cambios sin guardar. La validación 400 del servidor (`datos_facturacion_incompletos`) actúa como defensa adicional.
3. **Casos de ciclo de vida cubiertos con tests:**
   - **Duplicar:** la cotización duplicada parte limpia con `documento: null` y `receptor: null`.
   - **Deshacer aprobación (`desaprobar`):** conserva `documento` y `receptor`; al volver a abrir el diálogo de aprobación (`estadoInicialAprobacion`), se precargan desde `facturacion` con prioridad sobre los datos de `cliente`.
   - **Cotizaciones ya `facturada` previas a v30 (`documento: null, receptor: null`):** se renderizan sin error en seguimiento (`Documento: Factura`), historial y CSV.
4. **Encabezados CSV de exportación (`src/servidor/exportar.ts`):** Como el archivo CSV ya incluía las columnas `Giro` y `Dirección` para el cliente de la cotización, las columnas del receptor tributario se agregaron al final como `Documento`, `Razón social`, `RUT receptor`, `Giro receptor` y `Dirección receptor` para evitar colisiones de nombres en planillas.
5. **Inmutabilidad del cliente en cotizaciones emitidas/aprobadas:** `receptor` se almacena como copia propia dentro de `Facturacion`; el texto de los PDFs ya emitidos no se altera.
6. **Limpieza de rutas locales y entorno:** No se incluyeron rutas locales de configuración en el repositorio, no se tocó `.env.local`, no se ejecutaron scripts contra datos reales y no se realizó ningún despliegue.

---

### 4. Preguntas abiertas para confirmar con Neltume antes de desplegar

- [ ] **P1 — Receptor distinto al cliente:** Se asumió que **sí** puede facturarse a nombre de un tercero distinto del cliente de la cotización, en un bloque propio precargado inicialmente desde los datos del cliente.
- [ ] **P2 — Cuándo elegir boleta o factura:** Se implementó de forma **opcional** en el diálogo de aprobación (por defecto «Aún no sabe») y editable en el seguimiento mientras la facturación siga pendiente. Confirmar si prefieren mantenerlo opcional o hacerlo obligatorio en algún paso.
- [ ] **P3 — Campos obligatorios vs opcionales:** Con Factura son obligatorios para marcar como facturada **Razón social, RUT válido, Giro y Dirección**; **Comuna** y **Correo para factura** quedaron opcionales. Confirmar si alguno opcional debe ser obligatorio (o viceversa).
- [ ] **P4 — Carga inicial de clientes frecuentes (Fase 2):** Se acordó **no** migrar automáticamente las cotizaciones antiguas al registro nuevo, sino ofrecer **«Guardar como cliente»** en la ficha y un script que solo simula salvo con `--aplicar`. Confirmar si quieren hacer la carga inicial.
- [ ] **P5 — Permisos de registro y baja de clientes (Fase 2):** Cualquier usuaria con sesión puede crear y editar clientes; la baja lógica queda restringida en el servidor al rol `admin`. Confirmar si está bien así.
- [ ] **P6 — Formato de «Copiar datos para facturar»:** Actualmente copia texto plano con una línea por campo (`Etiqueta: valor`, omitiendo vacíos). Confirmar si calza con el facturador que usan (SII, Bsale, Defontana u otro) o si requieren otro orden o formato.

---

### 5. Verificación ejecutada sobre el estado actual de Fase 1

Comandos ejecutados tras el último commit de código y tests (`d125c24`):

| Verificación | Resultado observado |
| --- | --- |
| `npm run typecheck` (`tsc --noEmit`) | **OK** · 0 errores. |
| `npm run lint` (`eslint .`) | **OK** · 0 errores (2 advertencias preexistentes sin relación con esta tarea en `src/app/dialogo.tsx` y `tests/notas-por-fabrica.test.ts`). |
| `npx vitest run` | **OK** · `106` archivos de test, `1.655` pruebas pasadas, 0 fallidas. |
| `npm run test:e2e:paralelo` | **OK** · Todos los grupos pasaron: `flujos-1` (22 pasadas), `flujos-2` (71 pasadas, incluida la nueva `tests/facturacion.e2e.ts` y `tests/operacion.e2e.ts`), `aceptacion` (14 pasadas y 1 omitida en el proyecto `webkit-iphone` para `tests/movil.e2e.ts:81` «scroll anidado del chat», prueba que sí pasó en Chromium dentro de `flujos-1`). |

---

## Fase 2 — Registro de clientes frecuentes (`B1–B7`)

### 1. Resumen por tarea (un commit por tarea)

| Tarea | Commit | Qué se implementó | Archivos principales |
| --- | --- | --- | --- |
| **B1** | `92e9981` | Entidad `ClienteRegistrado`, saneamiento módulo 11 y correo (`sanearClienteRegistrado`), migración SQLite `user_version = 31` con tablas `clientes` y `auditoria_clientes`, índice único parcial `idx_clientes_rut_unico` sobre `rut_compacto WHERE eliminado IS NULL`, y conteo de clientes en `respaldar`/`restaurar`. | `src/negocio/cliente-registro.ts`, `src/servidor/base-datos.ts`, `scripts/respaldar.ts`, `scripts/lib/restauracion.ts`, `scripts/restaurar.ts`, `tests/migracion-v31.test.ts` |
| **B2** | `08c9ae0` | Repositorio CRUD transaccional (`crearCliente`, `actualizarCliente`, `eliminarCliente`, `buscarClienteActivoPorRut`, `auditoriaDeCliente`) con registro `antes → después`, conflicto `409 rut_duplicado` con `clienteExistente`, bloqueo optimista (`actualizado`) y endpoints `GET` (`?rut=`, `?id=`), `POST`, `PATCH` y `DELETE` (este último restringido en backend a `rol === 'admin'`). | `src/servidor/repositorio-clientes.ts`, `src/servidor/clientes-esquemas.ts`, `src/servidor/errores.ts`, `src/app/api/clientes/route.ts`, `tests/repositorio-clientes.test.ts` |
| **B3** | `5a28540` | Búsqueda priorizada desde `clientes` sin duplicar cotizaciones previas (`mismoCliente`), directorio unificado incluyendo clientes con `0` cotizaciones, etiquetas **«Cliente frecuente» / «Cotización anterior»**, y precarga automática en `FormAprobacion` y `FacturacionOperacion` **estrictamente por coincidencia de `rut_compacto`** en clientes activos (`Ajuste #2`). | `src/servidor/clientes.ts`, `src/app/clientes/cliente-registro-api.ts`, `src/app/clientes/bloque-cliente-cotizacion.tsx`, `src/app/dialogos-cotizacion.tsx`, `src/app/facturacion-operacion.tsx`, `tests/clientes.test.ts`, `tests/facturacion-ui.test.ts` |
| **B4** | `023f082` | Pantalla `/clientes` editable: botón **«Nuevo cliente»**, tarjetas desplegables con insignia **Frecuente / Solo en cotizaciones**, botón **«Guardar como cliente»** sobre clientes históricos, edición con manejo de `409 rut_duplicado` (**«Abrir ficha existente»**) y baja lógica visible/autorizada solo para `admin` con confirmación. | `src/app/clientes/page.tsx`, `src/app/clientes/pantalla-clientes.tsx`, `src/app/clientes/dialogo-cliente.tsx`, `src/app/clientes/cliente-fila.tsx`, `src/app/globals.css` |
| **B5** | `57e4f41` | Selector opcional **«Documento habitual al aprobar»** (`Sin definir / Boleta / Factura`) + receptor por omisión con botón **«Copiar datos de la ficha»** en el modal de cliente, visualización en la tarjeta de `/clientes` y autocompletado opcional desde clientes frecuentes en los campos `Razón social *` y `RUT *` del receptor (`A3` y `A4`). | `src/app/clientes/facturacion-cliente-campos.tsx`, `src/app/clientes/autocompletar-receptor.tsx`, `src/app/clientes/dialogo-cliente.tsx`, `src/app/clientes/cliente-fila.tsx`, `src/app/receptor-facturacion.tsx`, `src/app/cotizacion-interfaz.css`, `tests/facturacion-ui.test.ts` |
| **B6** | `8901536` | Script CLI `scripts/clientes-desde-historial.ts` (`npm run clientes:importar`) que **simula por omisión** (solo escribe con `--aplicar`), filtros de nombre + RUT módulo 11 válido, idempotencia por `rut_compacto` y auditoría bajo `terminal:clientes-desde-historial`. | `scripts/clientes-desde-historial.ts`, `package.json`, `tests/clientes-desde-historial.test.ts` |
| **B7** | `1a41676` | Atajo **«Guardar como cliente frecuente»** en el bloque desplegable del cliente dentro de cada cotización (1 toque vía `POST /api/clientes`, indicador de ya registrado y enlace a `/clientes`). | `src/app/clientes/bloque-cliente-cotizacion.tsx`, `src/app/cotizacion-interfaz.css`, `tests/facturacion-ui.test.ts` |
| **E2E** | `cc839d5` | Suite Playwright dedicada de clientes frecuentes en escritorio y móvil (`390 px`), cubriendo alta con `0` cotizaciones, edición, RUT duplicado, autocompletar, precarga por RUT al aprobar, inmutabilidad de cotizaciones emitidas, atajos `B7`/`B4` y baja lógica exclusiva `admin`. | `tests/clientes.e2e.ts` |

---

### 2. Reglas de arquitectura y tamaño de archivos cumplidas

Los tres archivos grandes heredados no crecieron en Fase 2; los componentes y servicios nuevos se modularizaron por responsabilidad y quedaron bajo el máximo de 500 líneas (la mayoría ≤ 300 líneas):

| Archivo | Líneas verificadas después de Fase 2 |
| --- | --- |
| `src/app/cotizacion-panel.tsx` | 1.902 (sin cambios respecto a Fase 1) |
| `src/servidor/servicio.ts` | 2.443 (sin cambios respecto a Fase 1) |
| `src/app/seguimiento-operacion.tsx` | 522 (sin cambios respecto a Fase 1) |
| Módulos ≤ 300 líneas | `cliente-registro.ts` (152), `clientes-esquemas.ts` (34), `api/clientes/route.ts` (144), `servidor/clientes.ts` (277), `cliente-registro-api.ts` (57), `cliente-fila.tsx` (106), `facturacion-cliente-campos.tsx` (79), `autocompletar-receptor.tsx` (184), `pantalla-clientes.tsx` (250), `bloque-cliente-cotizacion.tsx` (195), `receptor-facturacion.tsx` (210), `scripts/clientes-desde-historial.ts` (124) |
| Módulos entre 301 y 500 líneas | `dialogo-cliente.tsx` (323), `facturacion-operacion.tsx` (329), `repositorio-clientes.ts` (365) |

---

### 3. Reglas clave, auditoría y comportamiento verificado

1. **Precarga estricta por RUT (`Ajuste #2`):** Ni en `FormAprobacion`, ni en `FacturacionOperacion`, ni en `BloqueClienteCotizacion` se consulta ni precarga automáticamente desde el registro maestro si la cotización no tiene un `rut_compacto` coincidente con un cliente activo. La prioridad al aprobar sigue siendo: `facturacion` ya guardada en la cotización (incluyendo tras `desaprobar`) → cliente frecuente activo coincidente por `rut_compacto` → datos propios de `cotizacion.cliente`.
2. **Inmutabilidad de cotizaciones emitidas y PDF:** Toda cotización conserva su propia copia de `cliente` y `facturacion.receptor`. Editar o dar de baja un cliente en `/clientes` nunca altera cotizaciones ya guardadas ni PDF ya generados; en `/clientes`, si un cliente dado de baja aún tiene cotizaciones previas, su tarjeta pasa de `Frecuente` a `Solo en cotizaciones` y deja de activar precargas por RUT.
3. **Índice único parcial y reutilización tras baja lógica:** `idx_clientes_rut_unico` impone unicidad de `rut_compacto` solo cuando `rut_compacto IS NOT NULL AND eliminado IS NULL`. Varios clientes sin RUT pueden coexistir y el RUT de un cliente dado de baja lógicamente queda disponible para un alta posterior sin borrar el registro de auditoría previo.
4. **Permisos y auditoría:** Cualquier usuario autenticado puede crear y editar fichas (`POST`/`PATCH /api/clientes`); `DELETE /api/clientes` exige `rol === 'admin'` en el servidor (`403` en caso contrario) además de ocultar el botón en la interfaz para cuentas estándar. Toda alta, edición y baja lógica queda registrada en `auditoria_clientes` con `fecha`, `actor`, `accion`, `detalle` (`antes → después`) y snapshots JSON.
5. **Respaldo y restauración:** `scripts/respaldar.ts` respalda la base SQLite completa (incluyendo `clientes` y `auditoria_clientes`), e informa la cantidad de clientes activos junto al respaldo y al restaurar (`scripts/lib/restauracion.ts`).
6. **Carga inicial opcional de clientes históricos (`B6`):** Los clientes antiguos no se importan automáticamente. Cuando Neltume quiera revisar candidatos históricos con nombre y RUT módulo 11 válido, puede previsualizar sin modificar datos con:
   `npm run clientes:importar`
   (sin argumentos solo simula; `--simular` se acepta y no cambia nada) y, tras respaldar con `npm run respaldar`, ejecutar la importación real con:
   `npm run clientes:importar -- --aplicar`
7. **Entorno y datos reales:** No se modificó `.env.local`, no se ejecutaron scripts contra la base de producción ni se realizó despliegue alguno.

---

### 4. Verificación completa ejecutada tras Fase 2

Comandos ejecutados después del último cambio de código y tests (`cc839d5`):

| Verificación | Resultado observado |
| --- | --- |
| `npm run typecheck` (`tsc --noEmit`) | **OK** · 0 errores. |
| `npm run lint` (`eslint .`) | **OK** · 0 errores (2 advertencias preexistentes sin relación en `src/app/dialogo.tsx` y `tests/notas-por-fabrica.test.ts`). |
| `npm run build` (`next build`) | **OK** · compilación y generación de rutas Next.js sin errores. |
| `npx vitest run` | **OK** · `109` archivos de test pasados, `1.667` pruebas pasadas, 0 fallidas, 0 omitidas. |
| `npm run test:e2e:paralelo` | **OK** · Todos los grupos pasaron: `flujos-1` (22 pasadas), `flujos-2` (73 pasadas, incluida `tests/clientes.e2e.ts` con 2 pruebas en 390 px y escritorio), `aceptacion` (14 pasadas y 1 omitida en `webkit-iphone` para `tests/movil.e2e.ts:81` «scroll anidado del chat», cubierta en Chromium). |

---

## Correcciones posteriores a la revisión (14-11-2026)

| # | Hallazgo | Corrección | Archivos |
| --- | --- | --- | --- |
| 1 | El script de importación escribía en la base si se ejecutaba sin `--simular`. | Ahora simula siempre salvo con `--aplicar`; el mensaje final pide respaldar antes. Test: el CLI sin argumentos no escribe. | `scripts/clientes-desde-historial.ts`, `tests/clientes-desde-historial.test.ts` |
| 2 | `actualizado` era opcional en `PATCH` y `DELETE /api/clientes`: sin él no se detectaban ediciones simultáneas. | Obligatorio en ambos esquemas (`400` si falta). La interfaz ya lo enviaba. | `src/servidor/clientes-esquemas.ts`, `tests/repositorio-clientes.test.ts` |
| 3 | Guardar una ficha sin cambios escribía una edición vacía en la auditoría y cambiaba su versión. | `actualizarCliente` devuelve la ficha sin escribir si los datos son idénticos. | `src/servidor/repositorio-clientes.ts`, `tests/repositorio-clientes.test.ts` |
| 4 | `auditoria_clientes` tenía `ON DELETE CASCADE`: borrar un cliente de verdad borraba su auditoría. | `ON DELETE RESTRICT` en la migración v31 (aún no desplegada). Las bases locales que ya están en v31 conservan el `CASCADE`: recrearlas o dejarlas así (solo hay baja lógica). | `src/servidor/base-datos.ts` |
| 5 | La precarga por RUT del bloque de facturación consultaba de nuevo con cada guardado (dependía de objetos). | Depende solo del RUT, del documento guardado, del estado y de si hay receptor guardado. | `src/app/facturacion-operacion.tsx` |

Verificado en este entorno: `eslint` sin errores en los archivos tocados y `tsc --noEmit` sin errores nuevos. **Pendiente en el Mac:** `npm test` completo (unitarias + E2E).

