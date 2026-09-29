'use client';
import { useEffect, useState } from 'react';
import { Avisos, useAvisos } from '../avisos';
import { CambiarClave } from '../cambiar-clave';
import { ConfiguracionIA, type EstadoAjustes } from '../configuracion-ia';
import { Encabezado } from '../encabezado';
import { EncabezadoPagina } from '../encabezado-pagina';
import { esSilencioso, mensajeDe, pedirJSON } from '../solicitud';

/** Pantalla «Ajustes»: contraseña de la cuenta y modelo del asistente. */
export function PantallaAjustes({ email, nombre }: { email: string; nombre: string }) {
  const { avisos, avisar, cerrar } = useAvisos();
  const [estado, setEstado] = useState<EstadoAjustes | null>(null);
  const [error, setError] = useState('');
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    const control = new AbortController();
    pedirJSON<EstadoAjustes>('/api/ajustes', { signal: control.signal, cache: 'no-store' }).then(
      (d) => {
        setEstado(d);
        setError('');
      },
      (e) => {
        if (!esSilencioso(e)) setError(mensajeDe(e));
      },
    );
    return () => control.abort();
  }, [intento]);

  return (
    <div className="app-shell">
      <Encabezado email={email} nombre={nombre} pantalla="ajustes" />
      <EncabezadoPagina titulo="Ajustes" />
      <main className="superficie ajustes-pagina">
        <section aria-labelledby="ajustes-cuenta">
          <h2 id="ajustes-cuenta">Contraseña</h2>
          <CambiarClave avisar={avisar} />
        </section>
        <section aria-labelledby="ajustes-asistente">
          <h2 id="ajustes-asistente">Asistente</h2>
          <ConfiguracionIA
            estado={estado}
            errorCarga={error}
            reintentar={() => {
              setError('');
              setIntento((n) => n + 1);
            }}
            guardado={setEstado}
            avisar={avisar}
          />
        </section>
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
