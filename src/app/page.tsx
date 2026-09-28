import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Cotizador } from './cotizador';
import { auth } from '@/servidor/autenticacion';
import { validarConfiguracionAutenticacion } from '@/servidor/autenticacion-config';

export const dynamic = 'force-dynamic';

export default async function Page() {
  validarConfiguracionAutenticacion();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/login');
  return <Cotizador email={session.user.email} />;
}
