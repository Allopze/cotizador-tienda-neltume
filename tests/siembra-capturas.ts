import { expect, type APIRequestContext } from '@playwright/test';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { accion, completarOperacion, crearBorrador, rut, totalDe, type CotizacionApi } from './api-e2e';
import { DIR_E2E } from './datos-e2e';

// Siembra de `npm run ss`: llena el historial y el directorio de clientes con cotizaciones variadas para que las
// capturas se parezcan a la interfaz en uso. Solo corre sobre la base aislada del E2E, nunca sobre la real.

interface ClienteSiembra {
  nombre: string;
  rutCuerpo: string;
  giro: string;
  telefono: string;
  direccion: string;
  comuna: string;
  proyectos: string[];
  notas?: string;
  correo?: string;
}

const CLIENTES: ClienteSiembra[] = [
  {
    nombre: 'Constructora Los Alerces',
    rutCuerpo: '76543210',
    giro: 'Construcción de obras residenciales',
    telefono: '+56 9 6123 4478',
    direccion: 'Av. Picarte 2450, oficina 12',
    comuna: 'Valdivia',
    proyectos: ['Edificio Alerces', 'Etapa 2 · Edificio Alerces'],
    notas: 'Compra con factura a 30 días. Prefiere despacho a bodega en Valdivia.',
    correo: 'compras@losalerces.cl',
  },
  {
    nombre: 'Inmobiliaria Río Calle Calle',
    rutCuerpo: '78112450',
    giro: 'Inmobiliaria',
    telefono: '+56 9 8890 1122',
    direccion: 'Calle-Calle 320',
    comuna: 'Valdivia',
    proyectos: ['Condominio Isla Teja', 'Torre Río · pisos 4 a 8'],
    notas: 'Siempre pide cotización por 40 puertas o más.',
    correo: 'proyectos@riocallacalle.cl',
  },
  {
    nombre: 'María González',
    rutCuerpo: '14256789',
    giro: 'Particular',
    telefono: '+56 9 7765 2134',
    direccion: 'Pasaje Los Lingues 87',
    comuna: 'Temuco',
    proyectos: ['Casa Ñielol'],
  },
  {
    nombre: 'Pedro Soto',
    rutCuerpo: '10987654',
    giro: 'Particular',
    telefono: '+56 9 6543 8899',
    direccion: 'Rahue Alto 1520',
    comuna: 'Osorno',
    proyectos: ['Ampliación Rahue'],
  },
  {
    nombre: 'Ana Muñoz',
    rutCuerpo: '16321458',
    giro: 'Particular',
    telefono: '+56 9 5412 7788',
    direccion: 'Camino Ensenada km 4',
    comuna: 'Puerto Varas',
    proyectos: ['Cabaña Ensenada', 'Pergolado y puertas interiores'],
  },
  {
    nombre: 'Hotel Puerto Fuy',
    rutCuerpo: '76234109',
    giro: 'Hotelería y turismo',
    telefono: '+56 63 231 1180',
    direccion: 'Ribera Lago Pirihueico s/n',
    comuna: 'Panguipulli',
    proyectos: ['Remodelación sector lago'],
    notas: 'Requiere puertas con terminación para exterior. Coordinar con administración.',
    correo: 'mantencion@puertofuy.cl',
  },
  {
    nombre: 'Inmobiliaria Sur',
    rutCuerpo: '77123456',
    giro: 'Inmobiliaria',
    telefono: '+56 41 274 9030',
    direccion: 'O’Higgins 940, piso 6',
    comuna: 'Concepción',
    proyectos: ['Torre Biobío', 'Edificio Barrio Norte'],
    correo: 'obras@inmobiliariasur.cl',
  },
  {
    nombre: 'Luis Rojas',
    rutCuerpo: '12876543',
    giro: 'Particular',
    telefono: '+56 9 4321 0099',
    direccion: 'Sector Coñaripe Alto',
    comuna: 'Panguipulli',
    proyectos: ['Vivienda Coñaripe'],
  },
  {
    nombre: 'Comercial Bío Bío Ltda.',
    rutCuerpo: '79654321',
    giro: 'Comercio al por menor',
    telefono: '+56 43 221 4477',
    direccion: 'Colón 1280',
    comuna: 'Los Ángeles',
    proyectos: ['Local comercial Colón'],
    notas: 'Pide boleta. Retira en fábrica Panguipulli.',
  },
  {
    nombre: 'Constructora Andes',
    rutCuerpo: '76876543',
    giro: 'Construcción',
    telefono: '+56 2 2944 7711',
    direccion: 'Av. Providencia 1650, oficina 802',
    comuna: 'Santiago',
    proyectos: ['Proyecto Ñuñoa', 'Edificio Irarrázaval'],
    correo: 'costos@constructorandes.cl',
  },
  {
    nombre: 'Cecilia Barrientos',
    rutCuerpo: '13456782',
    giro: 'Particular',
    telefono: '+56 9 3232 5511',
    direccion: 'Villa Las Araucarias 45',
    comuna: 'Chillán',
    proyectos: ['Casa familiar'],
  },
  {
    nombre: 'Maderas del Sur SpA',
    rutCuerpo: '77345678',
    giro: 'Venta de madera',
    telefono: '+56 63 221 8899',
    direccion: 'Ruta 5 km 812',
    comuna: 'Valdivia',
    proyectos: ['Bodega y oficinas'],
    notas: 'Cliente recurrente; facturar a nombre de la sociedad.',
    correo: 'ventas@maderasdelsur.cl',
  },
  {
    nombre: 'Colegio San Sebastián',
    rutCuerpo: '65874123',
    giro: 'Educación',
    telefono: '+56 64 232 1155',
    direccion: 'Bernardo O’Higgins 220',
    comuna: 'La Unión',
    proyectos: ['Salas nuevas'],
  },
  {
    nombre: 'Familia Weisser',
    rutCuerpo: '15478963',
    giro: 'Particular',
    telefono: '+56 9 7654 3300',
    direccion: 'Camino a Totoral 18',
    comuna: 'Frutillar',
    proyectos: ['Casa lago', 'Cabaña de huéspedes'],
  },
  {
    nombre: 'Restaurante El Fogón',
    rutCuerpo: '76512348',
    giro: 'Restaurante',
    telefono: '+56 45 241 7788',
    direccion: 'Costanera 345',
    comuna: 'Villarrica',
    proyectos: ['Ampliación terraza'],
    correo: 'contacto@elfogon.cl',
  },
  {
    nombre: 'Agrícola Los Ríos',
    rutCuerpo: '78456321',
    giro: 'Agroindustria',
    telefono: '+56 63 244 1122',
    direccion: 'Camino a Río Bueno km 6',
    comuna: 'Río Bueno',
    proyectos: ['Oficinas y bodega'],
  },
  {
    nombre: 'Andrea Fuentes',
    rutCuerpo: '17321456',
    giro: 'Particular',
    telefono: '+56 9 9988 1122',
    direccion: 'Pratt 230, depto. 601',
    comuna: 'Valdivia',
    proyectos: ['Departamento Centro'],
  },
  {
    nombre: 'Jorge Millán',
    rutCuerpo: '14789632',
    giro: 'Particular',
    telefono: '+56 9 7111 6644',
    direccion: 'Sector Puyehue 210',
    comuna: 'Osorno',
    proyectos: ['Casa Puyehue'],
  },
  {
    nombre: 'Constructora Volcán',
    rutCuerpo: '77987456',
    giro: 'Construcción',
    telefono: '+56 65 234 9988',
    direccion: 'Vial 1055',
    comuna: 'Puerto Montt',
    proyectos: ['Condominio Alerce', 'Etapa 2 · Condominio Alerce'],
    correo: 'adquisiciones@constructoravolcan.cl',
  },
  {
    nombre: 'Clínica Los Lagos',
    rutCuerpo: '74968523',
    giro: 'Salud',
    telefono: '+56 65 267 4100',
    direccion: 'Av. Diego Portales 1200',
    comuna: 'Puerto Montt',
    proyectos: ['Remodelación pabellones'],
    notas: 'Trabajo en horario diurno; despacho con cita previa.',
  },
  {
    nombre: 'Paula Cárdenas',
    rutCuerpo: '18547326',
    giro: 'Particular',
    telefono: '+56 9 8866 5599',
    direccion: 'Av. del Mar 1450',
    comuna: 'La Serena',
    proyectos: ['Casa playa'],
  },
  {
    nombre: 'Transportes Nahuel',
    rutCuerpo: '76745123',
    giro: 'Transporte de carga',
    telefono: '+56 45 233 1177',
    direccion: 'Ruta 5 km 698',
    comuna: 'Temuco',
    proyectos: ['Oficina y galpón'],
  },
  {
    nombre: 'Municipalidad de Lanco',
    rutCuerpo: '69513001',
    giro: 'Municipalidad',
    telefono: '+56 63 251 2233',
    direccion: 'Arturo Prat 60',
    comuna: 'Lanco',
    proyectos: ['Sede social'],
    notas: 'Compra pública; incluir orden de compra en la factura.',
  },
  {
    nombre: 'Felipe Aravena',
    rutCuerpo: '19234567',
    giro: 'Particular',
    telefono: '+56 9 6677 2288',
    direccion: 'Sector Pedregoso 12',
    comuna: 'Villarrica',
    proyectos: ['Cabañas turísticas'],
  },
];

