import { importarEnchapadas, esPlanillaEnchapadas } from './enchapadas';
import { ErrorImportacion, importar } from './importar';
import { validarConfiguracionCatalogo, type ConfiguracionCatalogo } from './configuracion';
import type { OrigenCatalogo } from './origenes';
import { abrirXlsx, ErrorXlsx, ErrorXlsxCompuesto, type Xlsx } from './xlsx';

const HOJAS_PRINCIPAL = ['Precio', 'Categorias', 'Cotización'];

/**
 * Qué planilla es el libro, por la forma de sus hojas y no por el nombre del archivo: la de puertas sólidas
 * trae las hojas Precio, Categorias y Cotización; la de enchapadas, bloques con título y encabezado de costo.
 */
export function detectarPlanilla(x: Xlsx): OrigenCatalogo | null {
  if (HOJAS_PRINCIPAL.every((hoja) => x.hojas.includes(hoja))) return 'principal';
  return esPlanillaEnchapadas(x) ? 'enchapadas' : null;
}

/**
 * Importa cualquiera de las planillas conocidas. No escribe nada: devuelve el catálogo de ese origen, la
 * configuración con que se leyó (para guardarla junto con los productos) y lo demás que entregue el importador.
 */
export async function importarPlanilla(ruta: string, configEntrada?: ConfiguracionCatalogo) {
  const x = await abrirXlsx(ruta).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') throw error;
    throw libroInvalido(error);
  });
  try {
    return await importarLibro(ruta, x, configEntrada);
  } catch (error) {
    // Una hoja con XML o referencias inválidas recién aparece al leerla, ya dentro del importador.
    if (error instanceof ErrorXlsx) throw libroInvalido(error);
    throw error;
  }
}

const libroInvalido = (error: unknown) =>
  error instanceof ErrorXlsxCompuesto
    ? new ErrorImportacion(
        error.protegido
          ? 'El archivo está protegido con contraseña: guárdalo sin contraseña y vuelve a intentarlo. El catálogo no se modificó.'
          : 'El archivo es un Excel antiguo (.xls): ábrelo en Excel, guárdalo como .xlsx y vuelve a intentarlo. El catálogo no se modificó.',
      )
    : new ErrorImportacion(
        `No se pudo leer el archivo como un Excel .xlsx válido (${error instanceof Error ? error.message : 'formato desconocido'}). El catálogo no se modificó.`,
      );

async function importarLibro(ruta: string, x: Xlsx, configEntrada?: ConfiguracionCatalogo) {
  const origen = detectarPlanilla(x);
  if (!origen)
    throw new ErrorImportacion(
      'No reconozco esta planilla. Se aceptan la de puertas sólidas (hojas Precio, Categorias y Cotización) y la de enchapadas, prepintadas y marcos finger (bloques con «RANGO ALTURA / ANCHO / VALOR COSTO + IVA» o «MEDIDAS / VALOR COSTO + IVA»). El catálogo no se modificó.',
    );
  if (origen === 'enchapadas') {
    const r = await importarEnchapadas(ruta, configEntrada, x);
    return { ...r, origen, logo: undefined as Uint8Array | undefined };
  }
  const configuracion = validarConfiguracionCatalogo(configEntrada ?? {});
  const r = await importar(ruta, configuracion, x);
  return { ...r, origen, configuracion, catalogo: { ...r.catalogo, origen } };
}
