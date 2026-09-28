import type { NextRequest } from 'next/server';
import { hostPermitido } from '@/servidor/acceso';

// Las páginas también validan el Host (DNS rebinding); las rutas /api/* lo hacen en su handler.
export function proxy(request: NextRequest) {
  if (!hostPermitido(request.headers.get('host')))
    return new Response('Host no permitido.', {
      status: 403,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
}

export const config = {
  matcher: ['/((?!api/|_next/static/|_next/image|favicon.ico).*)'],
};
