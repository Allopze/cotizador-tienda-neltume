import { describe, expect, it } from 'vitest';
import { anclarNombres } from '../src/asistente/anclaje';
import {
  choqueTolerante,
  claveTolerante,
  CONFIGURACION_CATALOGO_BASE,
  modeloParecido,
  normalizarCatalogo,
  resolverMaderaConfigurada,
  resolverModeloConfigurado,
  resolverModeloPosibleConfigurado,
  validarConfiguracionCatalogo,
  type ConfiguracionCatalogo,
} from '../src/catalogo/configuracion';
import { maderaDelCatalogo, resolverItem, resolverNombres, type FuenteCatalogo } from '../src/catalogo/resolver';
import type { Catalogo, Producto, SolicitudItem } from '../src/catalogo/tipos';

const puerta = (codigo: string, modelo: string): Producto => ({
  codigo,
  modelo,
  familia: 'PUERTA',
  tipo: 'PUERTA SÓLIDA',
  madera: 'MARA',
  medida: '0,80 A 0,85',
  anchoMin: 0.8,
  anchoMax: 0.85,
  altoMin: 2.3,
  altoMax: 2.4,
  largo: 2.35,
  precioNeto: 100_000,
  descripcion: `${modelo.toUpperCase()} MARA 0,80 A 0,85 MT X 2,30 A 2,40 MT`,
  filaOrigen: 7,
});
const catalogo: Catalogo = {
  fuente: 'test.xlsx',
  sha256: 'tolerantes',
  fecha: '2026-01-01T00:00:00.000Z',
  productos: [puerta('HUI-M-3-A', 'Huilo Huilo'), puerta('PAN-M-3-A', 'PANGUIPULLI')],
};
const pedido = (modelo: string | null, extra: Record<string, unknown> = {}) => ({
  modelo,
  madera: 'Mara',
  ancho: 83,
  alto: 236,
  medida: null,
  cantidad: 2,
  ...extra,
});
const item = (cambios: Partial<SolicitudItem> = {}): SolicitudItem => ({
  modelo: null,
  madera: null,
  ancho: null,
  alto: null,
  medida: null,
  cantidad: null,
  ...cambios,
});
/** Alias canónicos cargados, sin los typos de la base: la tolerancia debe resolverlos igual. */
const configuracionTolerante = (alias: string[]): ConfiguracionCatalogo => ({
  maderas: CONFIGURACION_CATALOGO_BASE.maderas,
  familiasPorModelo: CONFIGURACION_CATALOGO_BASE.familiasPorModelo,
  aliasModelos: { 'HUILO HUILO': alias },
  aliasPosiblesModelos: { 'HUILO HUILO': ['PILLO'] },
});
/** Fuente de catálogo con la configuración de prueba, como la que entrega el repositorio SQLite. */
const fuenteDe = (configuracion: ConfiguracionCatalogo): FuenteCatalogo => ({
  configuracion,
  modelos: () => ['Huilo Huilo', 'PANGUIPULLI'],
  maderas: () => ['MARA'],
  productosDeModelo: (modeloNormalizado) =>
    catalogo.productos.filter((p) => normalizarCatalogo(p.modelo) === modeloNormalizado),
  resolverMadera: (valor) => resolverMaderaConfigurada(valor, configuracion),
  resolverModelo: (valor) => resolverModeloConfigurado(valor, configuracion),
  resolverModeloPosible: (valor) => resolverModeloPosibleConfigurado(valor, configuracion),
  modeloParecido: (valor, modelos) => modeloParecido(valor, configuracion, modelos),
});

describe('clave tolerante', () => {
  it('ignora tildes, mayúsculas, palabras repetidas y letras dobles sin tocar la normalización exacta', () => {
    expect(claveTolerante('  raulí ')).toBe('RAULI');
    expect(claveTolerante('WILO WILO')).toBe('WILO');
    expect(claveTolerante('HUILLO')).toBe('HUILO');
    expect(claveTolerante('HUILLO HUILLO')).toBe('HUILO');
    expect(claveTolerante('WILLOW')).toBe('WILOW');
    expect(normalizarCatalogo('HUILLO')).toBe('HUILLO');
  });
});

