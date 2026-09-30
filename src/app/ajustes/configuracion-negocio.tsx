'use client';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Image from 'next/image';
import { MAX_TRAMOS, problemaTramos, type ProblemaTramos } from '@/negocio/descuento-cantidad';
import type { TipoAviso } from '../avisos';
import { esSilencioso, mensajeDe, pedirJSON } from '../solicitud';

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
interface Configuracion {
  empresa: Empresa;
  reglas: {
    ajuste: number;
    iva: number;
    vigenciaDiasHabiles: number;
    descuentoMaximo: number;
    /** Puede venir vacío; un campo vacío del formulario se guarda como NaN y se rechaza antes de enviar. */
    descuentosPorCantidad: { desdePuertas: number; porcentaje: number }[];
    margenes: Record<string, number>;
  };
  transportistas: string[];
}
interface Estado {
  configuracion: Configuracion;
  puedeEditar: boolean;
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
  ['accesorios_madera_solida', 'Marcos, molduras y piezas T de madera sólida'],
  ['otros', 'Otros productos (último recurso)'],
];

export function ConfiguracionNegocio({ avisar }: { avisar: (tipo: TipoAviso, texto: string, extra?: { clave?: string }) => number }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [borrador, setBorrador] = useState<Configuracion | null>(null);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [logoError, setLogoError] = useState('');
  // Problema de los tramos que se le muestra a la persona: se calcula al salir de un campo o al guardar, no al
  // agregar una fila vacía ni en cada tecla; una vez visible se actualiza al corregir.
  const [avisoTramos, setAvisoTramos] = useState<ProblemaTramos | null>(null);
  const idTramos = useId();
  const botonAgregar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const control = new AbortController();
    pedirJSON<Estado>('/api/configuracion-negocio', { signal: control.signal, cache: 'no-store' }).then(
      (data) => {
        setEstado(data);
        setBorrador(data.configuracion);
      },
      (causa) => {
        if (!esSilencioso(causa)) setError(mensajeDe(causa));
      },
    );
    return () => control.abort();
  }, []);

  if (!estado || !borrador)
    return <p className="catalog-modal-intro">{error || 'Cargando la configuración comercial…'}</p>;

  const editable = estado.puedeEditar;
  const tramos = borrador.reglas.descuentosPorCantidad ?? [];
  const problema = () => problemaTramos(tramos, borrador.reglas.descuentoMaximo);
  const idCampo = (indice: number, campo: 'desdePuertas' | 'porcentaje') => `${idTramos}-${indice}-${campo}`;
  const setTramos = (siguiente: typeof tramos, revisar = true) => {
    setError('');
    setBorrador({ ...borrador, reglas: { ...borrador.reglas, descuentosPorCantidad: siguiente } });
    if (revisar && avisoTramos) setAvisoTramos(problemaTramos(siguiente, borrador.reglas.descuentoMaximo));
  };
  const quitarTramo = (indice: number) => {
    setTramos(tramos.filter((_, j) => j !== indice));
    // El botón que se pulsó desaparece: el foco pasa a «Agregar tramo» en vez de perderse.
    requestAnimationFrame(() => botonAgregar.current?.focus());
  };
  /** Marca el campo con el problema (si lo hay): `aria-invalid` y descrito por el mensaje. */
  const marca = (indice: number, campo: 'desdePuertas' | 'porcentaje') => {
    const invalido = avisoTramos?.indice === indice && avisoTramos.campo === campo;
    return {
      'aria-invalid': invalido || undefined,
      'aria-describedby': avisoTramos ? `${idTramos}-error` : undefined,
    };
  };
  const setTramo = (indice: number, cambio: Partial<(typeof tramos)[number]>) =>
    setTramos(tramos.map((t, i) => (i === indice ? { ...t, ...cambio } : t)));
  const numero = (texto: string) => (texto.trim() === '' ? Number.NaN : Number(texto));
  const setEmpresa = (campo: keyof Empresa, valor: string) =>
    setBorrador((actual) => (actual ? { ...actual, empresa: { ...actual.empresa, [campo]: valor || null } } : actual));
  const campo = (campoEmpresa: keyof Empresa, etiqueta: string, multilinea = false) => {
    const valor = vacío(borrador.empresa[campoEmpresa] as string | null);
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
    if (!editable || ocupado) return;
    const invalido = problema();
    if (invalido) {
      setAvisoTramos(invalido);
      if (invalido.indice !== undefined && invalido.campo)
        document.getElementById(idCampo(invalido.indice, invalido.campo))?.focus();
      return;
    }
    setOcupado(true);
    setError('');
    try {
      const data = await pedirJSON<Estado>('/api/configuracion-negocio', { json: borrador });
      setEstado(data);
      setBorrador(data.configuracion);
      setAvisoTramos(null);
      avisar('exito', 'Configuración comercial guardada.', { clave: 'configuracion-negocio' });
    } catch (causa) {
      if (!esSilencioso(causa)) setError(mensajeDe(causa));
    } finally {
      setOcupado(false);
    }
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
    setBorrador((actual) => (actual ? { ...actual, empresa: { ...actual.empresa, logoSvg: textoLogo } } : actual));
  }

  return (
    <form onSubmit={guardar}>
      <p className="catalog-modal-intro">
        Los márgenes se aplican por categoría y quedan guardados en cada nueva cotización. Cambiar estos valores no modifica cotizaciones existentes.
      </p>
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
          <p className="muted">Sube un SVG seguro de hasta 48 KB. Si lo quitas, se usa el logo publicado por defecto.</p>
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
          {borrador.empresa.logoSvg && <button type="button" className="button secondary small" onClick={() => setBorrador({ ...borrador, empresa: { ...borrador.empresa, logoSvg: null } })} disabled={!editable || ocupado}>Usar logo predeterminado</button>}
        </div>
        {logoError && <p className="catalog-error" role="alert">{logoError}</p>}
        <Image className="logo-configuracion-vista" src={borrador.empresa.logoSvg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(borrador.empresa.logoSvg)}` : '/logo-neltume.svg'} alt="Vista previa del logo" width={180} height={90} unoptimized />
      </div>
      <h3 className="eyebrow">AJUSTES &gt; MÁRGENES</h3>
      <p className="muted">Define el margen estándar por categoría. El cambio solo se aplicará a nuevas cotizaciones.</p>
      <div className="usuario-form-grid">
        {ETIQUETAS_MARGEN.map(([clave, etiqueta]) => (
          <label className="ia-field" key={clave}>
            <span>{etiqueta} · margen (%)</span>
            <input
              type="number"
              min={0}
              max={500}
              step="0.01"
              value={Number((Number(borrador.reglas.margenes?.[clave] ?? 0) * 100).toFixed(2))}
              onChange={(e) => setBorrador({
                ...borrador,
                reglas: {
                  ...borrador.reglas,
                  margenes: { ...borrador.reglas.margenes, [clave]: Number(e.target.value) / 100 },
                },
              })}
              disabled={!editable || ocupado}
            />
          </label>
        ))}
        <label className="ia-field">
          <span>IVA (%)</span>
          <input
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={borrador.reglas.iva * 100}
            onChange={(e) => setBorrador({ ...borrador, reglas: { ...borrador.reglas, iva: Number(e.target.value) / 100 } })}
            disabled={!editable || ocupado}
          />
        </label>
        <label className="ia-field">
          <span>Vigencia (días hábiles)</span>
          <input
            type="number"
            min={0}
            max={365}
            step={1}
            value={borrador.reglas.vigenciaDiasHabiles}
            onChange={(e) => setBorrador({ ...borrador, reglas: { ...borrador.reglas, vigenciaDiasHabiles: Number(e.target.value) } })}
            disabled={!editable || ocupado}
          />
        </label>
        <label className="ia-field">
          <span>Descuento máximo (%)</span>
          <input
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={borrador.reglas.descuentoMaximo}
            onChange={(e) => setBorrador({ ...borrador, reglas: { ...borrador.reglas, descuentoMaximo: Number(e.target.value) } })}
            disabled={!editable || ocupado}
          />
        </label>
      </div>
      <div className="tramos-seccion">
        <h3 className="eyebrow">DESCUENTO POR CANTIDAD</h3>
        <p className="muted">
          Descuento automático según el total de puertas de la cotización (marcos, molduras y piezas T no cuentan). Se aplica el
          tramo más alto alcanzado y nunca supera el descuento máximo; quien cotiza puede cambiarlo en su cotización. Solo rige
          en las cotizaciones nuevas.
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
                  id={idCampo(i, 'desdePuertas')}
                  type="number"
                  min={2}
                  step={1}
                  aria-label={`Tramo ${i + 1}: desde (puertas)`}
                  value={Number.isFinite(t.desdePuertas) ? t.desdePuertas : ''}
                  onChange={(e) => setTramo(i, { desdePuertas: numero(e.target.value) })}
                  disabled={!editable || ocupado}
                  {...marca(i, 'desdePuertas')}
                />
              </label>
              <label className="ia-field">
                <span>Descuento (%)</span>
                <input
                  id={idCampo(i, 'porcentaje')}
                  type="number"
                  min={0}
                  max={borrador.reglas.descuentoMaximo}
                  step="0.01"
                  aria-label={`Tramo ${i + 1}: descuento (%)`}
                  value={Number.isFinite(t.porcentaje) ? t.porcentaje : ''}
                  onChange={(e) => setTramo(i, { porcentaje: numero(e.target.value) })}
                  disabled={!editable || ocupado}
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
            onClick={() => setTramos([...tramos, { desdePuertas: Number.NaN, porcentaje: Number.NaN }], false)}
            disabled={ocupado || tramos.length >= MAX_TRAMOS}
          >
            Agregar tramo
          </button>
        )}
        {avisoTramos && (
          <p className="catalog-error" id={`${idTramos}-error`} role="alert">
            {avisoTramos.mensaje}
          </p>
        )}
      </div>
      <h3 className="eyebrow">TRANSPORTISTAS</h3>
      <label className="ia-field">
        <span>Opciones de despacho, una por línea</span>
        <textarea
          rows={4}
          maxLength={800}
          value={borrador.transportistas.join('\n')}
          onChange={(e) => setBorrador({ ...borrador, transportistas: [...new Set(e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))] })}
          disabled={!editable || ocupado}
        />
      </label>
      {error && <p className="catalog-error" role="alert">{error}</p>}
      {editable && (
        <div className="ia-actions">
          <button type="button" className="button secondary" onClick={() => setBorrador(estado.configuracion)} disabled={ocupado}>Descartar cambios</button>
          <button type="submit" className="button primary" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar configuración'}</button>
        </div>
      )}
    </form>
  );
}
