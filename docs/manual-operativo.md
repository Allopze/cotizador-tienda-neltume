# Manual operativo del cotizador Neltume

Este manual es para quien usa y cuida el cotizador en el día a día: las vendedoras (punto 10, «Trabajo
diario») y la administradora (entrar, cuentas, clave de IA, Starken, respaldos y actualizaciones). No hace falta
saber programar. Donde aparece un comando, se escribe en la terminal del servidor, dentro de la carpeta de
instalación, que es `/srv/cotizador-neltume` (la misma a la que sube las versiones nuevas quien desarrolla). Los
detalles técnicos están en `docker/LEEME.md`.

## 1. Entrar

1. Abre la dirección del cotizador en el navegador (por ejemplo `https://cotizador.tudominio.cl`).
2. Escribe tu correo y tu contraseña y pulsa **Ingresar**.
3. Para cambiar tu contraseña: **Ajustes → Mi cuenta**.

La sesión dura 12 horas. Si se cierra mientras trabajabas, vuelve a entrar: el borrador se conserva.
Después de varios intentos fallidos el ingreso se bloquea unos minutos; espera y vuelve a intentar.

### Tus sesiones abiertas

En **Ajustes → Mi cuenta → Sesiones abiertas** ves en qué equipos y navegadores está abierta tu cuenta, con la
fecha en que entraste y cuándo vence. **Cerrar sesión** cierra la de un equipo (por ejemplo, el computador de la
oficina que olvidaste cerrar) y **Cerrar las demás** cierra todas menos la que estás usando. Si ves un equipo que no
reconoces, ciérralo y cambia tu contraseña.

### La primera vez

Si el cotizador todavía no tiene ninguna cuenta, la página de entrada dice **«Crear la primera cuenta»** y pide
un **código de un solo uso**. Ese código lo ve solo quien administra el servidor:

```sh
docker compose logs cotizador | grep -A2 "Código de un solo uso"
```

Usa el último código que aparezca. Vence en 24 horas; si venció o no funciona, recarga la página de entrada y
vuelve a mirar: habrá uno nuevo. Completa el código, tu nombre, correo y contraseña. Quedas dentro con una
cuenta administradora.

## 2. Cuentas

Todo se hace en **Ajustes → Usuarios** (solo lo ven las cuentas administradoras).

- **Crear una cuenta:** «Crear cuenta», con nombre, correo y una contraseña inicial (mínimo 8 caracteres).
  Entrégale la contraseña a la persona por un canal privado; ella la cambia en **Ajustes → Mi cuenta**.
- **Desactivar una cuenta** (por ejemplo, alguien deja la empresa): botón **Desactivar**. Se cierran sus
  sesiones y no puede volver a entrar; sus cotizaciones se conservan. **Activar** la habilita de nuevo.
  Nadie puede desactivar su propia cuenta ni la última administradora activa.
- **Editar** cambia el nombre o el correo. Para cambiar el correo o restablecer la contraseña de una cuenta, el
  cotizador pide **tu propia contraseña** (la de quien hace el cambio): así nadie puede tomar otra cuenta desde un
  computador que quedó abierto.
- **Registro de cambios:** al final de la página se ven los últimos 50 movimientos de cuentas: quién creó,
  editó, desactivó, activó o restableció la contraseña de qué cuenta, y también cada **inicio de sesión**, correcto
  o fallido, con el equipo y la IP (nunca la contraseña). Muchos fallidos seguidos en una cuenta pueden ser alguien
  probando contraseñas: avisa a quien administra el servidor.
- Una cuenta desactivada que intenta entrar ve el mismo mensaje que con una contraseña incorrecta.

### Regla: siempre dos administradoras

Mantén **siempre al menos dos cuentas administradoras activas**. Si una persona olvida su contraseña, la otra
la restablece en un minuto. Con una sola, recuperar el acceso exige la terminal del servidor. La página de
Usuarios avisa cuando queda una sola.

### Recuperar una contraseña olvidada

