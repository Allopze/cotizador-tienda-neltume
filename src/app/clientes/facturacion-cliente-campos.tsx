'use client';
import type { TipoDocumentoTributario } from '@/negocio/facturacion';
import {
  ReceptorFacturacionCampos,
  type ReceptorEditable,
} from '../receptor-facturacion';

export type OpcionDocumentoCliente = 'sin_definir' | TipoDocumentoTributario;

interface Props {
  documento: OpcionDocumentoCliente;
  alCambiarDocumento: (doc: OpcionDocumentoCliente) => void;
  receptor: ReceptorEditable;
  alCambiarReceptor: (rec: ReceptorEditable) => void;
  erroresReceptor?: { rut?: string | null; correo?: string | null };
  disabled: boolean;
  alCopiarDesdeCliente: () => void;
}

/** Preferencia de documento y receptor por omisión dentro de la ficha de un cliente frecuente. */
export function FacturacionClienteCampos({
  documento,
  alCambiarDocumento,
  receptor,
  alCambiarReceptor,
  erroresReceptor,
  disabled,
  alCopiarDesdeCliente,
}: Props) {
  return (
    <div className="facturacion-bloque-dialogo">
      <div className="cliente-facturacion-fila">
        <p className="facturacion-bloque-titulo">Documento habitual al aprobar (opcional)</p>
        {documento === 'factura' && (
          <button
            type="button"
            className="button secondary small"
            onClick={alCopiarDesdeCliente}
            disabled={disabled}
          >
            Copiar datos de la ficha
          </button>
        )}
      </div>
      <fieldset className="facturacion-opciones-fila" aria-label="Documento habitual del cliente">
        {(
          [
            ['sin_definir', 'Sin definir'],
            ['boleta', 'Boleta'],
            ['factura', 'Factura'],
          ] as const
        ).map(([valor, etiqueta]) => (
          <label key={valor} className="facturacion-pill">
            <input
              type="radio"
              name="cliente-documento-habitual"
              value={valor}
              checked={documento === valor}
              disabled={disabled}
              onChange={() => alCambiarDocumento(valor)}
            />
            <span>{etiqueta}</span>
          </label>
        ))}
      </fieldset>
      {documento === 'factura' && (
        <ReceptorFacturacionCampos
          valor={receptor}
          alCambiar={alCambiarReceptor}
          disabled={disabled}
          prefijoId="cliente-defecto"
          errores={erroresReceptor}
          permitirAutocompletar={false}
          nota="Opcional. Útil si este cliente factura con otra razón social o correo. Solo precarga nuevas cotizaciones con su RUT."
        />
      )}
    </div>
  );
}
