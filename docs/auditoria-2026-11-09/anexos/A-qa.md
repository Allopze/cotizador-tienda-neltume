> **Anexo de la auditoría del 9–10 nov 2026.** Informe especializado tal como se entregó. Donde `../01_AUDITORIA_COMPLETA.md` §5.2 lo corrige (por ejemplo, los permisos de la vendedora: en producción todas las cuentas son administradoras), manda el informe consolidado. Las rutas `scratchpad/…` remiten a la evidencia de la sesión de auditoría, que no se guarda en el repositorio.

# Informe QA (Playwright) y UX en vivo — Cotizador Neltume

Fecha: 9–10 nov 2026 · Rama `main` (a641645), árbol limpio · Auditoría no destructiva: no se cambió nada en el repo (tests/, src/, capturas/ intactos), no se tocó `data/cotizador.sqlite` ni `datos-privados/` (solo se leyó la planilla para sembrar las bases de prueba), sin commits ni deploy, sin IA real (asistente en `NELTUME_LLM=fijo`, Starken `fijo`, fábrica apagada).

Rutas: `QA = /private/tmp/claude-501/-Users-allopze-dev-Neltume-tienda-puertas-Cotizador/8966eded-8fcc-4676-8be7-0eb3db948605/scratchpad/qa`

- Specs nuevas: `QA/specs/*.spec.ts` (00 a 06) + `QA/specs/comun.ts`, config `QA/playwright.qa.config.ts`
- Capturas: `QA/capturas/*.png` · PDF emitido: `QA/capturas/f-Neltume_-_Cotizaci_n_N._323.pdf`
- Notas de cada recorrido: `QA/observaciones.log` · árboles de accesibilidad: `QA/aria-*.yml` · búsquedas por API: `QA/busquedas.txt`
- Logs: `QA/vitest.log`, `QA/e2e-paralelo.log`, `QA/e2e-serial.log`, `QA/a11y-*.log`, `QA/acep.log`, `QA/run0*.log`

Entorno de la parte 2: `next dev` propio en el puerto 3123, `NELTUME_DATA_DIR=QA/data` (base sembrada con `scripts/preparar-e2e.ts`), `NELTUME_DIST_DIR=.next-e2e/qa3123` (ignorado por git). Usuarias: `prueba@neltume.test` (vendedora) y `admin@neltume.test`.

---

## 1. Resultados de la suite existente

### 1.1 Unitarias (Vitest 5.0.2)
`npx vitest run` → **97 archivos, 1567 pruebas aprobadas, 0 fallidas, 0 omitidas**, 160,6 s (`QA/vitest.log`).

### 1.2 E2E paralela (`npm run test:e2e:paralelo`) — **bloqueada por el entorno**
Los tres grupos fallaron en 7 s antes de correr una sola prueba: `Error: http://127.0.0.1:3201 is already used` y `listen EADDRINUSE 127.0.0.1:3202/3203`. Los puertos 3200–3206 los ocupaba en ese momento la E2E de la **app de la fábrica** (`fabrica_puertas/crm_fabrica_puertas`, `next dev -p 3200`, más servidores en 3201–3206), lanzada por otro proceso. El script fija los puertos `3201 + i` sin opción para cambiarlos (`scripts/e2e-paralelo.mjs:47`). No es una falla de la app, pero sí una fragilidad de la infraestructura (ver H-11). No se mataron procesos ajenos.

### 1.3 E2E serie (`npm run test:e2e`, con `NELTUME_E2E_PORT=3141`)
Duración 420 s (7,0 min de Playwright). **89 aprobadas, 1 fallida, 15 no ejecutadas** (de 105).
- Fallida: `accesibilidad.e2e.ts:58 › pantallas de la vendedora a 1280 px` — `expect(getByRole('heading', { name: 'Cotizar', level: 1 })).toBeVisible()` superó 5000 ms en `tests/login-e2e.ts:26` (el login quedó en «Ingresando…»). Es la segunda prueba de la corrida: la primera compilación de `/` en `next dev`, con la máquina cargada (E2E de la fábrica y mi servidor 3123 corriendo).
- **Reproducción en bucle**: la misma spec sola, 3 corridas con servidor frío y base nueva cada vez → **3/3 aprobadas** (4 pruebas, 45,8 s / 46,7 s / 46,4 s; `QA/a11y-bucle.txt`). Conclusión: no se reproduce en aislamiento; es sensible al arranque en frío bajo carga (plazo de 5 s del `expect` en el login). La califico «dependiente de la carga» con evidencia de 0/3, no como intermitente sin más (H-12).
- No ejecutadas (15): los proyectos `aceptacion`, `webkit-iphone`, `webkit` y `primer-uso` dependen de `flujos` y Playwright los saltó por la falla anterior. Se ejecutaron aparte con `playwright.aceptacion.config.ts` (ver 1.4).

