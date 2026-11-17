// Contrato de las solicitudes de la app de Android: el JSON Schema de `accionSchema` (src/servidor/esquema-accion.ts)
// se guarda en android/nucleo/src/test/resources/contrato/accion.schema.json y las pruebas Kotlin del núcleo
// (`./gradlew :nucleo:test` en android/) validan contra él cada cuerpo que arma la app. Si el esquema cambia, esta
// prueba falla hasta regenerarlo; entonces falla Kotlin si la app envía algo que el servidor ya no acepta.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { accionSchema } from '@/servidor/esquema-accion';

const ARCHIVO = join(
  dirname(new URL(import.meta.url).pathname),
  '../android/nucleo/src/test/resources/contrato/accion.schema.json',
);

describe('contrato de solicitudes de la app de Android', () => {
  it('el JSON Schema de las acciones coincide con el que valida la app', () => {
    const esquema = z.toJSONSchema(accionSchema, { io: 'input', unrepresentable: 'any', target: 'draft-2020-12' });
    const generado = `${JSON.stringify(esquema, null, 1)}\n`;
    if (process.env.ACTUALIZAR_VECTORES === '1') {
      mkdirSync(dirname(ARCHIVO), { recursive: true });
      writeFileSync(ARCHIVO, generado);
    }
    let guardado = '';
    try {
      guardado = readFileSync(ARCHIVO, 'utf8');
    } catch {
      guardado = '';
    }
    expect(
      guardado === generado,
      'Cambió el esquema de /api/accion. Corre `ACTUALIZAR_VECTORES=1 npx vitest run tests/esquema-movil.test.ts` y luego `./gradlew :nucleo:test` en android/ para revisar que la app siga enviando cuerpos válidos.',
    ).toBe(true);
  });
});
