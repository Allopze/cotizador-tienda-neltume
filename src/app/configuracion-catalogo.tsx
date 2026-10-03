'use client';
import { useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react';
import { FAMILIAS } from '@/catalogo/familias';
import {
  claveTolerante,
  modeloParecido,
  normalizarCatalogo,
  resolverMaderaConfigurada,
  resolverModeloConfigurado,
  resolverModeloPosibleConfigurado,
} from '@/catalogo/configuracion';
import type { Familia } from '@/catalogo/tipos';
import type { Avisar } from './avisos';
import { SelectorFamilia } from './selector-familia';
import { esSilencioso, mensajeDe, pedirJSON } from './solicitud';

interface Madera {
  nombre: string;
  codigo: string;
  alias: string[];
}
interface Configuracion {
  maderas: Madera[];
  familiasPorModelo: Record<string, Familia>;
  aliasModelos: Record<string, string[]>;
  aliasPosiblesModelos: Record<string, string[]>;
}
type MaderaEdit = Madera;
interface FamiliaEdit {
  modelo: string;
  familia: Familia;
}
/** Un modelo con sus dos listas: lo que se reemplaza solo y lo que obliga a preguntar. */
interface ModeloEdit {
  modelo: string;
  alias: string[];
  posibles: string[];
}
interface Filas {
  maderas: MaderaEdit[];
  modelos: ModeloEdit[];
  familias: FamiliaEdit[];
}
type Grupo = keyof Filas;
type Campo = 'nombre' | 'codigo' | 'alias' | 'posibles' | 'modelo';
interface ErrorFila {
  texto: string;
  campo: Campo;
  /** Fila sin completar: se avisa al intentar guardar, no mientras se escribe. */
  vacia?: boolean;
}
/** Errores por grupo y fila: se muestran junto a la fila que hay que corregir. */
type Errores = Partial<Record<Grupo, Record<number, ErrorFila>>>;

const DURACION_DESHACER = 8000;
const TITULOS: Record<Grupo, string> = {
  maderas: 'Maderas',
  modelos: 'Modelos',
  familias: 'Familia de cada modelo',
};
const limpiar = (alias: string[]) => alias.map((a) => a.trim()).filter(Boolean);

const filasDe = (c: Configuracion): Filas => {
  const modelos = new Map<string, ModeloEdit>();
  const fila = (modelo: string) => {
    const k = normalizarCatalogo(modelo);
    if (!modelos.has(k)) modelos.set(k, { modelo, alias: [], posibles: [] });
    return modelos.get(k)!;
  };
  for (const [modelo, alias] of Object.entries(c.aliasModelos)) fila(modelo).alias.push(...alias);
  for (const [modelo, alias] of Object.entries(c.aliasPosiblesModelos)) fila(modelo).posibles.push(...alias);
  return {
    maderas: c.maderas.map((m) => ({ nombre: m.nombre, codigo: m.codigo, alias: [...m.alias] })),
    modelos: [...modelos.values()],
    familias: Object.entries(c.familiasPorModelo).map(([modelo, familia]) => ({ modelo, familia })),
  };
};
const listaPorModelo = (filas: ModeloEdit[], lista: 'alias' | 'posibles') =>
  Object.fromEntries(filas.filter((m) => m.modelo.trim() && m[lista].length).map((m) => [m.modelo.trim(), limpiar(m[lista])]));
const configuracionDe = (f: Filas): Configuracion => ({
  maderas: f.maderas.map((m) => ({ nombre: m.nombre.trim(), codigo: m.codigo.trim(), alias: limpiar(m.alias) })),
  familiasPorModelo: Object.fromEntries(f.familias.filter((x) => x.modelo.trim()).map((x) => [x.modelo.trim(), x.familia])),
  aliasModelos: listaPorModelo(f.modelos, 'alias'),
  aliasPosiblesModelos: listaPorModelo(f.modelos, 'posibles'),
});

/**
 * Lo que el servidor rechazaría, dicho junto a la fila: vacíos, duplicados y palabras que llevan a dos
 * maderas o dos modelos. Compara como el asistente: sin tildes, mayúsculas ni signos.
 */
function validar(f: Filas): Errores {
  const errores: Errores = {};
  const marcar = (grupo: Grupo, fila: number, error: ErrorFila) => {
    if (!errores[grupo]?.[fila]) errores[grupo] = { ...errores[grupo], [fila]: error };
  };

  const nombres = new Map<string, number>();
  const nombresTolerantes = new Map<string, number>();
  const codigos = new Map<string, number>();
  f.maderas.forEach((m, i) => {
    if (!m.nombre.trim()) return marcar('maderas', i, { texto: 'La madera necesita nombre.', campo: 'nombre', vacia: true });
    if (!m.codigo.trim()) return marcar('maderas', i, { texto: 'La madera necesita código.', campo: 'codigo', vacia: true });
    if (!/^[A-Z0-9]+$/i.test(m.codigo.trim()))
      return marcar('maderas', i, { texto: 'El código solo admite letras y números, sin espacios.', campo: 'codigo' });
    const nombre = normalizarCatalogo(m.nombre);
    const nombreTolerante = claveTolerante(m.nombre);
    const codigo = m.codigo.trim().toUpperCase();
    if (nombres.has(nombre)) marcar('maderas', i, { texto: `«${m.nombre.trim()}» ya está en la fila ${nombres.get(nombre)! + 1}.`, campo: 'nombre' });
    else if (nombresTolerantes.has(nombreTolerante))
      marcar('maderas', i, { texto: `«${m.nombre.trim()}» ya está en la fila ${nombresTolerantes.get(nombreTolerante)! + 1}.`, campo: 'nombre' });
    else if (codigos.has(codigo)) marcar('maderas', i, { texto: `El código «${m.codigo.trim()}» ya lo usa la fila ${codigos.get(codigo)! + 1}.`, campo: 'codigo' });
    if (!nombres.has(nombre)) nombres.set(nombre, i);
    if (!nombresTolerantes.has(nombreTolerante)) nombresTolerantes.set(nombreTolerante, i);
    if (!codigos.has(codigo)) codigos.set(codigo, i);
  });
  // Cada palabra debe llevar a una sola madera. Se marcan las dos filas.
  const terminos = new Map<string, { fila: number; valor: string }[]>();
  const anotarTermino = (clave: string, fila: number, valor: string) => {
    if (clave.length > 1) terminos.set(clave, [...(terminos.get(clave) ?? []), { fila, valor }]);
  };
  f.maderas.forEach((m, i) => {
    for (const valor of [m.nombre, ...m.alias]) {
      anotarTermino(`=${normalizarCatalogo(valor)}`, i, valor);
      anotarTermino(`~${claveTolerante(valor)}`, i, valor);
    }
  });
  for (const usos of terminos.values()) {
    for (const uso of usos) {
      const otro = usos.find((o) => normalizarCatalogo(f.maderas[o.fila].nombre) !== normalizarCatalogo(f.maderas[uso.fila].nombre));
      if (!otro) continue;
      marcar('maderas', uso.fila, {
        texto: `«${uso.valor.trim()}» también lleva a ${f.maderas[otro.fila].nombre.trim()} (fila ${otro.fila + 1}): el asistente no sabría cuál elegir.`,
        campo: uso.valor === f.maderas[uso.fila].nombre ? 'nombre' : 'alias',
      });
    }
  }

  for (const grupo of ['modelos', 'familias'] as const) {
    const vistos = new Map<string, number>();
    const vistosTolerantes = new Map<string, number>();
    f[grupo].forEach((fila, i) => {
      if (!fila.modelo.trim()) {
        if ('alias' in fila && (fila.alias.length || fila.posibles.length))
          marcar(grupo, i, { texto: 'Escribe el nombre del modelo.', campo: 'modelo', vacia: true });
        return;
      }
      const k = normalizarCatalogo(fila.modelo);
      const tolerante = claveTolerante(fila.modelo);
      if (vistos.has(k))
        return marcar(grupo, i, { texto: `El modelo «${fila.modelo.trim()}» ya está en la fila ${vistos.get(k)! + 1}.`, campo: 'modelo' });
      if (grupo === 'modelos' && vistosTolerantes.has(tolerante))
        return marcar(grupo, i, { texto: `El modelo «${fila.modelo.trim()}» ya está en la fila ${vistosTolerantes.get(tolerante)! + 1}.`, campo: 'modelo' });
      vistos.set(k, i);
      vistosTolerantes.set(tolerante, i);
    });
  }
  // Una palabra de modelo —el nombre, un alias seguro o uno dudoso— debe llevar a un solo modelo; y no estar en las dos columnas.
  const palabras = new Map<string, { fila: number; modelo: string }>();
  f.modelos.forEach((fila, i) => {
    if (!fila.modelo.trim()) return;
    const dudosas = new Set(fila.posibles.flatMap((p) => [`=${normalizarCatalogo(p)}`, `~${claveTolerante(p)}`]));
    const valores = [
      { lista: 'modelo' as const, valor: fila.modelo },
      ...fila.alias.map((valor) => ({ lista: 'alias' as const, valor })),
      ...fila.posibles.map((valor) => ({ lista: 'posibles' as const, valor })),
    ];
    for (const { lista, valor } of valores) {
      const k = normalizarCatalogo(valor);
      if (!k) continue;
      if (lista === 'alias' && (dudosas.has(`=${k}`) || dudosas.has(`~${claveTolerante(valor)}`))) {
        marcar('modelos', i, { texto: `«${valor.trim()}» está en las dos columnas: déjalo solo en una.`, campo: 'alias' });
        continue;
      }
      for (const clave of [`=${k}`, `~${claveTolerante(valor)}`]) {
        const previo = palabras.get(clave);
        if (previo && previo.fila !== i)
          marcar('modelos', i, { texto: `«${valor.trim()}» ya lleva a ${previo.modelo.trim()} (fila ${previo.fila + 1}).`, campo: lista });
        else if (!previo) palabras.set(clave, { fila: i, modelo: fila.modelo });
      }
    }
  });
  return errores;
}

/** Botón para quitar una fila: ícono discreto, con el nombre completo para lectores de pantalla. */
function BotonQuitar({ etiqueta, quitar }: { etiqueta: string; quitar: () => void }) {
  return (
    <button type="button" className="config-quitar" onClick={quitar} aria-label={`Quitar ${etiqueta}`} title="Quitar fila">
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4" fill="none" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    </button>
  );
}

function TextoError({ id, error, mostrar }: { id: string; error?: ErrorFila; mostrar: boolean }) {
  return error && mostrar ? (
    <p id={id} className="campo-error config-error-fila">
      {error.texto}
    </p>
  ) : null;
}

/**
 * Lista de palabras como etiquetas: cada una se ve entera y se quita con su ×. Enter, coma o salir del campo
 * la agregan; pegar una lista separada por comas agrega todas. Lo que el asistente ya reconoce no se repite,
 * y lo que sobra se explica con un botón para quitarlo.
 */
function CampoPalabras({
  etiqueta,
  valores,
  cambiar,
  nombre,
  dudosa = false,
  invalido,
}: {
  etiqueta: string;
  valores: string[];
  cambiar: (valores: string[]) => void;
  /** Nombre de la madera o modelo: una palabra igual a él sobra. */
  nombre: string;
  /**
   * Columna «Podría ser»: una variante del nombre («CUNNCO» para CUNCO) no sobra, porque anotarla aquí hace
   * que el asistente pregunte en vez de cambiarla solo. Solo sobra el nombre tal cual.
   */
  dudosa?: boolean;
  invalido?: { 'aria-invalid': true; 'aria-describedby': string };
}) {
  const [texto, setTexto] = useState('');
  const [aviso, setAviso] = useState('');
  const entrada = useRef<HTMLInputElement>(null);
  const claveNombre = claveTolerante(nombre);
  const igualAlNombre = (valor: string) =>
    dudosa ? !!normalizarCatalogo(nombre) && normalizarCatalogo(valor) === normalizarCatalogo(nombre) : claveTolerante(valor) === claveNombre;
  /** Un chip sobra si repite el nombre o una palabra anterior según la clave tolerante. */
  const sobra = (valor: string, i: number) => {
    const clave = claveTolerante(valor);
    return !!clave && (igualAlNombre(valor) || valores.slice(0, i).some((v) => claveTolerante(v) === clave));
  };
  const sobrantes = valores.filter(sobra);

  function agregar(crudo: string) {
    const nuevos = [...valores];
    const repetidos: string[] = [];
    for (const parte of crudo.split(',').map((p) => p.trim()).filter(Boolean)) {
      const clave = claveTolerante(parte);
      if (!clave || igualAlNombre(parte) || nuevos.some((v) => claveTolerante(v) === clave)) repetidos.push(parte);
      else nuevos.push(parte.toLocaleUpperCase('es-CL'));
    }
    if (nuevos.length !== valores.length) cambiar(nuevos);
    setAviso(
      repetidos.length
        ? `No hace falta agregar ${repetidos.map((r) => `«${r}»`).join(', ')}: el asistente ya lo reconoce (no distingue tildes, mayúsculas ni letras repetidas).`
        : '',
    );
    setTexto('');
  }

  function teclear(evento: KeyboardEvent<HTMLInputElement>) {
    if (evento.key === 'Enter' || evento.key === ',') {
      evento.preventDefault();
      if (texto.trim()) agregar(texto);
    } else if (evento.key === 'Backspace' && !texto && valores.length) {
      cambiar(valores.slice(0, -1));
    }
  }

  function pegar(evento: ClipboardEvent<HTMLInputElement>) {
    const pegado = evento.clipboardData.getData('text');
    if (!pegado.includes(',')) return;
    evento.preventDefault();
    agregar(texto + pegado);
  }

  return (
    <div className="config-alias">
      <div className="config-chips" onClick={() => entrada.current?.focus()}>
        {valores.map((valor, i) => (
          <span key={`${valor}-${i}`} className="config-chip">
            {valor}
            <button type="button" aria-label={`Quitar «${valor}»`} title="Quitar" onClick={() => cambiar(valores.filter((_, j) => j !== i))}>
              ×
            </button>
          </span>
        ))}
        <label className="config-chips-entrada">
          <span className="sr-only">{etiqueta}</span>
          <input
            ref={entrada}
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              setAviso('');
            }}
            onKeyDown={teclear}
            onPaste={pegar}
            onBlur={() => texto.trim() && agregar(texto)}
            maxLength={80}
            placeholder={valores.length ? '+ otra' : 'Escribe y presiona Enter'}
            {...invalido}
          />
        </label>
      </div>
      {sobrantes.length > 0 && (
        <p className="config-alias-aviso">
          {sobrantes.map((s) => `«${s}»`).join(', ')} no hace falta: el asistente ya lo reconoce por el nombre o por
          otra palabra (no distingue tildes, mayúsculas ni letras repetidas).{' '}
          <button type="button" className="config-enlace" onClick={() => cambiar(valores.filter((v, i) => !sobra(v, i)))}>
            Quitar
          </button>
        </p>
      )}
      {aviso && (
        <p className="config-alias-aviso" role="status">
          {aviso}
        </p>
      )}
    </div>
  );
}