/** Puertas reales del catálogo; el `alto` acompaña la variante del código. */
const PRODUCTOS = [
  { codigo: 'HUIL-O-3-B', ancho: 0.82, alto: 2.1 },
  { codigo: 'MOL-O-3-B', ancho: 0.8, alto: 2.1 },
  { codigo: 'PAN-L-3-B', ancho: 0.85, alto: 2.1 },
  { codigo: 'RAN-O-3-C', ancho: 0.8, alto: 2.2 },
  { codigo: 'ANC-L-3-A', ancho: 0.8, alto: 2 },
  { codigo: 'BAK-L-3-A', ancho: 0.85, alto: 2 },
  { codigo: 'CAL-L-3-B', ancho: 0.8, alto: 2.1 },
  { codigo: 'CHAN-M-3-B', ancho: 0.8, alto: 2.1 },
  { codigo: 'COZ-R-3-B', ancho: 0.85, alto: 2.1 },
  { codigo: 'ENC-L-3-A', ancho: 0.85, alto: 2 },
  { codigo: 'FUTA-O-3-B', ancho: 0.8, alto: 2.1 },
  { codigo: 'NEL-L-3-B', ancho: 0.8, alto: 2.1 },
  { codigo: 'PET-M-3-A', ancho: 0.8, alto: 2 },
  { codigo: 'PIR-R-3-B', ancho: 0.85, alto: 2.1 },
  { codigo: 'TOLT-O-3-C', ancho: 0.8, alto: 2.2 },
  { codigo: 'YEL-L-3-B', ancho: 0.8, alto: 2.1 },
  { codigo: 'HUEL-L-3-A', ancho: 0.8, alto: 2 },
  { codigo: 'LIC-M-3-B', ancho: 0.85, alto: 2.1 },
  { codigo: 'RUP-O-3-B', ancho: 0.8, alto: 2.1 },
  { codigo: 'RIÑ-L-3-B', ancho: 0.8, alto: 2.1 },
  { codigo: 'COCH-R-3-B', ancho: 0.85, alto: 2.1 },
  { codigo: 'FUTR-M-3-C', ancho: 0.8, alto: 2.2 },
];

