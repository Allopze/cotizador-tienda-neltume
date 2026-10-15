'use client';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { leerPesos } from '@/negocio/cifras';
import { pesos } from '@/negocio/precios';
import type { ProductoEliminado } from '@/servidor/repositorio-catalogo';
import type { Avisar } from './avisos';
import type { ProductoAdministrable } from './contrato';
import { Dialogo, useConfirmacion } from './dialogo';
import { FAMILIAS } from '@/catalogo/familias';
import {
  decimalCampo,
  errorMedida,
  fechaCorta,
  leerMedida,
  medidaProducto,
  nombreProducto,
  textoRangoMedida,
} from './formato';
import { guardarSesion, leerSesion } from './memoria-pantalla';
import { SelectorFamilia } from './selector-familia';
import { esSilencioso, mensajeDe, pedirJSON } from './solicitud';

type Respuesta = { productos: ProductoAdministrable[]; total: number };
/** Campos del editor tal como se escriben (decimales con coma). */
type Campos = Record<
  'modelo' | 'familia' | 'madera' | 'tipo' | 'medida' | 'anchoMin' | 'anchoMax' | 'largo' | 'precio' | 'descripcion',
  string
>;
type Cambios = Partial<
  Pick<
    ProductoAdministrable,
    'modelo' | 'familia' | 'madera' | 'tipo' | 'medida' | 'anchoMin' | 'anchoMax' | 'largo' | 'precioNeto' | 'descripcion'
  >
>;

export const campos = (p: ProductoAdministrable): Campos => ({
  modelo: p.modelo,
  familia: p.familia,
  madera: p.madera,
  tipo: p.tipo ?? '',
  medida: p.medida,
  anchoMin: p.anchoMin == null ? '' : decimalCampo(p.anchoMin),
  anchoMax: p.anchoMax == null ? '' : decimalCampo(p.anchoMax),
  largo: decimalCampo(p.largo),
  // La planilla trae precios con decimales: se editan redondeados y solo se envían si cambian.
  precio: decimalCampo(Math.round(p.precioNeto)),
  descripcion: p.descripcion,
});

/** Solo lo que cambió; un error por campo si algo no se puede guardar. */
export function cambiosDe(p: ProductoAdministrable, c: Campos) {
  const errores: Partial<Record<keyof Campos, string>> = {};
  const cambios: Cambios = {};
  for (const campo of ['modelo', 'madera', 'medida', 'descripcion'] as const) {
    const valor = c[campo].trim();
    if (!valor) errores[campo] = 'Este dato es obligatorio.';
    else if (valor !== p[campo]) cambios[campo] = valor;
  }
  if (c.familia !== p.familia) cambios.familia = c.familia as ProductoAdministrable['familia'];
  const tipo = c.tipo.trim() || null;
  if (tipo !== p.tipo) cambios.tipo = tipo;
  // Las medidas se leen como en el detalle y el chat (`leerMedida`): «80 cm», «2100 mm» o «3600 mm». Solo se
  // revisan si cambian (el largo, también si cambia la familia, como en el servidor): un producto de la planilla
  // fuera de rango se puede seguir corrigiendo en lo demás.
  const originales = campos(p);
  for (const campo of ['anchoMin', 'anchoMax'] as const) {
    const texto = c[campo].trim();
    if (texto === originales[campo]) continue;
    const valor = texto ? leerMedida(texto, 'PUERTA', 'ancho') : null;
    if (texto && valor === null) errores[campo] = errorMedida('ancho', 'PUERTA');
    else if (valor !== p[campo]) cambios[campo] = valor;
  }
  if (c.largo.trim() !== originales.largo || c.familia !== p.familia) {
    const largo = leerMedida(c.largo, c.familia);
    if (largo === null) errores.largo = errorMedida('alto', c.familia);
    else if (largo !== p.largo) cambios.largo = largo;
  }
  const precio = leerPesos(c.precio);
  if (!Number.isFinite(precio) || precio <= 0) errores.precio = 'Escribe el precio en pesos, como 145.000.';
  else if (precio !== Math.round(p.precioNeto)) cambios.precioNeto = precio;
  return { cambios, errores };
}

