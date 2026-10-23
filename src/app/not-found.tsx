import Image from 'next/image';
import Link from 'next/link';

export const metadata = { title: 'Página no encontrada · Neltume' };

/** 404 con la marca y en español: lleva de vuelta al cotizador (si no hay sesión, este lo manda al ingreso). */
export default function NoEncontrada() {
  return (
    <main className="no-encontrada">
      <Image src="/api/logo" alt="Neltume" width={143} height={70} priority unoptimized className="logo" />
      <p className="no-encontrada-codigo">404</p>
      <h1>No encontramos esa página</h1>
      <p>El enlace puede estar mal escrito o la página ya no existe.</p>
      <Link href="/" className="button primary">
        Volver al cotizador
      </Link>
    </main>
  );
}