- **Hay otra administradora:** ella entra a **Ajustes → Usuarios**, pulsa **Restablecer clave** en la cuenta
  de quien la olvidó, escribe una contraseña nueva dos veces y la entrega por un canal privado. Se cierran las
  sesiones abiertas de esa cuenta.
- **Era la única administradora:** en la terminal del servidor, estas tres líneas (pide la contraseña nueva sin
  mostrarla en pantalla):

  ```sh
  cd /srv/cotizador-neltume
  docker compose exec cotizador npm run usuarios -- restablecer-clave persona@tudominio.cl
  # escribe la contraseña nueva cuando la pida y pulsa Enter
  ```

  Luego entra y crea una segunda administradora.

### Correlativos de notas de pedido

Cada ítem de la cotización va a una fábrica, **Panguipulli** o **Santiago**, y la elige quien cotiza (no hay una por
omisión): en el seguimiento con «Repartir entre fábricas», al generar las notas o pidiéndoselo al asistente («las
Coz Coz van a Santiago»). Al generar, sale una nota de pedido por fábrica, cada una solo con sus ítems; sin fábrica en
algún ítem no se genera ninguna. Cada fábrica marca por separado el inicio y el término de su producción, y el pedido
pasa a despacho cuando terminan todas. Cada fábrica tiene su propio correlativo, que parte en la numeración que traía
en papel: **N° 577** Panguipulli y **N° 59** Santiago (se fijó solo, una vez, al actualizar a la versión de las dos
fábricas). Para ver el próximo número de cada fábrica, cambiarlo o asignar la fábrica a una nota generada antes de
separarlas:

```sh
cd /srv/cotizador-neltume
docker compose exec cotizador npm run notas
docker compose exec cotizador npm run notas -- correlativo panguipulli 600   # la próxima será la N° 600
docker compose exec cotizador npm run notas -- asignar 12 santiago           # la nota N° 12 antigua fue a Santiago
```

El correlativo no puede bajar al último número ya usado por esa fábrica.

Para corregir el número de una cotización ya emitida o de una nota de pedido, una cuenta administradora usa
«Cambiar N°» junto a su PDF (o se lo pide al asistente, que lo propone y pide confirmarlo). El número nuevo debe estar
libre en su serie y no saltar más de 1.000 sobre el último; uno mayor que el último mueve el correlativo. El PDF se
vuelve a generar con el número nuevo (al cambiar el de la cotización, también los de sus notas, que la nombran), el
anterior se borra y el cambio queda en la actividad.

## 3. Clave de IA

El asistente del chat usa CommandCode. En **Ajustes → Asistente**:

- **Guardar clave:** pega la clave API y guárdala. Se guarda cifrada y nunca se vuelve a mostrar.
- **Quitar clave:** el asistente deja de responder; el resto del cotizador sigue funcionando.
- El modelo recomendado es el que viene por omisión (DeepSeek V4.1 Flash, el que se evaluó). Cambiarlo puede
  bajar la precisión; **Probar modelo** consume cuota y pide confirmación.

Si el cotizador dice que la clave «ya no se puede leer», es porque cambió el secreto del servidor: vuelve a
pegar la clave en Ajustes.

**¿Qué modelo respondió?** En **Ajustes → Asistente → Avanzado**, «Última respuesta del chat» dice qué modelo
contestó el último mensaje que enviaste desde esa pestaña, si fue el **modelo de respaldo** y cuánto tardó. Si
responde una y otra vez el respaldo, el modelo principal está fallando (sin saldo, caído o retirado): usa **Probar
modelo** o avisa a quien desarrolla. No muestra el texto de la conversación.

## 4. Starken

- Las credenciales de Starken (dirección del servicio, RUT, clave y cuenta) van en el archivo `.env` del
  servidor; las entrega Starken. Después de cambiarlas: `docker compose up -d`.
- En **Ajustes → Starken** se elige la ciudad de origen y, si se midieron, el peso y el grosor de cada
  familia. Si se dejan vacíos, el cotizador los estima.
