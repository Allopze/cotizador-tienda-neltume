import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolverItem } from '../src/catalogo/resolver';
import { nombreCanonicoModelo } from '../src/catalogo/configuracion';
import { clienteVacio, type Catalogo, type Producto, type SolicitudItem } from '../src/catalogo/tipos';
import { cotizar, descripcionLinea, MARGENES_INICIALES, REGLAS } from '../src/negocio/precios';
import { dimensionesEnMilimetros } from '../src/negocio/medidas';
import { detectarTipoMedida } from '../src/negocio/items';
import { Servicio } from '../src/servidor/servicio';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { descripcionAGuardar } from '../src/app/cotizacion-panel';
import { nombreProducto } from '../src/app/formato';

vi.mock('../src/servidor/pdf', () => ({
  prepararPdf: vi.fn(async () => {}),
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
    const solicitud: SolicitudItem = { modelo: 'Huilo Huilo', madera: 'Mara', ancho: 83.5, alto: 236, medida: null, cantidad: 2, tipoMedida: 'hoja' };
    const llm = { interpretar: vi.fn().mockResolvedValue({ name: 'actualizar_cotizacion', input: { items: [solicitud], cliente: { nombre: 'Ana Soto', rut: null, giro: null, telefono: null, direccion: null, comuna: null, proyecto: null } } }) };
    const servicio = new Servicio(catalogo, llm, almacen);
    let q = (await servicio.ejecutar({ tipo: 'chat', mensaje: 'cotiza Huilo Huilo en Mara' })).cotizacion;
    expect(q.montos.lineas[0]).toMatchObject({ descripcionDocumento: null, observaciones: null });
    q = (
      await servicio.ejecutar({
        tipo: 'editar',
        id: q.id,
        actualizada: q.actualizada,
        items: [{ indice: 0, cambios: { descuento: { tipo: 'porcentaje', valor: 15 } } }],
      })
    ).cotizacion;
    const prefijo = 'Castaya - Puertas interiores - ';
    const descripcionOriginal =
      q.montos.lineas[0].descripcionDocumento || descripcionLinea(q.montos.lineas[0]);
    const descripcionEditada = `${prefijo}${descripcionOriginal}`;
    q = (await servicio.ejecutar({ tipo: 'editar', id: q.id, actualizada: q.actualizada,
      items: [{ indice: 0, cambios: { descripcion: descripcionEditada } }],
    })).cotizacion;
    const esperada = {
      descripcionDocumento: descripcionEditada,
      margen: 0.55,
      precioUnitario: 155_000,
      descuentoItem: { tipo: 'porcentaje', valor: 15 },
      descuentoUnitario: 23_250,
    };
    expect(q.montos.lineas[0]).toMatchObject(esperada);
    expect(q.montos.lineas[0].producto.descripcion).toBe(puerta().descripcion);
    expect(q.solicitudes[0]).toMatchObject({
      cantidad: 2,
      ancho: 83.5,
      alto: 236,
      tipoMedida: 'hoja',
      descripcion: descripcionEditada,
      descuento: { tipo: 'porcentaje', valor: 15 },
    });
    const recargada = () => new Almacen(dir).obtener(q.id)!;
    expect(recargada().montos.lineas[0]).toMatchObject(esperada);
    expect(recargada().montos.lineas[0].producto.descripcion).toBe(puerta().descripcion);

    q = (await servicio.ejecutar({
      tipo: 'editar', id: q.id, actualizada: q.actualizada, cantidades: [{ indice: 0, cantidad: 4 }],
    })).cotizacion;
    expect(q.solicitudes[0].descripcion).toBe(descripcionEditada);
    expect(q.montos.lineas[0]).toMatchObject({ ...esperada, cantidad: 4, total: 527_000 });
    expect(recargada().solicitudes[0].descripcion).toBe(descripcionEditada);

    q = (await servicio.ejecutar({ tipo: 'emitir', id: q.id, actualizada: q.actualizada })).cotizacion;
    q = (await servicio.ejecutar({ tipo: 'aprobar', id: q.id, actualizada: q.actualizada })).cotizacion;
    q = (await servicio.ejecutar({ tipo: 'pago', id: q.id, actualizada: q.actualizada, monto: Math.ceil(q.montos.total * 0.5) })).cotizacion;
    q = (await servicio.ejecutar({ tipo: 'generar_nota', id: q.id, actualizada: q.actualizada })).cotizacion;
    const nota = recargada().nota!.montos.lineas[0];
    expect(nota).toMatchObject({ descripcionDocumento: descripcionEditada, cantidad: 4, precioUnitario: 100_000, margen: 0 });
    expect(nota.producto.descripcion).toBe(puerta().descripcion);
  });

  it('guardar el mismo texto que se genera no fija la descripción: el documento sigue al ítem', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'neltume-mejoras-'));
    dirs.push(dir);
    const otra = puerta({ codigo: 'HUI-M-3-B', medida: '0,90 A 0,95', anchoMin: 0.9, anchoMax: 0.95, precioNeto: 110_000,
      descripcion: 'HUILO HUILO MARA 0,90 A 0,95 MT X 2,30 A 2,40 MT' });
    const solicitud: SolicitudItem = { modelo: 'Huilo Huilo', madera: 'Mara', ancho: 83.5, alto: 236, medida: null, cantidad: 1 };
    const cliente = { nombre: null, rut: null, giro: null, telefono: null, direccion: null, comuna: null, proyecto: null };
    const llm = { interpretar: vi.fn().mockResolvedValue({ name: 'actualizar_cotizacion', input: { items: [solicitud], cliente } }) };
    const servicio = new Servicio({ ...catalogo, productos: [puerta(), otra] }, llm, new Almacen(dir));
    let q = (await servicio.ejecutar({ tipo: 'chat', mensaje: 'cotiza Huilo Huilo en Mara' })).cotizacion;
    // Lo que el panel muestra al abrir el campo: el texto generado, ya con nombres legibles.
    const generada = nombreProducto(descripcionLinea(q.montos.lineas[0]));
    expect(generada).toBe('Huilo Huilo Mara 0,835 m × 2,36 m');
    const editar = async (texto: string) =>
      (q = (await servicio.ejecutar({ tipo: 'editar', id: q.id, actualizada: q.actualizada,
        items: [{ indice: 0, cambios: { descripcion: descripcionAGuardar(q, 0, texto) } }] })).cotizacion);
    for (const texto of [generada, ` ${generada} `, descripcionLinea(q.montos.lineas[0]), ''])
      expect(descripcionAGuardar(q, 0, texto)).toBeNull();
    // Una descripción propia se guarda; volver al texto generado la quita.
    await editar(`Castaya - ${generada}`);
    expect(q.solicitudes[0].descripcion).toBe(`Castaya - ${generada}`);
    expect(descripcionAGuardar(q, 0, generada)).toBeNull();
    await editar(generada);
    expect(q.solicitudes[0].descripcion ?? null).toBeNull();
    // Sin descripción fijada, cambiar el ancho cambia también lo que dice el documento.
    q = (await servicio.ejecutar({ tipo: 'editar', id: q.id, actualizada: q.actualizada,
      items: [{ indice: 0, cambios: { ancho: 0.92 } }] })).cotizacion;
    expect(q.montos.lineas[0].producto.codigo).toBe('HUI-M-3-B');
    expect(nombreProducto(descripcionLinea(q.montos.lineas[0]))).toBe('Huilo Huilo Mara 0,92 m × 2,36 m');
  });
});

