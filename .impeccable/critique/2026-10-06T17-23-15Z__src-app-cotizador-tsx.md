---
target: cotizador
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/allopze/dev/Neltume/tienda_puertas/Cotizador/src/app/cotizador.tsx"
target_fingerprint: "sha256:5eecf8d142c3980c130c0f4a8f7a3f18c7294017b160f85c2eaceb6aa313cd29"
target_path: /Users/allopze/dev/Neltume/tienda_puertas/Cotizador/src/app/cotizador.tsx
timestamp: 2026-10-06T17-23-15Z
slug: src-app-cotizador-tsx
---
# Crítica UI/UX — Cotizador Neltume

## Salud de diseño

| # | Heurística de Nielsen | Nota | Evidencia principal |
|---|---|---:|---|
| 1 | Visibilidad del estado | 3/4 | Estados, avisos y total parcial visibles; el estado operativo aprobado pierde protagonismo. |
| 2 | Lenguaje del usuario | 3/4 | Pedido, madera, medidas y CLP son concretos; «hoja o vano» exige contexto. |
| 3 | Control y libertad | 3/4 | Borrador, deshacer, rehacer y revisión permiten corregir. |
| 4 | Consistencia | 3/4 | Sistema visual y acciones coherentes; móvil cambia el contexto entre pestañas. |
| 5 | Prevención de errores | 2/4 | Se permite emitir con tipo de medida sin especificar. |
| 6 | Reconocimiento | 2/4 | En móvil se ocultan el producto y la causa del botón deshabilitado. |
| 7 | Flexibilidad y eficiencia | 3/4 | Chat, catálogo y atajos sirven a distintos modos de trabajo. |
| 8 | Diseño y jerarquía | 2/4 | Acciones secundarias desplazan el detalle esencial en móvil. |
| 9 | Recuperación de errores | 3/4 | Se conserva el trabajo y se explican varios bloqueos. |
| 10 | Ayuda | 2/4 | Hay ayuda contextual, pero la explicación de emisión desaparece en móvil. |
| **Total** | | **26/40** | **Aceptable: mejoras importantes antes de darlo por cerrado.** |

## Especificidad y evaluación técnica

La interfaz está hecha para Neltume: une conversación, líneas de puertas editables, especificaciones, CLP y emisión de PDF en una composición coherente. El mayor problema es la jerarquía según el estado de la cotización, especialmente en móvil y después de aprobar.

El detector de código devolvió 0 hallazgos en src/app/cotizador.tsx y src/app. En páginas autenticadas de Playwright, el detector de navegador señaló una línea explicativa larga (aprox. 93 caracteres), uso mayoritario de Arial (84 %) y las etiquetas «01 / CONVERSACIÓN» y «02 / COTIZACIÓN». Las etiquetas numeradas describen dos pasos reales y parecen falso positivo; Arial se combina intencionalmente con títulos serif. La longitud de línea es una observación menor. No hay superposición visible para el usuario: solo se inyectó en sesiones temporales sin pestaña [Human].

## Lo que funciona

- El diseño de dos paneles deja comparar la solicitud con el precio y las especificaciones sin perder el contexto.
- «Total parcial» y los productos pendientes evitan presentar cifras incompletas como definitivas; la emisión se bloquea si faltan ítems.
- Borrador conservado, deshacer/rehacer, mensajes de estado y confirmaciones apoyan la corrección.

## Problemas prioritarios

