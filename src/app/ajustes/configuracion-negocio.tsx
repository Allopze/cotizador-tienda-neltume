'use client';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Image from 'next/image';
import { aCentesimas, conDosDecimales, leerPorcentaje, margenAPorcentaje, porcentajeAMargen } from '@/negocio/cifras';
import { MAX_TRAMOS, problemaTramos, type ProblemaTramos } from '@/negocio/descuento-cantidad';
import { MARGEN_MAX } from '@/negocio/limites';
import type { TipoAviso } from '../avisos';
import { esSilencioso, mensajeDe, pedirJSON } from '../solicitud';
import { SeccionAvanzada } from './avanzado';
import { AccionesGuardar, SinPermiso, useAvisarCambios, useBorrador } from './borrador';

interface Empresa {
  nombre: string | null;
  rut: string | null;
  direccion: string | null;
  telefono: string | null;
  correo: string;
  web: string | null;
  condicionesPago: string | null;
  plazoEntrega: string | null;
  datosBancarios: string | null;
  logoSvg: string | null;
}
interface Reglas {
  ajuste: number;
  iva: number;
  vigenciaDiasHabiles: number;
  descuentoMaximo: number;
  /** Puede venir vacío; un campo vacío del formulario se guarda como NaN y se rechaza antes de enviar. */
  descuentosPorCantidad: { desdePuertas: number; porcentaje: number }[];
  margenes: Record<string, number>;
}
interface Configuracion {
  empresa: Empresa;
  reglas: Reglas;
  transportistas: string[];
}
interface Estado {
  configuracion: Configuracion;
  puedeEditar: boolean;
}
type Avisar = (tipo: TipoAviso, texto: string, extra?: { clave?: string }) => number;
interface PropsBloque {
  negocio: Negocio;
  avisar: Avisar;
  alCambiar?: (sucio: boolean) => void;
}

const vacío = (v: string | null) => v ?? '';
const ETIQUETAS_MARGEN: [string, string][] = [
  ['puertas_solidas_mara_lenga', 'Puertas sólidas Mara / Lenga'],
  ['puertas_solidas_oregon', 'Puertas sólidas Pino Oregón'],
  ['puertas_solidas_rauli', 'Puertas sólidas Raulí'],
  ['puertas_prepintadas', 'Puertas prepintadas'],
  ['puertas_enchapadas_mara', 'Puertas enchapadas Mara'],
  ['marcos_finger_sin_enchape', 'Marcos Pino Finger sin enchape'],
  ['marcos_finger_enchapados', 'Marcos Pino Finger enchapados'],
  ['marcos_solidos_oregon', 'Marcos sólidos Pino Oregón'],
  ['marcos_solidos_lenga', 'Marcos sólidos Lenga'],
  ['accesorios_madera_solida', 'Marcos, molduras y piezas T de madera sólida'],
  ['otros', 'Otros productos (último recurso)'],
];

/**
 * Configuración comercial, leída una vez para los tres bloques de Ajustes (empresa, precios y cotizaciones).
 * Cada bloque guarda solo su parte sobre lo último guardado: los cambios a medias de otro bloque no viajan.
 */
export function useConfiguracionNegocio() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [error, setError] = useState('');
  const [intento, setIntento] = useState(0);
  // Lo último guardado, para que dos bloques que guardan seguidos no se pisen.
  const ultimo = useRef<Estado | null>(null);

  useEffect(() => {
    const control = new AbortController();
    pedirJSON<Estado>('/api/configuracion-negocio', { signal: control.signal, cache: 'no-store' }).then(
      (data) => {
        ultimo.current = data;
        setEstado(data);
        setError('');
      },
      (causa) => {
        if (!esSilencioso(causa)) setError(mensajeDe(causa));
      },
    );
    return () => control.abort();
  }, [intento]);

  const guardar = useCallback(async (cambio: (actual: Configuracion) => Configuracion) => {
    if (!ultimo.current) throw new Error('La configuración comercial aún no se carga.');
    const data = await pedirJSON<Estado>('/api/configuracion-negocio', {
      json: cambio(ultimo.current.configuracion),
    });
    ultimo.current = data;
    setEstado(data);
    return data.configuracion;
  }, []);

  return {
    estado,
    error,
    reintentar: () => {
      setError('');
      setIntento((n) => n + 1);
    },
    guardar,
  };
}
export type Negocio = ReturnType<typeof useConfiguracionNegocio>;

