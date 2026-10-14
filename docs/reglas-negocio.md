# Reglas de cotización

Estas son las reglas que el cotizador aplica hoy por su cuenta. Algunas vienen de la planilla Excel y otras se decidieron caso a caso durante el desarrollo. **Pedimos a Neltume que confirme cada una o la corrija**, y que marque en la columna «¿Varía?» las que cambian con el tiempo o según el cliente: solo esas pasarían a poder ajustarse desde Ajustes.

La columna «Dónde vive» es para quien mantiene el código.

## Medidas y escalones del catálogo

| Regla | Valor | Ejemplo | ¿Varía? | Dónde vive |
|---|---|---|---|---|
| Una medida exacta del catálogo acepta una pequeña diferencia. | ±5 mm | Un largo de 2,10 m acepta de 2,095 a 2,105 m. | | `HOLGURA`, `src/catalogo/escalones.ts` |
| Una medida dentro de un rango del catálogo usa ese rango. | — | Una Molco de 0,82 m usa la de 0,80 a 0,85 m. | | `porEscalon`, `src/catalogo/resolver.ts` |
| Una medida entre dos del catálogo se cotiza con la siguiente hacia arriba; nunca se baja. | — | 0,87 m, si el catálogo tiene 0,85 y 0,90, se cotiza como 0,90. | | `porEscalon` |
| Sobre la medida más grande del catálogo no hay precio: no se calcula uno nuevo. Queda pendiente y se puede cotizar como pedido especial. | — | Una puerta de 1,90 m de ancho si la mayor es 1,20 m. | | `porEscalon` |
| Una puerta un poco más chica que la menor del catálogo se cotiza con esa (la hoja se rebaja). Desde 5 cm menos ya no: se pregunta. | menos de 5 cm | 0,69 m usa la de 0,70 m; 0,65 m ya no tiene precio. | | `REBAJE_PUERTA`, `porEscalon`, `src/catalogo/resolver.ts` |
| Un marco más corto que el set menor se cotiza con el set menor, porque se corta en obra. | — | Un marco para puerta de 2,27 m usa el set de 2,5 m. | | `porEscalon` |
| Marcos y piezas T de menos de 3 m van como kit; desde 3 m, como pieza lineal. Nunca se cambia uno por otro. Los sets de marco Pino Finger son kit en cualquier largo. | 3 m | Marco 2x4 de 2,1 m → «PULG KIT»; de 3 m → «PULG X 3 MT». | | `LARGO_PIEZA`, `src/catalogo/escalones.ts` |
| Cada madera, y en los accesorios cada sección, tiene sus propias medidas. | — | El marco 2x5 en oregón no usa las medidas del marco finger 30x70. | | `porEscalon` |
| Un marco enchapado en Mara se cotiza con el set Pino Finger enchapado Mara si el modelo no tiene esa madera. | — | «Marco enchapado» → set PINO FINGER ENCHAPADO MARA. | | `conEquivalente`, `src/catalogo/resolver.ts` |
| En marcos y piezas T, un número solo es la escuadría 2xN. | — | «Marco de 6» o «de 6 pulgadas» es 2x6. | | `src/catalogo/resolver.ts` |
| Si dos productos del catálogo calzan igual de bien, se pregunta en vez de elegir. | — | — | | `src/catalogo/resolver.ts` |

## Unidades de medida

| Regla | Valor | Ejemplo | ¿Varía? | Dónde vive |
|---|---|---|---|---|
| Un número hasta 10 son metros; hasta 300, centímetros; hasta 3000, milímetros. En el largo de marcos, molduras y piezas T, hasta 600 cm y 6000 mm. | — | «80» = 0,80 m; «2,10» = 2,10 m; «820» = 0,82 m; moldura de «360» = 3,60 m. | | `metros`, `src/catalogo/resolver.ts` |
| Una medida fuera de este rango no es creíble: se pregunta. El ancho siempre usa el rango de las puertas. | Puertas 0,3–3 m; largo de marcos, molduras y piezas T 0,3–6 m | «Puerta de 5 m»; «moldura de 7 m». | | `rangoMedidas`, `src/negocio/limites.ts`; `metros`, `src/catalogo/resolver.ts` |

## Precios, márgenes y montos

En la pantalla, el margen se llama «ganancia» (por ejemplo, «Ganancia de la línea»).