### 1.4 Proyectos dependientes, corrida aparte (`playwright.aceptacion.config.ts`, puerto 3142, base propia)
**14 aprobadas, 0 fallidas, 1 omitida a propósito** (46,2 s): aceptación de punta a punta (Mara por vano → PDF → aprobación → nota → producción → despacho), 8 de `movil.e2e.ts` en WebKit iPhone 13, 4 de `campos-numericos.e2e.ts` en WebKit escritorio y `primer-uso`. Omitida: `movil.e2e.ts:81` (scroll anidado del chat), con `test.skip(browserName !== 'chromium')` en la propia prueba. Firefox no se corrió (opcional por `NELTUME_E2E_FIREFOX=1`, documentado como roto en macOS 27).

**Total E2E sumando 1.3 y 1.4: 103 aprobadas, 1 fallida que no se reprodujo aislada (0/3), 1 omitida a propósito.**

### 1.5 Inventario de cobertura frente a la lista pedida

| Tema | Cobertura existente | Archivos |
|---|---|---|
| Creación de productos del catálogo | Sí (UI y servidor) | `alta-manual.e2e.ts`, `alta-desde-pendiente.e2e.ts`, `alta-catalogo.test.ts`, `catalogo-secciones.e2e.ts` («agregar: los datos que faltan se marcan») |
| Edición de productos/modelos | Sí (Gestionar: editar en diálogo, alto máximo) | `catalogo-secciones.e2e.ts`, `papelera.e2e.ts`, `ediciones-manuales.test.ts` |
| «Modelos» como entidad / herencia de características | **No existe la función**; solo alias y familia por modelo para el asistente | `catalogo-secciones.e2e.ts` (configuración), `maderas-compatibles.test.ts` |
| Duplicación de productos del catálogo | **No existe** (Gestionar ofrece solo Editar/Eliminar) | — |
| Búsqueda y selección | Sí, con pocas variantes (coma, punto, cm, código) | `busqueda-catalogo.test.ts`, `catalogo-secciones.e2e.ts`, `cotizador-ui.e2e.ts` |
| Búsqueda con errores de tipeo («ranko»), «1 metro», «85x220», medida dentro del tramo | **No** | — |
| Producto personalizado / ítem libre | Sí | `item-libre.e2e.ts`, `items-libres.test.ts`, `referencias-cliente.e2e.ts`, `pedido-especial.e2e.ts` |
| Productos repetidos (varias líneas iguales) | **No en E2E**; el unitario prueba que un reintento no duplica | `agregar-producto.test.ts:127` |
| Duplicar línea | **No existe la función**; «Duplicar» copia la cotización entera | `gestion.e2e.ts`, `mensajes-error.e2e.ts` |
| Modificar ítems | Sí (medidas, descripción, observación, cantidad, ganancia, descuento por ítem) | `edicion-detalle.e2e.ts`, `descuento-item.e2e.ts`, `campos-numericos.e2e.ts`, `margenes.e2e.ts` |
| Guardado y recarga | Parcial (descuento por ítem tras recargar; borrador en papelera) | `descuento-item.e2e.ts`, `papelera-borrador.e2e.ts`, `persistencia-v22.test.ts` |
| Operaciones mediante IA | Sí con el doble `fijo` (sin costo) + evals | `flujo.e2e.ts`, `item-libre.e2e.ts`, `chat-*.test.ts`, `evals/cotizacion.json` (76 casos), `evals/numeros.json` |
| Totales | Sí (contra `cotizar()` del negocio) | `flujo.e2e.ts`, `historial.e2e.ts`, `montos.test.ts`, `paridad-calculo.test.ts` |
| PDF | Sí (texto, numeración, 25 ítems, regenerar) | `flujo.e2e.ts`, `pdf-*.e2e.ts`, `pdf*.test.ts` |
| Errores de red | Parcial (409 ocupado, sesión vencida, Starken) — **no hay `abort` de red al guardar/agregar** | `emision-ocupada.e2e.ts`, `sesion.e2e.ts`, `mensajes-error.e2e.ts` |
| Concurrencia | Sí (servidor: 409, emisión simultánea, PDF simultáneos; UI: otra vendedora guarda) | `carga-concurrencia.test.ts`, `sesion.e2e.ts`, `gestion.e2e.ts` |
| Doble clic | Sí (emitir, registrar pago) | `toque-doble.e2e.ts` |
| Teclado | Parcial (reordenar y deshacer, ayuda, clientes, catálogo) | `cotizador-ui.e2e.ts`, `ayuda.e2e.ts`, `historial-clientes.e2e.ts` |
| Resoluciones | Sí (320–768 px, 390 px, 844×390, 1280, 1440) | `movil.e2e.ts`, `accesibilidad.e2e.ts`, `pantalla-completa.e2e.ts` |
| Accesibilidad (axe) | Sí, WCAG 2.0/2.1 A y AA | `accesibilidad.e2e.ts` |

