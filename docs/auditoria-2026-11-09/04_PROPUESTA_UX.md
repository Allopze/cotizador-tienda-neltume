# 04 · Propuesta de UX

**Para quién:** una vendedora que atiende clientes toda la jornada, sin formación técnica. Hoy necesita llamar a Alejandro para cosas simples.

**Principio:** la aplicación se adapta a su forma de trabajar. Las propuestas priorizan la usabilidad que se puede comprobar, no los cambios visuales.

**Base:** `anexos/A-ux.md` (28 hallazgos, de lectura del código y las capturas), `anexos/A-qa.md` (70 capturas recientes a 1440, 768 y 390 px, y recorridos con Playwright) y `anexos/A-catalogo.md`. Los hallazgos se citan por su id consolidado `N-xx` (ver `01`).

---

## 1. El diagnóstico en una frase

**El chat es la vía rápida para *armar* la cotización y el editor es la vía segura para *corregirla*, pero ninguno de los dos lo dice, y a cada uno le faltan justo las operaciones que la vendedora usa en un pedido de obra:** repetir líneas, duplicar y cambiar, cotizar algo especial y deshacer.

El catálogo, por su parte, le muestra a una persona filas de una base de datos en lugar de puertas.

---

## 2. Mapa de recorridos: hoy y propuesta

Los pasos cuentan acciones mínimas (clic, Enter o elección), sin contar lo que se escribe. Fuente: lectura del código citado y recorridos con Playwright.

| # | Tarea | Hoy | Dónde se traba | Propuesta | Cambio que lo logra |
|---|---|---|---|---|---|
| T1 | Primera cotización por chat (1 puerta + PDF) | 5 | «Resolver medida» (hoja o vano) bloquea la emisión | 4 | Hoja o vano dentro del diálogo de emisión, o con valor por omisión (N-40) |
| T2 | Primera cotización a mano (1 puerta + cliente) | 13 | Cada campo del cliente es clic + escribir + «Guardar» | 9 | Ficha de cliente con autoguardado (N-38) |
| T3 | 4 productos distintos a mano | ≈24 | El diálogo se cierra después de cada producto | ≈14 | «Agregar y seguir» (N-18) |
| T4 | **4 puertas Ranco 0,85 / 1,00 / 0,85 / 1,00** | A mano ≈24; **por chat quedan 2** | La guarda antiduplicados del chat (N-03) | Chat: 1 mensaje; a mano ≈10 | Duplicados según su origen + «Duplicar línea» |
| T5 | **Duplicar una línea y cambiar la copia (Ranco → vidriada)** | ≈8, **y se pierde el precio** | No existe «duplicar línea» (N-05) y el especial no conserva el precio (N-19) | 3 | Menú de la fila → Duplicar → cambiar |
| T6 | Cambiar la medida de una puerta | 5 | Medida escondida en «Editar detalles», sin opciones válidas | 3 | Medida editable en la fila, con las medidas del catálogo (N-39) |
| T7 | **Cotizar algo fuera del catálogo** | ≈12, eligiendo entre 5 caminos | Cinco caminos con nombres parecidos; uno toca el catálogo (N-08) | ≈8 | «Producto especial (solo esta cotización)» con una pregunta |
| T8 | Modificar una cotización emitida | 4+ | Reglas distintas por chat y a mano (N-41) | 4 | Una sola regla |
| T9 | Modificar una aprobada con anticipo | No se puede | Solo «Deshacer aprobación» sin pagos | Igual + explicación | Diálogo con las salidas posibles |
| T10 | **Crear una puerta nueva en el catálogo** | ≈10 por fila × 252 filas | No hay ficha de modelo (N-06); la vista previa del precio es falsa (N-02) | Menos de 40 acciones, menos de 10 min | Asistente «Nuevo modelo» con «Partir de…» (05) |
| T11 | Encontrar un producto en el catálogo y cotizarlo | Callejón sin salida | Consultar no tiene «Cotizar este» (N-42); la búsqueda no entiende «willow 82» (N-07) | 2 | Buscador único + «Cotizar este» |
| T12 | Recuperarse de un descuento o dato del cliente mal puesto | Volver a escribirlo | Deshacer solo cubre los productos (N-16) | 1 (Ctrl+Z) | Deshacer completo |
| T13 | El asistente no entiende «willow» | Llamar a Alejandro | Los alias están en una sección aparte (N-46) | 2 | «Es Huilo Huilo» + «Recordar» en el pendiente |

