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
| Una puerta un poco más chica que la menor del catálogo se cotiza con esa (la hoja se rebaja). | hasta 5 cm | 0,69 m usa la de 0,70 m; 0,64 m no tiene precio. | | `REBAJE_PUERTA`, `src/catalogo/resolver.ts` |
| Un marco más corto que el set menor se cotiza con el set menor, porque se corta en obra. | — | Un marco para puerta de 2,27 m usa el set de 2,5 m. | | `porEscalon` |
| Marcos y piezas T de menos de 3 m van como kit; desde 3 m, como pieza lineal. Nunca se cambia uno por otro. Los sets de marco Pino Finger son kit en cualquier largo. | 3 m | Marco 2x4 de 2,1 m → «PULG KIT»; de 3 m → «PULG X 3 MT». | | `LARGO_PIEZA`, `src/catalogo/escalones.ts` |
| Cada madera, y en los accesorios cada sección, tiene sus propias medidas. | — | El marco 2x5 en oregón no usa las medidas del marco finger 30x70. | | `porEscalon` |
| Un marco enchapado en Mara se cotiza con el set Pino Finger enchapado Mara si el modelo no tiene esa madera. | — | «Marco enchapado» → set PINO FINGER ENCHAPADO MARA. | | `conEquivalente`, `src/catalogo/resolver.ts` |
| En marcos y piezas T, un número solo es la escuadría 2xN. | — | «Marco de 6» o «de 6 pulgadas» es 2x6. | | `src/catalogo/resolver.ts` |
| Si dos productos del catálogo calzan igual de bien, se pregunta en vez de elegir. | — | — | | `src/catalogo/resolver.ts` |

## Unidades de medida

| Regla | Valor | Ejemplo | ¿Varía? | Dónde vive |
|---|---|---|---|---|
| Un número hasta 10 son metros; hasta 300, centímetros; hasta 3000, milímetros. | — | «80» = 0,80 m; «2,10» = 2,10 m; «820» = 0,82 m. | | `metros`, `src/catalogo/resolver.ts` |
| Una medida fuera de 0,3 a 3 m no es creíble: se pregunta. | 0,3–3 m | «Puerta de 5 m». | | `RANGO_METROS`, `src/catalogo/resolver.ts` |

## Precios, márgenes y montos

| Regla | Valor | Ejemplo | ¿Varía? | Dónde vive |
|---|---|---|---|---|
| El margen de una línea, el margen especial de la cotización y un precio escrito a mano deben quedar entre estos límites sobre el costo de fábrica. Fuera de ellos no se aplican y se avisa. | −50 % a 500 % | Costo $100.000: el precio va de $50.000 a $600.000. | | `MARGEN_MIN`, `MARGEN_MAX`, `src/negocio/limites.ts` |
| El margen por categoría (Ajustes) va de 0 % al máximo anterior. | 0 % a 500 % | — | | `MARGEN_MAX`, `src/negocio/limites.ts` |
| El ajuste general sobre el precio neto debe quedar entre estos límites. | −50 % a 100 % | — | | `AJUSTE_MIN`, `AJUSTE_MAX`, `src/negocio/limites.ts` |
| Un monto en pesos bajo $1.000 casi siempre tiene ceros de menos: se aplica, pero se avisa. | $1.000 | «Flete $350» → aviso «revisa si le faltan ceros». | | `MONTO_BAJO`, `src/asistente/montos.ts` |
| En pesos no hay centavos: «$350.00» se lee como $350.000. | — | — | | `src/asistente/montos.ts` |
| Un precio, un flete o un costo no pueden pasar de este monto. | $100.000.000 | — | | `src/negocio/precios.ts` |
| La cantidad de un producto es un entero entre 1 y 10.000. Una cotización tiene como máximo 100 productos. | 1–10.000; 100 | — | | `src/negocio/precios.ts`, `src/servidor/servicio.ts` |

## Aprobación y pagos

| Regla | Valor | Ejemplo | ¿Varía? | Dónde vive |
|---|---|---|---|---|
| La nota de pedido y la producción se habilitan al registrar al menos esta parte del total, redondeada hacia arriba. | 50 % | Total $1.001 → anticipo mínimo $501. | | `ANTICIPO_MINIMO`, `src/negocio/limites.ts` |

## Ya configurables en Ajustes

Estas reglas ya se cambian desde **Ajustes → Configuración del negocio** y cada cotización conserva las que tenía al crearse:

- Margen por categoría de producto.
- IVA (19 % por omisión).
- Vigencia de la cotización (10 días hábiles por omisión).
- Descuento máximo (50 % por omisión) y tramos de descuento por cantidad de puertas.