---

## 2. Matriz escenario → prueba existente → resultado real → evidencia

| # | Escenario | Prueba existente | Resultado real | Evidencia |
|---|---|---|---|---|
| a | 4 líneas Ranco Pino Oregón (0,85×2,20; 1,00×2,20; 0,85×2,20; 1,00×2,20) a mano | Ninguna con líneas repetidas | **Aprobado**: 4 líneas separadas (no se fusionan), total $1.571.171 (subtotal $1.320.312 + IVA). Tras F5 el cotizador vuelve vacío (la URL es `/`); la cotización sí está guardada: Historial la lista con «4 ítems · $1.571.171» | `QA/capturas/a-cuatro-lineas-1440.png`, `a-tras-recargar.png`, `a-reabierta-historial.png`; `observaciones.log [a]` |
| b | Duplicar una línea y cambiar la copia | No existe la función | **Fallido (función ausente)**: la fila solo tiene ↑, ↓, ×, cantidad, precio y referencia; «Más acciones» tiene Duplicar (la cotización entera), Copiar resumen, Eliminar borrador. Alternativa: agregar de nuevo el mismo producto y editarlo → la copia cambió (ancho 0,80, descripción, precio $300.000) y el **original quedó intacto** | `b-editor-linea.png`, `b-copia-editada.png`, `b-copia-editada-viewport.png`, `aria-b-menu.yml`, `[b]` |
| c | Cotizar algo fuera del catálogo sin tocarlo | `item-libre.e2e.ts`, `pedido-especial.e2e.ts` | **Aprobado**: «ranco 45mm» → 0 resultados → «Crear producto personalizado» precarga el nombre con lo buscado; errores claros junto al campo; puerta 45 mm ($210.000 × 2) e ítem libre «Instalación en obra» ($45.000) en la cotización; el catálogo no cambió (252/252 resultados para «ranco») | `c-busqueda-sin-resultado.png`, `c-form-errores.png`, `c-personalizado-y-libre.png`, `[c]` |
| d | Crear una puerta nueva como usuaria nueva | `alta-manual.e2e.ts` | **Aprobado con un error grave**: se crea y se cotiza, pero la revisión y la confirmación prometen «$237.488 (precio base + 25 %)» y la cotización cobra **$351.482** (+85 %) — H-01. Alta repetida: «Ya existe un producto con esos atributos… No agregué otro» (bien) | `d-1…d-7`, `d-11-alta-repetida.png`, `d-13-precio-real.png`, `[d]` |
| e | Buscar «ranco», «ranko», «pino oregon», «1 metro» | `busqueda-catalogo.test.ts` (no cubre estos) | **Fallido en parte**: «ranco» 252 (muestra 24, empieza por Lenga); «ranko» **0**; «pino oregon» 2193; «1 metro» **0**; «ranco 1,00 2,20» devuelve 8 con **0,6–0,65 m en primer lugar**; «ranco 100x220» 0; «ranco oregon 0,82 2,2» (medida dentro del tramo) 0 | `e-dialogo-*.png`, `e-consultar-*.png`, `QA/busquedas.txt`, `[e]` |
| f | Totales con descuento, guardar, recargar, PDF | `flujo.e2e.ts`, `historial.e2e.ts` | **Aprobado**: pantalla, barra, recarga y PDF coinciden: subtotal $977.990, desc. 7,5 % −$73.349, neto $904.641, IVA $171.882, total $1.076.523; líneas $635.668 y $342.322. PDF «Cotización N.º 323» | `f-con-descuento.png`, `f-dialogo-emitir.png`, `f-emitida.png`, PDF; `[f]` |
| g | Teclado + capturas 1440/768/390 + axe | `accesibilidad.e2e.ts`, `movil.e2e.ts`, `cotizador-ui.e2e.ts` | **Aprobado con observaciones**: axe sin violaciones en 21 combinaciones (7 pantallas × 3 anchos); sin desborde horizontal. Teclado: se agrega un producto sin mouse (11 Tab hasta «Agregar producto», búsqueda con foco inicial, Enter elige, Enter agrega), Cmd+Z deshace, Escape devuelve el foco. Fallas: el foco se pierde al elegir «Medida de hoja» (H-05); Escape en el buscador solo borra el texto (H-06) | `g-*-{1440,768,390}.png`, `g-teclado-tras-agregar.png`, `[g-axe]`, `[g-teclado]` |
| h | Error de red al guardar y doble clic | `toque-doble.e2e.ts`, `emision-ocupada.e2e.ts` (sin abort de red) | **Aprobado con observaciones**: con la red cortada, editar la cantidad avisa «Sin conexión con el cotizador…», el total no cambia y el campo conserva «3»; agregar mantiene el diálogo abierto con el aviso (repetido dos veces, H-10); emitir sin red avisa y no consume número; al volver la red se agrega bien. Doble clic en «Agregar al pedido» → 1 línea; doble clic en confirmar emisión → 1 petición, 1 descarga, N° 324. Doble clic en «Emitir y generar PDF» → el diálogo se abre y se cierra en el acto (H-09) | `h-red-cortada-cantidad.png`, `h-red-cortada-agregar.png`, `h-emitir-sin-red.png`, `h-doble-confirmar.png`, `[h]` |

