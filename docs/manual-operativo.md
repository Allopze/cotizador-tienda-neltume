# Manual operativo del cotizador Neltume

Este manual es para quien cuida el cotizador en el día a día: entrar, manejar las cuentas, la clave de IA,
Starken, los respaldos y las actualizaciones. No hace falta saber programar. Donde aparece un comando, se
escribe en la terminal del servidor, dentro de la carpeta de instalación (por ejemplo `/opt/neltume-cotizador`
o `/srv/cotizador-neltume`). Los detalles técnicos están en `docker/LEEME.md`.

## 1. Entrar

1. Abre la dirección del cotizador en el navegador (por ejemplo `https://cotizador.tudominio.cl`).
2. Escribe tu correo y tu contraseña y pulsa **Ingresar**.
3. Para cambiar tu contraseña: **Ajustes → Mi cuenta**.

La sesión dura 12 horas. Si se cierra mientras trabajabas, vuelve a entrar: el borrador se conserva.
Después de varios intentos fallidos el ingreso se bloquea unos minutos; espera y vuelve a intentar.

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
- **Editar** cambia el nombre o el correo.
- **Registro de cambios:** al final de la página se ven los últimos 50 cambios de cuentas: quién creó,
  editó, desactivó, activó o restableció la contraseña de qué cuenta, y cuándo.

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
  cd /opt/neltume-cotizador
  docker compose exec cotizador npm run usuarios -- restablecer-clave persona@tudominio.cl
  # escribe la contraseña nueva cuando la pida y pulsa Enter
  ```

  Luego entra y crea una segunda administradora.

## 3. Clave de IA

El asistente del chat usa CommandCode. En **Ajustes → Asistente**:

- **Guardar clave:** pega la clave API y guárdala. Se guarda cifrada y nunca se vuelve a mostrar.
- **Quitar clave:** el asistente deja de responder; el resto del cotizador sigue funcionando.
- El modelo recomendado es el que viene por omisión (DeepSeek V4.1 Flash, el que se evaluó). Cambiarlo puede
  bajar la precisión; **Probar modelo** consume cuota y pide confirmación.

Si el cotizador dice que la clave «ya no se puede leer», es porque cambió el secreto del servidor: vuelve a
pegar la clave en Ajustes.

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
  hace un respaldo, se limpian borradores vacíos abandonados y archivos sin uso, y se copia a otro disco.
- **A mano:**

  ```sh
  docker compose exec cotizador npm run respaldar
  ```

- Se conservan los últimos 30. Para saber cuándo fue el último, mira el estado (punto 8).
- **Los respaldos son confidenciales:** contienen sesiones abiertas y la clave de IA cifrada. No los copies a
  carpetas compartidas ni los envíes por correo.

## 6. Restaurar un respaldo

Úsalo si la base se dañó o se perdió información. **Se pierden los cambios hechos después del respaldo** (no
se borran: quedan apartados para poder deshacer).

```sh
cd /opt/neltume-cotizador
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
sh /opt/neltume-cotizador/scripts/actualizar.sh /ruta/neltume-cotizador-<fecha>.zip
```

El script respalda primero, conserva la configuración (`.env`) y los respaldos, instala la versión nueva y
espera a que el cotizador responda bien. Si algo falla:

- **No se pudo construir:** el cotizador sigue con la versión anterior, sin cambios. Avisa a quien desarrolla.
- **La versión nueva no pasó el chequeo:** vuelve a la anterior con

  ```sh
  sh /opt/neltume-cotizador/scripts/actualizar.sh --volver
  ```

  y escribe `VOLVER` cuando lo pida. Restaura los datos del respaldo tomado justo antes de actualizar.

## 8. Ver el estado

- Con una cuenta administradora, abre `https://cotizador.tudominio.cl/api/salud` en el navegador. Muestra
  `"ok": true` si todo lo esencial funciona y, para cada parte, `"estado"`: `ok`, `aviso` (pide atención, pero
  se puede seguir trabajando) o `error` (algo esencial falla). Revisa ahí el espacio libre en disco, si la clave
  de IA funciona, la última sincronización de feriados y la fecha del último respaldo.
- En el servidor: `docker compose ps` (debe decir `healthy`) y `docker compose logs --tail=100 cotizador`.

## 9. Si pasa X, haz Y

| Si pasa…                                            | Haz…                                                                                                                                                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alguien olvidó su contraseña                        | Otra administradora: Ajustes → Usuarios → Restablecer clave. Si no hay otra, las tres líneas del punto 2.                                                                                       |
| Alguien deja la empresa                             | Ajustes → Usuarios → Desactivar su cuenta. Sus cotizaciones se conservan.                                                                                                                       |
| Queda una sola administradora                       | Crea otra ahora mismo en Ajustes → Usuarios.                                                                                                                                                    |
| «Demasiados intentos» al entrar                     | Espera 15 minutos y vuelve a intentar con cuidado. Si se repite sin motivo, avisa a quien administra el servidor (puede ser el proxy, ver LEEME).                                               |
| El asistente no responde o dice que falta la clave  | Ajustes → Asistente: guarda la clave de nuevo. Mientras tanto se puede cotizar a mano.                                                                                                          |
| «La clave de IA ya no se puede leer»                | Ajustes → Asistente: pega otra vez la clave API.                                                                                                                                                |
| El botón de Starken está desactivado                | Revisa las credenciales de Starken en `.env` y la ciudad de origen en Ajustes → Starken; mientras, escribe el despacho a mano.                                                                  |
| No se genera el PDF                                 | Reintenta en un minuto. Si sigue, mira `/api/salud` (Chromium) y `docker compose logs --tail=100 cotizador`, y avisa a quien desarrolla.                                                        |
| `/api/salud` dice poco espacio en disco             | Borra respaldos antiguos de otros discos o carpetas `antes-de-restaurar-…` ya revisadas; si sigue, amplía el disco.                                                                             |
| `/api/salud` dice que el último respaldo es antiguo | Revisa el cron y su registro (`$HOME/neltume-respaldo.log`); mientras, respalda a mano (punto 5).                                                                                               |
| El sitio no abre                                    | En el servidor: `docker compose ps` y `docker compose logs --tail=100 cotizador`. Si el registro dice «No se inicia el cotizador», corrige `.env` como indica y ejecuta `docker compose up -d`. |
| Se borró o dañó información                         | No sigas trabajando; restaura el último respaldo bueno (punto 6).                                                                                                                               |
| Una actualización dejó algo funcionando mal         | `sh scripts/actualizar.sh --volver` (punto 7) y avisa a quien desarrolla.                                                                                                                       |
| El cotizador no tiene cuentas (instalación nueva)   | Crea la primera con el código del registro del servidor (punto 1).                                                                                                                              |
