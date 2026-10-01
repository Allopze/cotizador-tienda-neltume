import type { NextConfig } from 'next';

const cabecerasSeguridad = [
  { key: 'X-Frame-Options', value: 'DENY' },
  // Solo frame-ancestors: una CSP completa exigiría nonces para los scripts de Next.
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  // Los navegadores ignoran HSTS sobre HTTP, así que en 127.0.0.1 no tiene efecto; aplica al túnel HTTPS.
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=15552000' }]
    : []),
];

const config: NextConfig = {
  // El servidor E2E puede convivir con el servidor de desarrollo sin compartir su lock ni caché.
  distDir: process.env.NELTUME_TEST_MODE === '1' ? '.next/e2e' : '.next',
  devIndicators: false,
  serverExternalPackages: ['playwright', 'proper-lockfile', 'better-sqlite3', 'better-auth'],
  outputFileTracingExcludes: { '/*': ['./datos-privados/**', './**/*.xlsx', './data/test-*/**'] },
  async headers() {
    return [{ source: '/:path*', headers: cabecerasSeguridad }];
  },
};
export default config;