type EstadoSiembra =
  'borrador' | 'emitida' | 'aprobada' | 'anticipo' | 'pagada' | 'conNota' | 'completada' | 'anulada';

const ESTADOS: EstadoSiembra[] = [
  'emitida',
  'borrador',
  'aprobada',
  'emitida',
  'anticipo',
  'emitida',
  'completada',
  'emitida',
  'anulada',
  'conNota',
  'pagada',
];

const MOTIVOS_ANULACION = [
  'El cliente desistió de la compra',
  'Se reemplazó por una cotización corregida',
  'El proyecto quedó en pausa',
  'Cambió la especificación de las puertas',
];

const TOTAL = 44;

/** Crea las cotizaciones de la siembra y devuelve sus ids en orden de creación. */
async function crearCotizaciones(request: APIRequestContext): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < TOTAL; i++) {
    const cliente = CLIENTES[i % CLIENTES.length];
    const vuelta = Math.floor(i / CLIENTES.length);
    const estado = ESTADOS[i % ESTADOS.length];
    const proyecto = cliente.proyectos[vuelta % cliente.proyectos.length];
    const cantidadLineas = 1 + (i % 3);
    const primera = PRODUCTOS[(i * 3) % PRODUCTOS.length];
    let q: CotizacionApi = await crearBorrador(request, {
      cliente: cliente.nombre,
      rutCuerpo: cliente.rutCuerpo,
      giro: cliente.giro,
      telefono: cliente.telefono,
      direccion: cliente.direccion,
      comuna: cliente.comuna,
      proyecto,
      cantidad: 1 + ((i * 5) % 8),
      codigo: primera.codigo,
      ancho: primera.ancho,
      alto: primera.alto,
    });
    for (let linea = 1; linea < cantidadLineas; linea++) {
      const producto = PRODUCTOS[(i * 3 + linea * 7) % PRODUCTOS.length];
      q = await accion(request, {
        tipo: 'agregar_producto',
        id: q.id,
        actualizada: q.actualizada,
        codigo: producto.codigo,
        cantidad: 1 + ((i + linea * 2) % 5),
        ancho: producto.ancho,
        alto: producto.alto,
        tipoMedida: 'hoja',
      });
    }

    if (estado !== 'borrador')
      q = await accion(request, { tipo: 'emitir', id: q.id, actualizada: q.actualizada });
    if (['aprobada', 'anticipo', 'pagada', 'conNota', 'completada'].includes(estado))
      q = await accion(request, { tipo: 'aprobar', id: q.id, actualizada: q.actualizada });
    if (estado === 'anticipo' || estado === 'conNota') {
      const total = await totalDe(request, q.id);
      q = await accion(request, {
        tipo: 'pago',
        id: q.id,
        actualizada: q.actualizada,
        monto: Math.ceil(total * 0.5),
      });
    }
    if (estado === 'pagada') {
      const total = await totalDe(request, q.id);
      q = await accion(request, { tipo: 'pago', id: q.id, actualizada: q.actualizada, monto: total });
    }
    if (estado === 'conNota')
      q = await accion(request, {
        tipo: 'generar_nota',
        id: q.id,
        actualizada: q.actualizada,
        fabrica: i % 2 === 0 ? 'panguipulli' : 'santiago',
      });
    if (estado === 'completada') q = await completarOperacion(request, q);
    if (estado === 'anulada')
      q = await accion(request, {
        tipo: 'anular',
        id: q.id,
        actualizada: q.actualizada,
        motivo: MOTIVOS_ANULACION[i % MOTIVOS_ANULACION.length],
      });
    ids.push(q.id);
  }
  return ids;
}

