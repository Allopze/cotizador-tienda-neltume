import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Advertencia destacada de --sin-ia: la entrega no pasó la evaluación de la IA (precisión, errores
 * silenciosos y falsas alarmas), así que un cambio en el asistente puede llegar a las vendedoras sin medir.
 */
export function advertenciaSinIa() {
  const lineas = [
    'ATENCIÓN: SE OMITIÓ LA EVALUACIÓN DE LA IA (--sin-ia)',
    '',
    'Esta entrega no midió la precisión del asistente, sus errores',
    'silenciosos ni sus falsas alarmas. Si cambió el asistente, el',
    'anclaje o los casos, corre «npm run evaluar:regresion» antes',
    'de usarlo con las vendedoras.',
  ];
  const ancho = Math.max(...lineas.map((l) => l.length));
  const borde = `+${'-'.repeat(ancho + 2)}+`;
  const cuerpo = lineas.map((l) => `| ${l.padEnd(ancho)} |`);
  const texto = ['', borde, ...cuerpo, borde, ''].join('\n');
  // Amarillo y negrita en una terminal; texto plano si la salida va a un archivo.
  return process.stderr.isTTY ? `\x1b[1;33m${texto}\x1b[0m` : texto;
}

function ejecutar(paso) {
  return new Promise((resolver, rechazar) => {
    const inicio = Date.now();
    const proceso = spawn(paso.comando, paso.argumentos, {
      cwd: raiz,
      shell: process.platform === 'win32',
    });
    const prefijo = `[${paso.nombre}] `;
    // Con varios procesos a la vez, la salida sin prefijo es ilegible. Se prefija por línea y se deja
    // el último fragmento para cuando cierre el flujo (una línea sin salto final).
    const bombear = (flujo, salida) => {
      let pendiente = '';
      flujo.setEncoding('utf8');
      flujo.on('data', (trozo) => {
        pendiente += trozo;
        const lineas = pendiente.split('\n');
        pendiente = lineas.pop() ?? '';
        for (const linea of lineas) salida.write(`${prefijo}${linea}\n`);
      });
      flujo.on('end', () => {
        if (pendiente) salida.write(`${prefijo}${pendiente}\n`);
      });
    };
    bombear(proceso.stdout, process.stdout);
    bombear(proceso.stderr, process.stderr);
    proceso.on('error', rechazar);
    proceso.on('close', (codigo) => resolver({ codigo, ms: Date.now() - inicio }));
  });
}

/**
 * Grupos de pasos independientes. El grupo 1 es rápido y no compite por Chromium; el grupo 2 junta E2E
 * con la evaluación de IA, que es de red. Así se solapa lo que no pelea por CPU y se conserva toda la
 * cobertura. `--serial` ejecuta cada paso por separado para diagnosticar.
 */
function pasos({ sinIa }) {
  return [
    { nombre: 'Tipos', comando: 'npx', argumentos: ['tsc', '--noEmit'], grupo: 1 },
    { nombre: 'Lint', comando: 'npm', argumentos: ['run', 'lint'], grupo: 1 },
    { nombre: 'Unitarios', comando: 'npm', argumentos: ['run', 'test:unit'], grupo: 1 },
    // El reporter de línea evita que el progreso de Playwright se mezcle con los otros procesos.
    { nombre: 'E2E', comando: 'npm', argumentos: ['run', 'test:e2e', '--', '--reporter=line'], grupo: 2 },
    ...(sinIa ? [] : [{ nombre: 'IA', comando: 'npm', argumentos: ['run', 'evaluar:regresion'], grupo: 2 }]),
  ];
}

async function correrGrupo(pasosDelGrupo) {
  const asentados = await Promise.allSettled(pasosDelGrupo.map((paso) => ejecutar(paso)));
  return asentados.map((resultado, i) => {
    if (resultado.status === 'fulfilled') return resultado.value;
    console.error(`[${pasosDelGrupo[i].nombre}] ${resultado.reason?.message ?? resultado.reason}`);
    return { codigo: 1, ms: 0 };
  });
}

/**
 * Verifica la entrega antes de empaquetarla. La IA sigue siendo obligatoria; `--sin-ia` solo existe para
 * una caída del proveedor y `--serial` sirve para diagnosticar un fallo que solo aparece al ejecutar todo
 * junto. Sin `--serial`, los grupos corren en paralelo y el total es el del grupo más lento, no la suma.
 */
export async function verificar({ sinIa = false, serial = false } = {}) {
  const lista = pasos({ sinIa });
  console.log(
    `\n▶ Verificación ${serial ? 'en serie' : 'por grupos en paralelo'}: ${lista.map((p) => p.nombre).join(', ')}…`,
  );
  const resultados = new Map();
  if (serial) {
    for (const paso of lista) {
      const resultado = await ejecutar(paso);
      resultados.set(paso, resultado);
      if (resultado.codigo !== 0) break;
    }
  } else {
    const grupos = [...new Set(lista.map((paso) => paso.grupo))].sort((a, b) => a - b);
    for (const grupo of grupos) {
      const delGrupo = lista.filter((paso) => paso.grupo === grupo);
      console.log(`\n▶ Grupo ${grupo}: ${delGrupo.map((paso) => paso.nombre).join(', ')}…`);
      const salida = await correrGrupo(delGrupo);
      salida.forEach((resultado, i) => resultados.set(delGrupo[i], resultado));
      if (salida.some((resultado) => resultado.codigo !== 0)) break;
    }
  }
  const fallas = [];
  for (const paso of lista) {
    const resultado = resultados.get(paso);
    if (!resultado) {
      console.log(`— ${paso.nombre}: no ejecutado`);
      continue;
    }
    const bien = resultado.codigo === 0;
    console.log(`${bien ? '✔' : '✘'} ${paso.nombre} (${(resultado.ms / 1000).toFixed(1)} s)`);
    if (!bien) fallas.push(paso.nombre);
  }
  if (sinIa) console.warn(advertenciaSinIa());
  if (fallas.length)
    throw new Error(
      `${fallas.join(', ')}: falló. No se despliega; corrige el problema y vuelve a intentarlo.` +
        (fallas.includes('IA') ? ' Si el proveedor de IA no respondía, repite más tarde.' : ''),
    );
  console.log('\nVerificación completa.');
}

// Solo al ejecutarlo: deploy.mjs lo importa para reutilizar la misma verificación.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    options: {
      'sin-ia': { type: 'boolean' },
      serial: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(
      'Uso: npm run verificar -- [--sin-ia] [--serial]\n' +
        'Por omisión los grupos de verificación corren en paralelo.\n' +
        '--serial ejecuta cada paso por separado para diagnosticar.\n' +
        '--sin-ia omite la evaluación de la IA solo si el proveedor no responde.',
    );
    process.exit(0);
  }
  verificar({ sinIa: values['sin-ia'], serial: values.serial }).catch((error) => {
    console.error(`No se pudo verificar: ${error.message}`);
    process.exitCode = 1;
  });
}
