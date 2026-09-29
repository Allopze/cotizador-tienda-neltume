import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/servidor/autenticacion';
import { validarConfiguracionAutenticacion } from '@/servidor/autenticacion-config';
import { PantallaHistorial } from './pantalla-historial';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Neltume · Historial de cotizaciones' };

export default async function HistorialPage() {
  validarConfiguracionAutenticacion();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/login');
  return <PantallaHistorial email={session.user.email} nombre={session.user.name || session.user.email} />;
}
