import { z } from 'zod';
import { ajustesIASchema } from '@/asistente/ajustes';
import { exigirSesion, type UsuarioSesion } from '@/servidor/acceso-autenticado';
import { ErrorMigracionRequerida } from '@/servidor/base-datos';
import { leerJson } from '@/servidor/cuerpo';
import {
  asistenteConfigurado,
  estadoClaveCommandCode,
  ErrorProteccionClave,
  guardarAjustesIA,
  guardarClaveCommandCode,
  leerAjustesIA,
  quitarClaveCommandCode,
} from '@/servidor/ajustes-ia';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const peticionSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('guardar'), ajustes: ajustesIASchema }).strict(),
  z.object({ tipo: z.literal('guardar-clave'), apiKey: z.string().trim().min(1).max(2048) }).strict(),
  z.object({ tipo: z.literal('quitar-clave') }).strict(),
]);

// El modelo y la clave de IA son globales: solo una cuenta administradora puede cambiarlos.
function estado(usuario: UsuarioSesion) {
  const ajustes = leerAjustesIA();
  const apiKey = estadoClaveCommandCode();
  return {
    ajustes,
    commandcodeClave: apiKey.configurada,
    commandcodeClaveFuente: apiKey.fuente,
    asistenteConfigurado: asistenteConfigurado(),
    puedeEditar: usuario.rol === 'admin',
  };
}

function falla(error: unknown) {
  if (error instanceof ErrorMigracionRequerida)
    return Response.json({ error: error.message }, { status: 503 });
  if (error instanceof ErrorProteccionClave)
    return Response.json({ error: error.message }, { status: 503 });
  console.error('[ajustes] fallo interno:', error instanceof Error ? error.message : 'desconocido');
  return Response.json({ error: 'No se pudo leer ni guardar la configuración.' }, { status: 500 });
}

export async function GET(req: Request) {
  const sesion = await exigirSesion(req);
  if (!sesion.ok) return sesion.respuesta;
  try {
    return Response.json(estado(sesion.usuario), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return falla(error);
  }
}

export async function POST(req: Request) {
  const sesion = await exigirSesion(req, { escritura: true, rol: 'admin' });
  if (!sesion.ok) return sesion.respuesta;
  const cuerpo = await leerJson(req);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const parsed = peticionSchema.safeParse(cuerpo.valor);
  if (!parsed.success)
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Solicitud inválida.' },
      { status: 400 },
    );
  try {
    if (parsed.data.tipo === 'guardar') guardarAjustesIA(parsed.data.ajustes);
    else if (parsed.data.tipo === 'guardar-clave') guardarClaveCommandCode(parsed.data.apiKey);
    else quitarClaveCommandCode();
    return Response.json(estado(sesion.usuario), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return falla(error);
  }
}
