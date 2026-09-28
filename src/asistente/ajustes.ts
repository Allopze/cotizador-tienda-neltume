import { z } from 'zod';
// Módulo sin dependencias de Node: lo usan tanto el servidor como la pantalla de configuración.

export const MODELO_COMMANDCODE_PREDETERMINADO = 'claude-sonnet-5';

// Sin .strict(): al leer lo guardado descarta campos de versiones anteriores (proveedor, local).
export const ajustesIAGuardadosSchema = z.object({
  commandcode: z
    .object({
      modelo: z
        .string()
        .trim()
        .min(1, 'Indica el modelo.')
        .max(200)
        .regex(/^[\w.:/@+-]+$/, 'El nombre del modelo contiene caracteres no válidos.'),
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
