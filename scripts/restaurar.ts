import { ErrorRestauracion, restaurarRespaldo } from './lib/restauracion';

// Uso: npm run restaurar -- <carpeta-de-respaldo>
// Restaura base, PDF, referencias del cliente y configuración del catálogo de una carpeta cotizador-<fecha> creada por
// `npm run respaldar`. Exige el cotizador detenido; verifica la copia con integrity_check antes de tocar nada y
// deja lo que había en <datos>/antes-de-restaurar-<fecha>/ por si hay que deshacer.
// En Docker: docker compose stop; docker compose run --rm cotizador npm run restaurar -- /app/respaldos/<carpeta>;
// docker compose up -d.
const carpeta = process.argv.slice(2).find((a) => a !== '--');

async function main() {
  if (!carpeta || carpeta.startsWith('-')) {
    console.log('Uso: npm run restaurar -- <carpeta-de-respaldo>');
    console.log('Ejemplo: npm run restaurar -- respaldos/cotizador-2026-10-14T21-00-00-000Z');
    process.exitCode = 2;
    return;
  }
  const r = await restaurarRespaldo(carpeta);
  console.log(`Restauración lista desde ${r.carpeta}:`);
  console.log(
    `  ${r.cotizaciones} cotizaciones, ${r.cuentas ?? 'sin'} cuentas, ${r.pdf} PDF y ${r.referencias} referencias del cliente` +
      (r.config ? '; también la configuración del catálogo.' : '.'),
  );
  console.log(`Lo que había antes quedó en ${r.aparte}.`);
  if (r.integracion.envios || r.integracion.correlativos)
    console.log(
      `  Se conservaron ${r.integracion.envios} envíos y ${r.integracion.correlativos} correlativos de la fábrica que no estaban en el respaldo.`,
    );
  console.log(
    'Si después del respaldo se enviaron pedidos a la fábrica, concílialos con ella antes de volver a generar notas.',
  );
  console.log('Bórralo cuando compruebes que todo está bien. Para deshacer, restaura esa carpeta del mismo modo.');
  console.log('Ahora inicia el cotizador (con Docker: docker compose up -d) y revisa una cotización reciente.');
}

main().catch((error: unknown) => {
  console.error(
    error instanceof ErrorRestauracion
      ? `No se restauró: ${error.message}`
      : `No se restauró: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
