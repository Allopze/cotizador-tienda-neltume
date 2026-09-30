import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contextoSeguro, SYSTEM } from '../src/asistente/llm';
import { pregunta } from '../src/asistente/preguntas';
import { CONFIGURACION_CATALOGO_BASE, validarConfiguracionCatalogo } from '../src/catalogo/configuracion';
import { leerConfiguracionCatalogo } from '../src/catalogo/configuracion-archivo';
import {
  aliasMaderasCatalogo,
  aliasModelosCatalogo,
  maderasCatalogo,
  modelosCatalogo,
  resolverItem,
} from '../src/catalogo/resolver';
import { clienteVacio, type Catalogo, type Producto } from '../src/catalogo/tipos';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { abrirBaseDatos } from '../src/servidor/base-datos';
import { cotizacionSchema } from '../src/servidor/persistencia-esquemas';
import { guardarCatalogo, RepositorioCatalogoSqlite } from '../src/servidor/repositorio-catalogo';
import { Servicio } from '../src/servidor/servicio';

vi.mock('../src/servidor/pdf', () => ({
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

const puerta = (codigo: string, modelo: string): Producto => ({
  codigo, modelo, familia: 'PUERTA', tipo: 'PUERTA SÓLIDA', madera: 'MARA', medida: '0,80 A 0,85',
  anchoMin: 0.8, anchoMax: 0.85, altoMin: 2.3, altoMax: 2.4, largo: 2.35, precioNeto: 100_000,
  descripcion: `${modelo.toUpperCase()} MARA 0,80 A 0,85 MT X 2,30 A 2,40 MT`, filaOrigen: 7,
});
const catalogo: Catalogo = {
  fuente: 'test.xlsx', sha256: 'posibles', fecha: '2026-01-01T00:00:00.000Z',
  productos: [puerta('HUI-M-3-A', 'Huilo Huilo'), puerta('PAN-M-3-A', 'PANGUIPULLI')],
};
const pedido = (modelo: string | null, extra: Record<string, unknown> = {}) => ({
  modelo, madera: 'Mara', ancho: 83, alto: 236, medida: null, cantidad: 2, ...extra,
});
const lista = (...items: object[]) => ({ name: 'actualizar_cotizacion', input: { items, cliente: clienteVacio() } });

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});
async function servicio() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-posibles-'));
  dirs.push(dir);
  const llm = { interpretar: vi.fn() };
  return { dir, llm, servicio: new Servicio(catalogo, llm, new Almacen(dir)) };
}

describe('coincidencias posibles de modelo', () => {
  it('los alias seguros se normalizan y «Pillo» queda pendiente con la sugerencia', () => {
    for (const alias of ['Huilo', 'Huila', 'Willo', 'Willow', 'Huilo Huila', 'Willow Willow']) {
      const r = resolverItem(catalogo, pedido(alias));
      expect(r.ok && [r.producto.codigo, r.coincidenciaModelo]).toEqual(['HUI-M-3-A', 'alias']);
    }
    const r = resolverItem(catalogo, pedido('  pillo '));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.rechazo).toEqual({ tipo: 'modelo_posible', valor: '  pillo ', sugerido: 'Huilo Huilo', disponibles: ['Huilo Huilo'] });
    expect(pregunta(r.rechazo, 'Pillo')).toBe('¿Te refieres a Huilo Huilo? Confírmalo para cotizar.');
  });

  it('se pregunta por el modelo antes que por los datos que faltan y una vez confirmado sigue el flujo normal', () => {
    const sinMadera = resolverItem(catalogo, pedido('Pillo', { madera: null, ancho: null, alto: null, cantidad: null }));
    expect(sinMadera.ok ? null : sinMadera.rechazo.tipo).toBe('modelo_posible');
    const confirmado = resolverItem(catalogo, pedido('Huilo Huilo', { madera: null, ancho: null, alto: null, cantidad: null }));
    expect(confirmado.ok ? null : confirmado.rechazo.tipo).toBe('faltan_datos');
  });

  it('un modelo real del catálogo gana sobre cualquier alias, seguro o posible', () => {
    const conReales: Catalogo = { ...catalogo, productos: [...catalogo.productos, puerta('PIL-M-3-A', 'Pillo'), puerta('WIL-M-3-A', 'Willow')] };
    for (const [modelo, codigo] of [['Pillo', 'PIL-M-3-A'], ['Willow', 'WIL-M-3-A']] as const) {
      const r = resolverItem(conReales, pedido(modelo));
      expect(r.ok && [r.producto.codigo, r.coincidenciaModelo]).toEqual([codigo, 'canonico']);
    }
  });

  it('si el catálogo no tiene el modelo sugerido no hay coincidencia posible: el modelo es desconocido', () => {
    const sinHuilo: Catalogo = { ...catalogo, productos: [puerta('PAN-M-3-A', 'PANGUIPULLI')] };
    const r = resolverItem(sinHuilo, pedido('Pillo'));
    expect(r.ok ? null : r.rechazo.tipo).toBe('modelo_desconocido');
  });
});

