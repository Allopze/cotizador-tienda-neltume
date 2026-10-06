import { ErrorIA } from '../src/asistente/errores';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Servicio } from '../src/servidor/servicio';
import type { Cotizacion } from '../src/negocio/estado';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { clienteVacio, type Catalogo, type Producto, type SolicitudItem } from '../src/catalogo/tipos';
import { generarPdf, plantilla } from '../src/servidor/pdf';
import { preguntasPendientes } from '../src/negocio/pendientes';
import { ServicioAltaCatalogo } from '../src/servidor/alta-catalogo';
import { guardarCatalogo, RepositorioCatalogoSqlite } from '../src/servidor/repositorio-catalogo';
import { cotizacionSchema } from '../src/servidor/persistencia-esquemas';
import type { Rechazo } from '../src/catalogo/resolver';
vi.mock('../src/servidor/pdf', () => ({
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));
const dirs: string[] = [];
const catalogo: Catalogo = {
  fuente: 'test',
  sha256: 'test',
  fecha: '2026-01-01',
  productos: [
    {
      codigo: 'MOL-O-3-A',
      modelo: 'MOLCO',
      familia: 'PUERTA',
      tipo: 'PUERTA PANEL',
      madera: 'PINO OREGON',
      medida: '0,80 A 0,85',
      anchoMin: 0.8,
      anchoMax: 0.85,
      largo: 2,
      precioNeto: 100.4,
      descripcion: 'MOLCO',
      filaOrigen: 4,
    },
  ],
};
const solicitud: SolicitudItem = {
  modelo: 'MOLCO',
  madera: 'pino',
  ancho: 80,
  alto: 2,
  medida: null,
  cantidad: 3,
};
const actualizar = { name: 'actualizar_cotizacion', input: { items: [solicitud], cliente: clienteVacio() } };
const modificarCantidad = (cantidad: number) => ({
  name: 'modificar_cotizacion',
  input: { items: [{ indice: 0, cambios: { cantidad } }] },
});
const clienteMaria = {
  ...clienteVacio(),
  nombre: 'María José',
  comuna: 'Temuco',
  proyecto: 'Casa Norte',
};
const emitir = (s: Servicio, q: Cotizacion) =>
  s.ejecutar({ tipo: 'emitir', id: q.id, actualizada: q.actualizada });
const aprobar = (s: Servicio, q: Cotizacion) =>
  s.ejecutar({ tipo: 'aprobar', id: q.id, actualizada: q.actualizada });
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-test-'));
  dirs.push(dir);
  const almacen = new Almacen(dir),
    llm = { interpretar: vi.fn().mockResolvedValue(actualizar) };
  return { dir, almacen, llm, servicio: new Servicio(catalogo, llm, almacen) };
}
afterEach(async () => {
  vi.clearAllMocks();
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});
describe('Persistencia y flujo del asistente', () => {
  it('agrega el marco pendiente de sección 30x100 y lo cotiza con una edición sin cambios de campos', async () => {
    const { almacen, llm } = await setup();
    const puerta = catalogo.productos[0];
    const marco = {
      ...puerta, modelo: 'MARCO', familia: 'MARCO' as const, tipo: null,
      madera: 'PINO FINGER ENCHAPADO MARA', medida: '30X90', anchoMin: null, anchoMax: null,
      precioNeto: 50_000, descripcion: 'MARCO PINO FINGER ENCHAPADO MARA 30X90',
    };
    guardarCatalogo(almacen.baseDatos(), {
      ...catalogo,
      productos: [
        { ...puerta, codigo: 'HUIL-EM', modelo: 'HUILO HUILO', madera: 'MARA ENCHAPADA', largo: 2.4, altoMin: 2.21, altoMax: 2.4, precioNeto: 100_000 },
        { ...puerta, codigo: 'RAN-L', modelo: 'RANCO', madera: 'LENGA', anchoMin: 0.85, anchoMax: 0.9, medida: '0,85 A 0,90', largo: 2.5, altoMin: 2.21, altoMax: 2.5, precioNeto: 150_000 },
        { ...marco, codigo: 'MAR-FE-250', largo: 2.5 },
        { ...marco, codigo: 'MAR-FE-300', largo: 3 },
        { ...marco, codigo: 'MAR-L-250', madera: 'LENGA', medida: '2X5', largo: 2.5 },
        { ...marco, codigo: 'MAR-L-210', madera: 'LENGA', medida: '2X5', largo: 2.1 },
      ],
    });
    const repositorio = new RepositorioCatalogoSqlite(almacen.baseDatos());
    const servicio = new Servicio(repositorio, llm, almacen);
    const items: SolicitudItem[] = [
      { modelo: 'Huilo Huilo', madera: 'MARA ENCHAPADA', ancho: 0.82, alto: 2.27, medida: null, cantidad: 2, tipoMedida: 'vano' },
      // «Marco enchapado» llega como MARA ENCHAPADA: se guarda y se da de alta como Pino Finger enchapado.
      { modelo: 'Marco', madera: 'MARA ENCHAPADA', ancho: null, alto: 2.27, medida: '30X100', cantidad: 2 },
      { modelo: 'Ranco', madera: 'LENGA', ancho: 0.87, alto: 2.44, medida: null, cantidad: 1 },
      { modelo: 'Marco', madera: 'LENGA', ancho: null, alto: 2.44, medida: '2X5', cantidad: 1 },
    ];
    llm.interpretar.mockResolvedValueOnce({ name: 'actualizar_cotizacion', input: { items, cliente: clienteVacio() } });
    let q = (await servicio.ejecutar({
      tipo: 'chat',
      mensaje: '2 Huilo Huilo enchapada 0,82×2,27 vano con marco 30x100 enchapado de 2,27; 1 Ranco lenga 0,87×2,44 con marco 2x5 lenga',
    })).cotizacion;
    expect(q.incompletos).toHaveLength(1);
    expect(q.incompletos[0]).toMatchObject({ indice: 1, rechazo: { tipo: 'medida_no_disponible', campo: 'medida', familia: 'MARCO', valor: '30X100' } });
    const [pregunta] = preguntasPendientes(q);
    expect(pregunta.alta).toEqual({
      familia: 'MARCO', modelo: 'Marco', madera: 'PINO FINGER ENCHAPADO MARA', medida: '30X100',
      anchoMin: null, anchoMax: null, largo: 2.27,
    });
    q = almacen.obtener(q.id)!;
    const solicitudes = structuredClone(q.solicitudes),
      eventosAntes = almacen.eventos(q.id);
    // Sin un producto nuevo, la edición vacía no guarda ni registra actividad.
    const sinProducto = (await servicio.ejecutar({ tipo: 'editar', id: q.id, actualizada: q.actualizada })).cotizacion;
    expect(sinProducto).toEqual(q);
    expect(almacen.obtener(q.id)).toEqual(q);
    expect(almacen.eventos(q.id)).toEqual(eventosAntes);

    const alta = new ServicioAltaCatalogo(almacen.baseDatos(), repositorio, llm);
    const propuesta = alta.proponerManual(undefined, { ...pregunta.alta!, tipo: null, precioNeto: 48_000 }, 'cuenta');
    const nuevo = alta.confirmar(propuesta.id, 'cuenta');
    const versionAntes = q.actualizada;
    // Como en una petición nueva, el servicio recibe el catálogo actualizado.
    const actualizado = new Servicio(new RepositorioCatalogoSqlite(almacen.baseDatos()), llm, almacen);
    q = (await actualizado.ejecutar({ tipo: 'editar', id: q.id, actualizada: q.actualizada })).cotizacion;
    expect(q.incompletos).toEqual([]);
    expect(q.solicitudes).toEqual(solicitudes.map((s, i) => i === 1 ? { ...s, modelo: 'MARCO', coincidenciaModelo: 'canonico' } : s));
    expect(q.montos.lineas).toHaveLength(4);
    expect(q.montos.lineas.find((l) => l.indice === 1)).toMatchObject({ producto: { codigo: nuevo.codigo, precioNeto: 48_000 }, cantidad: 2, altoSolicitado: 2.27 });
    expect(q.actualizada).not.toBe(versionAntes);
    expect(almacen.obtener(q.id)).toEqual(q);
    expect(almacen.eventos(q.id).slice(eventosAntes.length)).toMatchObject([
      { tipo: 'modificada', detalle: `Ítem 2 cotizado con ${nuevo.codigo}, agregado al catálogo` },
    ]);
    expect(llm.interpretar).toHaveBeenCalledTimes(1);
    // Repetir el callback de guardado tampoco agrega eventos ni altera la versión.
    const eventos = almacen.eventos(q.id);
    expect((await actualizado.ejecutar({ tipo: 'editar', id: q.id, actualizada: q.actualizada })).cotizacion).toEqual(q);
    expect(almacen.eventos(q.id)).toEqual(eventos);
  });

  it('pasar un marco de Pino Finger enchapado a Mara Enchapada no es cambiar de producto: conserva precio y descripción', async () => {
    const { almacen, llm } = await setup();
    const marco: Producto = {
      codigo: 'MAR-FE-250', modelo: 'MARCO', familia: 'MARCO', tipo: 'SET DE MARCO ENCHAPADO',
      madera: 'PINO FINGER ENCHAPADO MARA', medida: '30X90', anchoMin: null, anchoMax: null, largo: 2.5,
      precioNeto: 50_000, descripcion: 'MARCO PINO FINGER ENCHAPADO MARA 30X90', filaOrigen: 1,
    };
    guardarCatalogo(almacen.baseDatos(), { ...catalogo, productos: [...catalogo.productos, marco] });
    const servicio = new Servicio(new RepositorioCatalogoSqlite(almacen.baseDatos()), llm, almacen);
    const items: SolicitudItem[] = [
      { modelo: 'Marco', madera: 'MARA ENCHAPADA', ancho: null, alto: 2.27, medida: '30X90', cantidad: 2 },
    ];
    llm.interpretar.mockResolvedValueOnce({ name: 'actualizar_cotizacion', input: { items, cliente: clienteVacio() } });
    let q = (await servicio.ejecutar({ tipo: 'chat', mensaje: '2 marcos 30x90 enchapados de 2,27' })).cotizacion;
    expect(q.montos.lineas[0].producto.codigo).toBe('MAR-FE-250');
    const editar = async (cambios: Record<string, unknown>) =>
      (await servicio.ejecutar({ tipo: 'editar', id: q.id, actualizada: q.actualizada, items: [{ indice: 0, cambios }] })).cotizacion;
    q = await editar({ precioUnitario: 70_000, descripcion: 'Set acordado en obra' });
    q = await editar({ madera: 'MARA ENCHAPADA' });
    expect(q.solicitudes[0]).toMatchObject({ madera: 'PINO FINGER ENCHAPADO MARA', precioUnitario: 70_000, descripcion: 'Set acordado en obra' });
    expect(q.montos.lineas[0]).toMatchObject({ producto: { codigo: 'MAR-FE-250' }, precioUnitario: 70_000 });

    // Completar el modelo de un ítem «enchapado» tampoco cambia la madera: precio y descripción siguen.
    llm.interpretar.mockResolvedValueOnce({
      name: 'actualizar_cotizacion',
      input: { items: [{ ...items[0], modelo: null }], cliente: clienteVacio() },
    });
    q = (await servicio.ejecutar({ tipo: 'chat', mensaje: '2 enchapados 30x90 de 2,27' })).cotizacion;
    expect(q.solicitudes[0]).toMatchObject({ modelo: null, madera: 'MARA ENCHAPADA' });
    q = await editar({ precioUnitario: 70_000, descripcion: 'Set acordado en obra' });
    q = await editar({ modelo: 'Marco' });
    expect(q.incompletos).toEqual([]);
    expect(q.solicitudes[0]).toMatchObject({ madera: 'PINO FINGER ENCHAPADO MARA', precioUnitario: 70_000, descripcion: 'Set acordado en obra' });
  });

  it('si el marco también viene en Mara Enchapada, pasar a ella sí es cambiar de producto', async () => {
    const { almacen, llm } = await setup();
    const marco: Producto = {
      codigo: 'MAR-FE-250', modelo: 'MARCO', familia: 'MARCO', tipo: 'SET DE MARCO ENCHAPADO',
      madera: 'PINO FINGER ENCHAPADO MARA', medida: '30X90', anchoMin: null, anchoMax: null, largo: 2.5,
      precioNeto: 50_000, descripcion: 'MARCO PINO FINGER ENCHAPADO MARA 30X90', filaOrigen: 1,
    };
    const enchapado = { ...marco, codigo: 'MAR-EM-250', madera: 'MARA ENCHAPADA', descripcion: 'MARCO MARA ENCHAPADA 30X90', filaOrigen: 2 };
    guardarCatalogo(almacen.baseDatos(), { ...catalogo, productos: [...catalogo.productos, marco, enchapado] });
    const servicio = new Servicio(new RepositorioCatalogoSqlite(almacen.baseDatos()), llm, almacen);
    const items: SolicitudItem[] = [
      { modelo: 'Marco', madera: 'PINO FINGER ENCHAPADO MARA', ancho: null, alto: 2.27, medida: '30X90', cantidad: 2 },
    ];
    llm.interpretar.mockResolvedValueOnce({ name: 'actualizar_cotizacion', input: { items, cliente: clienteVacio() } });
    let q = (await servicio.ejecutar({ tipo: 'chat', mensaje: '2 marcos finger enchapados 30x90 de 2,27' })).cotizacion;
    const editar = async (cambios: Record<string, unknown>) =>
      (await servicio.ejecutar({ tipo: 'editar', id: q.id, actualizada: q.actualizada, items: [{ indice: 0, cambios }] })).cotizacion;
    q = await editar({ precioUnitario: 70_000, descripcion: 'Set acordado en obra' });
    q = await editar({ madera: 'MARA ENCHAPADA' });
    expect(q.montos.lineas[0].producto.codigo).toBe('MAR-EM-250');
    expect(q.solicitudes[0]).toMatchObject({ madera: 'MARA ENCHAPADA', precioUnitario: null, descripcion: 'Set acordado en obra' });
  });

  it('cotiza un pendiente tras reimportar la planilla y registra el producto del catálogo vigente', async () => {
    const { almacen, llm } = await setup();
    guardarCatalogo(almacen.baseDatos(), catalogo);
    const servicio = new Servicio(new RepositorioCatalogoSqlite(almacen.baseDatos()), llm, almacen);
    const items = [solicitud, { ...solicitud, madera: 'LENGA' }];
    llm.interpretar.mockResolvedValueOnce({ name: 'actualizar_cotizacion', input: { items, cliente: clienteVacio() } });
    let q = (await servicio.ejecutar({ tipo: 'chat', mensaje: '3 Molco oregón y 3 Molco lenga' })).cotizacion;
    expect(q.incompletos).toMatchObject([{ indice: 1, rechazo: { tipo: 'madera_no_disponible' } }]);
    const eventosAntes = almacen.eventos(q.id);
    const nuevo = { ...catalogo.productos[0], codigo: 'MOL-L-3-A', madera: 'LENGA' };
    guardarCatalogo(almacen.baseDatos(), { ...catalogo, productos: [...catalogo.productos, nuevo] });
    const actualizado = new Servicio(new RepositorioCatalogoSqlite(almacen.baseDatos()), llm, almacen);
    q = (await actualizado.ejecutar({ tipo: 'editar', id: q.id, actualizada: q.actualizada })).cotizacion;
    expect(q.incompletos).toEqual([]);
    expect(q.montos.lineas.find((l) => l.indice === 1)?.producto.codigo).toBe(nuevo.codigo);
    expect(almacen.eventos(q.id).slice(eventosAntes.length)).toMatchObject([
      { tipo: 'modificada', detalle: 'Ítem 2 cotizado con MOL-L-3-A del catálogo vigente' },
    ]);
    expect(llm.interpretar).toHaveBeenCalledTimes(1);
  });

  it.each<Rechazo>([
    { tipo: 'modelo_posible', valor: 'Cunco', sugerido: 'CUNCU', disponibles: ['CUNCU'], familia: 'PUERTA' },
    { tipo: 'madera_desconocida', valor: 'Roble', disponibles: [], familia: 'PUERTA' },
    { tipo: 'madera_no_disponible', valor: 'LENGA', disponibles: [], familia: 'PUERTA' },
    { tipo: 'medida_no_disponible', campo: 'alto', valor: 2.27, disponibles: [], familia: 'MARCO' },
  ])('carga $tipo con familia y también sin ella en cotizaciones antiguas', async (rechazo) => {
    const { servicio, almacen } = await setup();
    const q = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    q.solicitudes = [solicitud];
    q.incompletos = [{ indice: 0, rechazo, pregunta: 'Pendiente' }];
    expect(cotizacionSchema.parse(q).incompletos[0].rechazo).toEqual(rechazo);
    await almacen.transaccion((u) => u.guardar(q));
    expect(almacen.obtener(q.id)?.incompletos[0].rechazo).toEqual(rechazo);
    const legado = { ...rechazo };
    if ('familia' in legado) delete legado.familia;
    q.incompletos[0].rechazo = legado;
    expect(cotizacionSchema.parse(q).incompletos[0].rechazo).toEqual(legado);
    await almacen.transaccion((u) => u.guardar(q));
    expect(almacen.obtener(q.id)?.incompletos[0].rechazo).toEqual(legado);
  });

  it('correlativo 323, reinicio, PDF inmutable, edición crea borrador, nota sin ajuste y bloqueo', async () => {
    const { dir, servicio, llm } = await setup();
    let q = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    q = (await servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: '3 Molco' })).cotizacion;
    const emitida = (await emitir(servicio, q)).cotizacion;
    expect(emitida.numero).toBe(323);
    expect(emitida.montos.total).toBe(664);
    const alterado = structuredClone(catalogo);
    alterado.productos[0].precioNeto = 999;
    const reiniciado = new Servicio(alterado, llm, new Almacen(dir));
    // Reintentar la emisión es idempotente aunque la versión enviada ya no sea la actual.
    expect((await emitir(reiniciado, q)).archivo).toBe('cotizacion-323.pdf');
    expect(generarPdf).toHaveBeenCalledTimes(1);
    const sinCambios = (await reiniciado.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'igual' })).cotizacion;
    expect(sinCambios.id).toBe(q.id);
    expect(sinCambios.historial.at(-1)?.texto).toContain('No hay cambios');
    // B3: el historial de una emitida no cambia su versión.
    expect(sinCambios.actualizada).toBe(emitida.actualizada);
    llm.interpretar.mockResolvedValueOnce({
      ...actualizar,
      input: { ...actualizar.input, items: [{ ...solicitud, cantidad: 4 }] },
    });
    const copia = (await reiniciado.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'actualiza' })).cotizacion;
    expect(copia.id).not.toBe(q.id);
    expect(copia.numero).toBeNull();
    expect(copia.estado).toBe('borrador');
    expect(copia.montos.total).toBe(
      Math.round(999 * 1.85) * 4 + Math.round(Math.round(999 * 1.85) * 4 * 0.19),
    );
    const revision = (await emitir(reiniciado, copia)).cotizacion;
    expect(revision.numero).toBe(324);
    // A2: la original quedó reemplazada y ya no se puede aprobar.
    const original = new Almacen(dir).obtener(q.id)!;
    expect(original.estado).toBe('reemplazada');
    expect(original.reemplazadaPor).toBe(324);
    await expect(aprobar(reiniciado, original)).rejects.toThrow('reemplazada');
    let aprobada = (await aprobar(reiniciado, revision)).cotizacion;
    expect(aprobada.montos.total).toBe(copia.montos.total);
    expect(aprobada.nota).toBeNull();
    const mitad = Math.ceil(aprobada.montos.total * 0.5);
    aprobada = (
      await reiniciado.ejecutar({
        tipo: 'pago',
        id: aprobada.id,
        actualizada: aprobada.actualizada,
        monto: mitad,
      })
    ).cotizacion;
    aprobada = (
      await reiniciado.ejecutar({ tipo: 'generar_nota', id: aprobada.id, actualizada: aprobada.actualizada })
    ).cotizacion;
    expect(aprobada.nota?.montos.lineas[0].precioUnitario).toBe(999);
    expect(aprobada.nota?.numero).toBe(1);
    expect(plantilla).toHaveBeenCalledTimes(3);
    await expect(
      reiniciado.ejecutar({ tipo: 'quitar', id: aprobada.id, actualizada: aprobada.actualizada, indice: 0 }),
    ).rejects.toThrow('aprobada');
    await expect(reiniciado.ejecutar({ tipo: 'chat', id: aprobada.id, mensaje: 'cambia' })).rejects.toThrow(
      'aprobada',
    );
    await aprobar(reiniciado, aprobada);
    expect(generarPdf).toHaveBeenCalledTimes(3);
    expect(new Almacen(dir).correlativos().siguienteCotizacion).toBe(325);
  });
  it('encuentra una cotización anterior sin crear un borrador y aplica solo el cambio pedido', async () => {
    const { servicio, llm, almacen } = await setup();
    const q = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    llm.interpretar.mockResolvedValueOnce({
      name: 'actualizar_cotizacion',
      input: { items: [solicitud], cliente: clienteMaria },
    });
    const lista = (await servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: '3 Huilo Huilo' })).cotizacion;
    const emitida = (await emitir(servicio, lista)).cotizacion;
    llm.interpretar.mockResolvedValueOnce(modificarCantidad(8));

    const resultado = await servicio.ejecutar({
      tipo: 'chat',
      mensaje: 'La cotización de Maria Jose ahora debe ser de 8 puertas y no de 3',
    });

    expect(resultado.cotizacion.id).not.toBe(emitida.id);
    expect(resultado.cotizacion.origen).toBe(323);
    expect(resultado.cotizacion.solicitudes).toMatchObject([
      { ...solicitud, madera: 'PINO OREGON', modelo: 'MOLCO', cantidad: 8 },
    ]);
    expect(resultado.cotizacion.cliente).toEqual(clienteMaria);
    expect(resultado.cotizacion.montos.total).toBe(1771);
    expect(emitida.solicitudes).toMatchObject([{ ...solicitud, madera: 'PINO OREGON', modelo: 'MOLCO' }]);
    expect(emitida.pdf).toBe('cotizacion-323.pdf');
    const estado = await almacen.leer();
    expect(estado.cotizaciones).toHaveLength(2);
    expect(llm.interpretar.mock.calls.at(-1)?.[0].modo).toBe('modificacion_anterior');
    expect(JSON.stringify(llm.interpretar.mock.calls.at(-1)?.[0])).not.toMatch(/montos|precioNeto|lineas/);
  });

  it('conserva otros ítems y los campos no mencionados al aplicar un parche', async () => {
    const { servicio, llm } = await setup();
    const borrador = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    const segundo = { ...solicitud, cantidad: 5, ancho: 0.85 };
    llm.interpretar.mockResolvedValueOnce({
      name: 'actualizar_cotizacion',
      input: { items: [solicitud, segundo], cliente: clienteMaria },
    });
    await servicio.ejecutar({ tipo: 'chat', id: borrador.id, mensaje: 'pedido para María José' });
    llm.interpretar.mockResolvedValueOnce(modificarCantidad(8));
    const resultado = await servicio.ejecutar({
      tipo: 'chat',
      mensaje: 'La cotización de María José ahora debe ser de 8 y no de 3 puertas',
    });
    expect(resultado.cotizacion.solicitudes).toMatchObject([
      { ...solicitud, madera: 'PINO OREGON', modelo: 'MOLCO', cantidad: 8 },
      { ...segundo, madera: 'PINO OREGON', modelo: 'MOLCO' },
    ]);
    expect(resultado.cotizacion.cliente).toEqual(clienteMaria);
  });

  it('pide elegir si hay varias cotizaciones y aplica el mensaje original solo a la seleccionada', async () => {
    const { servicio, llm, almacen } = await setup();
    async function crearEmitida() {
      const borrador = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
      llm.interpretar.mockResolvedValueOnce({
        name: 'actualizar_cotizacion',
        input: { items: [solicitud], cliente: clienteMaria },
      });
      const lista = (await servicio.ejecutar({ tipo: 'chat', id: borrador.id, mensaje: '3 Huilo Huilo' }))
        .cotizacion;
      return (await emitir(servicio, lista)).cotizacion;
    }
    const primera = await crearEmitida();
    const segunda = await crearEmitida();
    const mensaje = 'La cotización de María José ahora debe ser de 8 puertas y no de 3';

    const opciones = await servicio.ejecutar({ tipo: 'chat', mensaje });
    expect(opciones.seleccion?.map((o) => o.numero)).toEqual([324, 323]);
    expect(opciones.cotizacion.id).toBe(opciones.seleccion?.[0].id);
    expect(llm.interpretar).toHaveBeenCalledTimes(2);
    expect((await almacen.leer()).cotizaciones).toHaveLength(2);

    llm.interpretar.mockResolvedValueOnce(modificarCantidad(8));
    const objetivo = opciones.seleccion![0];
    const aplicado = await servicio.ejecutar({
      tipo: 'chat',
      mensaje,
      objetivoId: objetivo.id,
      objetivoActualizada: objetivo.actualizada,
    });

    expect(aplicado.cotizacion.origen).toBe(segunda.numero);
    expect(aplicado.cotizacion.solicitudes[0].cantidad).toBe(8);
    const guardadas = (await almacen.leer()).cotizaciones;
    expect(guardadas.find((q) => q.id === primera.id)?.solicitudes[0].cantidad).toBe(3);
    expect(guardadas.find((q) => q.id === segunda.id)?.solicitudes[0].cantidad).toBe(3);
    expect(guardadas).toHaveLength(3);
  });

  it('rechaza la selección obsoleta y no altera la cotización', async () => {
    const { servicio, llm, almacen } = await setup();
    const borrador = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    llm.interpretar.mockResolvedValueOnce({
      name: 'actualizar_cotizacion',
      input: { items: [solicitud], cliente: clienteMaria },
    });
    const lista = (await servicio.ejecutar({ tipo: 'chat', id: borrador.id, mensaje: '3 Huilo Huilo' }))
      .cotizacion;
    const emitida = (await emitir(servicio, lista)).cotizacion;
    const opcion = { id: emitida.id, actualizada: emitida.actualizada };
    llm.interpretar.mockImplementationOnce(async () => {
      await almacen.transaccion(async (u) => {
        const q = u.obtener(emitida.id)!;
        q.actualizada = '2026-06-01T00:00:00.000Z';
        u.guardar(q);
      });
      return modificarCantidad(8);
    });
    await expect(
      servicio.ejecutar({
        tipo: 'chat',
        mensaje: 'La cotización de María José ahora debe ser de 8 y no de 3 puertas',
        objetivoId: opcion.id,
        objetivoActualizada: opcion.actualizada,
      }),
    ).rejects.toThrow('cambió');
    expect(
      (await almacen.leer()).cotizaciones.find((q) => q.id === emitida.id)?.solicitudes[0].cantidad,
    ).toBe(3);
  });

  it('mantiene bloqueada una cotización aprobada aunque se la mencione por número', async () => {
    const { servicio, llm } = await setup();
    const borrador = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    llm.interpretar.mockResolvedValueOnce({
      name: 'actualizar_cotizacion',
      input: { items: [solicitud], cliente: clienteMaria },
    });
    const lista = (await servicio.ejecutar({ tipo: 'chat', id: borrador.id, mensaje: '3 Huilo Huilo' }))
      .cotizacion;
    await aprobar(servicio, (await emitir(servicio, lista)).cotizacion);
    llm.interpretar.mockClear();
    await expect(
      servicio.ejecutar({
        tipo: 'chat',
        mensaje: 'Modifica la cotización N° 323: ahora son 8 puertas',
      }),
    ).rejects.toThrow('aprobada');
    expect(llm.interpretar).not.toHaveBeenCalled();
  });

  it('sin una referencia encontrada crea solo la cotización nueva para el mensaje', async () => {
    const { servicio, llm, almacen } = await setup();
    const resultado = await servicio.ejecutar({ tipo: 'chat', mensaje: 'Cotiza 3 Molco' });
    expect(resultado.cotizacion.solicitudes).toMatchObject([
      { ...solicitud, madera: 'PINO OREGON', modelo: 'MOLCO' },
    ]);
    expect((await almacen.leer()).cotizaciones).toHaveLength(1);
    expect(llm.interpretar.mock.calls[0][0].modo).toBe('cotizacion_nueva');
  });
  it('salida inválida preserva el borrador y agrega la respuesta requerida', async () => {
    const { servicio, llm } = await setup();
    let q = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    q = (await servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'pedido' })).cotizacion;
    llm.interpretar.mockResolvedValue({
      name: 'actualizar_cotizacion',
      input: { items: [], cliente: {}, precio: 123 },
    });
    const nueva = (await servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'algo' })).cotizacion;
    expect(nueva.solicitudes).toMatchObject(q.solicitudes);
    expect(nueva.montos).toEqual(q.montos);
    expect(nueva.historial.at(-1)?.texto).toBe('No entendí, ¿puedes reformularlo?');
    const contexto = llm.interpretar.mock.calls[0][0];
    expect(JSON.stringify(contexto)).not.toMatch(/precioNeto|montos|lineas/);
  });
  it('los incompletos no suman y no permiten emitir', async () => {
    const { servicio, llm } = await setup();
    const q = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    llm.interpretar.mockResolvedValue({
      name: 'actualizar_cotizacion',
      input: { ...actualizar.input, items: [solicitud, { ...solicitud, madera: null, cantidad: null }] },
    });
    const r = (await servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'pedido' })).cotizacion;
    expect(r.montos.total).toBe(664);
    expect(r.incompletos).toHaveLength(1);
    expect(r.incompletos[0].pregunta).toMatch(/madera.*\n.*cantidad/);
    await expect(emitir(servicio, r)).rejects.toThrow('pendientes');
    const quitada = (
      await servicio.ejecutar({ tipo: 'quitar', id: q.id, actualizada: r.actualizada, indice: 1 })
    ).cotizacion;
    expect(quitada.incompletos).toHaveLength(0);
  });
  it('reserva durable: un fallo del PDF consume el correlativo y reintentar usa el siguiente', async () => {
    const { servicio, almacen } = await setup();
    const q = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    const lista = (await servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'pedido' })).cotizacion;
    vi.mocked(generarPdf).mockRejectedValueOnce(new Error('Chromium no disponible'));
    await expect(emitir(servicio, lista)).rejects.toThrow('Chromium');
    expect((await almacen.leer()).siguienteCotizacion).toBe(324);
    // El fallo no dejó la cotización a medio emitir: la misma versión sigue siendo válida.
    expect(almacen.obtener(q.id)!.actualizada).toBe(lista.actualizada);
    expect((await emitir(servicio, lista)).cotizacion.numero).toBe(324);
  });
  it('serializa escritores concurrentes y no reinicia un archivo dañado', async () => {
    const { dir, almacen } = await setup();
    const reservas = await Promise.all(
      Array.from({ length: 5 }, () => new Almacen(dir).transaccion(async (u) => u.reservarCotizacion())),
    );
    expect(reservas.sort()).toEqual([323, 324, 325, 326, 327]);
    expect((await almacen.leer()).siguienteCotizacion).toBe(328);
    const archivoDb = join(dir, 'cotizador.sqlite');
    cerrarAlmacen(archivoDb);
    await writeFile(archivoDb, '{inválido');
    await expect(new Almacen(dir).leer()).rejects.toThrow();
  });

  it('permite elegir un número solo por encima del último usado o reservado', async () => {
    const { almacen } = await setup();
    await expect(almacen.transaccion(async (u) => u.reservarCotizacion(322))).rejects.toThrow('mayor que el último');
    await expect(almacen.transaccion(async (u) => u.reservarCotizacion(500))).resolves.toBe(500);
    await expect(almacen.transaccion(async (u) => u.reservarCotizacion(500))).rejects.toThrow('mayor que el último');
    await expect(almacen.transaccion(async (u) => u.reservarCotizacion())).resolves.toBe(501);
  });
});

