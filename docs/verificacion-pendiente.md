# Lo que falta · 14 de octubre de 2026

Estado revisado contra el commit `008450b` («fiabilidad del cotizador, fases 1–5»). Reemplaza el inventario del 12 de octubre, que quedó desactualizado.

**Base:** typecheck, lint, 999 pruebas unitarias, 49 E2E (1 omitida a propósito) y `next build` pasan. Las cinco fases del plan están en el código. Lo que sigue es lo que **no** está hecho, consolidado de tres revisiones de solo lectura:

- el plan de [revision-2026-10-11.md](revision-2026-10-11.md): 239 elementos, 139 hechos;
- el inventario del 12 de octubre: 129 puntos, 27 cubiertos;
- los huecos del trabajo nuevo.

## Estado al 14 de octubre, tarde (tras `4e8d048` y la fase 5)

Lo de este inventario se cerró en cinco fases. Lo cerrado queda ~~tachado~~ con su commit; lo que no está tachado
sigue pendiente.

| Fase | Commit     | Qué cerró                                                                                                                                                                                                                                   |
| ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `6c7a158`  | Emisión una a la vez, aviso bajo el costo, restaurar borrador completo, anulación con motivo, fechas de pago y factura, bloqueo del catálogo, Starken con catálogo cambiado.                                                                |
| 2    | `8152198`  | Medidas y familia únicas, escuadría, plurales, aviso de vano, importación (alias, reporte, solo descripción, planilla anterior, Excel con contraseña), feriados nacionales, `migrar:sqlite`.                                                |
| 3    | `4ae617d`  | Anclaje («83x236cm», «ambas de», «102 x 320», Riñihue), escuadría explicada, diagnóstico de la IA, casos nuevos, informes y umbrales de la evaluación.                                                                                      |
| 4    | `4e8d048`  | `/api/logo` y SVG, cuentas (contraseña propia, sesiones, inicios de sesión), Compose y túnel, deploy y `actualizar.sh`, limpieza de datos, `/api/salud` con Chromium y Starken, CSV por partes, papelera, filtros, clientes, accesibilidad. |
| 5    | sin commit | Documentación (sección 5).                                                                                                                                                                                                                  |

**Sigue pendiente** (fases siguientes): 6 · pruebas que faltan (sección 6); 7 · gasto e instalación (sección 7);
8 · servidor, teléfonos y personas (sección 8); 9 · decisiones (sección 9); y mantenibilidad (sección 10). En el
código queda un solo texto vivo de la sección 5: «rol estándar» en Ajustes → Usuarios.

**Dónde se hace:** **Mac** = en esta Mac sin gastar. **Permiso** = requiere gastar o instalar algo. **Externo** = requiere el servidor, teléfonos o personas.

---

## 1. Defectos vivos en el código

Comprobados leyendo el código o reproducidos con scripts. Ordenados por impacto.