---

## 3. Hallazgos

Formato: Severidad · Prioridad · Título · Archivo/líneas · Evidencia · Por qué importa · Arreglo · Categoría · Causa raíz · Observado vs esperado · Pruebas requeridas · Esfuerzo · Confianza.

### H-01 · Alta · P1 · El alta de catálogo promete un precio de venta que la cotización no cobra
- **Archivo/líneas**: `src/app/alta-producto.tsx:90,127-128,144-145,280,378,521` (usa `reglas.ajuste` = 0,25); `src/negocio/precios.ts:59-72` (`MARGENES_INICIALES`: puertas sólidas oregón 0,85).
- **Evidencia**: alta de «Llanquihue Pino Oregón 0,8–0,85 × 2,2», base $189.990 → revisión «Unitario en cotizaciones (+25 %) $237.488» y confirmación «En las cotizaciones se mostrará a $237.488 (precio base + 25 %)» (`d-4-revision.png`, `d-5-confirmar.png`). Al cotizarla: unitario **$351.482**, «Costo de fábrica $189.990 · Precio al cliente $351.482 · Ganancia estándar: 85 %» (`d-13-precio-real.png`). El texto de la pantalla también dice «las cotizaciones le suman 25 % automáticamente» (`g-alta-producto-390.png`).
- **Por qué importa**: la administradora fija el precio base con un número equivocado (diferencia de $113.994 por puerta, 48 %). Si «corrige» el base para llegar al precio que cree, el cliente recibe un precio distinto del previsto.
- **Arreglo**: calcular la vista previa con la misma función y margen por categoría que usa la cotización (categoría según familia y madera del producto propuesto) y mostrar el porcentaje real («+85 %, ganancia de puertas sólidas de oregón»); quitar `REGLAS.ajuste` de esta pantalla.
- **Categoría**: Corrección de negocio / UX. **Causa raíz**: la pantalla de alta quedó con la regla antigua de ajuste único; los precios pasaron a márgenes por categoría.
- **Observado vs esperado**: $237.488 prometido vs $351.482 cobrado; esperado: el mismo número en revisión, confirmación y cotización.
- **Pruebas requeridas**: E2E «alta → revisión → cotizar: el unitario de la revisión es el de la línea» para oregón, lenga/mara y una moldura (0,25); unitaria del cálculo de la vista previa por categoría.
- **Esfuerzo**: S (½ día). **Confianza**: alta (reproducido de punta a punta).

