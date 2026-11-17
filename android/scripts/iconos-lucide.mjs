// Genera android/app/src/main/kotlin/.../diseno/Iconos.kt con los íconos Lucide (ISC) que usa la app, como en la web
// (trazo de 1,5 sobre 24, extremos redondeados). Se corre a mano al agregar un ícono, con lucide-static extraído:
//   npm pack lucide-static@1.74.0 && tar -xzf lucide-static-1.74.0.tgz
//   node android/scripts/iconos-lucide.mjs <carpeta>/package/icons
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const carpeta = process.argv[2];
if (!carpeta) throw new Error('Indica la carpeta icons de lucide-static.');

// nombre en Kotlin → nombre en Lucide
const ICONOS = {
  Cotizar: 'file-text', Historial: 'history', Clientes: 'users', Puerta: 'door-closed', Ajustes: 'sliders-horizontal',
  Ayuda: 'circle-help', Salir: 'log-out', Check: 'check', Mas: 'plus', Menos: 'minus', Abajo: 'chevron-down',
  Arriba: 'chevron-up', Derecha: 'chevron-right', Izquierda: 'chevron-left', ArribaAbajo: 'arrow-up-down',
  Deshacer: 'undo-2', Rehacer: 'redo-2', Ojo: 'eye', OjoTachado: 'eye-off', Camion: 'truck', Enviar: 'arrow-up',
  Buscar: 'search', Cerrar: 'x', Basura: 'trash-2', Copiar: 'copy', Compartir: 'share-2', Descargar: 'download',
  Camara: 'camera', Imagen: 'image', Archivo: 'file', Lapiz: 'pencil', MasOpciones: 'ellipsis-vertical',
  FlechaArriba: 'arrow-up', FlechaAbajo: 'arrow-down', Detener: 'square', Recargar: 'refresh-cw', Usuario: 'user',
  Telefono: 'phone', Ubicacion: 'map-pin', Fabrica: 'factory', Tarjeta: 'credit-card', Recibo: 'receipt',
  Calendario: 'calendar', Reloj: 'clock', Alerta: 'triangle-alert', Info: 'info', Candado: 'lock',
  Libro: 'book-open', Paquete: 'package', Mensaje: 'message-circle', Destellos: 'sparkles', Agarre: 'grip-vertical',
  Externo: 'external-link', Filtro: 'list-filter', Restaurar: 'archive-restore', Volver: 'rotate-ccw',
  CirculoCheck: 'circle-check', CirculoX: 'circle-x', Prohibido: 'ban', Subir: 'upload', Planilla: 'file-spreadsheet',
  Edificio: 'building-2', Llave: 'key-round', Dispositivo: 'monitor-smartphone', Correo: 'mail', Numero: 'hash',
  Porcentaje: 'percent', PuertaAbierta: 'door-open', Regla: 'ruler', Clip: 'paperclip', Bandeja: 'inbox',
  Telefono2: 'smartphone', Duplicar: 'copy-plus', Notas: 'notebook-pen', Enlace: 'link', Billetera: 'wallet',
  Moneda: 'circle-dollar-sign', Lista: 'list', Cuadricula: 'layout-grid', Mano: 'hand', Gorro: 'hard-hat',
  Etiqueta: 'tag', Capas: 'layers', Escudo: 'shield-check', Wifi: 'wifi-off', Pausa: 'pause', Reproducir: 'play',
};

const num = (s) => Number(s ?? 0);
const atributos = (etiqueta) => Object.fromEntries([...etiqueta.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

/** Una figura SVG como `d` de path. */
function trazo(nombre, a) {
  switch (nombre) {
    case 'path':
      return a.d;
    case 'line':
      return `M${a.x1} ${a.y1}L${a.x2} ${a.y2}`;
    case 'polyline':
    case 'polygon': {
      const p = a.points.trim().split(/[\s,]+/);
      let d = `M${p[0]} ${p[1]}`;
      for (let i = 2; i < p.length; i += 2) d += `L${p[i]} ${p[i + 1]}`;
      return nombre === 'polygon' ? `${d}Z` : d;
    }
    case 'circle': {
      const [cx, cy, r] = [num(a.cx), num(a.cy), num(a.r)];
      return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
    }
    case 'ellipse': {
      const [cx, cy, rx, ry] = [num(a.cx), num(a.cy), num(a.rx), num(a.ry)];
      return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`;
    }
    case 'rect': {
      const [x, y, w, h] = [num(a.x), num(a.y), num(a.width), num(a.height)];
      const r = Math.min(num(a.rx ?? a.ry), w / 2, h / 2);
      if (!r) return `M${x} ${y}h${w}v${h}h${-w}Z`;
      return `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
    }
    default:
      throw new Error(`Figura no soportada: ${nombre}`);
  }
}

const faltan = [];
const cuerpos = [];
for (const [kotlin, lucide] of Object.entries(ICONOS)) {
  const archivo = join(carpeta, `${lucide}.svg`);
  if (!existsSync(archivo)) {
    faltan.push(lucide);
    continue;
  }
  const svg = readFileSync(archivo, 'utf8');
  const figuras = [...svg.matchAll(/<(path|line|polyline|polygon|circle|ellipse|rect)\b([^>]*)\/?>/g)].map((m) =>
    trazo(m[1], atributos(m[2])),
  );
  cuerpos.push(
    `    /** Lucide «${lucide}». */\n    val ${kotlin}: ImageVector by lazy { icono("${kotlin}", ${figuras.map((d) => JSON.stringify(d)).join(', ')}) }`,
  );
}
if (faltan.length) throw new Error(`No existen en Lucide: ${faltan.join(', ')}`);

const salida = `// Generado por android/scripts/iconos-lucide.mjs desde lucide-static (ISC). No editar a mano.
package cl.puertasneltume.cotizador.diseno

import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/** Íconos de la app: los mismos trazos Lucide de la web (24 × 24, trazo 1,5, extremos redondeados). */
object Iconos {
${cuerpos.join('\n')}
}

private fun icono(nombre: String, vararg trazos: String): ImageVector {
    val b = ImageVector.Builder(nombre, 24.dp, 24.dp, 24f, 24f)
    for (d in trazos)
        b.addPath(
            pathData = addPathNodes(d),
            fill = null,
            stroke = SolidColor(Color.Black),
            strokeLineWidth = 1.5f,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
        )
    return b.build()
}
`;
const destino = join(
  dirname(fileURLToPath(import.meta.url)),
  '../app/src/main/kotlin/cl/puertasneltume/cotizador/diseno/Iconos.kt',
);
writeFileSync(destino, salida);
console.log(`${cuerpos.length} íconos → ${destino}`);