| #   | Defecto                                                                                                                                                                                                                                     | Dónde                                                                                                | Severidad  | Cerrado en                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| 1   | ~~Dos «Emitir» o dos «Generar nota» simultáneos queman un número: ambos reservan y el segundo falla al confirmar.~~                                                                                                                         | `servicio.ts:1660`, `:2089`                                                                          | Media-alta | `6c7a158` (se evita: 409 «ocupado» sin reservar)                                                       |
| 2   | ~~Un precio manual entre −50 % y 0 % sobre el costo (vender bajo el costo) no genera ningún aviso.~~                                                                                                                                        | `items-vigentes.ts`, `servicio.ts`                                                                   | Media      | `6c7a158`                                                                                              |
| 3   | ~~Restaurar un borrador desde la papelera pierde el destino y el valor del despacho, que el esquema descarta. También pierde toda la actividad anterior, borrada en cascada.~~                                                              | `persistencia-esquemas.ts:194-201`, `almacen.ts:843`, `:996`                                         | Media      | `6c7a158`                                                                                              |
| 4   | ~~«Anular» se ofrece en cotizaciones despachadas, completadas o facturadas. El servidor responde 409 después de que la persona escribió el motivo.~~                                                                                        | `cotizacion-panel.tsx:1614-1616`, `servicio.ts:1074-1081`                                            | Media      | `6c7a158`                                                                                              |
| 5   | ~~«Cotizar con Starken» queda habilitado cuando el catálogo cambió y responde «Completa o quita los ítems pendientes» sin ningún pendiente a la vista. `tests/starken.test.ts:1110-1112` fija ese mensaje como esperado.~~                  | `cotizar-starken.tsx:76`, `starken-servicio.ts:75`                                                   | Media      | `6c7a158`                                                                                              |
| 6   | ~~La vista previa de importación marcará ~8.316 de 8.772 productos como «modificados» solo por el formato de la descripción («0,60» → «0,6»).~~                                                                                             | `importacion-catalogo.ts:10-15`                                                                      | Media      | `8152198` (la vista previa separa «solo cambió la descripción»; el formato sigue siendo la decisión 9) |
| 7   | ~~`npm run importar` (terminal) pisa los alias editados en «Nombres y alias»; `docker/LEEME.md:189-192` y `README.md:15`, `:235` lo recomiendan. Si se pasa del 90 %, además informa una falla con el catálogo ya guardado.~~               | `scripts/importar.ts:15`                                                                             | Media      | `8152198` (mandan los alias de pantalla)                                                               |
| 8   | ~~«Volver a la planilla anterior» desaparece al recargar o cambiar de sección: ninguna ruta GET expone `planillaAnterior()`.~~                                                                                                              | `importar-catalogo.tsx:158-163`, `repositorio-catalogo.ts:837`                                       | Media      | `8152198`                                                                                              |
| 9   | ~~Catálogo → Agregar producto y Gestionar siguen con `leerMetros`: «80 cm», «2100 mm» y «3600 mm» fallan, y «3600» se lee como 36 m. README:43 promete «3600 mm».~~                                                                         | `alta-producto.tsx:196-224`, `gestion-manuales.tsx:62-70`                                            | Media      | `8152198`                                                                                              |
| 10  | ~~La familia de un ítem sale de cuatro reglas distintas. Un «Marco» pendiente sin sección acepta 3,6 m desde el botón, pero no escrito en el chat.~~                                                                                        | `anclaje.ts:128`, `:697`, `personalizados.ts:22-45`, `respuesta-directa.ts:181`                      | Media      | `8152198`                                                                                              |
| 11  | ~~Un set de marco enchapado de 3,20 m es ilegible al importar: `aMetros` usa el rango de puerta.~~                                                                                                                                          | `enchapadas.ts:143-146`                                                                              | Media      | `8152198`                                                                                              |
| 12  | ~~Se acepta un pago o una factura con fecha futura o anterior a la aprobación; el campo no tiene `min` ni `max`.~~                                                                                                                          | `servicio.ts:474-481`, `:1783`, `:1990`; `seguimiento-operacion.tsx:254`                             | Media      | `6c7a158`                                                                                              |
| 13  | ~~Una unidad pegada al final («83x236cm») impide ubicar la frase, y el anclaje se pierde.~~                                                                                                                                                 | `frases.ts:36`                                                                                       | Media      | `4ae617d`                                                                                              |
| 14  | ~~Falsa alarma con «una en raulí y otra en lenga, ambas de 73x240». Reproducida.~~                                                                                                                                                          | `anclaje.ts` (`anclarFrases`)                                                                        | Media      | `4ae617d`                                                                                              |
| 15  | ~~Importar un catálogo mientras se emite: `guardarCatalogo` no toma el bloqueo, y la emisión puede guardar montos de un catálogo con la versión del siguiente.~~                                                                            | `servicio.ts:1689`, `:1698`                                                                          | Baja-media | `6c7a158`                                                                                              |
| 16  | ~~Anular una aprobada con anticipo no registra el monto pagado ni lo advierte el diálogo.~~                                                                                                                                                 | `servicio.ts:1111`, `dialogos-cotizacion.tsx:316-322`                                                | Baja-media | `6c7a158`                                                                                              |
| 17  | ~~Los avisos de una edición directa no quedan en Actividad ni sobreviven a recargar.~~                                                                                                                                                      | `cotizador.tsx:544-552`, `servicio.ts:1585`                                                          | Baja-media | `6c7a158`                                                                                              |
| 18  | ~~«4 LANCO en Lenga de 102 x 320» propone 1,02 m como alto. Reproducido.~~                                                                                                                                                                  | `anclaje.ts`, `metros(320, 'PUERTA')`                                                                | Baja-media | `4ae617d`                                                                                              |
| 19  | ~~Escuadría con unidad («30x70 mm») o invertida («4x2») termina en «medida no disponible».~~                                                                                                                                                | `resolver.ts:35-41`, `:306-308`                                                                      | Baja-media | `8152198`                                                                                              |
| 20  | ~~`/api/logo` sigue público con una justificación falsa: el login usa el logo estático. README:334 repite el error.~~                                                                                                                       | `api/logo/route.ts`, `login-form.tsx:52`                                                             | Baja-media | `4e8d048`                                                                                              |
| 21  | ~~«Necesito despacho a Riñihue para 3 pallets» todavía «parece un pedido».~~                                                                                                                                                                | `cobertura.ts:173-180`                                                                               | Baja       | `4ae617d`                                                                                              |
| 22  | ~~El login dice «tu borrador se conservó» aunque se llegue desde Historial, Catálogo o Ajustes.~~                                                                                                                                           | `login-form.tsx:65`                                                                                  | Baja       | `4e8d048`                                                                                              |
| 23  | ~~`migrar:sqlite` falla al verificar con productos «HUILO HUILO» (solo afecta a la migración de JSON antiguos).~~                                                                                                                           | `migracion-sqlite.ts`                                                                                | Baja       | `8152198`                                                                                              |
| 24  | ~~El diálogo de número manual anuncia «Se emitirá como N° X» sin conocer el último número ni el tope de +1.000.~~                                                                                                                           | `dialogos-cotizacion.tsx:225-231`                                                                    | Baja       | `4e8d048`                                                                                              |
| 25  | ~~«marcos» y «molcos» quedan como modelo posible; ancho y alto invertidos no se sugieren.~~                                                                                                                                                 | `configuracion.ts:402-421`, `resolver.ts`                                                            | Baja       | `8152198`                                                                                              |
| 26  | ~~La explicación de un pendiente por precio aparece tres veces en el detalle y una en el chat.~~                                                                                                                                            | `cotizacion-panel.tsx:755`, `:988`; `preguntas-pendientes.tsx:74`                                    | Baja       | `4e8d048`                                                                                              |
| 27  | ~~La papelera lista como máximo 200 borradores, sin paginar ni avisar; la búsqueda solo filtra esos.~~                                                                                                                                      | `almacen.ts:1112`                                                                                    | Baja       | `4e8d048`                                                                                              |
| 28  | ~~El CSV corta en 5.000 filas sin avisar.~~                                                                                                                                                                                                 | `exportar.ts:5`                                                                                      | Baja       | `4e8d048`                                                                                              |
| 29  | ~~El error 524 de Cloudflare no tiene mensaje propio.~~                                                                                                                                                                                     | `solicitud.ts:89`                                                                                    | Baja       | `4e8d048`                                                                                              |
| 30  | ~~Dos confirmaciones de importación a la vez: el control de versión queda fuera de la transacción.~~                                                                                                                                        | `catalogo/importar/route.ts:83-87`                                                                   | Baja       | `6c7a158`                                                                                              |
| 31  | ~~`iniciar.sh` distingue mayúsculas en `NELTUME_IP_HEADER` y la app no.~~                                                                                                                                                                   | `docker/iniciar.sh:24-27`                                                                            | Baja       | `4e8d048`                                                                                              |
| 32  | ~~El 403 de una cuenta no administradora en `/api/accion` no lleva `codigo` ni `no-store`.~~                                                                                                                                                | `accion/route.ts:419`                                                                                | Baja       | `4e8d048`                                                                                              |
| 33  | ~~La corrección de códigos al importar no aplica la heurística de centímetros.~~                                                                                                                                                            | `catalogo/importar.ts:181-205`                                                                       | Baja       | `8152198`                                                                                              |
| 34  | ~~La sincronización de feriados no filtra por tipo (hoy boostr no trae regionales).~~                                                                                                                                                       | `feriados-sync.ts:20-23`                                                                             | Baja       | `8152198`                                                                                              |
| 35  | ~~Validación nativa del navegador (`required`, en el idioma del navegador) en login, crear cuenta, primera cuenta y cambiar clave.~~                                                                                                        | `login-form.tsx`, `crear-usuario.tsx`, `primera-cuenta.tsx`, `cambiar-clave.tsx`                     | Baja       | `4e8d048`                                                                                              |
| 36  | ~~Accesibilidad: el error de la primera cuenta va ligado a un solo campo y sin foco; el registro de cambios se desarma a 520 px; el motivo de los enlaces bloqueados está solo en `title`; un `aria-controls` apunta a un id inexistente.~~ | `primera-cuenta.tsx:132`, `cotizacion.css:878-886`, `encabezado.tsx:73-82`, `campo-editable.tsx:322` | Baja       | `4e8d048`                                                                                              |
| 37  | ~~«Escuadría» sin explicar en una pregunta y en un aviso.~~                                                                                                                                                                                 | `pendientes.ts:57`, `anclaje.ts:805`                                                                 | Baja       | `4ae617d`                                                                                              |
| 38  | ~~El cuerpo de un error 4xx de la IA no llega al registro, y el modelo y el respaldo que responden no se muestran en «Avanzado».~~                                                                                                          | `errores.ts:16`, `commandcode-chat.ts:53`, `accion/route.ts:440`                                     | Baja       | `4ae617d`                                                                                              |
| 39  | ~~Código muerto: el estado `produccion_terminada` nunca se asigna, y `aprobar` comprueba `rechazada`, que es inalcanzable.~~                                                                                                                | `servicio.ts:1957`, `:1736`                                                                          | Baja       | `6c7a158`                                                                                              |
| 40  | ~~La validación del SVG del logo es una lista negra (`java&#x73;cript:` pasa); queda mitigado por la CSP con sandbox.~~                                                                                                                     | `configuracion-negocio.ts:12-20`                                                                     | Baja       | `4e8d048`                                                                                              |
| 41  | ~~Un xlsx protegido con contraseña de apertura da «invalid zip data», en inglés y sin decir que está protegido.~~                                                                                                                           | `catalogo/xlsx.ts`, `catalogo/planilla.ts`                                                           | Baja       | `8152198`                                                                                              |
| 42  | ~~Un pago o una factura sin fecha elegida guardan la hora UTC, y la Actividad muestra el día UTC: después de las 21:00 de Chile anota el día siguiente. Las fechas elegidas, en cambio, se guardan a mediodía UTC.~~                        | `servicio.ts:1783`, `:1792`, `:1990`                                                                 | Baja-media | `6c7a158`                                                                                              |
| 43  | ~~`npm run deploy` no renueva `.version-anterior/` (lo excluye del rsync): un `actualizar.sh --volver` posterior volvería a la versión anterior a la última actualización con ZIP, no a la del último deploy.~~                             | `scripts/deploy.mjs:228`                                                                             | Baja-media | `4e8d048`                                                                                              |
| 44  | ~~El contenedor del cotizador recibe el `.env` completo por `env_file`, incluido `CLOUDFLARE_TUNNEL_TOKEN`; además `cloudflared:latest` no tiene versión fija.~~                                                                            | `compose.yaml:12`, `:57`                                                                             | Baja       | `4e8d048`                                                                                              |
| 45  | ~~`.dockerignore` no excluye `.next-e2e` (~342 MB): un `docker build` local lo envía al contexto. El ZIP no lo lleva.~~                                                                                                                     | `.dockerignore`                                                                                      | Baja       | `4e8d048`                                                                                              |