### H-02 · Media · P2 · La búsqueda de productos confunde el «1» de la medida con el código y no entiende medidas dentro del tramo ni errores de tipeo
- **Archivo/líneas**: `src/servidor/busqueda.ts:17-50`; `src/app/api/catalogo/route.ts:119-125` (el texto incluye el código).
- **Evidencia** (`QA/busquedas.txt`): «ranco 1,00 2,20» → 8 resultados, el primero **RAN-L-1-C (0,6–0,65 m)**; «ranco 100 220» igual; «ranco oregon 1 2,2» → RAN-O-1-C y RAN-O-5-C; «ranco oregon 0,82 2,2» → 0 aunque 0,82 está en 0,80–0,85; «ranco 85x220», «ranco 85cm», «1 metro», «ranko», «rancos» → 0.
- **Por qué importa**: la vendedora escribe la medida del cliente y recibe la puerta equivocada arriba o «No encontramos productos»; es fácil elegir una 0,60 por una 1,00 con precios similares.
- **Arreglo**: excluir el código de la comparación numérica (o compararlo solo si el término parece un código); interpretar dos números como ancho×alto y filtrar por tramo (`anchoMin ≤ a ≤ anchoMax`); aceptar `x`/`×` y `cm`/`mm` pegados; tolerancia de una letra en modelos (los alias del asistente ya existen en «Nombres y alias»).
- **Categoría**: Búsqueda / UX. **Causa raíz**: coincidencia literal de fichas numéricas sobre un texto que mezcla código y descripción.
- **Observado vs esperado**: ver evidencia; esperado: «ranco oregon 1,00 2,20» → RAN-O-5-C primero; «0,82» encuentra 0,80–0,85.
- **Pruebas requeridas**: unitarias en `busqueda-catalogo.test.ts` para cada caso; E2E del diálogo «Agregar producto» con la medida del cliente.
- **Esfuerzo**: M. **Confianza**: alta.

### H-03 · Media · P2 · El aviso «Producto agregado al pedido» se estira a 440×676 px y tapa cantidades, precios y botones
- **Archivo/líneas**: `src/app/cotizador-pantalla.css:491-499` (+ `globals.css:790-799`).
- **Evidencia**: medido en viewport 1440×900: `aviso exito 440x676 @982,84` (`g-aviso-agregado-1440-viewport.png`, también `c-personalizado-y-libre.png`, `a-cuatro-lineas-1440.png`). Cubre las columnas Cant./Unitario/Total y ↑ ↓ × de las líneas durante unos segundos.
- **Por qué importa**: tras cada alta la vendedora no puede revisar el precio ni quitar la línea hasta que el aviso se va o lo cierra.
- **Arreglo**: en `.pantalla-cotizador.con-pedido .avisos` poner `bottom: auto` (o subir la especificidad de la regla `top: 84px; bottom: auto`), y `align-content: start` en `.avisos`.
- **Categoría**: UI / CSS. **Causa raíz**: `.pantalla-cotizador.con-pedido .avisos { bottom: 140px }` (especificidad 0,3,0) gana sobre `.pantalla-cotizador .avisos { top: 84px; bottom: auto }` (0,2,0): quedan `top` y `bottom` a la vez y la grilla estira el aviso.
- **Observado vs esperado**: aviso de 676 px de alto vs una franja de ~50 px.
- **Pruebas requeridas**: E2E que mida la caja del aviso tras agregar un producto (alto < 120 px) y que «Quitar ítem 1» siga clicable.
- **Esfuerzo**: XS. **Confianza**: alta (medido en el DOM).

### H-04 · Media · P2 · No hay «Duplicar línea»; repetir una puerta con variantes exige rehacer el alta
- **Archivo/líneas**: `src/app/cotizacion-panel.tsx:1050-1085` (acciones de la fila: ↑ ↓ ×); `cotizacion-panel.tsx:1741-1749` («Duplicar» = cotización entera).
- **Evidencia**: `aria-b-menu.yml`, `b-editor-linea.png`, `[b]` («botones duplicar en el panel: 0»).
- **Por qué importa**: pedidos de obra con muchas puertas iguales salvo la medida o la descripción obligan a buscar de nuevo, elegir, escribir medidas y volver a confirmar hoja/vano en cada una.
- **Arreglo**: acción «Duplicar línea» en la fila (inserta la copia debajo con los mismos datos, referencias y tipo de medida) usando una acción de servidor con id idempotente como `duplicar`.
- **Categoría**: Funcionalidad / UX. **Causa raíz**: no implementado. **Observado vs esperado**: ausente vs botón por línea.
- **Pruebas requeridas**: unitaria del servicio (copia, versión, idempotencia); E2E «duplicar línea, cambiar la copia, el original intacto, persiste tras recargar».
- **Esfuerzo**: M. **Confianza**: alta.

