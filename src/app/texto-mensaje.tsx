'use client';

// Las preguntas del asistente terminan en «Opciones: a, b, c.» (ver asistente/preguntas.ts).
const LISTA = /^(.*?)\s*(Opciones disponibles|Opciones|Modelos disponibles|Maderas disponibles):\s*(.+?)\.?$/;
const RESTO = /\s+y (\d+) más \(revisa «Catálogo»\)$/;

/** Qué campo responde la opción: «¿Qué alto o largo necesitas…?» → «alto o largo». */
function campoDe(pregunta: string, tipo: string) {
  if (tipo === 'Modelos disponibles') return 'modelo';
  if (tipo === 'Maderas disponibles') return 'madera';
  // «Marco no viene en 2,3 m de alto o largo.» → «alto o largo».
  return /^¿Qué (.+?) necesitas/.exec(pregunta)?.[1] ?? / de ([^.]+?)\.$/.exec(pregunta)?.[1] ?? '';
}

/**
 * Texto de un mensaje. Con `elegir`, las listas de opciones se muestran como botones que agregan la
 * respuesta al mensaje en preparación; sin él (mensajes anteriores) se deja el texto tal cual.
 */
export function TextoMensaje({ texto, elegir }: { texto: string; elegir?: (respuesta: string) => void }) {
  if (!elegir) return <p>{texto}</p>;
  return (
    <>
      {texto.split('\n').map((linea, i) => {
        const m = LISTA.exec(linea);
        if (!m) return <p key={i}>{linea}</p>;
        const [, pregunta, tipo, lista] = m;
        const resto = RESTO.exec(lista);
        // Las opciones se separan con «, »; los decimales («2,1») no llevan espacio.
        const opciones = lista.replace(RESTO, '').split(', ').filter(Boolean);
        const campo = campoDe(pregunta, tipo);
        // «Entero entre 1 y 10.000» es una indicación, no una opción que se pueda elegir.
        if (opciones.length === 1 && /^Entero entre/.test(opciones[0]))
          return (
            <div key={i} className="pregunta-opciones">
              <p>{pregunta}</p>
              <p className="opciones-resto">{opciones[0]}.</p>
            </div>
          );
        return (
          <div key={i} className="pregunta-opciones">
            <p>{pregunta || `${tipo}:`}</p>
            <div role="group" aria-label={pregunta || tipo} className="opciones-chat">
              {opciones.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => elegir(campo ? `${campo} ${o}` : o)}
                  aria-label={campo ? `Responder ${campo}: ${o}` : `Responder ${o}`}
                >
                  {o}
                </button>
              ))}
              {resto && <span className="opciones-resto">y {resto[1]} más en «Catálogo»</span>}
            </div>
          </div>
        );
      })}
    </>
  );
}