describe('resolución tolerante de modelos y maderas', () => {
  const configuracion = configuracionTolerante(['HUILO', 'WILLO', 'WILLOW']);

  it('las variantes mal escritas de un alias seguro se resuelven solas', () => {
    for (const valor of ['HUILLO', 'HUILLO HUILLO', 'WILO WILO', '  wilo   wilo '])
      expect(resolverModeloConfigurado(valor, configuracion), valor).toBe('HUILO HUILO');
    const r = resolverItem(fuenteDe(configuracion), pedido('HUILLO'));
    expect(r.ok && [r.producto.codigo, r.coincidenciaModelo]).toEqual(['HUI-M-3-A', 'alias']);
  });

  it('las maderas también toleran letras dobles y palabras repetidas', () => {
    expect(resolverMaderaConfigurada('RAULLI', CONFIGURACION_CATALOGO_BASE)).toBe('RAULI');
    expect(resolverMaderaConfigurada('LENGA LENGA', CONFIGURACION_CATALOGO_BASE)).toBe('LENGA');
    expect(resolverMaderaConfigurada('MARRAA', CONFIGURACION_CATALOGO_BASE)).toBe('MARA');
  });

  it('un nombre a una letra de un alias se sugiere como posible y no reemplaza solo', () => {
    expect(modeloParecido('WILLOWO', configuracion)).toBe('HUILO HUILO');
    expect(resolverModeloConfigurado('WILLOWO', configuracion)).toBe('WILLOWO');
    const r = resolverItem(fuenteDe(configuracion), pedido('WILLOWO'));
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.rechazo).toEqual({
        tipo: 'modelo_posible',
        valor: 'WILLOWO',
        sugerido: 'Huilo Huilo',
        disponibles: ['Huilo Huilo'],
        familia: 'PUERTA',
      });
  });

  it('un alias dudoso explícito sigue siendo posible', () => {
    expect(resolverModeloPosibleConfigurado('PILLO', configuracion)).toBe('HUILO HUILO');
    expect(resolverModeloPosibleConfigurado('Pillo', CONFIGURACION_CATALOGO_BASE)).toBe('HUILO HUILO');
    const r = resolverItem(catalogo, pedido('Pillo'));
    expect(r.ok ? null : r.rechazo.tipo).toBe('modelo_posible');
  });

  it('un nombre canónico real gana sobre cualquier variante tolerante', () => {
    const conWilo: Catalogo = { ...catalogo, productos: [...catalogo.productos, puerta('WIL-M-3-A', 'Wilo Wilo')] };
    const r = resolverItem(conWilo, pedido('wilo wilo'));
    expect(r.ok && [r.producto.codigo, r.coincidenciaModelo]).toEqual(['WIL-M-3-A', 'canonico']);
  });

  it('una clave de menos de cinco letras no genera parecidos', () => {
    const configuracionCorta = {
      ...CONFIGURACION_CATALOGO_BASE,
      aliasModelos: { MOCA: [] },
      aliasPosiblesModelos: {},
    };
    expect(modeloParecido('MOCE', configuracionCorta)).toBeNull();
  });

  it('con dos modelos a la misma distancia devuelve null (empate)', () => {
    const configuracionEmpate = {
      ...CONFIGURACION_CATALOGO_BASE,
      aliasModelos: { CUNCO: [], CUNCA: [] },
      aliasPosiblesModelos: {},
    };
    expect(modeloParecido('CUNCI', configuracionEmpate)).toBeNull();
  });
});