/** Muestra la carga o el error de la configuración comercial; con ella lista, el bloque. */
function ConNegocio({ negocio, children }: { negocio: Negocio; children: (estado: Estado) => ReactNode }) {
  if (negocio.estado) return children(negocio.estado);
  if (negocio.error)
    return (
      <p className="catalog-error" role="alert">
        {negocio.error}{' '}
        <button type="button" className="link" onClick={negocio.reintentar}>
          Reintentar
        </button>
      </p>
    );
  return (
    <p className="catalog-modal-intro" role="status">
      Cargando la configuración comercial…
    </p>
  );
}

/** Estado de envío de un bloque: ocupado, error y guardar con su aviso de éxito. */
function useEnvio(negocio: Negocio, avisar: Avisar, mensaje: string) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const enviar = async (cambio: (actual: Configuracion) => Configuracion) => {
    setOcupado(true);
    setError('');
    try {
      const guardada = await negocio.guardar(cambio);
      avisar('exito', mensaje, { clave: 'configuracion-negocio' });
      return guardada;
    } catch (causa) {
      if (!esSilencioso(causa)) setError(mensajeDe(causa));
      return null;
    } finally {
      setOcupado(false);
    }
  };
  return { ocupado, error, setError, enviar };
}


export function DatosEmpresa(props: PropsBloque) {
  return <ConNegocio negocio={props.negocio}>{(estado) => <FormularioEmpresa {...props} estado={estado} />}</ConNegocio>;
}