## 3. «¿Por qué necesitaría ayuda de Alejandro?»

| Tarea | ¿Puede sola hoy? | Qué la frena | Arreglo |
|---|---|---|---|
| Crear una puerta | **No, en la práctica** | 252 formularios; precio de venta falso en la vista previa; «familia» y «tipo» sin explicar | 05 · N-02, N-06 |
| Entender una familia | **No** | No hay definición en ningún lugar; «familia», «tipo de producto» y «tipo» se mezclan | Glosario (05 §3) · N-11 |
| Encontrar un producto | A medias | «ranko», «willow» o «0,82» dan 0; solo se ven 24 resultados | Buscador único · N-07 |
| Cambiar medidas | Sí | Está escondido y no se ofrecen las medidas válidas | N-39 |
| Cotizar algo especial | Sí, con dudas | Cinco caminos | N-08 |
| Duplicar una línea | **No** | No existe | N-05 |
| Agregar productos repetidos | A mano sí, lento; **por chat no** | La guarda del chat | N-03, N-18 |
| Modificar una cotización | Sí | Reglas distintas por chat y a mano | N-41 |
| Modificar una aprobada con anticipo | **No** | No hay camino | N-41 |
| Recuperarse de un error | A medias | Deshacer limitado; 25 mensajes mandan a «quien administra» | N-16, N-43 |
| Usar la IA | A medias | No puede repetir líneas ni responder con cifras; muestra mensajes internos; bloquea la pantalla mientras piensa | N-03, N-04, N-10, N-14 |

## 4. Fricciones principales (las cinco que más afectan a la clienta)

1. **No se pueden repetir ni duplicar líneas por chat, y a mano no existe «Duplicar línea»** (N-03, N-05, N-19). Es la operación más común de un pedido de obra.
2. **El catálogo no se entiende ni se puede ampliar** (N-06, N-11, N-20). No hay ficha de puerta, «familia» no se explica y crear un modelo significa repetir un formulario cientos de veces.
3. **Cotizar algo especial tiene cinco caminos** (N-08). Uno de ellos cambia el catálogo de todas, y los campos «precio sin IVA» significan costo en un lugar y venta en otro.
4. **El asistente responde con mensajes internos o bloquea respuestas útiles** (N-10, N-04). Además, deja la pantalla bloqueada mientras responde (N-14).
5. **La búsqueda manual no entiende como habla el cliente** (N-07). Por eso la vendedora termina creando un producto especial o uno nuevo que no hacía falta.

---

## 5. Flujos propuestos

### 5.1 Duplicar para modificar (Problema B)

```
Fila «Ranco Pino Oregón 0,85 × 2,20 · $185.000»  [⋯]
  └─ Duplicar línea
       → aparece debajo «Ranco Pino Oregón 0,85 × 2,20 · $185.000 (copia)», con el detalle abierto
       → la vendedora cambia la descripción a «Ranco vidriada» y el precio a $230.000
       → «Precio propio de esta cotización: $230.000 (catálogo $185.000)». La línea no queda pendiente.
  El original no cambia. Ctrl+Z deshace la copia.
```

Reglas: la copia lleva todo (precio especial, descuento, observaciones, fotos, fábrica, hoja o vano) y un id nuevo. Cambiar el nombre de una línea con precio **no** descarta ese precio: lo convierte en «precio propio» y lo avisa.

### 5.2 Productos repetidos por chat (Problema A)

