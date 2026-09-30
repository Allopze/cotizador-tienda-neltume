import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/servidor/autenticacion';
import { validarConfiguracionAutenticacion } from '@/servidor/autenticacion-config';
import { PantallaAjustes } from './pantalla-ajustes';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Neltume · Ajustes' };

export default async function AjustesPage() {
  validarConfiguracionAutenticacion();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/login');
  const rol = (session.user as typeof session.user & { role?: string | null }).role ?? 'user';
  return (
    <PantallaAjustes
      email={session.user.email}
      nombre={session.user.name || session.user.email}
      puedeCrearUsuarios={rol === 'admin'}
    />
  );
}
