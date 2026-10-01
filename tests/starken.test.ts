import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Servicio } from '../src/servidor/servicio';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { calcularFlete, type ProductoDespacho } from '../src/negocio/envios';
import { clienteVacio, type Catalogo, type Producto, type SolicitudItem } from '../src/catalogo/tipos';
import type { Cotizacion } from '../src/negocio/estado';
import {
  buscarCiudades,
  calcularBulto,
  IVA_STARKEN,
  leerMedida,
  netoDesdeIva,
  normalizarNombre,
  parametrosVacios,
  resolverDestino,
  textoBulto,
  textoTarifa,
  textoTarifaAplicada,
  type CiudadStarken,
  type ParametrosPaquete,
} from '../src/negocio/starken';
import {
  ClienteStarken,
  ErrorStarken,
  leerEntornoStarken,
  nuevoCacheCiudades,
  ProveedorStarken,
  TTL_CIUDADES_MS,
  type EntornoStarken,
} from '../src/servidor/starken';
import {
  configuracionStarkenSchema,
  guardarConfiguracionStarken,
  leerConfiguracionStarken,
  mensajeErrorConfiguracion,
} from '../src/servidor/starken-configuracion';
import { firmarTarifa, verificarTarifa, VIGENCIA_FIRMA_MS } from '../src/servidor/starken-firma';
import {
  cotizarEnvioStarken,
  crearClienteStarken,
  estadoStarken,
  guardarAjustesStarken,
  modoStarkenFijo,
  respuestaErrorStarken,
} from '../src/servidor/starken-servicio';
import { ENTORNO_FIJO, fetchFijo } from '../src/servidor/starken-fijo';