## 2. Datos que crecen sin límite

- ~~**Snapshots de PDF:**~~ (`4e8d048`: el logo va como referencia y `limpiar-borradores` compacta los antiguos y purga los de anuladas viejas) `documentos_snapshot` guarda el HTML completo de cada PDF y nota, con el logo en base64. Nunca se borra y entra en cada uno de los 30 respaldos (`almacen.ts:1003`).
- ~~**PDF en disco:**~~ (`4e8d048`: se purgan las copias «ANULADA» con más del plazo; el respaldo diario enlaza los PDF iguales con `--link-dest`; los PDF originales se conservan a propósito) nada borra `data/pdf` ni los `-anulada.pdf`, y cada respaldo copia todos los PDF (`documentos.ts:12-15`, `respaldar.ts:43-50`).
- ~~**Auditoría de cuentas:**~~ (`4e8d048`: se purga lo de más de un año) sin purga; la pantalla muestra 50.
- **Papeleras:** ~~ni el Historial ni la guía dicen cuándo se borran~~ (`4e8d048`: la papelera muestra el plazo de 30 días; fase 5: manual y LEEME). Sigue: solo las vacía `limpiar-borradores` vía cron, que no está instalado (Externo).
- ~~**Restos de un proceso muerto:**~~ (`4e8d048`: `limpiar-borradores` borra el lock vencido y los temporales de más de una hora) nadie limpia `data/.estado.lock` ni los PDF temporales `.<uuid>.pdf` tras un corte o un SIGKILL.
- **Chromium del contenedor:** ~~sin `--pull` y sin lanzar el navegador~~ (`4e8d048`: build con `--pull` en `deploy.mjs` y `actualizar.sh`; `/api/salud` lanza Chromium). Sigue: confirmar qué versión trae bookworm frente a la probada de Playwright. `bookworm-security` ya trae Chromium 155 y Playwright 1.63 está probado con 153. Como ni `deploy.mjs` ni `actualizar.sh` construyen con `--pull`, la capa queda congelada; `/api/salud` no lanza el navegador.
- **Restauraciones:** `data/antes-de-restaurar-<fecha>/` se borra a mano (fase 5: documentado en LEEME → Limpieza de datos; sigue siendo manual a propósito).
- ~~**Volver atrás en una actualización:**~~ (`4e8d048`: `.version-anterior/datos/` guarda su propia copia del respaldo) `.version-anterior/respaldo` apunta a un respaldo que rota a los 30 días; pasado ese plazo, `actualizar.sh --volver` falla.
- **Proyección del disco:** falta el volumen mensual de cotizaciones y notas (Externo).

