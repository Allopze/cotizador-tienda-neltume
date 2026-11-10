import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ANTICIPO_TEXTO } from '@/negocio/limites';
import { DIAS_PAPELERA } from '@/servidor/almacen';
import { auth } from '@/servidor/autenticacion';
import { validarConfiguracionAutenticacion } from '@/servidor/autenticacion-config';
import { Encabezado } from '../encabezado';
import { EncabezadoPagina } from '../encabezado-pagina';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Neltume · Cómo funciona' };

/**
 * Guía «Cómo funciona» para quien cotiza: el ciclo de una cotización con los nombres de los botones tal como se
 * ven, qué significa cada estado, cómo deshacer y a quién pedir ayuda. Texto fijo, sin datos: si cambia un botón
 * o una regla, se cambia aquí también.
 */
export default async function AyudaPage() {
  validarConfiguracionAutenticacion();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/login');
  return (
    <div className="app-shell">
      <Encabezado email={session.user.email} nombre={session.user.name || session.user.email} pantalla="ayuda" />
      <EncabezadoPagina titulo="Cómo funciona" id="ayuda-titulo" />
      <main className="ayuda-pagina superficie" aria-labelledby="ayuda-titulo">
        <p className="ayuda-intro">
          Una cotización avanza paso a paso, desde el pedido del cliente hasta la factura. En cada momento, el botón
          principal de la cotización muestra lo que toca hacer ahora.
        </p>
        <nav className="ayuda-indice" aria-label="En esta página">
          <ul>
            <li>
              <a href="#ayuda-ciclo">Los pasos de una cotización</a>
            </li>
            <li>
              <a href="#ayuda-estados">Qué significa cada estado</a>
            </li>
            <li>
              <a href="#ayuda-lineas">Líneas repetidas, copias y productos especiales</a>
            </li>
            <li>
              <a href="#ayuda-catalogo">El catálogo en 5 minutos</a>
            </li>
            <li>
              <a href="#ayuda-palabras">Qué significa cada palabra</a>
            </li>
            <li>
              <a href="#ayuda-deshacer">Cómo deshacer</a>
            </li>
            <li>
              <a href="#ayuda-contacto">A quién pedir ayuda</a>
            </li>
          </ul>
        </nav>

        <section className="ayuda-seccion" aria-labelledby="ayuda-ciclo">
          <h2 id="ayuda-ciclo">Los pasos de una cotización</h2>
          <ol className="ayuda-pasos">
            <li>
              <strong>Escribe el pedido o agrega productos.</strong> En <Link href="/">Cotizar</Link>, cuenta en el
              chat lo que pide el cliente: modelo, madera, medidas, cantidad y, si los tienes, sus datos. Por
              ejemplo: «3 Huilo Huilo en oregón de 80 × 2,10 para Juan Pérez, Temuco». También puedes elegirlos del
              catálogo con «Agregar producto» (en el teléfono, «+ Producto»). La cotización se arma al lado; en el
              teléfono, en la pestaña «Cotización».
            </li>
            <li>
              <strong>Revisa y completa lo pendiente.</strong> Un producto marcado «Incompleto · no suma al total»
              necesita un dato, por ejemplo la medida o la madera. Respóndelo en el chat o directamente en el
              detalle. Si una medida no dice si es de <em>hoja</em> (la puerta misma) o de <em>vano</em> (el hueco del
              muro donde va instalada), el cotizador te lo pregunta.
            </li>
            <li>
              <strong>Emite la cotización.</strong> Con todo completo, pulsa «Emitir y generar PDF». Recibe su número
              (N°) y el PDF para el cliente, que puedes descargar o, en el teléfono, compartir.
            </li>
            <li>
              <strong>Registra la aprobación cuando el cliente acepta.</strong> Pulsa «Registrar aprobación del
              cliente». Desde ahí la cotización ya no se edita y aparece el «Seguimiento del pedido».
            </li>
            <li>
              <strong>Registra el anticipo.</strong> En el seguimiento, escribe lo que pagó el cliente en «Monto
              recibido» y pulsa «Registrar pago». Con al menos el {ANTICIPO_TEXTO} pagado se habilita la nota de
              pedido.
            </li>
            <li>
              <strong>Genera la nota de pedido para fábrica.</strong> «Generar notas de pedido» pide la fábrica de
              cada ítem (no hay una por omisión: la eliges tú) y genera una nota por fábrica, solo con sus ítems y con
              el siguiente número de esa fábrica. El reparto se puede preparar antes con «Repartir entre fábricas» o
              pidiéndoselo al asistente («las Coz Coz van a Santiago»).
            </li>
            <li>
              <strong>Producción.</strong> Pulsa «Iniciar producción» cuando el pedido entra a fábrica y «Marcar
              producción terminada» cuando fábrica lo termina. Con notas para las dos fábricas, cada una se marca por
              separado y el pedido sigue a despacho cuando terminan todas.
            </li>
            <li>
              <strong>Despacho.</strong> Con el total pagado, pulsa «Marcar lista para despacho», indica el
              transportista en «Despacho» y registra la salida con «Registrar despacho». Al cerrar, «Completar
              operación».
            </li>
            <li>
              <strong>Facturación.</strong> Anota la factura o boleta (número y fecha) y pulsa «Marcar como
              facturada».
            </li>
          </ol>
          <p className="ayuda-nota">
            En el seguimiento, el recuadro «Siguiente acción» dice siempre qué falta y trae el botón para hacerlo.
          </p>
        </section>

        <section className="ayuda-seccion" aria-labelledby="ayuda-estados">
          <h2 id="ayuda-estados">Qué significa cada estado</h2>
          <dl className="ayuda-estados">
            <div>
              <dt>
                <span className="status borrador">Borrador</span>
              </dt>
              <dd>
                En preparación: todavía no se envía al cliente y puedes cambiar todo. Recibe su número al emitirla.
              </dd>
            </div>
            <div>
              <dt>
                <span className="status emitida">Emitida</span>
              </dt>
              <dd>
                Tiene número y PDF para el cliente. Si la cambias, se crea una <em>revisión</em>: una versión nueva
                en borrador que la reemplazará cuando la emitas. El PDF ya enviado no se toca.
              </dd>
            </div>
            <div>
              <dt>
                <span className="status vencida">Vencida</span>
              </dt>
              <dd>
                Aparece junto a «Emitida» cuando pasó la vigencia. Todavía se puede aprobar, pero se pide confirmar.
              </dd>
            </div>
            <div>
              <dt>
                <span className="status aprobada">Aprobada</span>
              </dt>
              <dd>
                El cliente aceptó. Ya no se edita: desde aquí se registran pagos, nota de pedido, producción,
                despacho y facturación.
              </dd>
            </div>
            <div>
              <dt>
                <span className="status reemplazada">Reemplazada</span>
              </dt>
              <dd>
                Se emitió una revisión que la reemplaza. Queda guardada para consultarla, pero ya no se puede aprobar
                ni editar.
              </dd>
            </div>
            <div>
              <dt>
                <span className="status anulada">Anulada</span>
              </dt>
              <dd>
                Quedó sin efecto, por ejemplo porque el cliente la rechazó. Su número no se vuelve a usar. Puedes
                duplicarla para preparar una nueva.
              </dd>
            </div>
          </dl>
        </section>

        <section className="ayuda-seccion" aria-labelledby="ayuda-lineas">
          <h2 id="ayuda-lineas">Líneas repetidas, copias y productos especiales</h2>
          <ul className="ayuda-lista">
            <li>
              <strong>Varias puertas iguales en líneas separadas:</strong> agrégalas una por una, o pídeselo al
              asistente («4 Ranco pino oregón: 0,85, 1,00, 0,85 y 1,00, todas de 2,20»). Cada línea es independiente:
              cambiar una no toca las otras.
            </li>
            <li>
              <strong>Una copia para modificar:</strong> el botón de copiar en la fila de un producto la duplica justo
              debajo, con su precio, descuento, observaciones y fotos, y abre la copia para que cambies lo que la hace
              distinta. Al asistente: «duplica la Ranco y que la copia sea vidriada».
            </li>
            <li>
              <strong>Una puerta con algo que el catálogo no tiene</strong> (vidrio, otro espesor): en «Editar
              detalles», «Convertir en producto especial». Conserva el precio de partida y después puedes cambiar el
              nombre, la descripción o el precio sin que la línea quede pendiente.
            </li>
            <li>
              <strong>Algo que no está en el catálogo:</strong> «Agregar producto» → «Crear producto especial». Queda
              solo en esta cotización; el catálogo no cambia. Si lo fabrica Neltume, elige su tipo de producto y va a
              la nota de pedido. Si es otro cargo (instalación, flete local), elige «Otro cargo»: no va a fábrica.
            </li>
            <li>
              <strong>Varios productos seguidos a mano:</strong> en «Agregar producto», «Agregar y seguir» te deja en
              la búsqueda para elegir el siguiente sin cerrar la ventana.
            </li>
          </ul>
        </section>

        <section className="ayuda-seccion" aria-labelledby="ayuda-catalogo">
          <h2 id="ayuda-catalogo">El catálogo en 5 minutos</h2>
          <ul className="ayuda-lista">
            <li>
              <strong>Cada producto del catálogo es una combinación:</strong> un modelo (Ranco), en una madera (Pino
              Oregón), para un rango de anchos (0,80 a 0,85 m) y un alto (2,10 m). Por eso un modelo tiene muchas
              filas: una por cada madera y medida, cada una con su costo.
            </li>
            <li>
              <strong>El precio de venta</strong> es el costo de fábrica más la ganancia de su categoría (por ejemplo,
              «Puertas sólidas Pino Oregón»). La categoría la deciden el tipo de producto y la madera. Al crear un
              producto, la revisión muestra el precio de venta exacto antes de guardar.
            </li>
            <li>
              <strong>Buscar:</strong> escribe como lo dice el cliente: «willow mara 82 210», «ranco 1 metro». El
              buscador entiende los mismos nombres que el asistente y, con muchos resultados, primero muestra los
              modelos para que elijas uno. En Catálogo → Consultar, «Cotizar» lo lleva directo a la cotización.
            </li>
            <li>
              <strong>Crear un producto en el catálogo</strong> (Catálogo → Agregar producto) lo deja disponible para
              todas las cotizaciones. Después de guardar, «Agregar otra medida o madera» conserva el modelo y la madera
              para cargar la siguiente medida. Si es algo para un solo cliente, usa un producto especial en la
              cotización.
            </li>
            <li>
              <strong>No hace falta crear tipos de producto:</strong> son fijos (puerta, marco, pieza T, moldura) y
              deciden cómo se mide cada producto: ancho × alto en las puertas, sección × largo en los accesorios.
            </li>
          </ul>
        </section>

        <section className="ayuda-seccion" aria-labelledby="ayuda-palabras">
          <h2 id="ayuda-palabras">Qué significa cada palabra</h2>
          <dl className="ayuda-estados">
            <div>
              <dt>Tipo de producto</dt>
              <dd>Puerta, marco, pieza T o moldura. Antes se llamaba «familia».</dd>
            </div>
            <div>
              <dt>Modelo</dt>
              <dd>El nombre de la puerta o accesorio: Ranco, Huilo Huilo, Marco.</dd>
            </div>
            <div>
              <dt>Estilo</dt>
              <dd>Dato informativo del producto (panel, bloque). «Puerta especial» en la planilla son las de 1,10 m o más de ancho.</dd>
            </div>
            <div>
              <dt>Costo de fábrica</dt>
              <dd>Lo que cobra la fábrica, sin IVA y sin ganancia. Es lo que se escribe al crear un producto.</dd>
            </div>
            <div>
              <dt>Precio de venta</dt>
              <dd>Lo que paga el cliente sin IVA: costo de fábrica más la ganancia de su categoría.</dd>
            </div>
            <div>
              <dt>Producto especial</dt>
              <dd>Algo que no está en el catálogo, cotizado solo en esta cotización con el precio que escribes.</dd>
            </div>
            <div>
              <dt>Otro cargo (ítem libre)</dt>
              <dd>Lo que no es carpintería: instalación, flete local, un servicio. No va a fábrica.</dd>
            </div>
            <div>
              <dt>Hoja / vano</dt>
              <dd>Hoja es la puerta misma; vano, el hueco del muro donde va instalada.</dd>
            </div>
            <div>
              <dt>Sección (escuadría)</dt>
              <dd>Grosor por ancho de un marco o moldura, por ejemplo 2 × 4 pulgadas.</dd>
            </div>
            <div>
              <dt>Nota de pedido</dt>
              <dd>El documento que va a cada fábrica con lo que tiene que hacer, a precio de fábrica.</dd>
            </div>
          </dl>
        </section>

        <section className="ayuda-seccion" aria-labelledby="ayuda-deshacer">
          <h2 id="ayuda-deshacer">Cómo deshacer</h2>
          <ul className="ayuda-lista">
            <li>
              <strong>Un cambio en la cotización:</strong> «Deshacer» en el detalle de la cotización (o Ctrl/⌘ + Z)
              revierte los últimos cambios mientras sigas en esa cotización: productos, datos del cliente, descuento,
              flete, ganancia y observaciones. El despacho se corrige escribiéndolo de nuevo.
            </li>
            <li>
              <strong>Un borrador eliminado:</strong> en <Link href="/historial">Historial</Link>, filtro «Papelera»,
              pulsa «Restaurar». Los borradores eliminados se guardan {DIAS_PAPELERA} días en la papelera; después se
              borran para siempre y ya no se pueden restaurar.
            </li>
            <li>
              <strong>Una aprobación registrada por error:</strong> «Deshacer aprobación» en el seguimiento, mientras
              no haya pagos, nota de pedido ni factura.
            </li>
            <li>
              <strong>Un paso de la operación marcado por error:</strong> «Volver al paso anterior», bajo «Siguiente
              acción». Te pide anotar el motivo. En fábrica deshace el último inicio o término registrado, en la
              fábrica donde se marcó.
            </li>
            <li>
              <strong>Un número de cotización o de nota de pedido equivocado:</strong> «Cambiar N°» junto a su PDF
              (solo cuentas administradoras), o pídeselo al asistente («la nota de Santiago debe ser la 61»). El
              número debe estar libre; el PDF se vuelve a generar con el número nuevo y el cambio queda en la
              actividad.
            </li>
            <li>
              <strong>Un pago mal anotado:</strong> «Anular» junto al pago, hasta que el pedido quede listo para
              despacho.
            </li>
            <li>
              <strong>Una factura marcada por error:</strong> «Volver a pendiente».
            </li>
            <li>
              <strong>Una cotización que ya no va:</strong> «Más acciones» → «Anular». Esto no se deshace.
            </li>
          </ul>
        </section>

        <section className="ayuda-seccion" aria-labelledby="ayuda-contacto">
          <h2 id="ayuda-contacto">A quién pedir ayuda</h2>
          <ul className="ayuda-lista">
            <li>
              Si algo no funciona, un mensaje no se entiende o un precio no calza, no lo fuerces: anota el N° de la
              cotización y lo que estabas haciendo, y avísale a quien administra el cotizador en Neltume.
            </li>
            <li>
              Si un PDF no abre, una cuenta administradora puede regenerarlo con los mismos datos con que se emitió.
            </li>
            <li>
              ¿Olvidaste tu contraseña? Otra cuenta administradora la restablece en Ajustes → Usuarios. Para
              cambiarla tú: <Link href="/ajustes">Ajustes → Mi cuenta</Link>.
            </li>
            <li>
              Lo que está en «Avanzado» dentro de Ajustes (asistente, IVA, ganancia por categoría) cambia el
              cotizador para todas las cuentas: no lo toques sin consultarlo.
            </li>
          </ul>
        </section>
      </main>
      <footer className="site-footer">
        <span>
          NELTUME <span className="muted">/ Hecho en madera.</span>
        </span>
        <span>Asistente de cotizaciones · Uso interno</span>
      </footer>
    </div>
  );
}
