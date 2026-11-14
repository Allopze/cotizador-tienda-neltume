'use client';
import { CampoEditable, type SugerenciaCampo } from '../campo-editable';
import type { CambiosEdicion } from '../contrato';
import { ETIQUETA_CAMPO, SIN_CLIENTE } from '../formato';
import type { Cotizacion } from '@/negocio/estado';
import type { ClienteAnterior } from '@/servidor/clientes';
import { pedirJSON } from '../solicitud';

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
    </details>
  );
}
