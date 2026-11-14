'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { normalizarRut, rutCompacto } from '@/negocio/cliente';
import type { ClienteRegistrado } from '@/negocio/cliente-registro';
import type { Cotizacion } from '@/negocio/estado';
import type { ClienteAnterior } from '@/servidor/clientes';
import { CampoEditable, type SugerenciaCampo } from '../campo-editable';
import type { CambiosEdicion } from '../contrato';
import { ETIQUETA_CAMPO, SIN_CLIENTE } from '../formato';
import { ErrorSolicitud, codigoDe, esSilencioso, mensajeDe, pedirJSON } from '../solicitud';
import { buscarRegistroPorRut } from './cliente-registro-api';

const CAMPOS_CLIENTE = ['nombre', 'rut', 'giro', 'comuna', 'direccion', 'telefono', 'proyecto'] as const;
/** Datos que completa un cliente de otra cotización; el proyecto es de cada cotización y no se copia. */
const CAMPOS_CLIENTE_ANTERIOR = ['nombre', 'rut', 'giro', 'telefono', 'direccion', 'comuna'] as const;

const AYUDA_AUTOCOMPLETAR = 'Escribe el nombre o el RUT para buscar clientes anteriores';

/** Lo que trae el cliente elegido; un dato que no tiene no borra el ya escrito en esta cotización. */
export function datosClienteAnterior(c: ClienteAnterior): CambiosEdicion['cliente'] {
  const datos: NonNullable<CambiosEdicion['cliente']> = {};
  for (const campo of CAMPOS_CLIENTE_ANTERIOR) if (c[campo]) datos[campo] = c[campo];
  return datos;
}

interface Props {
  actual: Cotizacion;
  editable: boolean;
  admiteCambios: boolean;
  guardando: string | null;
  editar: (cambios: CambiosEdicion, campo: string) => Promise<boolean>;
}

