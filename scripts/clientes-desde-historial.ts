import { pathToFileURL } from 'node:url';
import type Database from 'better-sqlite3';
import { normalizarRut, rutCompacto } from '../src/negocio/cliente';
import { abrirBaseDatos, cerrarBaseDatos } from '../src/servidor/base-datos';
import { agruparClientesDeCotizaciones } from '../src/servidor/clientes';
import { buscarClienteActivoPorRut, crearCliente } from '../src/servidor/repositorio-clientes';

export const ACTOR_IMPORTACION_CLIENTES = 'terminal:clientes-desde-historial';

export interface CandidatoImportacion {
  nombre: string;
  rut: string;
  giro: string | null;
  telefono: string | null;
  direccion: string | null;
  comuna: string | null;
  cotizaciones: number;
}

export interface ResultadoImportacionClientes {
  simular: boolean;
  creados: CandidatoImportacion[];
  yaRegistrados: number;
  omitidosSinNombre: number;
  omitidosSinRutOInvalido: number;
}

/**
 * Revisa el historial de cotizaciones y crea fichas en `clientes` para cada grupo que tenga nombre,
 * RUT módulo 11 válido y no esté ya registrado (activo) con ese RUT. Con `simular: true` no escribe nada.
 */
export function importarClientesDesdeHistorial(
  db: Database.Database,
  opciones: { simular?: boolean } = {},
): ResultadoImportacionClientes {
  const simular = !!opciones.simular;
  const grupos = agruparClientesDeCotizaciones(db);
  const vistos = new Set<string>();

  const creados: CandidatoImportacion[] = [];
  let yaRegistrados = 0;
  let omitidosSinNombre = 0;
  let omitidosSinRutOInvalido = 0;

  for (const g of grupos) {
    const nombre = g.nombre?.trim();
    if (!nombre) {
      omitidosSinNombre++;
      continue;
    }
    const rut = g.rut ? normalizarRut(g.rut) : null;
    if (!rut) {
      omitidosSinRutOInvalido++;
      continue;
    }
    const compacto = rutCompacto(rut);
    if (!compacto || vistos.has(compacto) || buscarClienteActivoPorRut(db, rut)) {
      yaRegistrados++;
      continue;
    }
    vistos.add(compacto);

    const candidato: CandidatoImportacion = {
      nombre,
      rut,
      giro: g.giro,
      telefono: g.telefono,
      direccion: g.direccion,
      comuna: g.comuna,
      cotizaciones: g.cantidad,
    };
    if (!simular) {
      crearCliente(
        db,
        {
          nombre: candidato.nombre,
          rut: candidato.rut,
          giro: candidato.giro,
          telefono: candidato.telefono,
          direccion: candidato.direccion,
          comuna: candidato.comuna,
        },
        ACTOR_IMPORTACION_CLIENTES,
      );
    }
    creados.push(candidato);
  }

  return { simular, creados, yaRegistrados, omitidosSinNombre, omitidosSinRutOInvalido };
}

function main() {
  const simular = process.argv.includes('--simular');
  const db = abrirBaseDatos();
  try {
    const r = importarClientesDesdeHistorial(db, { simular });
    if (r.creados.length === 0) {
      console.log('No hay clientes nuevos para importar desde el historial.');
    } else {
      console.log(
        simular
          ? `Simulación: se importarían ${r.creados.length} cliente(s):`
          : `Se importaron ${r.creados.length} cliente(s):`,
      );
      for (const c of r.creados) {
        console.log(`  - ${c.nombre} (${c.rut}) · ${c.cotizaciones} cotización(es)`);
      }
    }
    console.log(
      `Resumen: ${r.creados.length} ${simular ? 'por crear' : 'creados'}, ` +
        `${r.yaRegistrados} ya registrados, ` +
        `${r.omitidosSinRutOInvalido} sin RUT válido, ${r.omitidosSinNombre} sin nombre.`,
    );
    if (simular && r.creados.length > 0) {
      console.log('Ejecuta sin --simular para guardarlos en el registro.');
    }
  } finally {
    cerrarBaseDatos();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
