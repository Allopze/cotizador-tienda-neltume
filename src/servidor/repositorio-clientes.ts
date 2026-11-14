import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { normalizarTexto } from './busqueda';
import { ErrorConflicto, ErrorNoEncontrado, ErrorUsuario } from './errores';
import { rutCompacto } from '@/negocio/cliente';
import {
  sanearClienteRegistrado,
  type ClienteRegistrado,
  type EntradaClienteRegistrado,
} from '@/negocio/cliente-registro';
import {
  receptorTieneContenido,
  type ReceptorFacturacion,
  type TipoDocumentoTributario,
} from '@/negocio/facturacion';

export interface AuditoriaCliente {
  id: number;
  clienteId: string;
  fecha: string;
  actor: string | null;
  accion: 'crear' | 'editar' | 'eliminar';
  detalle: string;
  antesJson: string | null;
  despuesJson: string | null;
}

interface FilaCliente {
  id: string;
  nombre: string;
  nombre_normalizado: string;
  rut: string | null;
  rut_compacto: string | null;
  giro: string | null;
  telefono: string | null;
  direccion: string | null;
  comuna: string | null;
  correo: string | null;
  notas: string | null;
  documento_habitual: TipoDocumentoTributario | null;
  factura_razon_social: string | null;
  factura_rut: string | null;
  factura_giro: string | null;
  factura_direccion: string | null;
  factura_comuna: string | null;
  factura_correo: string | null;
  creado: string;
  actualizado: string;
  creado_por: string | null;
  actualizado_por: string | null;
  eliminado: string | null;
  eliminado_por: string | null;
}

const COLUMNAS_CLIENTE = `
  id, nombre, nombre_normalizado, rut, rut_compacto, giro, telefono, direccion, comuna, correo, notas,
  documento_habitual, factura_razon_social, factura_rut, factura_giro, factura_direccion, factura_comuna, factura_correo,
  creado, actualizado, creado_por, actualizado_por, eliminado, eliminado_por
`;

function receptorDeFila(fila: FilaCliente): ReceptorFacturacion | null {
  const candidato: ReceptorFacturacion = {
    razonSocial: fila.factura_razon_social,
    rut: fila.factura_rut,
    giro: fila.factura_giro,
    direccion: fila.factura_direccion,
    comuna: fila.factura_comuna,
    correo: fila.factura_correo,
  };
  return receptorTieneContenido(candidato) ? candidato : null;
}

function filaACliente(fila: FilaCliente): ClienteRegistrado {
  return {
    id: fila.id,
    nombre: fila.nombre,
    rut: fila.rut,
    giro: fila.giro,
    telefono: fila.telefono,
    direccion: fila.direccion,
    comuna: fila.comuna,
    correo: fila.correo,
    notas: fila.notas,
    documentoHabitual: fila.documento_habitual,
    receptorFacturacion: receptorDeFila(fila),
    creado: fila.creado,
    actualizado: fila.actualizado,
    creadoPor: fila.creado_por,
    actualizadoPor: fila.actualizado_por,
  };
}

function ahoraUnico(anterior?: string | null): string {
  const ahoraMs = Date.now();
  const prevMs = anterior ? Date.parse(anterior) : NaN;
  const ms = Number.isFinite(prevMs) && prevMs >= ahoraMs ? prevMs + 1 : ahoraMs;
  return new Date(ms).toISOString();
}

const valorTexto = (v: string | null | undefined) => (v?.trim() ? v.trim() : 'Sin definir');

function resumirReceptor(receptor: ReceptorFacturacion | null): string {
  if (!receptor) return 'Sin definir';
  return [
    receptor.razonSocial,
    receptor.rut ? `(${receptor.rut})` : null,
    receptor.giro,
    receptor.direccion,
    receptor.comuna,
    receptor.correo,
  ]
    .filter(Boolean)
    .join(' · ') || 'Sin definir';
}

function resumirCambiosCliente(antes: ClienteRegistrado, despues: ClienteRegistrado): string {
  const cambios: string[] = [];
  const camposTexto: [string, string | null, string | null][] = [
    ['nombre', antes.nombre, despues.nombre],
    ['RUT', antes.rut, despues.rut],
    ['giro', antes.giro, despues.giro],
    ['teléfono', antes.telefono, despues.telefono],
    ['dirección', antes.direccion, despues.direccion],
    ['comuna', antes.comuna, despues.comuna],
    ['correo', antes.correo, despues.correo],
    ['notas', antes.notas, despues.notas],
    ['documento habitual', antes.documentoHabitual, despues.documentoHabitual],
  ];
  for (const [etiqueta, prev, next] of camposTexto) {
    if (prev !== next) cambios.push(`${etiqueta}: ${valorTexto(prev)} → ${valorTexto(next)}`);
  }
  const recAntes = resumirReceptor(antes.receptorFacturacion);
  const recDespues = resumirReceptor(despues.receptorFacturacion);
  if (recAntes !== recDespues) cambios.push(`facturación: ${recAntes} → ${recDespues}`);
  return cambios.length ? cambios.join('; ').slice(0, 600) : `Sin cambios de campos (${despues.nombre})`;
}