describe('configuración de alias posibles', () => {
  it('«Pillo» es un alias posible de la base y ya no figura entre los seguros', () => {
    expect(CONFIGURACION_CATALOGO_BASE.aliasPosiblesModelos).toEqual({ 'HUILO HUILO': ['PILLO'] });
    expect(JSON.stringify(CONFIGURACION_CATALOGO_BASE.aliasModelos)).not.toContain('PILLO');
  });

  it('config/catalogo.json declara los alias posibles por separado', async () => {
    const config = await leerConfiguracionCatalogo('config/catalogo.json');
    expect(config.aliasPosiblesModelos['HUILO HUILO']).toEqual(['PILLO']);
    expect(config.aliasModelos['HUILO HUILO']).not.toContain('PILLO');
    expect(config.aliasModelos['HUILO HUILO']).toContain('WILLOW');
  });

  it('suma los alias posibles configurados a los de la base, sin duplicarlos', () => {
    const config = validarConfiguracionCatalogo({
      aliasPosiblesModelos: { 'Huilo Huilo': ['PILLO', 'Huillo'], PANGUIPULLI: ['Pangui'] },
    });
    expect(config.aliasPosiblesModelos).toEqual({ 'HUILO HUILO': ['PILLO', 'Huillo'], PANGUIPULLI: ['Pangui'] });
    expect(validarConfiguracionCatalogo({}).aliasPosiblesModelos).toEqual({ 'HUILO HUILO': ['PILLO'] });
  });

  it('rechaza formas inválidas, claves desconocidas y un alias que apunta a dos modelos', () => {
    expect(() => validarConfiguracionCatalogo({ aliasPosiblesModelos: { MOLCO: 'PILLO' } })).toThrow();
    expect(() => validarConfiguracionCatalogo({ aliasPosiblesModelos: { MOLCO: [''] } })).toThrow();
    expect(() => validarConfiguracionCatalogo({ aliasPosibles: {} })).toThrow();
    expect(() => validarConfiguracionCatalogo({ aliasPosiblesModelos: { MOLCO: ['Pillo'] } })).toThrow(/más de un modelo/);
    expect(() => validarConfiguracionCatalogo({ aliasPosiblesModelos: { MOLCO: ['WILLOW'] } })).toThrow(/más de un modelo/);
    expect(() => validarConfiguracionCatalogo({ aliasModelos: { MOLCO: ['Pillo'] } })).toThrow(/más de un modelo/);
  });

  it('un alias dudoso manda sobre el seguro del mismo modelo: una configuración guardada antes no lo sustituye solo', () => {
    const config = validarConfiguracionCatalogo({ aliasModelos: { 'HUILO HUILO': ['HUILO', 'PILLO', 'HUILLO'] } });
    expect(config.aliasModelos['HUILO HUILO']).toEqual(['HUILO', 'HUILA', 'WILLO', 'WILLOW', 'HUILO HUILA', 'WILLOW WILLOW', 'HUILLO']);
    expect(config.aliasPosiblesModelos['HUILO HUILO']).toEqual(['PILLO']);
  });

  it('el repositorio SQLite solo entrega los alias seguros a la IA, también con una configuración guardada antes de separarlos', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'neltume-posibles-'));
    dirs.push(dir);
    const db = abrirBaseDatos(join(dir, 'cotizador.sqlite'), { cachear: false });
    guardarCatalogo(db, catalogo);
    db.prepare('UPDATE catalogo_configuracion SET configuracion_json = ? WHERE id = 1').run(
      JSON.stringify({
        maderas: CONFIGURACION_CATALOGO_BASE.maderas,
        familiasPorModelo: CONFIGURACION_CATALOGO_BASE.familiasPorModelo,
        aliasModelos: { 'HUILO HUILO': ['HUILO', 'PILLO'], PANGUIPULLI: ['PANGIPULLI'] },
      }),
    );
    const repo = new RepositorioCatalogoSqlite(db);
    expect(JSON.stringify(repo.aliasModelos())).not.toContain('PILLO');
    expect(repo.aliasModelos()['HUILO HUILO']).toContain('WILLOW');
    expect(repo.resolverModeloPosible('Pillo')).toBe('HUILO HUILO');
    expect(repo.resolverModeloPosible('Willow')).toBeNull();
    const r = resolverItem(repo, pedido('Pillo'));
    expect(r.ok ? null : r.rechazo).toMatchObject({ tipo: 'modelo_posible', sugerido: 'Huilo Huilo' });
    const w = resolverItem(repo, pedido('Willow'));
    expect(w.ok && w.coincidenciaModelo).toBe('alias');
    db.close();
  });
});

