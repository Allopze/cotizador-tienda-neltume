import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clienteVacio, type Catalogo, type Producto, type SolicitudItem } from '../src/catalogo/tipos';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { chromiumPath } from '../src/servidor/chromium';
import { cerrarNavegadorPdf } from '../src/servidor/pdf';
import { guardarCatalogo, RepositorioCatalogoSqlite } from '../src/servidor/repositorio-catalogo';
import { Servicio } from '../src/servidor/servicio';

// Regenerar un PDF perdido se comprueba sobre el PDF de verdad (Chromium + pdfjs-dist), no sobre el HTML: el
// documento recuperado debe decir lo mismo que el emitido aunque el catálogo y los datos de la empresa cambien.
// Sin Chrome o Chromium en el equipo, la prueba se omite.

const molco: Producto = {
  codigo: 'MOL-O-3-A',
  modelo: 'MOLCO',
  familia: 'PUERTA',
  tipo: 'PUERTA PANEL',
  madera: 'PINO OREGON',
  medida: '0,80 A 0,85',
  anchoMin: 0.8,
  anchoMax: 0.85,
  largo: 2,
  precioNeto: 100_000,
  descripcion: 'MOLCO PINO OREGON 0,80 A 0,85 MT X 2 MT',
  filaOrigen: 4,
};
const catalogo: Catalogo = { fuente: 'test', sha256: 'test', fecha: '2026-01-01', productos: [molco] };
const pedido: SolicitudItem = {
  modelo: 'MOLCO',
  madera: 'PINO OREGON',
  ancho: 0.82,
  alto: 2,
  medida: null,
  cantidad: 2,
  tipoMedida: 'hoja',
};

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});
afterAll(() => cerrarNavegadorPdf());

async function textoPdf(ruta: string) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const carga = pdfjs.getDocument({
    data: new Uint8Array(await readFile(ruta)),
    useSystemFonts: false,
  });
  const documento = await carga.promise;
  const paginas: string[] = [];
  for (let n = 1; n <= documento.numPages; n++) {
    const contenido = await (await documento.getPage(n)).getTextContent();
    paginas.push(contenido.items.map((i) => ('str' in i ? i.str : '')).join(' '));
  }
  await carga.destroy();
  return paginas.join('\n').replace(/\s+/g, ' ').trim();
}

describe.skipIf(!chromiumPath())('Regenerar un PDF perdido (texto del PDF real)', () => {
  it('el PDF recuperado dice lo mismo que el emitido aunque cambien el precio y la empresa', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'neltume-pdf-texto-'));
    dirs.push(dir);
    vi.stubEnv('NELTUME_EMPRESA_TELEFONO', '+56 9 1111 1111');
    const almacen = new Almacen(dir);
    guardarCatalogo(almacen.baseDatos(), catalogo);
    const llm = {
      interpretar: vi.fn().mockResolvedValue({
        name: 'actualizar_cotizacion',
        input: { items: [pedido], cliente: { ...clienteVacio(), nombre: 'Ana Soto' } },
      }),
    };
    const servicio = new Servicio(new RepositorioCatalogoSqlite(almacen.baseDatos()), llm, almacen, {
      nombre: 'Paula',
      email: 'paula@neltume.cl',
    });
    let q = (await servicio.ejecutar({ tipo: 'chat', mensaje: 'cotiza MOLCO' })).cotizacion;
    q = (await servicio.ejecutar({ tipo: 'emitir', id: q.id, actualizada: q.actualizada })).cotizacion;
    const ruta = join(dir, 'pdf', q.pdf!);
    const emitido = await textoPdf(ruta);
    expect(emitido).toContain(`${q.numero}`);
    expect(emitido).toContain('Ana Soto');
    expect(emitido).toContain('+56 9 1111 1111');
    const total = q.montos.total.toLocaleString('es-CL');
    expect(emitido).toContain(total);

    // Después de emitir: sube el precio de fábrica, cambia el teléfono de la empresa y se pierde el archivo.
    await almacen.guardarCatalogo({ ...catalogo, sha256: 'nuevo', productos: [{ ...molco, precioNeto: 150_000 }] });
    vi.stubEnv('NELTUME_EMPRESA_TELEFONO', '+56 9 2222 2222');
    await rm(ruta);
    const r = await servicio.ejecutar({ tipo: 'regenerar_pdf', id: q.id, actualizada: q.actualizada, documento: 'cotizacion' });
    expect(r.archivo).toBe(q.pdf);
    const recuperado = await textoPdf(ruta);
    expect(recuperado).toBe(emitido);
    expect(recuperado).not.toContain('+56 9 2222 2222');
  }, 60_000);
});