- Sin configuración, el botón **Cotizar con Starken** aparece desactivado; el valor del despacho se puede
  escribir a mano igual.

## 5. Respaldo

Un respaldo es una copia de la base (cotizaciones, clientes, cuentas, ajustes), los PDF emitidos y las
referencias que suben los clientes.

- **Automático:** si se instaló el cron (ver `docker/LEEME.md`, «Respaldo diario y limpieza»), cada noche se
  hace un respaldo, se limpia lo que ya no se usa (borradores vacíos abandonados, papelera vieja, archivos sin
  uso, copias «ANULADA» antiguas, auditoría de cuentas de más de un año) y se copia a otro disco. En el otro disco,
  los PDF que no cambiaron se enlazan con la copia del día anterior en vez de duplicarse.
- **A mano:**

  ```sh
  docker compose exec cotizador npm run respaldar
  ```

- Se conservan los últimos 30. Para saber cuándo fue el último, mira el estado (punto 8).
- **Sin el cron, nada se limpia solo:** la papelera del Historial dice que guarda los borradores 30 días, pero
  quien los borra pasado ese plazo es la tarea nocturna. Si no está instalada, límpiala a mano de vez en cuando:
  `docker compose exec cotizador npm run limpiar-borradores -- --confirmar`.
- **Los respaldos son confidenciales:** contienen sesiones abiertas y la clave de IA cifrada. No los copies a
  carpetas compartidas ni los envíes por correo.

## 6. Restaurar un respaldo

Úsalo si la base se dañó o se perdió información. **Se pierden los cambios hechos después del respaldo** (no
se borran: quedan apartados para poder deshacer).

```sh
cd /srv/cotizador-neltume
docker compose stop
docker compose run --rm cotizador npm run restaurar -- /app/respaldos/cotizador-<fecha>
docker compose up -d
```

Reemplaza `<fecha>` por la del respaldo elegido; para ver los disponibles:
`docker compose run --rm cotizador ls /app/respaldos`. El comando revisa que la copia esté sana antes de tocar
nada y se niega si el cotizador sigue encendido. Al terminar dice dónde quedó lo anterior; bórralo cuando
compruebes que todo está bien.

Una vez cada tres meses conviene probar que un respaldo sirve (en un servidor de prueba): restaurarlo, entrar,
abrir una cotización emitida y descargar su PDF.

## 7. Actualizar a una versión nueva

Quien desarrolla entrega un archivo `neltume-cotizador-<fecha>.zip`. Cópialo al servidor y ejecuta:

```sh
sh /srv/cotizador-neltume/scripts/actualizar.sh /ruta/neltume-cotizador-<fecha>.zip
```

Si en vez del archivo te envían un enlace de descarga directa que empieza con `https://`, puedes pasar el enlace
y el script lo descarga solo:

```sh
sh /srv/cotizador-neltume/scripts/actualizar.sh https://descargas.tudominio.cl/neltume-cotizador-<fecha>.zip
```

El script respalda primero, conserva la configuración (`.env`) y los respaldos, guarda la versión actual (con una
copia de ese respaldo) para poder volver, instala la versión nueva y espera a que el cotizador responda bien. Si
algo falla:

- **No se pudo construir:** el cotizador sigue con la versión anterior, sin cambios. Avisa a quien desarrolla.
- **La versión nueva no pasó el chequeo:** vuelve a la anterior con

  ```sh
  sh /srv/cotizador-neltume/scripts/actualizar.sh --volver
  ```

  y escribe `VOLVER` cuando lo pida. Restaura los datos del respaldo tomado justo antes de actualizar (funciona
  aunque hayan pasado más de 30 días: la actualización guardó su propia copia).

## 8. Ver el estado

