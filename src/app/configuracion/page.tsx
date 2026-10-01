import { redirect } from 'next/navigation';

// «Catálogo y ajustes» se separó en dos pantallas: los enlaces antiguos llevan a la que corresponde.
export default async function ConfiguracionPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { seccion } = await searchParams;
  if (seccion === 'asistente') redirect('/ajustes?seccion=asistente');
  if (seccion === 'agregar') redirect('/catalogo?seccion=agregar');
  if (seccion === 'manuales') redirect('/catalogo');
  redirect('/catalogo');
}
