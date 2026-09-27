import { mkdir, writeFile } from 'node:fs/promises';
import { importar } from '../src/catalogo/importar';
import { leerConfiguracionCatalogo } from '../src/catalogo/configuracion-archivo';
import { abrirBaseDatos } from '../src/servidor/base-datos';
import { guardarCatalogo } from '../src/servidor/repositorio-catalogo';
const ruta = process.argv[2] ?? process.env.NELTUME_PLANILLA ?? 'datos-privados/COTIZADOR_2026.xlsx';
try {
  const configuracion = await leerConfiguracionCatalogo();
  const r = await importar(ruta, configuracion);
  await mkdir('data', { recursive: true });
  await mkdir('public', { recursive: true });
  guardarCatalogo(abrirBaseDatos(), r.catalogo, configuracion);
  await writeFile('data/reporte-importacion.md', r.reporte);
  if (r.logo) await writeFile('public/logo-neltume.svg', r.logo);
  console.log(
    `${r.catalogo.productos.length} productos; ${r.incidencias.filter((i) => i.accion === 'correccion').length} correcciones; ${r.incidencias.filter((i) => i.accion === 'exclusion').length} exclusiones. Reporte: data/reporte-importacion.md`,
  );
} catch (error) {
  console.error(
    `No se pudo actualizar el catálogo desde ${ruta}. Revisa la planilla, config/catalogo.json y el reporte de validación.`,
  );
  if (error instanceof Error) console.error(error.message);
  process.exitCode = 1;
}
