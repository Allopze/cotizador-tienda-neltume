# Implementación de fiabilidad · 11 de octubre de 2026

Alcance: las cinco fases aprobadas en la conversación y en `revision-2026-10-11.md`.
Se conservan las reglas comerciales, descuento general máximo 50 %, cuentas administradoras,
respaldos locales y entregas ZIP. Se excluyen devoluciones, contabilidad, copias externas,
alertas externas, favoritos, precios masivos, 2FA y deshacer completo del chat.

## Seguimiento

Estado al 14 de octubre de 2026: las cinco fases están en el commit `008450b` («fiabilidad del cotizador, fases
1–5») y cubiertas por pruebas automáticas. Lo que quedó pendiente de ellas se cerró después en cuatro fases más
(ver «Lo pendiente (14-oct)»). Lo que no se puede dar por hecho desde desarrollo está en
«Verificación operativa pendiente».

- [x] Fase 1: cálculos, validaciones recuperables, aislamiento de IA, Chromium y dependencias.
  - Sets Pino Finger con escuadría en milímetros en la estimación de peso de Starken (1.1).
  - Una clave de IA ilegible solo deja el chat en 503 con su mensaje; emitir, editar y pagar siguen
    funcionando y Ajustes la muestra como ilegible (1.2).
  - Chromium se comprueba antes de reservar el número: si falta, 503 y el correlativo no avanza (1.3).
  - Descuento máximo de Ajustes acotado a 50 % (1.4); duplicar recorta el descuento al máximo vigente con
    aviso (1.6).
  - Precio escrito o descuento por ítem fuera de regla tras reimportar, deshacer o el chat: el ítem queda
    pendiente con su pregunta y no suma (1.5, `items-vigentes.ts`).
  - Errores visibles al registrar un pago (1.7) y rango de medidas por familia unificado: puertas
    0,3–3 m, largo de accesorios hasta 6 m (1.8).
  - Respaldos excluidos del deploy (1.9) y dependencias actualizadas (1.10).
  - Pruebas: `tests/plan-fase1.test.ts`, `medidas-familia.test.ts`, `medidas-claves.test.ts`,
    `fiabilidad.test.ts`, `pdf-numeracion.test.ts`.
- [x] Fase 2: anclaje, cobertura, preguntas, montos y diagnóstico de IA.
  - El anclaje solo usa lo que escribió la persona; medidas y secciones mejor separadas de la cantidad;
    frases tolerantes a «×», espacios y «en» (`src/asistente/frases.ts`) (2.1–2.3).
  - Rastro del modelo de respaldo en el registro y en la respuesta (2.4); preguntas antes que avisos en el
    historial (2.5); aviso para precios totales y montos en palabras (2.6).
  - Una sola constante de modelo por omisión, el evaluado (DeepSeek V4.1 Flash) (2.7); mensajes 4xx
    comprensibles (2.8).
  - Pruebas: `tests/chat-fiabilidad.test.ts`, `anclaje-frases.test.ts`, `frases.test.ts`,
    `montos.test.ts`, `cobertura.test.ts`, `commandcode.test.ts`.
  - Falta la evaluación de pago de cierre (2.9): ver la lista de abajo.
- [x] Fase 3: estados, documentos, correlativos, Starken y concurrencia.
  - Rechazar anula como «Anular» (3.1); aprobar desvincula la revisión en borrador con aviso (3.2).
  - Anular se bloquea con la operación despachada o completada o con factura (3.3).
  - Número manual solo para administradoras y con salto de hasta 1.000 (3.4).
  - «Regenerar PDF» con el HTML guardado al emitir (3.5).
  - Caminos de vuelta: deshacer aprobación, volver al paso anterior de la operación y confirmaciones (3.6).
  - Rebaje de puerta «menos de 5 cm» y marcos sólidos Mara/Raulí al 25 % documentados como están, a la
    espera de Neltume (3.7); firma de Starken ligada a las líneas y neto = total ÷ 1,19 (3.8); nota de
    pedido con `MAX(numero)` y despacho persistido (3.9).
  - `docs/reglas-negocio.md` al día con las reglas que aplica el código (3.10).
  - Pruebas: `tests/plan-fase3.test.ts`, `pdf-regenerar.e2e.ts`, `operacion-pasos.e2e.ts`,
    `starken.test.ts`, `persistencia-v22.test.ts`.
