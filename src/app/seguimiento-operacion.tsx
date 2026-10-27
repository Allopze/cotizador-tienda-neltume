'use client';
import { useEffect, useState } from 'react';
import {
  anticipoMinimo,
  etapaProduccion,
  etiquetaComercial,
  etiquetaEtapa,
  etiquetaFacturacion,
  etiquetaOperativo,
  FABRICAS,
  fabricaDeNota,
  nombreFabrica,
  numeroNota,
  operacionDe,
  pagoAnulable,
  retrocesoOperativo,
  rangoFechaOperacion,
  sinTransportista,
  type Cotizacion,
  type NotaPedido,
} from '@/negocio/estado';
import { leerPesos } from '@/negocio/cifras';
import { ANTICIPO_TEXTO } from '@/negocio/limites';
import { esLibre } from '@/negocio/personalizados';
import { descripcionLinea, pesos, porcentaje } from '@/negocio/precios';
import { fechaChilena, fechaLocal } from '@/negocio/vigencia';
import { useConfirmacion } from './dialogo';
import { useRepartoFabricas, useRetroceso, type LineaReparto } from './dialogos-cotizacion';
import { fechaCorta, fechaLarga, nombreProducto, numeroCotizacion } from './formato';
import { LineaPasos } from './linea-pasos';
import { SelectorDesplegable } from './selector-desplegable';
import { pedirJSON } from './solicitud';

/** Envío de una nota a la fábrica; solo lo necesario para mostrar si llegó (auditoría BUG-004). */
interface EnvioFabrica {
  fabrica: string;
  revision: number;
  estado: 'pendiente' | 'entregado' | 'fallido' | 'reemplazado';
  ultimo_error: string | null;
}

/** Texto del indicador de envío; null si no hay nada que decir (una revisión reemplazada no se muestra). */
function textoEnvio(envio: EnvioFabrica): string | null {
  if (envio.estado === 'entregado') return 'Enviada a fábrica';
  if (envio.estado === 'fallido') return 'No llegó a la fábrica';
  if (envio.estado === 'pendiente') return 'Pendiente de envío';
  return null;
}

interface Props {
  actual: Cotizacion;
  ocupado: boolean;
  /** Ejecuta una acción sobre la cotización abierta con su versión; responde si se aplicó. */
  flujo: (accion: Record<string, unknown>) => Promise<boolean>;
  /** Anula un pago registrado por error, previa confirmación. */
  anularPago: (pagoId: string) => Promise<boolean>;
}

/**
 * Seguimiento de la operación: pagos, producción, despacho, facturación y notas internas. Guarda los
 * borradores de sus formularios, así que el panel lo monta con `key` = id de la cotización.
 */
