import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { abrirXlsx, type Hoja } from './xlsx';
import {
  normalizarCatalogo,
  resolverMaderaConfigurada,
  validarConfiguracionCatalogo,
  type ConfiguracionCatalogo,
} from './configuracion';
import type { Catalogo, Producto } from './tipos';
const decimal = (v: unknown) => String(v).replace('.', ',');
const limpio = (v: unknown) =>
  String(v ?? '')
    .trim()
    .toUpperCase();
const num = (v: unknown) => Math.round(Number(v) * 10000) / 10000;
export interface Incidencia {
  fila: number;
  accion: 'correccion' | 'exclusion';
  detalle: string;
}
export function descripcion(p: Producto) {
  const base = `${p.modelo} ${p.madera === 'RAULI' ? 'RAULÍ' : p.madera} ${p.medida}`;
  if (p.familia === 'PUERTA') return `${base} MT X ${decimal(p.largo)} MT`;
  if (p.familia === 'MOLDURA') return `${base} CM X ${decimal(p.largo)} MT`;
  return p.largo < 3 ? `${base} PULG KIT` : `${base} PULG X ${decimal(p.largo)} MT`;
}
export async function importar(ruta: string, configEntrada?: ConfiguracionCatalogo) {
  const configuracion = validarConfiguracionCatalogo(configEntrada ?? {});
  const x = await abrirXlsx(ruta);
  const precio = x.leer(
    'Precio',
    (c, r) => r >= 4 && ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'O', 'P'].includes(c),
  );
  const cats = x.leer(
    'Categorias',
    (c, r) =>
      (['O', 'P', 'R', 'S', 'U', 'V'].includes(c) && r >= 4 && r <= 500) ||
      (c === 'G' && r >= 4 && r <= 500),
  );
  const plantilla = x.leer('Cotización', (c, r) => ['C', 'P', 'Q'].includes(c) && r >= 8 && r <= 32);
  const get = (h: Hoja, c: string, r: number) => h.get(`${c}${r}`)?.valor;
  function tabla(a: string, b: string, desde: number, hasta: number) {
    const map = new Map<string, string>();
    for (let i = desde; i <= hasta; i++) {
      const k = get(cats, a, i),
        v = get(cats, b, i);
      if (k != null && v != null) map.set(typeof k === 'number' ? String(num(k)) : limpio(k), limpio(v));
    }
    return map;
  }
  const modelos = tabla('O', 'P', 4, 500),
    medidas = tabla('R', 'S', 4, 500),
    largos = tabla('U', 'V', 4, 500);
  const maderaCodigo = new Map(
      configuracion.maderas.map((madera) => [normalizarCatalogo(madera.nombre), madera.codigo.toUpperCase()]),
    ),
    maderaPorCodigo = new Map(
      configuracion.maderas.map((madera) => [madera.codigo.toUpperCase(), madera.nombre]),
    ),
    maderaPorNombreHoja = new Set(
      Array.from({ length: 497 }, (_, i) => get(cats, 'G', i + 4))
        .filter((valor) => valor != null)
        .map((valor) => normalizarCatalogo(String(valor))),
    ),
    familiaModelo = new Map(
      Object.entries(configuracion.familiasPorModelo).map(([modelo, familia]) => [
        normalizarCatalogo(modelo),
        familia,
      ]),
    );
  const codigoCalculado = (p: Producto) => {
    const letra = largos.get(p.familia === 'MOLDURA' ? `${p.medida}X${decimal(p.largo)}` : String(p.largo));
    const seg = medidas.get(p.medida),
      abrev = modelos.get(p.modelo),
      madera = maderaCodigo.get(normalizarCatalogo(p.madera));
    return letra && seg && abrev && madera ? `${abrev}-${madera}-${seg}-${letra}` : null;
  };
  const clave = (p: Producto) => `${p.modelo}|${p.madera}|${p.medida}|${p.largo}`;
  const filas = [...new Set([...precio.keys()].map((k) => Number(k.replace(/[A-Z]/g, ''))))].sort(
    (a, b) => a - b,
  );
  const originales: Producto[] = [];
  const incidencias: Incidencia[] = [];
  for (const r of filas) {
    const codigo = limpio(get(precio, 'A', r));
    if (!codigo) continue;
    const modelo = limpio(get(precio, 'B', r)),
      tipo = limpio(get(precio, 'C', r)) || null;
    const familia = familiaModelo.get(normalizarCatalogo(modelo)) ?? 'PUERTA';
    const medida =
      familia === 'PUERTA'
        ? limpio(get(precio, 'D', r))
        : familia === 'MOLDURA'
          ? codigo.split('-')[2]
          : `2X${get(precio, 'D', r)}`;
    const anchos = familia === 'PUERTA' ? medida.split(' A ').map((n) => Number(n.replace(',', '.'))) : [];
    const maderaHoja = limpio(get(precio, 'G', r))
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const maderaConfigurada = resolverMaderaConfigurada(maderaHoja, configuracion);
    const p: Producto = {
      codigo,
      modelo,
      familia,
      tipo,
      madera: maderaConfigurada ?? maderaHoja,
      medida,
      anchoMin: anchos[0] ?? null,
      anchoMax: anchos[1] ?? null,
      largo: num(get(precio, 'F', r)),
      precioNeto: num(get(precio, 'O', r)),
      descripcion: '',
      filaOrigen: r,
    };
    const bruto = Number(get(precio, 'O', r)),
      conIva = Number(get(precio, 'P', r));
    if (
      !Number.isFinite(p.precioNeto) ||
      p.precioNeto <= 0 ||
      !maderaConfigurada ||
      !maderaPorNombreHoja.has(normalizarCatalogo(maderaConfigurada)) ||
      !codigoCalculado(p) ||
      Math.abs(conIva - bruto * 1.19) > 0.01
    ) {
      incidencias.push({
        fila: r,
        accion: 'exclusion',
        detalle: 'Datos incompletos o precio neto/IVA inconsistente.',
      });
      continue;
    }
    originales.push(p);
  }
  const codigos = new Map<string, number[]>(),
    atributos = new Map<string, number[]>();
  for (const p of originales) {
    codigos.set(p.codigo, [...(codigos.get(p.codigo) ?? []), p.filaOrigen]);
    atributos.set(clave(p), [...(atributos.get(clave(p)) ?? []), p.filaOrigen]);
  }
  const hayOtro = (map: Map<string, number[]>, k: string, fila: number) =>
    (map.get(k) ?? []).some((r) => r !== fila);
  const candidatos: Producto[] = [];
  for (const original of originales) {
    let p = { ...original };
    const calculado = codigoCalculado(p)!;
    if (p.codigo !== calculado) {
      const [abrev, madera, seg, letra] = p.codigo.split('-');
      const modelo = [...modelos].find(([, v]) => v === abrev)?.[0];
      const especie = maderaPorCodigo.get(madera);
      const medida = [...medidas].find(([, v]) => v === seg)?.[0];
      const largoClave = [...largos].find(
        ([k, v]) => v === letra && (p.familia === 'MOLDURA' ? k.startsWith(`${seg}X`) : !k.includes('X')),
      )?.[0];
      const largo = largoClave
        ? Number((p.familia === 'MOLDURA' ? largoClave.split('X').at(-1)! : largoClave).replace(',', '.'))
        : NaN;
      const b = { ...p, modelo: modelo!, madera: especie!, medida: medida!, largo };
      const aValida = !hayOtro(codigos, calculado, p.filaOrigen);
      const bValida =
        !!modelo &&
        !!especie &&
        !!medida &&
        Number.isFinite(largo) &&
        !hayOtro(atributos, clave(b), p.filaOrigen);
      if (aValida === bValida) {
        incidencias.push({
          fila: p.filaOrigen,
          accion: 'exclusion',
          detalle: 'Discrepancia ambigua entre código y atributos.',
        });
        continue;
      }
      p = aValida ? { ...p, codigo: calculado } : b;
      if (p.familia === 'PUERTA')
        [p.anchoMin, p.anchoMax] = p.medida.split(' A ').map((n) => Number(n.replace(',', '.')));
      incidencias.push({
        fila: p.filaOrigen,
        accion: 'correccion',
        detalle: aValida
          ? `Código ${original.codigo} → ${p.codigo}`
          : `${p.codigo}: largo ${decimal(original.largo)} → ${decimal(p.largo)} m`,
      });
    }
    p.descripcion = descripcion(p);
    candidatos.push(p);
  }
  const vistosC = new Set<string>(),
    vistosA = new Set<string>();
  const productos = candidatos.filter((p) => {
    if (vistosC.has(p.codigo) || vistosA.has(clave(p))) {
      incidencias.push({
        fila: p.filaOrigen,
        accion: 'exclusion',
        detalle: 'Código o atributos duplicados.',
      });
      return false;
    }
    vistosC.add(p.codigo);
    vistosA.add(clave(p));
    return true;
  });
  const erroresPlantilla: string[] = [];
  if (!plantilla.get('P25')?.formula && plantilla.get('P25')?.valor === 0)
    erroresPlantilla.push('P25: 0 fijo; el ítem 18 se cotiza a $0.');
  const restringidas = Array.from({ length: 25 }, (_, i) => i + 8).filter((r) =>
    plantilla.get(`C${r}`)?.formula?.includes('$A$3:$O$603'),
  );
  if (restringidas.length) {
    const fuera = Math.round(
      (100 * productos.filter((p) => p.filaOrigen > 603).length) / Math.max(productos.length, 1),
    );
    erroresPlantilla.push(
      `C8:C32: ${restringidas.length} búsquedas limitadas a Precio!$A$3:$O$603 (${fuera} % del catálogo queda fuera).`,
    );
  }
  if (plantilla.get('Q8')?.valor === 0.25)
    erroresPlantilla.push('Q8: +25 % fijo solo en el primer ítem. La versión anterior usa −25 %.');
  const catalogo: Catalogo = {
    fuente: basename(ruta),
    sha256: createHash('sha256').update(x.bytes).digest('hex'),
    fecha: new Date().toISOString(),
    productos,
  };
  const conteos = Object.fromEntries(
    ['PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA'].map((f) => [
      f,
      productos.filter((p) => p.familia === f).length,
    ]),
  );
  const reporte = `# Reporte de importación\n\nFuente: ${catalogo.fuente}\n\nSHA-256: ${catalogo.sha256}\n\nFecha: ${catalogo.fecha}\n\n${productos.length} productos · ${incidencias.filter((i) => i.accion === 'correccion').length} correcciones · ${incidencias.filter((i) => i.accion === 'exclusion').length} exclusiones.\n\n| Familia | Productos |\n|---|---:|\n${Object.entries(
    conteos,
  )
    .map(([f, n]) => `| ${f} | ${n} |`)
    .join(
      '\n',
    )}\n\n## Incidencias\n\n| Fila | Acción | Detalle |\n|---:|---|---|\n${incidencias.map((i) => `| ${i.fila} | ${i.accion} | ${i.detalle} |`).join('\n')}\n\n## Errores de plantilla\n\n${erroresPlantilla.map((e) => `- ${e}`).join('\n')}\n\n## Alcance de lectura\n\nSolo A–G, O y P de Precio; tablas autorizadas de Categorias; C, P y Q de Cotización (8–32). No se decodifican valores ni fórmulas de H–N. El archivo original no se modifica.\n`;
  return { catalogo, reporte, incidencias, erroresPlantilla, conteos, logo: x.zip['xl/media/image2.svg'] };
}
