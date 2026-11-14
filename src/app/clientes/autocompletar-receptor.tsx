'use client';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { normalizarRut } from '@/negocio/cliente';
import { receptorTieneContenido } from '@/negocio/facturacion';
import type { ClienteAnterior } from '@/servidor/clientes';
import { receptorAEditable, type ReceptorEditable } from '../receptor-facturacion';
import { pedirJSON } from '../solicitud';

const ESPERA_SUGERENCIA_MS = 180;

/** Convierte una ficha sugerida del registro en valores editables para los campos de receptor. */
export function receptorDesdeSugerencia(c: ClienteAnterior): ReceptorEditable {
  if (receptorTieneContenido(c.receptorFacturacion)) {
    return receptorAEditable({
      ...c.receptorFacturacion,
      correo: c.receptorFacturacion?.correo ?? c.correo ?? null,
    });
  }
  return receptorAEditable({
    razonSocial: c.nombre ?? null,
    rut: c.rut ?? null,
    giro: c.giro ?? null,
    direccion: c.direccion ?? null,
    comuna: c.comuna ?? null,
    correo: c.correo ?? null,
  });
}

interface Props {
  id: string;
  campo: 'razonSocial' | 'rut';
  valor: string;
  placeholder: string;
  autoComplete?: string;
  disabled: boolean;
  permitirAutocompletar: boolean;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  alEscribir: (texto: string) => void;
  alSalir?: () => void;
  alElegirCliente: (cliente: ClienteAnterior) => void;
}

/** Campo Razón social / RUT del receptor con sugerencias opcionales desde clientes frecuentes registrados. */
export function CampoReceptorSugerido({
  id,
  campo,
  valor,
  placeholder,
  autoComplete,
  disabled,
  permitirAutocompletar,
  ariaInvalid,
  ariaDescribedBy,
  alEscribir,
  alSalir,
  alElegirCliente,
}: Props) {
  const idLista = `${id}-sugerencias-${useId()}`;
  const [sugerencias, setSugerencias] = useState<ClienteAnterior[]>([]);
  const [activa, setActiva] = useState(-1);
  const enfoque = useRef(false);
  const omitirBusqueda = useRef(false);

  useEffect(() => {
    const consulta = valor.trim();
    if (!permitirAutocompletar || disabled || !enfoque.current || omitirBusqueda.current || consulta.length < 2) {
      omitirBusqueda.current = false;
      return;
    }
    const control = new AbortController();
    const timer = setTimeout(() => {
      pedirJSON<{ clientes: ClienteAnterior[] }>(
        `/api/clientes?${new URLSearchParams({ q: consulta })}`,
        { signal: control.signal, cache: 'no-store' },
      )
        .then(({ clientes }) => {
          if (control.signal.aborted || !enfoque.current) return;
          setSugerencias(clientes.filter((c) => c.registrado));
          setActiva(-1);
        })
        .catch(() => {
          if (!control.signal.aborted) setSugerencias([]);
        });
    }, ESPERA_SUGERENCIA_MS);
    return () => {
      clearTimeout(timer);
      control.abort();
    };
  }, [valor, permitirAutocompletar, disabled]);

  function elegir(c: ClienteAnterior) {
    omitirBusqueda.current = true;
    setSugerencias([]);
    setActiva(-1);
    alElegirCliente(c);
  }

  function manejarTeclado(e: KeyboardEvent<HTMLInputElement>) {
    if (!sugerencias.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiva((i) => (i + 1) % sugerencias.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiva((i) => (i <= 0 ? sugerencias.length - 1 : i - 1));
    } else if (e.key === 'Enter' && activa >= 0 && sugerencias[activa]) {
      e.preventDefault();
      elegir(sugerencias[activa]);
    } else if (e.key === 'Escape') {
      setSugerencias([]);
      setActiva(-1);
    }
  }

  const conLista = permitirAutocompletar && sugerencias.length > 0;
  return (
    <span className="receptor-autocompletar">
      <input
        id={id}
        value={valor}
        onFocus={() => {
          enfoque.current = true;
        }}
        onChange={(e) => {
          alEscribir(e.target.value);
          if (e.target.value.trim().length < 2) setSugerencias([]);
        }}
        onBlur={() => {
          enfoque.current = false;
          setSugerencias([]);
          setActiva(-1);
          alSalir?.();
        }}
        onKeyDown={manejarTeclado}
        maxLength={300}
        placeholder={placeholder}
        autoComplete={permitirAutocompletar ? 'off' : autoComplete}
        disabled={disabled}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        {...(permitirAutocompletar
          ? {
              role: 'combobox' as const,
              'aria-autocomplete': 'list' as const,
              'aria-expanded': conLista,
              'aria-controls': conLista ? idLista : undefined,
              'aria-activedescendant': activa >= 0 && conLista ? `${idLista}-${activa}` : undefined,
            }
          : {})}
      />
      {conLista && (
        <div id={idLista} className="selector-lista" role="listbox" aria-label="Clientes frecuentes para facturar">
          {sugerencias.map((s, idx) => {
            const rec = receptorDesdeSugerencia(s);
            const titulo =
              (campo === 'rut' ? rec.rut || s.rut : rec.razonSocial || s.nombre) || s.nombre || s.rut || 'Cliente';
            const secundario =
              campo === 'rut'
                ? rec.razonSocial || s.nombre
                : normalizarRut(rec.rut ?? '') || rec.rut || s.rut;
            const detalle = [secundario, rec.giro, rec.comuna].filter(Boolean).join(' · ');
            return (
              <button
                key={s.id ?? `${s.rut ?? ''}|${idx}`}
                id={`${idLista}-${idx}`}
                type="button"
                role="option"
                className="selector-opcion receptor-opcion"
                aria-selected={activa === idx}
                data-activo={activa === idx ? 'true' : undefined}
                onMouseDown={(e) => {
                  e.preventDefault();
                  elegir(s);
                }}
              >
                <span>{titulo}</span>
                {detalle && <small className="selector-opcion-detalle">{detalle}</small>}
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}
