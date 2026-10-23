import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import './chat.css';
import './cotizacion.css';
import './responsive.css';
import './login.css';
import './movimiento.css';
import './cotizacion-interfaz.css';
import './cotizador-pantalla.css';
// Última: las reglas táctiles deben ganar a cualquier hoja anterior con la misma especificidad.
import './tactil.css';
// Las mismas dos familias de los PDF, servidas desde el propio servidor (sin depender de Google). El guion de Host
// Grotesk es el acortado de scripts/fuentes-pdf.py: el original se leía como raya en códigos y RUT.
const sans = localFont({
  src: '../servidor/pdf-recursos/fuentes/host-grotesk.woff2',
  variable: '--font-sans',
  weight: '300 800',
  display: 'swap',
});
const serif = localFont({
  src: '../servidor/pdf-recursos/fuentes/newsreader.woff2',
  variable: '--font-serif',
  weight: '200 800',
  display: 'swap',
});
export const metadata: Metadata = {
  title: 'Neltume · Cotizaciones',
  description: 'Asistente interno de cotizaciones de puertas sólidas.',
  icons: {
    icon: '/logo-neltume.svg',
  },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CL" className={`${sans.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