- Con una cuenta administradora, abre `https://cotizador.tudominio.cl/api/salud` en el navegador. Muestra
  `"ok": true` si todo lo esencial funciona y, para cada parte, `"estado"`: `ok`, `aviso` (pide atención, pero
  se puede seguir trabajando) o `error` (algo esencial falla). Revisa ahí el espacio libre en disco, si Chromium
  (el que genera los PDF) arranca, si la clave de IA está guardada y se puede leer, si Starken está configurado, la
  última sincronización de feriados y la fecha del último respaldo. De la IA solo se revisa que la clave se pueda
  leer, sin llamarla: si el asistente no responde aunque aquí diga `ok`, la clave puede estar vencida o sin saldo
  (guárdala de nuevo en Ajustes → Asistente).
- En el servidor: `docker compose ps` (debe decir `healthy`) y `docker compose logs --tail=100 cotizador`.

## 9. Si pasa X, haz Y

| Si pasa…                                                            | Haz…                                                                                                                                                                                            |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alguien olvidó su contraseña                                        | Otra administradora: Ajustes → Usuarios → Restablecer clave. Si no hay otra, las tres líneas del punto 2.                                                                                       |
| Alguien deja la empresa                                             | Ajustes → Usuarios → Desactivar su cuenta. Sus cotizaciones se conservan.                                                                                                                       |
| Queda una sola administradora                                       | Crea otra ahora mismo en Ajustes → Usuarios.                                                                                                                                                    |
| «Demasiados intentos» al entrar                                     | Espera 15 minutos y vuelve a intentar con cuidado. Si se repite sin motivo, avisa a quien administra el servidor (puede ser el proxy, ver LEEME).                                               |
| El asistente no responde o dice que falta la clave                  | Ajustes → Asistente: guarda la clave de nuevo. Mientras tanto se puede cotizar a mano.                                                                                                          |
| «La clave de IA ya no se puede leer»                                | Ajustes → Asistente: pega otra vez la clave API.                                                                                                                                                |
| El botón de Starken está desactivado                                | Revisa las credenciales de Starken en `.env` y la ciudad de origen en Ajustes → Starken; mientras, escribe el despacho a mano.                                                                  |
| No se genera el PDF                                                 | Reintenta en un minuto. Si sigue, mira `/api/salud` (Chromium) y `docker compose logs --tail=100 cotizador`, y avisa a quien desarrolla.                                                        |
| `/api/salud` dice poco espacio en disco                             | Borra respaldos antiguos de otros discos o carpetas `antes-de-restaurar-…` ya revisadas; si sigue, amplía el disco.                                                                             |
| `/api/salud` dice que el último respaldo es antiguo                 | Revisa el cron y su registro (`$HOME/neltume-respaldo.log`); mientras, respalda a mano (punto 5).                                                                                               |
| El sitio no abre                                                    | En el servidor: `docker compose ps` y `docker compose logs --tail=100 cotizador`. Si el registro dice «No se inicia el cotizador», corrige `.env` como indica y ejecuta `docker compose up -d`. |
| Se borró o dañó información                                         | No sigas trabajando; restaura el último respaldo bueno (punto 6).                                                                                                                               |
| Una actualización dejó algo funcionando mal                         | `sh scripts/actualizar.sh --volver` (punto 7) y avisa a quien desarrolla.                                                                                                                       |
| El cotizador no tiene cuentas (instalación nueva)                   | Crea la primera con el código del registro del servidor (punto 1).                                                                                                                              |
| «Ya se está generando el PDF de esta cotización»                    | Otra pestaña o un doble toque ya la está emitiendo. Espera unos segundos y recarga: el número no se gastó dos veces.                                                                            |
| «Anular» aparece gris                                               | La cotización ya está despachada, completada o facturada. Pasa el cursor (o toca) para ver el motivo. Para anular una facturada, primero vuelve la facturación a pendiente.                     |
| El catálogo importado quedó mal                                     | Catálogo → Importar → **Volver a la planilla anterior** (funciona mientras nadie cambie el catálogo después).                                                                                   |
| «El archivo está protegido con contraseña» o «Excel antiguo (.xls)» | Abre la planilla en Excel, quítale la contraseña de apertura o guárdala como `.xlsx`, y vuelve a importarla.                                                                                    |
| Un equipo desconocido en Mi cuenta → Sesiones abiertas              | Ciérralo con **Cerrar sesión** y cambia tu contraseña.                                                                                                                                          |
| Muchos inicios de sesión fallidos en el registro                    | Puede ser alguien probando contraseñas: cambia la de esa cuenta y avisa a quien administra el servidor.                                                                                         |

