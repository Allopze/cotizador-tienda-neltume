import Database from 'better-sqlite3';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { clienteVacio, type Catalogo, type Producto, type SolicitudItem } from '../src/catalogo/tipos';
import { LIMITES_DESCOMPRESION } from '../src/catalogo/xlsx';
import type { Cotizacion } from '../src/negocio/estado';
import { chromiumPath } from '../src/servidor/chromium';
import { cerrarNavegadorPdf, generarPdf } from '../src/servidor/pdf';
import { planillaPrincipal, xlsxBytes, type Celdas } from './fixture-xlsx';

// Fase 6 · carga y concurrencia: respaldo en caliente con escrituras continuas, varios PDF a la vez con uno que
// vence su plazo, 20.000 cotizaciones en el listado y el CSV por partes, y el pico de memoria de un libro grande
// pero legítimo (bajo los topes de descompresión).

vi.mock('../src/servidor/acceso-autenticado', () => ({
  exigirSesion: vi.fn(async () => ({
    ok: true,
    usuario: { id: 'u1', email: 'paula@neltume.test', nombre: 'Paula', rol: 'admin' },
  })),
}));

const raiz = process.cwd();
const tsx = join(raiz, 'node_modules', '.bin', 'tsx');
const molco: Producto = {
  codigo: 'MOL-O-3-A',
  modelo: 'MOLCO',
  familia: 'PUERTA',
  tipo: 'PUERTA PANEL',
  madera: 'PINO OREGON',
  medida: '0,80 A 0,85',
  anchoMin: 0.8,
  anchoMax: 0.85,
  largo: 2,
  precioNeto: 100_000,
  descripcion: 'MOLCO PINO OREGON 0,80 A 0,85 MT X 2 MT',
  filaOrigen: 4,
};
const catalogo: Catalogo = { fuente: 'test', sha256: 'test', fecha: '2026-01-01', productos: [molco] };
const pedido: SolicitudItem = {
  modelo: 'MOLCO',
  madera: 'PINO OREGON',
  ancho: 0.82,
  alto: 2,
  medida: null,
  cantidad: 2,
  tipoMedida: 'hoja',
};

let directorio: string | undefined;
afterEach(async () => {
  if (directorio) (await import('../src/servidor/almacen')).cerrarAlmacen();
  vi.unstubAllEnvs();
  vi.resetModules();
  if (directorio) await rm(directorio, { recursive: true, force: true });
  directorio = undefined;
});
afterAll(() => cerrarNavegadorPdf());

/** Base propia en NELTUME_DATA_DIR (como la aplicación) y un servicio con la IA simulada. */
async function montar() {
  directorio = await mkdtemp(join(tmpdir(), 'neltume-carga-'));
  const entorno = {
    NELTUME_DATA_DIR: directorio,
    NELTUME_DB_PATH: join(directorio, 'cotizador.sqlite'),
    NELTUME_RESPALDO_DIR: join(directorio, 'respaldos'),
    NELTUME_CATALOGO_CONFIG: join(directorio, 'no-hay-config.json'),
  };
  for (const [clave, valor] of Object.entries(entorno)) vi.stubEnv(clave, valor);
  const { Almacen, guardarEstadoCompleto } = await import('../src/servidor/almacen');
  const { Servicio } = await import('../src/servidor/servicio');
  const almacen = new Almacen();
  const llm = {
    interpretar: vi.fn().mockResolvedValue({
      name: 'actualizar_cotizacion',
      input: { items: [pedido], cliente: { ...clienteVacio(), nombre: 'Ana Soto' } },
    }),
  };
  const servicio = new Servicio(catalogo, llm, almacen, { nombre: 'Paula', email: 'paula@neltume.test' });
  const plantilla = (await servicio.ejecutar({ tipo: 'chat', mensaje: 'cotiza MOLCO' })).cotizacion;
  /** Agrega `n` cotizaciones de una vez (borradores y emitidas numeradas), sin pasar por el servicio. */
  const sembrar = async (n: number) => {
    const estado = await almacen.leer();
    const base = estado.siguienteCotizacion;
    for (let i = 0; i < n; i++) {
      const emitida = i % 3 === 0;
      const dia = String(1 + (i % 28)).padStart(2, '0');
      estado.cotizaciones.push({
        ...structuredClone(plantilla),
        id: `carga-${i}`,
        numero: emitida ? base + i : null,
        estado: emitida ? 'emitida' : 'borrador',
        pdf: emitida ? `cotizacion-${base + i}.pdf` : null,
        fechaEmision: emitida ? `2026-09-${dia}T15:00:00.000Z` : null,
        vence: emitida ? `2026-10-${dia}` : null,
        estadoComercial: emitida ? 'enviada' : plantilla.estadoComercial,
        cliente: { ...plantilla.cliente, nombre: `Cliente ${i}`, comuna: i % 2 ? 'Osorno' : 'Temuco' },
        creada: `2026-09-${dia}T12:00:00.000Z`,
        actualizada: `2026-09-${dia}T12:00:00.${String(i % 1000).padStart(3, '0')}Z`,
      } as Cotizacion);
    }
    estado.siguienteCotizacion = base + n;
    guardarEstadoCompleto(almacen.baseDatos(), estado);
  };
  return { dir: directorio, entorno, almacen, servicio, plantilla, sembrar };
}

