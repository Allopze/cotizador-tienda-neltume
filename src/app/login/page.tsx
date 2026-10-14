import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/servidor/autenticacion';
import { validarConfiguracionAutenticacion } from '@/servidor/autenticacion-config';
import { asegurarCodigoPrimerArranque, hayCuentas } from '@/servidor/primer-arranque';
import { LoginForm } from './login-form';
import { PrimeraCuenta } from './primera-cuenta';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  validarConfiguracionAutenticacion();
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect('/');
  // Sin ninguna cuenta no hay con qué entrar: se ofrece crear la primera con el código del registro del servidor
  // (si el anterior venció, aquí se escribe uno nuevo).
  if (!hayCuentas()) {
    asegurarCodigoPrimerArranque();
    return <PrimeraCuenta />;
  }
  const parametros = await searchParams;
  return (
    <LoginForm
      sesionExpirada={parametros.motivo === 'sesion'}
      // La pantalla de origen se valida en el formulario contra la lista de pantallas conocidas.
      desde={typeof parametros.desde === 'string' ? parametros.desde : null}
    />
  );
}