describe('choques tolerantes en la configuración', () => {
  it('al guardar rechaza dos modelos distintos cuyas palabras coinciden al tolerar letras dobles', () => {
    const config = validarConfiguracionCatalogo({ aliasModelos: { 'MODELO A': ['TOLTEN'], 'MODELO B': ['TOLLTEN'] } });
    expect(choqueTolerante(config)).toMatch(/TOLLTEN/);
  });

  it('al guardar rechaza dos maderas distintas cuyas palabras coinciden al tolerar letras dobles', () => {
    const config = validarConfiguracionCatalogo({
      maderas: [
        { nombre: 'PINO OREGON', codigo: 'O', alias: [] },
        { nombre: 'PINNO OREGOON', codigo: 'X', alias: [] },
      ],
    });
    expect(choqueTolerante(config)).toMatch(/madera/);
  });

  it('al guardar rechaza un seguro y un dudoso parecidos en el mismo modelo', () => {
    const config = validarConfiguracionCatalogo({
      aliasModelos: { 'HUILO HUILO': ['PILO'] },
      aliasPosiblesModelos: { 'HUILO HUILO': ['PILLO'] },
    });
    expect(choqueTolerante(config)).toMatch(/dos columnas/);
  });

  it('una configuración ya guardada con choque tolerante se sigue cargando, y el parecido ambiguo no resuelve', () => {
    const config = validarConfiguracionCatalogo({ aliasModelos: { TOLTEN: ['TOLTEN'], TOLLTEN: ['TOLLTEN'] } });
    expect(resolverModeloConfigurado('TOLTEN', config)).toBe('TOLTEN');
    expect(resolverModeloConfigurado('TOLLTEN', config)).toBe('TOLLTEN');
    expect(resolverModeloConfigurado('TOOLTEN', config)).toBe('TOOLTEN');
  });

  it('no rechaza variantes tolerantes del mismo modelo', () => {
    const config = validarConfiguracionCatalogo({ aliasModelos: { 'HUILO HUILO': ['HUILLO', 'WILO WILO'] } });
    expect(config.aliasModelos['HUILO HUILO']).toEqual(expect.arrayContaining(['HUILLO', 'WILO WILO']));
    expect(choqueTolerante(config)).toBeNull();
  });
});

describe('prioridades: preguntar antes que reemplazar', () => {
  it('un dudoso explícito gana a un seguro que solo coincide por parecido', () => {
    const config: ConfiguracionCatalogo = {
      ...CONFIGURACION_CATALOGO_BASE,
      aliasModelos: { 'HUILO HUILO': ['PILO'] },
      aliasPosiblesModelos: { 'HUILO HUILO': ['PILLO'] },
    };
    expect(resolverModeloConfigurado('PILLO', config)).toBe('PILLO');
    const r = resolverItem(fuenteDe(config), pedido('Pillo'));
    expect(r).toMatchObject({ ok: false, rechazo: { tipo: 'modelo_posible', sugerido: 'Huilo Huilo' } });
  });

  it('una madera real del catálogo gana a una variante tolerante de otra', () => {
    const conMarra: Catalogo = { ...catalogo, productos: [...catalogo.productos, { ...puerta('HUI-X', 'Huilo Huilo'), madera: 'MARRA' }] };
    expect(maderaDelCatalogo(conMarra, 'MARRA')).toBe('MARRA');
  });

  it('reserva Damerau para claves distintas aunque el modelo no tenga alias configurados', () => {
    const config: ConfiguracionCatalogo = { ...CONFIGURACION_CATALOGO_BASE, aliasModelos: {}, aliasPosiblesModelos: {} };
    expect(modeloParecido('PANGUIPULI', config, ['PANGUIPULLI'])).toBeNull();
    expect(resolverModeloConfigurado('PANGUIPULI', config, ['PANGUIPULLI'])).toBe('PANGUIPULLI');
    expect(modeloParecido('PANGUIPUYI', config, ['PANGUIPULLI'])).toBe('PANGUIPULLI');
  });
});

