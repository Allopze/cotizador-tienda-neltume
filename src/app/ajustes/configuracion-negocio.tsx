'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Image from 'next/image';
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
  reglas: { ajuste: number; iva: number; vigenciaDiasHabiles: number; descuentoMaximo: number; margenes: Record<string, number> };
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
    setOcupado(true);
    setError('');
    try {
      const data = await pedirJSON<Estado>('/api/configuracion-negocio', { json: borrador });
      setEstado(data);
      setBorrador(data.configuracion);
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
