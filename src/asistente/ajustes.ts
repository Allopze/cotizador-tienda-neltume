import { z } from 'zod';
// Módulo sin dependencias de Node: lo usan tanto el servidor como la pantalla de configuración.

export const MODELO_COMMANDCODE_PREDETERMINADO = 'claude-sonnet-5';
/** Responde cuando el modelo principal falla: el más fiable y rápido en la comparación de modelos. */
export const MODELO_RESPALDO_PREDETERMINADO = 'deepseek/deepseek-v4.1-flash';

const idModelo = z
  .string()
  .trim()
  .min(1, 'Indica el modelo.')
  .max(200)
  .regex(/^[\w.:/@+-]+$/, 'El nombre del modelo contiene caracteres no válidos.');

// Sin .strict(): al leer lo guardado descarta campos de versiones anteriores (proveedor, local).
export const ajustesIAGuardadosSchema = z.object({
  commandcode: z
    .object({
      modelo: idModelo,
      /** Sin indicar, el predeterminado; null, sin respaldo. */
      respaldo: idModelo.nullable().optional(),
    })
    .strict(),
});
export const ajustesIASchema = ajustesIAGuardadosSchema.strict();
export type AjustesIA = z.infer<typeof ajustesIASchema>;

export function ajustesPredeterminados(modeloCommandCode?: string): AjustesIA {
  return { commandcode: { modelo: modeloCommandCode?.trim() || MODELO_COMMANDCODE_PREDETERMINADO } };
}

export function nombreModeloActivo(a: AjustesIA): string {
  return a.commandcode.modelo;
}

/** Modelo de respaldo vigente; null si no hay o si es el mismo modelo principal. */
export function modeloRespaldo(a: AjustesIA): string | null {
  const respaldo = a.commandcode.respaldo === undefined ? MODELO_RESPALDO_PREDETERMINADO : a.commandcode.respaldo;
  return respaldo && respaldo !== a.commandcode.modelo ? respaldo : null;
}
