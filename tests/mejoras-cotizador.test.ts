import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolverItem } from '../src/catalogo/resolver';
import { nombreCanonicoModelo } from '../src/catalogo/configuracion';
import type { Catalogo, Producto, SolicitudItem } from '../src/catalogo/tipos';
import { cotizar, descripcionLinea, MARGENES_INICIALES, REGLAS } from '../src/negocio/precios';
import { Servicio } from '../src/servidor/servicio';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';

vi.mock('../src/servidor/pdf', () => ({
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

const puerta = (overrides: Partial<Producto> = {}): Producto => ({
  codigo: 'HUI-M-3-A', modelo: 'Huilo Huilo', familia: 'PUERTA', tipo: 'PUERTA SÓLIDA',
  madera: 'MARA', medida: '0,80 A 0,85', anchoMin: 0.8, anchoMax: 0.85,
  altoMin: 2.3, altoMax: 2.4, largo: 2.35, precioNeto: 100_000,
  descripcion: 'HUILO HUILO MARA 0,80 A 0,85 MT X 2,30 A 2,40 MT', filaOrigen: 7,
  ...overrides,
});
const catalogo: Catalogo = {
  fuente: 'test.xlsx', sha256: 'catalogo-test', fecha: '2026-01-01T00:00:00.000Z', productos: [puerta()],
};
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

describe('rangos de catálogo y confianza del modelo', () => {
  it('resuelve medidas exactas y dentro de rangos; rechaza valores fuera del catálogo', () => {
    const exacto = resolverItem(catalogo, { modelo: 'Huilo Huilo', madera: 'Mara', ancho: 0.8, alto: 2.3, cantidad: 1 });
    expect(exacto.ok && exacto.producto.codigo).toBe('HUI-M-3-A');
    const rango = resolverItem(catalogo, { modelo: 'Huilo Huilo', madera: 'Mara', ancho: 83.5, alto: 236, cantidad: 3 });
    expect(rango.ok && [rango.producto.codigo, rango.anchoSolicitado, rango.altoSolicitado]).toEqual(['HUI-M-3-A', 0.835, 2.36]);
    const fuera = resolverItem(catalogo, { modelo: 'Huilo Huilo', madera: 'Mara', ancho: 86, alto: 241, cantidad: 1 });
    expect(fuera.ok).toBe(false);
    if (!fuera.ok) expect(fuera.rechazo.tipo).toBe('medida_no_disponible');
  });

  it('normaliza variantes seguras de Huilo Huilo; una coincidencia posible queda pendiente hasta confirmarla', () => {
    expect(nombreCanonicoModelo('HUILO HUILO')).toBe('Huilo Huilo');
    for (const alias of ['Huilo', 'Huila', 'Willo', 'Willow', 'Huilo Huila', 'Willow Willow']) {
      const resultado = resolverItem(catalogo, { modelo: alias, madera: 'Mara', ancho: 83, alto: 236, cantidad: 1 });
      expect(resultado.ok && resultado.coincidenciaModelo).toBe('alias');
    }
    const posible = resolverItem(catalogo, { modelo: 'Pillo', madera: 'Mara', ancho: 83, alto: 236, cantidad: 1 });
    expect(posible).toEqual({
      ok: false,
      rechazo: { tipo: 'modelo_posible', valor: 'Pillo', sugerido: 'Huilo Huilo', disponibles: ['Huilo Huilo'], familia: 'PUERTA' },
    });
    const confirmado = resolverItem(catalogo, { modelo: 'Huilo Huilo', madera: 'Mara', ancho: 83, alto: 236, cantidad: 1 });
    expect(confirmado.ok && [confirmado.producto.codigo, confirmado.coincidenciaModelo]).toEqual(['HUI-M-3-A', 'canonico']);
    const catalogoConPillo = { ...catalogo, productos: [puerta({ codigo: 'PIL-M-3-A', modelo: 'Pillo' }), puerta()] };
    const canonico = resolverItem(catalogoConPillo, { modelo: 'Pillo', madera: 'Mara', ancho: 83, alto: 236, cantidad: 1 });
    expect(canonico.ok && [canonico.producto.codigo, canonico.coincidenciaModelo]).toEqual(['PIL-M-3-A', 'canonico']);
  });
});

describe('márgenes y trazabilidad de precios', () => {
  it('aplica márgenes estándar por categoría y acepta una excepción por línea', () => {
    const reglas = { ...REGLAS, margenes: MARGENES_INICIALES };
    const casos: [Producto, number][] = [
      [puerta({ madera: 'MARA' }), 0.55],
      [puerta({ madera: 'PINO OREGON' }), 0.85],
      [puerta({ madera: 'MARA', tipo: 'PUERTA PREPINTADA' }), 1.4],
      [puerta({ madera: 'MARA', tipo: 'PUERTA ENCHAPADA' }), 0.75],
      [puerta({ familia: 'MARCO', madera: 'PINO FINGER', descripcion: 'MARCO PINO FINGER DESNUDO' }), 1],
      [puerta({ familia: 'MARCO', madera: 'PINO FINGER', descripcion: 'MARCO PINO FINGER ENCHAPADO' }), 0.75],
    ];
    for (const [producto, margen] of casos) {
      const linea = cotizar([{ producto, cantidad: 1 }], reglas).lineas[0];
      expect(linea.margen).toBe(margen);
      expect(linea.precioUnitario).toBe(Math.round(producto.precioNeto * (1 + margen)));
      expect(linea.precioFabrica).toBe(producto.precioNeto);
      expect(linea.precioCliente).toBe(linea.precioUnitario);
      expect(linea.margenPersonalizado).toBe(false);
    }
    const prepintada = cotizar([{ producto: puerta({ tipo: 'PUERTA PREPINTADA' }), cantidad: 1 }], reglas).lineas[0];
    expect(prepintada.precioUnitario).toBe(240_000);
    const manual = cotizar([{ producto: puerta(), cantidad: 1, margen: 0.42 }], reglas).lineas[0];
    expect([manual.precioFabrica, manual.margen, manual.precioCliente, manual.margenPersonalizado]).toEqual([100_000, 0.42, 142_000, true]);
  });
});

describe('descripción de documento y observaciones de línea', () => {
  it('la descripción escrita no cambia la categoría de margen ni el producto de catálogo', () => {
    const reglas = { ...REGLAS, margenes: MARGENES_INICIALES };
    const linea = cotizar([{ producto: puerta(), cantidad: 1, descripcionDocumento: '  Puerta prepintada especial ' }], reglas).lineas[0];
    expect(linea.margen).toBe(0.55);
    expect(linea.precioUnitario).toBe(155_000);
    expect(linea.producto.descripcion).toBe(puerta().descripcion);
    expect(linea.descripcionDocumento).toBe('Puerta prepintada especial');
    expect(descripcionLinea(linea)).toBe('Puerta prepintada especial');
    expect(descripcionLinea({ ...linea, descripcionDocumento: '' })).toBe(puerta().descripcion);
    expect(descripcionLinea({ ...linea, descripcionDocumento: null })).toBe(puerta().descripcion);
    expect(cotizar([{ producto: puerta(), cantidad: 1, descripcionDocumento: '  ' }], reglas).lineas[0].descripcionDocumento).toBeNull();
  });

  it('las observaciones de línea son solo las que escribió la persona', () => {
    const [sinTipo, conObservacion] = cotizar([
      { producto: puerta(), cantidad: 1 },
      { producto: puerta(), cantidad: 1, tipoMedida: 'no_especificado', observaciones: ' Confirmar apertura ' },
    ]).lineas;
    expect(sinTipo.observaciones).toBeNull();
    expect(conObservacion.observaciones).toBe('Confirmar apertura');
  });

  it('se guarda aparte del producto, sobrevive a recargar y pasa a las líneas de la nota', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'neltume-mejoras-'));
    dirs.push(dir);
    const almacen = new Almacen(dir);
    const solicitud: SolicitudItem = { modelo: 'Huilo Huilo', madera: 'Mara', ancho: 83.5, alto: 236, medida: null, cantidad: 2 };
    const llm = { interpretar: vi.fn().mockResolvedValue({ name: 'actualizar_cotizacion', input: { items: [solicitud], cliente: { nombre: 'Ana Soto', rut: null, giro: null, telefono: null, direccion: null, comuna: null, proyecto: null } } }) };
    const servicio = new Servicio(catalogo, llm, almacen);
    let q = (await servicio.ejecutar({ tipo: 'chat', mensaje: 'cotiza Huilo Huilo en Mara' })).cotizacion;
    expect(q.montos.lineas[0]).toMatchObject({ descripcionDocumento: null, observaciones: null });
    q = (await servicio.ejecutar({ tipo: 'editar', id: q.id, actualizada: q.actualizada,
      items: [{ indice: 0, cambios: { descripcion: 'Puerta prepintada especial' } }],
    })).cotizacion;
    const esperada = { descripcionDocumento: 'Puerta prepintada especial', margen: 0.55, precioUnitario: 155_000 };
    expect(q.montos.lineas[0]).toMatchObject(esperada);
    expect(q.montos.lineas[0].producto.descripcion).toBe(puerta().descripcion);
    const recargada = () => new Almacen(dir).obtener(q.id)!;
    expect(recargada().montos.lineas[0]).toMatchObject(esperada);
    expect(recargada().montos.lineas[0].producto.descripcion).toBe(puerta().descripcion);

    q = (await servicio.ejecutar({ tipo: 'emitir', id: q.id, actualizada: q.actualizada })).cotizacion;
    q = (await servicio.ejecutar({ tipo: 'aprobar', id: q.id, actualizada: q.actualizada })).cotizacion;
    q = (await servicio.ejecutar({ tipo: 'pago', id: q.id, actualizada: q.actualizada, monto: Math.ceil(q.montos.total * 0.5), fecha: '2026-09-30' })).cotizacion;
    q = (await servicio.ejecutar({ tipo: 'generar_nota', id: q.id, actualizada: q.actualizada })).cotizacion;
    const nota = recargada().nota!.montos.lineas[0];
    expect(nota).toMatchObject({ descripcionDocumento: 'Puerta prepintada especial', precioUnitario: 100_000, margen: 0 });
    expect(nota.producto.descripcion).toBe(puerta().descripcion);
  });
});