describe('tipo estructurado de medida', () => {
  it.each([
    ['Puerta 90x210 medida de hoja', 'hoja', '900 × 2100 mm (Hoja)'],
    ['Puerta 90x210 medida de vano', 'vano', '900 × 2100 mm (Vano)'],
  ] as const)('detecta y conserva el tipo indicado en «%s»', async (mensaje, tipo, esperado) => {
    expect(detectarTipoMedida(mensaje)).toBe(tipo);
    expect(dimensionesEnMilimetros(0.9, 2.1, tipo)).toBe(esperado);
    const dir = await mkdtemp(join(tmpdir(), 'neltume-medida-'));
    dirs.push(dir);
    const solicitud: SolicitudItem = {
      modelo: 'Huilo Huilo', madera: 'Mara', ancho: 0.9, alto: 2.1, medida: null,
      cantidad: 1, tipoMedida: null,
    };
    const llm = {
      interpretar: vi.fn().mockResolvedValue({
        name: 'actualizar_cotizacion', input: { items: [solicitud], cliente: clienteVacio() },
      }),
    };
    const catalogoConRango = {
      ...catalogo,
      productos: [{ ...puerta(), anchoMin: 0.8, anchoMax: 1, altoMin: 2, altoMax: 2.5 }],
    };
    const servicio = new Servicio(catalogoConRango, llm, new Almacen(dir));
    const q = (await servicio.ejecutar({ tipo: 'chat', mensaje })).cotizacion;
    expect(q.solicitudes[0].tipoMedida).toBe(tipo);
    const linea = q.montos.lineas[0];
    expect(dimensionesEnMilimetros(linea.anchoSolicitado, linea.altoSolicitado, linea.tipoMedida)).toBe(esperado);
    expect(new Almacen(dir).obtener(q.id)?.solicitudes[0].tipoMedida).toBe(tipo);
  });

  it('no asigna un tipo cuando el pedido no lo especifica', () => {
    expect(detectarTipoMedida('Puerta 90x210')).toBeNull();
    expect(detectarTipoMedida('La medida corresponde al vano')).toBe('vano');
    expect(detectarTipoMedida('Dimensiones de la hoja')).toBe('hoja');
    expect(dimensionesEnMilimetros(0.9, 2.1, null)).toBe('900 × 2100 mm');
  });
});

