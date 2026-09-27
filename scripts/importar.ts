import { mkdir, writeFile } from 'node:fs/promises';
import { importar } from '../src/catalogo/importar';
const ruta = process.argv[2] ?? process.env.NELTUME_PLANILLA ?? 'datos-privados/COTIZADOR_2026.xlsx';
try {
  const r = await importar(ruta);
  await mkdir('data', { recursive: true });
  await mkdir('public', { recursive: true });
  await writeFile('data/catalogo.json', JSON.stringify(r.catalogo, null, 2));
  await writeFile('data/reporte-importacion.md', r.reporte);
  if (r.logo) await writeFile('public/logo-neltume.svg', r.logo);
  console.log(
    `${r.catalogo.productos.length} productos; ${r.incidencias.filter((i) => i.accion === 'correccion').length} correcciones; ${r.incidencias.filter((i) => i.accion === 'exclusion').length} exclusiones. Reporte: data/reporte-importacion.md`,
  );
} catch {
  console.error(
    `No se pudo importar ${ruta}. Verifica que exista una planilla válida con Precio, Categorias y Cotización.`,
  );
  process.exitCode = 1;
}
