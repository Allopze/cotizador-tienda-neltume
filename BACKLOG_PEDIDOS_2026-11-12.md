# Backlog — pedidos de Neltume del 12-11-2026

Origen: dos audios de WhatsApp de la encargada de Neltume (12-11-2026, 09:59 y 10:02).

1. **Boleta o factura al aprobar / registrar el pago.** Elegir si el cliente quiere boleta o factura. Si es factura, poder anotar a quién se factura (razón social, RUT, giro, dirección) para tener los datos a mano y emitir la factura **fuera** de la app. La app **no** emite el documento tributario.
2. **Crear clientes.** Registrar clientes frecuentes (p. ej. «Constructora Lingue») para que, al escribir el nombre, se complete solo el RUT, el giro y el resto de la ficha.

---

## 0. Lo que ya existe (punto de partida)

| Tema | Estado actual | Evidencia |
|---|---|---|
| Tipo de documento | Solo se elige **al final**, al «Marcar como facturada» (select Factura/Boleta + N° + fecha). No hay elección previa ni datos del receptor. | `src/app/seguimiento-operacion.tsx:68-70, 134-146, 508-535`; `src/negocio/estado.ts:106-117`; `src/servidor/servicio.ts:1791-1822` |
| Persistencia facturación | Columnas `facturacion_estado`, `facturacion_tipo`, `facturacion_id_externo`, `facturacion_fecha`. Esquema SQLite en `user_version = 29`. | `src/servidor/base-datos.ts:147-150, 538` |
| Acción API | `tipo: 'facturacion'` con `estado`, `tipoDocumento`, `identificadorExterno`, `fecha`. | `src/app/api/accion/route.ts:368-369`; `src/servidor/acciones.ts:136` |
| Datos del cliente | `nombre, rut, giro, telefono, direccion, comuna, proyecto` guardados **dentro de cada cotización**. Solo se editan mientras la cotización es editable (borrador). Sin correo. | `src/catalogo/tipos.ts:134-152`; `src/app/cotizacion-panel.tsx:305-312, 1542-1575` |
| Validación de RUT | Módulo 11 y normalización `12.345.678-5`. | `src/negocio/cliente.ts:6-26` |
| Autocompletar cliente | **Ya existe**: al escribir nombre o RUT sugiere clientes de cotizaciones anteriores y completa sus datos. | `src/app/cotizacion-panel.tsx:519-533`; `src/servidor/clientes.ts:54-82`; `GET /api/clientes?q=` |
| Pantalla Clientes | **Solo lectura**: directorio derivado de las cotizaciones (agrupa por RUT o nombre). No hay tabla `clientes`; no se puede crear ni editar un cliente sin cotización. | `src/servidor/clientes.ts:134-202`; `src/app/clientes/pantalla-clientes.tsx` |
| Diálogo de aprobación | Pide dirección de despacho, entrega comprometida y transporte. Nada de facturación. | `src/app/dialogos-cotizacion.tsx:20-110` |

Conclusión: el pedido 2 está cubierto **a medias** (autocompletar sí, alta manual no). El pedido 1 es nuevo salvo el select final de factura/boleta.

---

## 1. Preguntas para Neltume (antes de empezar)

- [ ] **P1.** ¿Los datos de facturación pueden ser de alguien distinto al cliente de la cotización? (El audio sugiere que sí: «facturar a constructora tanto»). → Asumo **sí**: bloque propio, precargado desde el cliente.
- [ ] **P2.** ¿En qué momento lo eligen: al aprobar, al registrar el primer pago o en cualquier momento antes de facturar? → Propuesta: opcional en el diálogo de aprobación y editable hasta marcar facturada.
- [ ] **P3.** ¿Necesitan el **correo** del receptor (para enviar la factura electrónica) y la **comuna/ciudad**?
- [ ] **P4.** ¿Los clientes de cotizaciones antiguas se cargan solos en el registro o solo los que ellas creen/guarden?
- [ ] **P5.** ¿Quién puede crear o editar clientes? ¿Todos los usuarios o solo administración?
- [ ] **P6.** ¿Con qué emiten hoy las facturas (SII gratuito, Bsale, Defontana…)? Solo para dar el formato de «copiar datos» adecuado; integrar el facturador queda **fuera de alcance**.

---

## 2. Épica A — Documento tributario y datos de facturación

### A1 · Modelo y migración `[M]`
- Ampliar `Facturacion` (`src/negocio/estado.ts`) con:
  - `documento: 'boleta' | 'factura' | null` — la **intención** del cliente, distinta de `tipo` (lo que efectivamente se emitió).
  - `receptor: { razonSocial, rut, giro, direccion, comuna, correo } | null`.
