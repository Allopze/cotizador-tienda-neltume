// Inspección reproducible sin acceder a las columnas confidenciales.
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { abrirXlsx } from '../src/catalogo/xlsx';
const root = 'datos-privados';
const files = (await readdir(root)).filter((f) => f.endsWith('.xlsx'));
const principal = await abrirXlsx(join(root, 'COTIZADOR_2026.xlsx'));
const permitido = (c: string, r: number) =>
  r >= 4 && ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'O', 'P'].includes(c);
const actual = principal.leer('Precio', permitido);
const lineas = [
  '# Verificación de fuentes',
  '',
  'Este script no procesa reunion.pdf: la transcripción se revisa manualmente y sus conclusiones (uso interno, revisión humana, correlativo automático, datos del cliente en el mensaje, salida PDF y nota de pedido tras la aprobación) están en el README.',
  '',
];
for (const f of files) {
  const x = await abrirXlsx(join(root, f));
  lineas.push(`- **${f}**: hojas ${x.hojas.map((n) => `\`${n}\``).join(', ')}.`);
  if (f.includes('rev-4F')) {
    const previo = x.leer('Precio', permitido);
    const igual = JSON.stringify([...actual]) === JSON.stringify([...previo]);
    lineas.push(
      `  Comparación A–G, O y P de Precio: ${igual ? 'idénticas' : 'diferencias detectadas'}. H–N no se compararon por confidencialidad.`,
    );
    const q = x.leer('Cotización', (c, r) => c === 'Q' && r === 8);
    lineas.push(`  Q8: ${Math.round(Number(q.get('Q8')?.valor) * 10000) / 100} %.`);
  }
  if (f.includes('NOTA DE PEDIDO')) {
    const h = x.leer(
      'Cotización Tipo',
      (c, r) =>
        (c === 'B' && r >= 3 && r <= 10) ||
        (r === 14 && ['B', 'C', 'D', 'E', 'F'].includes(c)) ||
        (c === 'E' && r === 2),
    );
    lineas.push(
      `  Encabezado verificado: ${h.get('E2')?.valor}. Tabla: ${['B', 'C', 'D', 'E', 'F'].map((c) => h.get(`${c}14`)?.valor).join(' / ')}.`,
    );
  }
  if (f.includes('ENCHAPADAS'))
    lineas.push('  Solo se listaron sus hojas; no se leyeron celdas. Línea y proveedor fuera de alcance.');
}
lineas.push(
  '',
  'LibreOffice no está instalado. No se ejecutó recálculo de paridad; se verifican los ocho oráculos de la especificación sobre precios netos reales en npm test.',
  '',
);
await writeFile('data/verificacion-fuentes.md', lineas.join('\n'));
console.log('Verificación guardada en data/verificacion-fuentes.md');
