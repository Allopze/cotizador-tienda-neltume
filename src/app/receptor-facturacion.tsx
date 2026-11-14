'use client';
import { useId } from 'react';
import { normalizarRut } from '@/negocio/cliente';
import { correoElectronicoValido, type ReceptorFacturacion } from '@/negocio/facturacion';

export interface ReceptorEditable {
  razonSocial: string;
  rut: string;
  giro: string;
  direccion: string;
  comuna: string;
  correo: string;
}

export const receptorEditableVacio = (): ReceptorEditable => ({
  razonSocial: '',
  rut: '',
  giro: '',
  direccion: '',
  comuna: '',
  correo: '',
});

export const receptorAEditable = (receptor: Partial<ReceptorFacturacion> | null | undefined): ReceptorEditable => ({
  razonSocial: receptor?.razonSocial ?? '',
  rut: receptor?.rut ?? '',
  giro: receptor?.giro ?? '',
  direccion: receptor?.direccion ?? '',
  comuna: receptor?.comuna ?? '',
  correo: receptor?.correo ?? '',
});

export const editableAReceptor = (e: ReceptorEditable): ReceptorFacturacion => ({
  razonSocial: e.razonSocial.trim() || null,
  rut: normalizarRut(e.rut) ?? (e.rut.trim() || null),
  giro: e.giro.trim() || null,
  direccion: e.direccion.trim() || null,
  comuna: e.comuna.trim() || null,
  correo: e.correo.trim() || null,
});

/** Valida formato de RUT y correo cuando tienen contenido escrito. */
export function validarReceptorEditable(e: ReceptorEditable): { errorRut: string | null; errorCorreo: string | null } {
  const rut = e.rut.trim();
  const correo = e.correo.trim();
  return {
    errorRut: rut && !normalizarRut(rut) ? 'Revisa el RUT (ej. 76.543.210-3).' : null,
    errorCorreo: correo && !correoElectronicoValido(correo) ? 'Revisa el correo (ej. facturas@empresa.cl).' : null,
  };
}

interface Props {
  valor: ReceptorEditable;
  alCambiar: (siguiente: ReceptorEditable) => void;
  disabled?: boolean;
  prefijoId?: string;
  errores?: { rut?: string | null; correo?: string | null };
  nota?: string;
}

/** Campos reutilizables del receptor tributario para factura (al aprobar y en el seguimiento). */
export function ReceptorFacturacionCampos({
  valor,
  alCambiar,
  disabled = false,
  prefijoId = 'receptor',
  errores,
  nota = 'Comuna y correo son opcionales. La factura se emite fuera de esta app.',
}: Props) {
  const idBase = useId();
  const rutId = `${prefijoId}-${idBase}-rut`;
  const rutErrId = `${rutId}-error`;
  const correoId = `${prefijoId}-${idBase}-correo`;
  const correoErrId = `${correoId}-error`;

  const actualizar = (campo: keyof ReceptorEditable, texto: string) =>
    alCambiar({ ...valor, [campo]: texto });

  const formatearRutAlSalir = () => {
    const normalizado = normalizarRut(valor.rut);
    if (normalizado && normalizado !== valor.rut) {
      alCambiar({ ...valor, rut: normalizado });
    }
  };

  return (
    <div className="receptor-bloque">
      <div className="receptor-grid">
        <label className="ia-field receptor-campo-ancho">
          <span>Razón social *</span>
          <input
            value={valor.razonSocial}
            onChange={(e) => actualizar('razonSocial', e.target.value)}
            maxLength={300}
            placeholder="Ej. Constructora Lingue SpA"
            autoComplete="organization"
            disabled={disabled}
          />
        </label>
        <div className="ia-field">
          <label htmlFor={rutId}>RUT *</label>
          <input
            id={rutId}
            value={valor.rut}
            onChange={(e) => actualizar('rut', e.target.value)}
            onBlur={formatearRutAlSalir}
            maxLength={300}
            placeholder="76.543.210-3"
            autoComplete="off"
            disabled={disabled}
            aria-invalid={errores?.rut ? true : undefined}
            aria-describedby={errores?.rut ? rutErrId : undefined}
          />
          {errores?.rut && (
            <small id={rutErrId} className="campo-error" role="alert">
              {errores.rut}
            </small>
          )}
        </div>
        <label className="ia-field">
          <span>Giro *</span>
          <input
            value={valor.giro}
            onChange={(e) => actualizar('giro', e.target.value)}
            maxLength={300}
            placeholder="Ej. Construcción de obras"
            autoComplete="off"
            disabled={disabled}
          />
        </label>
        <label className="ia-field receptor-campo-ancho">
          <span>Dirección *</span>
          <input
            value={valor.direccion}
            onChange={(e) => actualizar('direccion', e.target.value)}
            maxLength={300}
            placeholder="Ej. Camino Villarrica Km 4"
            autoComplete="street-address"
            disabled={disabled}
          />
        </label>
        <label className="ia-field">
          <span>Comuna (opcional)</span>
          <input
            value={valor.comuna}
            onChange={(e) => actualizar('comuna', e.target.value)}
            maxLength={300}
            placeholder="Ej. Pucón"
            autoComplete="address-level2"
            disabled={disabled}
          />
        </label>
        <div className="ia-field">
          <label htmlFor={correoId}>Correo para factura (opcional)</label>
          <input
            id={correoId}
            type="email"
            value={valor.correo}
            onChange={(e) => actualizar('correo', e.target.value)}
            maxLength={300}
            placeholder="facturas@empresa.cl"
            autoComplete="email"
            disabled={disabled}
            aria-invalid={errores?.correo ? true : undefined}
            aria-describedby={errores?.correo ? correoErrId : undefined}
          />
          {errores?.correo && (
            <small id={correoErrId} className="campo-error" role="alert">
              {errores.correo}
            </small>
          )}
        </div>
      </div>
      {nota && <p className="receptor-ayuda">{nota}</p>}
    </div>
  );
}

/** Resumen de solo lectura del receptor guardado cuando la venta ya figura facturada. */
export function ResumenReceptor({ receptor }: { receptor: ReceptorFacturacion }) {
  const filas: [string, string | null][] = [
    ['Razón social', receptor.razonSocial],
    ['RUT', receptor.rut],
    ['Giro', receptor.giro],
    ['Dirección', receptor.direccion],
    ['Comuna', receptor.comuna],
    ['Correo', receptor.correo],
  ];
  return (
    <dl className="receptor-resumen">
      {filas
        .filter(([, v]) => !!v)
        .map(([etiqueta, valor]) => (
          <div key={etiqueta}>
            <dt>{etiqueta}</dt>
            <dd>{valor}</dd>
          </div>
        ))}
    </dl>
  );
}