- Migración SQLite `user_version = 30` en `src/servidor/base-datos.ts`: columnas `facturacion_documento`, `facturacion_razon_social`, `facturacion_rut`, `facturacion_giro`, `facturacion_direccion`, `facturacion_comuna`, `facturacion_correo` (todas nullable).
- Actualizar lectura/escritura en `src/servidor/almacen.ts` y el esquema zod en `src/servidor/persistencia-esquemas.ts:305-315, 408-411` (respaldo/restauración).
- **Criterio:** una base v29 migra sin pérdida; respaldar → restaurar conserva los campos nuevos.

### A2 · Acción de servidor `datos_facturacion` `[M]`
- Nueva variante en `src/servidor/acciones.ts` y en el `z.discriminatedUnion` de `src/app/api/accion/route.ts` (≈ línea 368): `{ tipo: 'datos_facturacion', id, actualizada, documento, receptor? }`.
- En `src/servidor/servicio.ts`: `exigirAprobada`, `verificarVersion`, sanear cada campo (`limpiarTexto`, máx. 300), RUT con `normalizarRut` (inválido → rechazar con mensaje claro, no guardar con aviso).
- Con `documento = 'boleta'` el `receptor` se guarda como `null`.
- Bloquear cambios si `facturacion.estado === 'facturada'` (primero «Volver a pendiente»).
- Registrar evento en el historial (`u.registrarEvento`) con antes → después, para la trazabilidad.
- **Criterio:** tests unitarios de validación, conflicto de versión, bloqueo tras facturar y evento registrado.

### A3 · Elección en el diálogo de aprobación `[S]`
- En `FormAprobacion` (`src/app/dialogos-cotizacion.tsx`) agregar un selector de dos botones **Boleta / Factura / Aún no sabe** (por defecto «Aún no sabe»). No obligatorio, para no frenar la aprobación.
- Si elige Factura, mostrar los campos del receptor precargados desde el cliente de la cotización (`nombre → razón social`, `rut`, `giro`, `direccion`, `comuna`).
- Extender `aprobar` (`acciones.ts:61-67`) con `facturacion?` opcional, o encadenar `datos_facturacion` justo después (preferible lo primero: una sola transacción).
- **Criterio:** aprobar con «Factura» deja los datos guardados; aprobar sin elegir funciona igual que hoy.

### A4 · Bloque «Facturación» en el seguimiento `[M]`
- Sacar la facturación de `src/app/seguimiento-operacion.tsx` (556 líneas, sobre el tope de 500) a un componente nuevo `src/app/facturacion-operacion.tsx`.
- Desde la aprobación, mostrar:
  - Selector Boleta / Factura (editable mientras no esté facturada).
  - Si es Factura: formulario del receptor (razón social, RUT, giro, dirección, comuna, correo) con guardado explícito y validación de RUT en vivo.
  - Botón **«Copiar datos para facturar»**: copia al portapapeles un bloque de texto listo para pegar en el facturador (reusar `src/app/compartir.ts`).
  - Aviso visible «Faltan datos para facturar» si es Factura y falta RUT, razón social, giro o dirección.
- «Marcar como facturada» precarga `tipo` con el `documento` elegido; si no coinciden, pedir confirmación.
- Pensado para usarse en el celular: campos grandes, pocos pasos.
- **Criterio:** E2E aprobar → elegir Factura → completar → registrar pago → copiar datos → marcar facturada.

### A5 · Mostrarlo donde se trabaja `[S]`
- En el resumen de estados del seguimiento (`seguimiento-operacion.tsx:448-452`): «Documento: Factura a Constructora X (RUT…)» o «Boleta».
- En Historial (`src/app/historial.tsx:~727`): distintivo Boleta/Factura y filtro **«Por facturar»** (aprobadas con `estado = pendiente`).
- En la exportación (`src/servidor/exportar.ts:48`): columnas Documento, Razón social, RUT receptor, Giro, Dirección.

### A6 · Ayuda `[XS]`
- Actualizar `src/app/ayuda/page.tsx:100-110, 290-315` y `docs/manual-operativo.md`: cuándo se elige boleta/factura, que la app **no** emite el documento, y cómo copiar los datos.

---

## 3. Épica B — Registro de clientes

### B0 · Mejora rápida: hacer visible el autocompletar `[XS]` — *hacer primero*
- El autocompletar ya cumple «escribo Constructora Lingue y se completa el RUT», pero solo si el cliente tiene una cotización anterior. Probablemente no lo saben.
- Agregar al campo Nombre/RUT un texto de ayuda: «Escribe el nombre o el RUT para buscar clientes anteriores».
- Mostrárselo a la encargada (captura o video corto) junto con la entrega.

