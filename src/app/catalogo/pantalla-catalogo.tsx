'use client';
import { useEffect, useState, type MouseEvent } from 'react';
import { AltaProducto } from '../alta-producto';
import { Avisos, useAvisos } from '../avisos';
import { CatalogoConsulta } from '../catalogo-consulta';
import { Encabezado } from '../encabezado';
import { EncabezadoPagina } from '../encabezado-pagina';
import { useEsCliente, useScrollRecordado } from '../memoria-pantalla';
import { ProductosManuales } from '../productos-manuales';
import { pedirJSON } from '../solicitud';
import { SECCIONES, type Seccion } from './secciones';

/** Pantalla «Catálogo»: consultar productos, agregar uno (a mano o con el asistente) y mantener los agregados. */
export function PantallaCatalogo({
  email,
  nombre,
  seccion: inicial,
}: {
  email: string;
  nombre: string;
  seccion: Seccion;
}) {
  // Cambiar de sección no es una navegación de Next: cada `?seccion=` sería otra página (se montaría otra
  // instancia y se perdería el scroll). Se actualiza la URL con pushState, así el enlace directo y
  // Atrás/Adelante siguen funcionando, y la sección vive en el estado de esta pantalla.
  const [seccion, setSeccion] = useState<Seccion>(inicial);
  useEffect(() => {
    const alVolver = () => {
      const pedida = new URLSearchParams(location.search).get('seccion');
      setSeccion(SECCIONES.find((s) => s.id === pedida)?.id ?? 'consultar');
    };
    window.addEventListener('popstate', alVolver);
    return () => window.removeEventListener('popstate', alVolver);
  }, []);
  const irA = (e: MouseEvent<HTMLAnchorElement>, s: Seccion) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (s === seccion) return;
    window.history.pushState(null, '', e.currentTarget.href);
    setSeccion(s);
  };
  const { avisos, avisar, cerrar } = useAvisos();
  // El alta asistida necesita saber si hay asistente; sin él, el formulario manual sigue disponible.
  const [asistente, setAsistente] = useState(true);
  useEffect(() => {
    const control = new AbortController();
    pedirJSON<{ asistenteConfigurado: boolean }>('/api/ajustes', {
      signal: control.signal,
      cache: 'no-store',
    })
      .then((d) => setAsistente(d.asistenteConfigurado))
      .catch(() => {});
    return () => control.abort();
  }, []);

  const cliente = useEsCliente();
  useScrollRecordado('catalogo', cliente);
  // Las secciones visitadas quedan montadas (ocultas): al volver a una, la búsqueda o el alta a medias
  // siguen donde estaban. «Productos agregados» se vuelve a montar para mostrar lo recién agregado.
  const [visitadas, setVisitadas] = useState<Seccion[]>([seccion]);
  if (!visitadas.includes(seccion)) setVisitadas([...visitadas, seccion]);
  const montada = (s: Seccion) => cliente && (s === seccion || (s !== 'productos' && visitadas.includes(s)));
  const actual = SECCIONES.find((s) => s.id === seccion)!;

  return (
    <div className="app-shell">
      <Encabezado email={email} nombre={nombre} pantalla="catalogo" />
      <EncabezadoPagina titulo="Catálogo" />
      <div className="con-secciones superficie">
        <nav className="secciones-nav" aria-label="Secciones del catálogo">
          <ul>
            {SECCIONES.map((s) => (
              <li key={s.id}>
                <a
                  href={s.id === 'consultar' ? '/catalogo' : `/catalogo?seccion=${s.id}`}
                  onClick={(e) => irA(e, s.id)}
                  aria-current={s.id === seccion ? 'page' : undefined}
                >
                  {s.titulo}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <main className="secciones-contenido" aria-labelledby="seccion-titulo">
          <h2 id="seccion-titulo">{actual.encabezado}</h2>
          {montada('consultar') && (
            <div hidden={seccion !== 'consultar'}>
              <CatalogoConsulta activa={seccion === 'consultar'} />
            </div>
          )}
          {montada('agregar') && (
            <div hidden={seccion !== 'agregar'}>
              <AltaProducto asistente={asistente} />
            </div>
          )}
          {montada('productos') && <ProductosManuales avisar={avisar} />}
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