export function GestionManuales({ avisar }: { avisar: Avisar }) {
  const [busqueda, setBusqueda] = useState(() => leerSesion('catalogo:gestion:q', ''));
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [reintento, setReintento] = useState(0);
  const [editando, setEditando] = useState<ProductoAdministrable | null>(null);
  const [ocupado, setOcupado] = useState('');
  const [confirmar, confirmacion] = useConfirmacion();
  const termino = busqueda.trim();
  // Papelera de productos agregados a mano: se relee tras eliminar o restaurar.
  const [eliminados, setEliminados] = useState<ProductoEliminado[] | null>(null);
  const [errorEliminados, setErrorEliminados] = useState('');
  const [releerEliminados, setReleerEliminados] = useState(0);
  const otraVezEliminados = useCallback(() => setReleerEliminados((n) => n + 1), []);

  useEffect(() => guardarSesion('catalogo:gestion:q', busqueda), [busqueda]);

  useEffect(() => {
    const control = new AbortController();
    pedirJSON<{ productos: ProductoEliminado[] }>('/api/catalogo', {
      json: { tipo: 'listar_eliminados' },
      signal: control.signal,
    })
      .then((d) => {
        setEliminados(d.productos);
        setErrorEliminados('');
      })
      .catch((e) => {
        if (!esSilencioso(e)) setErrorEliminados(mensajeDe(e));
      });
    return () => control.abort();
  }, [releerEliminados]);

  // Mismo ritmo que Consultar: se espera a que se deje de escribir y se cancela la consulta anterior.
  // Sin término se listan los productos agregados a mano, que son los que más se corrigen.
  useEffect(() => {
    const control = new AbortController();
    const t = setTimeout(() => {
      setCargando(true);
      pedirJSON<Respuesta>('/api/catalogo', {
        json: { tipo: 'listar_productos', ...(termino ? { q: termino } : {}) },
        signal: control.signal,
      })
        .then((d) => {
          if (!termino) {
            const manuales = d.productos.filter((p) => p.fuente === 'manual');
            d = { productos: manuales, total: manuales.length };
          }
          setDatos(d);
          setError('');
          setCargando(false);
        })
        .catch((e) => {
          if (esSilencioso(e)) return;
          setError(mensajeDe(e));
          setCargando(false);
        });
    }, 250);
    return () => {
      clearTimeout(t);
      control.abort();
    };
  }, [termino, reintento]);

  async function eliminar(p: ProductoAdministrable) {
    if (ocupado) return;
    const aceptar = await confirmar({
      titulo: 'Eliminar producto',
      mensaje: (
        <p>
          ¿Eliminar «{nombreProducto(p.descripcion)}» ({p.codigo}) del catálogo? Los borradores que lo usaban
          quedarán con el ítem pendiente.
        </p>
      ),
      aceptar: 'Eliminar producto',
    });
    if (!aceptar) return;
    setOcupado(p.codigo);
    setError('');
    try {
      await pedirJSON('/api/catalogo', { json: { tipo: 'eliminar', codigo: p.codigo } });
      setDatos((d) => d && { productos: d.productos.filter((x) => x.codigo !== p.codigo), total: d.total - 1 });
      avisar('exito', `Producto ${p.codigo} eliminado del catálogo. Puedes restaurarlo en «Productos eliminados».`);
      otraVezEliminados();
    } catch (causa) {
      if (!esSilencioso(causa)) setError(mensajeDe(causa));
    } finally {
      setOcupado('');
    }
  }

  async function restaurar(p: ProductoEliminado) {
    if (ocupado) return;
    setOcupado(p.codigo);
    setErrorEliminados('');
    try {
      await pedirJSON('/api/catalogo', { json: { tipo: 'restaurar', codigo: p.codigo } });
      avisar('exito', `Producto ${p.codigo} restaurado en el catálogo.`);
      setEliminados((lista) => lista && lista.filter((x) => x.codigo !== p.codigo));
      // La lista de arriba lo vuelve a mostrar (sin búsqueda, lista los agregados a mano).
      setReintento((n) => n + 1);
      otraVezEliminados();
    } catch (causa) {
      if (!esSilencioso(causa)) setErrorEliminados(mensajeDe(causa));
    } finally {
      setOcupado('');
    }
  }

  const productos = datos?.productos ?? [];
  return (
    <div className="gestion-manuales">
      <p className="catalog-modal-intro">
        Corrige los datos de productos agregados a mano o importados. Los cambios en productos de la planilla se
        reemplazan la próxima vez que la importes.
      </p>
      <label className="catalogo-busqueda">
        <span>Buscar por código, modelo, madera o medida</span>
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Ej.: MOL-O-3-A o Molco 0,80"
          maxLength={120}
        />
      </label>
      {error ? (
        <p className="catalog-error" role="alert">
          {error}{' '}
          <button type="button" className="link" onClick={() => setReintento((n) => n + 1)}>
            Reintentar
          </button>
        </p>
      ) : !datos ? (
        <p className="muted">Cargando productos…</p>
      ) : !productos.length ? (
        <p className="muted">
          {termino
            ? 'No se encontraron productos.'
            : (
              <>
                Aún no hay productos agregados a mano. Busca un código, modelo, madera o medida para corregir uno de
                la planilla, o <a href="/catalogo?seccion=agregar">agrega un producto</a>.
              </>
            )}
        </p>
      ) : (
        <p className="muted" aria-live="polite" aria-busy={cargando}>
          {!termino
            ? `${productos.length} producto${productos.length === 1 ? '' : 's'} agregado${productos.length === 1 ? '' : 's'} a mano. Busca para corregir uno de la planilla.`
            : datos.total > productos.length
              ? `Mostrando ${productos.length} de ${datos.total} productos: afina la búsqueda para ver el resto.`
              : `${datos.total} producto${datos.total === 1 ? '' : 's'}.`}
        </p>
      )}
      {productos.length > 0 && (
        <div className="catalogo-lista" tabIndex={0} role="region" aria-label="Productos encontrados">
          <table>
            <thead>
              <tr>
                <th scope="col">Producto / código</th>
                <th scope="col">Medida</th>
                <th scope="col">Precio base sin IVA</th>
                <th scope="col">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {productos.map((p) => (
                <tr key={p.codigo}>
                  <td>
                    {nombreProducto(p.descripcion)}
                    <small>
                      {p.codigo} · {p.fuente === 'manual' ? 'Agregado a mano' : 'Planilla'}
                    </small>
                  </td>
                  <td data-etiqueta="Medida">{medidaProducto(p)}</td>
                  <td data-etiqueta="Precio base sin IVA">{pesos(p.precioNeto)}</td>
                  <td className="celda-acciones">
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() => setEditando(p)}
                      disabled={!!ocupado}
                      aria-label={`Editar ${p.codigo}`}
                    >
                      Editar
                    </button>
                    {p.fuente === 'manual' && (
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() => void eliminar(p)}
                        disabled={!!ocupado}
                        aria-label={`Eliminar ${p.codigo}`}
                      >
                        Eliminar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(!!eliminados?.length || errorEliminados) && (
        <details className="gestion-eliminados">
          <summary>
            Productos eliminados{eliminados ? ` (${eliminados.length})` : ''}
          </summary>
          <p className="muted">
            Productos agregados a mano que se eliminaron. Al restaurarlos vuelven tal como estaban, con quién los agregó
            y cuándo.
          </p>
          {errorEliminados && (
            <p className="catalog-error" role="alert">
              {errorEliminados}{' '}
              <button type="button" className="link" onClick={otraVezEliminados}>
                Reintentar
              </button>
            </p>
          )}
          {!!eliminados?.length && (
            <div className="catalogo-lista" tabIndex={0} role="region" aria-label="Productos eliminados">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Producto / código</th>
                    <th scope="col">Medida</th>
                    <th scope="col">Precio base sin IVA</th>
                    <th scope="col">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {eliminados.map((p) => (
                    <tr key={p.codigo}>
                      <td>
                        {nombreProducto(p.descripcion)}
                        <small>
                          {p.codigo} · Eliminado el {fechaCorta(p.eliminada)}
                          {p.creada ? ` · Agregado el ${fechaCorta(p.creada)}` : ''}
                          {p.creadaPor ? ` por ${p.creadaPor}` : ''}
                        </small>
                        {p.codigoOcupado && (
                          <small id={`ocupado-${p.codigo}`}>Otro producto usa hoy este código: no se puede restaurar.</small>
                        )}
                      </td>
                      <td data-etiqueta="Medida">{medidaProducto(p)}</td>
                      <td data-etiqueta="Precio base sin IVA">{pesos(p.precioNeto)}</td>
                      <td className="celda-acciones">
                        <button
                          type="button"
                          className="button secondary small"
                          onClick={() => void restaurar(p)}
                          disabled={!!ocupado || p.codigoOcupado}
                          aria-label={`Restaurar ${p.codigo}`}
                          aria-describedby={p.codigoOcupado ? `ocupado-${p.codigo}` : undefined}
                        >
                          {ocupado === p.codigo ? 'Restaurando…' : 'Restaurar'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
      )}
      {editando && (
        <EditorProducto
          producto={editando}
          cerrar={() => setEditando(null)}
          guardado={(nuevo) => {
            setDatos(
              (d) => d && { ...d, productos: d.productos.map((x) => (x.codigo === nuevo.codigo ? { ...x, ...nuevo } : x)) },
            );
            avisar('exito', `Cambios guardados en ${nuevo.codigo}.`);
          }}
        />
      )}
      {confirmacion}
    </div>
  );
}

/** Editor de un producto en un diálogo: la tabla queda de solo lectura y cabe en cualquier ancho. */
function EditorProducto({
  producto,
  cerrar,
  guardado,
}: {
  producto: ProductoAdministrable;
  cerrar: () => void;
  guardado: (p: ProductoAdministrable) => void;
}) {
  const uid = useId();
  const [valores, setValores] = useState<Campos>(() => campos(producto));
  const [errores, setErrores] = useState<Partial<Record<keyof Campos, string>>>({});
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const formulario = useRef<HTMLFormElement>(null);
  const puerta = valores.familia === 'PUERTA';

  async function guardar(evento: FormEvent) {
    evento.preventDefault();
    if (ocupado) return;
    const { cambios, errores } = cambiosDe(producto, valores);
    setErrores(errores);
    const primero = Object.keys(errores)[0];
    if (primero) {
      formulario.current?.querySelector<HTMLElement>(`#${CSS.escape(`${uid}-${primero}`)}`)?.focus();
      return;
    }
    if (!Object.keys(cambios).length) return cerrar();
    setOcupado(true);
    setError('');
    try {
      const data = await pedirJSON<{ producto: ProductoAdministrable }>('/api/catalogo', {
        json: { tipo: 'editar', codigo: producto.codigo, cambios },
      });
      guardado(data.producto);
      cerrar();
    } catch (causa) {
      if (!esSilencioso(causa)) setError(mensajeDe(causa));
      setOcupado(false);
    }
  }

  const campo = (nombre: keyof Campos, etiqueta: string, extra: { ayuda?: string; ancho?: boolean; numero?: boolean } = {}) => (
    // La ayuda y el error van fuera de la etiqueta: el nombre del campo es solo su etiqueta y el resto se lee como descripción.
    <div className={`alta-campo${extra.ancho ? ' alta-campo-ancho' : ''}`}>
      <span>
        <label htmlFor={`${uid}-${nombre}`}>{etiqueta}</label>
      </span>
      <input
        id={`${uid}-${nombre}`}
        value={valores[nombre]}
        onChange={(e) => {
          const valor = e.target.value;
          setValores((v) => ({ ...v, [nombre]: valor }));
          setErrores((x) => ({ ...x, [nombre]: undefined }));
        }}
        inputMode={extra.numero ? 'decimal' : undefined}
        aria-invalid={errores[nombre] ? true : undefined}
        aria-describedby={errores[nombre] || extra.ayuda ? `${uid}-${nombre}-ayuda` : undefined}
        disabled={ocupado}
      />
      {(errores[nombre] || extra.ayuda) && (
        <small id={`${uid}-${nombre}-ayuda`} className={errores[nombre] ? 'campo-error' : undefined}>
          {errores[nombre] ?? extra.ayuda}
        </small>
      )}
    </div>
  );

  return (
    <Dialogo abierto alCerrar={cerrar} cerrable={!ocupado} titulo={nombreProducto(producto.descripcion)} eyebrow={`EDITAR · ${producto.codigo}`}>
      <form ref={formulario} className="gestion-editor" onSubmit={guardar} noValidate>
        {producto.fuente === 'planilla' && (
          <p className="catalog-warning">
            Producto de la planilla: este cambio se reemplaza la próxima vez que importes la planilla.
          </p>
        )}
        <div className="alta-campos">
          <div className="alta-campo">
            <span id={`${uid}-familia-label`}>Familia</span>
            <SelectorFamilia
              id={`${uid}-familia-label`}
              value={valores.familia}
              opciones={FAMILIAS}
              vacio="Elige una familia"
              disabled={ocupado}
              seleccionar={(familia) => setValores((v) => ({ ...v, familia }))}
            />
          </div>
          {campo('modelo', 'Modelo')}
          {campo('madera', 'Madera')}
          {campo('tipo', 'Tipo (opcional)')}
          {campo('medida', puerta ? 'Medida (texto)' : 'Medida o escuadría', puerta ? undefined : { ayuda: 'Escuadría: grosor por ancho de la pieza.' })}
          {puerta && campo('anchoMin', 'Ancho mínimo', { numero: true, ayuda: 'En metros (0,80), centímetros (80 cm) o milímetros (800 mm).' })}
          {puerta && campo('anchoMax', 'Ancho máximo', { numero: true })}
          {campo('largo', puerta ? 'Alto' : 'Largo', {
            numero: true,
            ayuda: `En metros (2,10), centímetros (210 cm) o milímetros (2100 mm), ${textoRangoMedida('alto', valores.familia)}.`,
          })}
          {campo('precio', 'Precio base sin IVA', { numero: true, ayuda: 'Costo de fábrica, sin la ganancia de venta.' })}
          {campo('descripcion', 'Descripción', { ancho: true, ayuda: 'Es el texto que aparece en la cotización y el PDF.' })}
        </div>
        {error && (
          <p className="catalog-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialogo-acciones">
          <button type="button" className="button secondary" onClick={cerrar} disabled={ocupado}>
            Cancelar
          </button>
          <button type="submit" className="button primary" disabled={ocupado}>
            {ocupado ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
