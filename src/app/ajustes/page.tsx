import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/servidor/autenticacion';
import { validarConfiguracionAutenticacion } from '@/servidor/autenticacion-config';
import { PantallaAjustes } from './pantalla-ajustes';
import { seccionesVisibles, type SeccionAjustes } from './secciones';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Neltume · Ajustes' };

export default async function AjustesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  validarConfiguracionAutenticacion();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/login');
  const rol = (session.user as typeof session.user & { role?: string | null }).role ?? 'user';
  const admin = rol === 'admin';
  const pedida = (await searchParams).seccion;
  const seccion: SeccionAjustes = seccionesVisibles(admin).find((s) => s.id === pedida)?.id ?? 'cuenta';
  return (
    <PantallaAjustes
      email={session.user.email}
      nombre={session.user.name || session.user.email}
      seccion={seccion}
      puedeCrearUsuarios={admin}
    />
  );
}
