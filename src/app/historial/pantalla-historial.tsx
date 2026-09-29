'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { Avisos, useAvisos } from '../avisos';
import type { Resultado } from '../contrato';
import { Encabezado } from '../encabezado';
import { Historial, useHistorial } from '../historial';
import { esSilencioso, leerAbierta, mensajeDe, pedirJSON } from '../solicitud';

const sinEfecto = () => {};
const sinSuscripcion = () => () => {};

/** Pantalla del historial: buscar, filtrar, exportar, abrir o duplicar cotizaciones. */
export function PantallaHistorial({ email, nombre }: { email: string; nombre: string }) {
  const router = useRouter();
  const { avisos, avisar, cerrar } = useAvisos();
  const historial = useHistorial(sinEfecto);
  const [duplicando, setDuplicando] = useState<string | null>(null);
  // La cotización abierta en el cotizador de esta pestaña (sessionStorage no existe en el servidor).
  const actualId = useSyncExternalStore(sinSuscripcion, leerAbierta, () => null);

  // Se llega aquí para buscar: foco en el buscador, salvo en pantallas táctiles (abriría el teclado).
  useEffect(() => {
    if (window.matchMedia?.('(pointer: fine)').matches)
      document.getElementById('buscar-cotizaciones')?.focus();
  }, []);

  async function duplicar(id: string) {
    if (duplicando) return;
    setDuplicando(id);
    try {
      const d = await pedirJSON<Resultado>('/api/accion', { json: { tipo: 'duplicar', id } });
      router.push(`/?cotizacion=${encodeURIComponent(d.cotizacion.id)}`);
    } catch (e) {
      if (!esSilencioso(e)) avisar('error', mensajeDe(e), { clave: 'operacion' });
      setDuplicando(null);
    }
  }

  return (
    <div className="app-shell">
      <Encabezado email={email} nombre={nombre} pantalla="historial" avisar={avisar} />
      <main className="pantalla-historial">
        <Historial historial={historial} actualId={actualId} duplicar={duplicar} duplicando={duplicando} />
      </main>
      <footer className="site-footer">
        <span>
          NELTUME <span className="muted">/ Hecho en madera.</span>
        </span>
        <span>Asistente de cotizaciones · Uso interno</span>
      </footer>
      <Avisos avisos={avisos} cerrar={cerrar} />
    </div>
  );
}