- [x] Fase 4: edición, ayuda, compartir, clientes, historial, papelera e importaciones.
  - Medidas como texto con `leerMedida` en los campos del detalle (4.1; Catálogo → Agregar producto y Gestionar
    seguían con `leerMetros` hasta `8152198`); borrador del chat conservado y
    navegación bloqueada mientras responde la IA (4.2); lo escrito no se pierde al recargar (4.3);
    confirmación en cada paso de la operación (4.4).
  - Jerga (4.5): en pantalla, «ganancia» en vez de margen; «Costo de fábrica $X · Precio al cliente $Y»;
    «sin IVA» en vez de neto (el PDF y el resumen para el cliente conservan «Neto»); «Lo escribiste como
    «…»» en vez de «Normalizado desde»; hoja/vano, escuadría, revisión y «Reemplazada» explicados.
    `tests/textos-interfaz.test.ts` prohíbe los textos viejos.
  - Sección «Avanzado» plegada, con advertencia, en Ajustes (modelo, respaldo y clave de la IA, «Probar
    modelo», IVA y ganancia por categoría) y en Catálogo → Nombres y alias (vista técnica) (4.6). Se
    conservan las cuentas administradoras: no hay rol estándar.
  - Guía «Cómo funciona» en `/ayuda`, enlazada desde el menú de cuenta y la pantalla vacía del cotizador
    (4.7, `tests/ayuda.e2e.ts`).
  - Compartir el PDF en el teléfono (4.8); autocompletar clientes (4.9); filtros «Vencen pronto» y «Con
    saldo pendiente», búsqueda por teléfono y CSV ampliado (4.10); papelera de borradores y de productos y
    «Volver a la planilla anterior» (4.11); avisos en Actividad y transportista «Otro» (4.12).
  - Pruebas: `tests/plan-fase4.test.ts`, `historial-papelera.test.ts`, `importar-catalogo.test.ts`,
    `clientes.test.ts`, `edicion-detalle.test.ts` y los E2E `papelera*.e2e.ts`, `importar-catalogo.e2e.ts`,
    `edicion-detalle.e2e.ts`, `texto-conservado.e2e.ts`.
- [x] Fase 5: respaldo, restauración, actualizaciones, salud, instalación y seguridad.
  - `npm run restaurar -- <carpeta>`: verifica la copia, exige el servidor detenido, aparta lo anterior en
    `data/antes-de-restaurar-<fecha>/` y restaura base, PDF, referencias y configuración juntos (5.1).
  - `scripts/respaldo-diario.sh` para el cron del host: respaldo, limpieza de borradores y copia a otro
    disco del mismo servidor (5.2; la copia fuera del servidor quedó fuera del alcance).
  - `scripts/actualizar.sh` con `--volver`; `npm run verificar` separado de `deploy` y `deploy:zip`, que
    respalda antes de subir (5.3).
  - `/api/salud` con healthcheck de Compose: sin sesión solo `{ok}`; con sesión de administradora, el
    detalle (5.4; sin alertas externas, por alcance).
  - Validación de secreto, URL y `NELTUME_IP_HEADER` al arrancar; `.env.example`, Compose y LEEME
    coherentes (5.5).
  - Primera cuenta desde la página de inicio de sesión con un código de un solo uso; regla de dos
    administradoras (5.6); limpieza de referencias huérfanas (5.7).
  - Subidas con `Content-Length` obligatorio y tope, descompresión del xlsx acotada, `/api/logo` con CSP y
    `Sec-Fetch-Site` en escrituras (5.8); registro de cambios de cuentas (5.9).
  - `docs/manual-operativo.md` para quien opera sin conocimientos técnicos y README al día (5.10).
  - Pruebas: `tests/restaurar.test.ts`, `scripts-servidor.test.ts`, `salud.test.ts`,
    `primer-arranque.test.ts`, `usuarios-rutas.test.ts`, `subidas-logo.test.ts`.