/** Registra como frecuentes algunos de los clientes sembrados, con correo y notas. */
async function registrarClientes(request: APIRequestContext) {
  for (const cliente of CLIENTES.slice(0, 9)) {
    const r = await request.post('/api/clientes', {
      data: {
        nombre: cliente.nombre,
        rut: rut(cliente.rutCuerpo),
        giro: cliente.giro,
        telefono: cliente.telefono,
        direccion: cliente.direccion,
        comuna: cliente.comuna,
        correo: cliente.correo ?? null,
        notas: cliente.notas ?? null,
      },
    });
    expect(r.ok(), `cliente sembrado ${cliente.nombre}: ${r.status()} ${r.ok() ? '' : await r.text()}`).toBe(
      true,
    );
  }
}

function restar(campo: string | null, dias: number) {
  if (!campo) return null;
  const fecha = new Date(campo);
  fecha.setUTCDate(fecha.getUTCDate() - dias);
  return fecha.toISOString();
}

function restarFecha(campo: string | null, dias: number) {
  if (!campo) return null;
  const fecha = new Date(`${campo}T12:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() - dias);
  return fecha.toISOString().slice(0, 10);
}

/**
 * Reparte las fechas de las cotizaciones sembradas en los últimos 75 días para que el historial no parezca
 * escrito de una sola vez. Solo se usa aquí, sobre la base aislada del E2E.
 */
function repartirFechas(ids: string[]) {
  const db = new Database(join(DIR_E2E, 'cotizador.sqlite'));
  try {
    db.pragma('busy_timeout = 5000');
    const leer = db.prepare(
      'SELECT creada, actualizada, fecha_emision, vence, fecha_aprobacion, fecha_anulacion FROM cotizaciones WHERE id = ?',
    );
    const actualizarCotizacion = db.prepare(
      `UPDATE cotizaciones
          SET creada = ?, actualizada = ?, fecha_emision = ?, vence = ?, fecha_aprobacion = ?, fecha_anulacion = ?
        WHERE id = ?`,
    );
    const leerPagos = db.prepare('SELECT id, fecha FROM pagos WHERE cotizacion_id = ?');
    const actualizarPago = db.prepare('UPDATE pagos SET fecha = ? WHERE id = ?');
    const leerNotas = db.prepare(
      'SELECT numero, fecha, inicio_produccion, termino_produccion FROM notas_pedido WHERE cotizacion_id = ?',
    );
    const actualizarNota = db.prepare(
      'UPDATE notas_pedido SET fecha = ?, inicio_produccion = ?, termino_produccion = ? WHERE cotizacion_id = ? AND numero = ?',
    );

    db.transaction(() => {
      ids.forEach((id, i) => {
        const dias = Math.round((i * 75) / Math.max(1, ids.length - 1));
        if (!dias) return;
        const fila = leer.get(id) as {
          creada: string;
          actualizada: string;
          fecha_emision: string | null;
          vence: string | null;
          fecha_aprobacion: string | null;
          fecha_anulacion: string | null;
        };
        actualizarCotizacion.run(
          restar(fila.creada, dias),
          restar(fila.actualizada, dias),
          restar(fila.fecha_emision, dias),
          restarFecha(fila.vence, dias),
          restar(fila.fecha_aprobacion, dias),
          restar(fila.fecha_anulacion, dias),
          id,
        );
        for (const pago of leerPagos.all(id) as { id: number; fecha: string }[])
          actualizarPago.run(restar(pago.fecha, dias), pago.id);
        for (const nota of leerNotas.all(id) as {
          numero: number;
          fecha: string;
          inicio_produccion: string | null;
          termino_produccion: string | null;
        }[])
          actualizarNota.run(
            restar(nota.fecha, dias),
            restar(nota.inicio_produccion, dias),
            restar(nota.termino_produccion, dias),
            id,
            nota.numero,
          );
      });
    })();
  } finally {
    db.close();
  }
}

/** Datos completos de un cliente sembrado, para que los escenarios capturados no inventen otro RUT. */
export function clienteParaCaptura(nombre: string) {
  const cliente = CLIENTES.find((c) => c.nombre === nombre);
  if (!cliente) throw new Error(`Cliente de captura desconocido: ${nombre}`);
  return {
    cliente: cliente.nombre,
    rutCuerpo: cliente.rutCuerpo,
    giro: cliente.giro,
    telefono: cliente.telefono,
    direccion: cliente.direccion,
    comuna: cliente.comuna,
    proyecto: cliente.proyectos[0],
  };
}

/** Siembra el historial y el directorio de clientes de las capturas. */
export async function sembrarCapturas(request: APIRequestContext) {
  const ids = await crearCotizaciones(request);
  await registrarClientes(request);
  repartirFechas(ids);
}