## 3. Funciones parciales o que faltan

- **Estado del sistema:** ~~`/api/salud` no revisa Starken ni lanza Chromium~~ (`4e8d048`). Sigue: de la IA solo mira que la clave sea legible, no válida; el manual ya lo dice (fase 5). Antes: De Chromium solo mira que exista, sin lanzarlo, y de la IA solo que la clave sea legible, no válida. Sin embargo, el manual dice «si la clave de IA funciona».
- **Actualizar:** ~~`actualizar.sh` no descarga nada~~ (`4e8d048`: acepta una URL `https://` y verifica el ZIP). Sigue: Generar el ZIP sigue exigiendo el repositorio y Node; no hay CI ni artefacto publicado.
- ~~**Sesiones y accesos:**~~ (`4e8d048`: sesiones en Mi cuenta y registro de inicios de sesión) no hay lista ni revocación de sesiones, y no se registran los inicios de sesión.
- ~~**Historial:**~~ (`4e8d048`: filtros de seguimiento, operación y vendedora) no hay filtro por estado comercial u operativo ni por vendedora.
- ~~**Clientes:**~~ (`4e8d048`: pantalla `/clientes`) hay autocompletar, pero no una pantalla de directorio.
- **Vano a hoja:** ~~ni el aviso mínimo~~ (`8152198`: aviso de vano). Sigue sin conversión (decisión 2). Antes: no hay conversión ni el aviso mínimo cuando un vano cae justo sobre el límite de un tramo (depende de la decisión 2).
- **Neto de Starken:** documentado como el mejor posible (`6c7a158`, `docs/reglas-negocio.md`); no cuadra al peso con la boleta en ~16 % de los totales (depende de la decisión 8).

## 4. Seguridad y cuentas

- ~~**Cambios a otra cuenta:**~~ (`4e8d048`: pide la contraseña propia) se puede cambiar el correo o la clave de otra cuenta sin pedir la propia; el cambio sí queda registrado (`api/usuarios/route.ts:115`, `:168`).
- ~~**Cuenta desactivada:**~~ (`4e8d048`: responde como una clave incorrecta) responde 403 y no 401, lo que revela que existe (`autenticacion.test.ts:162` lo da por bueno).
- **Contraseñas y sesión:** solo se exige un largo de 8 caracteres. La sesión dura 12 h fijas, sin cierre por inactividad.
- **Historial de Git:** la transcripción privada, `.commandcode/` e `.impeccable/` salieron del índice, pero siguen en el historial. Reescribirlo es decisión.
- **Proxy:** falta confirmar en el servidor qué proxy hay, qué `NELTUME_IP_HEADER` llega y que reenvía `Content-Length` en las subidas.

## 5. Documentación desactualizada

Todo cerrado en la fase 5 (documentación, sin commit), salvo el texto de `usuarios.tsx`, que es código.

