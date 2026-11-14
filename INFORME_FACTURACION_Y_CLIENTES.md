# Informe de implementación: Facturación (Boleta / Factura) y Registro de Clientes

Rama de trabajo: `feat/facturacion-y-clientes`  
Estado general: **Fase 1 completada y verificada** · **Fase 2 pendiente de confirmación**

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

### 4. Preguntas abiertas para confirmar con Neltume antes de cerrar y pasar a Fase 2

- [ ] **P1 — Receptor distinto al cliente:** Se asumió que **sí** puede facturarse a nombre de un tercero distinto del cliente de la cotización, en un bloque propio precargado inicialmente desde los datos del cliente.
- [ ] **P2 — Cuándo elegir boleta o factura:** Se implementó de forma **opcional** en el diálogo de aprobación (por defecto «Aún no sabe») y editable en el seguimiento mientras la facturación siga pendiente. Confirmar si prefieren mantenerlo opcional o hacerlo obligatorio en algún paso.
- [ ] **P3 — Campos obligatorios vs opcionales:** Con Factura son obligatorios para marcar como facturada **Razón social, RUT válido, Giro y Dirección**; **Comuna** y **Correo para factura** quedaron opcionales. Confirmar si alguno opcional debe ser obligatorio (o viceversa).
- [ ] **P4 — Carga inicial de clientes frecuentes (Fase 2):** Se acordó **no** migrar automáticamente las cotizaciones antiguas al registro nuevo, sino ofrecer **«Guardar como cliente»** en la ficha y un script con `--simular`. Confirmar antes de iniciar Fase 2.
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

## Fase 2 — Registro de clientes frecuentes (`B1–B7`) *(Pendiente de aprobación)*

No iniciada a la espera de su confirmación sobre Fase 1:
- **B1–B2:** Migración `v31` con tabla `clientes`, índice único parcial sobre `rut_compacto`, auditoría de clientes (`auditoria_clientes`) y endpoints `POST`/`PATCH`/`DELETE` (baja lógica solo para `rol === 'admin'`).
- **B3:** Autocompletar priorizado desde registro + precarga de documento habitual/receptor/correo **solo cuando el `rut_compacto` de la cotización coincida con un cliente activo**.
- **B4–B7:** Pantalla Clientes editable, vínculo cliente ↔ datos de facturación por omisión, atajo en la cotización («Guardar como cliente frecuente»), script con `--simular`, pruebas unitarias + E2E y sección «Fase 2» de este informe.
