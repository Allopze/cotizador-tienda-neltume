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
              <strong>Genera la nota de pedido para fábrica.</strong> «Generar nota de pedido» le da su número y crea
              el PDF que va a fábrica.
            </li>
            <li>
              <strong>Producción.</strong> Pulsa «Iniciar producción» cuando el pedido entra a fábrica y «Marcar
              producción terminada» cuando fábrica lo termina.
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

        <section className="ayuda-seccion" aria-labelledby="ayuda-deshacer">
          <h2 id="ayuda-deshacer">Cómo deshacer</h2>
          <ul className="ayuda-lista">
            <li>
              <strong>Un cambio en los productos:</strong> «Deshacer» en el detalle de la cotización (o Ctrl/⌘ + Z)
              revierte los últimos cambios mientras sigas en esa cotización. Los datos del cliente, el descuento o el
              despacho se corrigen escribiéndolos de nuevo.
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
              acción». Te pide anotar el motivo.
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