- ~~**`docs/implementacion-fiabilidad.md`:**~~ (fase 5) `:10` dice «sin commitear todavía», y `:51` dice «`leerMedida` en todos los campos», lo que no es cierto en el catálogo.
- ~~**README:**~~ (`8152198` hizo cierto «3600 mm»; `4e8d048` corrigió `/api/logo`; fase 5: `/api/salud` con Chromium y Starken) `:43` promete «3600 mm» en el catálogo, y `:334` dice que el login necesita `/api/logo`.
- ~~**`docs/reglas-negocio.md`:**~~ (vano en `8152198`; el resto en la fase 5: duplicar, deshacer aprobación, volver un paso, cuentas y tope de 50 %)
  - faltan filas para el vano, el recorte del descuento al duplicar, deshacer la aprobación o volver un paso, y la regla de dos administradoras;
  - `:64` dice «50 % por omisión», como si se pudiera subir.
- ~~**Carpetas:**~~ (fase 5: todo en `/srv/cotizador-neltume`, explicado como la carpeta del deploy por SSH; los comentarios de `scripts/actualizar.sh` y `scripts/respaldo-diario.sh` siguen diciendo `/opt/…`) `docker/LEEME.md` (9 usos) y `docs/manual-operativo.md` (5) dicen `/opt/neltume-cotizador`, mientras el deploy usa `/srv/cotizador-neltume`.
- ~~**Montaje externo de respaldos:**~~ (fase 5: receta en dos pasos, copia como root y `chown node`; falta ensayarla con Docker) con una carpeta 0700 y un uid del host distinto de 1000, la receta de `docker/LEEME.md:248` y `:293` fallaría (por lectura).
- ~~**Puertos:**~~ (fase 5: tabla en LEEME, README y `.env.example`) 3000 por omisión y 3010 en `npm run deploy`, explicado pero sin unificar.
- **Ajustes → Usuarios:** (sigue: `src/app/ajustes/usuarios.tsx:202` dice «las de rol estándar ven Ajustes en solo lectura» y `:261` muestra «Estándar» para un rol distinto de `admin`) todavía habla de «rol estándar» y muestra «Estándar» (`usuarios.tsx:158-159`, `:203`), aunque todas las cuentas son administradoras.
- ~~**LEEME:**~~ (fase 5: sección Feriados; la receta de importar usa `docker compose run` desde `8152198`)
  - no menciona `npm run feriados` ni `NELTUME_FERIADOS_SYNC`;
  - la receta de `:189-192` usa `docker compose cp` y `npm run importar`.
- ~~**Importar:**~~ (`8152198`: el texto ya no dice «vuelve a importarla») el texto de `importar-catalogo.tsx:204` («vuelve a importarla») contradice `repositorio-catalogo.ts:867`.
- ~~**Contexto de la IA:**~~ (fase 5: README, sección del asistente) no está documentado que las observaciones del ítem y los datos del cliente viajan en cada mensaje (`llm.ts:178`, `:184`).

## 6. Pruebas que faltan (Mac, sin gastar)

**Unitarias**

- **Asistente:**
  - ~~responder un dato cuando faltan dos~~ (`4ae617d`);
  - ~~el rastro del modelo de respaldo, con el diagnóstico~~ (`plan-rutas.test.ts`: registro `[asistente]` con modelo, respaldo y avisos por categoría, sin texto);
  - ~~preguntas antes que avisos~~ (ya cubierta: `chat-fiabilidad.test.ts`, «la pregunta pendiente sobrevive al recorte»);
  - ~~«ambas de»~~ (`4ae617d`);
  - ~~«102 x 320»~~ (`4ae617d`);
  - ~~Riñihue~~ (`4ae617d`);
  - ~~«83x236cm»~~ (`4ae617d`).
- **Servidor:**
  - ~~topes de descompresión del xlsx (`xlsx.ts:28-54`)~~ (`xlsx-descompresion.test.ts`: bordes, partes sin comprimir y parte que declara menos);
  - ~~restaurar un borrador conservando despacho y actividad~~ (`6c7a158`);
  - ~~fecha de pago y de factura~~ (`6c7a158`);
  - ~~disco bajo en `/api/salud`~~ (`salud.test.ts`);
  - ~~doble emisión simultánea~~ (`6c7a158`);
  - ~~pares de acciones con el número ya reservado, `ErrorOcupado` y el bloqueo comprometido~~ (`16dc69f`, `fase6-servidor.test.ts`);
  - ~~importar mientras se emite~~ (`6c7a158`);
  - ~~emitir entre las 21:00 y las 23:59 de Chile~~ (`16dc69f`, `fase6-servidor.test.ts`);
  - ~~reimportar retirando un producto usado en borradores~~ (`16dc69f`, `fase6-servidor.test.ts`);
  - ~~caminos de error de `migrarJsonASqlite`~~ (`16dc69f`, `sqlite.test.ts`);
  - ~~migración v5 con montos comparados al peso~~ (`16dc69f`, `migracion-v5.test.ts`; se omite sin la copia privada de `data/respaldo-migracion/`).
- **Pantalla:**
  - ~~el flujo de compartir (cancelado o rechazado)~~ (`pantalla-cuentas-compartir.test.ts`, lógica en `src/app/compartir.ts`);
  - ~~la primera cuenta~~ (`pantalla-cuentas-compartir.test.ts`, validación en `login/mensajes.ts`);
  - ~~el registro de cambios y el aviso de una sola administradora~~ (`pantalla-cuentas-compartir.test.ts`, `ajustes/cuentas.ts`);
  - ~~el destino que anuncia «volver un paso», incluida «completada»~~ (`seguimiento-operacion.test.ts`: lo anunciado contra lo que aplica el servidor, con `retrocesoOperativo` compartido).