describe('orden persistido e historial de ítems', () => {
  it('mueve C antes de A y B y conserva el orden al recargar SQLite', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'neltume-reordenar-'));
    dirs.push(dir);
    const solicitudes: SolicitudItem[] = [0.8, 0.81, 0.82].map((ancho, i) => ({
      modelo: 'Huilo Huilo', madera: 'Mara', ancho, alto: 2.35, medida: null, cantidad: i + 1,
    }));
    const llm = {
      interpretar: vi.fn().mockResolvedValue({
        name: 'actualizar_cotizacion', input: { items: solicitudes, cliente: clienteVacio() },
      }),
    };
    const servicio = new Servicio(catalogo, llm, new Almacen(dir));
    let q = (await servicio.ejecutar({ tipo: 'chat', mensaje: 'Cotiza los productos A, B y C' })).cotizacion;
    expect(q.solicitudes.map((s) => s.ancho)).toEqual([0.8, 0.81, 0.82]);
    q = (await servicio.ejecutar({ tipo: 'reordenar', id: q.id, actualizada: q.actualizada, desde: 2, hasta: 0 })).cotizacion;
    expect(q.solicitudes.map((s) => s.ancho)).toEqual([0.82, 0.8, 0.81]);
    expect(q.montos.lineas.map((l) => l.anchoSolicitado)).toEqual([0.82, 0.8, 0.81]);
    const recargada = new Almacen(dir).obtener(q.id)!;
    expect(recargada.solicitudes.map((s) => s.ancho)).toEqual([0.82, 0.8, 0.81]);
    expect(recargada.montos.lineas.map((l) => l.anchoSolicitado)).toEqual([0.82, 0.8, 0.81]);
  });

  it('restaura y rehace el cambio de cantidad desde instantáneas guardadas', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'neltume-deshacer-'));
    dirs.push(dir);
    const solicitud: SolicitudItem = {
      modelo: 'Huilo Huilo', madera: 'Mara', ancho: 0.8, alto: 2.35, medida: null, cantidad: 1,
    };
    const llm = {
      interpretar: vi.fn().mockResolvedValue({
        name: 'actualizar_cotizacion', input: { items: [solicitud], cliente: clienteVacio() },
      }),
    };
    const servicio = new Servicio(catalogo, llm, new Almacen(dir));
    let q = (await servicio.ejecutar({ tipo: 'chat', mensaje: 'Cotiza una puerta' })).cotizacion;
    const antes = structuredClone(q.solicitudes);
    q = (await servicio.ejecutar({ tipo: 'editar', id: q.id, actualizada: q.actualizada, cantidades: [{ indice: 0, cantidad: 3 }] })).cotizacion;
    const despues = structuredClone(q.solicitudes);
    expect(q.solicitudes[0].cantidad).toBe(3);
    q = (await servicio.ejecutar({ tipo: 'restaurar_items', id: q.id, actualizada: q.actualizada, items: antes })).cotizacion;
    expect(q.solicitudes[0].cantidad).toBe(1);
    q = (await servicio.ejecutar({ tipo: 'restaurar_items', id: q.id, actualizada: q.actualizada, items: despues })).cotizacion;
    expect(q.solicitudes[0].cantidad).toBe(3);
    expect(new Almacen(dir).obtener(q.id)?.solicitudes[0].cantidad).toBe(3);
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
    q = (await servicio.ejecutar({ tipo: 'pago', id: q.id, actualizada: q.actualizada, monto: Math.floor(mitad * 0.98), observacion: 'Anticipo' })).cotizacion;
    await expect(servicio.ejecutar({ tipo: 'generar_nota', id: q.id, actualizada: q.actualizada })).rejects.toThrow(/50 %/);
    q = (await servicio.ejecutar({ tipo: 'pago', id: q.id, actualizada: q.actualizada, monto: mitad - Math.floor(mitad * 0.98) })).cotizacion;
    q = (await servicio.ejecutar({ tipo: 'generar_nota', id: q.id, actualizada: q.actualizada })).cotizacion;
    expect(q.nota?.montos.lineas[0]).toMatchObject({ precioUnitario: 100_000, precioFabrica: 100_000, margen: 0, margenPersonalizado: false });
    expect(q.estadoOperativo).toBe('pedido_generado');

    q = new Almacen(dir).obtener(q.id)!;
    expect([q.pagos?.length, q.pagos?.reduce((s, p) => s + p.monto, 0), q.nota?.numero]).toEqual([2, mitad, 1]);
    const comentario = await servicio.ejecutar({ tipo: 'comentario', id: q.id, actualizada: q.actualizada, texto: 'Coordinar despacho con cliente' });
    q = comentario.cotizacion;
    const pagarSaldo = q.montos.total - mitad;
    q = (await servicio.ejecutar({ tipo: 'pago', id: q.id, actualizada: q.actualizada, monto: pagarSaldo })).cotizacion;
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
