import { afterEach, describe, expect, it } from 'vitest';
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ErrorImportacion } from '../src/catalogo/importar';
import { importarEnchapadas } from '../src/catalogo/enchapadas';
import { detectarPlanilla, importarPlanilla } from '../src/catalogo/planilla';
import { abrirXlsx } from '../src/catalogo/xlsx';
import { CONFIGURACION_CATALOGO_BASE, validarConfiguracionCatalogo } from '../src/catalogo/configuracion';
import {
  cabeceraMarco,
  cabeceraPuerta,
  escribirXlsx,
  filasMarco,
  filasPuerta,
  planillaEnchapadas,
  tituloPuerta,
  type Hojas,
} from './fixture-xlsx';

const limpiezas: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const limpiar of limpiezas.splice(0)) await limpiar();
});
async function importar(
  hojas: Hojas = planillaEnchapadas(),
  config?: Parameters<typeof importarEnchapadas>[1],
) {
  const { ruta, limpiar } = await escribirXlsx(hojas);
  limpiezas.push(limpiar);
  return importarEnchapadas(ruta, config);
}
const porCodigo = async (hojas?: Hojas) =>
  new Map((await importar(hojas)).catalogo.productos.map((p) => [p.codigo, p]));

describe('planilla de enchapadas, prepintadas y marcos Pino Finger', () => {
  it('lee todos los bloques: puertas con rango de alto y ancho exacto, y sets de marco en mm', async () => {
    const r = await importar();
    expect(r.catalogo.origen).toBe('enchapadas');
    expect(r.catalogo.productos).toHaveLength(27);
    expect(r.conteos).toEqual({ PUERTA: 19, MARCO: 8, PIEZAS_T: 0, MOLDURA: 0 });
    const p = await porCodigo();
    expect(p.get('HUIL-EM-085-240')).toEqual({
      codigo: 'HUIL-EM-085-240',
      modelo: 'Huilo Huilo',
      familia: 'PUERTA',
      tipo: 'PUERTA ENCHAPADA',
      madera: 'MARA ENCHAPADA',
      medida: '0,85',
      anchoMin: 0.85,
      anchoMax: 0.85,
      altoMin: 2.21,
      altoMax: 2.4,
      largo: 2.4,
      precioNeto: 102019,
      descripcion: 'HUILO HUILO MARA ENCHAPADA 0,85 MT X 2,21 A 2,4 MT',
      filaOrigen: 26,
    });
    expect(p.get('HUIL-PP-070-220')).toMatchObject({
      tipo: 'PUERTA PREPINTADA',
      madera: 'PREPINTADA',
      medida: '0,70',
      altoMin: 2,
      altoMax: 2.2,
      largo: 2.2,
      precioNeto: 35461,
      descripcion: 'HUILO HUILO PREPINTADA 0,7 MT X 2 A 2,2 MT',
      filaOrigen: 6,
    });
    // «Los Ríos» es un modelo nuevo: aparece con su propio nombre y su propia abreviatura.
    expect(p.get('LOSR-EM-070-220')).toMatchObject({
      modelo: 'LOS RIOS',
      madera: 'MARA ENCHAPADA',
      precioNeto: 73660,
    });
    expect(p.get('MARC-PF-30X70-220')).toEqual({
      codigo: 'MARC-PF-30X70-220',
      modelo: 'MARCO',
      familia: 'MARCO',
      tipo: 'SET DE MARCO DESNUDO',
      madera: 'PINO FINGER',
      medida: '30X70',
      anchoMin: null,
      anchoMax: null,
      largo: 2.2,
      precioNeto: 11190,
      descripcion: 'MARCO PINO FINGER 30X70 MM SET X 2,2 MT',
      filaOrigen: 6,
    });
    expect(p.get('MARC-FE-30X90-250')).toMatchObject({
      tipo: 'SET DE MARCO ENCHAPADO',
      madera: 'PINO FINGER ENCHAPADO MARA',
      medida: '30X90',
      largo: 2.5,
      precioNeto: 47870,
      descripcion: 'MARCO PINO FINGER ENCHAPADO MARA 30X90 MM SET X 2,5 MT',
    });
    expect(p.get('MARC-PF-30X70-300')?.descripcion).toBe('MARCO PINO FINGER 30X70 MM SET X 3 MT');
    expect(r.catalogo.productos.filter((x) => /\p{Ll}/u.test(x.descripcion))).toEqual([]);
  });

  it('el precio neto es el costo «+ IVA»: las columnas de venta, margen y descuento no se leen', async () => {
    const r = await importar();
    const costos = new Set([
      35461, 43416, 45230, 53840, 78437, 87384, 88740, 89994, 91140, 90144, 99230, 100625, 102019, 104578,
      34230, 42083, 73660, 11190, 12295, 12785, 15240, 14980, 38541, 46250, 47870,
    ]);
    for (const p of r.catalogo.productos) expect(costos.has(p.precioNeto), p.codigo).toBe(true);
    expect(r.catalogo.productos.some((p) => [111, 222, 9].includes(p.precioNeto))).toBe(false);
    // Solo se leen las columnas B a D.
    const { ruta, limpiar } = await escribirXlsx(planillaEnchapadas());
    limpiezas.push(limpiar);
    const leidas: string[] = [];
    const x = await abrirXlsx(ruta);
    const leer = x.leer.bind(x);
    x.leer = (nombre, permitir) => {
      const hoja = leer(nombre, (c, f) => {
        const ok = permitir(c, f);
        if (ok) leidas.push(c);
        return ok;
      });
      return hoja;
    };
    await importarEnchapadas(ruta, undefined, x);
    expect([...new Set(leidas)].sort()).toEqual(['B', 'C', 'D']);
  });

  it('los códigos son estables (mismo archivo, mismos códigos), únicos y no chocan con los de la planilla principal', async () => {
    const a = await importar();
    const b = await importar();
    expect(b.catalogo.productos.map((p) => p.codigo)).toEqual(a.catalogo.productos.map((p) => p.codigo));
    const codigos = a.catalogo.productos.map((p) => p.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
    // Las maderas de la principal usan O, L, M y R; estas terminaciones, PP, EM, PF y FE: nunca coinciden.
    for (const c of codigos) expect(c).toMatch(/^[A-Z]{4,}-(PP|EM|PF|FE)-(\d{3}|\d+X\d+)-\d{3}$/);
    // El código depende del producto y no del orden de las hojas.
    const inversas = Object.fromEntries(Object.entries(planillaEnchapadas()).reverse());
    const c = await importar(inversas);
    expect(new Map(c.catalogo.productos.map((p) => [p.codigo, [p.modelo, p.madera, p.precioNeto]]))).toEqual(
      new Map(a.catalogo.productos.map((p) => [p.codigo, [p.modelo, p.madera, p.precioNeto]])),
    );
  });

  it('un bloque desconocido, una fila ilegible o un costo escrito como texto quedan en las incidencias y nunca inventan un precio', async () => {
    const hojas = planillaEnchapadas();
    hojas['LOS RIOS ENCHP'] = {
      ...hojas['LOS RIOS ENCHP'],
      ...filasPuerta(13, [
        ['2,00 A 2,20 MTS', '0,80 MT', '84.123'], // «84.123» como texto se leería como 84,123
        ['alto a convenir', '0,85 MT', 85615],
        ['2,00 A 2,20 MTS', '0,90 MT', 0],
      ]),
    };
    const r = await importar(hojas);
    const ilegibles = r.incidencias.filter((i) => /ilegible/.test(i.detalle));
    expect(ilegibles.map((i) => [i.hoja, i.fila])).toEqual([
      ['LOS RIOS ENCHP', 13],
      ['LOS RIOS ENCHP', 14],
      ['LOS RIOS ENCHP', 15],
    ]);
    expect(r.incidencias.find((i) => /ENDOLADO/.test(i.detalle))).toMatchObject({
      hoja: 'MARCOS ',
      fila: 28,
      accion: 'exclusion',
      detalle: expect.stringMatching(/no reconocido/),
    });
    expect(r.catalogo.productos).toHaveLength(27);
    expect(
      r.catalogo.productos.some(
        (p) => p.codigo.startsWith('LOSR-EM-08') || p.codigo.startsWith('LOSR-EM-09'),
      ),
    ).toBe(false);
  });

  it('rechaza la planilla completa si demasiadas filas son ilegibles o si un producto se repite con otro costo', async () => {
    const dañada = planillaEnchapadas();
    dañada['LOS RIOS ENCHP'] = {
      ...dañada['LOS RIOS ENCHP'],
      ...filasPuerta(
        13,
        Array.from({ length: 6 }, () => ['sin medida', '0,80 MT', 1000] as [string, string, number]),
      ),
    };
    await expect(importar(dañada)).rejects.toThrow(ErrorImportacion);
    await expect(importar(dañada)).rejects.toThrow(/6 de 33 filas de medidas no se pueden leer/);

    const conflicto = planillaEnchapadas();
    conflicto['LOS RIOS ENCHP'] = {
      ...conflicto['LOS RIOS ENCHP'],
      ...filasPuerta(13, [['2,00 A 2,20 MTS', '0,70 MT', 99999]]),
    };
    await expect(importar(conflicto)).rejects.toThrow(
      /repite 1 producto\(s\) con costos distintos.*LOSR-EM-070-220/,
    );

    const identico = planillaEnchapadas();
    identico['LOS RIOS ENCHP'] = {
      ...identico['LOS RIOS ENCHP'],
      ...filasPuerta(13, [['2,00 A 2,20 MTS', '0,70 MT', 73660]]),
    };
    const r = await importar(identico);
    expect(r.catalogo.productos).toHaveLength(27);
    expect(
      r.incidencias.filter((i) => i.detalle === 'Código o atributos duplicados.').map((i) => i.fila),
    ).toEqual([13]);
  });

  it('un encabezado de costo que no dice «+ IVA» o un bloque sin encabezado no se importan', async () => {
    const sinIva = planillaEnchapadas();
    sinIva['LOS RIOS ENCHP'] = { ...sinIva['LOS RIOS ENCHP'], D4: 'VALOR COSTO CON IVA INCLUIDO' };
    const r = await importar(sinIva);
    expect(r.catalogo.productos.some((p) => p.modelo === 'LOS RIOS' && p.madera === 'PREPINTADA')).toBe(
      false,
    );
    expect(r.catalogo.productos.some((p) => p.modelo === 'LOS RIOS' && p.madera === 'MARA ENCHAPADA')).toBe(
      true,
    );
    expect(r.incidencias.find((i) => i.fila === 3)?.detalle).toMatch(
      /«LOS RIOS PREPINTADA» no indica «\+ IVA»/,
    );

    // Si se borra el encabezado del segundo bloque, sus filas no pasan al bloque anterior.
    const sinCabecera = planillaEnchapadas();
    const hoja = { ...sinCabecera['LOS RIOS ENCHP'] };
    for (const col of 'BCDEFGH') delete hoja[`${col}10`];
    sinCabecera['LOS RIOS ENCHP'] = hoja;
    const s = await importar(sinCabecera);
    expect([...(await porCodigo(sinCabecera)).keys()].filter((c) => c.startsWith('LOSR'))).toEqual([
      'LOSR-PP-070-220',
      'LOSR-PP-075-220',
    ]);
    expect(s.incidencias.find((i) => i.hoja === 'LOS RIOS ENCHP' && i.fila === 9)?.detalle).toMatch(
      /no tienen encabezado de costo/,
    );
  });

  it('sin ningún producto legible falla con un mensaje claro', async () => {
    await expect(
      importar({
        Hoja: {
          B3: 'SIN RECONOCER',
          ...cabeceraPuerta(4),
          ...filasPuerta(6, [['2,00 A 2,20 MTS', '0,70 MT', 1000]]),
        },
      }),
    ).rejects.toThrow(/no trae ningún producto legible/);
  });
});

describe('detección de la planilla por su forma', () => {
  it('reconoce la de enchapadas con cualquier nombre de archivo y la principal por sus hojas', async () => {
    const { ruta, limpiar } = await escribirXlsx(planillaEnchapadas(), 'lo-que-sea.xlsx');
    limpiezas.push(limpiar);
    expect(detectarPlanilla(await abrirXlsx(ruta))).toBe('enchapadas');
    const otra = join(ruta, '..', 'VALORES PUERTAS ENCHAPADAS_NELTUME.CO.xlsx');
    await copyFile(ruta, otra);
    expect((await importarPlanilla(otra)).origen).toBe('enchapadas');
    const principal = await escribirXlsx({
      Precio: { A4: 'x' },
      Categorias: { A4: 'x' },
      Cotización: { C8: 'x' },
    });
    limpiezas.push(principal.limpiar);
    expect(detectarPlanilla(await abrirXlsx(principal.ruta))).toBe('principal');
  });

  it('un libro desconocido falla antes de leer nada y dice qué formatos acepta', async () => {
    const { ruta, limpiar } = await escribirXlsx({
      Ventas: { B2: 'CLIENTE', C2: 'MONTO', B3: 'Pérez', C3: 1000 },
      MEDIDAS: { B2: 'MEDIDAS', C2: 'ALGO' },
    });
    limpiezas.push(limpiar);
    expect(detectarPlanilla(await abrirXlsx(ruta))).toBeNull();
    await expect(importarPlanilla(ruta)).rejects.toThrow(ErrorImportacion);
    await expect(importarPlanilla(ruta)).rejects.toThrow(
      /No reconozco esta planilla.*puertas sólidas.*enchapadas.*no se modificó/,
    );
  });

  it('un archivo que no es un Excel falla con ErrorImportacion', async () => {
    const { ruta, limpiar } = await escribirXlsx({ Hoja: { B2: 'x' } });
    limpiezas.push(limpiar);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(ruta, 'esto no es un zip');
    await expect(importarPlanilla(ruta)).rejects.toThrow(ErrorImportacion);
  });
});

describe('maderas de la planilla en la configuración', () => {
  it('se agregan a una configuración guardada antes de esta planilla, con sus códigos', async () => {
    const antigua = validarConfiguracionCatalogo({
      maderas: CONFIGURACION_CATALOGO_BASE.maderas.slice(0, 4),
    });
    expect(antigua.maderas.map((m) => m.nombre)).toEqual(['PINO OREGON', 'LENGA', 'MARA', 'RAULI']);
    const r = await importar(planillaEnchapadas(), antigua);
    expect(r.configuracion.maderas.map((m) => [m.nombre, m.codigo])).toEqual([
      ['PINO OREGON', 'O'],
      ['LENGA', 'L'],
      ['MARA', 'M'],
      ['RAULI', 'R'],
      ['PREPINTADA', 'PP'],
      ['MARA ENCHAPADA', 'EM'],
      ['PINO FINGER', 'PF'],
      ['PINO FINGER ENCHAPADO MARA', 'FE'],
    ]);
  });

  it('una configuración guardada recibe los alias nuevos de la base, sin quitarle uno a otra madera', () => {
    const aliasEnchapada = (maderas: typeof CONFIGURACION_CATALOGO_BASE.maderas) =>
      validarConfiguracionCatalogo({ maderas }).maderas.find((m) => m.nombre === 'MARA ENCHAPADA')!.alias;
    // Guardada antes de «encha mara».
    const guardada = CONFIGURACION_CATALOGO_BASE.maderas.map((m) =>
      m.nombre === 'MARA ENCHAPADA' ? { ...m, alias: ['ENCHAPADA', 'ENCHAPE EN MARA'] } : m,
    );
    expect(aliasEnchapada(guardada)).toEqual(
      expect.arrayContaining(['ENCHAPADA', 'ENCHA MARA', 'ENCHA EN MARA']),
    );
    // Si otra madera ya usa «encha mara», se queda con ella y la carga no falla.
    const ajena = [...guardada, { nombre: 'MARA ESPECIAL', codigo: 'ME', alias: ['ENCHA MARA'] }];
    expect(aliasEnchapada(ajena)).not.toContain('ENCHA MARA');
    expect(aliasEnchapada(ajena)).toContain('ENCHA EN MARA');
  });

  it('un alias o código de la configuración que choca con ellas es un error de importación explícito', async () => {
    const choque = validarConfiguracionCatalogo({
      maderas: [
        ...CONFIGURACION_CATALOGO_BASE.maderas.slice(0, 4),
        { nombre: 'FINGER JOINT', codigo: 'FJ', alias: ['FINGER'] },
      ],
    });
    await expect(importar(planillaEnchapadas(), choque)).rejects.toThrow(
      /choca con las maderas de esta planilla.*FINGER/,
    );
  });
});

describe('forma de los bloques', () => {
  it('admite alto exacto, columnas en otras hojas y hojas sin bloques', async () => {
    const r = await importar({
      Resumen: { B2: 'Notas', C2: 'Precios de fábrica' },
      Coz: {
        ...tituloPuerta(3, 'COZ COZ PREPINTADA'),
        ...cabeceraPuerta(4),
        ...filasPuerta(6, [['2,10 MTS', '0,65 MT', 38350]]),
      },
      Marcos: {
        ...tituloPuerta(2, 'SET DE MARCO EN PINO FINGER'),
        ...cabeceraMarco(3),
        ...filasMarco(5, [['SET DE MARCO 30 X 70 MM LARGO 2,20 MTS', 11190]]),
      },
    });
    expect(r.catalogo.productos.map((p) => [p.codigo, p.altoMin, p.altoMax, p.largo, p.medida])).toEqual([
      ['COZC-PP-065-210', 2.1, 2.1, 2.1, '0,65'],
      ['MARC-PF-30X70-220', undefined, undefined, 2.2, '30X70'],
    ]);
  });

  it('dos modelos con las mismas 4 primeras letras se abrevian más largo, sin chocar', async () => {
    const r = await importar({
      Uno: {
        ...tituloPuerta(3, 'LOS RIOS PREPINTADA'),
        ...cabeceraPuerta(4),
        ...filasPuerta(6, [['2,10 MTS', '0,70 MT', 1000]]),
      },
      Dos: {
        ...tituloPuerta(3, 'LOS RIOSA PREPINTADA'),
        ...cabeceraPuerta(4),
        ...filasPuerta(6, [['2,10 MTS', '0,70 MT', 2000]]),
      },
    });
    expect(r.catalogo.productos.map((p) => p.codigo)).toEqual(['LOSRIOS-PP-070-210', 'LOSRIOSA-PP-070-210']);
  });
});
