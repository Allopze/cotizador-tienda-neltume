import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Cotizador } from './cotizador';
import { auth } from '@/servidor/autenticacion';
import { validarConfiguracionAutenticacion } from '@/servidor/autenticacion-config';

export const dynamic = 'force-dynamic';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  validarConfiguracionAutenticacion();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/login');
  const { cotizacion } = await searchParams;
  // El rol solo decide qué se ofrece (número manual, regenerar un PDF); la API lo vuelve a exigir.
  const rol = (session.user as typeof session.user & { role?: string | null }).role ?? 'user';
  return (
    <Cotizador
      email={session.user.email}
      nombre={session.user.name || session.user.email}
      admin={rol === 'admin'}
      abrirId={typeof cotizacion === 'string' && cotizacion ? cotizacion : null}
    />
  );
}
