// Proxy HTTPS local para la E2E contra el build de producción (playwright.prod.config.ts): `next start` exige
// BETTER_AUTH_URL con https, así que delante de cada servidor va este proxy con un certificado autofirmado para
// 127.0.0.1. Solo para pruebas en esta máquina; no se usa en el servidor.
//
// Uso: node scripts/proxy-tls-e2e.mjs <puerto https> <puerto destino> <directorio del certificado>
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { request as pedirHttp } from 'node:http';
import { createServer } from 'node:https';
import { join } from 'node:path';

const [puerto, destino, directorio] = process.argv.slice(2);
if (!puerto || !destino || !directorio) {
  console.error('Uso: node scripts/proxy-tls-e2e.mjs <puerto https> <puerto destino> <directorio del certificado>');
  process.exit(2);
}
mkdirSync(directorio, { recursive: true });
const clave = join(directorio, 'e2e-tls.key');
const certificado = join(directorio, 'e2e-tls.crt');
if (!existsSync(clave) || !existsSync(certificado))
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30', '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost', '-keyout', clave, '-out', certificado,
  ], { stdio: 'ignore' });

createServer({ key: readFileSync(clave), cert: readFileSync(certificado) }, (entrada, salida) => {
  const reenvio = pedirHttp(
    {
      host: '127.0.0.1',
      port: Number(destino),
      method: entrada.method,
      path: entrada.url,
      // El Host público se conserva (el filtro de Host y el origen de Better Auth lo comparan con BETTER_AUTH_URL).
      headers: { ...entrada.headers, 'x-forwarded-proto': 'https', 'x-forwarded-for': entrada.socket.remoteAddress ?? '' },
    },
    (respuesta) => {
      salida.writeHead(respuesta.statusCode ?? 502, respuesta.headers);
      respuesta.pipe(salida);
    },
  );
  reenvio.on('error', () => {
    if (!salida.headersSent) salida.writeHead(502, { 'content-type': 'text/plain' });
    salida.end('Proxy E2E: el servidor de destino no responde.');
  });
  entrada.pipe(reenvio);
}).listen(Number(puerto), '127.0.0.1', () => console.log(`Proxy TLS E2E: https://127.0.0.1:${puerto} → http://127.0.0.1:${destino}`));