## 10. Trabajo diario: lo que conviene saber

Esto es para las vendedoras y la administradora. La guía **«Cómo funciona»** (menú de tu cuenta → Cómo
funciona) explica el recorrido completo de una cotización; aquí van las reglas que más sorprenden.

### Emitir y anular

- **Una emisión a la vez.** Mientras se genera el PDF de una cotización (o su nota de pedido), un segundo «Emitir»
  de la misma cotización, desde otra pestaña o por un doble toque, responde «Ya se está generando…» y no gasta otro
  número. Espera unos segundos y recarga.
- **Número manual** (solo administradoras): el diálogo muestra el último número usado y el máximo que se puede
  elegir (hasta 1.000 por encima).
- **Anular tiene límites.** Una cotización despachada, completada o facturada ya no se puede anular: el botón
  aparece desactivado y dice por qué. Si tiene pagos, el diálogo avisa cuánto se pagó: **anular no devuelve el
  dinero**, solo deja anotado el monto en la actividad.
- **Deshacer aprobación** devuelve una aprobada a «Emitida» solo si todavía no tiene nota de pedido, pagos ni
  factura. **Volver al paso anterior** retrocede un paso de la operación y pide un motivo.

### Pagos y facturas

- La fecha de un pago o de una factura va **desde el día de la aprobación hasta hoy** (hora de Chile). El
  calendario no deja elegir otra. Si no eliges fecha, queda la de hoy.

### Avisos que no bloquean

- **Precio bajo el costo:** si escribes un precio menor que el costo de fábrica, el cotizador lo acepta pero avisa
  «queda bajo el costo de fábrica» y lo anota en la actividad. Revisa que sea a propósito.
- **Medida de vano:** si pides una puerta «en vano» y el ancho cae justo al inicio de un tramo del catálogo, el
  cotizador avisa que la hoja real (más angosta que el vano) probablemente es del tramo anterior, más barato.
  Se cobra lo pedido; tú decides si corregir la medida.
- **Ancho y alto al revés:** «Molco de 210 x 80» queda pendiente y ofrece **Intercambiar** las medidas.

### Historial, clientes y papelera

- **Filtros:** además de los estados, «Vencen pronto» y «Con saldo pendiente», el Historial filtra por
  **Seguimiento**, **Operación** y **Vendedora**.
- **Clientes:** el botón **Clientes** del Historial abre el directorio de clientes de todas las cotizaciones, con
  búsqueda por nombre o RUT y sus cotizaciones (cada una se abre con un toque).
- **Exportar a Excel (CSV):** un archivo admite 5.000 cotizaciones. Si el listado filtrado tiene más, el cotizador
  ofrece descargarlo **por partes** (parte 1, parte 2…) en vez de cortarlo; también puedes acotar las fechas.
- **Papelera:** un borrador eliminado queda en Historial → Papelera **30 días**; ahí se busca y se restaura con
  su despacho y su actividad. Pasado ese plazo se borra para siempre.

### Catálogo

- **Importar:** la vista previa separa los productos cuyo cambio es **solo la descripción** de los que cambian de
  precio. Una planilla con contraseña de apertura o un `.xls` antiguo se rechazan con un mensaje claro.
- **Volver a la planilla anterior:** tras importar, **Catálogo → Importar** ofrece volver atrás, también después de
  recargar la página, mientras nadie haya cambiado el catálogo.
- **Medidas en Agregar producto y Gestionar:** se escriben como en el detalle: «80 cm», «2100 mm», «3600 mm» o
  «3,6» (metros).