describe('Respaldo en caliente', () => {
  it('npm run respaldar mientras otra conexión escribe sin parar: copia íntegra y ninguna escritura falla', async () => {
    const t = await montar();
    await t.sembrar(3000);
    const antes = t.almacen.listar().total;
    const hijo = spawn(tsx, ['scripts/respaldar.ts'], { cwd: raiz, env: { ...process.env, ...t.entorno } });
    let salida = '';
    let errores = '';
    hijo.stdout.on('data', (d) => (salida += d));
    hijo.stderr.on('data', (d) => (errores += d));
    const fin = new Promise<number | null>((r) => hijo.on('close', r));
    let terminado = false;
    void fin.then(() => (terminado = true));
    // Escrituras reales del servicio (duplicar = una cotización nueva por vez) hasta que el respaldo termine.
    let escrituras = 0;
    const inicio = performance.now();
    while (!terminado) {
      await t.servicio.ejecutar({ tipo: 'duplicar', id: t.plantilla.id });
      escrituras++;
    }
    const duracion = performance.now() - inicio;
    expect(await fin, errores).toBe(0);
    const carpeta = salida.match(/^Respaldo en ([^:]+):/m)![1];
    const copia = new Database(join(carpeta, 'cotizador.sqlite'), { readonly: true });
    try {
      expect(copia.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(copia.pragma('journal_mode', { simple: true })).toBe('delete');
      const enCopia = (copia.prepare('SELECT COUNT(*) AS n FROM cotizaciones').get() as { n: number }).n;
      // La copia es una foto consistente de algún momento del respaldo.
      expect(enCopia).toBeGreaterThanOrEqual(antes);
      expect(enCopia).toBeLessThanOrEqual(antes + escrituras);
      expect(salida).toContain(`${enCopia} cotizaciones`);
    } finally {
      copia.close();
    }
    expect(t.almacen.listar().total).toBe(antes + escrituras);
    expect(escrituras).toBeGreaterThan(0);
    console.info(`[carga] respaldo en caliente: ${escrituras} escrituras durante ${Math.round(duracion)} ms`);
  }, 120_000);
});

describe.skipIf(!chromiumPath())('Varios PDF a la vez con Chromium real', () => {
  it('cuatro PDF simultáneos y uno que vence su plazo: los demás se generan y el navegador sigue sirviendo', async () => {
    directorio = await mkdtemp(join(tmpdir(), 'neltume-carga-pdf-'));
    const html = (n: number) => `<html><body><h1>Cotización ${n}</h1>${'<p>Línea de prueba</p>'.repeat(200)}</body></html>`;
    const inicio = performance.now();
    const resultados = await Promise.allSettled([
      generarPdf(directorio, 'cotizacion-1.pdf', html(1)),
      generarPdf(directorio, 'cotizacion-2.pdf', html(2)),
      // Plazo de 1 ms: vence siempre, mientras los demás siguen en el mismo navegador.
      generarPdf(directorio, 'cotizacion-3.pdf', html(3), 1),
      generarPdf(directorio, 'cotizacion-4.pdf', html(4)),
      generarPdf(directorio, 'cotizacion-5.pdf', html(5)),
    ]);
    const duracion = performance.now() - inicio;
    expect(resultados.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
    expect((resultados[2] as PromiseRejectedResult).reason).toMatchObject({
      codigo: 'pdf_no_disponible',
      tecnico: expect.stringContaining('1 ms'),
    });
    // Sin temporales a medio escribir ni el PDF vencido (también cuando su tarea termina más tarde).
    await vi.waitFor(async () =>
      expect((await readdir(join(directorio!, 'pdf'))).sort()).toEqual(
        ['cotizacion-1.pdf', 'cotizacion-2.pdf', 'cotizacion-4.pdf', 'cotizacion-5.pdf'],
      ),
      { timeout: 10_000 },
    );
    // Después, el siguiente PDF se genera normalmente.
    await generarPdf(directorio, 'cotizacion-6.pdf', html(6));
    expect(await readdir(join(directorio, 'pdf'))).toContain('cotizacion-6.pdf');
    console.info(`[carga] 5 PDF simultáneos (1 vencido): ${Math.round(duracion)} ms`);
  }, 60_000);
});

describe('Volumen: 20.000 cotizaciones', () => {
  it('el listado, la búsqueda y el CSV en 5 partes responden y no pierden ni repiten filas', async () => {
    const t = await montar();
    let marca = performance.now();
    await t.sembrar(20_000);
    const siembra = performance.now() - marca;
    const medir = <T>(fn: () => T) => {
      const t0 = performance.now();
      const r = fn();
      return [r, performance.now() - t0] as const;
    };
    const [pagina, msListado] = medir(() => t.almacen.listar({ pagina: 1, porPagina: 50 }));
    expect(pagina.total).toBe(20_001);
    expect(pagina.cotizaciones).toHaveLength(50);
    const [ultima, msUltima] = medir(() => t.almacen.listar({ pagina: 401, porPagina: 50 }));
    expect(ultima.cotizaciones).toHaveLength(1);
    const [busqueda, msBusqueda] = medir(() => t.almacen.listar({ q: 'cliente 1999', porPagina: 50 }));
    expect(busqueda.cotizaciones.map((q) => q.cliente.nombre)).toContain('Cliente 1999');
    const [emitidas, msFiltro] = medir(() => t.almacen.listar({ estados: ['emitida'], desde: '2026-09-10', hasta: '2026-09-12' }));
    expect(emitidas.total).toBeGreaterThan(0);
    for (const ms of [msListado, msUltima, msBusqueda, msFiltro]) expect(ms).toBeLessThan(2000);

    const { GET } = await import('../src/app/api/accion/route');
    const get = (consulta: string) => GET(new Request(`http://127.0.0.1:3000/api/accion?${consulta}`));
    const aviso = await get('formato=csv');
    expect(aviso.status).toBe(409);
    expect(await aviso.json()).toMatchObject({ codigo: 'exportacion_por_partes', detalle: { total: 20_001, partes: 5, porParte: 5000 } });
    const ids = new Set<string>();
    let filas = 0;
    const tiempos: number[] = [];
    for (let parte = 1; parte <= 5; parte++) {
      marca = performance.now();
      const r = await get(`formato=csv&parte=${parte}`);
      const texto = await r.text();
      tiempos.push(performance.now() - marca);
      expect(r.status).toBe(200);
      const lineas = texto.replace(/^﻿/, '').split('\r\n').slice(1);
      expect(lineas.length).toBe(parte < 5 ? 5000 : 1);
      filas += lineas.length;
      // Cliente (columna 7) identifica cada fila sembrada.
      for (const l of lineas) ids.add(l.split(';')[6]);
    }
    expect(filas).toBe(20_001);
    // 20.000 clientes distintos más «Ana Soto», la cotización de la que se copiaron.
    expect(ids.size).toBe(20_001);
    for (const ms of tiempos) expect(ms).toBeLessThan(15_000);
    console.info(
      `[carga] 20.000: siembra ${Math.round(siembra)} ms; listado ${Math.round(msListado)} ms, última página ${Math.round(msUltima)} ms, búsqueda ${Math.round(msBusqueda)} ms, filtro ${Math.round(msFiltro)} ms; CSV por parte ${tiempos.map((ms) => Math.round(ms)).join(' / ')} ms`,
    );
  }, 300_000);
});

describe('Pico de memoria de un libro legítimo', () => {
  /** Mide en un proceso aparte el máximo de RSS al importar `ruta` (antes y después de abrirla). */
  function picoImportando(ruta: string) {
    const codigo = `
      import { importarPlanilla } from ${JSON.stringify(resolve('src/catalogo/planilla.ts'))};
      const antes = process.resourceUsage().maxRSS;
      const t0 = performance.now();
      const r = await importarPlanilla(process.argv.at(-1));
      console.log(JSON.stringify({ antes, despues: process.resourceUsage().maxRSS, productos: r.catalogo.productos.length, ms: performance.now() - t0 }));
    `;
    const r = spawnSync(tsx, ['--input-type=module', '--eval', codigo, ruta], { cwd: raiz, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const medida = JSON.parse(r.stdout.trim().split('\n').at(-1)!) as { antes: number; despues: number; productos: number; ms: number };
    // maxRSS viene en kB en Linux y en bytes en macOS (libuv lo normaliza a kB desde Node 12).
    return { ...medida, picoMb: medida.despues / 1024, subidaMb: (medida.despues - medida.antes) / 1024 };
  }

  it('un libro de 20.000 filas con columnas de relleno (bajo los topes) se importa con un pico acotado', async () => {
    directorio = await mkdtemp(join(tmpdir(), 'neltume-carga-xlsx-'));
    // 20.000 filas válidas y, en las columnas que el importador no lee (H–N), texto largo: ~60 MB de XML.
    const n = 20_000;
    const hojas = planillaPrincipal();
    const precio: Celdas = {};
    const categorias: Celdas = { ...hojas.Categorias };
    const relleno = 'x'.repeat(400);
    for (let i = 0; i < n; i++) {
      const r = 4 + i;
      const modelo = `MODELO${Math.floor(i / 4)}`;
      if (i % 4 === 0) Object.assign(categorias, { [`O${4 + Math.floor(i / 4)}`]: modelo, [`P${4 + Math.floor(i / 4)}`]: `M${Math.floor(i / 4)}` });
      const madera = i % 2 ? 'RAULI' : 'LENGA';
      const largo = (i >> 1) % 2 ? 2.4 : 2;
      const neto = 100_000 + i;
      Object.assign(precio, {
        [`A${r}`]: `M${Math.floor(i / 4)}-${madera[0]}-070-${largo === 2 ? 'A' : 'B'}`,
        [`B${r}`]: modelo,
        [`C${r}`]: 'PUERTA',
        [`D${r}`]: '70 A 80',
        [`F${r}`]: largo,
        [`G${r}`]: madera,
        [`O${r}`]: neto,
        [`P${r}`]: Math.round(neto * 1.19 * 100) / 100,
        ...Object.fromEntries(['H', 'I', 'J'].map((c) => [`${c}${r}`, `${relleno}${c}${i}`])),
      });
    }
    // Categorias solo admite 497 modelos (filas 4–500): los modelos más allá no tienen código y quedan como
    // inválidos, así que se limita a 497 × 4 filas válidas.
    const validas = Math.min(n, 497 * 4);
    for (let i = validas; i < n; i++) delete precio[`A${4 + i}`];
    const bytes = xlsxBytes({ ...hojas, Precio: precio, Categorias: categorias });
    const ruta = join(directorio, 'grande.xlsx');
    await writeFile(ruta, bytes);
    const m = picoImportando(ruta);
    expect(m.productos).toBe(validas);
    expect(m.picoMb).toBeLessThan(LIMITES_DESCOMPRESION.total / 1024 / 1024 + 400);
    console.info(
      `[carga] xlsx sintético ${(bytes.length / 1024 / 1024).toFixed(1)} MB comprimido: pico RSS ${Math.round(m.picoMb)} MB (+${Math.round(m.subidaMb)} MB), ${Math.round(m.ms)} ms`,
    );
  }, 120_000);

  const real = resolve('datos-privados/COTIZADOR_2026.xlsx');
  it.skipIf(!existsSync(real))('la planilla real (solo lectura) se importa con un pico acotado', () => {
    const m = picoImportando(real);
    expect(m.productos).toBeGreaterThan(8000);
    expect(m.picoMb).toBeLessThan(600);
    console.info(`[carga] COTIZADOR_2026.xlsx: pico RSS ${Math.round(m.picoMb)} MB (+${Math.round(m.subidaMb)} MB), ${Math.round(m.ms)} ms`);
  }, 120_000);
});