### H-05 · Media · P2 · El foco del teclado se pierde al elegir «Medida de hoja/vano»
- **Archivo/líneas**: `src/app/cotizacion-panel.tsx:~907` (grupo `measure-choice` que se desmonta al responder).
- **Evidencia**: `[g-teclado] foco tras elegir hoja: body … (SIN INDICADOR DE FOCO)`.
- **Por qué importa**: con 4 puertas hay 4 confirmaciones; quien usa teclado o lector vuelve al inicio de la página tras cada una.
- **Arreglo**: mover el foco a la siguiente «Medida de hoja» pendiente o, si no hay, al nombre de la línea / «Emitir y generar PDF» (como ya se hace con `cotizacion-titulo` en `dialogo.tsx`, BUG-033).
- **Categoría**: Accesibilidad. **Causa raíz**: el botón activo desaparece sin destino de foco.
- **Pruebas requeridas**: E2E de teclado: 2 pendientes, Enter en el primero, el foco queda en el segundo.
- **Esfuerzo**: S. **Confianza**: alta.

### H-06 · Baja · P3 · Escape en el buscador de «Agregar producto» no cierra el diálogo a la primera
- **Archivo/líneas**: `src/app/agregar-producto.tsx:93-105` (`type="search"`).
- **Evidencia**: `[e] Escape con el foco en la búsqueda «pino oregon»: el diálogo sigue abierto; valor del buscador=«»`; el segundo Escape cierra.
- **Por qué importa**: comportamiento inesperado, borra lo escrito sin cerrar.
- **Arreglo**: `onKeyDown` en el buscador que ante Escape llame a `alCerrar`, o `type="text"` con botón propio de limpiar.
- **Categoría**: Teclado. **Causa raíz**: el `<input type="search">` nativo consume el primer Escape para limpiar. **Pruebas**: E2E Escape cierra con texto escrito. **Esfuerzo**: XS. **Confianza**: alta.

### H-07 · Media · P2 · El catálogo no tiene modelos ni variantes: una puerta nueva se da de alta tramo por tramo, sin duplicar ni heredar
- **Archivo/líneas**: `src/app/alta-producto.tsx` (un producto = una madera × un tramo de ancho × un alto); `src/app/gestion-manuales.tsx` (solo Editar / Eliminar).
- **Evidencia**: `d-9-gestionar-admin.png`; Ranco Pino Oregón tiene 9 anchos × varios altos (45+ filas) en la planilla; recrear un modelo así a mano son decenas de altas idénticas salvo dos números. Al volver a «Agregar producto» el formulario no ofrece «otro igual con otra medida/madera».
- **Por qué importa**: el pedido de esta auditoría («creación/edición de productos y modelos, herencia, duplicación») no tiene soporte; la vía real es Importar la planilla.
- **Arreglo**: «Agregar otro como este» (copia el formulario) y alta en bloque de una grilla de anchos × altos con precio por fila; a mediano plazo, modelo con atributos heredados.
- **Categoría**: Funcionalidad. **Causa raíz**: modelo de datos plano (`productos_catalogo`). **Pruebas**: E2E de alta en bloque. **Esfuerzo**: M–L. **Confianza**: alta.

### H-08 · Baja · P3 · Recargar (F5) deja el cotizador vacío aunque la cotización esté guardada
- **Archivo/líneas**: `src/app/cotizador.tsx` (la cotización actual no va en la URL). Documentado como intencional en `tests/descuento-item.e2e.ts:56` («recargar vuelve al inicio»).
- **Evidencia**: `a-tras-recargar.png` (pantalla de bienvenida) vs `a-reabierta-historial.png` (está en Historial con 4 ítems).
- **Por qué importa**: la vendedora cree haber perdido el trabajo; no hay aviso «Seguir con el borrador de hace 1 min».
- **Arreglo**: `?id=` en la URL o aviso con enlace al último borrador propio. Respetar la intención documentada: es una decisión de producto.
- **Categoría**: UX. **Esfuerzo**: S. **Confianza**: alta.

### H-09 · Baja · P3 · Doble clic en «Emitir y generar PDF» abre y cierra el diálogo de confirmación
- **Archivo/líneas**: `src/app/dialogo.tsx:70-73` (clic en el fondo cierra).
- **Evidencia**: `[h] diálogos de emitir abiertos tras doble clic: 0`. El doble clic en «Emitir» del diálogo sí produce una sola emisión (N° 324, 1 descarga).
- **Por qué importa**: parece que el botón no responde; no hay riesgo de doble número.
- **Arreglo**: ignorar el clic en el fondo durante ~300 ms tras `showModal()`. **Categoría**: UX. **Esfuerzo**: XS. **Confianza**: media-alta.

### H-10 · Baja · P3 · El aviso de red se muestra dos veces al agregar sin conexión
- **Evidencia**: `[h] agregar con red cortada: … alertas=["Sin conexión…","Sin conexión…"]` (dentro del diálogo y en la zona de avisos), `h-red-cortada-agregar.png`.
- **Arreglo**: con el diálogo abierto, mostrar el error solo dentro de él. **Categoría**: UX. **Esfuerzo**: XS. **Confianza**: alta.

