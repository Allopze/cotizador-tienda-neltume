import type { Metadata } from 'next';
import './globals.css';
import './chat.css';
import './cotizacion.css';
import './responsive.css';
export const metadata: Metadata = {
  title: 'Neltume · Cotizaciones',
  description: 'Asistente interno de cotizaciones de puertas sólidas.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CL">
      <body>{children}</body>
    </html>
  );
}
