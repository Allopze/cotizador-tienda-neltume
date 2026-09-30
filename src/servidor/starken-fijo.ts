// Starken simulado, exclusivo de pruebas (NELTUME_STARKEN=fijo con NELTUME_TEST_MODE=1). No se selecciona desde
// la petición del navegador ni llama a la red: responde con el mismo formato que el servicio real.
import type { EntornoStarken } from './starken';

export const ENTORNO_FIJO: EntornoStarken = {
  url: 'https://starken.fijo.test/rest',
  rut: 'e2e-rut',
  clave: 'e2e-clave',
  cuentaCorriente: '123456',
  cuentaCorrienteDV: 'K',
  rutCliente: null,
};

const ciudad = (codigoCiudad: number, nombreCiudad: string, ...comunas: string[]) => ({
  codigoCiudad,
  codigoRegion: 1,
  codigoZonaGeografica: 1,
  nombreCiudad,
  listaComunas: (comunas.length ? comunas : [nombreCiudad]).map((nombreComuna, i) => ({
    codigoComuna: codigoCiudad * 100 + i,
    nombreComuna,
  })),
});
const ORIGEN = [ciudad(1, 'SANTIAGO'), ciudad(2, 'TEMUCO'), ciudad(40, 'VALDIVIA')];
export const DESTINO_SIN_COBERTURA = 99;
const DESTINO = [
  ciudad(1, 'SANTIAGO', 'SANTIAGO', 'PROVIDENCIA', 'ÑUÑOA', 'MAIPU', 'LAS CONDES'),
  ciudad(2, 'TEMUCO', 'TEMUCO', 'PADRE LAS CASAS'),
  ciudad(3, 'VILLARRICA'),
  ciudad(20, 'SAN CARLOS'),
  ciudad(21, 'CHILLAN', 'CHILLAN', 'SAN CARLOS'),
  // «SAN PABLO» figura en dos ciudades y ninguna se llama así: hay que elegir.
  ciudad(30, 'OSORNO', 'OSORNO', 'SAN PABLO'),
  ciudad(31, 'RIO NEGRO', 'RIO NEGRO', 'SAN PABLO'),
  ciudad(40, 'VALDIVIA'),
  ciudad(DESTINO_SIN_COBERTURA, 'PUERTO WILLIAMS'),
];

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Las tarifas dependen del peso, para poder comprobar desde la prueba que el bulto llegó bien: agencia =
 * kilos × $1.000 neto; domicilio, $10.000 más. Con IVA: × 1,19.
 */
export async function fetchFijo(entrada: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(
    typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url,
  );
  const cabeceras = new Headers(init?.headers);
  if (cabeceras.get('rut') !== ENTORNO_FIJO.rut || cabeceras.get('clave') !== ENTORNO_FIJO.clave)
    return json({ codigoRespuesta: 0, mensajeRespuesta: 'Credenciales inválidas.' }, 401);
  const metodo = url.pathname.split('/').pop();
  if (metodo === 'listarCiudadesOrigen')
    return json({
      type: 'listarCiudadesOrigenRespuesta',
      codigoRespuesta: 1,
      mensajeRespuesta: 'Busqueda Exitosa.',
      listaCiudadesOrigen: ORIGEN,
    });
  if (metodo === 'listarCiudadesDestino')
    return json({
      type: 'listarCiudadesDestinoRespuesta',
      codigoRespuesta: 1,
      mensajeRespuesta: 'Busqueda Exitosa.',
      listaCiudadesDestino: DESTINO,
    });
  if (metodo !== 'consultarTarifas')
    return json({ codigoRespuesta: 0, mensajeRespuesta: 'Método desconocido.' }, 404);
  const c = JSON.parse(String(init?.body ?? '{}')) as Record<string, number | string | undefined>;
  if (c.codigoCiudadDestino === DESTINO_SIN_COBERTURA)
    return json({
      type: 'consultarTarifasRespuesta',
      codigoRespuesta: 0,
      mensajeRespuesta: 'El destino no tiene cobertura.',
    });
  const kilos = Number(c.kilos);
  if (
    !ORIGEN.some((o) => o.codigoCiudad === c.codigoCiudadOrigen) ||
    !DESTINO.some((d) => d.codigoCiudad === c.codigoCiudadDestino) ||
    !(kilos > 0)
  )
    return json({
      type: 'consultarTarifasRespuesta',
      codigoRespuesta: 0,
      mensajeRespuesta: 'Datos de la consulta inválidos.',
    });
  const tarifa = (codigo: number, descripcion: 'AGENCIA' | 'DOMICILIO', neto: number, dias: number) => ({
    costoTotal: Math.round(neto * 1.19),
    diasEntrega: dias,
    tipoEntrega: { codigoTipoEntrega: codigo, descripcionTipoEntrega: descripcion },
    tipoServicio: { codigoTipoServicio: 0, descripcionTipoServicio: 'NORMAL' },
  });
  return json({
    type: 'consultarCoberturaRespuesta',
    codigoRespuesta: 1,
    mensajeRespuesta: 'Busqueda exitosa.',
    listaTarifas: [tarifa(1, 'AGENCIA', kilos * 1000, 2), tarifa(2, 'DOMICILIO', kilos * 1000 + 10000, 3)],
  });
}
