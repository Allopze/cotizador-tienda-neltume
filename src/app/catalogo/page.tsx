import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/servidor/autenticacion';
import { validarConfiguracionAutenticacion } from '@/servidor/autenticacion-config';
import { PantallaCatalogo } from './pantalla-catalogo';
import { SECCIONES, type Seccion } from './secciones';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Neltume · Catálogo' };

export default async function CatalogoPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  validarConfiguracionAutenticacion();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/login');
  const pedida = (await searchParams).seccion;
  const rol = (session.user as typeof session.user & { role?: string | null }).role ?? 'user';
  const puedeAdministrar = rol === 'admin';
  const administrable = new Set<Seccion>(['manuales', 'configuracion', 'importar']);
  const seccion = SECCIONES.some((s) => s.id === pedida) && (puedeAdministrar || !administrable.has(pedida as Seccion))
    ? (pedida as Seccion)
    : 'consultar';
  return (
    <PantallaCatalogo
      email={session.user.email}
      nombre={session.user.name || session.user.email}
      seccion={seccion}
      puedeAdministrar={puedeAdministrar}
    />
  );
}