## Lo pendiente (14-oct)

El 14 de octubre se revisó lo que faltaba tras `008450b` (inventario en `docs/verificacion-pendiente.md`, sin
seguimiento en Git) y se cerró en fases. Cada una pasó typecheck, lint, pruebas unitarias, E2E (dos corridas) y
`next build`, sin corridas de IA de pago.

- [x] Fase 1 · `6c7a158` · emisión, anulación, fechas y papelera.
  - Una emisión a la vez por cotización y nota (`emisiones_en_curso`, esquema 23): la segunda responde 409 «ocupado»
    sin reservar número.
  - Aviso no bloqueante para un precio bajo el costo de fábrica; rango de precio en un solo lugar (`rangoPrecio`).
  - Restaurar un borrador conserva destino, valor del despacho y actividad.
  - `puedeAnular` compartido: «Anular» deshabilitado con motivo tras despacho o factura; el diálogo y la actividad
    informan lo pagado.
  - Pagos y facturas con fecha de Chile por omisión, sin fechas futuras ni anteriores a la aprobación.
  - Catálogo importado y restaurado con el bloqueo del almacén, también por terminal; dos confirmaciones de la misma
    vista previa ya no se pisan; avisos de ediciones directas en la Actividad; error propio de Starken cuando el
    catálogo cambió; se retira `produccion_terminada`.
- [x] Fase 2 · `8152198` · medidas, importación y catálogo.
  - Una sola regla de familia (`familiaItem`) y un solo lector de medidas (`leerMedida`) también en Agregar producto y
    Gestionar; textos de rango únicos (`errorMedida`).
  - Escuadría con unidad o invertida, plurales de modelos, ancho/alto invertidos con «Intercambiar» y aviso de vano.
  - Importación: «solo cambió la descripción» aparte; `npm run importar` conserva los alias de pantalla y escribe el
    reporte aunque bloquee; «Volver a la planilla anterior» sobrevive a recargar; Excel con contraseña o `.xls` con
    mensaje claro; sets de marco enchapados largos, códigos en cm, feriados solo nacionales y `migrar:sqlite` con
    nombres canónicos.
- [x] Fase 3 · `4ae617d` · anclaje y evaluación del asistente.
  - «83x236cm», «ambas de 73x240», «102 x 320» y «despacho a Riñihue para 3 pallets» se leen bien; «escuadría» se
    explica.
  - Cuerpo de un 4xx de la IA en el registro; Ajustes → Asistente → Avanzado muestra el último modelo, si fue el
    respaldo y la latencia.
  - 13 casos nuevos en `evals/cotizacion.json`, casos con avisos y pendientes; `evaluar:ia` guarda informes en
    `data/test-evaluar-ia/`; `evaluar:regresion` exige 0 errores silenciosos y ≤ 5 % de falsas alarmas; el deploy
    advierte con `--sin-ia`.
- [x] Fase 4 · `4e8d048` · seguridad, operación y mantenimiento de datos.
  - `/api/logo` con sesión y SVG validado con lista permitida (`svg-seguro.ts`); cambiar correo o clave de una cuenta
    pide la contraseña propia; cuenta desactivada = clave incorrecta; registro de inicios de sesión; sesiones en
    «Mi cuenta»; mensajes de formulario propios; 522/523/524 con mensaje.
  - Compose con variables explícitas (el token del túnel no llega al cotizador), `cloudflared` con versión fija, build
    con `--pull`, `.next-e2e` fuera del contexto; el deploy renueva `.version-anterior/`; `actualizar.sh` acepta URL.
  - Limpieza de snapshots, copias anuladas, auditoría de más de un año, lock y temporales; respaldo diario con
    `--link-dest`; `/api/salud` lanza Chromium e informa Starken.
  - CSV por partes, papelera paginada con plazo, número manual con último número y tope, filtros de seguimiento,
    operación y vendedora, pantalla de clientes, accesibilidad del encabezado.
