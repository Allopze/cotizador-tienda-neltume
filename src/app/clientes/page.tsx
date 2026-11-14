import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/servidor/autenticacion';
import { validarConfiguracionAutenticacion } from '@/servidor/autenticacion-config';
import { PantallaClientes } from './pantalla-clientes';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Neltume · Clientes' };

export default async function ClientesPage() {
  validarConfiguracionAutenticacion();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/login');
  const rol = (session.user as typeof session.user & { role?: string | null }).role ?? 'user';
  return (
    <PantallaClientes
      email={session.user.email}
      nombre={session.user.name || session.user.email}
      esAdmin={rol === 'admin'}
    />
  );
}