export function SeguimientoOperacion({ actual, ocupado, flujo, anularPago }: Props) {
  const [errorPago, setErrorPago] = useState('');
  const [montoPago, setMontoPago] = useState('');
  const [fechaPago, setFechaPago] = useState(() => fechaLocal(new Date()));
  const [observacionPago, setObservacionPago] = useState('');
  const [tipoFactura, setTipoFactura] = useState<'factura' | 'boleta'>('factura');
  const [numeroFactura, setNumeroFactura] = useState('');
  const [fechaFactura, setFechaFactura] = useState(() => fechaLocal(new Date()));
  const [comentario, setComentario] = useState('');
  const [confirmar, confirmacion] = useConfirmacion();
  const [pedirRetroceso, dialogoRetroceso] = useRetroceso();
  const [pedirReparto, dialogoReparto] = useRepartoFabricas();
  const estado = actual.estado;
  const pagosRegistrados = actual.pagos ?? [];
  const pagado = pagosRegistrados.reduce((s, p) => s + p.monto, 0);
  const saldo = Math.max(0, actual.montos.total - pagado);
  const porcentajePagado = actual.montos.total ? Math.min(100, (100 * pagado) / actual.montos.total) : 0;
  const operacionActual = operacionDe(actual);
  const notas = actual.notas;
  const vigentes = notas.filter((n) => !n.anulada);
  // El estado de la bandeja no viene en la cotización: se consulta aparte y se refresca con cada versión.
  const [envios, setEnvios] = useState<EnvioFabrica[]>([]);
  const version = actual.actualizada;
  const id = actual.id;
  useEffect(() => {
    if (!vigentes.length) return;
    const control = new AbortController();
    pedirJSON<{ envios: EnvioFabrica[] }>(
      `/api/integracion/envios?cotizacion=${encodeURIComponent(id)}`,
      { signal: control.signal, cache: 'no-store' },
    ).then(
      (datos) => setEnvios(datos.envios),
      () => undefined,
    );
    return () => control.abort();
  }, [id, version, vigentes.length]);
  /** Último envío de la fábrica de la nota (varios envíos = revisiones). */
  const envioDe = (fabrica: NotaPedido['fabrica']) =>
    envios.find((e) => e.fabrica === fabrica);
  /** Con varias fábricas, cada paso de producción dice en cuál; con una sola, se nombra como siempre. */
  const variasFabricas = vigentes.length > 1;
  const estadoComercial = actual.estadoComercial ?? (estado === 'emitida' ? 'enviada' : 'pendiente');
  const pagoMinimoNP = anticipoMinimo(actual.montos.total);
  const aprobada = estado === 'aprobada';
  const puedeAnularPago = pagoAnulable(actual);
  const faltaTransportista = sinTransportista(actual.despacho?.transporte);
  // Pagos y facturas: desde el día de la aprobación hasta hoy (hora de Chile), como lo exige el servidor.
  const rangoFecha = rangoFechaOperacion(actual.fechaAprobacion);
  /** Mensaje del navegador en español (y con la fecha límite) cuando la fecha queda fuera del rango. */
  const explicarFecha = (campo: HTMLInputElement, de: string) =>
    campo.setCustomValidity(
      campo.validity.rangeUnderflow && rangoFecha.min
        ? `La fecha ${de} no puede ser anterior a la aprobación (${fechaChilena(rangoFecha.min)}).`
        : campo.validity.rangeOverflow
          ? `La fecha ${de} no puede ser posterior a hoy (${fechaChilena(rangoFecha.max)}).`
          : campo.validity.badInput
            ? `Completa la fecha ${de}.`
            : '',
    );
  async function registrarPago(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const monto = leerPesos(montoPago);
    if (ocupado) return;
    const error = !Number.isSafeInteger(monto) ? 'Escribe un monto en pesos, sin decimales.' : monto <= 0 ? 'Escribe un monto mayor que cero.' : monto > saldo ? `Máximo ${pesos(saldo)}.` : '';
    setErrorPago(error);
    if (error) return;
    if (await flujo({ tipo: 'pago', monto, fecha: fechaPago || undefined, observacion: observacionPago || null })) {
      setMontoPago('');
      setObservacionPago('');
    }
  }
  async function marcarFacturada(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (ocupado) return;
    if (
      await flujo({
        tipo: 'facturacion',
        estado: 'facturada',
        tipoDocumento: tipoFactura,
        identificadorExterno: numeroFactura.trim() || null,
        fecha: fechaFactura || null,
      })
    )
      setNumeroFactura('');
  }
  async function guardarComentario(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!comentario.trim() || ocupado) return;
    if (await flujo({ tipo: 'comentario', texto: comentario.trim() })) setComentario('');
  }
  /** Cada paso (y la nota, que consume un número) se confirma con su efecto en una línea. */
  async function confirmarPaso(titulo: string, efecto: string, aceptar: string, accion: Record<string, unknown>) {
    if (ocupado) return;
    if (await confirmar({ titulo, mensaje: <p>{efecto}</p>, aceptar, eyebrow: 'OPERACIÓN' })) await flujo(accion);
  }
  const operar = (paso: string, titulo: string, efecto: string, aceptar: string, nota?: NotaPedido) =>
    void confirmarPaso(titulo, efecto, aceptar, {
      tipo: 'operacion',
      paso,
      ...(variasFabricas && nota?.fabrica ? { fabrica: nota.fabrica } : {}),
    });
  // Los ítems valorizados, con la fábrica que tienen asignada: lo que va en las notas de pedido. Un ítem libre no va
  // a ninguna fábrica.
  const lineasReparto = (): LineaReparto[] =>
    actual.montos.lineas.flatMap((l) =>
      l.indice === null || esLibre(actual.solicitudes[l.indice])
        ? []
        : [
            {
              indice: l.indice,
              nombre: `${l.cantidad} × ${nombreProducto(descripcionLinea(l))}`,
              detalle: l.producto.codigo,
              fabrica: actual.solicitudes[l.indice]?.fabrica ?? null,
            },
          ],
    );
  const asignadas = new Set(lineasReparto().flatMap((l) => (l.fabrica ? [l.fabrica] : [])));
  const todasAsignadas = lineasReparto().every((l) => l.fabrica);
  const textoGenerar = todasAsignadas && asignadas.size === 1 ? 'Generar nota de pedido' : 'Generar notas de pedido';
  async function generarNota() {
    if (ocupado) return;
    const r = await pedirReparto({ lineas: lineasReparto(), generar: true });
    if (r) await flujo({ tipo: 'generar_nota', ...(r.asignaciones.length ? { asignaciones: r.asignaciones } : {}) });
  }
  async function repartir() {
    if (ocupado) return;
    const r = await pedirReparto({ lineas: lineasReparto(), generar: false });
    if (r?.asignaciones.length) await flujo({ tipo: 'asignar_fabricas', asignaciones: r.asignaciones });
  }
  /** Inicio o término de la producción de una nota, con el efecto que tiene sobre el pedido. */
  const pasoProduccion = (nota: NotaPedido) => {
    const etapa = etapaProduccion(nota);
    const fabrica = fabricaDeNota(nota);
    const en = variasFabricas ? ` en ${fabrica}` : '';
    if (etapa === 'pendiente')
      return {
        etiqueta: `Iniciar producción${en}`,
        accion: () =>
          operar(
            'iniciar_produccion',
            `¿Iniciar producción${en}?`,
            variasFabricas
              ? `La nota de pedido ${numeroNota(nota)} pasa a «En producción»: queda registrado que el pedido entró a la fábrica de ${fabrica}.`
              : 'La operación pasa a «En producción»: queda registrado que el pedido entró a fábrica.',
            `Iniciar producción${en}`,
            nota,
          ),
      };
    if (etapa === 'en_produccion') {
      const ultima = vigentes.every((n) => n === nota || etapaProduccion(n) === 'terminada');
      return {
        etiqueta: `Marcar producción terminada${en}`,
        accion: () =>
          operar(
            'produccion_terminada',
            `¿Producción terminada${en}?`,
            !ultima
              ? `Queda registrado que ${fabrica} terminó su parte. El pedido pasa a despacho cuando terminen todas las fábricas.`
              : pagado < actual.montos.total
                ? `Queda registrado que fábrica terminó el pedido; faltan ${pesos(saldo)} para poder despacharlo.`
                : 'Queda registrado que fábrica terminó el pedido; ya está pagado y puede prepararse el despacho.',
            `Marcar producción terminada${en}`,
            nota,
          ),
      };
    }
    return null;
  };
  const produciendo = aprobada && pagado >= pagoMinimoNP && (operacionActual === 'pedido_generado' || operacionActual === 'en_produccion');
  const previo = retrocesoOperativo(actual);
  async function volverAtras() {
    if (!previo || ocupado) return;
    const r = await pedirRetroceso({ desde: previo.desde, hasta: previo.hasta });
    if (r) await flujo({ tipo: 'retroceder_operacion', motivo: r.motivo });
  }
  // Mismas condiciones que `desaprobar` en el servidor: sin nota, pagos ni factura.
  const puedeDesaprobar =
    aprobada && !notas.length && !pagosRegistrados.length && actual.facturacion?.estado !== 'facturada';
  const desaprobar = () =>
    void confirmarPaso(
      '¿Deshacer la aprobación?',
      `La cotización ${numeroCotizacion(actual.numero)} vuelve a «Emitida»: podrás modificarla o registrar la aprobación de nuevo.`,
      'Deshacer aprobación',
      { tipo: 'desaprobar' },
    );
  const irAPago = () => {
    const campo = document.getElementById('monto-recibido') as HTMLInputElement | null;
    campo?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    campo?.focus({ preventScroll: true });
  };
  const irADespacho = () => {
    const detalle = document.getElementById('despacho-details') as HTMLDetailsElement | null;
    if (!detalle) return;
    detalle.open = true;
    detalle.scrollIntoView({ block: 'center', behavior: 'smooth' });
    detalle.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
  };
  const irAFacturacion = () => {
    const campo = document.getElementById('facturacion-identificador') as HTMLInputElement | null;
    campo?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    campo?.focus({ preventScroll: true });
  };
  const siguiente = (() => {
    if (!aprobada) return null;
    if (!vigentes.length)
      return pagado < pagoMinimoNP
        ? { titulo: 'Registrar anticipo', detalle: `La nota de pedido se habilita al registrar ${pesos(pagoMinimoNP)} (${ANTICIPO_TEXTO}).`, etiqueta: 'Ir a pagos', accion: irAPago }
        : {
            titulo: textoGenerar,
            detalle: todasAsignadas
              ? 'El anticipo está registrado. Prepara el documento de cada fábrica con sus ítems.'
              : 'El anticipo está registrado. Elige la fábrica de cada ítem y prepara el documento de cada una.',
            etiqueta: textoGenerar,
            accion: () => void generarNota(),
          };
    if (pagado < pagoMinimoNP)
      return { titulo: 'Completar anticipo', detalle: `La producción requiere al menos ${pesos(pagoMinimoNP)} pagado.`, etiqueta: 'Ir a pagos', accion: irAPago };
    switch (operacionActual) {
      case 'pedido_generado':
      case 'en_produccion': {
        // Primero lo que falta iniciar; después, lo que falta terminar. Cada nota tiene además su botón abajo.
        const nota =
          vigentes.find((n) => etapaProduccion(n) === 'pendiente') ?? vigentes.find((n) => etapaProduccion(n) === 'en_produccion');
        const paso = nota && pasoProduccion(nota);
        if (!nota || !paso) return { titulo: 'Revisar la producción', detalle: 'Revisa el avance de cada nota de pedido.', etiqueta: null, accion: null };
        const iniciar = etapaProduccion(nota) === 'pendiente';
        const otra = variasFabricas ? vigentes.find((n) => n !== nota && etapaProduccion(n) === 'en_produccion') : undefined;
        return {
          titulo: iniciar ? paso.etiqueta : `Cerrar producción${variasFabricas ? ` en ${fabricaDeNota(nota)}` : ''}`,
          detalle: iniciar
            ? `${otra ? `${fabricaDeNota(otra)} ya está fabricando su nota (N° ${otra.numero}). ` : ''}La nota de pedido ${numeroNota(nota)} ya está generada. Registra el inicio cuando pase a fábrica.`
            : `Confirma que ${variasFabricas ? fabricaDeNota(nota) : 'fábrica'} terminó ${variasFabricas ? 'su parte' : 'el pedido'}.`,
          etiqueta: paso.etiqueta,
          accion: paso.accion,
        };
      }
      case 'saldo_pendiente':
        return { titulo: 'Registrar saldo', detalle: `Faltan ${pesos(saldo)} para continuar con el despacho.`, etiqueta: 'Ir a pagos', accion: irAPago };
      case 'pagada':
        return pagado >= actual.montos.total
          ? { titulo: 'Preparar despacho', detalle: 'El pedido está pagado. Indica que está listo para despacho.', etiqueta: 'Marcar lista para despacho', accion: () => operar('lista_despacho', '¿Lista para despacho?', 'El pedido queda «Lista para despacho» y desde ahí sus pagos ya no se pueden anular.', 'Marcar lista para despacho') }
          : { titulo: 'Registrar saldo', detalle: `Faltan ${pesos(saldo)} para continuar con el despacho.`, etiqueta: 'Ir a pagos', accion: irAPago };
      case 'lista_despacho':
        return faltaTransportista
          ? { titulo: 'Indicar transportista', detalle: 'Completa el transportista en Despacho antes de registrar la salida.', etiqueta: 'Completar despacho', accion: irADespacho }
          : { titulo: 'Registrar despacho', detalle: 'El pedido está listo y tiene transportista asignado.', etiqueta: 'Registrar despacho', accion: () => operar('despachada', '¿Registrar el despacho?', `Queda registrada la salida con ${actual.despacho?.transporte}; los datos de despacho ya no se podrán editar.`, 'Registrar despacho') };
      case 'despachada':
        return { titulo: 'Completar operación', detalle: 'Confirma el cierre del pedido despachado.', etiqueta: 'Completar operación', accion: () => operar('completada', '¿Completar la operación?', 'La operación queda «Completada»; solo faltará registrar la facturación si aún no está.', 'Completar operación') };
      case 'completada':
        return actual.facturacion?.estado === 'facturada'
          ? { titulo: 'Operación completada', detalle: 'El pedido y su facturación están registrados.', etiqueta: null, accion: null }
          : { titulo: 'Registrar facturación', detalle: 'El pedido está completo; falta registrar la factura o boleta.', etiqueta: 'Ir a facturación', accion: irAFacturacion };
      default:
        return { titulo: 'Revisar el siguiente paso', detalle: 'Revisa pagos, producción y despacho para continuar.', etiqueta: 'Ir a pagos', accion: irAPago };
    }
  })();
  const detallesPasos = {
    Emitida: actual.fechaEmision ? fechaCorta(actual.fechaEmision) : null,
    Aprobada: actual.fechaAprobacion ? fechaCorta(actual.fechaAprobacion) : null,
    Anticipo: pagado > 0 ? porcentaje(porcentajePagado) : null,
    Notas: vigentes.length ? vigentes.map((n) => `N° ${n.numero}`).join(' y ') : null,
    Producción: vigentes.length
      ? vigentes.length > 1
        ? `${vigentes.filter((n) => etapaProduccion(n) === 'terminada').length} de ${vigentes.length} fábricas`
        : etiquetaEtapa[etapaProduccion(vigentes[0])]
      : null,
    Despacho: actual.despacho?.transporte && !faltaTransportista ? actual.despacho.transporte : null,
    Facturada: actual.facturacion?.estado === 'facturada' ? 'Registrada' : null,
  };
  return (
    <>
      <section className="quote-workflow" aria-labelledby="seguimiento-title">
        <div className="workflow-heading">
          <div>
            <h3 id="seguimiento-title">
              {aprobada ? 'Seguimiento del pedido' : 'Esperando la aprobación del cliente'}
            </h3>
          </div>
          {(aprobada || pagado > 0) && <span className="status">{porcentaje(porcentajePagado)} pagado</span>}
        </div>
        {(aprobada || estado === 'emitida') && (
          <LineaPasos
            datos={{
              estado,
              operacion: operacionActual,
              notas: vigentes.length,
              pagado,
              total: actual.montos.total,
              facturada: actual.facturacion?.estado === 'facturada',
            }}
            detalles={detallesPasos}
          />
        )}
        {aprobada && (
          <div className="workflow-focus">
            <div className="workflow-progress">
              <span>Pago recibido</span>
              <strong>{pesos(pagado)} de {pesos(actual.montos.total)}</strong>
              <div className="workflow-progress-track" role="progressbar" aria-label="Porcentaje pagado" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(porcentajePagado)}>
                <span style={{ width: `${porcentajePagado}%` }} />
              </div>
              <small>{porcentaje(porcentajePagado)} pagado · {pesos(saldo)} pendiente</small>
            </div>
            {siguiente && (
              <div className="workflow-next" id="siguiente-accion">
                <span>Siguiente acción</span>
                <h4>{siguiente.titulo}</h4>
                <p>{siguiente.detalle}</p>
                {siguiente.accion && siguiente.etiqueta && (
                  <button type="button" className="button primary" disabled={ocupado} onClick={siguiente.accion}>
                    {siguiente.etiqueta}
                  </button>
                )}
                {previo && (
                  <button
                    type="button"
                    className="button secondary small workflow-atras"
                    disabled={ocupado}
                    onClick={() => void volverAtras()}
                  >
                    Volver al paso anterior
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {aprobada && notas.length > 0 && (
          <div className="workflow-notas" aria-labelledby="notas-pedido-title">
            <h4 id="notas-pedido-title">{notas.length > 1 ? 'Notas de pedido' : 'Nota de pedido'}</h4>
            <ul>
              {notas.map((n) => {
                const paso = produciendo && variasFabricas && !n.anulada ? pasoProduccion(n) : null;
                const envio = n.anulada ? undefined : envioDe(n.fabrica);
                const texto = envio ? textoEnvio(envio) : null;
                return (
                  <li key={n.pdf}>
                    <span className="workflow-nota">
                      <strong>{n.fabrica ? `Fábrica ${nombreFabrica[n.fabrica]}` : 'Sin fábrica asignada'}</strong>
                      <span>
                        N° {n.numero} · {n.montos.lineas.length} ítem{n.montos.lineas.length === 1 ? '' : 's'}
                      </span>
                    </span>
                    <span className={`status${n.anulada ? ' anulada' : ''}`}>
                      {n.anulada ? 'Anulada' : etiquetaEtapa[etapaProduccion(n)]}
                    </span>
                    {texto && (
                      <span
                        className={`status${envio!.estado === 'fallido' ? ' anulada' : ''}`}
                        title={envio!.estado === 'fallido' ? (envio!.ultimo_error ?? undefined) : undefined}
                      >
                        {texto}
                      </span>
                    )}
                    {paso && (
                      <button type="button" className="button secondary small" disabled={ocupado} onClick={paso.accion}>
                        {paso.etiqueta}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {/* El reparto no cambia la cotización del cliente: se prepara desde la emisión, sin crear una revisión. */}
        {(aprobada || estado === 'emitida') && !notas.length && (
          <div className="workflow-notas" aria-labelledby="reparto-title">
            <h4 id="reparto-title">Fábricas</h4>
            <p className="muted">
              {(() => {
                const lineas = lineasReparto();
                const partes = FABRICAS.map((f) => [f, lineas.filter((l) => l.fabrica === f).length] as const)
                  .filter(([, n]) => n)
                  .map(([f, n]) => `${nombreFabrica[f]}: ${n} ítem${n === 1 ? '' : 's'}`);
                const sin = lineas.filter((l) => !l.fabrica).length;
                if (sin) partes.push(`${partes.length ? 'sin' : 'Sin'} fábrica: ${sin} ítem${sin === 1 ? '' : 's'}`);
                return `${partes.join(' · ')}. Cada fábrica recibe su propia nota de pedido con sus ítems.`;
              })()}
            </p>
            <button type="button" className="button secondary small" disabled={ocupado} onClick={() => void repartir()}>
              Repartir entre fábricas
            </button>
          </div>
        )}
        <div className="workflow-states">
          <span>Comercial: <strong>{etiquetaComercial[estadoComercial]}</strong></span>
          <span>Operación: <strong>{etiquetaOperativo[operacionActual]}</strong></span>
          {aprobada && <span>Facturación: <strong>{etiquetaFacturacion(actual.facturacion)}</strong></span>}
        </div>
        {puedeDesaprobar && (
          <div className="workflow-actions">
            <button type="button" className="button secondary small" disabled={ocupado} onClick={desaprobar}>
              Deshacer aprobación
            </button>
            <p className="muted">Disponible mientras no haya pagos, nota de pedido ni factura.</p>
          </div>
        )}
        {estado === 'emitida' && (
          <div className="workflow-actions">
            {estadoComercial !== 'seguimiento' && <button type="button" className="button secondary small" disabled={ocupado} onClick={() => void flujo({ tipo: 'comercial', estado: 'seguimiento' })}>Marcar seguimiento</button>}
            {/* Rechazar anula la cotización (servicio.ts, `cambiarEstadoComercial`): no se deshace, se confirma. */}
            <button type="button" className="button secondary small" disabled={ocupado} onClick={() => void confirmarPaso('¿Marcar como rechazada?', `La cotización ${numeroCotizacion(actual.numero)} queda anulada por rechazo del cliente: no se podrá aprobar ni editar y su número no se reutiliza.`, 'Marcar rechazada', { tipo: 'comercial', estado: 'rechazada' })}>Marcar rechazada</button>
            <p className="muted">Los pagos se registran cuando el cliente aprueba la cotización.</p>
          </div>
        )}
        {aprobada && <h4 className="workflow-grupo">Pagos</h4>}
        {aprobada && saldo <= 0 && (
          <p className="workflow-saldado">
            Pagado en su totalidad: {pesos(pagado)} de {pesos(actual.montos.total)}.
          </p>
        )}
        {aprobada && saldo > 0 && (
          // Sin noValidate: una fecha a medio escribir llega vacía y el servidor pondría la de hoy; el navegador la frena.
          <form className="workflow-payment" onSubmit={registrarPago}>
            <label className="ia-field"><span>Monto recibido (máx. {pesos(saldo)})</span><input id="monto-recibido" inputMode="numeric" value={montoPago} onChange={(e) => { setMontoPago(e.target.value); setErrorPago(''); }} aria-invalid={errorPago ? true : undefined} aria-describedby={errorPago ? 'monto-recibido-error' : undefined} onBlur={() => { const n = leerPesos(montoPago); if (Number.isSafeInteger(n) && n > 0) setMontoPago(n.toLocaleString('es-CL')); }} placeholder="0" disabled={ocupado || saldo <= 0} /></label>
            <label className="ia-field"><span>Fecha del pago</span><input type="date" value={fechaPago} min={rangoFecha.min ?? undefined} max={rangoFecha.max} onInvalid={(e) => explicarFecha(e.currentTarget, 'del pago')} onChange={(e) => { e.currentTarget.setCustomValidity(''); setFechaPago(e.target.value); }} disabled={ocupado || saldo <= 0} /></label>
            <label className="ia-field"><span>Observación</span><input value={observacionPago} onChange={(e) => setObservacionPago(e.target.value)} maxLength={500} placeholder="Transferencia, anticipo…" disabled={ocupado || saldo <= 0} /></label>
            <button type="submit" className="button secondary" disabled={ocupado || saldo <= 0 || leerPesos(montoPago) <= 0}>Registrar pago</button>
            {errorPago && <small id="monto-recibido-error" className="campo-error" role="alert">{errorPago}</small>}
          </form>
        )}
        {pagosRegistrados.length > 0 && (
          <ul className="workflow-ledger">
            {pagosRegistrados.map((p) => (
              <li key={p.id}>
                <span>{fechaLarga(p.fecha)}{p.observacion ? ` · ${p.observacion}` : ''}</span>
                <span className="workflow-ledger-monto">
                  <strong>{pesos(p.monto)}</strong>
                  {puedeAnularPago && (
                    <button
                      type="button"
                      className="button secondary small"
                      disabled={ocupado}
                      aria-label={`Anular el pago de ${pesos(p.monto)} del ${fechaLarga(p.fecha)}`}
                      onClick={() => void anularPago(p.id)}
                    >
                      Anular
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {aprobada && <h4 className="workflow-grupo">Facturación</h4>}
        {aprobada && (
          actual.facturacion?.estado === 'facturada' ? (
            <div className="workflow-actions">
              <p>
                <strong>{etiquetaFacturacion(actual.facturacion)}</strong>
                {actual.facturacion.fecha ? ` · ${fechaLarga(actual.facturacion.fecha)}` : ''}
              </p>
              <button type="button" className="button secondary small" disabled={ocupado} onClick={() => void flujo({ tipo: 'facturacion', estado: 'pendiente' })}>Volver a pendiente</button>
            </div>
          ) : (
            <form className="workflow-payment" onSubmit={marcarFacturada}>
              <div className="ia-field">
                <span>Documento</span>
                <SelectorDesplegable
                  ariaLabel="Documento"
                  value={tipoFactura}
                  opciones={[
                    { value: 'factura', label: 'Factura' },
                    { value: 'boleta', label: 'Boleta' },
                  ]}
                  onChange={(valor) => setTipoFactura(valor as 'factura' | 'boleta')}
                  disabled={ocupado}
                />
              </div>
              <label className="ia-field"><span>N° o identificador externo</span><input id="facturacion-identificador" value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)} maxLength={120} placeholder="Ej. 1234" disabled={ocupado} /></label>
              <label className="ia-field"><span>Fecha de emisión</span><input type="date" value={fechaFactura} min={rangoFecha.min ?? undefined} max={rangoFecha.max} onInvalid={(e) => explicarFecha(e.currentTarget, 'de la factura')} onChange={(e) => { e.currentTarget.setCustomValidity(''); setFechaFactura(e.target.value); }} disabled={ocupado} /></label>
              <button type="submit" className="button secondary" disabled={ocupado}>Marcar como facturada</button>
            </form>
          )
        )}
        <h4 className="workflow-grupo">Notas internas</h4>
        <form className="workflow-comment" onSubmit={guardarComentario}>
          <label className="ia-field"><span>Nota interna</span><textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} maxLength={2000} placeholder="Seguimiento, acuerdos o instrucciones internas" disabled={ocupado} /></label>
          <button type="submit" className="button secondary small" disabled={ocupado || !comentario.trim()}>Agregar nota</button>
        </form>
        {(actual.comentariosInternos?.length ?? 0) > 0 && (
          <ul className="workflow-ledger internal-comments">
            {actual.comentariosInternos!.map((c) => <li key={c.id}><span>{fechaLarga(c.fecha)} · {c.usuario ?? 'Equipo'}: {c.texto}</span></li>)}
          </ul>
        )}
      </section>
      {/* Fuera de la sección: sus botones no se confunden con los del seguimiento. */}
      {confirmacion}
      {dialogoRetroceso}
      {dialogoReparto}
    </>
  );
}