### H-11 · Media · P2 · `test:e2e:paralelo` usa puertos fijos (3201+) que choca con la E2E de la fábrica
- **Archivo/líneas**: `scripts/e2e-paralelo.mjs:47` (`puerto: String(3201 + i)`).
- **Evidencia**: `QA/e2e-paralelo.log` (EADDRINUSE 3201/3202/3203; la fábrica ocupaba 3200–3206).
- **Por qué importa**: el deploy corre la suite como compuerta; si las dos apps se prueban a la vez, la de la tienda falla en bloque y parece una falla de la app.
- **Arreglo**: base de puertos configurable (`NELTUME_E2E_PORT_BASE`) y/o buscar un puerto libre antes de lanzar; mensaje claro si está ocupado.
- **Categoría**: Infraestructura de pruebas. **Esfuerzo**: XS. **Confianza**: alta.

### H-12 · Baja · P3 · El login de la E2E espera 5 s y falla con `next dev` en frío bajo carga
- **Archivo/líneas**: `tests/login-e2e.ts:26`.
- **Evidencia**: falla de `accesibilidad.e2e.ts:58` en la corrida serie; 0/3 al repetirla sola (`QA/a11y-bucle.txt`).
- **Arreglo**: `toBeVisible({ timeout: 30_000 })` en el login o calentar `/` en `preparar-e2e`. **Categoría**: Pruebas. **Esfuerzo**: XS. **Confianza**: media (la causa probable es la compilación en frío; no se reprodujo aislada).

### H-13 · Baja · P3 · Detalles de presentación vistos en pantalla
- Historial: las 4 líneas se resumen como «1 × Ranco Pino Oregón, 1 × Ranco Pino Oregón…» sin medida: no se distinguen (`a-reabierta-historial.png`). Arreglo: agregar la medida o agrupar «2 × … 0,85×2,20».
- PDF: «Ranco Pino Oregon» sin tilde; la pantalla dice «Pino Oregón». El PDF llama «Neto» a lo que la pantalla llama «Total sin IVA».
- Alta de catálogo: antes de elegir familia, el formulario muestra «Medida o escuadría» y «Largo» (campos de accesorio) y sus errores, aunque la usuaria va a crear una puerta (`d-2-alta-errores.png`). El código asignado a un producto escrito a mano empieza con «IA-» (`IA-E40F089D0F`, «Ingresado a mano»): confunde.
- Diálogo «Producto personalizado» a 1440×900: el botón «Agregar al pedido» queda bajo el borde y hay que desplazar dentro del diálogo (`c-form-errores.png`). Los marcadores «0,80» y «2,10» se parecen a valores ya escritos.
- Cada puerta repetida exige su propia confirmación hoja/vano (4 pendientes con 4 líneas, `a-cuatro-lineas-1440.png`); en el diálogo de agregar existe «La medida corresponde a», pero queda en «Por confirmar» por omisión. Sugerencia: recordar la última elección o «aplicar a todas».
- Una descripción escrita reemplaza el título de la línea y la medida deja de verse en el nombre (queda «800 × 2200 mm» como subtítulo) (`b-copia-editada-viewport.png`).
- **Categoría**: UX. **Esfuerzo**: XS–S cada uno. **Confianza**: alta.

### Observaciones positivas (verificadas)
- Totales consistentes en pantalla, barra fija, recarga y PDF (escenario f).
- Ítem libre y personalizado sin tocar el catálogo; el nombre buscado se precarga (escenario c).
- Mensajes de validación en español junto a cada campo; la red cortada no pierde lo escrito ni cambia el total; emitir sin red no consume número.
- Doble clic en agregar y en confirmar emisión: sin duplicados.
- axe: 0 violaciones WCAG A/AA en 21 combinaciones; sin desborde horizontal a 390 y 768 px; en el teléfono la barra del total y las acciones quedan fijas y legibles (`g-cotizador-items-390.png`).
- Alta repetida bloqueada con mensaje claro; medidas del alta aceptan cm («80», «220»).

---

## 4. Pruebas faltantes y automatización recomendada

