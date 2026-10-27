'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { Avisos, useAvisos, type TipoAviso } from '../avisos';
import type { Resultado } from '../contrato';
import { Encabezado } from '../encabezado';
import { EncabezadoPagina } from '../encabezado-pagina';
import { Historial, useHistorial } from '../historial';
import { antesDeNavegar, useEsCliente, useScrollRecordado } from '../memoria-pantalla';
import { dejarAvisoAlAbrir, esSilencioso, leerAbierta, mensajeDe, pedirJSON } from '../solicitud';

const sinEfecto = () => {};
const sinSuscripcion = () => () => {};
/** Id propuesto para la copia (sin contexto seguro no hay UUID). */
const idNuevo = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined;

/** Pantalla del historial: buscar, filtrar, exportar, abrir o duplicar cotizaciones. */
export function PantallaHistorial({ email, nombre }: { email: string; nombre: string }) {
  const { avisos, avisar, cerrar } = useAvisos();
  // El listado recuerda filtros y largo en sessionStorage: se monta después de hidratar.
  const cliente = useEsCliente();
  return (
    <div className="app-shell">
      <Encabezado email={email} nombre={nombre} pantalla="historial" />
      <main className="pantalla-historial">
        {cliente ? <Listado avisar={avisar} /> : <EncabezadoPagina titulo="Historial de cotizaciones" />}
      </main>
      <Avisos avisos={avisos} cerrar={cerrar} />
    </div>
  );
}

function Listado({
  avisar,
}: {
  avisar: (tipo: TipoAviso, texto: string, extra?: { clave?: string }) => number;
}) {
  const router = useRouter();
  const historial = useHistorial(sinEfecto);
  const [duplicando, setDuplicando] = useState<string | null>(null);
  /** Id de la copia en curso; sobrevive a un reintento para no crear dos borradores (auditoría BUG-047). */
  const copiaPendiente = useRef<{ origen: string; nuevoId: string } | null>(null);
  // La cotización abierta en el cotizador de esta pestaña (sessionStorage no existe en el servidor).
  const actualId = useSyncExternalStore(sinSuscripcion, leerAbierta, () => null);
  // Al volver, el scroll se restaura cuando el listado ya tiene su largo.
  useScrollRecordado('historial', !historial.cargando);

  // Se llega aquí para buscar: foco en el buscador sin mover el scroll restaurado, salvo en pantallas
  // táctiles (abriría el teclado).
  useEffect(() => {
    if (window.matchMedia?.('(pointer: fine)').matches)
      document.getElementById('buscar-cotizaciones')?.focus({ preventScroll: true });
  }, []);

  async function duplicar(id: string) {
    if (duplicando) return;
    setDuplicando(id);
    if (copiaPendiente.current?.origen !== id) {
      const nuevoId = idNuevo();
      copiaPendiente.current = nuevoId ? { origen: id, nuevoId } : null;
    }
    try {
      const d = await pedirJSON<Resultado>('/api/accion', {
        json: {
          tipo: 'duplicar',
          id,
          ...(copiaPendiente.current ? { nuevoId: copiaPendiente.current.nuevoId } : {}),
        },
      });
      copiaPendiente.current = null;
      // Lo que cambió al copiar (p. ej. el descuento recortado al máximo vigente) se avisa al abrir la copia.
      if (d.avisos?.length) dejarAvisoAlAbrir(d.cotizacion.id, d.avisos.join(' '));
      antesDeNavegar();
      router.push(`/?cotizacion=${encodeURIComponent(d.cotizacion.id)}`, { scroll: false });
    } catch (e) {
      if (!esSilencioso(e)) avisar('error', mensajeDe(e), { clave: 'operacion' });
      setDuplicando(null);
    }
  }

  return <Historial historial={historial} actualId={actualId} duplicar={duplicar} duplicando={duplicando} />;
}
