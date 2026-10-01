# Desplegar Neltume con Docker

Esta entrega instala la aplicación con **base vacía**. No incluye usuarios, catálogo importado,
cotizaciones, PDF, planillas privadas ni credenciales de tu equipo. Incluye el código, el lockfile,
Dockerfile, Compose y un `.env` con un secreto nuevo. Docker instala las dependencias y compila
Next.js en el servidor, para usar módulos nativos de SQLite compatibles con su arquitectura.

## Generar la entrega

En tu equipo, con las dependencias instaladas:

```sh
npm run deploy
```

El ZIP queda en `deploy/neltume-cotizador-<fecha>.zip`. Si ya conoces el dominio, puedes dejar
configurados el origen y los hosts permitidos desde aquí:

```sh
npm run deploy -- --url https://cotizador.tudominio.cl
```

No hace falta Docker en tu equipo. El ZIP incluye un secreto de sesión recién generado: trátalo
como configuración privada y conserva el `.env` del servidor en futuras actualizaciones.

## Primera instalación en el servidor

Necesitas Docker Engine con Docker Compose v2 y acceso a internet para descargar la imagen,
Chromium y las dependencias de npm. Usa una carpeta dedicada:

```sh
mkdir -p /opt/neltume-cotizador
cd /opt/neltume-cotizador
unzip /ruta/neltume-cotizador-<fecha>.zip
```

Si generaste la entrega sin `--url`, edita `.env` y completa estos dos valores:

```dotenv
BETTER_AUTH_URL=https://cotizador.tudominio.cl
NELTUME_HOSTS=cotizador.tudominio.cl
```

`BETTER_AUTH_SECRET` ya está generado; mantenlo estable. La clave de IA es opcional y se puede
guardar después desde Ajustes. Puedes completar también los datos de la empresa y Starken.
Si trabajas directamente desde el repositorio, copia `.env.example` a `.env` y genera el secreto
con `openssl rand -base64 32`.

Configura el proxy inverso HTTPS de tu servidor (por ejemplo, Nginx, Caddy o Cloudflare Tunnel)
para enviar ese dominio a `http://127.0.0.1:3000`, conservando el encabezado `Host` público.
La aplicación requiere HTTPS para el acceso en producción. Compose publica el puerto en
`127.0.0.1`; si tu proxy corre en otro contenedor, configura su red o la IP de publicación según
tu infraestructura. `NELTUME_PORT` permite cambiar el puerto del servidor si 3000 está ocupado.

Inicia la app:

```sh
docker compose up -d
docker compose logs -f cotizador
```

La primera ejecución construye la imagen y crea los esquemas de SQLite y autenticación.
El proceso corre como el usuario `node`, incluye Chromium para generar PDF y escucha en
`0.0.0.0:3000` dentro del contenedor. Los datos y respaldos quedan en volúmenes persistentes.

## Crear la primera cuenta y cargar el catálogo

Con el contenedor iniciado, crea la cuenta administradora; el comando pide la contraseña
en la terminal sin pasarla como argumento:

```sh
docker compose exec cotizador npm run usuarios -- crear admin@tudominio.cl Admin
```

Entra al dominio HTTPS con esa cuenta. Desde la configuración del catálogo puedes importar
las planillas oficiales; desde Ajustes puedes configurar la clave de IA y crear otras cuentas.
Hasta importar el catálogo no habrá productos para cotizar.

Para importar por terminal, copia la planilla temporalmente al contenedor:

```sh
docker compose cp /ruta/COTIZADOR_2026.xlsx cotizador:/tmp/COTIZADOR_2026.xlsx
docker compose exec cotizador npm run importar -- /tmp/COTIZADOR_2026.xlsx
docker compose exec cotizador rm /tmp/COTIZADOR_2026.xlsx
```

## Actualizar

Genera y sube un ZIP nuevo. Extrae su contenido en una carpeta temporal y copia el código sobre
la instalación **sin reemplazar el `.env` del servidor**. El ZIP trae otro secreto, que cambiaría
las sesiones y el cifrado de la clave de IA si sobrescribes la configuración anterior.

Por ejemplo, desde `/opt/neltume-cotizador`, teniendo `unzip` y `rsync` instalados:

```sh
unzip /ruta/neltume-cotizador-<fecha>.zip -d /tmp/neltume-actualizacion
rsync -a --exclude='.env' /tmp/neltume-actualizacion/ ./
docker compose up -d --build
rm -r /tmp/neltume-actualizacion
```

Usa una carpeta temporal vacía para cada entrega. Conserva `name: neltume-cotizador` en Compose
para reutilizar los mismos volúmenes. El arranque aplica las migraciones antes de servir la app.
Los volúmenes sobreviven a la reconstrucción y a `docker compose down`; **`down -v` los elimina**.

## Estado y respaldos

```sh
docker compose ps
docker compose logs --tail=100 cotizador
docker compose exec cotizador npm run respaldar
docker compose cp cotizador:/app/respaldos ./respaldos-servidor
```

El chequeo de salud consulta `/login`, por lo que también detecta errores de configuración de
autenticación. Copia los respaldos a otro disco o almacenamiento externo: el volumen de
respaldos está inicialmente en el mismo servidor que los datos.

Referencias: [servicios de Compose](https://docs.docker.com/reference/compose-file/services/),
[volúmenes](https://docs.docker.com/reference/compose-file/volumes/) y
[construcción por etapas](https://docs.docker.com/build/building/multi-stage/).