it('preserva el error tipado del proveedor y el borrador cuando la IA falla', async () => {
  const { servicio, llm, almacen } = await setup();
  const q = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
  const antes = await almacen.leer();
  const error = new ErrorIA('ia_limite', 'Modelo temporalmente no disponible.', 503);
  llm.interpretar.mockRejectedValueOnce(error);
  await expect(servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'cotiza' })).rejects.toBe(error);
  expect(await almacen.leer()).toEqual(antes);
});

describe('Aprobación, concurrencia y conflictos', () => {
  async function emitida() {
    const ctx = await setup();
    const inicial = (await ctx.servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    const lista = (await ctx.servicio.ejecutar({ tipo: 'chat', id: inicial.id, mensaje: 'pedido' }))
      .cotizacion;
    const q = (await emitir(ctx.servicio, lista)).cotizacion;
    return { ...ctx, q };
  }
  it('no aprueba un borrador sin PDF ni consume correlativos', async () => {
    const { servicio, almacen } = await setup();
    const q = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    const lista = (await servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'pedido' })).cotizacion;
    await expect(aprobar(servicio, lista)).rejects.toThrow('PDF');
    const estado = await almacen.leer();
    expect([estado.siguienteCotizacion, estado.siguienteNota]).toEqual([323, 1]);
  });
  it('la aprobación pedida por chat solo propone confirmar; no genera la nota', async () => {
    const { servicio, llm, almacen, q } = await emitida();
    const otra = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    llm.interpretar.mockResolvedValueOnce({ name: 'aprobar_cotizacion', input: { numero: 323 } });
    const r = await servicio.ejecutar({
      tipo: 'chat',
      id: otra.id,
      mensaje: 'Se aprobó la cotización N° 323, haz la nota de pedido',
    });
    expect(r.confirmar).toEqual({
      id: q.id,
      numero: 323,
      actualizada: q.actualizada,
      vence: q.vence,
      vencida: false,
    });
    expect(r.archivo).toBeUndefined();
    expect(r.cotizacion.historial.at(-1)?.texto).toContain('¿Confirmas');
    const estado = await almacen.leer();
    expect(estado.siguienteNota).toBe(1);
    expect(estado.cotizaciones.find((c) => c.id === q.id)?.estado).toBe('emitida');
    llm.interpretar.mockResolvedValueOnce({ name: 'aprobar_cotizacion', input: { numero: 999 } });
    const inexistente = await servicio.ejecutar({ tipo: 'chat', id: otra.id, mensaje: 'aprueba la 999' });
    expect(inexistente.cotizacion.historial.at(-1)?.texto).toContain('No existe la cotización N° 999');
  });
  it('consulta a la IA sin retener el bloqueo y envía el historial reciente', async () => {
    const { servicio, llm, almacen, dir } = await setup();
    const q = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    await servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'pedido' });
    let otraTransaccionMs = Infinity;
    llm.interpretar.mockImplementationOnce(async () => {
      const t0 = Date.now();
      await new Almacen(dir).transaccion(async () => null);
      otraTransaccionMs = Date.now() - t0;
      return actualizar;
    });
    await servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'otra vez' });
    expect(otraTransaccionMs).toBeLessThan(1000);
    const contexto = llm.interpretar.mock.calls.at(-1)![0];
    expect(contexto.historial.map((m: { texto: string }) => m.texto)).toContain('pedido');
    expect((await almacen.leer()).cotizaciones[0].historial.length).toBe(4);
  });
  it('rechaza aplicar la respuesta si la cotización cambió durante la consulta', async () => {
    const { servicio, llm, almacen } = await setup();
    const q = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    llm.interpretar.mockImplementationOnce(async () => {
      await almacen.transaccion(async (u) => {
        const guardada = u.obtener(q.id)!;
        guardada.actualizada = new Date(Date.now() + 1000).toISOString();
        u.guardar(guardada);
      });
      return actualizar;
    });
    await expect(servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'pedido' })).rejects.toThrow('cambió');
    expect((await almacen.leer()).cotizaciones[0].solicitudes).toEqual([]);
  });
  it('filtra montos del texto libre sin bloquear palabras comunes', async () => {
    const { servicio, llm } = await setup();
    const q = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    llm.interpretar.mockResolvedValueOnce({
      name: 'responder',
      input: { texto: '¿Cuál es el total de puertas?' },
    });
    const ok = (await servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'hola' })).cotizacion;
    expect(ok.historial.at(-1)?.texto).toBe('¿Cuál es el total de puertas?');
    llm.interpretar.mockResolvedValueOnce({ name: 'responder', input: { texto: 'Cuesta $ 120.000' } });
    const filtrado = (await servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'precio' })).cotizacion;
    expect(filtrado.historial.at(-1)?.texto).toContain('Los montos se muestran en la cotización');
  });
  it('guarda la fecha de emisión y crea el bloqueo dentro del directorio de datos', async () => {
    const { q, almacen, dir } = await emitida();
    const guardada = (await almacen.leer()).cotizaciones.find((c) => c.id === q.id)!;
    expect(guardada.fechaEmision).toBeTruthy();
    expect(vi.mocked(plantilla).mock.calls.at(-1)?.[1].fecha).toBe(guardada.fechaEmision);
    expect(vi.mocked(plantilla).mock.calls.at(-1)?.[1].vence).toBe(guardada.vence);
    const lock = almacen.transaccion(async () => {
      await expect(access(join(dir, '.estado.lock'))).resolves.toBeUndefined();
    });
    await lock;
    await expect(access(`${dir}.lock`)).rejects.toThrow();
  });
  it('rechaza un estado con estructura inválida sin reiniciar contadores', async () => {
    const { dir, almacen } = await setup();
    await writeFile(join(dir, 'estado.json'), JSON.stringify({ siguienteCotizacion: 'x', cotizaciones: [] }));
    await expect(almacen.leer()).rejects.toThrow('migrar:sqlite');
  });
});
