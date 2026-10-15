import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Almacen } from '../src/servidor/almacen';
import { abrirBaseDatos, cerrarBaseDatos, VERSION_ESQUEMA } from '../src/servidor/base-datos';

// Copia real de la base en v5 (antes de la auditoría), guardada al migrar el 28-sep. Es privada (data/ no se
// versiona): sin ella la prueba se omite. Se migra una copia temporal; el original no se toca.
const ORIGINAL = resolve('data/respaldo-migracion/cotizador-v5-antes-auditoria.sqlite');

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    cerrarBaseDatos(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

const sha = async (ruta: string) => createHash('sha256').update(await readFile(ruta)).digest('hex');

describe.skipIf(!existsSync(ORIGINAL))('Migración v5 → vigente sobre una copia de la base real', () => {
  it('conserva al peso los montos y las líneas de cada cotización, los números y los correlativos', async () => {
    const huella = await sha(ORIGINAL);
    const dir = await mkdtemp(join(tmpdir(), 'neltume-v5-'));
    dirs.push(dir);
    const ruta = join(dir, 'cotizador.sqlite');
    await copyFile(ORIGINAL, ruta);

    // Lo que había en v5, leído en crudo.
    const v5 = new Database(ruta, { readonly: true });
    expect(v5.pragma('user_version', { simple: true })).toBe(5);
    const montosV5 = v5.prepare('SELECT cotizacion_id AS id, neto, iva, total FROM cotizacion_montos ORDER BY id').all();
    const lineasV5 = v5
      .prepare(
        'SELECT cotizacion_id AS id, orden, codigo, cantidad, precio_unitario AS unitario, total FROM cotizacion_lineas ORDER BY id, orden',
      )
      .all();
    const cotizacionesV5 = v5.prepare('SELECT id, numero, estado FROM cotizaciones ORDER BY id').all();
    const correlativosV5 = v5.prepare('SELECT siguiente_cotizacion, siguiente_nota FROM correlativos').get();
    v5.close();
    expect(lineasV5.length).toBeGreaterThan(0);

    const db = abrirBaseDatos(ruta, { cachear: false });
    expect(db.pragma('user_version', { simple: true })).toBe(VERSION_ESQUEMA);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(db.pragma('foreign_key_check')).toEqual([]);
    db.close();

    const estado = await new Almacen(dir, ruta).leer();
    const porId = [...estado.cotizaciones].sort((a, b) => a.id.localeCompare(b.id));
    expect(porId.map((q) => ({ id: q.id, numero: q.numero, estado: q.estado }))).toEqual(cotizacionesV5);
    expect(porId.map((q) => ({ id: q.id, neto: q.montos.neto, iva: q.montos.iva, total: q.montos.total }))).toEqual(
      montosV5,
    );
    expect(
      porId.flatMap((q) =>
        q.montos.lineas.map((l, orden) => ({
          id: q.id,
          orden,
          codigo: l.producto.codigo,
          cantidad: l.cantidad,
          unitario: l.precioUnitario,
          total: l.total,
        })),
      ),
    ).toEqual(lineasV5);
    // Cada total sigue cuadrando: suma de líneas = neto, neto + IVA = total.
    for (const q of porId) {
      expect(q.montos.lineas.reduce((s, l) => s + l.total, 0)).toBe(q.montos.neto);
      expect(q.montos.neto + q.montos.iva).toBe(q.montos.total);
    }
    expect({ siguiente_cotizacion: estado.siguienteCotizacion, siguiente_nota: estado.siguienteNota }).toEqual(
      correlativosV5,
    );
    expect(await sha(ORIGINAL)).toBe(huella);
  });
});