| Regla | Valor | Ejemplo | ¿Varía? | Dónde vive |
|---|---|---|---|---|
| El margen de una línea, el margen especial de la cotización y un precio escrito a mano deben quedar entre estos límites sobre el costo de fábrica. Un margen fuera de ellos no se guarda y se avisa. Un precio escrito en el detalle de la cotización se rechaza mostrando el rango en pesos. Si un precio queda fuera por otra vía (una reimportación que cambió el costo, el chat o «Deshacer»), el producto queda pendiente con esa pregunta y no suma al total hasta corregirlo o quitarlo. | −50 % a 500 % | Costo $100.000: el precio va de $50.000 a $600.000. | | `MARGEN_MIN`, `MARGEN_MAX`, `src/negocio/limites.ts`; `src/servidor/servicio.ts`; `src/servidor/items-vigentes.ts` |
| El margen por categoría (Ajustes) va de 0 % al máximo anterior. | 0 % a 500 % | — | | `MARGEN_MAX`, `src/negocio/limites.ts` |
| Los marcos de madera sólida en Mara o Raulí no tienen margen propio: usan el de marcos, molduras y piezas T de madera sólida. Oregón y Lenga sí tienen el suyo. **Por confirmar con Neltume.** | Mara y Raulí 25 %; Oregón 85 %; Lenga 55 % | Un marco 2x4 de raulí se cotiza al costo + 25 %. | | `categoriaMargen`, `MARGENES_INICIALES`, `src/negocio/precios.ts` |
| El ajuste general sobre el precio neto debe quedar entre estos límites. | −50 % a 100 % | — | | `AJUSTE_MIN`, `AJUSTE_MAX`, `src/negocio/limites.ts` |
| Un monto en pesos bajo $1.000 casi siempre tiene ceros de menos: se aplica, pero se avisa. | $1.000 | «Flete $350» → aviso «revisa si le faltan ceros». | | `MONTO_BAJO`, `src/asistente/montos.ts` |
| En pesos no hay centavos: «$350.00» se lee como $350.000. | — | — | | `src/asistente/montos.ts` |
| Un precio, un flete o un costo no pueden pasar de este monto. | $100.000.000 | — | | `src/negocio/precios.ts` |
| La cantidad de un producto es un entero entre 1 y 10.000. Una cotización tiene como máximo 100 productos. | 1–10.000; 100 | — | | `src/negocio/precios.ts`, `src/servidor/servicio.ts` |
| Un producto puede llevar un descuento especial por unidad: un porcentaje (con hasta dos decimales) o un monto fijo en pesos, nunca mayor que su precio. La cotización muestra el precio original tachado y el precio con descuento. A diferencia del descuento general, no tiene un máximo bajo el 100 %. | más de 0 % y hasta 100 % | 15 % sobre $155.000 → $131.750 c/u. | | `descuentoItemValido`, `src/negocio/precios.ts` |
| El descuento general (manual o por cantidad de puertas) se calcula sobre el subtotal ya rebajado por los descuentos especiales: nada se descuenta dos veces. La nota de pedido va a precio de fábrica, sin descuentos. | — | — | | `cotizar`, `src/negocio/precios.ts` |
| El descuento especial también se pide en el chat. Solo se aplica si el porcentaje o el monto está escrito en el mensaje; si no, se avisa. Un monto se toma por unidad y neto. | — | «A las Molco hazles un 15 % de descuento», «a la Huilo rebájale $20.000». | | `descuentosEscritos`, `src/servidor/servicio.ts` |
| El flete lleva IVA y no recibe descuento: el descuento se calcula solo sobre los productos y el IVA, sobre productos con descuento más flete. | — | Productos $1.000.000 con 10 % y flete $50.000: neto $950.000, IVA $180.500. | | `cotizar`, `src/negocio/precios.ts` |
| Starken informa sus tarifas con IVA. El valor de despacho que queda en la cotización es ese total dividido por 1,19, redondeado a pesos, siempre con el 19 % de Starken aunque el IVA de Ajustes sea otro. | IVA fijo 19 % | Tarifa $101.150 → despacho $85.000. | | `netoDesdeIva`, `IVA_STARKEN`, `src/negocio/starken.ts` |

## Aprobación y pagos

| Regla | Valor | Ejemplo | ¿Varía? | Dónde vive |
|---|---|---|---|---|
| La cotización vence tantos días hábiles después de emitirse (sin fines de semana ni feriados de Chile), y el día de vencimiento todavía vale. Una vencida se puede aprobar, pero se pide confirmar. | 10 días hábiles | Si vence el día 24, ese día todavía vale; desde el 25 está vencida. | | `calcularVence`, `estaVencida`, `src/negocio/vigencia.ts` |
| El número de cotización lo asigna el cotizador. Solo una cuenta administradora puede elegirlo a mano al emitir: debe ser mayor que el último usado o reservado y no saltarse más de 1.000. Los números saltados no se vuelven a usar. | hasta 1.000 sobre el último | Último 412: se puede emitir como 450, no como 1.500. | | `reservarCotizacion`, `src/servidor/almacen.ts`; `src/app/api/accion/route.ts` |
| La nota de pedido y la producción se habilitan al registrar al menos esta parte del total, redondeada hacia arriba. | 50 % | Total $1.001 → anticipo mínimo $501. | | `ANTICIPO_MINIMO`, `src/negocio/limites.ts` |
| Una cotización aprobada no se puede anular si la operación ya está despachada o completada, o si está marcada como facturada (primero hay que volver la facturación a pendiente). | — | — | | `anular`, `src/servidor/servicio.ts` |

## Ya configurables en Ajustes

Estas reglas ya se cambian desde **Ajustes** y cada cotización conserva las que tenía al crearse:

- Ganancia (margen) por categoría de producto e IVA (19 % por omisión): **Ajustes → Precios y descuentos**, dentro de la sección plegada «Avanzado».
- Descuento máximo (50 % por omisión) y tramos de descuento por cantidad de puertas: **Ajustes → Precios y descuentos**.
- Vigencia de la cotización (10 días hábiles por omisión): **Ajustes → Cotizaciones**.