describe('la IA no normaliza alias posibles', () => {
  it('el contexto solo lleva los alias seguros', () => {
    const aliases = { modelos: aliasModelosCatalogo(catalogo), maderas: aliasMaderasCatalogo(catalogo) };
    expect(JSON.stringify(aliases.modelos)).not.toMatch(/PILLO/i);
    const contexto = contextoSeguro(
      'cotiza 3 puertas', [], clienteVacio(), modelosCatalogo(catalogo), maderasCatalogo(catalogo), [], 'cotizacion_nueva', null, aliases,
    );
    expect(JSON.stringify(contexto)).not.toMatch(/PILLO/i);
    expect(contexto.aliasModelos['HUILO HUILO']).toContain('WILLOW');
    expect(JSON.stringify(contextoSeguro('x', [], clienteVacio(), [], []))).not.toMatch(/PILLO/i);
  });

  it('la instrucción pide conservar los nombres dudosos tal como se escribieron', () => {
    expect(SYSTEM).toMatch(/no figura en el contexto o te deja dudas, conserva el texto tal como lo escribió/);
  });

  it('el servicio envía a la IA alias seguros y no los posibles', async () => {
    const { llm, servicio: s } = await servicio();
    llm.interpretar.mockResolvedValueOnce(lista(pedido('Pillo')));
    await s.ejecutar({ tipo: 'chat', mensaje: 'cotiza 2 pillo de mara' });
    const enviado = llm.interpretar.mock.calls[0][0];
    expect(JSON.stringify(enviado.aliasModelos)).not.toMatch(/PILLO/i);
    expect(enviado.aliasModelos['HUILO HUILO']).toContain('HUILO');
  });
});