describe('anclaje tolerante de nombres', () => {
  const sinAlias = { modelo: {}, madera: {} };
  const conTolten: Catalogo = { ...catalogo, productos: [puerta('TOL-1', 'TOLTEN'), puerta('TOL-2', 'TOLLTEN')] };

  it('acepta «huillo» en el texto cuando el catálogo lo resuelve a «Huilo Huilo»', () => {
    const fuente = fuenteDe(configuracionTolerante(['WILLOW']));
    const { items, avisos } = anclarNombres([item({ modelo: 'Huilo Huilo' })], [], ['3 huillo de mara'], sinAlias, resolverNombres(fuente));
    expect(items[0].modelo).toBe('Huilo Huilo');
    expect(avisos).toEqual([]);
  });

  it('no acepta un nombre inventado que solo aparece dentro de otra palabra', () => {
    const { items } = anclarNombres([item({ madera: 'MARA' })], [], ['puertas amarradas'], sinAlias, resolverNombres(catalogo));
    expect(items[0].madera).toBeNull();
  });

  it('un previo parecido no habilita cambiar a otro modelo real', () => {
    const { items } = anclarNombres([item({ modelo: 'TOLLTEN' })], [item({ modelo: 'TOLTEN' })], ['agrega otra igual'], sinAlias);
    expect(items[0].modelo).toBeNull();
  });

  it('un modelo real dicho tal cual no ancla a otro modelo real que se le parece', () => {
    const { items } = anclarNombres([item({ modelo: 'TOLLTEN' })], [], ['cotiza 2 TOLTEN de mara 83x236'], sinAlias, resolverNombres(conTolten));
    expect(items[0].modelo).toBeNull();
  });

  it('una variante ambigua entre dos modelos reales no ancla a ninguno', () => {
    const { items } = anclarNombres([item({ modelo: 'TOLLTEN' })], [], ['2 TOOLTEN de mara 83x236'], sinAlias, resolverNombres(conTolten));
    expect(items[0].modelo).toBeNull();
  });

  it('una variante con dueños dudosos no ancla al modelo de un alias seguro parecido', () => {
    const config = validarConfiguracionCatalogo({
      aliasModelos: { 'MODELO A': ['TOLTEN'] },
      aliasPosiblesModelos: { 'MODELO B': ['TOLLTEN'], 'MODELO C': ['TOOLLTEN'] },
    });
    const { items } = anclarNombres([item({ modelo: 'MODELO A' })], [], ['2 TOOLTEN de mara'], sinAlias, resolverNombres(fuenteDe(config)));
    expect(items[0].modelo).toBeNull();
  });
});

describe('anclaje: frases completas y fuentes mínimas', () => {
  const sinAlias = { modelo: {}, madera: {} };

  it('una palabra dentro de una frase que nombra otro modelo no ancla', () => {
    const conSur: Catalogo = { ...catalogo, productos: [puerta('C-1', 'CUNCO'), puerta('C-2', 'CUNNCO SUR')] };
    const { items } = anclarNombres([item({ modelo: 'CUNCO' })], [], ['2 cunnco sur de mara'], sinAlias, resolverNombres(conSur));
    expect(items[0].modelo).toBeNull();
  });

  it('un alias seguro de clave corta también ancla', () => {
    const config = validarConfiguracionCatalogo({ aliasModelos: { 'COZ COZ': ['COSS COSS'] } });
    const fuente: FuenteCatalogo = { ...fuenteDe(config), modelos: () => ['COZ COZ'] };
    const { items } = anclarNombres([item({ modelo: 'COZ COZ' })], [], ['2 coss coss'], sinAlias, resolverNombres(fuente));
    expect(items[0].modelo).toBe('COZ COZ');
  });

  it('una fuente sin resolverMadera sigue encontrando la madera real exacta', () => {
    const sinResolver: FuenteCatalogo = { ...fuenteDe(configuracionTolerante([])), resolverMadera: undefined };
    expect(maderaDelCatalogo(sinResolver, 'mara')).toBe('MARA');
  });
});

describe('dudosos ambiguos', () => {
  it('un parecido con dos dueños dudosos no habilita el reemplazo seguro tolerante', () => {
    const config = validarConfiguracionCatalogo({
      aliasModelos: { 'MODELO A': ['TOLTEN'] },
      aliasPosiblesModelos: { 'MODELO B': ['TOLLTEN'], 'MODELO C': ['TOOLLTEN'] },
    });
    expect(resolverModeloPosibleConfigurado('TOOLTEN', config)).toBeNull();
    expect(resolverModeloConfigurado('TOOLTEN', config)).toBe('TOOLTEN');
  });
});
