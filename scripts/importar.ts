import { mkdir, writeFile } from 'node:fs/promises';
import { importarPlanilla } from '../src/catalogo/planilla';
import { ETIQUETA_ORIGEN } from '../src/catalogo/origenes';
import { leerConfiguracionCatalogo } from '../src/catalogo/configuracion-archivo';
import { Almacen } from '../src/servidor/almacen';
import { fusionarConfiguracion } from '../src/servidor/importacion-catalogo';
import { configuracionGuardada } from '../src/servidor/repositorio-catalogo';
const argumentos = process.argv.slice(2);
// --forzar acepta una planilla con muchos menos productos que el catálogo actual.
const forzar = argumentos.includes('--forzar');
const ruta =
  argumentos.find((a) => !a.startsWith('--')) ??
  process.env.NELTUME_PLANILLA ??
  'datos-privados/COTIZADOR_2026.xlsx';
let guardado = false;
try {
  const almacen = new Almacen();
  // Los nombres y alias editados en la aplicación mandan: config/catalogo.json solo suma lo que la base no tiene.
  const configuracion = fusionarConfiguracion(
    await leerConfiguracionCatalogo(),
    configuracionGuardada(almacen.baseDatos()),
  );
  // La planilla se reconoce por su forma; cada una reemplaza solo sus propios productos.
  const r = await importarPlanilla(ruta, configuracion);
  const reporte = r.origen === 'principal' ? 'data/reporte-importacion.md' : `data/reporte-importacion-${r.origen}.md`;
  await mkdir('data', { recursive: true });
  await mkdir('public', { recursive: true });
  // El reporte describe la planilla: se escribe antes de guardar, así queda también si se rechaza (p. ej. por el 90 %).
  await writeFile(reporte, r.reporte);
  // Con el bloqueo del almacén, como la importación desde la aplicación: no cambia el catálogo en medio de una
  // emisión que esté corriendo en el servidor.
  await almacen.guardarCatalogo(r.catalogo, r.configuracion, { forzar });
  guardado = true;
  if (r.logo) await writeFile('public/logo-neltume.svg', r.logo);
  console.log(
    `${ETIQUETA_ORIGEN[r.origen]}: ${r.catalogo.productos.length} productos; ${r.incidencias.filter((i) => i.accion === 'correccion').length} correcciones; ${r.incidencias.filter((i) => i.accion === 'exclusion').length} exclusiones. Reporte: ${reporte}`,
  );
} catch (error) {
  console.error(
    guardado
      ? `El catálogo se actualizó desde ${ruta} y quedó guardado, pero falló un paso posterior (el logo). No repitas la importación por esto.`
      : `No se pudo actualizar el catálogo desde ${ruta}. Revisa la planilla, config/catalogo.json y el reporte de validación.`,
  );
  if (error instanceof Error) console.error(error.message);
  process.exitCode = 1;
}
