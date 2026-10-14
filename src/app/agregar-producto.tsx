'use client';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { FAMILIAS } from '@/catalogo/familias';
import type { Familia, ReferenciaItem } from '@/catalogo/tipos';
import { leerPesos } from '@/negocio/cifras';
import { pesos } from '@/negocio/precios';
import type { ProductoConsulta, ProductoElegido, ProductoPersonalizadoElegido } from './contrato';
import { Dialogo } from './dialogo';
import { decimalCampo, errorMedida, leerMedida, nombreProducto } from './formato';
import { ReferenciasItem } from './referencias-item';
import { SelectorDesplegable } from './selector-desplegable';
import { SelectorFamilia } from './selector-familia';
import { esSilencioso, mensajeDe, pedirJSON } from './solicitud';

export function AgregarProducto({
  alCerrar,
  agregar,
  agregarPersonalizado,
  ocupado,
}: {
  alCerrar: () => void;
  agregar: (producto: ProductoElegido) => Promise<boolean>;
  agregarPersonalizado: (producto: ProductoPersonalizadoElegido) => Promise<boolean>;
  ocupado: boolean;
}) {
  /** Producto fuera de catálogo; el nombre parte de lo que se buscó. */
  const [personalizado, setPersonalizado] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const [busqueda, setBusqueda] = useState('');
  const [datos, setDatos] = useState<{
    consulta: string;
    total: number;
    productos: ProductoConsulta[];
  } | null>(null);
  const [error, setError] = useState('');
  const [reintento, setReintento] = useState(0);
  const [seleccion, setSeleccion] = useState<ProductoConsulta | null>(null);
  const consulta = busqueda.trim();
  useEffect(() => {
    const control = new AbortController();
    const timer = setTimeout(() => {
      pedirJSON<{ total: number; productos: ProductoConsulta[] }>(
        `/api/catalogo?${new URLSearchParams({ q: consulta })}`,
        {
          signal: control.signal,
          cache: 'no-store',
        },
      )
        .then((d) => {
          setDatos({ ...d, consulta });
          setError('');
        })
        .catch((e) => {
          if (!esSilencioso(e)) setError(mensajeDe(e));
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      control.abort();
    };
  }, [consulta, reintento]);
  return (
    <Dialogo
      abierto
      alCerrar={alCerrar}
      titulo={personalizado === null ? 'Agregar producto' : 'Producto personalizado'}
      eyebrow={personalizado === null ? 'CATÁLOGO' : 'FUERA DE CATÁLOGO'}
      focoInicial={entrada}
      cerrable={!ocupado}
      className="dialogo-productos"
    >
      {personalizado !== null ? (
        <FormPersonalizado
          nombreInicial={personalizado}
          agregar={agregarPersonalizado}
          ocupado={ocupado}
          volver={() => setPersonalizado(null)}
        />
      ) : seleccion ? (
        <SeleccionProducto
          key={seleccion.codigo}
          producto={seleccion}
          agregar={agregar}
          ocupado={ocupado}
          volver={() => setSeleccion(null)}
        />
      ) : (
        <>
          <label className="catalogo-busqueda-label" htmlFor="producto-buscar">
            Busca por modelo, madera o código
          </label>
          <input
            ref={entrada}
            id="producto-buscar"
            className="producto-buscar"
            type="search"
            maxLength={100}
            value={busqueda}
            placeholder="Ej. Huilo Huilo oregón"
            onChange={(e) => {
              setBusqueda(e.target.value);
              setError('');
            }}
          />
          {error ? (
            <div role="alert" className="producto-error">
              <p>{error}</p>
              <button
                type="button"
                className="button secondary small"
                onClick={() => {
                  setDatos(null);
                  setError('');
                  setReintento((n) => n + 1);
                }}
              >
                Reintentar
              </button>
            </div>
          ) : datos?.consulta !== consulta ? (
            <p role="status" className="producto-resultados-ayuda">
              Buscando productos…
            </p>
          ) : (
            <>
              <p role="status" className="producto-resultados-ayuda">
                {datos.total
                  ? `${datos.total} resultados${datos.total > 24 ? ' · Mostrando los primeros 24; precisa tu búsqueda.' : ''}`
                  : 'No encontramos productos. Prueba otro modelo, madera o código.'}
              </p>
              <ul className="producto-resultados">
                {datos.productos.slice(0, 24).map((p) => (
                  <li key={p.codigo}>
                    <button type="button" onClick={() => setSeleccion(p)}>
                      <span>
                        <strong>{nombreProducto(p.descripcion)}</strong>
                        <small>
                          {p.codigo} · {nombreProducto(p.madera)}
                        </small>
                      </span>
                      <span>
                        <strong>{pesos(p.unitario)}</strong>
                        <small>unitario sin IVA de referencia</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="producto-personalizado-entrada">
            <span>¿El cliente pide un diseño que no está en el catálogo?</span>
            <button
              type="button"
              className="button secondary small"
              onClick={() => setPersonalizado(datos?.total === 0 ? consulta : '')}
            >
              Crear producto personalizado
            </button>
          </div>
        </>
      )}
    </Dialogo>
  );
}

function SeleccionProducto({
  producto: p,
  agregar,
  ocupado,
  volver,
}: {
  producto: ProductoConsulta;
  agregar: (producto: ProductoElegido) => Promise<boolean>;
  ocupado: boolean;
  volver: () => void;
}) {
  const puerta = p.familia === 'PUERTA';
  const [cantidad, setCantidad] = useState('1');
  const [error, setError] = useState('');
  const inicialAncho = p.anchoMax ?? p.anchoMin ?? null;
  const [ancho, setAncho] = useState(inicialAncho === null ? '' : decimalCampo(inicialAncho));
  const [alto, setAlto] = useState(decimalCampo(p.altoMax ?? p.largo));
  const [tipoMedida, setTipoMedida] = useState<NonNullable<ProductoElegido['tipoMedida']>>('no_especificado');
  /** Lo que admite este producto, en palabras: «entre 0,80 y 0,85 m» o «3,6 m». */
  const tramo = (min: number, max: number) =>
    min === max ? `${decimalCampo(min)} m` : `entre ${decimalCampo(min)} y ${decimalCampo(max)} m`;
  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError('');
    // Medidas como texto (coma, punto, «cm» o «mm»): un campo numérico del navegador las entregaba vacías.
    const n = Number(cantidad.trim());
    const anchoM = puerta ? leerMedida(ancho, 'PUERTA', 'ancho') : null;
    const altoM = leerMedida(alto, p.familia);
    const anchoMin = p.anchoMin ?? inicialAncho ?? 0,
      anchoMax = p.anchoMax ?? inicialAncho ?? Infinity,
      altoMin = p.altoMin ?? p.largo,
      altoMax = p.altoMax ?? p.largo;
    const dentro = (m: number, min: number, max: number) => m >= min - 1e-9 && m <= max + 1e-9;
    const problema = !Number.isInteger(n) || n < 1 || n > 10000
      ? 'La cantidad debe ser un número entero entre 1 y 10.000.'
      : puerta && anchoM === null
        ? errorMedida('ancho', 'PUERTA')
        : puerta && anchoM !== null && !dentro(anchoM, anchoMin, anchoMax)
          ? `Este producto se cotiza con un ancho ${tramo(anchoMin, anchoMax)}.`
          : altoM === null
            ? errorMedida('alto', p.familia)
            : !dentro(altoM, altoMin, altoMax)
              ? `Este producto se cotiza con un ${puerta ? 'alto' : 'largo'} ${tramo(altoMin, altoMax)}.`
              : null;
    if (problema) {
      setError(problema);
      return;
    }
    try {
      await agregar({
        codigo: p.codigo,
        cantidad: n,
        ...(puerta ? { ancho: anchoM!, tipoMedida } : {}),
        alto: altoM!,
      });
    } catch (e) {
      setError(mensajeDe(e));
    }
  }
  return (
    <form onSubmit={enviar} className="producto-seleccion" noValidate>
      <button type="button" className="producto-volver" onClick={volver} disabled={ocupado}>
        ← Volver a resultados
      </button>
      <div className="producto-elegido">
        <strong>{nombreProducto(p.descripcion)}</strong>
        <small>
          {p.codigo} · {pesos(p.unitario)} sin IVA, unitario de referencia
        </small>
      </div>
      <p className="ayuda">El precio final se calcula con las condiciones de esta cotización.</p>
      <div className="producto-medidas">
        <label>
          Cantidad
          <input
            autoFocus
            type="number"
            min={1}
            max={10000}
            step={1}
            required
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            disabled={ocupado}
          />
        </label>
        {puerta && (
          <label>
            Ancho (m)
            <input
              type="text"
              inputMode="decimal"
              maxLength={12}
              value={ancho}
              onChange={(e) => setAncho(e.target.value)}
              disabled={ocupado}
            />
          </label>
        )}
        <label>
          {puerta ? 'Alto (m)' : 'Largo (m)'}
          <input
            type="text"
            inputMode="decimal"
            maxLength={12}
            value={alto}
            onChange={(e) => setAlto(e.target.value)}
            disabled={ocupado}
          />
        </label>
        {p.familia === 'PUERTA' && (
          <label>
            La medida corresponde a
            <select
              value={tipoMedida}
              onChange={(e) => setTipoMedida(e.target.value as typeof tipoMedida)}
              disabled={ocupado}
            >
              <option value="no_especificado">Por confirmar</option>
              <option value="hoja">Hoja (la puerta)</option>
              <option value="vano">Vano (hueco del muro)</option>
            </select>
          </label>
        )}
      </div>
      {error && (
        <p role="alert" className="producto-error">
          {error}
        </p>
      )}
      <div className="dialogo-acciones">
        <button type="submit" className="button primary" disabled={ocupado}>
          {ocupado ? 'Agregando…' : 'Agregar al pedido'}
        </button>
      </div>
    </form>
  );
}

const TIPOS_MEDIDA = [
  { value: 'no_especificado', label: 'Por confirmar' },
  { value: 'hoja', label: 'Hoja (la puerta)' },
  { value: 'vano', label: 'Vano (hueco del muro)' },
] as const;

/**
 * Producto que el cliente pide y no está en el catálogo (p. ej. una puerta según una foto). Queda solo en esta
 * cotización, con el precio que se escribe aquí y las referencias que entregó el cliente.
 */
function FormPersonalizado({
  nombreInicial,
  agregar,
  ocupado,
  volver,
}: {
  nombreInicial: string;
  agregar: (producto: ProductoPersonalizadoElegido) => Promise<boolean>;
  ocupado: boolean;
  volver: () => void;
}) {
  const uid = useId();
  const [campos, setCampos] = useState({
    nombre: nombreInicial,
    madera: '',
    descripcion: '',
    ancho: '',
    alto: '',
    cantidad: '1',
    precio: '',
    observaciones: '',
  });
  const [familia, setFamilia] = useState<Familia>('PUERTA');
  const [tipoMedida, setTipoMedida] = useState<ProductoPersonalizadoElegido['tipoMedida']>('no_especificado');
  const [referencias, setReferencias] = useState<ReferenciaItem[]>([]);
  // Mientras sube una referencia no se agrega: el producto quedaría sin ella y sin aviso.
  const [subiendo, setSubiendo] = useState(false);
  const [errores, setErrores] = useState<Partial<Record<keyof typeof campos, string>>>({});
  const [error, setError] = useState('');
  const cambiar = (campo: keyof typeof campos, valor: string) => {
    setCampos((c) => ({ ...c, [campo]: valor }));
    setErrores((e) => ({ ...e, [campo]: undefined }));
  };

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (subiendo) return;
    setError('');
    // El largo de un accesorio llega a 6 m; el ancho y el alto de una puerta, a 3 m (`rangoMedidas`).
    const medida = (texto: string, campo: 'ancho' | 'alto') =>
      texto.trim() ? leerMedida(texto, familia, campo) : null;
    const ancho = medida(campos.ancho, 'ancho'),
      alto = medida(campos.alto, 'alto'),
      cantidad = Number(campos.cantidad),
      precio = campos.precio.trim() ? leerPesos(campos.precio) : null;
    const ilegible = (texto: string, n: number | null) => !!texto.trim() && n === null;
    const nuevos: typeof errores = {
      ...(!campos.nombre.trim() && { nombre: 'Escribe el nombre del producto.' }),
      ...(!campos.madera.trim() && { madera: 'Indica la madera.' }),
      ...(ilegible(campos.ancho, ancho) && { ancho: errorMedida('ancho', familia) }),
      ...(ilegible(campos.alto, alto) && { alto: errorMedida('alto', familia) }),
      ...((!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10000) && {
        cantidad: 'La cantidad debe ser un entero entre 1 y 10.000.',
      }),
      ...((precio === null || !Number.isSafeInteger(precio) || precio <= 0 || precio > 100_000_000) && {
        precio: 'Escribe el precio unitario sin IVA, por ejemplo 245.000.',
      }),
    };
    setErrores(nuevos);
    if (Object.keys(nuevos).length) return;
    try {
      await agregar({
        nombre: campos.nombre.trim(),
        familia,
        madera: campos.madera.trim(),
        descripcion: campos.descripcion.trim() || null,
        ancho,
        alto,
        tipoMedida: familia === 'PUERTA' ? tipoMedida : 'no_especificado',
        cantidad,
        precioUnitario: precio!,
        observaciones: campos.observaciones.trim() || null,
        referencias,
      });
    } catch (e) {
      setError(mensajeDe(e));
    }
  }

  const campo = (
    nombre: keyof typeof campos,
    etiqueta: string,
    props: { placeholder?: string; inputMode?: 'decimal' | 'numeric'; maxLength?: number; autoFocus?: boolean } = {},
  ) => (
    <label className={errores[nombre] ? 'con-error' : undefined}>
      {etiqueta}
      <input
        type="text"
        value={campos[nombre]}
        onChange={(e) => cambiar(nombre, e.target.value)}
        disabled={ocupado}
        aria-invalid={!!errores[nombre]}
        maxLength={props.maxLength ?? 300}
        {...props}
      />
      {errores[nombre] && <small className="campo-error">{errores[nombre]}</small>}
    </label>
  );

  return (
    <form onSubmit={enviar} className="producto-seleccion producto-personalizado" noValidate>
      <button type="button" className="producto-volver" onClick={volver} disabled={ocupado}>
        ← Volver al catálogo
      </button>
      <p className="ayuda">
        Se agrega solo a esta cotización, con el precio que indiques. No se crea en el catálogo.
      </p>
      <div className="producto-medidas">
        {campo('nombre', 'Nombre del producto', {
          placeholder: 'Ej.: Puerta según diseño del cliente',
          autoFocus: true,
        })}
        <div className="producto-campo">
          <span id={`${uid}-familia`}>Tipo de producto</span>
          <SelectorFamilia
            id={`${uid}-familia`}
            value={familia}
            opciones={FAMILIAS}
            vacio="Elige el tipo"
            disabled={ocupado}
            seleccionar={(f) => setFamilia(f as Familia)}
          />
        </div>
        {campo('madera', 'Madera', { placeholder: 'Ej.: Roble' })}
        {campo('cantidad', 'Cantidad', { inputMode: 'numeric', maxLength: 6 })}
        {campo('ancho', 'Ancho (m) · opcional', { placeholder: '0,80', inputMode: 'decimal', maxLength: 12 })}
        {campo('alto', familia === 'PUERTA' ? 'Alto (m) · opcional' : 'Largo (m) · opcional', {
          placeholder: familia === 'PUERTA' ? '2,10' : '3,60',
          inputMode: 'decimal',
          maxLength: 12,
        })}
        {familia === 'PUERTA' && (
          <div className="producto-campo">
            <span>La medida corresponde a</span>
            <SelectorDesplegable
              ariaLabel="La medida corresponde a"
              value={tipoMedida}
              opciones={TIPOS_MEDIDA}
              disabled={ocupado}
              onChange={(v) => setTipoMedida(v as typeof tipoMedida)}
            />
          </div>
        )}
        {campo('precio', 'Precio unitario sin IVA ($)', { placeholder: 'Ej.: 245.000', inputMode: 'numeric', maxLength: 15 })}
      </div>
      <div className="producto-medidas producto-textos">
        {campo('descripcion', 'Descripción para el documento · opcional', {
          placeholder: 'Ej.: Puerta sólida de roble según fotografía adjunta',
        })}
        {campo('observaciones', 'Observaciones · opcional', { maxLength: 1000 })}
      </div>
      <ReferenciasItem
        referencias={referencias}
        editable
        amplio
        ocupado={ocupado}
        producto={campos.nombre.trim() || 'el producto personalizado'}
        guardar={async (lista) => {
          setReferencias(lista);
          return true;
        }}
        alSubir={setSubiendo}
      />
      {error && (
        <p role="alert" className="producto-error">
          {error}
        </p>
      )}
      <div className="dialogo-acciones">
        <button type="submit" className="button primary" disabled={ocupado || subiendo}>
          {ocupado ? 'Agregando…' : subiendo ? 'Subiendo referencia…' : 'Agregar al pedido'}
        </button>
      </div>
    </form>
  );
}