1. **E2E «líneas repetidas»**: 4 altas con dos pares iguales → 4 filas, totales por línea, persisten al abrir desde Historial (base: `QA/specs/01-lineas.spec.ts`, test a).
2. **E2E «precio del alta = precio cotizado»** (cubre H-01) para tres categorías de margen (base: `03-alta.spec.ts` + `06-precio.spec.ts`).
3. **Unitarias de búsqueda** con «ranco 1,00 2,20», «ranco 100x220», «85cm», «0,82 2,2», «ranko» (H-02), y E2E del orden del primer resultado.
4. **E2E de error de red con `page.route(...).abort()`** en editar, agregar y emitir: aviso visible, valor conservado, total intacto, sin número consumido (base: `02-cotizar.spec.ts` tests h y h2).
5. **E2E de geometría del aviso** (alto < 120 px, no tapa «Quitar ítem») (H-03).
6. **E2E de teclado del flujo completo**: buscar, elegir, agregar, confirmar hoja/vano en 2 líneas sin perder el foco, Escape cierra (H-05, H-06) (base: `04-pantallas.spec.ts` g2).
7. **Duplicar línea** cuando exista (H-04).
8. **Infraestructura**: puerto base configurable en `e2e-paralelo.mjs` (H-11); plazo del login E2E (H-12); el proyecto `aceptacion` no debería quedar sin correr por una falla aislada de `flujos` — considerar `--no-deps` en una segunda pasada del script o reportar «no ejecutadas» en el resumen.

---

## 5. Observaciones UX por pantalla (lo visto en las capturas)

- **Cotizador vacío** (`g-cotizador-vacio-*.png`): limpio; a la izquierda «Cuéntame el pedido» con ejemplo clicable y enlace a la guía; a la derecha «Vista previa» con «Agregar producto del catálogo». A 390 px se divide en pestañas «Pedido / Cotización»; bien.
- **Cotizador con ítems** (`a-cuatro-lineas-1440.png`, `g-cotizador-items-*.png`): tabla clara (producto, código, mm, cant., unitario, total); los recuadros ámbar de hoja/vano dominan visualmente con varias líneas; el botón principal cambia a «Resolver medida» y «N pendientes ↑» lleva al primero, bien resuelto. El aviso verde tapa la columna de precios (H-03). En las capturas de página completa el panel del asistente aparece a media altura (efecto de `position: sticky` al capturar, no se ve así en la pantalla real).
- **Diálogo «Agregar producto»** (`e-dialogo-ranco.png`): «252 resultados · Mostrando los primeros 24; precisa tu búsqueda.»; cada resultado muestra nombre con tramo, código, madera y «unitario sin IVA de referencia». Para «ranco» los primeros son Lenga (orden alfabético de madera), no Pino Oregón.
- **Catálogo › Consultar** (`g-catalogo-*.png`): tabla legible, «Mostrando 300 de 8773 productos», columna «Unitario cotización — costo de fábrica + ganancia, sin IVA» (aquí el precio sí es el de la cotización, contrario al alta).
- **Alta de producto** (`d-1…d-6`, `g-alta-producto-*.png`): dos vías (describir con asistente / formulario); ayudas de unidades bajo cada campo; revisión antes de guardar; confirmación modal; estado «Producto agregado … Agregar otro producto». El texto «+25 %» es incorrecto (H-01). En escritorio el contenido se desplaza dentro de un panel de alto fijo y el título de sección se pierde al bajar.
- **Nombres y alias** (`d-10-config-admin.png`, `g-config-catalogo-*.png`): explica bien su propósito («Aquí se le enseña al asistente esas otras formas de decirlo») y tiene probador; pero esos alias no ayudan al buscador manual («ranko» = 0).
- **Gestionar catálogo** (`d-9-gestionar-admin.png`): lista los agregados a mano con Editar/Eliminar; sin duplicar.
- **Historial** (`a-reabierta-historial.png`, `g-historial-*.png`): filtros completos; a 390 px los filtros ocupan toda la primera pantalla antes de la primera cotización; resumen de productos sin medidas (H-13).
- **Ayuda** (`g-ayuda-*.png`): sin problemas detectados por axe ni por desborde.

---

## Anexo: aceptación y proyectos dependientes
Ver 1.4 (`QA/acep.log`, exit 0, 48 s).

## Anexo: limpieza
Se detuvo el servidor 3123; `tsconfig.json` y `next-env.d.ts`, que `next dev` reescribe, se restauraron desde la copia tomada antes de empezar; `git status` final limpio. Quedan sin borrar, ignorados por git: `data/test-e2e/` (de `npm run test:e2e`, es su propio entorno), `.next-e2e/qa3123`, `.next-e2e/qa-a11y`, `.next-e2e/qa-acep` y `test-results/` de la corrida paralela fallida.