export function obtenerCliente(
  db: Database.Database,
  id: string,
  opciones: { incluirEliminados?: boolean } = {},
): ClienteRegistrado | null {
  const filtro = opciones.incluirEliminados ? '' : 'AND eliminado IS NULL';
  const fila = db
    .prepare(`SELECT ${COLUMNAS_CLIENTE} FROM clientes WHERE id = ? ${filtro}`)
    .get(id) as FilaCliente | undefined;
  return fila ? filaACliente(fila) : null;
}

export function buscarClienteActivoPorRut(db: Database.Database, rut: string): ClienteRegistrado | null {
  const compacto = rutCompacto(rut);
  if (!compacto) return null;
  const fila = db
    .prepare(`SELECT ${COLUMNAS_CLIENTE} FROM clientes WHERE rut_compacto = ? AND eliminado IS NULL LIMIT 1`)
    .get(compacto) as FilaCliente | undefined;
  return fila ? filaACliente(fila) : null;
}

export function listarClientesActivos(db: Database.Database): ClienteRegistrado[] {
  const filas = db
    .prepare(`SELECT ${COLUMNAS_CLIENTE} FROM clientes WHERE eliminado IS NULL ORDER BY nombre_normalizado ASC, creado ASC`)
    .all() as FilaCliente[];
  return filas.map(filaACliente);
}

function verificarRutDisponible(db: Database.Database, compacto: string | null, excluirId?: string) {
  if (!compacto) return;
  const fila = (
    excluirId
      ? db
          .prepare(`SELECT ${COLUMNAS_CLIENTE} FROM clientes WHERE rut_compacto = ? AND eliminado IS NULL AND id != ? LIMIT 1`)
          .get(compacto, excluirId)
      : db
          .prepare(`SELECT ${COLUMNAS_CLIENTE} FROM clientes WHERE rut_compacto = ? AND eliminado IS NULL LIMIT 1`)
          .get(compacto)
  ) as FilaCliente | undefined;
  if (!fila) return;
  const existente = filaACliente(fila);
  throw new ErrorConflicto(
    `Ya existe un cliente frecuente con el RUT ${existente.rut}: ${existente.nombre}.`,
    'rut_duplicado',
    { clienteExistente: existente },
  );
}

