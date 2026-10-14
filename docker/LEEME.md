# Desplegar Neltume con Docker

Esta entrega instala la aplicación con **base vacía**. No incluye usuarios, catálogo importado,
cotizaciones, PDF, planillas privadas ni credenciales de tu equipo. Incluye el código, el lockfile,
Dockerfile, Compose, los scripts del servidor y un `.env` con un secreto nuevo. Docker instala las
dependencias y compila Next.js en el servidor, para usar módulos nativos de SQLite compatibles con su
arquitectura. El manual para el uso diario está en `docs/manual-operativo.md`.

Resumen de comandos en el servidor (desde la carpeta de instalación):

| Para…                        | Comando                                                             |
| ---------------------------- | ------------------------------------------------------------------- |
| Ver el estado                | `docker compose ps` y `docker compose logs --tail=100 cotizador`    |
| Actualizar con un ZIP nuevo  | `sh scripts/actualizar.sh /ruta/neltume-cotizador-<fecha>.zip`      |
| Volver a la versión anterior | `sh scripts/actualizar.sh --volver`                                 |
| Respaldar ahora              | `docker compose exec cotizador npm run respaldar`                   |
| Restaurar un respaldo        | ver [Restaurar](#restaurar)                                         |
| Ver el código de primer uso  | `docker compose logs cotizador \| grep -A2 "Código de un solo uso"` |

## Verificar y desplegar son pasos separados

En el equipo de desarrollo (o en CI), `npm run verificar` corre los tipos, el lint, `npm test` (Vitest y
Playwright, con la planilla privada) y `npm run evaluar:regresion`, que evalúa la IA con el modelo de
Ajustes de la base local, cada caso tres veces (unos centavos de dólar y algunos minutos).
`npm run deploy` y `npm run deploy:zip` corren esa misma verificación antes de empaquetar; si algo falla,
no se sube nada.

- `--sin-ia` omite solo la evaluación de la IA (por ejemplo, si el proveedor no responde).
- `--sin-verificar` empaqueta o sube **sin verificar**: solo para una entrega que ya se verificó (por ejemplo,
  un parche urgente verificado en otro equipo). Avisa en pantalla que se omitió.
- `--solo-verificar` (lo que hace `npm run verificar`) verifica y no empaqueta.

El modelo evaluado es el de Ajustes **de la base local**: debe ser el mismo que el de producción para que la
evaluación pruebe lo que se va a usar.

## Despliegue directo por SSH

`npm run deploy` sube el código a `chome:/srv/cotizador-neltume` por SSH, respalda los datos si el cotizador
ya está corriendo, conserva el `.env` del servidor, sincroniza el resto y ejecuta
`docker compose up -d --build --wait`. La sincronización borra en el servidor lo que ya no existe en la
entrega, **salvo** `.env`, las carpetas `respaldos*`, `compose.override.yaml`, `cron/` y `.version-anterior/`
(lo mismo que conserva `scripts/actualizar.sh`). Requiere acceso SSH sin contraseña, y `unzip`, `rsync` y
Docker Compose en el servidor. Al final borra las imágenes viejas del cotizador. En el primer despliegue crea
el `.env` con un secreto nuevo y `NELTUME_PORT=3010`; si no pasaste `--url`, se detiene hasta que completes
`BETTER_AUTH_URL` y `NELTUME_HOSTS` en ese archivo.

### Guard de recursos

Antes de tocar nada, el despliegue toma un lock (un solo despliegue o actualización a la vez) y se cancela si
quedan menos de 5 GB libres en el disco de Docker, menos de 2 GB de RAM disponible o la carga supera el 80 %
de los núcleos. `npm run deploy -- --forzar` omite el chequeo, pero no el lock. Durante el build, Node queda
limitado a 2 GB de heap. En ejecución, el contenedor se limita a 1,5 CPU, 1536 MB de RAM sin swap extra y
512 procesos; ajústalo con `NELTUME_CPUS` y `NELTUME_MEMORIA` en el `.env` del servidor.

### Túnel de Cloudflare propio

Si el dominio está en una cuenta de Cloudflare distinta a la del túnel que ya corre en el servidor, Compose
incluye un servicio `tunel` opcional. Crea el túnel en la cuenta del dominio, agrega el hostname público con
servicio `http://cotizador:3000` y, en el `.env` del servidor:

```dotenv
COMPOSE_PROFILES=tunel
CLOUDFLARE_TUNNEL_TOKEN=<token del túnel>
```

## Generar la entrega como ZIP

En tu equipo, con las dependencias instaladas:

```sh
npm run deploy:zip
```

El ZIP queda en `deploy/neltume-cotizador-<fecha>.zip`. Si ya conoces el dominio, puedes dejar configurados
el origen y los hosts permitidos desde aquí:

```sh
npm run deploy:zip -- --url https://cotizador.tudominio.cl
```

No hace falta Docker en tu equipo. El ZIP incluye un secreto de sesión recién generado: trátalo como
configuración privada. Al actualizar, `scripts/actualizar.sh` conserva el `.env` del servidor y descarta el
del ZIP.

## Primera instalación en el servidor

Necesitas Docker Engine con Docker Compose v2, `unzip`, `rsync` y acceso a internet para descargar la imagen,
Chromium y las dependencias de npm. Usa una carpeta dedicada (la entrega por SSH usa `/srv/cotizador-neltume`;
cualquiera sirve, pero los comandos de esta guía suponen que estás dentro de ella):

```sh
sudo install -d -o "$(id -un)" -g "$(id -gn)" /opt/neltume-cotizador
cd /opt/neltume-cotizador
unzip /ruta/neltume-cotizador-<fecha>.zip
```

Si generaste la entrega sin `--url`, edita `.env` y completa estos dos valores:

```dotenv
BETTER_AUTH_URL=https://cotizador.tudominio.cl
NELTUME_HOSTS=cotizador.tudominio.cl
```

`BETTER_AUTH_SECRET` ya está generado; mantenlo estable (si cambia, se cierran las sesiones y hay que volver
a guardar la clave de IA). La clave de IA es opcional y se puede guardar después desde Ajustes. Puedes
completar también los datos de la empresa y Starken. Si trabajas directamente desde el repositorio, copia
`.env.example` a `.env` y genera el secreto con `openssl rand -base64 32`. En Docker el archivo se llama
`.env` (no `.env.local`).

Al iniciar, el contenedor **se niega a arrancar** con un mensaje claro en el registro si `BETTER_AUTH_SECRET`
falta o tiene menos de 32 caracteres, si `BETTER_AUTH_URL` no empieza con `https://` o si `NELTUME_IP_HEADER`
tiene un valor desconocido. Corrige `.env` y repite `docker compose up -d`.

### Proxy HTTPS e IP de cada persona

Configura el proxy inverso HTTPS de tu servidor (por ejemplo, Nginx, Caddy o Cloudflare Tunnel) para enviar
ese dominio a `http://127.0.0.1:<NELTUME_PORT>` (3000 por omisión; 3010 con `npm run deploy`), conservando el
encabezado `Host` público. La aplicación requiere HTTPS en producción. Compose publica el puerto en
`127.0.0.1`; si tu proxy corre en otro contenedor o equipo, ajusta `NELTUME_BIND_IP` o la red de Docker.

El límite de intentos de inicio de sesión se cuenta por IP, y la IP se toma **solo** de la cabecera que pone
tu proxy. Indícala en `.env` con `NELTUME_IP_HEADER`:

| Proxy                                   | `NELTUME_IP_HEADER`          | Configuración del proxy                    |
| --------------------------------------- | ---------------------------- | ------------------------------------------ |
| Cloudflare Tunnel o proxy de Cloudflare | `cf-connecting-ip` (omisión) | ninguna                                    |
| Nginx                                   | `x-real-ip`                  | `proxy_set_header X-Real-IP $remote_addr;` |
| Caddy (`reverse_proxy`)                 | `x-forwarded-for`            | ninguna (Caddy reemplaza la cabecera)      |
| Sin proxy de confianza                  | `ninguna`                    | —                                          |

Con una cabecera que el proxy no pone, cualquiera podría inventarla en cada intento y saltarse el límite por
IP. Con `ninguna` (o si el proxy no envía la cabecera elegida) todas las personas comparten **una sola
cubeta**: unos pocos intentos fallidos de cualquiera (5 cada 15 minutos) bloquean el inicio de sesión de todas
por un rato. El límite por correo (10 fallos en 15 minutos por cuenta) se aplica siempre.

Inicia la app:

```sh
docker compose up -d
docker compose logs -f cotizador
```

La primera ejecución construye la imagen y crea los esquemas de SQLite y autenticación. El proceso corre como
el usuario `node`, incluye Chromium para generar PDF y escucha en `0.0.0.0:3000` dentro del contenedor. Los
datos y respaldos quedan en volúmenes persistentes.

## Crear la primera cuenta

Mientras la base no tiene ninguna cuenta, la página de inicio de sesión muestra **«Crear la primera
cuenta»** y pide un código de un solo uso. El servidor lo escribe en su registro al iniciar; para verlo:

```sh
docker compose logs cotizador | grep -A2 "Código de un solo uso"
```

Usa el **último** código que aparezca (cada inicio del contenedor genera uno nuevo y anula el anterior). Vence
en 24 horas y se anula tras 10 intentos fallidos; en ambos casos, recarga la página de inicio de sesión y vuelve
a mirar el registro: habrá uno nuevo. En el disco solo queda su hash (`/app/data/primer-arranque.json`), que se
borra al crear la cuenta. Con al menos una cuenta, nada de esto existe: la ruta responde 404.

Crea enseguida una **segunda** cuenta administradora desde Ajustes → Usuarios: si alguien olvida su
contraseña, otra administradora la restablece sin terminal.

También se puede crear una cuenta por terminal (pide la contraseña sin mostrarla):

```sh
docker compose exec cotizador npm run usuarios -- crear admin@tudominio.cl Admin
```

### Rescate: la única administradora olvidó su contraseña

```sh
cd /opt/neltume-cotizador
docker compose exec cotizador npm run usuarios -- restablecer-clave persona@tudominio.cl
# escribe la contraseña nueva cuando la pida; se cierran sus sesiones abiertas
```

Si la cuenta está desactivada: `docker compose exec cotizador npm run usuarios -- activar persona@tudominio.cl`.
Cada cambio de cuentas, también los de la terminal, queda en Ajustes → Usuarios → Registro de cambios.

## Cargar el catálogo

Entra al dominio HTTPS con la cuenta creada. Desde la configuración del catálogo puedes importar las planillas
oficiales; desde Ajustes puedes configurar la clave de IA y crear otras cuentas. Hasta importar el catálogo no
habrá productos para cotizar.

Para importar por terminal, monta la planilla de solo lectura en un contenedor de un solo uso (se borra al
terminar y no deja copias de la planilla dentro del servicio):

```sh
cd /opt/neltume-cotizador
docker compose run --rm --no-deps -v /ruta/COTIZADOR_2026.xlsx:/planillas/COTIZADOR_2026.xlsx:ro \
  cotizador npm run importar -- /planillas/COTIZADOR_2026.xlsx
```

El archivo debe poder leerlo el usuario del contenedor (uid 1000): si no, `chmod a+r /ruta/COTIZADOR_2026.xlsx`.
La importación por terminal respeta los nombres y alias editados en **Catálogo → Nombres y alias**:
`config/catalogo.json` solo suma los modelos y maderas que la base todavía no tiene. El reporte queda en el volumen
de datos (`data/reporte-importacion.md`, o `data/reporte-importacion-enchapadas.md`), también cuando la importación
se rechaza; si la planilla trae menos del 90 % de los productos y la reducción es intencional, agrega `--forzar` al
final del comando.

## Actualizar

Copia el ZIP nuevo al servidor y, desde cualquier carpeta:

```sh
sh /opt/neltume-cotizador/scripts/actualizar.sh /ruta/neltume-cotizador-<fecha>.zip
```

El script:

1. revisa la entrega en una carpeta temporal;
2. respalda los datos con `npm run respaldar` dentro del contenedor (si falla, no actualiza nada);
3. guarda el código actual en `.version-anterior/`;
4. copia la versión nueva **sin tocar** `.env`, las carpetas `respaldos*`, `compose.override.yaml`, `cron/`
   ni `.version-anterior/` (el `.env` del ZIP trae otro secreto y se descarta);
5. construye la imagen; si no se puede, deja los archivos como estaban y sigue corriendo la versión anterior;
6. inicia la versión nueva y espera el chequeo de salud (`/api/salud`).

Si la versión nueva no pasa el chequeo, el script lo dice y muestra cómo volver:

```sh
sh /opt/neltume-cotizador/scripts/actualizar.sh --volver
```

`--volver` detiene el cotizador, restaura los datos del respaldo tomado justo antes de actualizar (los cambios
posteriores quedan apartados, no se borran), reinstala el código anterior y lo inicia. Pide escribir `VOLVER`
para confirmar; desde un script, agrega `--si`.

**Primera vez con este script:** si la instalación es anterior a `scripts/actualizar.sh`, sácalo del ZIP nuevo
e indícale la carpeta de instalación:

```sh
unzip -p /ruta/neltume-cotizador-<fecha>.zip scripts/actualizar.sh > /tmp/actualizar.sh
sh /tmp/actualizar.sh /ruta/neltume-cotizador-<fecha>.zip --dir /opt/neltume-cotizador
```

Conserva `name: neltume-cotizador` en Compose para reutilizar los mismos volúmenes. El arranque aplica las
migraciones antes de servir la app. Los volúmenes sobreviven a la reconstrucción y a `docker compose down`;
**`down -v` los elimina**.

## Respaldo diario y limpieza

`npm run respaldar` copia en caliente la base (verificada con `integrity_check`), los PDF emitidos, las
referencias del cliente y la configuración del catálogo al volumen `respaldos` (`/app/respaldos/cotizador-<fecha>/`)
y conserva los 30 más recientes. Ese volumen está en el **mismo disco** que los datos: copia cada respaldo a
otro disco del servidor, en una carpeta **fuera** de la instalación (lo que esté dentro se reemplaza al
actualizar).

`scripts/respaldo-diario.sh` hace las tres cosas: respalda, limpia (`npm run limpiar-borradores -- --confirmar`:
borradores vacíos abandonados, papelera de más de 30 días y referencias del cliente que ninguna cotización usa)
y copia el respaldo recién hecho a otro disco, donde conserva los 30 más recientes. Prepara la carpeta una vez:

```sh
sudo install -d -o "$(id -un)" -g "$(id -gn)" -m 700 /mnt/respaldos/neltume
```

y agrega el cron con `crontab -e`, con un usuario que pueda usar Docker (todos los días a las 21:30):

```cron
30 21 * * * sh /opt/neltume-cotizador/scripts/respaldo-diario.sh /mnt/respaldos/neltume >> "$HOME/neltume-respaldo.log" 2>&1
```

Lo mismo a mano, por partes:

```sh
cd /opt/neltume-cotizador
docker compose exec -T cotizador npm run respaldar
docker compose exec -T cotizador npm run limpiar-borradores -- --confirmar
docker compose cp cotizador:/app/respaldos/cotizador-<fecha> /mnt/respaldos/neltume/
```

Si prefieres scripts de cron propios, guárdalos en `cron/` dentro de la instalación: las actualizaciones no
tocan esa carpeta. Revisa el registro (`$HOME/neltume-respaldo.log`) la primera semana, y `/api/salud`
(abajo) avisa si el último respaldo tiene más de dos días.

**Los respaldos son confidenciales:** incluyen las sesiones vigentes y la clave de IA cifrada. Guárdalos con
permisos restringidos (`700`) y fuera de carpetas compartidas.

## Restaurar

Restaura siempre una carpeta completa `cotizador-<fecha>`: base, PDF y referencias del mismo respaldo.

```sh
cd /opt/neltume-cotizador
docker compose stop
docker compose run --rm cotizador npm run restaurar -- /app/respaldos/cotizador-<fecha>
docker compose up -d
```

`npm run restaurar` se niega a trabajar si el cotizador sigue corriendo (base en uso o un guardado en curso),
verifica la copia con `integrity_check` antes de tocar nada, borra los `-wal`/`-shm` de la base anterior y
deja lo que había en `/app/data/antes-de-restaurar-<fecha>/` para poder deshacer (bórralo cuando compruebes que
todo está bien). Si algo falla a mitad de camino, devuelve los datos a como estaban.

Para restaurar un respaldo que está en el otro disco, cópialo primero al volumen:

```sh
docker compose stop
docker compose run --rm -v /mnt/respaldos/neltume:/respaldo-externo:ro cotizador \
  npm run restaurar -- /respaldo-externo/cotizador-<fecha>
docker compose up -d
```

En Docker, la configuración del catálogo vive en la base (Ajustes); el archivo `config/catalogo.json` que el
respaldo trae se restaura solo dentro del contenedor temporal y no hace falta.

**Prueba trimestral:** en un servidor de prueba (o con otro `name:` en Compose), restaura el último respaldo,
entra, abre una cotización emitida y descarga su PDF. Si funciona, el respaldo sirve.

## Estado del sistema

```sh
docker compose ps
docker compose logs --tail=100 cotizador
```

`/api/salud` es el chequeo de salud de Compose. Sin sesión responde solo `{"ok": true}` (200) o
`{"ok": false}` (503): la base abre con el esquema esperado, la configuración de inicio de sesión es válida,
quedan más de 256 MB libres en el disco de datos y Chromium está instalado. Con sesión de administradora,
abriendo `https://cotizador.tudominio.cl/api/salud` en el navegador, muestra además cada comprobación: versión
del esquema, espacio libre, Chromium, si la clave de IA está configurada y se puede leer, la última
sincronización de feriados y la fecha del último respaldo. Nunca muestra secretos.

Referencias: [servicios de Compose](https://docs.docker.com/reference/compose-file/services/),
[volúmenes](https://docs.docker.com/reference/compose-file/volumes/) y
[construcción por etapas](https://docs.docker.com/build/building/multi-stage/).
