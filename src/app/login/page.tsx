import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/servidor/autenticacion';
import { validarConfiguracionAutenticacion } from '@/servidor/autenticacion-config';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  validarConfiguracionAutenticacion();
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect('/');
  return <LoginForm />;
}