function FormularioEmpresa({ negocio, avisar, alCambiar, estado }: PropsBloque & { estado: Estado }) {
  const { borrador, setBorrador, sucio, descartar } = useBorrador(estado.configuracion.empresa);
  const { ocupado, error, enviar } = useEnvio(negocio, avisar, 'Datos de la empresa guardados.');
  const [logoError, setLogoError] = useState('');
  useAvisarCambios(sucio, alCambiar);
  const editable = estado.puedeEditar;

  const setEmpresa = (campo: keyof Empresa, valor: string) =>
    setBorrador((actual) => ({ ...actual, [campo]: valor || null }));
  const campo = (campoEmpresa: keyof Empresa, etiqueta: string, multilinea = false) => {
    const valor = vacío(borrador[campoEmpresa]);
    return (
      <label className="ia-field" key={campoEmpresa}>
        <span>{etiqueta}</span>
        {multilinea ? (
          <textarea value={valor} onChange={(e) => setEmpresa(campoEmpresa, e.target.value)} rows={3} maxLength={1200} disabled={!editable || ocupado} />
        ) : (
          <input
            value={valor}
            onChange={(e) => setEmpresa(campoEmpresa, e.target.value)}
            type={campoEmpresa === 'correo' ? 'email' : 'text'}
            maxLength={campoEmpresa === 'correo' ? 254 : 300}
            disabled={!editable || ocupado}
          />
        )}
      </label>
    );
  };

  async function guardar(evento: FormEvent) {
    evento.preventDefault();
    if (!editable || ocupado || !sucio) return;
    const guardada = await enviar((actual) => ({ ...actual, empresa: borrador }));
    if (guardada) setBorrador(guardada.empresa);
  }

  async function seleccionarLogo(evento: React.ChangeEvent<HTMLInputElement>) {
    const archivo = evento.target.files?.[0];
    evento.target.value = '';
    if (!archivo) return;
    if (archivo.size > 48_000 || (archivo.type && archivo.type !== 'image/svg+xml' && !archivo.name.toLowerCase().endsWith('.svg'))) {
      setLogoError('El logo debe ser un archivo SVG de hasta 48 KB.');
      return;
    }
    const textoLogo = await archivo.text();
    if (!/<svg(?:\s|>)/i.test(textoLogo) || /<script|<foreignObject|\son\w+\s*=|javascript:/i.test(textoLogo)) {
      setLogoError('El SVG no tiene un formato permitido.');
      return;
    }
    setLogoError('');
    setBorrador((actual) => ({ ...actual, logoSvg: textoLogo }));
  }

  return (
    <form onSubmit={guardar} aria-label="Datos de la empresa">
      <p className="catalog-modal-intro">Datos de contacto, condiciones comerciales y logo que acompañan a las cotizaciones.</p>
      {!editable && <SinPermiso />}
      <div className="usuario-form-grid">
        {campo('nombre', 'Nombre de la empresa')}
        {campo('rut', 'RUT')}
        {campo('direccion', 'Dirección')}
        {campo('telefono', 'Teléfono')}
        {campo('correo', 'Correo de contacto')}
        {campo('web', 'Sitio web')}
        {campo('condicionesPago', 'Condiciones de pago', true)}
        {campo('plazoEntrega', 'Plazo de entrega', true)}
        {campo('datosBancarios', 'Datos bancarios', true)}
      </div>
      <div className="logo-configuracion">
        <div>
          <span className="ia-field-label">Logo para la aplicación y los documentos</span>
          <p className="muted">Sube un SVG de hasta 48 KB. Si lo quitas, se usa el logo de Neltume.</p>
        </div>
        <div className="logo-configuracion-acciones">
          {/* La etiqueta nombra al control y le da el aspecto del resto de los botones del formulario. */}
          <label className="button secondary small archivo-campo">
            Seleccionar logo
            <input
              type="file"
              accept="image/svg+xml,.svg"
              onChange={(e) => void seleccionarLogo(e)}
              disabled={!editable || ocupado}
            />
          </label>
          {borrador.logoSvg && <button type="button" className="button secondary small" onClick={() => setBorrador({ ...borrador, logoSvg: null })} disabled={!editable || ocupado}>Usar logo predeterminado</button>}
        </div>
        {logoError && <p className="catalog-error" role="alert">{logoError}</p>}
        <Image className="logo-configuracion-vista" src={borrador.logoSvg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(borrador.logoSvg)}` : '/logo-neltume.svg'} alt="Vista previa del logo" width={180} height={90} unoptimized />
      </div>
      {editable ? (
        <AccionesGuardar sucio={sucio} ocupado={ocupado} error={error} descartar={() => { setLogoError(''); descartar(); }} />
      ) : (
        error && <p className="catalog-error" role="alert">{error}</p>
      )}
    </form>
  );
}

/** Número de un campo de Ajustes como se escribe: con coma decimal (0,42 → «42»; 19,5 → «19,5»). */
const aTexto = (n: number) => (Number.isFinite(n) ? String(n).replace('.', ',') : '');
/** Porcentaje escrito con coma o punto decimal; vacío o ilegible es NaN, nunca 0. */
const leerCampo = (texto: string) => (texto.trim() === '' ? Number.NaN : leerPorcentaje(texto));
/** Entero escrito (días, puertas); vacío o con decimales es NaN. */
const leerEntero = (texto: string) => (/^\s*\d+\s*$/.test(texto) ? Number(texto) : Number.NaN);
/** Error de un porcentaje escrito, o null: dentro de [mínimo, máximo] y con hasta dos decimales. */
function errorPorcentaje(texto: string, maximo: number) {
  const n = leerCampo(texto);
  if (Number.isNaN(n)) return 'Escribe un número, por ejemplo 19 o 2,5.';
  if (n > maximo) return `No puede superar ${maximo.toLocaleString('es-CL')} %.`;
  if (!conDosDecimales(n)) return 'Usa como máximo dos decimales.';
  return null;
}

/** Campo numérico escrito como texto (acepta coma decimal), con su error junto al campo. */
function CampoCifra({
  id,
  etiqueta,
  valor,
  cambiar,
  error,
  disabled,
  entero = false,
}: {
  id: string;
  etiqueta: string;
  valor: string;
  cambiar: (valor: string) => void;
  error?: string | null;
  disabled: boolean;
  entero?: boolean;
}) {
  return (
    <label className="ia-field">
      <span>{etiqueta}</span>
      <input
        id={id}
        inputMode={entero ? 'numeric' : 'decimal'}
        maxLength={8}
        value={valor}
        onChange={(e) => cambiar(e.target.value)}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && (
        <small className="campo-error" id={`${id}-error`}>
          {error}
        </small>
      )}
    </label>
  );
}

interface PreciosTexto {
  margenes: Record<string, string>;
  iva: string;
  descuentoMaximo: string;
  tramos: { desde: string; porcentaje: string }[];
}
const aPrecios = (r: Reglas): PreciosTexto => ({
  margenes: Object.fromEntries(ETIQUETAS_MARGEN.map(([clave]) => [clave, aTexto(margenAPorcentaje(r.margenes?.[clave] ?? 0))])),
  iva: aTexto(margenAPorcentaje(r.iva)),
  descuentoMaximo: aTexto(r.descuentoMaximo),
  tramos: (r.descuentosPorCantidad ?? []).map((t) => ({ desde: String(t.desdePuertas), porcentaje: aTexto(t.porcentaje) })),
});
const tramosNumericos = (p: PreciosTexto) =>
  p.tramos.map((t) => ({ desdePuertas: leerEntero(t.desde), porcentaje: leerCampo(t.porcentaje) }));
/**
 * Errores por campo (clave del campo → mensaje), en el orden de la pantalla: primero el descuento máximo, a la
 * vista, y después las ganancias y el IVA de «Avanzado». Los tramos se revisan aparte, con su propio aviso.
 */
function erroresPrecios(p: PreciosTexto) {
  const errores: Record<string, string> = {};
  const maximo = errorPorcentaje(p.descuentoMaximo, 50);
  if (maximo) errores.descuentoMaximo = maximo;
  for (const [clave] of ETIQUETAS_MARGEN) {
    const e = errorPorcentaje(p.margenes[clave] ?? '', MARGEN_MAX * 100);
    if (e) errores[`margen-${clave}`] = e;
  }
  const iva = errorPorcentaje(p.iva, 100);
  if (iva) errores.iva = iva;
  return errores;
}
/** Campos que viven en «Avanzado»: con un error ahí, el bloque se abre para mostrarlo. */
const enAvanzado = (clave: string) => clave === 'iva' || clave.startsWith('margen-');

export function PreciosDescuentos(props: PropsBloque) {
  return <ConNegocio negocio={props.negocio}>{(estado) => <FormularioPrecios {...props} estado={estado} />}</ConNegocio>;
}

function FormularioPrecios({ negocio, avisar, alCambiar, estado }: PropsBloque & { estado: Estado }) {
  const { borrador, setBorrador, sucio, descartar } = useBorrador(aPrecios(estado.configuracion.reglas));
  const { ocupado, error, setError, enviar } = useEnvio(negocio, avisar, 'Precios y descuentos guardados.');
  // Errores de cada campo: se calculan al guardar y, una vez visibles, se actualizan al corregir.
  const [errores, setErrores] = useState<Record<string, string> | null>(null);
  // Problema de los tramos que se le muestra a la persona: se calcula al salir de un campo o al guardar, no al
  // agregar una fila vacía ni en cada tecla; una vez visible se actualiza al corregir.
  const [avisoTramos, setAvisoTramos] = useState<ProblemaTramos | null>(null);
  const idBase = useId();
  const botonAgregar = useRef<HTMLButtonElement>(null);
  const avanzado = useRef<HTMLDetailsElement>(null);
  useAvisarCambios(sucio, alCambiar);

  const editable = estado.puedeEditar;
  const desactivado = !editable || ocupado;
  const idCampo = (clave: string) => `${idBase}-${clave}`;
  // Con un descuento máximo ilegible los tramos no se comparan contra él (ese error ya se ve en su campo).
  const maximoTramos = (p: PreciosTexto) => {
    const n = leerCampo(p.descuentoMaximo);
    return Number.isFinite(n) ? n : 100;
  };
  const problema = (p = borrador) => problemaTramos(tramosNumericos(p), maximoTramos(p));
  const cambiar = (siguiente: PreciosTexto, revisarTramos = true) => {
    setError('');
    setBorrador(siguiente);
    if (errores) setErrores(erroresPrecios(siguiente));
    if (revisarTramos && avisoTramos) setAvisoTramos(problema(siguiente));
  };
  const tramos = borrador.tramos;
  const idTramo = (indice: number, campo: 'desdePuertas' | 'porcentaje') => idCampo(`tramo-${indice}-${campo}`);
  const setTramo = (indice: number, cambio: Partial<PreciosTexto['tramos'][number]>) =>
    cambiar({ ...borrador, tramos: tramos.map((t, i) => (i === indice ? { ...t, ...cambio } : t)) });
  const quitarTramo = (indice: number) => {
    cambiar({ ...borrador, tramos: tramos.filter((_, j) => j !== indice) });
    // El botón que se pulsó desaparece: el foco pasa a «Agregar tramo» en vez de perderse.
    requestAnimationFrame(() => botonAgregar.current?.focus());
  };
  /** Marca el campo del tramo con el problema (si lo hay): `aria-invalid` y descrito por el mensaje. */
  const marca = (indice: number, campo: 'desdePuertas' | 'porcentaje') => {
    const invalido = avisoTramos?.indice === indice && avisoTramos.campo === campo;
    return {
      'aria-invalid': invalido || undefined,
      'aria-describedby': avisoTramos ? `${idBase}-tramos-error` : undefined,
    };
  };

  async function guardar(evento: FormEvent) {
    evento.preventDefault();
    if (!editable || ocupado || !sucio) return;
    const enCampos = erroresPrecios(borrador);
    const primero = Object.keys(enCampos)[0];
    if (primero) {
      setErrores(enCampos);
      // Un error dentro de «Avanzado» plegado no se vería: se abre antes de llevar el foco.
      if (avanzado.current && Object.keys(enCampos).some(enAvanzado)) avanzado.current.open = true;
      document.getElementById(idCampo(primero))?.focus();
      return;
    }
    setErrores(null);
    const invalido = problema();
    if (invalido) {
      setAvisoTramos(invalido);
      if (invalido.indice !== undefined && invalido.campo)
        document.getElementById(idTramo(invalido.indice, invalido.campo))?.focus();
      return;
    }
    const reglas = {
      margenes: Object.fromEntries(
        ETIQUETAS_MARGEN.map(([clave]) => [clave, porcentajeAMargen(leerCampo(borrador.margenes[clave]))]),
      ),
      iva: porcentajeAMargen(leerCampo(borrador.iva)),
      descuentoMaximo: aCentesimas(leerCampo(borrador.descuentoMaximo)),
      descuentosPorCantidad: tramosNumericos(borrador).map((t) => ({ ...t, porcentaje: aCentesimas(t.porcentaje) })),
    };
    const guardada = await enviar((actual) => ({ ...actual, reglas: { ...actual.reglas, ...reglas } }));
    if (guardada) {
      setBorrador(aPrecios(guardada.reglas));
      setAvisoTramos(null);
    }
  }

  return (
    <form onSubmit={guardar} aria-label="Precios y descuentos" noValidate>
      <p className="catalog-modal-intro">
        Estos valores se copian en cada cotización nueva. Cambiarlos no modifica las cotizaciones existentes.
      </p>
      {!editable && <SinPermiso />}
      <h3 className="eyebrow">TOPE DE DESCUENTO</h3>
      <div className="usuario-form-grid">
        <CampoCifra
          id={idCampo('descuentoMaximo')}
          etiqueta="Descuento máximo (%)"
          valor={borrador.descuentoMaximo}
          cambiar={(descuentoMaximo) => cambiar({ ...borrador, descuentoMaximo })}
          error={errores?.descuentoMaximo}
          disabled={desactivado}
        />
      </div>
      <div className="tramos-seccion">
        <h3 className="eyebrow">DESCUENTO POR CANTIDAD</h3>
        <p className="muted">
          Descuento automático según el total de puertas de la cotización (marcos, molduras y piezas T no cuentan). Se aplica el
          tramo más alto alcanzado y nunca supera el descuento máximo; quien cotiza puede cambiarlo en su cotización.
        </p>
        {tramos.length === 0 && <p className="muted">Sin tramos: las cotizaciones no llevan descuento por cantidad.</p>}
        <div className="tramos-descuento">
          {tramos.map((t, i) => (
            <div
              className="tramo-descuento"
              key={i}
              // Se valida al salir de la fila (no al pasar de «Desde» al porcentaje, que aún está vacío) y solo
              // lo de esa fila y las anteriores: las de más abajo, todavía sin llenar, se revisan al llegar a ellas.
              onBlur={(e) => {
                if (e.currentTarget.contains(e.relatedTarget)) return;
                const actual = problema();
                if (!actual) setAvisoTramos(null);
                else if (actual.indice === undefined || actual.indice <= i) setAvisoTramos(actual);
              }}
            >
              <label className="ia-field">
                <span>Desde (puertas)</span>
                <input
                  id={idTramo(i, 'desdePuertas')}
                  inputMode="numeric"
                  maxLength={5}
                  aria-label={`Tramo ${i + 1}: desde (puertas)`}
                  value={t.desde}
                  onChange={(e) => setTramo(i, { desde: e.target.value })}
                  disabled={desactivado}
                  {...marca(i, 'desdePuertas')}
                />
              </label>
              <label className="ia-field">
                <span>Descuento (%)</span>
                <input
                  id={idTramo(i, 'porcentaje')}
                  inputMode="decimal"
                  maxLength={8}
                  aria-label={`Tramo ${i + 1}: descuento (%)`}
                  value={t.porcentaje}
                  onChange={(e) => setTramo(i, { porcentaje: e.target.value })}
                  disabled={desactivado}
                  {...marca(i, 'porcentaje')}
                />
              </label>
              {editable && (
                <button
                  type="button"
                  className="button secondary small"
                  aria-label={`Quitar el tramo ${i + 1}`}
                  onClick={() => quitarTramo(i)}
                  disabled={ocupado}
                >
                  Quitar
                </button>
              )}
            </div>
          ))}
        </div>
        {editable && (
          <button
            ref={botonAgregar}
            type="button"
            className="button secondary small"
            onClick={() => cambiar({ ...borrador, tramos: [...tramos, { desde: '', porcentaje: '' }] }, false)}
            disabled={ocupado || tramos.length >= MAX_TRAMOS}
          >
            Agregar tramo
          </button>
        )}
        {avisoTramos && (
          <p className="catalog-error" id={`${idBase}-tramos-error`} role="alert">
            {avisoTramos.mensaje}
          </p>
        )}
      </div>
      <SeccionAvanzada
        ref={avanzado}
        titulo="IVA y ganancia por categoría"
        advertencia={
          <>
            Cambian el precio de todas las cotizaciones nuevas. Un valor equivocado (por ejemplo, IVA 1,9 en vez de
            19) deja mal cada precio que se cotice después. Cámbialos solo cuando Neltume lo haya decidido.
          </>
        }
      >
        <h3 className="eyebrow">GANANCIA SOBRE EL COSTO DE FÁBRICA</h3>
        <p className="muted">
          Porcentaje que se suma al costo de fábrica de cada producto para llegar al precio sin IVA de la cotización.
        </p>
        <div className="usuario-form-grid">
          {ETIQUETAS_MARGEN.map(([clave, etiqueta]) => (
            <CampoCifra
              key={clave}
              id={idCampo(`margen-${clave}`)}
              etiqueta={`${etiqueta} (%)`}
              valor={borrador.margenes[clave] ?? ''}
              cambiar={(valor) => cambiar({ ...borrador, margenes: { ...borrador.margenes, [clave]: valor } }, false)}
              error={errores?.[`margen-${clave}`]}
              disabled={desactivado}
            />
          ))}
        </div>
        <h3 className="eyebrow ajustes-subtitulo">IVA</h3>
        <div className="usuario-form-grid">
          <CampoCifra
            id={idCampo('iva')}
            etiqueta="IVA (%)"
            valor={borrador.iva}
            cambiar={(iva) => cambiar({ ...borrador, iva }, false)}
            error={errores?.iva}
            disabled={desactivado}
          />
        </div>
      </SeccionAvanzada>
      {!editable && error && <p className="catalog-error" role="alert">{error}</p>}
      {editable && (
        <AccionesGuardar
          sucio={sucio}
          ocupado={ocupado}
          error={errores && Object.keys(errores).length > 0 ? 'Revisa los campos marcados antes de guardar.' : error}
          descartar={() => {
            setErrores(null);
            setAvisoTramos(null);
            setError('');
            descartar();
          }}
        />
      )}
    </form>
  );
}

/** Lista de transportistas tal como se guarda: sin espacios sobrantes, sin líneas vacías ni repetidas. */
const listaTransportistas = (texto: string) => [...new Set(texto.split('\n').map((x) => x.trim()).filter(Boolean))];
interface Cotizaciones {
  vigenciaDiasHabiles: string;
  /** Se edita como texto (una opción por línea) y se ordena recién al guardar, para poder escribir líneas nuevas. */
  transportistas: string;
}
const claveCotizaciones = (c: Cotizaciones) =>
  JSON.stringify([c.vigenciaDiasHabiles.trim(), listaTransportistas(c.transportistas)]);
const errorVigencia = (texto: string) => {
  const n = leerEntero(texto);
  return Number.isNaN(n) || n > 365 ? 'Escribe un número entero de días, entre 0 y 365.' : null;
};

export function CotizacionesDespacho(props: PropsBloque) {
  return <ConNegocio negocio={props.negocio}>{(estado) => <FormularioCotizaciones {...props} estado={estado} />}</ConNegocio>;
}

function FormularioCotizaciones({ negocio, avisar, alCambiar, estado }: PropsBloque & { estado: Estado }) {
  const aCotizaciones = (c: Configuracion): Cotizaciones => ({
    vigenciaDiasHabiles: String(c.reglas.vigenciaDiasHabiles),
    transportistas: c.transportistas.join('\n'),
  });
  const { borrador, setBorrador, sucio, descartar } = useBorrador(aCotizaciones(estado.configuracion), claveCotizaciones);
  const { ocupado, error, setError, enviar } = useEnvio(negocio, avisar, 'Vigencia y transportistas guardados.');
  // Error de la vigencia: se muestra al guardar y, una vez visible, se actualiza al corregir.
  const [errorDias, setErrorDias] = useState<string | null>(null);
  const idDias = useId();
  useAvisarCambios(sucio, alCambiar);
  const editable = estado.puedeEditar;

  async function guardar(evento: FormEvent) {
    evento.preventDefault();
    if (!editable || ocupado || !sucio) return;
    const problema = errorVigencia(borrador.vigenciaDiasHabiles);
    setErrorDias(problema);
    if (problema) {
      document.getElementById(idDias)?.focus();
      return;
    }
    const guardada = await enviar((actual) => ({
      ...actual,
      reglas: { ...actual.reglas, vigenciaDiasHabiles: leerEntero(borrador.vigenciaDiasHabiles) },
      transportistas: listaTransportistas(borrador.transportistas),
    }));
    if (guardada) setBorrador(aCotizaciones(guardada));
  }

  return (
    <form onSubmit={guardar} aria-label="Vigencia y transportistas" noValidate>
      <p className="catalog-modal-intro">Rige para las cotizaciones nuevas; las existentes conservan lo que tenían.</p>
      {!editable && <SinPermiso />}
      <div className="usuario-form-grid">
        <CampoCifra
          id={idDias}
          etiqueta="Vigencia (días hábiles)"
          entero
          valor={borrador.vigenciaDiasHabiles}
          cambiar={(vigenciaDiasHabiles) => {
            setError('');
            setBorrador({ ...borrador, vigenciaDiasHabiles });
            if (errorDias) setErrorDias(errorVigencia(vigenciaDiasHabiles));
          }}
          error={errorDias}
          disabled={!editable || ocupado}
        />
      </div>
      <p className="muted">
        No cuentan los fines de semana ni los feriados de Chile, que se actualizan solos (incluidos los decretados por
        única vez, como los de elecciones).
      </p>
      <h3 className="eyebrow ajustes-subtitulo">TRANSPORTISTAS</h3>
      <label className="ia-field">
        <span>Opciones de despacho, una por línea</span>
        <textarea
          rows={4}
          maxLength={800}
          value={borrador.transportistas}
          onChange={(e) => setBorrador({ ...borrador, transportistas: e.target.value })}
          disabled={!editable || ocupado}
        />
      </label>
      {!editable && error && <p className="catalog-error" role="alert">{error}</p>}
      {editable && (
        <AccionesGuardar
          sucio={sucio}
          ocupado={ocupado}
          error={error}
          descartar={() => {
            setErrorDias(null);
            descartar();
          }}
        />
      )}
    </form>
  );
}