/** Prueba lo que el asistente reconocería con el borrador actual, antes de guardar. */
function ProbarReconocimiento({ config }: { config: Configuracion }) {
  const [texto, setTexto] = useState('');
  const k = normalizarCatalogo(texto);
  const nombreMadera = k ? resolverMaderaConfigurada(texto, config) : null;
  const madera = nombreMadera ? config.maderas.find((m) => m.nombre === nombreMadera) : undefined;
  const resuelto = k ? resolverModeloConfigurado(texto, config) : '';
  const modelo =
    k && (normalizarCatalogo(resuelto) !== k || Object.keys(config.aliasModelos).some((m) => normalizarCatalogo(m) === k))
      ? resuelto
      : undefined;
  const posible = k ? resolverModeloPosibleConfigurado(texto, config) : null;
  const parecido = k && !modelo && !posible ? modeloParecido(texto, config) : null;

  return (
    <div className="config-probar">
      <label className="ia-field">
        <span>Probar: escribe una madera o modelo como lo diría un cliente</span>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ej.: raulí, willow" maxLength={80} />
      </label>
      <p className="config-probar-resultado" role="status">
        {!k
          ? 'Muestra qué entendería el asistente, incluidos los cambios sin guardar.'
          : !madera && !modelo && !posible && !parecido
            ? 'No lo reconoce: lo deja tal como lo escribió el cliente.'
            : [
                madera && `Lo entiende como la madera ${madera.nombre} (código ${madera.codigo}).`,
                modelo && `Lo entiende como el modelo ${modelo}.`,
                posible && `Podría ser el modelo ${posible}: pregunta antes de usarlo.`,
                parecido && `Podría ser el modelo ${parecido} (se parece): pregunta antes de usarlo.`,
              ]
                .filter(Boolean)
                .join(' ')}
      </p>
    </div>
  );
}

