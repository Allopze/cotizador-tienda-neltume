// Regresiones de la auditoría del 26-10-2026 que se cierran en la fase de integridad de datos:
// BUG-001 (identidad por ítem), BUG-002 (revisión pisada), BUG-023 (Ajustes sin versión), BUG-024 (número reservado),
// BUG-046 (borrador retomado) y BUG-047 (duplicar sin idempotencia).
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Catalogo, Producto } from '../src/catalogo/tipos';
import { leerPesos } from '../src/negocio/cifras';
import { precioConMargen } from '../src/negocio/precios';
import { clavePedido, type LineaPedido } from '../src/negocio/starken';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import {
  guardarConfiguracionNegocio,
  leerConfiguracionNegocio,
  versionConfiguracionNegocio,
} from '../src/servidor/configuracion-negocio';
import { Servicio } from '../src/servidor/servicio';

vi.mock('../src/servidor/pdf', () => ({
  prepararPdf: vi.fn(async () => {}),
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

const molco: Producto = {
  codigo: 'MOL-L-0.8-2',
  modelo: 'MOLCO',
  familia: 'PUERTA',
  tipo: 'PUERTA PANEL',
  madera: 'LENGA',
  medida: '0.8 A 0.85',
  anchoMin: 0.8,
  anchoMax: 0.85,
  largo: 2,
  precioNeto: 100_000,
  descripcion: 'MOLCO LENGA',
  filaOrigen: 1,
};
const catalogo: Catalogo = { fuente: 'test', sha256: 'test', fecha: '2026-01-01', productos: [molco] };

const dirs: string[] = [];
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-regresion-'));
  dirs.push(dir);
  const almacen = new Almacen(dir);
  const servicio = new Servicio(catalogo, { interpretar: vi.fn() }, almacen);
  const crear = async () =>
    (await servicio.ejecutar({ tipo: 'agregar_producto', codigo: molco.codigo, cantidad: 1 })).cotizacion;
  return { dir, almacen, servicio, crear };
}
afterEach(async () => {
  vi.clearAllMocks();
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

describe('BUG-001 · identidad estable por ítem', () => {
  it('dos ítems iguales reciben ids distintos y los conservan al guardar', async () => {
    const { dir, servicio, crear } = await setup();
    let q = await crear();
    q = (
      await servicio.ejecutar({
        tipo: 'agregar_producto',
        id: q.id,
        actualizada: q.actualizada,
        codigo: molco.codigo,
        cantidad: 1,
      })
    ).cotizacion;

    const ids = q.solicitudes.map((s) => s.id);
    expect(ids.length).toBe(2);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(2);

    // Vuelven de la base tal cual: son la clave con que la pantalla distingue un ítem de otro.
    const leida = new Almacen(dir).obtener(q.id)!;
    expect(leida.solicitudes.map((s) => s.id)).toEqual(ids);
  });

  it('Deshacer restaura los ítems con su id, y un id repetido recibe uno nuevo', async () => {
    const { servicio, crear } = await setup();
    let q = await crear();
    q = (await servicio.ejecutar({ tipo: 'agregar_producto', id: q.id, actualizada: q.actualizada, codigo: molco.codigo, cantidad: 2 })).cotizacion;
    const [a, b] = q.solicitudes;
    const r = await servicio.ejecutar({
      tipo: 'restaurar_items',
      id: q.id,
      actualizada: q.actualizada,
      items: [b, a, { ...a, cantidad: 3 }],
    });
    const ids = r.cotizacion.solicitudes.map((s) => s.id);
    expect(ids.slice(0, 2)).toEqual([b.id, a.id]);
    expect(new Set(ids).size).toBe(3);
  });
});

describe('BUG-002 · editar la emitida no puede pisar su revisión', () => {
  it('con una revisión abierta que tiene fábrica propia, editar la emitida responde 409', async () => {
    const { servicio, crear } = await setup();
    const borrador = await crear();
    const emitida = (
      await servicio.ejecutar({ tipo: 'emitir', id: borrador.id, actualizada: borrador.actualizada })
    ).cotizacion;

    // Abre la revisión con un cambio y luego vuelve a dejarla igual a la emitida: solo queda distinta por la fábrica.
    const conCambio = (
      await servicio.ejecutar({
        tipo: 'editar',
        id: emitida.id,
        actualizada: emitida.actualizada,
        observaciones: 'Abre a la izquierda',
      })
    ).cotizacion;
    const revision = (
      await servicio.ejecutar({
        tipo: 'editar',
        id: conCambio.id,
        actualizada: conCambio.actualizada,
        observaciones: null,
      })
    ).cotizacion;
    await servicio.ejecutar({
      tipo: 'asignar_fabricas',
      id: revision.id,
      actualizada: revision.actualizada,
      asignaciones: [{ indice: 0, fabrica: 'panguipulli' }],
    });

    await expect(
      servicio.ejecutar({ tipo: 'editar', id: emitida.id, actualizada: emitida.actualizada, observaciones: 'Otra' }),
    ).rejects.toMatchObject({ codigo: 'revision_abierta' });
  });
});

describe('BUG-023 · dos guardados de Ajustes a la vez', () => {
  it('el segundo guardado con la misma versión responde 409 y no pisa al primero', async () => {
    const { almacen } = await setup();
    const db = almacen.baseDatos();
    const configuracion = leerConfiguracionNegocio(db);
    const version = versionConfiguracionNegocio(db);

    guardarConfiguracionNegocio({ ...configuracion, reglas: { ...configuracion.reglas, iva: 0.2 } }, db, version);
    const siguiente = versionConfiguracionNegocio(db);
    expect(siguiente).not.toBe(version);

    expect(() =>
      guardarConfiguracionNegocio(
        { ...configuracion, transportistas: [...configuracion.transportistas, 'Nuevo'] },
        db,
        version,
      ),
    ).toThrow(/Otra persona guardó/);
    expect(leerConfiguracionNegocio(db).reglas.iva).toBe(0.2);
  });
});

describe('BUG-024 · «Cambiar N°» no toma un número reservado', () => {
  it('el número de una emisión en curso queda ocupado hasta que se libera', async () => {
    const { almacen, crear } = await setup();
    const enEmision = await crear();
    const otra = await crear();

    const { numero, ficha } = await almacen.transaccion((u) => u.reservarCotizacionEnEmision(enEmision.id));
    await expect(almacen.transaccion((u) => u.validarNumeroCotizacion(otra.id, numero))).rejects.toThrow(
      /se está emitiendo/,
    );

    almacen.liberarEmision(enEmision.id, ficha);
    await expect(almacen.transaccion((u) => u.validarNumeroCotizacion(otra.id, numero))).resolves.toBeUndefined();
  });
});

describe('BUG-046 · limpiar-borradores no borra uno retomado', () => {
  it('si el borrador cambió después de listarlo, se deja intacto', async () => {
    const { almacen, servicio, crear } = await setup();
    const q = await crear();
    // Un límite en el futuro: el borrador recién creado entra en la lista de candidatos.
    const candidato = almacen.borradoresAbandonados({ dias: -1, conItems: true }).find((b) => b.id === q.id)!;
    expect(candidato).toBeDefined();

    // Alguien lo retoma: su versión cambia.
    await servicio.ejecutar({
      tipo: 'editar',
      id: q.id,
      actualizada: q.actualizada,
      observaciones: 'Retomado',
    });

    const eliminados = await almacen.eliminarBorradores([{ id: q.id, actualizada: candidato.actualizada }]);
    expect(eliminados).toBe(0);
    expect(almacen.obtener(q.id)).not.toBeNull();
  });
});

describe('BUG-034 · el medio peso del margen se redondea hacia arriba', () => {
  it('10.990 al 15 % da 12.639 y 1.050 al −33 % da 704', () => {
    expect(precioConMargen(10_990, 0.15)).toBe(12_639);
    expect(precioConMargen(1_050, -0.33)).toBe(704);
  });
});

describe('BUG-035 · «350.00» se lee igual en el formulario y en el chat', () => {
  it('un precio con dos ceros decimales se interpreta como miles', () => {
    expect(leerPesos('$350.00')).toBe(350_000);
    expect(leerPesos('1490.00')).toBe(1_490);
  });
});

describe('BUG-036 · un ítem libre no invalida la tarifa de Starken', () => {
  it('agregar un OTRO no cambia la huella del pedido', () => {
    const linea = (producto: Producto, cantidad: number): LineaPedido => ({
      producto,
      cantidad,
      anchoSolicitado: null,
      altoSolicitado: null,
      medidaSolicitada: null,
    });
    const otro: Producto = { ...molco, codigo: 'OTRO-1', familia: 'OTRO', modelo: 'Instalación', medida: '' };
    expect(clavePedido([linea(molco, 2)])).toBe(clavePedido([linea(molco, 2), linea(otro, 1)]));
  });
});

describe('BUG-012 · una edición avisa que el catálogo cambió el precio', () => {
  it('editar un dato ajeno devuelve el aviso de recotización', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'neltume-regresion-catalogo-'));
    dirs.push(dir);
    const vivo: Catalogo = { ...catalogo, productos: [{ ...molco }] };
    const almacen = new Almacen(dir);
    const servicio = new Servicio(vivo, { interpretar: vi.fn() }, almacen);
    const q = (await servicio.ejecutar({ tipo: 'agregar_producto', codigo: molco.codigo, cantidad: 1 })).cotizacion;

    // Como una reimportación: el producto sube de costo y nadie tocó este ítem.
    vivo.productos[0] = { ...molco, precioNeto: 120_000 };
    const r = await servicio.ejecutar({
      tipo: 'editar',
      id: q.id,
      actualizada: q.actualizada,
      cliente: { nombre: 'Ana' },
    });
    expect(r.avisos?.join(' ')).toMatch(/según el catálogo vigente/);
  });
});

describe('BUG-014 · un especial bajo el costo de fábrica avisa', () => {
  it('escribir un costo mayor que el precio deja el aviso', async () => {
    const { servicio } = await setup();
    const q = (
      await servicio.ejecutar({
        tipo: 'agregar_personalizado',
        item: { nombre: 'Puerta doble', familia: 'PUERTA', madera: 'Lenga', cantidad: 1, precioUnitario: 450_000 },
      })
    ).cotizacion;
    const r = await servicio.ejecutar({
      tipo: 'editar',
      id: q.id,
      actualizada: q.actualizada,
      items: [{ indice: 0, cambios: { costoFabrica: 500_000 } }],
    });
    expect(r.avisos?.join(' ')).toMatch(/bajo el costo de fábrica/);
  });
});

describe('BUG-037 · el costo de un especial se completa sin abrir revisión', () => {
  it('se puede escribir en una aprobada sin notas y no crea un borrador de revisión', async () => {
    const { servicio, almacen } = await setup();
    const borrador = (
      await servicio.ejecutar({
        tipo: 'agregar_personalizado',
        item: { nombre: 'Puerta doble', familia: 'PUERTA', madera: 'Lenga', cantidad: 1, precioUnitario: 450_000 },
      })
    ).cotizacion;
    const emitida = (
      await servicio.ejecutar({ tipo: 'emitir', id: borrador.id, actualizada: borrador.actualizada })
    ).cotizacion;
    const aprobada = (
      await servicio.ejecutar({ tipo: 'aprobar', id: emitida.id, actualizada: emitida.actualizada })
    ).cotizacion;

    const r = await servicio.ejecutar({
      tipo: 'editar',
      id: aprobada.id,
      actualizada: aprobada.actualizada,
      items: [{ indice: 0, cambios: { costoFabrica: 300_000 } }],
    });
    expect(r.cotizacion.solicitudes[0].costoFabrica).toBe(300_000);
    expect(almacen.revisionAbierta(aprobada)).toBeNull();
  });
});

describe('BUG-047 · «Duplicar» es idempotente con el mismo nuevoId', () => {
  it('un reintento devuelve la copia ya creada en vez de crear otra', async () => {
    const { servicio, crear } = await setup();
    const original = await crear();
    const nuevoId = randomUUID();

    const primera = await servicio.ejecutar({ tipo: 'duplicar', id: original.id, nuevoId });
    const segunda = await servicio.ejecutar({ tipo: 'duplicar', id: original.id, nuevoId });

    expect(primera.cotizacion.id).toBe(nuevoId);
    expect(segunda.cotizacion.id).toBe(nuevoId);
  });
});