describe('flujo persistido de venta y producción', () => {
  it('aprueba sin nota, exige 50 %, genera nota a precio fábrica y completa la operación', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'neltume-mejoras-'));
    dirs.push(dir);
    const almacen = new Almacen(dir);
    const solicitud: SolicitudItem = {
      modelo: 'Huilo', madera: 'Mara', ancho: 83.5, alto: 236, medida: null, cantidad: 3,
      tipoMedida: 'vano',
    };
    const llm = { interpretar: vi.fn().mockResolvedValue({ name: 'actualizar_cotizacion', input: { items: [solicitud], cliente: { nombre: 'Juan Pérez', rut: null, giro: null, telefono: null, direccion: null, comuna: null, proyecto: null } } }) };
    const servicio = new Servicio(catalogo, llm, almacen);
    let q = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    q = (await servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'cotiza Huilo en Mara' })).cotizacion;
    expect(q.solicitudes[0]).toMatchObject({ modelo: 'Huilo Huilo', modeloOriginal: 'Huilo', coincidenciaModelo: 'alias', tipoMedida: 'vano' });
    expect(q.montos.lineas[0]).toMatchObject({ precioFabrica: 100_000, margen: 0.55, precioCliente: 155_000 });

    q = (await servicio.ejecutar({ tipo: 'editar', id: q.id, actualizada: q.actualizada,
      items: [{ indice: 0, cambios: { descripcion: 'Huilo Huilo especial', margen: 0.42, observaciones: 'Confirmar sentido de apertura' } }],
    })).cotizacion;
    expect(q.montos.lineas[0]).toMatchObject({ precioFabrica: 100_000, margen: 0.42, precioCliente: 142_000, margenPersonalizado: true });

    q = (await servicio.ejecutar({ tipo: 'emitir', id: q.id, actualizada: q.actualizada })).cotizacion;
    q = (await servicio.ejecutar({ tipo: 'aprobar', id: q.id, actualizada: q.actualizada })).cotizacion;
    expect(q.estado).toBe('aprobada');
    expect(q.nota).toBeNull();
    expect(almacen.correlativos().siguienteNota).toBe(1);
    await expect(servicio.ejecutar({ tipo: 'generar_nota', id: q.id, actualizada: q.actualizada })).rejects.toThrow(/50 %/);

    const mitad = Math.ceil(q.montos.total * 0.5);
    q = (await servicio.ejecutar({ tipo: 'pago', id: q.id, actualizada: q.actualizada, monto: Math.floor(mitad * 0.98), fecha: '2026-09-30', observacion: 'Anticipo' })).cotizacion;
    await expect(servicio.ejecutar({ tipo: 'generar_nota', id: q.id, actualizada: q.actualizada })).rejects.toThrow(/50 %/);
    q = (await servicio.ejecutar({ tipo: 'pago', id: q.id, actualizada: q.actualizada, monto: mitad - Math.floor(mitad * 0.98), fecha: '2026-09-30' })).cotizacion;
    q = (await servicio.ejecutar({ tipo: 'generar_nota', id: q.id, actualizada: q.actualizada })).cotizacion;
    expect(q.nota?.montos.lineas[0]).toMatchObject({ precioUnitario: 100_000, precioFabrica: 100_000, margen: 0, margenPersonalizado: false });
    expect(q.estadoOperativo).toBe('pedido_generado');

    q = new Almacen(dir).obtener(q.id)!;
    expect([q.pagos?.length, q.pagos?.reduce((s, p) => s + p.monto, 0), q.nota?.numero]).toEqual([2, mitad, 1]);
    const comentario = await servicio.ejecutar({ tipo: 'comentario', id: q.id, actualizada: q.actualizada, texto: 'Coordinar despacho con cliente' });
    q = comentario.cotizacion;
    const pagarSaldo = q.montos.total - mitad;
    q = (await servicio.ejecutar({ tipo: 'pago', id: q.id, actualizada: q.actualizada, monto: pagarSaldo, fecha: '2026-09-30' })).cotizacion;
    const paso = async (p: 'iniciar_produccion' | 'produccion_terminada' | 'lista_despacho' | 'despachada' | 'completada') => {
      q = (await servicio.ejecutar({ tipo: 'operacion', id: q.id, actualizada: q.actualizada, paso: p })).cotizacion;
    };
    await paso('iniciar_produccion');
    await paso('produccion_terminada');
    expect(q.estadoOperativo).toBe('pagada');
    await paso('lista_despacho');
    // Registrar el despacho exige transportista; los datos logísticos se guardan con la cotización aprobada.
    await expect(servicio.ejecutar({ tipo: 'operacion', id: q.id, actualizada: q.actualizada, paso: 'despachada' })).rejects.toThrow(/transportista/);
    q = (await servicio.ejecutar({ tipo: 'despacho', id: q.id, actualizada: q.actualizada, despacho: { transporte: 'Starken', destino: 'Temuco' } })).cotizacion;
    await paso('despachada');
    await paso('completada');
    q = new Almacen(dir).obtener(q.id)!;
    expect([q.estadoOperativo, q.pagos?.length, q.comentariosInternos?.[0]?.texto]).toEqual(['completada', 3, 'Coordinar despacho con cliente']);
    expect(almacen.eventos(q.id).map((e) => e.tipo)).toEqual(expect.arrayContaining(['emitida', 'aprobada', 'pago_registrado', 'nota_generada', 'produccion', 'produccion_terminada', 'lista_despacho', 'despacho_actualizado', 'despachada', 'completada', 'comentario']));
  });
});