«Necesito 4 Ranco pino oregón: 0,85, 1,00, 0,85 y 1,00, todas de 2,20» → 4 líneas. La respuesta confirma: «Agregué 4 puertas Ranco Pino Oregón (2 de 0,85 y 2 de 1,00 × 2,20)». Si la IA reenvía por error un ítem de un turno anterior, el servidor lo detecta por la frase de origen y lo ignora **sin decir nada**.

### 5.3 Cotizar algo que no existe (Problema C)

```
Agregar producto → (búsqueda sin resultado o botón visible) «Producto especial — solo esta cotización»
  ¿Lo fabrica Neltume?   (•) Sí, va a la fábrica     ( ) No, es otro cargo (instalación, flete local…)
  Nombre: [Ranco 45 mm]   Tipo: [Puerta]   Medida: [0,85] × [2,20]
  Precio de venta (sin IVA): [$ ___ ]   Costo de fábrica (opcional): [$ ___ ]
  Foto o referencia (opcional)
  [Agregar a la cotización]
  ¿Se va a vender seguido?  → «Pedir que se agregue al catálogo» (enlace aparte; no cambia nada ahora)
```

### 5.4 Crear una puerta nueva

Ver `05_REDISENO_FAMILIAS_CATALOGO.md` §7: «Nuevo modelo» → «Partir de Ranco» → tabla de costos por madera, con el precio de venta visible → Publicar.

---

## 6. Mejoras por pantalla

| Pantalla | Mejoras, por orden de valor |
|---|---|
| **Cotizar · vacío** | Dos entradas del mismo peso: «Contar el pedido» (chat) y «Elegir del catálogo»; chips de ejemplo que se inserten tal como se ven; recordar si la vendedora trabaja con el asistente contraído |
| **Cotizar · borrador** | Duplicar línea (menú de la fila); Agregar y seguir; medida editable en la fila con opciones; Modelo y Madera con sugerencias en vez de texto libre; autoguardado único; costo y ganancia ocultos por omisión (modo cliente, si Neltume lo decide); hoja o vano una sola vez, en la emisión; el aviso «Producto agregado» como franja, sin tapar la tabla (N-29) |
| **Cotizar · emitida o aprobada** | Una sola regla de revisión (chat = manual); una línea de tiempo en lugar de tres estados paralelos; «El cliente quiere cambiar algo» explica las salidas; montos sugeridos en «Monto recibido» |
| **Chat** | Respuestas solo con lo que pasó («Agregué…», «Cambié…», «No pude… porque…»), sin mensajes internos; el editor sigue usable mientras responde, con un indicador de segundos y «Cancelar»; «No entendí» con una salida manual (botón directo a la acción equivalente); «Recordar este nombre» en los pendientes |
| **Agregar producto (diálogo)** | Buscador único con resultados agrupados por modelo; si no hay resultados, el producto especial prellenado; rango de medidas en cada resultado; Escape cierra |
| **Catálogo** | Ver 05: Buscar · Modelos (fichas) · Importar · Otros nombres · Papelera; «Cotizar este» en cada resultado |
| **Historial** | Medidas en el resumen de las líneas («2 × Ranco 0,85 × 2,20»); «Descargar planilla (Excel)» en lugar de «Exportar CSV» |
| **Clientes** | «Nueva cotización para este cliente» |
| **Ayuda** | Glosario; «Catálogo en 5 minutos»; cómo cotizar especiales; qué puede y qué no puede hacer el asistente; «qué hacer si…» con los errores frecuentes |
| **Accesibilidad (transversal)** | Bordes de los campos con contraste de 3:1 o más (hoy 1,5:1, N-44); foco tras hoja o vano (N-30) |

## 7. Simplificaciones de fondo, no solo cosméticas

1. **Una sola forma de cotizar algo especial**, en lugar de cinco (N-08).
2. **Un solo buscador**, el del asistente, para todas las pantallas (N-07).
3. **Una sola regla de guardado** (autoguardado) y **un solo Deshacer** que cubra todo (N-38, N-16).
4. **La IA no puede hacer menos que la interfaz** en lo cotidiano: repetir, duplicar, buscar, explicar (N-25). Cuando no puede, ofrece el botón de la acción manual.
5. **La estructura interna del catálogo se oculta** detrás de fichas de modelo (05).
6. **Las palabras se usan con un solo sentido** (05 §3).