1. **P1 · Móvil: el producto queda fuera de la primera vista.** En 390 × 844, el primer producto empieza cerca de 580 px, la barra fija cerca de 719 px y un aviso temporal tapa parte del detalle. La vista destaca navegación y cuatro controles de edición antes de mostrar qué se está cotizando. **Mejora:** agrupar deshacer/rehacer/flete, compactar el encabezado y garantizar que producto, medida y pendientes queden visibles sobre la barra fija. **Comando:** impeccable adapt. Evidencia: test-results/cotizador-mobile.png, src/app/cotizador-pantalla.css:503, src/app/cotizacion-panel.tsx:461.
2. **P1 · Ambigüedad de medida al emitir.** «Medida de hoja o vano por confirmar» aparece como texto pequeño, mientras la habilitación de «Emitir y generar PDF» depende de líneas e ítems incompletos, no de ese tipo de medida. El PDF tampoco identifica la ambigüedad cuando el tipo no está especificado. **Mejora:** definir si la confirmación es obligatoria; si lo es, bloquear con acceso al campo. Si se permite emitir, pedir aceptación explícita y mostrar la salvedad en la revisión y el PDF. **Comando:** impeccable harden. Evidencia: src/app/cotizacion-panel.tsx:364, src/app/cotizacion-panel.tsx:620, src/servidor/pdf.ts:187.
3. **P2 · Tras aprobar, el chat compite con el seguimiento.** El compositor queda inactivo, pero ocupa espacio y el siguiente paso operativo aparece más abajo. **Mejora:** presentar estado, pago/producción y siguiente acción arriba; dejar la conversación contraída y accesible. **Comando:** impeccable layout. Evidencia: test-results/cotizacion-aprobada.png, src/app/cotizador.tsx:1383, src/app/cotizacion-panel.tsx:1350.
4. **P2 · Móvil oculta por qué no se puede emitir.** La ayuda ligada al botón deshabilitado se elimina con CSS. **Mejora:** mostrar una razón breve junto a la acción y un enlace al primer dato pendiente. **Comando:** impeccable clarify. Evidencia: src/app/cotizador-pantalla.css:574, src/app/cotizacion-panel.tsx:1315.
5. **P2 · Las líneas mezclan decisión y trazabilidad.** Código, referencia, medida solicitada, fuente, coincidencia y salvedades se acumulan antes de cantidad y precio. **Mejora:** dar prioridad a producto, madera, medida, cantidad y precio; revelar origen y referencia bajo demanda. **Comando:** impeccable distill. Evidencia: src/app/cotizacion-panel.tsx:585.

## Carga cognitiva y recorrido

En escritorio, la carga es moderada; en móvil es alta. Fallan la jerarquía del dato esencial, la agrupación de acciones y la continuidad de contexto entre «Pedido» y «Cotización». El encabezado reúne más de cuatro opciones visibles: deshacer, rehacer, agregar producto, agregar flete y, en paralelo, navegación y emisión. El inicio transmite bien cómo pedir una puerta y el total parcial tranquiliza; el valle ocurre al revisar una medida ambigua o al llegar a una cotización aprobada sin ver primero qué sigue.

## Personas

- **Jordan, primera vez:** puede interpretar el botón activo «Emitir» como prueba de que la medida ya está lista, aunque la salvedad diga «hoja o vano por confirmar».
- **Casey, móvil:** en 390 × 844 debe desplazarse para ver el primer producto; aviso y barra fija reducen aún más la zona de lectura. Si el botón se deshabilita, pierde la explicación.
- **Sam, teclado/lector:** los controles tienen etiquetas y foco visible en código; la alternancia móvil oculta paneles completos. Conviene verificar anuncio de pestaña y destino de foco al pasar de pedido a cotización.

## Observaciones menores

- La línea explicativa del estado vacío es larga en escritorio; acortarla facilitaría el escaneo.
- El detector señaló las etiquetas numeradas y la proporción de Arial; no son por sí mismas defectos confirmados.
- La inspección autenticada en 1440 × 900 y 390 × 844 no mostró desbordamiento horizontal ni errores de página.

## Preguntas de diseño

- ¿Qué evidencia debe ver y confirmar una persona antes de emitir una puerta con medidas?
- ¿La aprobación debería convertir la pantalla en un espacio de seguimiento, con el chat como historial?
- ¿Qué datos de procedencia deben estar siempre visibles durante la revisión y cuáles pueden abrirse a demanda?