- [x] Fase 5 · documentación (sin commit todavía): README, `docker/LEEME.md`, este documento,
      `docs/manual-operativo.md`, `docs/reglas-negocio.md` y `.env.example` al día; rutas unificadas en
      `/srv/cotizador-neltume`.
- [ ] Fases 6–9: pruebas que faltan, gasto e instalación (IA de pago, Docker), servidor y personas, decisiones de
      Neltume y del equipo, y mantenibilidad. Ver `docs/verificacion-pendiente.md`.

## Verificación operativa pendiente

Nada de esto se puede dar por hecho desde desarrollo:

- [ ] Instalar el cron de `scripts/respaldo-diario.sh` en producción y revisar durante una semana que haya
      un respaldo por día en el otro disco y que `/api/salud` no avise de un respaldo viejo.
- [ ] Probar `scripts/actualizar.sh` y `scripts/actualizar.sh --volver` con Docker real, con un ZIP de
      `npm run deploy:zip`.
- [ ] Hacer una restauración real dentro de Docker siguiendo `docker/LEEME.md → Restaurar`.
- [ ] Confirmar en el servidor que el healthcheck nuevo de Compose (`/api/salud`, que ahora lanza Chromium) marca el
      contenedor como sano, y que el proxy no lo bloquea y reenvía `NELTUME_IP_HEADER` y `Content-Length`.
- [ ] Primer `npm run deploy` observado con los commits del 14 de octubre (lo corre el usuario): migración al
      esquema 23, `.version-anterior/` renovado y `cloudflared` con la versión fija.
- [ ] Ensayar con Docker la receta nueva de restaurar desde el otro disco (`--user root` y `chown`) y
      `actualizar.sh` con una URL `https://`.
- [ ] Migrar una copia de la base de producción y ensayar la vuelta atrás.
- [ ] Observar las líneas `[asistente]` en producción dos semanas y comparar el costo estimado de la IA con el cobro
      real de CommandCode.
- [ ] Prueba en teléfonos reales (iPhone y Android): compartir el PDF, pantallas de 390 px, la guía
      «Cómo funciona» y la sección «Avanzado».
- [ ] Aceptación con Paula y Paulette: recorrer el guion de cinco minutos del README sin ayuda y revisar
      los textos nuevos (ganancia, sin IVA, «Lo escribiste como…»), la guía y el punto 10 del manual operativo
      (emisión ocupada, anular bloqueado, fechas de pago, avisos de costo y de vano, clientes, papelera).
- [ ] Evaluación de IA de pago al cierre de la fase 2 (`npm run evaluar:regresion`, ahora con los 13 casos nuevos y
      los umbrales de silenciosos y falsas alarmas, y `npm run paridad:excel-ia -- --casos 60 --semilla 2`), con
      presupuesto confirmado antes de correrla.
- [ ] Decisiones de Neltume todavía abiertas (sección 3 de `revision-2026-10-11.md`):
  - Ganancia de los marcos sólidos en Mara o Raulí: hoy 25 %, como accesorios; Oregón 85 % y Lenga 55 %
    (decisión 1, marcada «por confirmar» en `docs/reglas-negocio.md`).
  - Medida de vano: hoy se registra «vano» y se cotiza la medida tal cual (decisión 2).
  - Confirmar las reglas ya aplicadas como se documentaron: tope de 50 % (3), anulación bloqueada tras
    despacho o factura (4), número manual solo administradoras con salto de 1.000 (5), cuentas
    administradoras con «Avanzado» en vez de rol estándar (6), rebaje «menos de 5 cm» (7) y despacho de
    Starken = total ÷ 1,19 (8).

## Validación

Las evaluaciones pagadas necesitan presupuesto confirmado. Las pruebas usan bases temporales,
nunca la base operativa. La aceptación humana y la instalación del cron en producción se
documentan como verificaciones operativas, no se dan por realizadas desde desarrollo.
