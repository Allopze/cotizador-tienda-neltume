import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Catalogo, Producto } from '../src/catalogo/tipos';
import { clienteVacio } from '../src/catalogo/tipos';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { facturacionAprobacionSchema } from '../src/servidor/facturacion-esquemas';
import { csvCotizaciones } from '../src/servidor/exportar';
import { Servicio, type Accion } from '../src/servidor/servicio';
import { etiquetaFacturacion, type Cotizacion } from '../src/negocio/estado';
import { textoCopiarFactura } from '../src/negocio/facturacion';

vi.mock('../src/servidor/pdf', () => ({
  prepararPdf: vi.fn(async () => {}),
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

const molco: Producto = {
  codigo: 'MOL-O-3-A',
  modelo: 'MOLCO',
  familia: 'PUERTA',
  tipo: 'PUERTA PANEL',
  madera: 'PINO OREGON',
  medida: '0,80 A 0,85',
  anchoMin: 0.8,
  anchoMax: 0.85,
  largo: 2,
  precioNeto: 100_000,
  descripcion: 'MOLCO',
  filaOrigen: 4,
};
const catalogo: Catalogo = { fuente: 'test', sha256: 'test', fecha: '2026-01-01', productos: [molco] };
const usuario = { nombre: 'Paula', email: 'paula@neltume.cl' };
const dirs: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'cotizador-facturacion-'));
  dirs.push(dir);
  const almacen = new Almacen(dir);
  const llm = { interpretar: vi.fn() };
  const servicio = new Servicio(catalogo, llm, almacen, { ...usuario });
  let actual = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
  const ir = async (accion: Record<string, unknown>) => {
    const res = await servicio.ejecutar({ ...accion, id: actual.id, actualizada: actual.actualizada } as Accion);
    actual = res.cotizacion;
    return actual;
  };
  const intentar = (accion: Record<string, unknown>) =>
    servicio.ejecutar({ ...accion, id: actual.id, actualizada: actual.actualizada } as Accion);

  await ir({
    tipo: 'editar',
    cliente: {
      ...clienteVacio(),
      nombre: 'Constructora Lingue',
      rut: '765432103',
      giro: 'Construcción',
      direccion: 'Av. Principal 100',
      comuna: 'Pucón',
    },
    items: [],
  });
  await ir({
    tipo: 'agregar_producto',
    codigo: 'MOL-O-3-A',
    cantidad: 2,
    ancho: 0.82,
    alto: 2,
    tipoMedida: 'hoja',
  });

  return {
    almacen,
    servicio,
    actual: () => actual,
    recargar: () => almacen.obtener(actual.id)!,
    eventos: (id = actual.id) => almacen.eventos(id),
    ir,
    intentar,
    emitir: () => ir({ tipo: 'emitir' }),
    aprobar: async (extra: Record<string, unknown> = {}) => {
      await ir({ tipo: 'emitir' });
      return ir({ tipo: 'aprobar', ...extra });
    },
  };
}

const receptorLingue = {
  razonSocial: 'Constructora Lingue SpA',
  rut: '765432103',
  giro: 'Obras menores y edificación',
  direccion: 'Camino Internacional Km 5',
  comuna: 'Pucón',
  correo: 'pagos@lingue.cl',
};