## 8. Propuestas para la IA en la interfaz

| # | Propuesta | Resuelve |
|---|---|---|
| IA-1 | **Responder solo con resultados y problemas accionables.** Las correcciones internas pasan a diagnóstico (categoría `interno`); se mantienen los avisos útiles según la tabla del anexo IA | N-10 |
| IA-2 | **Duplicar y repetir como operación explícita** (`duplicar: [{indice, veces, cambios}]`), con confirmación «Agregué 2 copias de la Ranco 0,85» | N-03, N-05 |
| IA-3 | **Permitir cifras de medidas y cantidades en las respuestas**; bloquear solo los montos que no estén en la cotización | N-04 |
| IA-4 | **Herramienta `buscar_catalogo`** con el buscador único, para «¿qué maderas tiene el Molco?» o «busca una de un metro» | N-25 |
| IA-5 | **Eco antes de aplicar cambios grandes** (3 ítems o más, o cambio de cliente): «Voy a agregar: … [Aplicar] [Corregir]» | Confianza |
| IA-6 | **Aplicar lo válido de un turno** y explicar lo que no se pudo aplicar | N-22 |
| IA-7 | **Salida manual en cada fallo**: «No pude duplicar la línea 3 → [Duplicar línea 3]» | N-43 |
| IA-8 | **Panel de cambios del asistente** con «Deshacer este cambio» | Confianza, N-16 |
| IA-9 | **El editor no se bloquea mientras la IA responde** | N-14 |
| IA-10 | **Explicar el catálogo**: «¿En qué familia va esta puerta?» se responde con el glosario y el enlace a la ficha | N-11 |

**Lo que no debe resolverse con el prompt:** el bloqueo de duplicados, los `null` ambiguos y el detector de montos son reglas del servidor. Cambiar el prompt no los arregla (anexo IA).

---

## 9. Indicadores para medir la usabilidad

| Indicador | Cómo se mide | Meta inicial |
|---|---|---|
| Tiempo a la primera cotización emitida (1 a 3 líneas) | Actividad de la cotización: creación → emisión | Mediana < 3 min |
| Tasa de éxito sin ayuda | Prueba moderada con 3 a 5 vendedoras y las 13 tareas de §2 | ≥ 85 % |
| Llamadas a Alejandro por semana, por motivo | Planilla simple durante 4 semanas antes y 4 después | −50 % |
| Pasos por tarea | E2E que cuenta las acciones por recorrido | Columna «Propuesta» de §2 |
| Crear un modelo nuevo como Ranco | Prueba con usuaria | < 10 min y < 40 acciones |
| Líneas repetidas o duplicadas sin error | Registro del turno del chat (herramienta y avisos) + `duplicar_item` | 0 avisos «No dupliqué» |
| Mensajes de la IA no entendidos | Botón «No entendí» + edición manual inmediata del mismo ítem | < 10 % de los turnos |
| Avisos internos mostrados | Contador de la categoría `interno` que llega a la pantalla | 0 |
| Pendientes por cotización | `incompletos` en el primer mensaje y al emitir | Tendencia a la baja |
| Búsquedas sin resultados | Registro de consultas con 0 resultados | < 5 % |
| Productos especiales que luego se agregan al catálogo | Solicitudes «Pedir que se agregue» | Observacional |
| Uso de Deshacer | `restaurar_items` y deshacer completo por cotización | Observacional |
| Espera del asistente cancelada | Registro del turno (`ms`) | < 3 % |

## 10. Validación con usuarias

Antes de construir los cambios grandes (ficha de modelo, modo cliente), hacer una sesión de 45 minutos con 2 o 3 vendedoras, sin ayuda verbal, con las tareas T4, T5, T7, T10, T11 y T13, y los escenarios de 05 §16. Registrar literalmente las palabras que no se entienden. Repetir la sesión después de cada etapa.
