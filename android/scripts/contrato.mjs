// Contrato de respuestas para la app de Android: recorre el guion de cinco minutos contra el servidor de pruebas
// (android/scripts/servidor-pruebas.sh, IA y Starken simulados) y guarda las respuestas reales en
// android/nucleo/src/test/resources/contrato/respuestas/. Las pruebas Kotlin (ContratoTest) las leen con los modelos de
// la app: si el servidor cambia una forma, falla Kotlin. Uso, con el servidor de pruebas corriendo:
//   node android/scripts/contrato.mjs            (o NELTUME_MOVIL_PUERTO=3102)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const base = `http://127.0.0.1:${process.env.NELTUME_MOVIL_PUERTO ?? '3102'}`;
const destino = join(dirname(fileURLToPath(import.meta.url)), '../nucleo/src/test/resources/contrato/respuestas');
mkdirSync(destino, { recursive: true });

let galletas = '';
async function pedir(ruta, { metodo = 'GET', cuerpo } = {}) {
  const r = await fetch(base + ruta, {
    method: metodo,
    headers: {
      ...(galletas ? { Cookie: galletas } : {}),
      ...(cuerpo ? { 'Content-Type': 'application/json', Origin: base } : {}),
      'User-Agent': 'NeltumeCotizador/contrato (Android 16; Pruebas)',
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const nuevas = r.headers.getSetCookie?.() ?? [];
  if (nuevas.length) galletas = nuevas.map((c) => c.split(';')[0]).join('; ');
  const texto = await r.text();
  const json = texto ? JSON.parse(texto) : null;
  if (!r.ok) throw new Error(`${metodo} ${ruta} → ${r.status} ${texto.slice(0, 300)}`);
  return json;
}
/**
 * Lo que no debe quedar en el repo: el token de la sesión de prueba y los datos de la empresa que el servidor de
 * pruebas toma de .env.local. Se reemplazan por valores de ejemplo con la misma forma.
 */
function limpiar(nombre, datos) {
  if (nombre === 'sesion' && datos?.session) datos.session = { ...datos.session, token: 'token-de-prueba', ipAddress: '127.0.0.1' };
  if (nombre === 'configuracion-negocio' && datos?.configuracion?.empresa)
    datos.configuracion.empresa = {
      ...datos.configuracion.empresa,
      nombre: 'Empresa de ejemplo', rut: '11.111.111-1', direccion: 'Calle de ejemplo 123', telefono: '+56 9 0000 0000',
      correo: 'contacto@example.cl', web: 'www.example.cl',
    };
  return datos;
}
const guardar = (nombre, datos) => {
  datos = limpiar(nombre, datos);
  writeFileSync(join(destino, `${nombre}.json`), `${JSON.stringify(datos, null, 1)}\n`);
  console.log('·', nombre);
  return datos;
};
const accion = (cuerpo) => pedir('/api/accion', { metodo: 'POST', cuerpo });
const detalle = (id) => pedir(`/api/accion?id=${id}`);

await pedir('/api/auth/sign-in/email', { metodo: 'POST', cuerpo: { email: 'admin@neltume.test', password: 'clave-e2e-segura-2026' } });
guardar('sesion', await pedir('/api/auth/get-session'));

let d = guardar('resultado-chat', await accion({ tipo: 'chat', mensaje: 'Cotiza 3 Huilo Huilo en oregón de 80 × 2,10 para Juan Pérez, Temuco', nuevoId: randomUUID() }));
let q = d.cotizacion;
d = guardar('resultado-editar', await accion({
  tipo: 'editar', id: q.id, actualizada: q.actualizada,
  items: [{ indice: 0, cambios: { tipoMedida: 'hoja', observaciones: 'Con bisagras de acero' } }],
  fleteLinea: { descripcion: null, cantidad: 1, unitario: 25000 },
}));
q = d.cotizacion;
d = guardar('resultado-agregar', await accion({ tipo: 'agregar_personalizado', id: q.id, actualizada: q.actualizada, item: {
  nombre: 'Instalación', familia: 'OTRO', madera: '', descripcion: null, ancho: null, alto: null, tipoMedida: 'no_especificado',
  cantidad: 1, precioUnitario: 80000, observaciones: null, referencias: [] } }));
q = d.cotizacion;
guardar('detalle-borrador', await detalle(q.id));
d = guardar('resultado-emitir', await accion({ tipo: 'emitir', id: q.id, actualizada: q.actualizada }));
q = d.cotizacion;
guardar('detalle-emitida', await detalle(q.id));
d = guardar('resultado-aprobar', await accion({
  tipo: 'aprobar', id: q.id, actualizada: q.actualizada,
  despacho: { direccion: 'Calle 1', transporte: 'Starken' },
  facturacion: { documento: 'boleta', receptor: null },
}));
q = d.cotizacion;
d = await accion({ tipo: 'pago', id: q.id, actualizada: q.actualizada, monto: Math.ceil(q.montos.total / 2), observacion: 'Anticipo' });
q = d.cotizacion;
d = guardar('resultado-nota', await accion({ tipo: 'generar_nota', id: q.id, actualizada: q.actualizada, asignaciones: [{ indice: 0, fabrica: 'panguipulli' }] }));
q = d.cotizacion;
d = await accion({ tipo: 'operacion', id: q.id, actualizada: q.actualizada, paso: 'iniciar_produccion' });
q = d.cotizacion;
d = await accion({ tipo: 'comentario', id: q.id, actualizada: q.actualizada, texto: 'Llamar el lunes' });
q = d.cotizacion;
guardar('detalle-aprobada', await detalle(q.id));

// Un saludo desde una pantalla nueva no crea borrador: respuesta «efímera».
guardar('resultado-efimera', await accion({ tipo: 'chat', mensaje: 'Hola, ¿qué modelos tienen?', nuevoId: randomUUID() }));
const otra = await accion({ tipo: 'chat', mensaje: 'Una Molco de 1,60 de ancho', nuevoId: randomUUID() });
if (otra.efimera) guardar('resultado-efimera-molco', otra);
else guardar('detalle-pendiente', await detalle(otra.cotizacion.id));

guardar('listado', await pedir('/api/accion?pagina=1&porPagina=30'));
guardar('listado-filtros', await pedir('/api/accion?saldoPendiente=true&comercial=aprobada,seguimiento&pagina=1&porPagina=30'));
// La papelera con un borrador eliminado: sus filas no tienen la forma de las del historial (sin estado ni montos).
const descartable = await accion({ tipo: 'chat', mensaje: 'Cotiza 2 Huilo Huilo en oregón de 80 × 2,10 para Ana Soto, Valdivia', nuevoId: randomUUID() });
await accion({ tipo: 'eliminar', id: descartable.cotizacion.id, actualizada: descartable.cotizacion.actualizada });
guardar('papelera', await pedir('/api/accion?papelera=1&pagina=1&porPagina=30'));
guardar('numeracion', await pedir('/api/accion?numeracion=1'));
guardar('vendedoras', await pedir('/api/accion?vendedoras=1'));
guardar('catalogo', await pedir('/api/catalogo?q=huilo'));
guardar('catalogo-familia', await pedir('/api/catalogo?q=&familia=MARCO'));
guardar('clientes-sugerencias', await pedir('/api/clientes?q=juan'));
guardar('clientes-directorio', await pedir('/api/clientes?directorio=1&pagina=1'));
guardar('ajustes', await pedir('/api/ajustes'));
guardar('configuracion-negocio', await pedir('/api/configuracion-negocio'));
guardar('starken', await pedir('/api/starken'));
guardar('starken-cotizar', await pedir('/api/starken/cotizar', { metodo: 'POST', cuerpo: { id: q.id } }).catch((e) => ({ error: String(e) })));
guardar('usuarios', await pedir('/api/usuarios'));
guardar('sesiones', await pedir('/api/sesiones'));
guardar('envios', await pedir(`/api/integracion/envios?cotizacion=${q.id}`));
console.log(`Listo: respuestas en ${destino}`);
