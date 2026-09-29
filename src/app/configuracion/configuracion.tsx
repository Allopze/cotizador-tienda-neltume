'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AltaProducto } from '../alta-producto';
import { Avisos, useAvisos } from '../avisos';
import { CatalogoConsulta } from '../catalogo-consulta';
import { ConfiguracionIA, type EstadoAjustes } from '../configuracion-ia';
import { Encabezado } from '../encabezado';
import { EncabezadoPagina } from '../encabezado-pagina';
import { ProductosManuales } from '../productos-manuales';
import { esSilencioso, mensajeDe, pedirJSON } from '../solicitud';
import { SECCIONES, type Seccion } from './secciones';

/** Pantalla «Catálogo y ajustes»: consulta y alta de productos, y el modelo del asistente. */
export function Configuracion({
  email,
  nombre,
  seccion,
}: {
  email: string;
  nombre: string;
  seccion: Seccion;
}) {
  const { avisos, avisar, cerrar } = useAvisos();
  const [estadoIA, setEstadoIA] = useState<EstadoAjustes | null>(null);
  const [errorAjustes, setErrorAjustes] = useState('');
  const [intento, setIntento] = useState(0);

  // El estado del asistente sirve a dos secciones: el alta asistida y la configuración del modelo.
  useEffect(() => {
    const control = new AbortController();
    pedirJSON<EstadoAjustes>('/api/ajustes', { signal: control.signal, cache: 'no-store' }).then(
      (d) => {
        setEstadoIA(d);
        setErrorAjustes('');
      },
      (e) => {
        if (!esSilencioso(e)) setErrorAjustes(mensajeDe(e));
      },
    );
    return () => control.abort();
  }, [intento]);

  const actual = SECCIONES.find((s) => s.id === seccion)!;
  const grupos = [...new Set(SECCIONES.map((s) => s.grupo))];
  return (
    <div className="app-shell">
      <Encabezado email={email} nombre={nombre} pantalla="configuracion" avisar={avisar} />
      <EncabezadoPagina titulo="Catálogo y ajustes" />
      <div className="ajustes superficie">
        <nav className="ajustes-nav" aria-label="Secciones de catálogo y ajustes">
          {grupos.map((grupo) => (
            <div key={grupo} className="ajustes-grupo">
              <p className="eyebrow">{grupo}</p>
              <ul>
                {SECCIONES.filter((s) => s.grupo === grupo).map((s) => (
                  <li key={s.id}>
                    <Link
                      href={s.id === 'catalogo' ? '/configuracion' : `/configuracion?seccion=${s.id}`}
                      aria-current={s.id === seccion ? 'page' : undefined}
                    >
                      {s.titulo}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <main className="ajustes-contenido" aria-labelledby="ajustes-titulo">
          <h2 id="ajustes-titulo">{actual.encabezado}</h2>
          {seccion === 'catalogo' ? (
            <CatalogoConsulta />
          ) : seccion === 'agregar' ? (
            <AltaProducto asistente={estadoIA?.asistenteConfigurado ?? true} />
          ) : seccion === 'manuales' ? (
            <ProductosManuales avisar={avisar} />
          ) : (
            <ConfiguracionIA
              estado={estadoIA}
              errorCarga={errorAjustes}
              reintentar={() => {
                setErrorAjustes('');
                setIntento((n) => n + 1);
              }}
              guardado={setEstadoIA}
              avisar={avisar}
            />
          )}
        </main>
      </div>
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