- ~~**Asistente, edición:**~~ (`4ae617d`) una edición por chat con la frase parafraseada debe dar «No pude verificar»; hoy solo se prueba la cotización nueva.
- **Corregir pruebas que pasan por la razón equivocada:**
  - ~~`starken.test.ts:1110` fija el mensaje confuso~~ (`6c7a158`: el mensaje queda solo con un pendiente a la vista; con el catálogo cambiado hay error propio);
  - ~~`seguimiento-operacion.test.ts:89` usa un pago anterior a la aprobación~~ (`6c7a158`);
  - ~~la de D1 espera 6,30 kg, fuera del rango de 8–15 kg del plan~~ (el rango del plan era a ojo; la geometría da ~6,3 kg. La prueba ya no fija la cifra del código: la deriva de las medidas y la compara con un kit 2X4);
  - ~~la de regenerar compara el HTML y no el texto del PDF~~ (`16dc69f`, `pdf-texto.test.ts` con pdfjs-dist; se omite sin Chromium).

**E2E (Chrome)**

- **Operación:**
  - pago con decimales y aviso a 390 px;
  - doble toque en Emitir y en Registrar pago;
  - que los diálogos de confirmación de la nota y de los pasos de producción quepan a 390 px en modo táctil (hoy solo se prueba «Volver al paso anterior», con puntero fino);
  - mensajes en pantalla de los errores que antes eran 500: sin Chromium, descuento sobre 50, copia recortada y tarifa vieja.
- **Pantallas y anchos:**
  - Historial con filas a 320, 360 y 390 en modo táctil;
  - scroll anidado del chat;
  - pestañas de Ajustes en móvil;
  - Ajustes → Starken en móvil;
  - teléfono en horizontal;
  - barrido de anchos 320, 360, 412, 640 y 768;
  - papelera, Avanzado, primera cuenta y registro de cambios a 390 px.
- **Sesión y cambios sin guardar:**
  - aviso al salir con cambios sin guardar;
  - sesión vencida fuera del cotizador;
  - lo escrito en cantidad, flete, descuento y ganancia cuando otra persona guarda.
- **Catálogo:** la moldura de más de 3 m tomada del catálogo; hoy se omite y debería crearse por API.
- **Revisión transversal:**
  - revisión visual de los PDF;
  - errores de consola e hidratación en toda la suite;
  - axe (WCAG) en todas las pantallas;
  - VoiceOver;
  - idioma de la validación nativa;
  - aproximar el PC de la oficina.
- **Contra el build de producción:** E2E sobre `next build` + `next start`.
- **Otros navegadores:** WebKit y Firefox para los campos que siguen numéricos; requiere `npx playwright install webkit firefox`, gratis.

**Importación y paridad**