vi.mock('../src/servidor/pdf', () => ({
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

type Fetch = typeof globalThis.fetch;

// --- Datos de prueba ---------------------------------------------------------------------------------

const producto = (p: Partial<Producto> & Pick<Producto, 'codigo' | 'familia'>): Producto => ({
  modelo: 'MOLCO',
  tipo: null,
  madera: 'PINO OREGON',
  medida: '',
  anchoMin: null,
  anchoMax: null,
  largo: 2.1,
  precioNeto: 100000,
  descripcion: p.codigo,
  filaOrigen: 1,
  ...p,
});
const puerta = producto({
  codigo: 'MOL-O-3-A',
  familia: 'PUERTA',
  medida: '0,80 A 0,85',
  anchoMin: 0.8,
  anchoMax: 0.85,
  largo: 2,
});
const marco = producto({ codigo: 'MARCO-2X4', familia: 'MARCO', modelo: 'MARCO', medida: '2X4', largo: 2.1 });
const linea = (
  p: Producto,
  cantidad: number,
  ancho: number | null = null,
  alto: number | null = null,
): ProductoDespacho => ({
  producto: p,
  cantidad,
  anchoSolicitado: ancho,
  altoSolicitado: alto,
});
const puertaExacta = (ancho: number, alto: number) =>
  producto({
    codigo: `P-${ancho}-${alto}`,
    familia: 'PUERTA',
    anchoMin: ancho,
    anchoMax: ancho,
    largo: alto,
  });
const parametros = (p: Partial<ParametrosPaquete> = {}): ParametrosPaquete => ({
  ...parametrosVacios(),
  PUERTA: { kg: 30, espesorCm: 6 },
  ...p,
});

const ciudad = (codigoCiudad: number, nombre: string, ...comunas: string[]): CiudadStarken => ({
  codigoCiudad,
  nombre,
  comunas: comunas.length ? comunas : [nombre],
});
const CIUDADES = [
  ciudad(1, 'SANTIAGO', 'SANTIAGO', 'PROVIDENCIA', 'ÑUÑOA', 'MAIPU'),
  ciudad(2, 'TEMUCO', 'TEMUCO', 'PADRE LAS CASAS'),
  ciudad(3, 'VILLARRICA'),
  ciudad(20, 'SAN CARLOS'),
  ciudad(21, 'CHILLAN', 'CHILLAN', 'SAN CARLOS'),
  ciudad(30, 'OSORNO', 'OSORNO', 'SAN PABLO'),
  ciudad(31, 'RIO NEGRO', 'RIO NEGRO', 'SAN PABLO'),
  ciudad(40, 'VALDIVIA'),
];

// --- Formatos de la API de Starken, simulados --------------------------------------------------------

const ENTORNO: EntornoStarken = {
  url: 'https://starken.qa.test/apiqa/starkenservices/rest',
  rut: '11111111-1',
  clave: 'clave-secreta-xyz',
  cuentaCorriente: '5551234',
  cuentaCorrienteDV: 'K',
  rutCliente: null,
};
const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
const tarifa = (costoTotal: number, entrega: 'AGENCIA' | 'DOMICILIO', dias: number, servicio = 'NORMAL') => ({
  costoTotal,
  diasEntrega: dias,
  tipoEntrega: { codigoTipoEntrega: entrega === 'AGENCIA' ? 1 : 2, descripcionTipoEntrega: entrega },
  tipoServicio: { codigoTipoServicio: 0, descripcionTipoServicio: servicio },
});
const respuestaTarifas = (...lista: ReturnType<typeof tarifa>[]) => ({
  type: 'consultarCoberturaRespuesta',
  codigoRespuesta: 1,
  mensajeRespuesta: 'Busqueda exitosa.',
  listaTarifas: lista,
});
const listaDestino = (ciudades: CiudadStarken[] = CIUDADES) => ({
  type: 'listarCiudadesDestinoRespuesta',
  codigoRespuesta: 1,
  mensajeRespuesta: 'Busqueda Exitosa.',
  listaCiudadesDestino: ciudades.map((c) => ({
    codigoCiudad: c.codigoCiudad,
    codigoRegion: 1,
    codigoZonaGeografica: 1,
    nombreCiudad: c.nombre,
    listaComunas: c.comunas.map((nombreComuna, i) => ({ codigoComuna: i, nombreComuna })),
  })),
});
const BULTO = { alto: 13.5, ancho: 85, largo: 200, kilos: 75 };
const cliente = (
  fetch: Fetch,
  opciones: { timeoutMs?: number; ahora?: () => number; entorno?: EntornoStarken } = {},
) =>
  new ClienteStarken(opciones.entorno ?? ENTORNO, {
    fetch,
    cache: nuevoCacheCiudades(),
    timeoutMs: opciones.timeoutMs,
    ahora: opciones.ahora,
  });
const simulado = (...respuestas: (Response | Error)[]) => {
  const cola = [...respuestas];
  return vi.fn<Fetch>(async () => {
    const r = cola.shift();
    if (!r) throw new Error('Sin respuesta simulada');
    if (r instanceof Error) throw r;
    return r;
  });
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// --- Entorno -----------------------------------------------------------------------------------------

describe('configuración por entorno', () => {
  const completo = {
    STARKEN_URL: 'https://starken.qa.test/apiqa/starkenservices/rest/',
    STARKEN_RUT: '11111111-1',
    STARKEN_CLAVE: 'secreta',
    STARKEN_CUENTA_CORRIENTE: '5551234',
    STARKEN_CUENTA_CORRIENTE_DV: 'K',
  };

  it('con cuenta corriente no usa el RUT del cliente; sin ella lo exige', () => {
    expect(leerEntornoStarken({ ...completo, STARKEN_RUT_CLIENTE: '76.123.456-7' })).toEqual({
      url: 'https://starken.qa.test/apiqa/starkenservices/rest',
      rut: '11111111-1',
      clave: 'secreta',
      cuentaCorriente: '5551234',
      cuentaCorrienteDV: 'K',
      rutCliente: null,
    });
    const sinCuenta = { ...completo, STARKEN_CUENTA_CORRIENTE: '', STARKEN_CUENTA_CORRIENTE_DV: '' };
    expect(leerEntornoStarken(sinCuenta)).toBeNull();
    expect(leerEntornoStarken({ ...sinCuenta, STARKEN_RUT_CLIENTE: '76.123.456-7' })).toMatchObject({
      cuentaCorriente: null,
      cuentaCorrienteDV: null,
      rutCliente: '76.123.456-7',
    });
  });

  it('sin URL, RUT, clave o con una URL inválida, o con cuenta sin dígito, no está configurado', () => {
    expect(leerEntornoStarken({})).toBeNull();
    for (const falta of ['STARKEN_URL', 'STARKEN_RUT', 'STARKEN_CLAVE', 'STARKEN_CUENTA_CORRIENTE_DV'])
      expect(leerEntornoStarken({ ...completo, [falta]: '  ' })).toBeNull();
    expect(leerEntornoStarken({ ...completo, STARKEN_URL: 'no es una url' })).toBeNull();
    expect(leerEntornoStarken({ ...completo, STARKEN_URL: 'ftp://starken.test/rest' })).toBeNull();
  });

  it('exige https: http solo se acepta hacia esta misma máquina (desarrollo y pruebas)', () => {
    const conUrl = (STARKEN_URL: string) => leerEntornoStarken({ ...completo, STARKEN_URL });
    expect(conUrl('http://starken.qa.test/rest')).toBeNull();
    expect(conUrl('http://restservices-qa.starken.cl/apiqa/starkenservices/rest')).toBeNull();
    // Un nombre que solo se parece a «localhost» no es esta máquina.
    expect(conUrl('http://localhost.evil.test/rest')).toBeNull();
    for (const local of [
      'http://127.0.0.1:4010/rest',
      'http://localhost:4010/rest',
      'http://[::1]:4010/rest',
    ])
      expect(conUrl(local)?.url).toBe(local);
    expect(conUrl('https://starken.qa.test/rest')?.url).toBe('https://starken.qa.test/rest');
  });

  it('el estado avisa «Starken no está configurado» sin credenciales y lo da por disponible con ellas', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'neltume-starken-estado-'));
    const almacen = new Almacen(dir);
    try {
      for (const k of [...Object.keys(completo), 'STARKEN_RUT_CLIENTE']) vi.stubEnv(k, '');
      const sin = estadoStarken(almacen.baseDatos());
      expect(sin).toMatchObject({ disponible: false, mensaje: 'Starken no está configurado' });
      expect(await crearClienteStarken()).toBeNull();
      // Nada de esto incluye credenciales.
      expect(JSON.stringify(sin)).not.toMatch(/clave|secreta/i);
      for (const [k, v] of Object.entries(completo)) vi.stubEnv(k, v);
      expect(estadoStarken(almacen.baseDatos())).toMatchObject({ disponible: true, mensaje: null });
      expect(await crearClienteStarken()).toBeInstanceOf(ClienteStarken);
    } finally {
      cerrarAlmacen(join(dir, 'cotizador.sqlite'));
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('el Starken simulado solo existe en modo de pruebas, y con las dos banderas', async () => {
    vi.stubEnv('NELTUME_STARKEN', 'fijo');
    vi.stubEnv('NELTUME_TEST_MODE', '');
    expect(modoStarkenFijo()).toBe(false);
    vi.stubEnv('NELTUME_TEST_MODE', '1');
    expect(modoStarkenFijo()).toBe(true);
    vi.stubEnv('NELTUME_STARKEN', '');
    expect(modoStarkenFijo()).toBe(false);
  });
});

// --- Cliente con fetch simulado ----------------------------------------------------------------------

describe('cliente de Starken (fetch simulado)', () => {
  it('consulta tarifas con las credenciales en las cabeceras, las dimensiones totales y la cuenta corriente', async () => {
    const fetch = simulado(
      json(respuestaTarifas(tarifa(101150, 'DOMICILIO', 3), tarifa(89250, 'AGENCIA', 2))),
    );
    const tarifas = await cliente(fetch).consultarTarifas({ origen: 1, destino: 2, bulto: BULTO });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://starken.qa.test/apiqa/starkenservices/rest/consultarTarifas');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ rut: '11111111-1', clave: 'clave-secreta-xyz' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    // No sigue redirecciones: reenviarían las credenciales de las cabeceras a otro destino.
    expect(init?.redirect).toBe('error');
    const cuerpo = JSON.parse(String(init?.body));
    expect(cuerpo).toEqual({
      codigoCiudadOrigen: 1,
      codigoCiudadDestino: 2,
      codigoAgenciaOrigen: 0,
      codigoAgenciaDestino: 0,
      ...BULTO,
      cuentaCorriente: '5551234',
      cuentaCorrienteDV: 'K',
    });
    expect(cuerpo).not.toHaveProperty('rutCliente');
    // De menor a mayor costo; el neto sale del valor con IVA.
    expect(tarifas).toEqual([
      { tipoEntrega: 'AGENCIA', servicio: 'NORMAL', dias: 2, costoTotal: 89250, neto: 75000 },
      { tipoEntrega: 'DOMICILIO', servicio: 'NORMAL', dias: 3, costoTotal: 101150, neto: 85000 },
    ]);
  });

  it('sin cuenta corriente envía el RUT del cliente y las cuentas vacías', async () => {
    const fetch = simulado(json(respuestaTarifas(tarifa(37326, 'AGENCIA', 1))));
    const c = cliente(fetch, {
      entorno: { ...ENTORNO, cuentaCorriente: null, cuentaCorrienteDV: null, rutCliente: '76123456-7' },
    });
    await c.consultarTarifas({ origen: 1, destino: 98, bulto: BULTO });
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({
      cuentaCorriente: '',
      cuentaCorrienteDV: '',
      rutCliente: '76123456-7',
    });
  });

  it('un código de respuesta distinto de 1 es un error con el mensaje de Starken', async () => {
    const fetch = simulado(
      json({
        type: 'consultarCoberturaRespuesta',
        codigoRespuesta: 0,
        mensajeRespuesta: 'El destino no tiene cobertura.',
      }),
    );
    const error = await cliente(fetch)
      .consultarTarifas({ origen: 1, destino: 99, bulto: BULTO })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorStarken);
    expect(error).toMatchObject({ codigo: 'rechazado', message: 'Starken: El destino no tiene cobertura.' });
  });

  it('descarta la fila mal formada y conserva las demás; el neto sale del valor redondeado', async () => {
    const filaMala = {
      costoTotal: 'mucho',
      diasEntrega: 2,
      tipoEntrega: { descripcionTipoEntrega: 'AGENCIA' },
    };
    const sinTipo = { costoTotal: 1000, diasEntrega: 1 };
    const fetch = simulado(
      json({
        ...respuestaTarifas(tarifa(37326.6, 'DOMICILIO', 2)),
        listaTarifas: [filaMala, tarifa(37326.6, 'DOMICILIO', 2), null, sinTipo, tarifa(89250, 'AGENCIA', 1)],
      }),
    );
    const tarifas = await cliente(fetch).consultarTarifas({ origen: 1, destino: 2, bulto: BULTO });
    expect(tarifas.map((t) => [t.tipoEntrega, t.costoTotal, t.neto])).toEqual([
      ['DOMICILIO', 37327, netoDesdeIva(37327)],
      ['AGENCIA', 89250, 75000],
    ]);
    // Si ninguna sirve, se informa en vez de inventar una.
    const ninguna = simulado(json({ ...respuestaTarifas(), listaTarifas: [filaMala, sinTipo] }));
    await expect(cliente(ninguna).consultarTarifas({ origen: 1, destino: 2, bulto: BULTO })).rejects.toThrow(
      'no informó tarifas',
    );
  });

  it('una ciudad mal formada no invalida la lista entera', async () => {
    const lista = listaDestino();
    const fetch = simulado(
      json({
        ...lista,
        listaCiudadesDestino: [{ nombreCiudad: 'SIN CODIGO' }, ...lista.listaCiudadesDestino, 'basura'],
      }),
    );
    const ciudades = await cliente(fetch).listarCiudades('destino');
    expect(ciudades).toHaveLength(CIUDADES.length);
    expect(ciudades.some((c) => c.nombre === 'SIN CODIGO')).toBe(false);
  });

  it('una respuesta sin tarifas utilizables se informa, no se inventa una tarifa', async () => {
    const vacia = simulado(json({ codigoRespuesta: 1, mensajeRespuesta: 'ok', listaTarifas: [] }));
    await expect(
      cliente(vacia).consultarTarifas({ origen: 1, destino: 2, bulto: BULTO }),
    ).rejects.toMatchObject({ codigo: 'rechazado' });
    const enCero = simulado(json(respuestaTarifas(tarifa(0, 'AGENCIA', 1))));
    await expect(cliente(enCero).consultarTarifas({ origen: 1, destino: 2, bulto: BULTO })).rejects.toThrow(
      'no informó tarifas',
    );
  });

  it('si Starken no responde a tiempo, corta a los 10 s por omisión y avisa sin detalles técnicos', async () => {
    // Un fetch que solo termina cuando se aborta la señal.
    const colgado = vi.fn<Fetch>(
      (_url, init) =>
        new Promise((_ok, rechazar) =>
          init?.signal?.addEventListener('abort', () => rechazar(init.signal?.reason)),
        ),
    );
    const error = await cliente(colgado, { timeoutMs: 20 })
      .consultarTarifas({ origen: 1, destino: 2, bulto: BULTO })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({
      codigo: 'timeout',
      message: 'Starken no respondió a tiempo. Reintenta en un momento.',
    });
    const espiar = vi.spyOn(AbortSignal, 'timeout');
    await cliente(simulado(json(respuestaTarifas(tarifa(1190, 'AGENCIA', 1))))).consultarTarifas({
      origen: 1,
      destino: 2,
      bulto: BULTO,
    });
    expect(espiar).toHaveBeenCalledWith(10_000);
  });

  it('cada falla tiene un mensaje claro y ninguno filtra las credenciales', async () => {
    const consulta = async (f: Fetch) =>
      (await cliente(f)
        .consultarTarifas({ origen: 1, destino: 2, bulto: BULTO })
        .catch((e: unknown) => e)) as ErrorStarken;
    const filtrada = new TypeError('fetch failed: rut=11111111-1 clave=clave-secreta-xyz');
    const errores = [
      await consulta(simulado(filtrada)),
      await consulta(
        simulado(json({ codigoRespuesta: 0, mensajeRespuesta: 'Credenciales inválidas.' }, 401)),
      ),
      await consulta(simulado(new Response('<html>Bad gateway</html>', { status: 502 }))),
      await consulta(simulado(new Response('<html>no es json</html>', { status: 200 }))),
      await consulta(simulado(json({ otra: 'cosa' }))),
    ];
    expect(errores.map((e) => e.codigo)).toEqual(['red', 'http', 'http', 'respuesta', 'respuesta']);
    expect(errores[0].message).toBe('No se pudo conectar con Starken. Reintenta en un momento.');
    expect(errores[1].message).toBe('Starken respondió con un error (HTTP 401): Credenciales inválidas.');
    expect(errores[2].message).toBe('Starken respondió con un error (HTTP 502).');
    for (const e of errores) {
      expect(e.message).not.toContain('clave-secreta-xyz');
      expect(e.message).not.toContain('11111111-1');
      expect(String(e.stack)).not.toContain('clave-secreta-xyz');
    }
  });

  it('los códigos de error se traducen a respuestas HTTP que la interfaz muestra tal cual', async () => {
    const estado = async (codigo: ConstructorParameters<typeof ErrorStarken>[1]) => {
      const r = respuestaErrorStarken(new ErrorStarken('mensaje', codigo));
      return [r.status, ((await r.json()) as { codigo: string }).codigo];
    };
    expect(await estado('no_configurado')).toEqual([503, 'starken_no_configurado']);
    expect(await estado('paquete')).toEqual([400, 'starken_sin_parametros']);
    expect(await estado('rechazado')).toEqual([422, 'starken_rechazado']);
    expect(await estado('destino')).toEqual([422, 'starken_rechazado']);
    // 502 y 504 los reemplaza la interfaz por mensajes genéricos: los fallos de Starken van en 503.
    for (const c of ['timeout', 'red', 'http', 'respuesta'] as const)
      expect(await estado(c)).toEqual([503, 'starken_no_disponible']);
  });
});

describe('ciudades de Starken en caché', () => {
  it('descarga cada lista una vez, la reutiliza durante 24 horas y la pide de nuevo al vencer', async () => {
    let ahora = 1_000_000;
    const fetch = vi.fn<Fetch>(async () => json(listaDestino()));
    const c = cliente(fetch, { ahora: () => ahora });
    const primera = await c.listarCiudades('destino');
    expect(primera.find((x) => x.codigoCiudad === 1)).toEqual({
      codigoCiudad: 1,
      nombre: 'SANTIAGO',
      comunas: ['SANTIAGO', 'PROVIDENCIA', 'ÑUÑOA', 'MAIPU'],
    });
    await c.listarCiudades('destino');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toBe(`${ENTORNO.url}/listarCiudadesDestino`);
    expect(fetch.mock.calls[0][1]?.method).toBe('GET');
    ahora += TTL_CIUDADES_MS - 1;
    await c.listarCiudades('destino');
    expect(fetch).toHaveBeenCalledTimes(1);
    ahora += 2;
    await c.listarCiudades('destino');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('las listas de origen y destino son distintas y llamadas simultáneas comparten una sola descarga', async () => {
    const fetch = vi.fn<Fetch>(async (url) =>
      String(url).endsWith('listarCiudadesOrigen')
        ? json({
            codigoRespuesta: 1,
            mensajeRespuesta: 'ok',
            listaCiudadesOrigen: [
              {
                codigoCiudad: 7,
                nombreCiudad: 'CURICO',
                listaComunas: [{ codigoComuna: 1, nombreComuna: 'CURICO' }],
              },
            ],
          })
        : json(listaDestino()),
    );
    const c = cliente(fetch);
    const [a, b, origen] = await Promise.all([
      c.listarCiudades('destino'),
      c.listarCiudades('destino'),
      c.listarCiudades('origen'),
    ]);
    expect(a).toBe(b);
    expect(origen).toEqual([{ codigoCiudad: 7, nombre: 'CURICO', comunas: ['CURICO'] }]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('si la descarga falla sirve la lista vencida; sin lista anterior, el error', async () => {
    let ahora = 0;
    const fetch = simulado(json(listaDestino()), new TypeError('fetch failed'));
    const c = cliente(fetch, { ahora: () => ahora });
    const inicial = await c.listarCiudades('destino');
    ahora += TTL_CIUDADES_MS + 1;
    expect(await c.listarCiudades('destino')).toBe(inicial);
    await expect(
      cliente(simulado(new TypeError('fetch failed'))).listarCiudades('destino'),
    ).rejects.toMatchObject({ codigo: 'red' });
    await expect(
      cliente(simulado(json({ codigoRespuesta: 1, listaCiudadesDestino: [] }))).listarCiudades('destino'),
    ).rejects.toMatchObject({ codigo: 'respuesta' });
  });
});

// --- Proveedor de despacho ---------------------------------------------------------------------------

describe('proveedor ShippingProvider de Starken', () => {
  const contexto = (
    fetch: Fetch,
    p = parametros(),
    origen: { codigoCiudad: number; nombre: string } | null = { codigoCiudad: 1, nombre: 'SANTIAGO' },
  ) => ({
    cliente: cliente(fetch),
    origen,
    paquete: p,
  });

  it('calcularFlete devuelve la tarifa más baja en neto, con su plazo y su referencia', async () => {
    const fetch = simulado(
      json(listaDestino()),
      json(respuestaTarifas(tarifa(101150, 'DOMICILIO', 3), tarifa(89250, 'AGENCIA', 2))),
    );
    const proveedor = new ProveedorStarken(contexto(fetch));
    expect(proveedor.id).toBe('starken');
    const r = await calcularFlete(proveedor, '  Temuco ', [linea(puerta, 3, 0.82, 2)]);
    expect(r).toEqual({
      transportista: 'Starken',
      valor: 75000,
      plazoEstimado: '2 días',
      referenciaExterna: 'AGENCIA · ciudad 2',
    });
    // 3 puertas de 6 cm = 18 cm apilados; el ancho y el alto son los mayores; 90 kg.
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toMatchObject({
      codigoCiudadOrigen: 1,
      codigoCiudadDestino: 2,
      alto: 18,
      ancho: 85,
      largo: 200,
      kilos: 90,
    });
  });

  it('sin origen o con un destino dudoso falla con un mensaje claro y sin llamar a tarifas', async () => {
    const fetch = vi.fn<Fetch>(async () => json(listaDestino()));
    const falla = async (p: ProveedorStarken, destino: string, productos = [linea(puerta, 1)]) =>
      (await p.calculateShipping(destino, productos).catch((e: unknown) => e)) as ErrorStarken;
    const sinOrigen = await falla(new ProveedorStarken(contexto(fetch, parametros(), null)), 'Temuco');
    expect(sinOrigen).toMatchObject({
      codigo: 'paquete',
      message: 'Configura la ciudad de origen de Starken en Ajustes.',
    });
    const dudoso = await falla(new ProveedorStarken(contexto(fetch)), 'San Pablo');
    expect(dudoso).toMatchObject({ codigo: 'destino' });
    expect(dudoso.message).toContain('OSORNO, RIO NEGRO');
    const inexistente = await falla(new ProveedorStarken(contexto(fetch)), 'Atlantis');
    expect(inexistente).toMatchObject({ codigo: 'destino' });
    // Nunca se llegó a consultar tarifas.
    expect(fetch.mock.calls.every(([url]) => !String(url).endsWith('consultarTarifas'))).toBe(true);
  });

  it('calcularFlete ignora destinos o pedidos vacíos sin llamar al proveedor', async () => {
    const fetch = vi.fn<Fetch>();
    const proveedor = new ProveedorStarken(contexto(fetch));
    expect(await calcularFlete(proveedor, '   ', [linea(puerta, 1)])).toBeNull();
    expect(await calcularFlete(proveedor, 'Temuco', [])).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

// --- Bulto -------------------------------------------------------------------------------------------

describe('bulto equivalente', () => {
  const ok = (r: ReturnType<typeof calcularBulto>) => {
    if (!r.ok) throw new Error(r.mensaje);
    return r.bulto;
  };

  it('una puerta: espesor configurado, su ancho y su alto en cm y su peso', () => {
    expect(
      ok(
        calcularBulto([linea(puertaExacta(0.8, 2.1), 1)], parametros({ PUERTA: { kg: 30, espesorCm: 4.5 } })),
      ),
    ).toMatchObject({
      alto: 4.5,
      ancho: 80,
      largo: 210,
      kilos: 30,
      bultos: 1,
      unidades: { PUERTA: 1 },
    });
  });

  it('apila las puertas: suma el espesor y el peso, toma el ancho y el alto mayores', () => {
    const bulto = ok(calcularBulto([linea(puertaExacta(0.9, 2.4), 14)], parametros()));
    expect(bulto).toMatchObject({ alto: 84, ancho: 90, largo: 240, kilos: 420 });
    expect(textoBulto(bulto)).toBe('14 puertas · 1 línea · total 84 × 90 × 240 cm, 420 kg');
  });

  it('varios bultos (líneas): suma una dimensión y toma el máximo de las otras dos', () => {
    const r = calcularBulto(
      [linea(puertaExacta(0.8, 2.1), 5), linea(puertaExacta(0.9, 2.4), 4), linea(puertaExacta(0.85, 2.4), 5)],
      parametros(),
    );
    const bulto = ok(r);
    // Espesor: (5 + 4 + 5) × 6 = 84; ancho y largo: los mayores; peso: 14 × 30.
    expect(bulto).toMatchObject({ alto: 84, ancho: 90, largo: 240, kilos: 420, bultos: 3 });
    expect(textoBulto(bulto)).toBe('14 puertas · 3 líneas · total 84 × 90 × 240 cm, 420 kg');
  });

  it('usa la medida mayor entre la pedida y la de la referencia del catálogo', () => {
    // Referencia 0,80–0,85 × 2,00: una puerta de 0,82 × 1,95 se envía con la medida de la referencia…
    expect(ok(calcularBulto([linea(puerta, 1, 0.82, 1.95)], parametros()))).toMatchObject({
      ancho: 85,
      largo: 200,
    });
    // …y una pedida más grande que la referencia manda.
    expect(ok(calcularBulto([linea(puerta, 1, 0.9, 2.05)], parametros()))).toMatchObject({
      ancho: 90,
      largo: 205,
    });
    // Sin medida pedida, la de la referencia. Sin decimales sucios: 0,835 m son 83,5 cm.
    expect(ok(calcularBulto([linea(puerta, 1)], parametros()))).toMatchObject({ ancho: 85, largo: 200 });
    expect(ok(calcularBulto([linea(puertaExacta(0.835, 2.36), 2)], parametros()))).toMatchObject({
      ancho: 83.5,
      largo: 236,
    });
  });

  it('marcos, molduras y piezas T: el largo es la medida mayor y la sección toma el espesor configurado', () => {
    const p = parametros({ MARCO: { kg: 3.5, espesorCm: 5 } });
    const bulto = ok(calcularBulto([linea(puertaExacta(0.9, 2.4), 2), linea(marco, 4, null, 2.1)], p));
    expect(bulto).toMatchObject({
      alto: 2 * 6 + 4 * 5,
      ancho: 90,
      largo: 240,
      kilos: 2 * 30 + 4 * 3.5,
      bultos: 2,
    });
    expect(textoBulto(bulto)).toBe('2 puertas, 4 marcos · 2 líneas · total 32 × 90 × 240 cm, 74 kg');
    expect(ok(calcularBulto([linea(marco, 1)], p))).toMatchObject({
      alto: 5,
      ancho: 5,
      largo: 210,
      kilos: 3.5,
    });
  });

  it('sin peso y espesor definidos, estima cada producto con su madera, su tipo y el embalaje', () => {
    const panel = producto({ ...puerta, codigo: 'PANEL', tipo: 'PUERTA PANEL', madera: 'LENGA' });
    const r = ok(calcularBulto([linea(panel, 1)], parametrosVacios()));
    // 0,85 × 2,00 × 0,045 m × 75 % macizo × 560 kg/m³ ≈ 32,1 kg, más el cartón: 5,5 × 89 × 204 cm embalada.
    expect(r).toMatchObject({ alto: 5.5, ancho: 89, largo: 204, estimado: true });
    expect(r.kilos).toBeGreaterThan(33);
    expect(r.kilos).toBeLessThan(36);
    expect(textoBulto(r)).toMatch(/kg \(estimado, con embalaje\)$/);
    // Una maciza pesa más que una de tableros de la misma madera y medida.
    const bloque = producto({ ...panel, codigo: 'BLOQUE', tipo: 'PUERTA BLOQUE' });
    expect(ok(calcularBulto([linea(bloque, 1)], undefined)).kilos).toBeGreaterThan(r.kilos);
    // Kit de marco 2×4: dos jambas y un dintel atados; 2X8 pesa cerca del doble.
    const kit = ok(calcularBulto([linea(marco, 1)], parametrosVacios()));
    expect(kit.largo).toBeCloseTo(2.1 * 105 + 4, 1);
    expect(kit.kilos).toBeGreaterThan(8);
    expect(kit.kilos).toBeLessThan(16);
    const ancho = producto({ ...marco, codigo: 'MARCO-2X8', medida: '2X8' });
    expect(ok(calcularBulto([linea(ancho, 1)], parametrosVacios())).kilos).toBeGreaterThan(kit.kilos * 1.8);
    // Moldura en cm: 12 × 2 cm × 1 m de lenga ≈ 1,3 kg de madera.
    const moldura = producto({
      codigo: 'END',
      familia: 'MOLDURA',
      madera: 'LENGA',
      medida: '12X2',
      largo: 1,
    });
    const m = ok(calcularBulto([linea(moldura, 1)], parametrosVacios()));
    expect(m.kilos).toBeGreaterThan(1.3);
    expect(m.kilos).toBeLessThan(2);
  });

  it('los valores definidos en Ajustes reemplazan la estimación solo en su familia', () => {
    const r = ok(calcularBulto([linea(puerta, 2), linea(marco, 1)], parametros()));
    // Puertas: 2 × 6 cm y 2 × 30 kg tal cual; el marco, estimado.
    expect(r.estimado).toBe(true);
    expect(r.alto).toBeGreaterThan(12);
    expect(r.kilos).toBeGreaterThan(60);
    expect(ok(calcularBulto([linea(puerta, 2)], parametros()))).toMatchObject({
      alto: 12,
      kilos: 60,
      estimado: false,
    });
    // Con uno solo de los dos datos se estima.
    expect(
      ok(calcularBulto([linea(puerta, 1)], parametros({ PUERTA: { kg: 30, espesorCm: null } }))).estimado,
    ).toBe(true);
  });

  it('sin productos, o con cantidades en cero, no hay nada que despachar', () => {
    expect(calcularBulto([], parametros())).toMatchObject({ ok: false, motivo: 'sin_productos' });
    expect(calcularBulto([linea(puerta, 0)], parametros())).toMatchObject({
      ok: false,
      motivo: 'sin_productos',
    });
  });

  it('una puerta sin ninguna medida no se estima', () => {
    const sinMedidas = producto({ codigo: 'RARA', familia: 'PUERTA', largo: 0 });
    expect(calcularBulto([linea(sinMedidas, 1)], parametros())).toMatchObject({
      ok: false,
      motivo: 'sin_medidas',
    });
  });

  it('las medidas de los ajustes se leen con coma o punto y rechazan lo que no es un número positivo', () => {
    expect(leerMedida('4,5')).toBe(4.5);
    expect(leerMedida(' 4.5 ')).toBe(4.5);
    expect(leerMedida('25')).toBe(25);
    expect(leerMedida('')).toBeNull();
    for (const malo of ['0', '-3', 'abc', '1,2,3', '4,5kg', '1e3']) expect(leerMedida(malo)).toBeNaN();
  });
});

describe('IVA y neto', () => {
  it('el despacho se guarda neto: el valor con IVA dividido por 1,19 y redondeado a pesos', () => {
    expect(IVA_STARKEN).toBe(0.19);
    expect(netoDesdeIva(119)).toBe(100);
    expect(netoDesdeIva(37326)).toBe(31366); // 31.366,39 → baja
    expect(netoDesdeIva(44418)).toBe(37326); // 37.326,05
    expect(netoDesdeIva(10000)).toBe(8403); // 8.403,36
    expect(netoDesdeIva(9999)).toBe(8403); // 8.402,52 → sube
    expect(netoDesdeIva(89250)).toBe(75000);
    expect(netoDesdeIva(101150)).toBe(85000);
    // Parte del valor ya redondeado a pesos: 37.326,6 son $37.327 y su neto, $31.367.
    expect(netoDesdeIva(37326.6)).toBe(netoDesdeIva(37327));
    expect(netoDesdeIva(37326.4)).toBe(netoDesdeIva(37326));
    for (const n of [1, 500, 12345, 99999, 1_000_000]) {
      expect(Number.isSafeInteger(netoDesdeIva(n))).toBe(true);
      // El neto más su IVA (redondeado) queda a un peso de lo que cobra Starken.
      expect(Math.abs(Math.round(netoDesdeIva(n) * 1.19) - n)).toBeLessThanOrEqual(1);
    }
  });

  it('los textos muestran el valor con IVA y el neto', () => {
    expect(textoTarifa({ tipoEntrega: 'DOMICILIO', servicio: 'NORMAL', dias: 3, costoTotal: 101150 })).toBe(
      'Domicilio · 3 días · $101.150 IVA incl. ($85.000 neto)',
    );
    expect(textoTarifa({ tipoEntrega: 'AGENCIA', dias: 1, costoTotal: 1190 })).toBe(
      'Agencia · 1 día · $1.190 IVA incl. ($1.000 neto)',
    );
    expect(textoTarifa({ tipoEntrega: 'AGENCIA', servicio: 'EXPRESS', dias: 1, costoTotal: 1190 })).toContain(
      'Agencia Express',
    );
    expect(
      textoTarifaAplicada({
        tipoEntrega: 'DOMICILIO',
        dias: 3,
        costoTotal: 101150,
        ciudadDestino: 'TEMUCO',
        codigoCiudadDestino: 2,
      }),
    ).toBe(
      'Tarifa Starken aplicada: Domicilio · 3 días · $101.150 IVA incl. ($85.000 neto) · destino TEMUCO (ciudad 2)',
    );
  });
});

// --- Destino -----------------------------------------------------------------------------------------

describe('destino de Starken', () => {
  const unica = (textos: (string | null)[]) => {
    const r = resolverDestino(textos, CIUDADES);
    if (r.estado !== 'unica') throw new Error(`${textos.join(' / ')}: ${r.estado}`);
    return r.ciudad.codigoCiudad;
  };

  it('compara sin distinguir tildes, mayúsculas ni signos', () => {
    expect(normalizarNombre('  ÑUÑOA. ')).toBe('nunoa');
    expect(normalizarNombre('Río  Negro')).toBe('rio negro');
    for (const escrito of ['Ñuñoa', 'ÑUÑOA', 'nunoa', 'ñuñoa ', 'Nuñoa']) expect(unica([escrito])).toBe(1);
    expect(unica(['Maipú'])).toBe(1);
    expect(unica(['rio negro'])).toBe(31);
    expect(unica(['TEMUCO'])).toBe(2);
    expect(unica(['padre las casas'])).toBe(2);
  });

  it('reconoce la comuna dentro de una dirección o de un texto más largo', () => {
    expect(unica(['Av. Alemania 123, Villarrica'])).toBe(3);
    expect(unica(['Villarrica, Región de la Araucanía'])).toBe(3);
    expect(unica(['Camino a Valdivia km 4 - Valdivia'])).toBe(40);
    expect(unica(['Parcela 5 Padre Las Casas'])).toBe(2);
    // Varios nombres que caen en la misma ciudad no son ambigüedad.
    expect(unica(['Fundo El Roble Padre Las Casas Temuco'])).toBe(2);
    // Un nombre contenido en otro más largo no cuenta aparte: «San Pedro» dentro de «San Pedro de la Paz».
    const pedro = [ciudad(50, 'SAN PEDRO'), ciudad(51, 'SAN PEDRO DE LA PAZ'), ciudad(52, 'CONCEPCION')];
    const r = resolverDestino(['Villa Norte San Pedro de la Paz'], pedro);
    expect(r.estado === 'unica' && r.ciudad.codigoCiudad).toBe(51);
  });

  it('si el texto nombra ciudades distintas no se adivina: se pide elegir', () => {
    // Sin comas no hay segmentos: «Santiago» (calle) y «Temuco» (ciudad) son dos ciudades posibles.
    const r = resolverDestino(['Pasaje Santiago 123 Temuco'], CIUDADES);
    expect(r.estado).toBe('ambigua');
    expect(r.estado === 'ambigua' && r.candidatas.map((c) => c.codigoCiudad).sort()).toEqual([1, 2]);
    expect(resolverDestino(['Osorno Valdivia'], CIUDADES)).toMatchObject({ estado: 'ambigua' });
    // Con una coma, la última parte es la comuna y manda, como en una dirección.
    const ok = resolverDestino(['Pasaje Santiago 123, Temuco'], CIUDADES);
    expect(ok.estado === 'unica' && ok.ciudad.codigoCiudad).toBe(2);
    // Una comuna contenida en varias ciudades sin ciudad homónima también queda en duda.
    expect(resolverDestino(['Parcela 4 San Pablo'], CIUDADES)).toMatchObject({ estado: 'ambigua' });
  });

  it('una comuna repetida en varias ciudades es ambigua, salvo que una ciudad se llame igual', () => {
    const r = resolverDestino(['San Pablo'], CIUDADES);
    expect(r).toMatchObject({ estado: 'ambigua' });
    expect(r.estado === 'ambigua' && r.candidatas.map((c) => c.codigoCiudad)).toEqual([30, 31]);
    // «San Carlos» está en SAN CARLOS y en CHILLAN: la ciudad que se llama igual es la correcta.
    expect(unica(['San Carlos'])).toBe(20);
  });

  it('sin coincidencia se pide elegir; los textos vacíos no cuentan', () => {
    expect(resolverDestino(['Atlantis'], CIUDADES)).toEqual({ estado: 'no_encontrada' });
    expect(resolverDestino([null, undefined, '', '  '], CIUDADES)).toEqual({ estado: 'no_encontrada' });
    expect(resolverDestino(['Temuco'], [])).toEqual({ estado: 'no_encontrada' });
    // Un nombre muy corto dentro del texto no basta para adivinar.
    expect(resolverDestino(['Calle Sur 12'], [ciudad(9, 'SUR')])).toEqual({ estado: 'no_encontrada' });
  });

  it('el destino del despacho manda sobre la comuna del cliente; uno desconocido pasa a la comuna', () => {
    expect(unica(['Valdivia', 'Temuco'])).toBe(40);
    expect(unica(['Atlantis', 'Temuco'])).toBe(2);
    expect(unica([null, 'Temuco'])).toBe(2);
    expect(resolverDestino(['Atlantis', 'Nunca Jamás'], CIUDADES)).toEqual({ estado: 'no_encontrada' });
  });

  it('un destino dudoso no se cambia en silencio por la comuna del cliente: solo una candidata lo resuelve', () => {
    // «San Pablo» es dudoso y Temuco no es una de sus candidatas: se pide elegir.
    expect(resolverDestino(['San Pablo', 'Temuco'], CIUDADES)).toMatchObject({ estado: 'ambigua' });
    expect(resolverDestino(['San Pablo', null], CIUDADES)).toMatchObject({ estado: 'ambigua' });
    expect(resolverDestino(['Atlantis', 'San Pablo'], CIUDADES)).toMatchObject({ estado: 'ambigua' });
    // Si la comuna del cliente es una de las candidatas, desempata.
    expect(unica(['San Pablo', 'Osorno'])).toBe(30);
    expect(unica(['San Pablo', 'Río Negro'])).toBe(31);
  });

  it('la búsqueda de la lista encuentra por ciudad o comuna, sin tildes, y ordena lo más parecido primero', () => {
    const nombres = (q: string) => buscarCiudades(q, CIUDADES).map((c) => c.nombre);
    expect(nombres('chil')).toEqual(['CHILLAN']);
    expect(nombres('ñuñoa')).toEqual(['SANTIAGO']);
    expect(nombres('NUNOA')).toEqual(['SANTIAGO']);
    expect(nombres('san')).toEqual(['SAN CARLOS', 'SANTIAGO', 'CHILLAN', 'OSORNO', 'RIO NEGRO']);
    expect(nombres('zzz')).toEqual([]);
    expect(buscarCiudades('', CIUDADES, 3)).toHaveLength(3);
  });
});

// --- Servicio: cotizar el envío y aplicar la tarifa --------------------------------------------------

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

const catalogo = (): Catalogo => ({
  fuente: 'test',
  sha256: 'test',
  fecha: '2026-01-01',
  productos: [puerta],
});
const molco = (cantidad: number): SolicitudItem => ({
  modelo: 'MOLCO',
  madera: 'PINO OREGON',
  ancho: 0.82,
  alto: 2,
  medida: null,
  cantidad,
});

async function setup(comuna: string | null = 'Temuco') {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-starken-'));
  dirs.push(dir);
  const almacen = new Almacen(dir);
  const llm = {
    interpretar: vi.fn().mockResolvedValue({
      name: 'actualizar_cotizacion',
      input: { items: [molco(3)], cliente: { ...clienteVacio(), nombre: 'Juan Pérez', comuna } },
    }),
  };
  const servicio = new Servicio(catalogo(), llm, almacen, { nombre: 'Paula', email: 'paula@neltume.cl' });
  const db = almacen.baseDatos();
  const borrador = async () => (await servicio.ejecutar({ tipo: 'chat', mensaje: 'Cotiza' })).cotizacion;
  const editar = async (q: Cotizacion, cambios: Record<string, unknown>) =>
    (await servicio.ejecutar({ tipo: 'editar', id: q.id, actualizada: q.actualizada, ...cambios } as never))
      .cotizacion;
  const detalles = (q: Cotizacion) => almacen.eventos(q.id).map((e) => e.detalle ?? '');
  const espia = vi.fn(fetchFijo);
  const starken = new ClienteStarken(ENTORNO_FIJO, { fetch: espia, cache: nuevoCacheCiudades() });
  const configuracion = (p = parametros({ PUERTA: { kg: 25, espesorCm: 4.5 } })) => ({
    origen: { codigoCiudad: 1, nombre: 'SANTIAGO' },
    paquete: p,
  });
  return { dir, almacen, db, servicio, borrador, editar, detalles, espia, starken, configuracion };
}

describe('cotizar el despacho de una cotización con Starken', () => {
  it('arma el bulto con las líneas guardadas, resuelve la comuna del cliente y devuelve agencia y domicilio', async () => {
    const { borrador, starken, configuracion, espia } = await setup('Temuco');
    const q = await borrador();
    const r = await cotizarEnvioStarken(q, undefined, configuracion(), starken);
    if (r.estado !== 'tarifas') throw new Error(r.estado);
    // 3 puertas × 4,5 cm = 13,5 cm; ancho 85 (la referencia supera los 82 pedidos); largo 200; 75 kg.
    expect(r.bulto).toMatchObject({ alto: 13.5, ancho: 85, largo: 200, kilos: 75 });
    expect(r.textoBulto).toBe('3 puertas · 1 línea · total 13,5 × 85 × 200 cm, 75 kg');
    expect(r.destino).toEqual({ codigoCiudad: 2, nombre: 'TEMUCO' });
    expect(r.tarifas.map((t) => [t.tipoEntrega, t.dias, t.costoTotal, t.neto])).toEqual([
      ['AGENCIA', 2, 89250, 75000],
      ['DOMICILIO', 3, 101150, 85000],
    ]);
    const tarifas = espia.mock.calls.find(([url]) => String(url).endsWith('consultarTarifas'));
    expect(JSON.parse(String(tarifas?.[1]?.body))).toMatchObject({
      codigoCiudadOrigen: 1,
      codigoCiudadDestino: 2,
      alto: 13.5,
      ancho: 85,
      largo: 200,
      kilos: 75,
    });
  });

  it('el destino del despacho gana a la comuna del cliente; uno dudoso o desconocido pide elegir la ciudad', async () => {
    const { borrador, editar, starken, configuracion } = await setup('Temuco');
    let q = await borrador();
    q = await editar(q, { despacho: { destino: 'Valdivia' } });
    expect(await cotizarEnvioStarken(q, undefined, configuracion(), starken)).toMatchObject({
      estado: 'tarifas',
      destino: { codigoCiudad: 40 },
    });
    q = await editar(q, {
      despacho: { destino: 'Av. Los Lagos 10, San Pablo' },
      cliente: { comuna: 'Atlantis' },
    });
    const dudoso = await cotizarEnvioStarken(q, undefined, configuracion(), starken);
    expect(dudoso).toMatchObject({ estado: 'elegir_ciudad', motivo: 'ambigua' });
    expect(dudoso.estado === 'elegir_ciudad' && dudoso.candidatas.map((c) => c.nombre)).toEqual([
      'OSORNO',
      'RIO NEGRO',
    ]);
    q = await editar(q, { despacho: { destino: 'Atlantis' } });
    expect(await cotizarEnvioStarken(q, undefined, configuracion(), starken)).toEqual({
      estado: 'elegir_ciudad',
      motivo: 'no_encontrada',
      candidatas: [],
    });
    // Elegida a mano (código de la lista), se cotiza; uno que no existe se rechaza.
    expect(await cotizarEnvioStarken(q, 31, configuracion(), starken)).toMatchObject({
      estado: 'tarifas',
      destino: { codigoCiudad: 31, nombre: 'RIO NEGRO' },
    });
    await expect(cotizarEnvioStarken(q, 12345, configuracion(), starken)).rejects.toMatchObject({
      codigo: 'destino',
    });
  });

  it('un destino sin cobertura devuelve el mensaje de Starken', async () => {
    const { borrador, starken, configuracion } = await setup('Temuco');
    await expect(cotizarEnvioStarken(await borrador(), 99, configuracion(), starken)).rejects.toMatchObject({
      codigo: 'rechazado',
      message: 'Starken: El destino no tiene cobertura.',
    });
  });

  it('sin configurar o sin origen no consulta a Starken', async () => {
    const { borrador, starken, configuracion, espia } = await setup();
    const q = await borrador();
    await expect(cotizarEnvioStarken(q, undefined, configuracion(), null)).rejects.toMatchObject({
      codigo: 'no_configurado',
      message: 'Starken no está configurado',
    });
    await expect(
      cotizarEnvioStarken(q, undefined, { ...configuracion(), origen: null }, starken),
    ).rejects.toThrow('ciudad de origen');
    expect(espia).not.toHaveBeenCalled();
  });

  it('con ítems pendientes el bulto quedaría incompleto: pide completarlos', async () => {
    const { borrador, starken, configuracion } = await setup();
    const q = await borrador();
    const conPendiente = {
      ...q,
      incompletos: [{ indice: 1, rechazo: { tipo: 'modelo' } as never, pregunta: '¿Cuál?' }],
    };
    await expect(cotizarEnvioStarken(conPendiente, undefined, configuracion(), starken)).rejects.toThrow(
      'ítems pendientes',
    );
  });
});

describe('aplicar la tarifa elegida', () => {
  type Entorno = Awaited<ReturnType<typeof setup>>;
  /**
   * La tarifa tal como la entrega /api/starken/cotizar (firmada por el servidor para esa cotización) y su neto.
   * `ahora` permite firmarla en otro momento, para probar el vencimiento.
   */
  async function elegir(e: Entorno, q: Cotizacion, tipo = 'DOMICILIO', ahora?: number) {
    const r = await cotizarEnvioStarken(q, undefined, e.configuracion(), e.starken, ahora);
    if (r.estado !== 'tarifas') throw new Error(r.estado);
    const t = r.tarifas.find((x) => x.tipoEntrega === tipo)!;
    return {
      neto: t.neto,
      tarifa: {
        tipoEntrega: t.tipoEntrega,
        servicio: t.servicio,
        dias: t.dias,
        costoTotal: t.costoTotal,
        ciudadDestino: r.destino.nombre,
        codigoCiudadDestino: r.destino.codigoCiudad,
        vence: t.vence,
        firma: t.firma,
      },
    };
  }
  async function conStarken() {
    const e = await setup();
    let q = await e.borrador();
    q = await e.editar(q, { despacho: { transporte: 'Starken' } });
    return { ...e, q };
  }

  it('fija el valor de despacho neto, recalcula los montos y deja la tarifa en la actividad', async () => {
    const e = await conStarken();
    let q = e.q;
    expect(q.flete).toBe(0);
    const { tarifa, neto } = await elegir(e, q);
    q = await e.editar(q, { despacho: { valor: neto }, tarifaStarken: tarifa });
    expect(q.flete).toBe(85000);
    expect(q.despacho).toMatchObject({ transporte: 'Starken', valor: 85000 });
    expect(q.montos.flete).toBe(85000);
    expect(q.montos.neto).toBe(q.montos.subtotal - q.montos.descuento + 85000);
    const actividad = e.detalles(q).at(-1)!;
    expect(actividad).toContain('Flete $0 → $85.000');
    expect(actividad).toContain(
      'Tarifa Starken aplicada: Domicilio · 3 días · $101.150 IVA incl. ($85.000 neto) · destino TEMUCO (ciudad 2)',
    );
    // La firma no se copia a la actividad.
    expect(actividad).not.toContain(tarifa.firma);
    // El valor se sigue pudiendo corregir a mano.
    q = await e.editar(q, { despacho: { valor: 90000 } });
    expect(q.flete).toBe(90000);
    expect(e.detalles(q).at(-1)).not.toContain('Starken');
  });

  it('la tarifa queda en la actividad aunque el valor ya fuera ese', async () => {
    const e = await conStarken();
    let q = await e.editar(e.q, { despacho: { valor: 85000 } });
    const eventos = e.detalles(q).length;
    const { tarifa } = await elegir(e, q);
    q = await e.editar(q, { despacho: { valor: 85000 }, tarifaStarken: tarifa });
    expect(e.detalles(q)).toHaveLength(eventos + 1);
    expect(e.detalles(q).at(-1)).toContain('Tarifa Starken aplicada');
  });

  it('rechaza una tarifa cuyo neto no es el valor de despacho, o sin Starken como transportista', async () => {
    const e = await conStarken();
    let q = e.q;
    const { tarifa } = await elegir(e, q);
    const antes = e.detalles(q).length;
    await expect(e.editar(q, { despacho: { valor: 70000 }, tarifaStarken: tarifa })).rejects.toThrow(
      'El valor de despacho debe ser el neto de la tarifa elegida ($85.000).',
    );
    // Sin valor nuevo tampoco: el actual ($0) no es el neto de la tarifa.
    await expect(e.editar(q, { tarifaStarken: tarifa })).rejects.toThrow('neto de la tarifa');
    q = await e.editar(q, { despacho: { transporte: 'Transportes Paredes' } });
    await expect(e.editar(q, { despacho: { valor: 85000 }, tarifaStarken: tarifa })).rejects.toThrow(
      'Elige Starken como transportista',
    );
    expect(e.detalles(q).length).toBe(antes + 1);
  });

  it('rechaza una tarifa falsificada: el costo, el destino o cualquier dato distinto del firmado', async () => {
    const e = await conStarken();
    const q = e.q;
    const { tarifa } = await elegir(e, q);
    const antes = e.detalles(q).length;
    const falla = async (alterada: Record<string, unknown>, valor: number) => {
      await expect(
        e.editar(q, { despacho: { valor }, tarifaStarken: { ...tarifa, ...alterada } }),
      ).rejects.toThrow('La tarifa de Starken no es válida para esta cotización');
    };
    // Un costo menor con su neto coherente: lo que haría quien edite la petición para abaratar el despacho.
    await falla({ costoTotal: 11900 }, netoDesdeIva(11900));
    await falla({ costoTotal: 1 }, 1);
    await falla({ dias: 1 }, 85000);
    await falla({ tipoEntrega: 'AGENCIA' }, 85000);
    await falla({ servicio: 'EXPRESS' }, 85000);
    await falla({ ciudadDestino: 'SANTIAGO' }, 85000);
    await falla({ codigoCiudadDestino: 1 }, 85000);
    // Ni alargar su vigencia ni inventar la firma.
    await falla({ vence: new Date(Date.now() + 10 * 86_400_000).toISOString() }, 85000);
    await falla({ firma: 'A'.repeat(43) }, 85000);
    await falla({ firma: 'no es una firma' }, 85000);
    await falla({ firma: '' }, 85000);
    await falla({ firma: undefined }, 85000);
    // Nada cambió: ni el valor ni la actividad.
    expect(e.almacen.obtener(q.id)!.flete).toBe(0);
    expect(e.detalles(q)).toHaveLength(antes);
  });

  it('rechaza la firma de otra cotización, aunque sea idéntica', async () => {
    const e = await conStarken();
    const otra = await e.borrador();
    const { tarifa, neto } = await elegir(e, otra);
    await expect(e.editar(e.q, { despacho: { valor: neto }, tarifaStarken: tarifa })).rejects.toThrow(
      'no es válida para esta cotización',
    );
    // En la cotización para la que se firmó sí vale (con su transportista).
    const de = await e.editar(otra, { despacho: { transporte: 'Starken' } });
    const aplicada = await e.editar(de, { despacho: { valor: neto }, tarifaStarken: tarifa });
    expect(aplicada.flete).toBe(85000);
  });

  it('una tarifa vence a los 15 minutos: hay que volver a cotizar', async () => {
    const e = await conStarken();
    const ahora = Date.now();
    const vencida = await elegir(e, e.q, 'DOMICILIO', ahora - VIGENCIA_FIRMA_MS - 1000);
    await expect(
      e.editar(e.q, { despacho: { valor: vencida.neto }, tarifaStarken: vencida.tarifa }),
    ).rejects.toThrow('La tarifa de Starken venció. Vuelve a cotizar el despacho.');
    // Todavía vigente (un minuto antes de vencer): se acepta.
    const vigente = await elegir(e, e.q, 'DOMICILIO', ahora - VIGENCIA_FIRMA_MS + 60_000);
    const q = await e.editar(e.q, { despacho: { valor: vigente.neto }, tarifaStarken: vigente.tarifa });
    expect(q.flete).toBe(85000);
  });

  it('se aplica sobre la revisión que crea editar una cotización emitida', async () => {
    const e = await conStarken();
    const emitida = (await e.servicio.ejecutar({ tipo: 'emitir', id: e.q.id, actualizada: e.q.actualizada }))
      .cotizacion;
    // Editar una emitida abre una revisión en borrador: la tarifa, firmada para la emitida, se aplica ahí.
    const { tarifa, neto } = await elegir(e, emitida);
    const r = await e.servicio.ejecutar({
      tipo: 'editar',
      id: emitida.id,
      actualizada: emitida.actualizada,
      despacho: { valor: neto },
      tarifaStarken: tarifa,
    });
    expect(r.cotizacion.id).not.toBe(emitida.id);
    expect(r.cotizacion.flete).toBe(85000);
    expect(emitida.flete).toBe(0);
  });
});

describe('firma de tarifas', () => {
  const datos = {
    tipoEntrega: 'DOMICILIO',
    servicio: 'NORMAL',
    dias: 3,
    costoTotal: 101150,
    ciudadDestino: 'TEMUCO',
    codigoCiudadDestino: 2,
  };
  const ID = '0b9b1f0e-6d0a-4a51-8f5e-1a2b3c4d5e6f';

  it('la firma liga la tarifa a la cotización y vence a los 15 minutos', () => {
    const ahora = 1_800_000_000_000;
    const { vence, firma } = firmarTarifa(ID, datos, ahora);
    expect(vence).toBe(new Date(ahora + VIGENCIA_FIRMA_MS).toISOString());
    const aplicada = { ...datos, vence, firma };
    expect(verificarTarifa(ID, aplicada, ahora)).toBe('valida');
    expect(verificarTarifa(ID, aplicada, ahora + VIGENCIA_FIRMA_MS)).toBe('valida');
    expect(verificarTarifa(ID, aplicada, ahora + VIGENCIA_FIRMA_MS + 1)).toBe('vencida');
    expect(verificarTarifa(ID.replace('0b9b', '1c9b'), aplicada, ahora)).toBe('invalida');
    expect(verificarTarifa(ID, { ...aplicada, costoTotal: 1190 }, ahora)).toBe('invalida');
    expect(verificarTarifa(ID, { ...aplicada, vence: new Date(ahora + 1e9).toISOString() }, ahora)).toBe(
      'invalida',
    );
    expect(verificarTarifa(ID, { ...aplicada, vence: 'mañana' }, ahora)).toBe('invalida');
    // Una firma mal formada nunca hace fallar la verificación: es simplemente inválida.
    for (const mala of ['', '!!!', 'A', firma.slice(1), firma + 'A', undefined as unknown as string])
      expect(verificarTarifa(ID, { ...aplicada, firma: mala }, ahora)).toBe('invalida');
  });

  it('el servicio opcional forma parte de lo firmado', () => {
    const ahora = 1_800_000_000_000;
    const sin = { ...datos, servicio: undefined };
    const { vence, firma } = firmarTarifa(ID, sin, ahora);
    expect(verificarTarifa(ID, { ...sin, vence, firma }, ahora)).toBe('valida');
    expect(verificarTarifa(ID, { ...datos, vence, firma }, ahora)).toBe('invalida');
  });

  it('usa una clave derivada de BETTER_AUTH_SECRET: con otro secreto la firma no vale', () => {
    vi.stubEnv('BETTER_AUTH_SECRET', 'secreto-uno-0123456789abcdef-0123456789');
    const { vence, firma } = firmarTarifa(ID, datos);
    const aplicada = { ...datos, vence, firma };
    expect(verificarTarifa(ID, aplicada)).toBe('valida');
    vi.stubEnv('BETTER_AUTH_SECRET', 'secreto-dos-0123456789abcdef-0123456789');
    expect(verificarTarifa(ID, aplicada)).toBe('invalida');
    // La firma no deja ver el secreto ni se le parece.
    expect(firma).not.toContain('secreto');
  });

  it('sin secreto (desarrollo) usa una clave propia del proceso, estable mientras corra', () => {
    vi.stubEnv('BETTER_AUTH_SECRET', '');
    const { vence, firma } = firmarTarifa(ID, datos);
    expect(verificarTarifa(ID, { ...datos, vence, firma })).toBe('valida');
    // Un secreto demasiado corto tampoco se usa.
    vi.stubEnv('BETTER_AUTH_SECRET', 'corto');
    expect(verificarTarifa(ID, { ...datos, vence, firma })).toBe('valida');
  });
});

describe('configuración guardada', () => {
  const vacia = { origen: null, paquete: parametrosVacios() };
  const invalido = (valor: unknown) => configuracionStarkenSchema.safeParse(valor);
  const mensaje = (valor: unknown) => {
    const r = invalido(valor);
    return r.success ? null : mensajeErrorConfiguracion(r.error);
  };
  const familia = (kg: unknown, espesorCm: unknown) => ({
    origen: null,
    paquete: { ...parametrosVacios(), PUERTA: { kg, espesorCm } },
  });

  it('parte vacía (no se inventan pesos) y se guarda lo que se valida', async () => {
    const { db } = await setup();
    expect(leerConfiguracionStarken(db)).toEqual(vacia);
    const guardada = guardarConfiguracionStarken(
      {
        origen: { codigoCiudad: 1, nombre: 'SANTIAGO' },
        paquete: parametros({ MARCO: { kg: 3.5, espesorCm: 5 } }),
      },
      db,
    );
    expect(leerConfiguracionStarken(db)).toEqual(guardada);
    expect(leerConfiguracionStarken(db).paquete.PUERTA).toEqual({ kg: 30, espesorCm: 6 });
    expect(leerConfiguracionStarken(db).paquete.MOLDURA).toEqual({ kg: null, espesorCm: null });
    expect(estadoStarken(db).configuracion).toEqual(guardada);
  });

  it('un cuerpo vacío o a medias no vale: no puede borrar la configuración', () => {
    expect(invalido({}).success).toBe(false);
    expect(invalido({ origen: null }).success).toBe(false);
    expect(invalido({ paquete: parametrosVacios() }).success).toBe(false);
    expect(invalido({ origen: null, paquete: {} }).success).toBe(false);
    expect(invalido({ origen: null, paquete: { PUERTA: { kg: 30, espesorCm: 6 } } }).success).toBe(false);
    expect(invalido({ origen: null, paquete: { ...parametrosVacios(), PUERTA: { kg: 30 } } }).success).toBe(
      false,
    );
    expect(invalido(null).success).toBe(false);
    expect(invalido(vacia).success).toBe(true);
    expect(mensaje({})).toContain('Configuración incompleta o inválida');
  });

  it('cada regla del peso y del espesor tiene su propio mensaje, con la familia por delante', () => {
    expect(mensaje(familia(-1, 6))).toBe('Puertas: El peso por unidad debe ser mayor que cero.');
    expect(mensaje(familia(0, 6))).toBe('Puertas: El peso por unidad debe ser mayor que cero.');
    expect(mensaje(familia('30', 6))).toBe('Puertas: El peso por unidad debe ser un número.');
    expect(mensaje(familia(2001, 6))).toBe('Puertas: El peso por unidad no puede superar 2.000 kg.');
    expect(mensaje(familia(30, -1))).toBe('Puertas: El espesor debe ser mayor que cero.');
    expect(mensaje(familia(30, 'grueso'))).toBe('Puertas: El espesor debe ser un número.');
    expect(mensaje(familia(30, 301))).toBe('Puertas: El espesor no puede superar 300 cm.');
    expect(mensaje(familia(30, null))).toBe('Puertas: Completa el peso y el espesor, o deja ambos vacíos.');
    expect(mensaje(familia(null, 6))).toBe('Puertas: Completa el peso y el espesor, o deja ambos vacíos.');
    expect(mensaje({ origen: { codigoCiudad: 0, nombre: 'X' }, paquete: parametrosVacios() })).toBe(
      'El código de la ciudad de origen no es válido.',
    );
    expect(
      mensaje({ origen: null, paquete: { ...parametrosVacios(), SOFA: { kg: 1, espesorCm: 1 } } }),
    ).toContain('Configuración incompleta o inválida');
    expect(invalido(familia(2000, 300)).success).toBe(true);
  });

  it('una configuración guardada ilegible se trata como vacía', async () => {
    const { db } = await setup();
    db.prepare('INSERT INTO ajustes (clave, valor_json, actualizada) VALUES (?, ?, ?)').run(
      'starken',
      '{no es json',
      new Date().toISOString(),
    );
    expect(leerConfiguracionStarken(db)).toEqual(vacia);
  });
});

describe('guardar los ajustes verificando el origen', () => {
  const solicitud = (nombre: string, codigoCiudad = 1) => ({
    origen: { codigoCiudad, nombre },
    paquete: parametros(),
  });

  it('el nombre del origen es el de la lista de Starken, no el que envía el navegador', async () => {
    const { db, starken, espia } = await setup();
    const guardada = await guardarAjustesStarken(solicitud('NOMBRE INVENTADO'), db, starken);
    expect(guardada.origen).toEqual({ codigoCiudad: 1, nombre: 'SANTIAGO' });
    expect(leerConfiguracionStarken(db).origen).toEqual({ codigoCiudad: 1, nombre: 'SANTIAGO' });
    expect(espia.mock.calls.some(([url]) => String(url).endsWith('listarCiudadesOrigen'))).toBe(true);
  });

  it('si el origen no cambió, conserva la entrada guardada y no consulta a Starken', async () => {
    const { db, starken, espia } = await setup();
    await guardarAjustesStarken(solicitud('x'), db, starken);
    espia.mockClear();
    // Sin conexión con Starken (cliente nulo) también guarda, y el nombre sigue siendo el guardado.
    const otra = await guardarAjustesStarken(solicitud('OTRO NOMBRE'), db, null);
    expect(otra.origen).toEqual({ codigoCiudad: 1, nombre: 'SANTIAGO' });
    expect(espia).not.toHaveBeenCalled();
  });

  it('rechaza un origen que no está en Starken y no guarda nada', async () => {
    const { db, starken } = await setup();
    await expect(guardarAjustesStarken(solicitud('X', 77), db, starken)).rejects.toThrow(
      'La ciudad de origen no está entre las ciudades de Starken.',
    );
    expect(leerConfiguracionStarken(db).origen).toBeNull();
    // Sin Starken configurado no hay con qué verificar un origen nuevo.
    await expect(guardarAjustesStarken(solicitud('SANTIAGO'), db, null)).rejects.toMatchObject({
      codigo: 'no_configurado',
    });
    // Quitar el origen sí se puede siempre.
    const sin = await guardarAjustesStarken({ origen: null, paquete: parametros() }, db, null);
    expect(sin.origen).toBeNull();
  });
});

describe('Starken simulado de pruebas', () => {
  it('rechaza credenciales incorrectas y calcula las tarifas según el peso', async () => {
    const mal = await fetchFijo('https://starken.fijo.test/rest/listarCiudadesDestino', {
      headers: { rut: 'x', clave: 'y' },
    });
    expect(mal.status).toBe(401);
    const c = new ClienteStarken(ENTORNO_FIJO, { fetch: fetchFijo, cache: nuevoCacheCiudades() });
    const [agencia, domicilio] = await c.consultarTarifas({
      origen: 1,
      destino: 2,
      bulto: { ...BULTO, kilos: 10 },
    });
    expect([agencia.neto, domicilio.neto]).toEqual([10000, 20000]);
    expect((await c.listarCiudades('origen')).map((x) => x.nombre)).toEqual([
      'SANTIAGO',
      'TEMUCO',
      'VALDIVIA',
    ]);
  });
});
