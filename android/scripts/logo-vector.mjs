// Convierte public/logo-neltume.svg (solo <path> y <rect>, sin transformaciones) en los VectorDrawable de la app:
// el logo para la interfaz y el splash, y el primer plano del ícono adaptativo. Se corre a mano si cambia el logo:
//   node android/scripts/logo-vector.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const svg = readFileSync(join(raiz, 'public/logo-neltume.svg'), 'utf8');
const [, , , ancho, alto] = /viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg).map(Number);

if (/transform=/.test(svg)) throw new Error('El logo trae transformaciones: el conversor no las aplica.');
const trazos = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
for (const [, atributos] of svg.matchAll(/<rect([^>]*)\/?>/g)) {
  const v = (n) => Number(new RegExp(`\\s${n}="([\\d.]+)"`).exec(atributos)?.[1] ?? 0);
  const [x, y, w, h] = ['x', 'y', 'width', 'height'].map(v);
  trazos.push(`M${x} ${y}H${+(x + w).toFixed(3)}V${+(y + h).toFixed(3)}H${x}Z`);
}

const caminos = (color) => trazos.map((d) => `        <path android:fillColor="${color}" android:pathData="${d}" />`).join('\n');

const logo = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generado por android/scripts/logo-vector.mjs desde public/logo-neltume.svg. No editar a mano. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${ancho.toFixed(2)}dp"
    android:height="${alto.toFixed(2)}dp"
    android:viewportWidth="${ancho}"
    android:viewportHeight="${alto}">
    <group>
${caminos('@color/tinta')}
    </group>
</vector>
`;

// Ícono adaptativo: lienzo de 108 dp con el logo dentro de la zona segura (círculo de 66 dp).
const lado = 108;
const altoLogo = 50;
const escala = altoLogo / alto;
const icono = (color) => `<?xml version="1.0" encoding="utf-8"?>
<!-- Generado por android/scripts/logo-vector.mjs desde public/logo-neltume.svg. No editar a mano. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${lado}dp"
    android:height="${lado}dp"
    android:viewportWidth="${lado}"
    android:viewportHeight="${lado}">
    <group
        android:translateX="${((lado - ancho * escala) / 2).toFixed(3)}"
        android:translateY="${((lado - altoLogo) / 2).toFixed(3)}"
        android:scaleX="${escala.toFixed(5)}"
        android:scaleY="${escala.toFixed(5)}">
${caminos(color)}
    </group>
</vector>
`;

const drawable = join(raiz, 'android/app/src/main/res/drawable');
mkdirSync(drawable, { recursive: true });
writeFileSync(join(drawable, 'logo_neltume.xml'), logo);
writeFileSync(join(drawable, 'ic_launcher_foreground.xml'), icono('@color/bosque_tinta'));
writeFileSync(join(drawable, 'ic_launcher_monochrome.xml'), icono('#FFFFFFFF'));
console.log(`${trazos.length} trazos → logo_neltume, ic_launcher_foreground, ic_launcher_monochrome`);