- **`npm run paridad:excel` sin IA:** la última corrida es del 5 de octubre. Hay que respaldar antes `reporte.md` y `diferencias.json`.
- **Planillas de prueba:** falta un libro sintético de la planilla principal para los bordes (K4, #N/A, fórmulas sin valor guardado).
- **Huecos de la paridad:**
  - márgenes por categoría sin IA, otro IVA;
  - descuentos, que no tienen oráculo en Excel;
  - paridad contra el catálogo guardado (dos planillas y los productos manuales juntos).
- **Formatos:** planilla en Strict Open XML; una hoja que figura en las relaciones pero falta en el zip.
- **Volver a la planilla anterior:** importar dos veces la misma planilla (la «anterior» pasa a ser la misma) y que una importación fallida deje intactas `catalogo_anterior` y `catalogo_ediciones`.
- **Importar:** la casilla de forzar (reducción bajo el 90 %) y un archivo que no es .xlsx.
- **Migración desde JSON:** `guardarCatalogo` reescribe una fecha sin milisegundos, lo que haría fallar la verificación de `migrar:sqlite` (por lectura).

**Carga**

- **Pruebas de carga:**
  - script de carga mixta con 2 a 4 personas;
  - carga HTTP con `ab` contra `next start`;
  - resistencia de 2 a 8 h.
- **Concurrencia:**
  - respaldo en caliente mientras se escribe;
  - pico de memoria con un libro legítimo bajo el tope;
  - varios PDF a la vez con uno vencido;
  - dos usuarias en la misma cotización.
- **Volumen:** 20.000 cotizaciones.

**Entrega**

- **ZIP:** construir solo con lo que lleva el ZIP, `npm prune` y `next start`, y revisar su contenido real con `npm run deploy:zip -- --sin-ia`.
- **Chromium:** consultar qué versión trae bookworm.
- **Feriados:** probarlos con red real.

**Evaluación de la IA, sin gastar**

- ~~**Casos nuevos:** escribirlos en `evals/cotizacion.json`~~ (`4ae617d`: 13 casos); correrlos cuesta (sección 7).
- **Herramientas:**
  - ~~guardar la salida de `evaluar:ia` en archivos~~ (`4ae617d`);
  - ~~esquema de casos con avisos y pendientes~~ (`4ae617d`);
  - simular una «IA perfecta»;
  - escenarios nuevos en el generador de paridad.
- ~~**Deploy:** umbrales de errores silenciosos~~ (`4ae617d`: `--max-silenciosos 0 --max-falsas 0.05` y advertencia con `--sin-ia`); umbrales de errores silenciosos y falsas alarmas; hoy `--min-perfectos 0.95` deja pasar 2 de 56 casos imperfectos y `--sin-ia` permite saltarse la evaluación.

## 7. Requiere gasto o instalar algo (permiso)

Corrido el 14 de octubre (fase 7). Gasto total de IA ≈ US$0,63.

- **IA con el modelo real:**
  - ~~`npm run evaluar:regresion` con DeepSeek V4.1 Flash (≈US$0,48, 69 casos × 3)~~: precisión por campo 100 %,
    69/69 casos perfectos, 0 errores silenciosos. Las 3 «falsas alarmas» del informe eran el aviso que el caso
    `i7-precio-total` pide: el informe ya no cuenta como falsa alarma un aviso declarado en `esperado.avisos`
    (corregido, con prueba). Falsas alarmas reales: 0/207.
  - ~~Paridad de DeepSeek en «avisar», 60 casos de la semilla 3 (≈US$0,12)~~: 60/60 correctas, 0 graves, falsas
    alarmas 2/60 (3,3 %, bajo el tope de 5 %). Las dos se corrigieron (ver «Anclaje» abajo).
  - ~~Qwen 3.7 Flash como respaldo, en «avisar» (≈US$0,03)~~: 99,7 % por campo, 67/69 perfectos. Un error
    silencioso (`i7-precio-total`: tomó el total como unitario sin aviso) y falsas alarmas de los mismos patrones
    que DeepSeek; corregidos (ver «Anclaje»).
  - **Anclaje corregido tras las corridas:** (1) en «avisar», «anoté la cantidad 1» ya no aparece por una cifra que el anclaje quitó y
    dejó pendiente: cada ítem y campo se avisa una vez, y un valor inventado que sí queda se sigue avisando;
    (2) una frase de la IA armada con trozos del mensaje en orden («una en lenga, ambas de 74x220») se ubica por
    partes, y «dame 2 LOS LAGOS, una en lenga y otra en mara» ya no da «No registré»; (3) «$400.000 en total» se
    detecta en el texto aunque la IA lo deje como unitario (error silencioso de Qwen). Pruebas en
    `tests/chat-falsas-alarmas.test.ts`, `cobertura.test.ts` y `frases.test.ts`. Queda a decidir si el aviso «propuso
    la cantidad 1… quedó pendiente» se oculta cuando la misma cantidad ya es una pregunta pendiente.
  - Pendiente, lo hace el usuario desde la aplicación (un script propio que lee la clave quedó bloqueado por
    regla): «Probar modelo» en Ajustes, provocar la caída al respaldo con un nombre de modelo inexistente, y alta de
    producto seguida de un pedido en el chat.
  - Sin correr (opcional, ~US$2,3, requiere confirmar): semillas completas, variabilidad del caso 134 y grabar
    las respuestas para repetirlas sin costo; el chat en el teléfono va con la sección 8.
- ~~**Docker o Colima**~~ (Colima arm64, Docker 29, Compose 5.6; copia aislada `neltume-ensayo`, ya borrada):
  - ~~imagen arm64 (57 s, 562 MB) y amd64 con Rosetta (100 s, 561 MB)~~; SQLite y `print-to-pdf` en amd64;
  - ~~`up --wait` sano en 6 s~~, primer arranque por la receta del LEEME, `/api/salud` completo;
  - ~~PDF con el Chromium 155 de Debian~~: tildes, ñ, «×», totales y fuentes Liberation incrustadas;
  - ~~respaldo, `respaldo-diario.sh` con `--link-dest` y restauración en volúmenes~~, también la receta del otro
    disco con `--user root`;
  - ~~`actualizar.sh` y `--volver`~~ (también con el respaldo borrado del volumen, desde `.version-anterior/`),
    ~~el script remoto de `deploy.mjs`~~ en un «servidor» Linux simulado, lock compartido y ~~URL `https://`~~;
  - ~~límites~~: 5 PDF + 3 xlsx grandes a la vez, pico 1027 MiB de 1536, sin OOM;
  - ~~apagado brusco (`kill -9` con 6 emisiones)~~: base íntegra, números saltados (documentado);
    ~~lock huérfano~~: la primera acción espera hasta ~30 s;
  - ~~receta de importación~~ tal como está escrita.
  - Corregido: `/app/data` y `/app/respaldos` quedaban en 0755 (ahora 0700 en la imagen y en `iniciar.sh`), el error
    de `actualizar.sh` con URL nombraba la copia temporal, y el aviso de npm ensuciaba `docker compose logs`.
  - Para vigilar: Chromium 155 de Debian frente al 153 de Playwright; Next no cierra ordenado con SIGTERM.
  - No verificable aquí: la falla de permisos sin root (virtiofs de Colima la oculta), el proxy real y un deploy
    por SSH (sección 8).
- **Android Studio**, para el emulador: sin instalar (~10 GB, requiere confirmar).
- **Credenciales de Starken QA:** no disponibles.
- **Modelo guardado en Ajustes:** confirmarlo en la base local exige leer la tabla de ajustes.

## 8. Requiere el servidor, teléfonos o personas

- **En el servidor:**
  - instalar el cron de `respaldo-diario.sh` y observarlo una semana;
  - `actualizar.sh` y `--volver` reales;
  - una restauración real en Docker;
  - el healthcheck nuevo;
  - el primer `npm run deploy` observado con los commits del 14 de octubre, hasta `4e8d048` (lo corre el usuario);
  - la receta nueva de restaurar desde el otro disco (LEEME → Restaurar).
- **Proxy y servicios externos:**
  - túnel o proxy real, con `NELTUME_IP_HEADER` y `Content-Length`;
  - Starken en producción;
  - latencia de escritura en el VPS.
- **Con datos de producción:** migrar a v22 una copia de la base de producción y ensayar la vuelta atrás.
- **Teléfonos reales:** compartir el PDF, que no se descargue solo, 390 px, la guía y Avanzado.
- **Personas:**
  - aceptación de Paula y Paulette con el guion del README y la guía;
  - confirmar en el PC de la oficina;
  - observar las líneas `[asistente]` en producción dos semanas;
  - comparar el costo estimado de la IA con el cobro real de CommandCode.

## 9. Decisiones pendientes

**De Neltume** (el código aplica hoy el valor entre paréntesis):

1. Ganancia de los marcos sólidos en Mara o Raulí (25 %, como accesorios; Oregón 85 %, Lenga 55 %).
2. Medida de vano: conversión a hoja o aviso (hoy se cotiza tal cual).
3. Descuento general máximo (50 %).
4. Anular después del despacho o la factura (bloqueado).
5. Número manual (solo administradoras, salto de hasta 1.000).
6. Roles (todas administradoras, con «Avanzado»). Importar la planilla y desactivar cuentas siguen fuera de «Avanzado».
7. Rebaje de puerta (menos de 5 cm).
8. Neto de Starken (total ÷ 1,19 redondeado).
9. Formato de la descripción del catálogo («0,6» o «0,60»), que define el defecto 6.
10. Precio de venta de las enchapadas frente a la columna de venta de su planilla.

**Del equipo:**

- ~~¿Mandan los alias del archivo o los editados en pantalla? (defecto 7)~~ El código hace mandar los de pantalla (`8152198`); falta solo confirmarlo.
- ~~¿Se acepta el salto de número por una doble emisión, o se evita? (defecto 1)~~ Se evita (`6c7a158`).
- ¿Deshacer también las ediciones directas de cliente, descuento, flete y ganancia, o solo los ítems?
- ¿Llevar Eliminar, Anular y Copiar fuera de «Más acciones», y Deshacer y «Agregar flete» fuera de «Editar» en móvil?
- ¿Reescribir el historial de Git para quitar la transcripción?
- ¿Endurecer la política de contraseñas y cerrar la sesión por inactividad?

## 10. Mantenibilidad

Cerrado en la fase 9 (commit de refactor), salvo lo indicado:

- ~~`servicio.ts` de 2.913 líneas~~: queda en 1.755, con `acciones.ts` (tipos de la API), `edicion.ts` (`aplicarCambiosItems`, `aplicarFlete`, `aplicarDespacho`, `textoActividad`) y `chat.ts` (`procesarChat`).
  - ~~«reemplazar serie» duplicado~~: `reemplazarSerie`.
  - ~~`pagado = reduce(...)` cuatro veces~~: `totalPagado` de `estado.ts`.
  - ~~`recalcular` muta `solicitudes`~~: `calcular(q)` es puro y `recalcular` devuelve las solicitudes normalizadas.
- **Reglas duplicadas:**
  - ~~pasos anteriores de la operación~~: `PASO_ANTERIOR` en `estado.ts`, usado por servidor y pantalla.
  - ~~familia del ítem (defecto 10)~~ (`8152198`).
  - ~~`leerMetros` frente a `leerMedida`~~ (`8152198`).
  - ~~rango del precio duplicado~~ (`6c7a158`, `rangoPrecio`).
  - ~~topes 0,3/3/6 a mano~~ y ~~texto del rango en tres lugares~~ (`8152198`).
  - ~~`LOCK_VIGENTE_MS` frente a `stale: 30000`~~: `LOCK_ESTADO_VIGENTE_MS` en `almacen.ts`.
  - ~~`sed` sobre «Respaldo en…»~~: `npm run respaldar -- --json`; los scripts conservan la lectura del texto mientras haya contenedores viejos.
- **Exports y datos sin uso:**
  - ~~exports sin uso~~: unos 8 borrados y unos 70 dejaron de exportarse; quedan exportados solo los que usan las pruebas.
  - ~~`catalogo_anterior.version`~~: ya no se escribe (la columna queda, sin migración).
  - ~~`medida_implausible` sin `familia`~~ (`8152198`).
- **Pantalla y estilos:**
  - ~~`ContextoDocumentos`~~: props.
  - ~~estilo en línea en `campo-editable.tsx`~~: clase `con-sugerencias`.
  - ~~tres formateadores de pesos~~: `pesos` de `precios.ts`.
  - ~~observación de 500 o 1000~~: `LARGO_OBSERVACION_ITEM = 1000` en todas partes.
  - `tactil.css`: se quitaron reglas redundantes. Se conserva el `!important` de 16 px y 44 px en campos, porque hay selectores con clase que los bajarían (zoom en iOS y blancos chicos); queda documentado en la hoja. Los dos `color: var(--warm-text) !important` de `cotizacion.css` siguen pendientes de una revisión visual.
- **Repositorio:** siete ramas ya fusionadas sin borrar. **Pendiente de tu confirmación.**

## 11. Excluido por alcance

Según [implementacion-fiabilidad.md](implementacion-fiabilidad.md), no se hará salvo que cambie el alcance:

- devoluciones y anulación parcial de pagos;
- copias externas;
- alertas externas;
- favoritos y plantillas;
- precios masivos;
- 2FA;
- deshacer completo del chat;
- rol de solo lectura.
