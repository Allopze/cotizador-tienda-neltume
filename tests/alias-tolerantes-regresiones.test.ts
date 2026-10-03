import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { anclarNombres } from '../src/asistente/anclaje';
import { leerConfiguracionCatalogo } from '../src/catalogo/configuracion-archivo';
import { CONFIGURACION_CATALOGO_BASE, resolverModeloConfigurado } from '../src/catalogo/configuracion';
import { modeloDelCatalogo, resolverItem, resolverNombres } from '../src/catalogo/resolver';
import { clienteVacio, type Catalogo, type Producto, type SolicitudItem } from '../src/catalogo/tipos';
import { preguntasPendientes } from '../src/negocio/pendientes';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { ServicioAltaCatalogo } from '../src/servidor/alta-catalogo';
import { abrirBaseDatos } from '../src/servidor/base-datos';
import { cotizacionSchema } from '../src/servidor/persistencia-esquemas';
import { guardarCatalogo, RepositorioCatalogoSqlite } from '../src/servidor/repositorio-catalogo';
import { Servicio } from '../src/servidor/servicio';

const producto = (modelo: string, codigo = modelo): Producto => ({
  codigo, modelo, familia: 'PUERTA', tipo: null, madera: 'MARA', medida: '0,80 A 0,85',
  anchoMin: 0.8, anchoMax: 0.85, largo: 2, precioNeto: 100_000,
  descripcion: `${modelo} MARA`, filaOrigen: 1,
});
const catalogoDe = (productos: Producto[]): Catalogo => ({
  fuente: 'regresiones.xlsx', sha256: 'regresiones', fecha: '2026-01-01', productos,
});
const solicitud = (modelo: string): SolicitudItem => ({
  modelo, madera: 'MARA', cantidad: 2, ancho: 0.82, alto: 2, medida: null,
});
const datosAlta = (modelo: string) => ({
  modelo, familia: 'PUERTA' as const, madera: 'MARA', tipo: null, medida: null,
  anchoMin: 0.6, anchoMax: 0.65, largo: 2, precioNeto: 95_000,
});
const dirs: string[] = [];
const bases: Database.Database[] = [];
async function repositorio(productos: Producto[], configuracion = CONFIGURACION_CATALOGO_BASE) {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-regresiones-'));
  dirs.push(dir);
  const db = abrirBaseDatos(join(dir, 'cotizador.sqlite'), { cachear: false });
  bases.push(db);
  guardarCatalogo(db, catalogoDe(productos), configuracion);
  return { db, repo: new RepositorioCatalogoSqlite(db) };
}
afterEach(async () => {
  for (const db of bases.splice(0)) if (db.open) db.close();
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

describe('regresiones de canónicos y tolerancia', () => {
  it('TOOLTEN queda como pregunta con TOLTEN y TOLLTEN reales, aunque solo TOLTEN esté configurado', async () => {
    const config = { ...CONFIGURACION_CATALOGO_BASE, aliasModelos: { TOLTEN: [] }, aliasPosiblesModelos: {} };
    const productos = [producto('TOLTEN'), producto('TOLLTEN')];
    const { repo } = await repositorio(productos, config);
    expect(resolverModeloConfigurado('TOOLTEN', config, repo.modelos())).toBe('TOOLTEN');
    for (const catalogo of [repo, catalogoDe(productos)]) {
      expect(modeloDelCatalogo(catalogo, 'TOOLTEN')).toMatchObject({ modelo: 'TOOLTEN', canonico: false, posible: null });
      const r = resolverItem(catalogo, solicitud('TOOLTEN'));
      expect(r).toMatchObject({ ok: false, rechazo: { tipo: 'modelo_desconocido', valor: 'TOOLTEN', disponibles: ['TOLTEN', 'TOLLTEN'] } });
      expect(resolverNombres(catalogo).modelo('TOOLTEN')).toBeNull();
      for (const modelo of ['TOLTEN', 'TOLLTEN'])
        expect(modeloDelCatalogo(catalogo, modelo)).toMatchObject({ modelo, canonico: true });
    }
  });

  it.each([['CUNNCO', 'CUNCO'], ['ENNCO', 'ENCO']])('%s reconoce %s sin alias, incluso con clave corta', async (escrito, canonico) => {
    const config = { ...CONFIGURACION_CATALOGO_BASE, aliasModelos: {}, aliasPosiblesModelos: {} };
    const productos = [producto(canonico)];
    const { repo } = await repositorio(productos, config);
    for (const catalogo of [repo, catalogoDe(productos)]) {
      const r = resolverItem(catalogo, solicitud(escrito));
      expect(r.ok && [r.producto.modelo, r.coincidenciaModelo]).toEqual([canonico, 'alias']);
      expect(resolverNombres(catalogo).modelo(escrito)).toBe(canonico);
    }
  });

  it('el anclaje respeta Wilo Wilo real frente al alias de producción de Huilo Huilo', async () => {
    const config = await leerConfiguracionCatalogo('config/catalogo.json');
    expect(config.aliasModelos['HUILO HUILO']).toContain('WILO WILO');
    const { repo } = await repositorio([producto('Huilo Huilo'), producto('Wilo Wilo')], config);
    const alias = { modelo: repo.aliasModelos(), madera: repo.aliasMaderas() };
    const { items, avisos } = anclarNombres(
      [solicitud('Huilo Huilo'), solicitud('Wilo Wilo')], [], ['2 wilo wilo de mara'], alias, resolverNombres(repo),
    );
    expect(items.map((i) => i.modelo)).toEqual([null, 'Wilo Wilo']);
    expect(avisos).toHaveLength(1);
    // Tampoco puede aprovechar una parte de un nombre real más largo.
    const { repo: conSur } = await repositorio([producto('CUNCO'), producto('CUNCO SUR')]);
    expect(anclarNombres([solicitud('CUNCO')], [], ['2 cunco sur de mara'], alias, resolverNombres(conSur)).items[0].modelo).toBeNull();
  });

  it('el anclaje conserva nombres desconocidos literales y rechaza Damerau sin confirmar', async () => {
    const { repo } = await repositorio([producto('CUNCU')]);
    const resolver = resolverNombres(repo);
    expect(resolver.modelo('Cunco')).toBeNull();
    const { items } = anclarNombres(
      [solicitud('Cunco'), solicitud('Cuncu'), solicitud('Modelo nuevo')], [],
      ['2 Cunco de mara y modelo nuevo'], { modelo: {}, madera: {} }, resolver,
    );
    expect(items.map((i) => i.modelo)).toEqual(['Cunco', null, 'Modelo nuevo']);
  });

  it('el anclaje de un mensaje largo consulta modelos y maderas una vez con 9.000 productos', async () => {
    const productos = Array.from({ length: 8999 }, (_, i) => producto(`MODELO ${i}`));
    const { repo } = await repositorio([...productos, producto('CUNCO')]);
    const modelos = vi.spyOn(repo, 'modelos');
    const maderas = vi.spyOn(repo, 'maderas');
    const damerau = vi.spyOn(repo, 'modeloParecido');
    const textos = ['2 cunnco de mara ' + Array.from({ length: 100 }, () => 'con despacho para la obra cuando esté lista').join(' ')];
    const { items, avisos } = anclarNombres([solicitud('CUNCO')], [], textos, { modelo: {}, madera: {} }, resolverNombres(repo));
    expect(items[0].modelo).toBe('CUNCO');
    expect(avisos).toEqual([]);
    expect(modelos).toHaveBeenCalledTimes(1);
    expect(maderas).toHaveBeenCalledTimes(1);
    expect(damerau).not.toHaveBeenCalled();
  });
});

describe('alta que conserva nombres nuevos', () => {
  it.each(['TOLLTEN', 'TOLTNE'])('guarda %s sin convertirlo a TOLTEN por tolerancia o Damerau', async (modelo) => {
    const config = { ...CONFIGURACION_CATALOGO_BASE, aliasModelos: { TOLTEN: ['TOL'] }, aliasPosiblesModelos: {} };
    const { db, repo } = await repositorio([producto('TOLTEN')], config);
    const alta = new ServicioAltaCatalogo(db, repo, { interpretar: vi.fn() });
    const propuesta = alta.proponerManual(undefined, datosAlta(modelo), 'u1');
    expect(propuesta.propuesta?.modelo).toBe(modelo);
    const guardado = alta.confirmar(propuesta.id, 'u1');
    expect(repo.buscarPorCodigo(guardado.codigo)?.modelo).toBe(modelo);
  });

  it('un canónico real gana sobre el alias exacto de producción, y un alias seguro exacto sigue normalizándose', async () => {
    const config = await leerConfiguracionCatalogo('config/catalogo.json');
    const { db, repo } = await repositorio([producto('Huilo Huilo'), producto('Wilo Wilo')], config);
    const alta = new ServicioAltaCatalogo(db, repo, { interpretar: vi.fn() });
    for (const [entrada, esperado] of [['wilo wilo', 'WILO WILO'], ['willow', 'HUILO HUILO']]) {
      const propuesta = alta.proponerManual(undefined, datosAlta(entrada), 'u1');
      expect(propuesta.propuesta?.modelo).toBe(esperado);
      const guardado = alta.confirmar(propuesta.id, 'u1');
      expect(repo.buscarPorCodigo(guardado.codigo)?.modelo.toUpperCase()).toBe(esperado);
    }
  });

  it('Cunco/Cuncu: el pendiente permite alta con el nombre escrito y luego cotiza el nuevo canónico', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'neltume-cunco-'));
    dirs.push(dir);
    const almacen = new Almacen(dir);
    guardarCatalogo(almacen.baseDatos(), catalogoDe([producto('CUNCU')]));
    const repo = new RepositorioCatalogoSqlite(almacen.baseDatos());
    const llm = { interpretar: vi.fn().mockResolvedValue({
      name: 'actualizar_cotizacion', input: { items: [solicitud('Cunco')], cliente: clienteVacio() },
    }), verificarCifras: true };
    const servicio = new Servicio(repo, llm, almacen);
    let q = (await servicio.ejecutar({ tipo: 'chat', mensaje: '2 Cunco de mara 82x200' })).cotizacion;
    expect(q.solicitudes[0].modelo).toBe('Cunco');
    expect(q.montos.lineas).toEqual([]);
    expect(q.incompletos[0].rechazo).toMatchObject({ tipo: 'modelo_posible', valor: 'Cunco', sugerido: 'CUNCU', familia: 'PUERTA' });
    const recargada = almacen.obtener(q.id)!;
    expect(cotizacionSchema.parse(recargada).incompletos[0].rechazo).toEqual(q.incompletos[0].rechazo);
    const [pregunta] = preguntasPendientes(recargada);
    expect(pregunta.modeloNuevo).toBe(true);
    expect(pregunta.opciones).toEqual([{ etiqueta: 'Confirmar Cuncu', valor: 'CUNCU' }]);
    expect(pregunta.alta).toEqual({
      familia: 'PUERTA', modelo: 'Cunco', madera: 'MARA', medida: null, anchoMin: 0.82, anchoMax: 0.82, largo: 2,
    });
    const alta = new ServicioAltaCatalogo(almacen.baseDatos(), repo, llm);
    const propuesta = alta.proponerManual(undefined, { ...pregunta.alta!, tipo: null, precioNeto: 95_000 }, 'u1');
    expect(propuesta.propuesta?.modelo).toBe('CUNCO');
    const nuevo = alta.confirmar(propuesta.id, 'u1');
    q = (await servicio.ejecutar({ tipo: 'editar', id: q.id, actualizada: q.actualizada })).cotizacion;
    expect(q.incompletos).toEqual([]);
    expect(q.solicitudes[0]).toMatchObject({ modelo: 'CUNCO', coincidenciaModelo: 'canonico' });
    expect(q.montos.lineas[0].producto.codigo).toBe(nuevo.codigo);
    expect(llm.interpretar).toHaveBeenCalledTimes(1);
  });
});
