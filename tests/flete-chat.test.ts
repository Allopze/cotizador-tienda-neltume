import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { montosAmbiguos, montosDelTexto } from '../src/asistente/flete';
import { problemaSalida, contextoSeguro } from '../src/asistente/llm';
import { clienteVacio, type Catalogo, type Producto } from '../src/catalogo/tipos';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { Servicio } from '../src/servidor/servicio';

vi.mock('../src/servidor/pdf', () => ({
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

const puerta: Producto = {
  codigo: 'MOL-P-0.8-2',
  modelo: 'MOLCO',
  familia: 'PUERTA',
  tipo: 'PUERTA PANEL',
  madera: 'PINO OREGON',
  medida: '0.8 A 0.85',
  anchoMin: 0.8,
  anchoMax: 0.85,
  largo: 2,
  precioNeto: 100_000,
  descripcion: 'MOLCO',
  filaOrigen: 1,
};
const catalogo: Catalogo = { fuente: 'test', sha256: 'test', fecha: '2026-01-01', productos: [puerta] };

const dirs: string[] = [];
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-flete-'));
  dirs.push(dir);
  const llm = { interpretar: vi.fn(), verificarCifras: true };
  return { llm, servicio: new Servicio(catalogo, llm, new Almacen(dir)) };
}
afterEach(async () => {
  vi.clearAllMocks();
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

const flete = (
  f: Partial<{
    descripcion: string | null;
    cantidad: number | null;
    valor: number | null;
    iva: 'neto' | 'incluido' | null;
  }>,
) => ({
  name: 'modificar_cotizacion',
  input: { flete: { descripcion: null, cantidad: null, valor: null, iva: null, ...f } },
});

/** Borrador con 3 Molco, sobre el que se pide el flete. */
async function conPedido() {
  const { servicio, llm } = await setup();
  llm.interpretar.mockResolvedValueOnce({
    name: 'modificar_cotizacion',
    input: {
      agregar: [
        {
          modelo: 'MOLCO',
          madera: 'PINO OREGON',
          ancho: 0.8,
          alto: 2,
          medida: null,
          cantidad: 3,
          tipoMedida: null,
          fuente: '3 Molco oregón 80x200',
        },
      ],
    },
  });
  const q = (await servicio.ejecutar({ tipo: 'chat', mensaje: '3 Molco oregón 80x200' })).cotizacion;
  return { servicio, llm, q };
}

describe('montos del texto', () => {
  it('lee pesos con puntos de miles, sin separador y con «mil», «lucas» o «millones»', () => {
    expect(montosDelTexto('valor de $380.000 + iva')).toContain(380000);
    expect(montosDelTexto('flete 380000')).toContain(380000);
    expect(montosDelTexto('380 mil')).toContain(380000);
    expect(montosDelTexto('380 lucas')).toContain(380000);
    expect(montosDelTexto('1,2 millones')).toContain(1200000);
    expect(montosDelTexto('$1.200.000')).toContain(1200000);
  });
  it('con multiplicador no respalda la cifra sola', () => {
    expect(montosDelTexto('380 mil')).not.toContain(380);
  });
  it('en pesos no hay centavos: «$350.00» es $350.000, nunca $350', () => {
    const texto = '1 Huilo Huilo de 0.74x2.08 mt, despacho con un valor de $350.00 + iva';
    expect(montosDelTexto(texto)).toContain(350000);
    expect(montosDelTexto(texto)).not.toContain(350);
    expect(montosDelTexto('$1.200.00')).toEqual([1200000]);
    expect(montosAmbiguos(texto)).toEqual([]);
  });
  it('«$350.50» no respalda ningún monto y se cita como dudoso, pero no las medidas', () => {
    const texto = '1 Huilo Huilo de 0.74x2.08 mt, despacho $350.50 + iva';
    expect(montosDelTexto(texto)).not.toContain(350);
    expect(montosDelTexto(texto)).not.toContain(350500);
    expect(montosAmbiguos(texto)).toEqual(['$350.50']);
    expect(montosAmbiguos('$380.000 + iva y 1,2 millones')).toEqual([]);
  });
});

describe('flete desde el chat', () => {
  it('agrega la línea de flete con el valor neto escrito, sin agregar un producto', async () => {
    const { servicio, llm, q } = await conPedido();
    const mensaje = 'agregar un item de flete por despacho a Chillan con valor de $380.000 + iva';
    llm.interpretar.mockResolvedValueOnce(
      flete({ descripcion: 'Flete por despacho a Chillán', cantidad: 1, valor: 380000, iva: 'neto' }),
    );
    const r = await servicio.ejecutar({ tipo: 'chat', id: q.id, actualizada: q.actualizada, mensaje });
    expect(r.cotizacion.solicitudes).toHaveLength(1);
    expect(r.cotizacion).toMatchObject({
      flete: 380000,
      fleteCantidad: 1,
      fleteDescripcion: 'Flete por despacho a Chillán',
    });
    expect(r.cotizacion.montos.flete).toBe(380000);
    expect(r.cotizacion.cliente.comuna).toBeNull();
    expect(r.avisos ?? []).toEqual([]);
    expect(r.cotizacion.historial.at(-1)?.texto).toMatch(
      /Flete: 1 × Flete por despacho a Chillán, \$380\.000 neto c\/u/,
    );
  });

  it('un valor con IVA incluido se guarda neto', async () => {
    const { servicio, llm, q } = await conPedido();
    llm.interpretar.mockResolvedValueOnce(flete({ valor: 119000, iva: 'incluido' }));
    const r = await servicio.ejecutar({
      tipo: 'chat',
      id: q.id,
      actualizada: q.actualizada,
      mensaje: 'flete 119.000 iva incluido',
    });
    expect(r.cotizacion.flete).toBe(100000);
  });

  it('sin decir el IVA lo toma como neto y avisa', async () => {
    const { servicio, llm, q } = await conPedido();
    llm.interpretar.mockResolvedValueOnce(flete({ valor: 50000 }));
    const r = await servicio.ejecutar({
      tipo: 'chat',
      id: q.id,
      actualizada: q.actualizada,
      mensaje: 'flete 50 lucas',
    });
    expect(r.cotizacion.flete).toBe(50000);
    expect(r.avisos).toEqual([expect.stringMatching(/como valor neto del flete/)]);
  });

  it('no aplica un valor que nadie escribió', async () => {
    const { servicio, llm, q } = await conPedido();
    llm.interpretar.mockResolvedValueOnce(flete({ valor: 380000, iva: 'neto' }));
    const r = await servicio.ejecutar({
      tipo: 'chat',
      id: q.id,
      actualizada: q.actualizada,
      mensaje: 'agrega el flete a Chillán',
    });
    expect(r.cotizacion.flete).toBe(0);
    expect(r.avisos).toEqual([expect.stringMatching(/su valor no aparece escrito/)]);
  });

  it.each([350, 350000])('«$350.00» leído por la IA como %i queda en $350.000', async (valor) => {
    const { servicio, llm, q } = await conPedido();
    llm.interpretar.mockResolvedValueOnce(flete({ descripcion: 'Despacho a Riñihue', valor, iva: 'neto' }));
    const r = await servicio.ejecutar({
      tipo: 'chat',
      id: q.id,
      actualizada: q.actualizada,
      mensaje: 'DEPACHO A RIÑIHUE con un valor de $350.00 + iva',
    });
    expect(r.cotizacion.flete).toBe(350000);
    expect(r.avisos ?? []).toEqual([]);
  });

  it('no aplica un monto dudoso («$350.50») y pide escribirlo completo', async () => {
    const { servicio, llm, q } = await conPedido();
    llm.interpretar.mockResolvedValueOnce(flete({ valor: 350500, iva: 'neto' }));
    const r = await servicio.ejecutar({
      tipo: 'chat',
      id: q.id,
      actualizada: q.actualizada,
      mensaje: 'despacho a Riñihue $350.50 + iva',
    });
    expect(r.cotizacion.flete).toBe(0);
    expect(r.avisos).toEqual([expect.stringMatching(/«\$350\.50» no es un monto claro en pesos/)]);
  });

  it('un flete bajo $1.000 se aplica, pero avisa que pueden faltarle ceros', async () => {
    const { servicio, llm, q } = await conPedido();
    llm.interpretar.mockResolvedValueOnce(flete({ valor: 350, iva: 'neto' }));
    const r = await servicio.ejecutar({
      tipo: 'chat',
      id: q.id,
      actualizada: q.actualizada,
      mensaje: 'despacho a Riñihue $350 + iva',
    });
    expect(r.cotizacion.flete).toBe(350);
    expect(r.avisos).toEqual([expect.stringMatching(/El flete quedó en \$350: revisa si le faltan ceros/)]);
  });

  it('la línea del flete no se revisa como un pedido sin registrar', async () => {
    const { servicio, llm } = await setup();
    // El destino se llama como un modelo del catálogo, igual que Riñihue.
    const mensaje = '3 Molco oregón 80x200\nDEPACHO A MOLCO con un valor de $350.000 + iva';
    const salida = {
      name: 'modificar_cotizacion',
      input: {
        agregar: [
          {
            modelo: 'MOLCO',
            madera: 'PINO OREGON',
            ancho: 0.8,
            alto: 2,
            medida: null,
            cantidad: 3,
            tipoMedida: null,
            fuente: '3 Molco oregón 80x200',
          },
        ],
        flete: { descripcion: 'Despacho a Molco', cantidad: 1, valor: 350000, iva: 'neto' },
      },
    };
    llm.interpretar.mockResolvedValueOnce(salida);
    const r = await servicio.ejecutar({ tipo: 'chat', mensaje });
    expect(llm.interpretar.mock.calls[0][1].revisar(salida)).toBeNull();
    expect(r.cotizacion.flete).toBe(350000);
    expect(r.avisos ?? []).toEqual([]);
  });

  it('cambia la descripción de un flete existente sin tocar su valor, y luego lo quita', async () => {
    const { servicio, llm, q } = await conPedido();
    llm.interpretar.mockResolvedValueOnce(
      flete({ descripcion: 'Flete a Chillán', cantidad: 2, valor: 40000, iva: 'neto' }),
    );
    let c = (
      await servicio.ejecutar({
        tipo: 'chat',
        id: q.id,
        actualizada: q.actualizada,
        mensaje: '2 fletes a Chillán de $40.000 neto',
      })
    ).cotizacion;
    expect(c).toMatchObject({ flete: 80000, fleteCantidad: 2 });
    llm.interpretar.mockResolvedValueOnce(flete({ descripcion: 'Flete a Los Ángeles' }));
    c = (
      await servicio.ejecutar({
        tipo: 'chat',
        id: c.id,
        actualizada: c.actualizada,
        mensaje: 'el flete es a Los Ángeles',
      })
    ).cotizacion;
    expect(c).toMatchObject({ flete: 80000, fleteCantidad: 2, fleteDescripcion: 'Flete a Los Ángeles' });
    llm.interpretar.mockResolvedValueOnce({ name: 'modificar_cotizacion', input: { flete: null } });
    c = (
      await servicio.ejecutar({
        tipo: 'chat',
        id: c.id,
        actualizada: c.actualizada,
        mensaje: 'saca el flete',
      })
    ).cotizacion;
    expect(c).toMatchObject({ flete: 0, fleteCantidad: 1, fleteDescripcion: null });
  });

  it('un mensaje con solo el flete crea la cotización', async () => {
    const { servicio, llm } = await setup();
    llm.interpretar.mockResolvedValueOnce(flete({ valor: 380000, iva: 'neto' }));
    const r = await servicio.ejecutar({ tipo: 'chat', mensaje: 'flete a Chillán $380.000 + IVA' });
    expect(r.efimera).toBeUndefined();
    expect(r.cotizacion.flete).toBe(380000);
  });

  it('modificar_cotizacion con solo el flete es una salida válida', () => {
    const contexto = contextoSeguro('flete $380.000', [], clienteVacio(), [], []);
    expect(problemaSalida(flete({ valor: 380000 }), contexto)).toBeNull();
  });
});
