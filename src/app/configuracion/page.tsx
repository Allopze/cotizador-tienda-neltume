import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/servidor/autenticacion';
import { validarConfiguracionAutenticacion } from '@/servidor/autenticacion-config';
import { Configuracion } from './configuracion';
import { SECCIONES, type Seccion } from './secciones';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Neltume · Catálogo y ajustes' };

export default async function ConfiguracionPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  validarConfiguracionAutenticacion();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/login');
  const pedida = (await searchParams).seccion;
  const seccion = SECCIONES.some((s) => s.id === pedida) ? (pedida as Seccion) : 'catalogo';
  return (
    <Configuracion
      email={session.user.email}
      nombre={session.user.name || session.user.email}
      seccion={seccion}
    />
  );
}