export function crearCliente(
  db: Database.Database,
  entrada: EntradaClienteRegistrado,
  actor: string | null,
): ClienteRegistrado {
  const res = sanearClienteRegistrado(entrada);
  if (!res.ok) throw new ErrorUsuario(res.mensaje, res.codigo, 400);
  const { datos } = res;

  return db.transaction(() => {
    verificarRutDisponible(db, datos.rutCompacto);
    const id = randomUUID();
    const ahora = new Date().toISOString();
    const r = datos.receptorFacturacion;

    db.prepare(
      `INSERT INTO clientes (
        id, nombre, nombre_normalizado, rut, rut_compacto, giro, telefono, direccion, comuna, correo, notas,
        documento_habitual, factura_razon_social, factura_rut, factura_giro, factura_direccion, factura_comuna, factura_correo,
        creado, actualizado, creado_por, actualizado_por
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      datos.nombre,
      normalizarTexto(datos.nombre),
      datos.rut,
      datos.rutCompacto,
      datos.giro,
      datos.telefono,
      datos.direccion,
      datos.comuna,
      datos.correo,
      datos.notas,
      datos.documentoHabitual,
      r?.razonSocial ?? null,
      r?.rut ?? null,
      r?.giro ?? null,
      r?.direccion ?? null,
      r?.comuna ?? null,
      r?.correo ?? null,
      ahora,
      ahora,
      actor,
      actor,
    );

    const creado = obtenerCliente(db, id)!;
    const detalle = `Cliente registrado: ${creado.nombre}${creado.rut ? ` (${creado.rut})` : ''}`;
    db.prepare(
      'INSERT INTO auditoria_clientes (cliente_id, fecha, actor, accion, detalle, antes_json, despues_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, ahora, actor, 'crear', detalle, null, JSON.stringify(creado));

    return creado;
  }).immediate();
}

export function actualizarCliente(
  db: Database.Database,
  id: string,
  entrada: EntradaClienteRegistrado,
  actor: string | null,
  opciones: { actualizado?: string } = {},
): ClienteRegistrado {
  const res = sanearClienteRegistrado(entrada);
  if (!res.ok) throw new ErrorUsuario(res.mensaje, res.codigo, 400);
  const { datos } = res;

  return db.transaction(() => {
    const antes = obtenerCliente(db, id);
    if (!antes) throw new ErrorNoEncontrado('No se encontró el cliente.');
    if (opciones.actualizado && antes.actualizado !== opciones.actualizado) {
      throw new ErrorConflicto(
        'La ficha del cliente cambió desde que la abriste. Vuelve a cargarla antes de guardar.',
        'version_obsoleta',
      );
    }
    verificarRutDisponible(db, datos.rutCompacto, id);
    const ahora = ahoraUnico(antes.actualizado);
    const r = datos.receptorFacturacion;

    db.prepare(
      `UPDATE clientes SET
        nombre = ?, nombre_normalizado = ?, rut = ?, rut_compacto = ?, giro = ?, telefono = ?,
        direccion = ?, comuna = ?, correo = ?, notas = ?,
        documento_habitual = ?, factura_razon_social = ?, factura_rut = ?, factura_giro = ?,
        factura_direccion = ?, factura_comuna = ?, factura_correo = ?,
        actualizado = ?, actualizado_por = ?
      WHERE id = ? AND eliminado IS NULL`,
    ).run(
      datos.nombre,
      normalizarTexto(datos.nombre),
      datos.rut,
      datos.rutCompacto,
      datos.giro,
      datos.telefono,
      datos.direccion,
      datos.comuna,
      datos.correo,
      datos.notas,
      datos.documentoHabitual,
      r?.razonSocial ?? null,
      r?.rut ?? null,
      r?.giro ?? null,
      r?.direccion ?? null,
      r?.comuna ?? null,
      r?.correo ?? null,
      ahora,
      actor,
      id,
    );

    const despues = obtenerCliente(db, id)!;
    const detalle = resumirCambiosCliente(antes, despues);
    db.prepare(
      'INSERT INTO auditoria_clientes (cliente_id, fecha, actor, accion, detalle, antes_json, despues_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, ahora, actor, 'editar', detalle, JSON.stringify(antes), JSON.stringify(despues));

    return despues;
  }).immediate();
}

export function eliminarCliente(
  db: Database.Database,
  id: string,
  actor: string | null,
  opciones: { actualizado?: string } = {},
): ClienteRegistrado {
  return db.transaction(() => {
    const antes = obtenerCliente(db, id);
    if (!antes) throw new ErrorNoEncontrado('No se encontró el cliente.');
    if (opciones.actualizado && antes.actualizado !== opciones.actualizado) {
      throw new ErrorConflicto(
        'La ficha del cliente cambió desde que la abriste. Vuelve a cargarla antes de eliminar.',
        'version_obsoleta',
      );
    }
    const ahora = ahoraUnico(antes.actualizado);
    db.prepare(
      'UPDATE clientes SET eliminado = ?, eliminado_por = ?, actualizado = ?, actualizado_por = ? WHERE id = ? AND eliminado IS NULL',
    ).run(ahora, actor, ahora, actor, id);

    const detalle = `Baja lógica: ${antes.nombre}${antes.rut ? ` (${antes.rut})` : ''}`;
    db.prepare(
      'INSERT INTO auditoria_clientes (cliente_id, fecha, actor, accion, detalle, antes_json, despues_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, ahora, actor, 'eliminar', detalle, JSON.stringify(antes), null);

    return antes;
  }).immediate();
}

export function auditoriaDeCliente(
  db: Database.Database,
  clienteId: string,
  limite = 50,
): AuditoriaCliente[] {
  const filas = db
    .prepare(
      'SELECT id, cliente_id, fecha, actor, accion, detalle, antes_json, despues_json FROM auditoria_clientes WHERE cliente_id = ? ORDER BY id DESC LIMIT ?',
    )
    .all(clienteId, limite) as {
    id: number;
    cliente_id: string;
    fecha: string;
    actor: string | null;
    accion: 'crear' | 'editar' | 'eliminar';
    detalle: string;
    antes_json: string | null;
    despues_json: string | null;
  }[];
  return filas.map((f) => ({
    id: f.id,
    clienteId: f.cliente_id,
    fecha: f.fecha,
    actor: f.actor,
    accion: f.accion,
    detalle: f.detalle,
    antesJson: f.antes_json,
    despuesJson: f.despues_json,
  }));
}