### B1 · Tabla `clientes` `[M]`
- Migración (mismo salto v30 que A1 o v31): `clientes(id TEXT PK, nombre, nombre_normalizado, rut, rut_compacto UNIQUE NULL, giro, telefono, direccion, comuna, correo, notas, creado, actualizado, creado_por, eliminado NULL)`.
- Índices por `nombre_normalizado` y `rut_compacto`.
- Las cotizaciones **siguen guardando su propia copia** del cliente (el PDF emitido no debe cambiar si después se edita la ficha). Opcional: columna `cotizaciones.cliente_id` para enlazar.

### B2 · Repositorio y API `[M]`
- `src/servidor/clientes.ts` (o un archivo nuevo `repositorio-clientes.ts` si pasa de 300 líneas): `crear`, `actualizar`, `eliminar` (lógico), `obtener`.
- `src/app/api/clientes/route.ts`: `POST` y `PATCH` con zod, `exigirSesion` y, según P5, control de rol en el servidor.
- RUT: normalizado y único (un segundo cliente con el mismo RUT → error que ofrece abrir el existente).
- Cada alta, cambio o baja queda en la auditoría (quién, cuándo, qué cambió).
- **Criterio:** tests de duplicado por RUT, RUT inválido, permisos y auditoría.

### B3 · Autocompletar desde el registro `[S]`
- `buscarClientes` (`src/servidor/clientes.ts:54-82`) busca primero en `clientes` y después en cotizaciones anteriores, sin duplicar (misma regla `mismoCliente`: RUT manda).
- La sugerencia indica si viene del registro o de una cotización anterior.
- Al elegir un cliente registrado se completan también los **datos de facturación por omisión** (ver B5).

### B4 · Pantalla Clientes editable `[M]`
- En `src/app/clientes/pantalla-clientes.tsx`: botón **«Nuevo cliente»** y formulario (nombre, RUT, giro, teléfono, dirección, comuna, correo, notas).
- En cada ficha: **Editar** y, para los que solo existen en cotizaciones, **«Guardar como cliente»** (crea la ficha con esos datos).
- Mantener la lista de cotizaciones del cliente como está.
- **Criterio:** E2E crear cliente → nueva cotización → escribir parte del nombre → elegir → datos completos.

### B5 · Cliente ↔ datos de facturación `[S]`
- La ficha del cliente puede guardar «Documento habitual» (boleta/factura) y un receptor por omisión, para precargar A3/A4.
- En el formulario del receptor (A4), el campo Razón social/RUT también autocompleta desde el registro.

### B6 · Carga inicial desde cotizaciones antiguas `[S]` — *según P4*
- Script `scripts/clientes-desde-historial.ts` que use la agrupación de `directorioClientes` y cree fichas solo para los clientes con RUT válido. Modo `--simular` que lista sin escribir.

### B7 · Crear cliente desde la cotización `[XS]`
- En «Cliente y facturación» (`cotizacion-panel.tsx:1542`), si el nombre/RUT no coincide con ningún registrado: enlace «Guardar como cliente frecuente».

---

## 4. Transversal

- [ ] **T1.** Tests: unitarios del servidor (A2, B2) y E2E con flujo encadenado (A4, B4). Correr la suite completa (`npm test`), no filtrada.
- [ ] **T2.** No hacer crecer `cotizacion-panel.tsx` (1.956 líneas), `servicio.ts` (2.457) ni `seguimiento-operacion.tsx` (556): todo lo nuevo en archivos propios.
- [ ] **T3.** Revisar que el respaldo (`scripts/respaldar.ts` / `restaurar.ts`) incluya la tabla `clientes`.
- [ ] **T4.** Revisar si el asistente de chat debe entender «a factura a nombre de X» (fuera de alcance por ahora; anotarlo).
- [ ] **T5.** Desplegar con `npm run deploy` después de respaldar la base de producción (hay migración).

---

## 5. Orden sugerido

| # | Tarea | Tamaño | Por qué en este orden |
|---|---|---|---|
| 1 | P1–P6 a Neltume | — | Desbloquea los detalles |
| 2 | B0 | XS | Les resuelve parte del pedido 2 hoy |
| 3 | A1 → A2 | M + M | Base del pedido 1 |
| 4 | A4 → A3 | M + S | Lo que ellas ven y usan |
| 5 | A5, A6 | S + XS | Cierra el pedido 1 |
| 6 | B1 → B2 → B3 | M + M + S | Base del registro de clientes |
| 7 | B4, B7 | M + XS | Pantalla y atajo |
| 8 | B5, B6 | S + S | Une ambas épicas; carga inicial |
| 9 | T1–T5 | — | Antes de cada entrega |

**Fuera de alcance:** emitir boletas o facturas electrónicas (DTE) o integrarse con el SII o un facturador.