export function ConfiguracionCatalogo({
  avisar,
  cerrarAviso,
  alCambiar,
}: {
  avisar: Avisar;
  cerrarAviso: (id: number) => void;
  alCambiar: (sucio: boolean) => void;
}) {
  const uid = useId();
  const [base, setBase] = useState<Filas | null>(null);
  const [filas, setFilas] = useState<Filas | null>(null);
  const [puedeEditar, setPuedeEditar] = useState(false);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [intentado, setIntentado] = useState(false);
  const formulario = useRef<HTMLFormElement>(null);

  const aplicar = (config: Configuracion) => {
    const nuevas = filasDe(config);
    setBase(nuevas);
    setFilas(nuevas);
    setIntentado(false);
  };

  useEffect(() => {
    const control = new AbortController();
    pedirJSON<{ configuracion: Configuracion; puedeEditar: boolean }>('/api/catalogo-configuracion', {
      signal: control.signal,
      cache: 'no-store',
    }).then(
      (data) => {
        aplicar(data.configuracion);
        setPuedeEditar(data.puedeEditar);
      },
      (causa) => {
        if (!esSilencioso(causa)) setError(mensajeDe(causa));
      },
    );
    return () => control.abort();
  }, []);

  const borrador = useMemo(() => (filas ? configuracionDe(filas) : null), [filas]);
  const sucio = !!base && !!borrador && JSON.stringify(borrador) !== JSON.stringify(configuracionDe(base));
  useEffect(() => alCambiar(sucio), [sucio, alCambiar]);
  const errores = useMemo(() => (filas ? validar(filas) : {}), [filas]);

  const editar = <G extends Grupo>(grupo: G, indice: number, cambio: Partial<Filas[G][number]>) =>
    setFilas((f) => f && { ...f, [grupo]: f[grupo].map((x, i) => (i === indice ? { ...x, ...cambio } : x)) });
  const agregar = <G extends Grupo>(grupo: G, fila: Filas[G][number]) =>
    setFilas((f) => f && { ...f, [grupo]: [...f[grupo], fila] });

  function quitar<G extends Grupo>(grupo: G, indice: number, nombre: string) {
    if (!filas) return;
    const fila = filas[grupo][indice];
    setFilas((f) => f && { ...f, [grupo]: f[grupo].filter((_, i) => i !== indice) });
    // Una fila nueva y vacía se quita sin más; una con datos se puede recuperar unos segundos.
    const conDatos = Object.values(fila).some((v) => (Array.isArray(v) ? v.length > 0 : typeof v === 'string' && v.trim()));
    if (!conDatos) return;
    const id = avisar('info', `Se quitó ${nombre}. Se aplica al guardar.`, {
      clave: 'config-quitar',
      accion: {
        etiqueta: 'Deshacer',
        fn: () =>
          setFilas((f) => {
            if (!f) return f;
            const lista = [...f[grupo]];
            lista.splice(Math.min(indice, lista.length), 0, fila);
            return { ...f, [grupo]: lista };
          }),
      },
    });
    setTimeout(() => cerrarAviso(id), DURACION_DESHACER);
  }

  async function guardar(evento: FormEvent) {
    evento.preventDefault();
    if (!puedeEditar || ocupado || !filas || !borrador) return;
    setIntentado(true);
    if (!filas.maderas.length) {
      setError('Debe quedar al menos una madera.');
      return;
    }
    if (Object.keys(validar(filas)).length) {
      setError('Corrige las filas marcadas antes de guardar.');
      // El foco va a la primera fila con error, cuando ya está pintada.
      requestAnimationFrame(() => formulario.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setOcupado(true);
    setError('');
    try {
      const data = await pedirJSON<{ configuracion: Configuracion }>('/api/catalogo-configuracion', { json: borrador });
      aplicar(data.configuracion);
      avisar('exito', 'Nombres y alias guardados.', { clave: 'config-guardada' });
    } catch (causa) {
      if (!esSilencioso(causa)) setError(mensajeDe(causa));
    } finally {
      setOcupado(false);
    }
  }

  if (!filas || !base || !borrador) return <p className="catalog-modal-intro">{error || 'Cargando configuración…'}</p>;
  const editable = puedeEditar && !ocupado;
  const errorId = (grupo: Grupo, i: number) => `${uid}-${grupo}-${i}-error`;
  // Un vacío se marca al intentar guardar; un choque, apenas aparece.
  const visible = (grupo: Grupo, i: number) => {
    const e = errores[grupo]?.[i];
    return e && (intentado || !e.vacia) ? e : undefined;
  };
  const invalida = (grupo: Grupo, i: number, campo: Campo) =>
    visible(grupo, i)?.campo === campo ? { 'aria-invalid': true as const, 'aria-describedby': errorId(grupo, i) } : undefined;
  const conError = (grupo: Grupo, i: number) => (visible(grupo, i) ? ' con-error' : '');
  const cuenta = (grupo: Grupo) => Object.keys(errores[grupo] ?? {}).filter((i) => visible(grupo, Number(i))).length;

  return (
    <form ref={formulario} className="config-catalogo" onSubmit={guardar} noValidate>
      <p className="catalog-modal-intro">
        Los clientes no siempre escriben igual que el catálogo: dicen «pino» por Pino Oregon o «willow» por Huilo Huilo.
        Aquí se le enseña al asistente esas otras formas de decirlo. Los cambios se aplican a las cotizaciones nuevas.
      </p>

      <nav className="config-indice" aria-label="Partes de la configuración">
        {(Object.keys(TITULOS) as Grupo[]).map((grupo) => (
          <a key={grupo} href={`#config-${grupo}`}>
            {TITULOS[grupo]}
            {cuenta(grupo) > 0 && <span className="config-indice-errores"> ({cuenta(grupo)} por corregir)</span>}
          </a>
        ))}
      </nav>

      <ProbarReconocimiento config={borrador} />

      <fieldset id="config-maderas" className="config-grupo" disabled={!editable}>
        <legend>{TITULOS.maderas}</legend>
        <p className="catalog-modal-intro">
          En la última columna van otras palabras con que un cliente nombra la madera: abreviaciones, otros nombres o errores
          comunes. No hace falta repetirlas con tildes o en minúsculas.
        </p>
        <div className="config-tabla config-tabla-maderas">
          <div className="config-cabecera" aria-hidden="true">
            <span>Nombre</span>
            <span>Código</span>
            <span>El cliente también puede escribir</span>
          </div>
          {filas.maderas.map((madera, i) => (
            <div className={`config-editor-fila${conError('maderas', i)}`} key={i}>
              <label className="ia-field">
                <span className="config-etiqueta">Nombre</span>
                <input value={madera.nombre} onChange={(e) => editar('maderas', i, { nombre: e.target.value })} maxLength={80} {...invalida('maderas', i, 'nombre')} />
              </label>
              <label className="ia-field">
                <span className="config-etiqueta">Código</span>
                <input value={madera.codigo} onChange={(e) => editar('maderas', i, { codigo: e.target.value })} maxLength={10} {...invalida('maderas', i, 'codigo')} />
              </label>
              <div className="ia-field">
                <span className="config-etiqueta" aria-hidden="true">
                  El cliente también puede escribir
                </span>
                <CampoPalabras
                  etiqueta={`Otras formas de escribir ${madera.nombre.trim() || 'la madera nueva'}`}
                  valores={madera.alias}
                  nombre={madera.nombre}
                  cambiar={(alias) => editar('maderas', i, { alias })}
                  invalido={invalida('maderas', i, 'alias')}
                />
              </div>
              <BotonQuitar etiqueta={`madera ${madera.nombre.trim() || 'nueva'}`} quitar={() => quitar('maderas', i, `la madera ${madera.nombre.trim() || 'nueva'}`)} />
              <TextoError id={errorId('maderas', i)} error={errores.maderas?.[i]} mostrar={!!visible('maderas', i)} />
            </div>
          ))}
        </div>
        <button type="button" className="button secondary small" onClick={() => agregar('maderas', { nombre: '', codigo: '', alias: [] })}>
          Agregar madera
        </button>
      </fieldset>

      <fieldset id="config-modelos" className="config-grupo" disabled={!editable}>
        <legend>{TITULOS.modelos}</legend>
        <p className="catalog-modal-intro">
          <strong>Se cambia solo:</strong> el asistente lo reemplaza por el modelo sin preguntar («willow» → Huilo Huilo).{' '}
          <strong>Podría ser:</strong> palabras que a veces son el modelo y a veces no; el ítem queda pendiente hasta que
          alguien confirme («pillo» → ¿Huilo Huilo?).
        </p>
        <div className="config-tabla config-tabla-modelos">
          <div className="config-cabecera" aria-hidden="true">
            <span>Modelo</span>
            <span>Se cambia solo</span>
            <span>Podría ser (pregunta)</span>
          </div>
          {filas.modelos.map((fila, i) => {
            const nombre = fila.modelo.trim() || 'el modelo nuevo';
            return (
              <div className={`config-editor-fila${conError('modelos', i)}`} key={i}>
                <label className="ia-field">
                  <span className="config-etiqueta">Modelo</span>
                  <input value={fila.modelo} onChange={(e) => editar('modelos', i, { modelo: e.target.value })} maxLength={80} {...invalida('modelos', i, 'modelo')} />
                </label>
                <div className="ia-field">
                  <span className="config-etiqueta" aria-hidden="true">
                    Se cambia solo
                  </span>
                  <CampoPalabras
                    etiqueta={`Se cambia solo por ${nombre}`}
                    valores={fila.alias}
                    nombre={fila.modelo}
                    cambiar={(alias) => editar('modelos', i, { alias })}
                    invalido={invalida('modelos', i, 'alias')}
                  />
                </div>
                <div className="ia-field">
                  <span className="config-etiqueta" aria-hidden="true">
                    Podría ser (pregunta)
                  </span>
                  <CampoPalabras
                    etiqueta={`Podría ser ${nombre} (pregunta)`}
                    valores={fila.posibles}
                    nombre={fila.modelo}
                    dudosa
                    cambiar={(posibles) => editar('modelos', i, { posibles })}
                    invalido={invalida('modelos', i, 'posibles')}
                  />
                </div>
                <BotonQuitar etiqueta={`palabras de ${nombre}`} quitar={() => quitar('modelos', i, `las palabras de ${nombre}`)} />
                <TextoError id={errorId('modelos', i)} error={errores.modelos?.[i]} mostrar={!!visible('modelos', i)} />
              </div>
            );
          })}
        </div>
        <button type="button" className="button secondary small" onClick={() => agregar('modelos', { modelo: '', alias: [], posibles: [] })}>
          Agregar modelo
        </button>
      </fieldset>

      <fieldset id="config-familias" className="config-grupo" disabled={!editable}>
        <legend>{TITULOS.familias}</legend>
        <p className="catalog-modal-intro">Qué tipo de producto es cada modelo, para cotizarlo con la tabla de precios correcta.</p>
        <div className="config-tabla config-tabla-familias">
          <div className="config-cabecera" aria-hidden="true">
            <span>Modelo</span>
            <span>Familia</span>
          </div>
          {filas.familias.map((fila, i) => (
            <div className={`config-editor-fila${conError('familias', i)}`} key={i}>
              <label className="ia-field">
                <span className="config-etiqueta">Modelo</span>
                <input value={fila.modelo} onChange={(e) => editar('familias', i, { modelo: e.target.value })} maxLength={80} {...invalida('familias', i, 'modelo')} />
              </label>
              <div className="ia-field">
                <span id={`${uid}-familia-${i}`} className="config-etiqueta">
                  Familia
                </span>
                <SelectorFamilia
                  id={`${uid}-familia-${i}`}
                  value={fila.familia}
                  opciones={FAMILIAS}
                  vacio="Elige una familia"
                  disabled={!editable}
                  seleccionar={(familia) => editar('familias', i, { familia: familia as Familia })}
                />
              </div>
              <BotonQuitar etiqueta={`familia de ${fila.modelo.trim() || 'modelo nuevo'}`} quitar={() => quitar('familias', i, `la familia de ${fila.modelo.trim() || 'un modelo'}`)} />
              <TextoError id={errorId('familias', i)} error={errores.familias?.[i]} mostrar={!!visible('familias', i)} />
            </div>
          ))}
        </div>
        <button type="button" className="button secondary small" onClick={() => agregar('familias', { modelo: '', familia: 'PUERTA' })}>
          Agregar modelo
        </button>
      </fieldset>

      <details className="config-json">
        <summary>Vista técnica (JSON)</summary>
        <pre>{JSON.stringify(borrador, null, 2)}</pre>
      </details>

      {!puedeEditar ? (
        <p className="ia-permiso">Solo quien administra el cotizador puede cambiar esta configuración.</p>
      ) : (
        <div className={`config-barra${sucio ? ' sucia' : ''}`}>
          <p role="status">{error ? '' : sucio ? 'Hay cambios sin guardar.' : 'Sin cambios pendientes.'}</p>
          {error && (
            <p className="catalog-error" role="alert">
              {error}
            </p>
          )}
          <div className="ia-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setFilas(base);
                setIntentado(false);
                setError('');
              }}
              disabled={ocupado || !sucio}
            >
              Descartar cambios
            </button>
            <button type="submit" className="button primary" disabled={ocupado || !sucio}>
              {ocupado ? 'Guardando…' : 'Guardar configuración'}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