/** Sección desplegable «Cliente y facturación» dentro del panel derecho de la cotización. */
export function BloqueClienteCotizacion({ actual, editable, admiteCambios, guardando, editar }: Props) {
  const rutCot = actual.cliente.rut;
  const rutComp = rutCompacto(rutCot);
  const claveCliente = `${actual.id}|${rutComp}|${actual.cliente.nombre ?? ''}`;
  const [registroEstado, setRegistroEstado] = useState<{
    clave: string;
    cliente: ClienteRegistrado | null;
  }>({ clave: '', cliente: null });
  const [guardandoRegistro, setGuardandoRegistro] = useState(false);
  const [errorRegistro, setErrorRegistro] = useState('');
  const [avisoRegistro, setAvisoRegistro] = useState('');

  useEffect(() => {
    if (!rutComp) return;
    const control = new AbortController();
    buscarRegistroPorRut(rutCot, control.signal)
      .then((cliente) => {
        if (!control.signal.aborted) setRegistroEstado({ clave: claveCliente, cliente });
      })
      .catch(() => {});
    return () => control.abort();
  }, [claveCliente, rutComp, rutCot]);

  const clienteRegistrado = registroEstado.clave === claveCliente ? registroEstado.cliente : null;

  /** Clientes anteriores (o registrados en el directorio) para lo escrito en el nombre o el RUT. */
  const sugerirCliente =
    (campo: 'nombre' | 'rut') =>
    async (texto: string, senal: AbortSignal): Promise<SugerenciaCampo[]> => {
      const { clientes } = await pedirJSON<{ clientes: ClienteAnterior[] }>(
        `/api/clientes?${new URLSearchParams({ q: texto, excluir: actual.id })}`,
        { signal: senal, cache: 'no-store' },
      );
      return clientes.map((c, idx) => {
        const origen = c.registrado ? 'Cliente frecuente' : 'Cotización anterior';
        return {
          clave: c.id ?? `${c.rut ?? ''}|${c.nombre ?? ''}|${idx}`,
          etiqueta: (campo === 'rut' ? c.rut : c.nombre) ?? c.nombre ?? c.rut ?? SIN_CLIENTE,
          detalle:
            [origen, campo === 'rut' ? c.nombre : c.rut, c.giro, c.comuna].filter(Boolean).join(' · ') || undefined,
          aplicar: () => editar({ cliente: datosClienteAnterior(c) }, `cliente.${campo}`),
        };
      });
    };

  async function guardarComoClienteFrecuente() {
    if (guardandoRegistro) return;
    setErrorRegistro('');
    setAvisoRegistro('');
    const nombreLimpio = actual.cliente.nombre?.trim();
    if (!nombreLimpio) {
      setErrorRegistro('Agrega al menos el nombre del cliente para guardarlo en el registro.');
      return;
    }
    const rutBruto = actual.cliente.rut?.trim() || null;
    const rutNorm = rutBruto ? normalizarRut(rutBruto) : null;
    if (rutBruto && !rutNorm) {
      setErrorRegistro('Corrige el RUT del cliente antes de guardarlo en el registro.');
      return;
    }

    setGuardandoRegistro(true);
    try {
      const { cliente } = await pedirJSON<{ cliente: ClienteRegistrado }>('/api/clientes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: nombreLimpio,
          rut: rutNorm,
          giro: actual.cliente.giro?.trim() || null,
          telefono: actual.cliente.telefono?.trim() || null,
          direccion: actual.cliente.direccion?.trim() || null,
          comuna: actual.cliente.comuna?.trim() || null,
        }),
      });
      setRegistroEstado({ clave: claveCliente, cliente });
      setAvisoRegistro('Guardado como cliente frecuente.');
    } catch (err) {
      if (esSilencioso(err)) return;
      if (codigoDe(err) === 'rut_duplicado' && err instanceof ErrorSolicitud) {
        const existente = err.detalle?.clienteExistente as ClienteRegistrado | undefined;
        if (existente) {
          setRegistroEstado({ clave: claveCliente, cliente: existente });
          setAvisoRegistro(`Ya estaba registrado: ${existente.nombre}.`);
          return;
        }
      }
      setErrorRegistro(mensajeDe(err));
    } finally {
      setGuardandoRegistro(false);
    }
  }

  return (
    <details key={`cliente-${actual.id}`} className="quote-client-section quote-details">
      <summary>
        <span>Cliente y facturación</span>
        <small>
          {[actual.cliente.nombre, actual.cliente.rut, actual.cliente.comuna].filter(Boolean).join(' · ') ||
            'Agregar datos del cliente'}
        </small>
      </summary>
      <div className="client">
        {CAMPOS_CLIENTE.map((campo) => {
          const valor = actual.cliente[campo] ?? '';
          if (!admiteCambios && !valor && (campo === 'giro' || campo === 'rut' || campo === 'direccion'))
            return null;
          const conAutocompletar = campo === 'nombre' || campo === 'rut';
          return (
            <CampoEditable
              key={campo}
              className={`cliente-campo cliente-${campo}`}
              etiqueta={ETIQUETA_CAMPO[campo]}
              valor={valor}
              mostrar={campo === 'nombre' ? valor || SIN_CLIENTE : undefined}
              editable={editable}
              discreto
              guardando={guardando === `cliente.${campo}`}
              maxLength={300}
              ayuda={conAutocompletar ? AYUDA_AUTOCOMPLETAR : undefined}
              guardar={(v) => editar({ cliente: { [campo]: v || null } }, `cliente.${campo}`)}
              sugerir={conAutocompletar ? sugerirCliente(campo) : undefined}
            />
          );
        })}
      </div>
      {actual.cliente.nombre?.trim() && (
        <div className="cliente-frecuente-barra">
          {clienteRegistrado ? (
            <>
              <span className="cliente-origen registrado">Cliente frecuente registrado</span>
              <Link href="/clientes" scroll={false} className="link">
                Ver en Clientes
              </Link>
              {avisoRegistro && (
                <span className="facturacion-copiado" role="status">
                  {avisoRegistro}
                </span>
              )}
            </>
          ) : (
            <button
              type="button"
              className="button secondary small"
              disabled={guardandoRegistro}
              onClick={() => void guardarComoClienteFrecuente()}
            >
              {guardandoRegistro ? 'Guardando…' : 'Guardar como cliente frecuente'}
            </button>
          )}
          {errorRegistro && (
            <p className="campo-error" role="alert">
              {errorRegistro}
            </p>
          )}
        </div>
      )}
    </details>
  );
}