describe('flujo de una coincidencia posible', () => {
  it('«Pillo» queda pendiente: sin precio, sin emitir y con la pregunta persistida; confirmar la cotiza', async () => {
    const { dir, llm, servicio: s } = await servicio();
    llm.interpretar.mockResolvedValueOnce(lista(pedido('Pillo')));
    const respuesta = await s.ejecutar({ tipo: 'chat', mensaje: 'cotiza 2 pillo de mara' });
    let q = respuesta.cotizacion;
    expect(q.montos.lineas).toHaveLength(0);
    expect(q.montos.total).toBe(0);
    expect(q.incompletos).toEqual([
      {
        indice: 0,
        rechazo: { tipo: 'modelo_posible', valor: 'Pillo', sugerido: 'Huilo Huilo', disponibles: ['Huilo Huilo'] },
        pregunta: '¿Te refieres a Huilo Huilo? Confírmalo para cotizar.',
      },
    ]);
    expect(q.solicitudes[0].modelo).toBe('Pillo');
    expect(q.solicitudes[0].modeloOriginal ?? null).toBeNull();
    expect(q.historial.at(-1)?.texto).toContain('¿Te refieres a Huilo Huilo?');
    await expect(s.ejecutar({ tipo: 'emitir', id: q.id, actualizada: q.actualizada })).rejects.toThrow(/pendientes/);

    // Persistida y recargada: el rechazo sigue siendo válido para el esquema de importación.
    const recargada = new Almacen(dir).obtener(q.id)!;
    expect(recargada.incompletos[0].rechazo).toMatchObject({ tipo: 'modelo_posible', sugerido: 'Huilo Huilo' });
    expect(cotizacionSchema.safeParse(recargada).success).toBe(true);

    // El botón del panel edita el modelo con el nombre sugerido.
    const sugerido = (q.incompletos[0].rechazo as { sugerido: string }).sugerido;
    q = (await s.ejecutar({ tipo: 'editar', id: q.id, actualizada: q.actualizada, items: [{ indice: 0, cambios: { modelo: sugerido } }] })).cotizacion;
    expect(q.incompletos).toHaveLength(0);
    expect(q.solicitudes[0]).toMatchObject({ modelo: 'Huilo Huilo', coincidenciaModelo: 'canonico' });
    expect(q.solicitudes[0].modeloOriginal ?? null).toBeNull();
    expect(q.montos.lineas[0]).toMatchObject({ cantidad: 2, precioFabrica: 100_000, precioUnitario: 155_000 });
    expect(q.montos.lineas[0].producto.codigo).toBe('HUI-M-3-A');
    q = (await s.ejecutar({ tipo: 'emitir', id: q.id, actualizada: q.actualizada })).cotizacion;
    expect(q.estado).toBe('emitida');
  });

  it('confirmar por el chat también la cotiza, y un alias seguro sigue normalizándose', async () => {
    const { llm, servicio: s } = await servicio();
    llm.interpretar.mockResolvedValueOnce(lista(pedido('Pillo'), pedido('Willow')));
    let q = (await s.ejecutar({ tipo: 'chat', mensaje: 'cotiza pillo y willow' })).cotizacion;
    expect(q.incompletos.map((i) => i.indice)).toEqual([0]);
    expect(q.montos.lineas).toHaveLength(1);
    expect(q.solicitudes[1]).toMatchObject({ modelo: 'Huilo Huilo', modeloOriginal: 'Willow', coincidenciaModelo: 'alias' });
    llm.interpretar.mockResolvedValueOnce(lista(pedido('Huilo Huilo'), pedido('Willow')));
    q = (await s.ejecutar({ tipo: 'chat', id: q.id, actualizada: q.actualizada, mensaje: 'sí, Huilo Huilo' })).cotizacion;
    expect(q.incompletos).toHaveLength(0);
    expect(q.montos.lineas).toHaveLength(2);
  });

  it('confirmar no cuenta como cambio de producto: se conservan la descripción y el precio manual', async () => {
    const { llm, servicio: s } = await servicio();
    llm.interpretar.mockResolvedValueOnce(lista(pedido('Pillo')));
    let q = (await s.ejecutar({ tipo: 'chat', mensaje: 'cotiza pillo' })).cotizacion;
    q = (await s.ejecutar({ tipo: 'editar', id: q.id, actualizada: q.actualizada, items: [{ indice: 0, cambios: { precioUnitario: 150_000, descripcion: 'Puerta especial' } }] })).cotizacion;
    const confirmada = await s.ejecutar({ tipo: 'editar', id: q.id, actualizada: q.actualizada, items: [{ indice: 0, cambios: { modelo: 'Huilo Huilo' } }] });
    expect(confirmada.avisos).toBeUndefined();
    expect(confirmada.cotizacion.montos.lineas[0]).toMatchObject({ precioUnitario: 150_000, descripcionDocumento: 'Puerta especial' });
    // Cambiar a otro modelo sí descarta lo manual.
    const otro = await s.ejecutar({ tipo: 'editar', id: q.id, actualizada: confirmada.cotizacion.actualizada, items: [{ indice: 0, cambios: { modelo: 'Panguipulli' } }] });
    expect(otro.avisos?.[0]).toMatch(/se descartó su descripción de documento personalizada y su precio unitario manual/);
    expect(otro.cotizacion.montos.lineas[0].precioUnitario).toBe(155_000);
  });
});
