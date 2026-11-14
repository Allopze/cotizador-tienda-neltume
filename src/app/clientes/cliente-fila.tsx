'use client';
import Link from 'next/link';
import { etiquetaEstado } from '@/negocio/estado';
import { etiquetaDocumentoFacturacion } from '@/negocio/facturacion';
import { pesos } from '@/negocio/precios';
import type { ClienteDirectorio } from '@/servidor/clientes';
import { SIN_CLIENTE, SIN_NUMERO, fechaCorta, plural } from '../formato';

interface Props {
  cliente: ClienteDirectorio;
  esAdmin: boolean;
  ocupado: boolean;
  alEditar: () => void;
  alGuardarDesdeHistorial: () => void;
  alEliminar: () => void;
}

/** Tarjeta desplegable de un cliente en `/clientes` con sus datos, acciones y cotizaciones asociadas. */
export function ClienteFila({
  cliente: c,
  esAdmin,
  ocupado,
  alEditar,
  alGuardarDesdeHistorial,
  alEliminar,
}: Props) {
  const ultima = c.cotizaciones[0];
  const nombre = c.nombre || SIN_CLIENTE;
  const docHabitual = c.registrado
    ? etiquetaDocumentoFacturacion({
        documento: c.documentoHabitual ?? null,
        receptor: c.receptorFacturacion ?? null,
      })
    : null;
  return (
    <li>
      <details className="cliente-ficha">
        <summary aria-label={`${nombre}: ${plural(c.cantidad, 'cotización', 'cotizaciones')}`}>
          <span className="cliente-nombre">
            <span className="cliente-cabecera">
              <span>{nombre}</span>
              <span className={`cliente-origen ${c.registrado ? 'registrado' : 'historial'}`}>
                {c.registrado ? 'Frecuente' : 'Solo en cotizaciones'}
              </span>
            </span>
            <small>{[c.rut, c.comuna, c.telefono].filter(Boolean).join(' · ') || 'Sin RUT ni comuna'}</small>
          </span>
          <span className="cliente-resumen">
            {plural(c.cantidad, 'cotización', 'cotizaciones')}
            {ultima && <small>Última: {fechaCorta(ultima.actualizada)}</small>}
          </span>
        </summary>
        <div className="cliente-detalle">
          {(c.giro || c.direccion || c.correo) && (
            <p className="muted">{[c.giro, c.direccion, c.correo].filter(Boolean).join(' · ')}</p>
          )}
          {docHabitual && <p className="cliente-facturacion-resumen">Documento habitual: {docHabitual}</p>}
          {c.notas && <p className="cliente-notas">{c.notas}</p>}
          <div className="cliente-acciones">
            {c.registrado ? (
              <>
                <button type="button" className="button secondary small" onClick={alEditar} disabled={ocupado}>
                  Editar
                </button>
                {esAdmin && (
                  <button type="button" className="button secondary small" onClick={alEliminar} disabled={ocupado}>
                    {ocupado ? 'Eliminando…' : 'Eliminar cliente'}
                  </button>
                )}
              </>
            ) : (
              <button type="button" className="button secondary small" onClick={alGuardarDesdeHistorial}>
                Guardar como cliente
              </button>
            )}
          </div>
          {c.cotizaciones.length > 0 ? (
            <ul className="cliente-cotizaciones" aria-label={`Cotizaciones de ${nombre}`}>
              {c.cotizaciones.map((q) => (
                <li key={q.id}>
                  <Link href={`/?cotizacion=${encodeURIComponent(q.id)}`} scroll={false}>
                    <span>{q.numero ? `N° ${q.numero}` : SIN_NUMERO}</span>
                    <span className={`status ${q.estado}`}>{etiquetaEstado[q.estado]}</span>
                    <span className="cliente-cotizacion-proyecto">{q.proyecto || fechaCorta(q.actualizada)}</span>
                    <strong>{pesos(q.total)}</strong>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Sin cotizaciones todavía.</p>
          )}
          {c.cantidad > c.cotizaciones.length && (
            <p className="muted">
              Se muestran las {c.cotizaciones.length} más recientes. Las demás se buscan en el{' '}
              <Link href="/historial" scroll={false}>
                Historial
              </Link>
              .
            </p>
          )}
        </div>
      </details>
    </li>
  );
}
