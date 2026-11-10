// Modelos del catálogo: listar, duplicar uno para crear otro y renombrar uno agregado a mano (auditoría 2026-11,
// N-06 y N-33).
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { abrirBaseDatos } from '../src/servidor/base-datos';
import { guardarCatalogo, RepositorioCatalogoSqlite } from '../src/servidor/repositorio-catalogo';
import { resolverItem } from '../src/catalogo/resolver';
import type { Catalogo, Producto } from '../src/catalogo/tipos';

const fila = (codigo: string, madera: string, anchoMin: number, anchoMax: number, precioNeto: number): Producto => ({
  codigo,
  modelo: 'RANCO',
  familia: 'PUERTA',
  tipo: 'PUERTA PANEL',
  madera,
  medida: `${anchoMin.toFixed(2).replace('.', ',')} A ${anchoMax.toFixed(2).replace('.', ',')}`,
  anchoMin,
  anchoMax,
  largo: 2.1,
  precioNeto,
  descripcion: `RANCO ${madera} ${anchoMin} A ${anchoMax} MT X 2,1 MT`,
  filaOrigen: 1,
});
const catalogo = (): Catalogo => ({
  fuente: 'test.xlsx',
  sha256: 'sha',
  fecha: '2026-01-01T00:00:00.000Z',
  productos: [
    fila('RAN-O-3-B', 'PINO OREGON', 0.8, 0.85, 100_000),
    fila('RAN-O-5-B', 'PINO OREGON', 0.95, 1.05, 120_000),
    fila('RAN-L-3-B', 'LENGA', 0.8, 0.85, 90_000),
  ],
});

const dirs: string[] = [];
let db: Database.Database;
async function repo() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-modelos-'));
  dirs.push(dir);
  db = abrirBaseDatos(join(dir, 'cotizador.sqlite'), { cachear: false });
  guardarCatalogo(db, catalogo());
  return new RepositorioCatalogoSqlite(db);
}
afterEach(async () => {
  if (db?.open) db.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('modelos del catálogo', () => {
  it('lista cada modelo con sus maderas, medidas y origen', async () => {
    const r = await repo();
    expect(r.listarModelos()).toEqual([
      {
        modelo: 'RANCO',
        familia: 'PUERTA',
        filas: 3,
        origen: 'planilla',
        maderas: [
          { madera: 'LENGA', filas: 1, desde: 90_000, hasta: 90_000 },
          { madera: 'PINO OREGON', filas: 2, desde: 100_000, hasta: 120_000 },
        ],
      },
    ]);
  });

  it('duplicar crea el modelo nuevo con las mismas medidas, el costo ajustado y códigos propios', async () => {
    const r = await repo();
    expect(r.duplicarModelo({ origen: 'Ranco', nombre: 'Roble', factor: 1.1 }, 'u1')).toEqual({ modelo: 'ROBLE', creados: 3 });
    const roble = r.productosDeModelo('ROBLE');
    expect(roble.map((p) => [p.codigo, p.madera, p.anchoMin, p.precioNeto]).sort()).toEqual([
      ['ROBL-L-3-B', 'LENGA', 0.8, 99_000],
      ['ROBL-O-3-B', 'PINO OREGON', 0.8, 110_000],
      ['ROBL-O-5-B', 'PINO OREGON', 0.95, 132_000],
    ]);
    expect(roble.every((p) => p.descripcion.startsWith('ROBLE '))).toBe(true);
    // Se cotiza como cualquier otro modelo; el original no cambia.
    const res = resolverItem(r, { modelo: 'roble', madera: 'lenga', ancho: 0.82, alto: 2.1, medida: null, cantidad: 1 });
    expect(res.ok && res.producto.codigo).toBe('ROBL-L-3-B');
    expect(r.productosDeModelo('RANCO').map((p) => p.precioNeto).sort()).toEqual([100_000, 120_000, 90_000].sort());
    expect(r.listarModelos().find((m) => m.modelo === 'ROBLE')?.origen).toBe('manual');
  });

  it('duplicar solo las maderas elegidas; no repite un nombre existente', async () => {
    const r = await repo();
    expect(r.duplicarModelo({ origen: 'RANCO', nombre: 'Roble', maderas: ['LENGA'], factor: 1 }, null).creados).toBe(1);
    expect(() => r.duplicarModelo({ origen: 'RANCO', nombre: 'roble', factor: 1 }, null)).toThrow(/Ya existe un modelo/);
    expect(() => r.duplicarModelo({ origen: 'RANCO', nombre: 'Otro', factor: 5 }, null)).toThrow(/ajuste de precio/);
  });

  it('renombrar un modelo agregado a mano deja el nombre anterior como otro nombre', async () => {
    const r = await repo();
    r.duplicarModelo({ origen: 'RANCO', nombre: 'Roble', factor: 1 }, null);
    expect(r.renombrarModelo('ROBLE', 'Robles')).toEqual({ modelo: 'ROBLES', renombrados: 3 });
    expect(r.productosDeModelo('ROBLE')).toHaveLength(0);
    expect(r.productosDeModelo('ROBLES')).toHaveLength(3);
    // Un borrador que decía «Roble» sigue encontrando el modelo.
    const res = resolverItem(r, { modelo: 'Roble', madera: 'lenga', ancho: 0.82, alto: 2.1, medida: null, cantidad: 1 });
    expect(res.ok && res.producto.modelo).toBe('ROBLES');
  });

  it('un modelo de la planilla no se renombra aquí', async () => {
    const r = await repo();
    expect(() => r.renombrarModelo('RANCO', 'Rancos')).toThrow(/viene de la planilla/);
  });
});