describe('A2 · datos_facturacion y aprobar.facturacion', () => {
  it('exige cotización aprobada, verifica versión, sanea textos a máx. 300 y rechaza RUT o correo inválidos', async () => {
    const t = await setup();
    await expect(
      t.intentar({ tipo: 'datos_facturacion', documento: 'boleta' }),
    ).rejects.toMatchObject({ status: 409, codigo: 'estado_invalido' });

    await t.emitir();
    await expect(
      t.intentar({ tipo: 'datos_facturacion', documento: 'boleta' }),
    ).rejects.toMatchObject({ status: 409, codigo: 'estado_invalido' });

    await t.ir({ tipo: 'aprobar' });
    const versionAnterior = t.actual().actualizada;

    await expect(
      t.intentar({
        tipo: 'datos_facturacion',
        documento: 'factura',
        receptor: { ...receptorLingue, rut: '76.543.210-0' },
      }),
    ).rejects.toMatchObject({ status: 400, codigo: 'rut_invalido' });

    await expect(
      t.intentar({
        tipo: 'datos_facturacion',
        documento: 'factura',
        receptor: { ...receptorLingue, correo: 'sin-arroba' },
      }),
    ).rejects.toMatchObject({ status: 400 });

    const largo = `${'A'.repeat(350)} \u202E fin`;
    await t.ir({
      tipo: 'datos_facturacion',
      documento: 'factura',
      receptor: {
        razonSocial: largo,
        rut: ' 76.543.210-3 ',
        giro: '  Construcción\t\npesada  ',
        direccion: 'Camino Sur 45',
        comuna: '  ',
        correo: 'pagos@lingue.cl',
      },
    });
    expect(t.recargar().facturacion?.receptor).toEqual({
      razonSocial: 'A'.repeat(300),
      rut: '76.543.210-3',
      giro: 'Construcción pesada',
      direccion: 'Camino Sur 45',
      comuna: null,
      correo: 'pagos@lingue.cl',
    });

    await expect(
      t.servicio.ejecutar({
        tipo: 'datos_facturacion',
        id: t.actual().id,
        actualizada: versionAnterior,
        documento: 'boleta',
      }),
    ).rejects.toMatchObject({ status: 409, codigo: 'version_obsoleta' });
  });

  it('con boleta limpia receptor; bloquea si ya está facturada y registra evento facturacion_actualizada con antes → después', async () => {
    const t = await setup();
    await t.aprobar();

    await t.ir({ tipo: 'datos_facturacion', documento: 'factura', receptor: receptorLingue });
    const eventosTrasAlta = t.eventos();
    expect(eventosTrasAlta.at(-1)).toMatchObject({
      tipo: 'facturacion_actualizada',
      usuario: 'Paula',
      detalle: 'Datos de facturación: Sin definir → Factura · Constructora Lingue SpA (76.543.210-3)',
    });
    expect(eventosTrasAlta.filter((e) => e.tipo === 'facturada')).toHaveLength(0);

    // Repetir el mismo contenido no agrega evento ni cambia versión.
    const version = t.actual().actualizada;
    const totalEventos = eventosTrasAlta.length;
    await t.ir({ tipo: 'datos_facturacion', documento: 'factura', receptor: receptorLingue });
    expect(t.actual().actualizada).toBe(version);
    expect(t.eventos()).toHaveLength(totalEventos);

    // Editar solo un campo secundario registra qué cambió.
    await t.ir({
      tipo: 'datos_facturacion',
      documento: 'factura',
      receptor: { ...receptorLingue, correo: 'otro@lingue.cl' },
    });
    expect(t.eventos().at(-1)?.detalle).toContain('Correo: pagos@lingue.cl → otro@lingue.cl');

    // Al cambiar a boleta, el receptor pasa a null.
    await t.ir({ tipo: 'datos_facturacion', documento: 'boleta', receptor: receptorLingue });
    expect(t.recargar().facturacion).toMatchObject({ documento: 'boleta', receptor: null, estado: 'pendiente' });
    expect(t.eventos().at(-1)?.detalle).toBe('Datos de facturación: Factura · Constructora Lingue SpA (76.543.210-3) → Boleta');

    // Marcar facturada bloquea cambios posteriores en datos_facturacion.
    await t.ir({ tipo: 'facturacion', estado: 'facturada', tipoDocumento: 'boleta' });
    await expect(
      t.intentar({ tipo: 'datos_facturacion', documento: 'factura', receptor: receptorLingue }),
    ).rejects.toThrow(/primero vuelve a pendiente/);
  });

  it('exige receptor completo al marcar como facturada con factura y deja comuna y correo como opcionales', async () => {
    const t = await setup();
    await t.aprobar({
      facturacion: {
        documento: 'factura',
        receptor: { razonSocial: 'Solo Nombre', rut: null, giro: null, direccion: null },
      },
    });
    await expect(
      t.intentar({ tipo: 'facturacion', estado: 'facturada', tipoDocumento: 'factura' }),
    ).rejects.toMatchObject({
      status: 400,
      codigo: 'datos_facturacion_incompletos',
      message: expect.stringContaining('RUT válido'),
    });

    await t.ir({
      tipo: 'datos_facturacion',
      documento: 'factura',
      receptor: {
        razonSocial: 'Constructora Lingue SpA',
        rut: '76.543.210-3',
        giro: 'Construcción',
        direccion: 'Camino Real 45',
        comuna: null,
        correo: null,
      },
    });
    await t.ir({ tipo: 'facturacion', estado: 'facturada', tipoDocumento: 'factura', identificadorExterno: '9001' });
    expect(t.recargar().facturacion?.estado).toBe('facturada');
  });

  it('aprobar con facturacion aplica cambios en la misma transacción y revierte todo si el RUT es inválido', async () => {
    const t = await setup();
    await t.emitir();
    await expect(
      t.intentar({
        tipo: 'aprobar',
        facturacion: { documento: 'factura', receptor: { ...receptorLingue, rut: '12.345.678-0' } },
      }),
    ).rejects.toMatchObject({ status: 400, codigo: 'rut_invalido' });
    expect(t.recargar().estado).toBe('emitida');
    expect(t.eventos().map((e) => e.tipo)).not.toContain('aprobada');

    await t.ir({
      tipo: 'aprobar',
      facturacion: { documento: 'factura', receptor: receptorLingue },
    });
    expect(t.recargar()).toMatchObject({
      estado: 'aprobada',
      facturacion: {
        estado: 'pendiente',
        documento: 'factura',
        receptor: { ...receptorLingue, rut: '76.543.210-3' },
      },
    });
    const tipos = t.eventos().map((e) => e.tipo);
    expect(tipos.slice(-2)).toEqual(['aprobada', 'facturacion_actualizada']);
  });

  it('duplicar reinicia documento y receptor en null', async () => {
    const t = await setup();
    await t.aprobar({ facturacion: { documento: 'factura', receptor: receptorLingue } });
    const duplicada = (await t.servicio.ejecutar({ tipo: 'duplicar', id: t.actual().id })).cotizacion;
    expect(duplicada.facturacion).toEqual({
      estado: 'pendiente',
      documento: null,
      receptor: null,
      tipo: null,
      identificadorExterno: null,
      fecha: null,
    });
    expect(t.almacen.obtener(duplicada.id)?.facturacion).toEqual(duplicada.facturacion);
  });

  it('desaprobar conserva documento y receptor, y al re-aprobar se mantienen intactos si no cambian', async () => {
    const t = await setup();
    await t.aprobar({ facturacion: { documento: 'factura', receptor: receptorLingue } });
    await t.ir({ tipo: 'desaprobar' });
    expect(t.recargar().estado).toBe('emitida');
    expect(t.recargar().facturacion).toMatchObject({
      estado: 'pendiente',
      documento: 'factura',
      receptor: { ...receptorLingue, rut: '76.543.210-3' },
    });

    await t.ir({ tipo: 'aprobar' });
    expect(t.recargar().facturacion).toMatchObject({
      estado: 'pendiente',
      documento: 'factura',
      receptor: { ...receptorLingue, rut: '76.543.210-3' },
    });
  });

  it('cotizaciones facturadas previas a v30 (documento y receptor null) se listan y exportan sin errores', async () => {
    const t = await setup();
    await t.aprobar();
    const legado = await t.ir({ tipo: 'facturacion', estado: 'facturada', tipoDocumento: 'boleta' });
    // Simular un registro legado donde tipo='factura' pero receptor=null (v29 → v30).
    const copiaLegada: Cotizacion = {
      ...legado,
      facturacion: {
        estado: 'facturada',
        documento: null,
        receptor: null,
        tipo: 'factura',
        identificadorExterno: '4455',
        fecha: '2026-08-10T12:00:00.000Z',
      },
    };
    await t.almacen.transaccion((u) => u.guardar(copiaLegada));
    const recargada = t.almacen.obtener(copiaLegada.id)!;
    const [fila] = t.almacen.listar().cotizaciones;
    expect(fila.facturacion).toEqual({
      estado: 'facturada',
      documento: null,
      receptor: null,
      tipo: 'factura',
    });
    expect(etiquetaFacturacion(recargada.facturacion)).toBe('Facturada · Factura N° 4455');
    expect(() => csvCotizaciones([fila])).not.toThrow();
    expect(textoCopiarFactura(fila.facturacion?.receptor)).toBe('');
  });

  it('el filtro porFacturar devuelve solo aprobadas pendientes y el CSV incluye los datos del receptor', async () => {
    const t = await setup();
    // 1. Pendiente con factura y receptor.
    const pendiente = await t.aprobar({
      facturacion: { documento: 'factura', receptor: receptorLingue },
    });

    // 2. Ya facturada con boleta: no entra en porFacturar.
    const facturada = await (async () => {
      const n = (await t.servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
      const conItem = (
        await t.servicio.ejecutar({
          tipo: 'agregar_producto',
          id: n.id,
          actualizada: n.actualizada,
          codigo: 'MOL-O-3-A',
          cantidad: 1,
          ancho: 0.82,
          alto: 2,
          tipoMedida: 'hoja',
        })
      ).cotizacion;
      const emit = (await t.servicio.ejecutar({ tipo: 'emitir', id: conItem.id, actualizada: conItem.actualizada }))
        .cotizacion;
      const aprob = (await t.servicio.ejecutar({ tipo: 'aprobar', id: emit.id, actualizada: emit.actualizada }))
        .cotizacion;
      return (
        await t.servicio.ejecutar({
          tipo: 'facturacion',
          id: aprob.id,
          actualizada: aprob.actualizada,
          estado: 'facturada',
          tipoDocumento: 'boleta',
        })
      ).cotizacion;
    })();

    const soloPendientes = t.almacen.listar({ porFacturar: true }).cotizaciones;
    expect(soloPendientes.map((c) => c.id)).toEqual([pendiente.id]);
    expect(soloPendientes.map((c) => c.id)).not.toContain(facturada.id);

    const [cabecera, linea] = csvCotizaciones(soloPendientes).split('\r\n');
    expect(cabecera).toContain('Documento;Razón social;RUT receptor;Giro receptor;Dirección receptor');
    expect(linea).toContain('Factura;Constructora Lingue SpA;76.543.210-3;Obras menores y edificación;Camino Internacional Km 5');
  });

  it('el esquema de aprobación rechaza campos desconocidos y textos sobre 300 caracteres', () => {
    expect(
      facturacionAprobacionSchema.safeParse({
        documento: 'factura',
        receptor: { razonSocial: 'X'.repeat(301) },
      }).success,
    ).toBe(false);
    expect(
      facturacionAprobacionSchema.safeParse({
        documento: 'boleta',
        extra: true,
      }).success,
    ).toBe(false);
  });
});
