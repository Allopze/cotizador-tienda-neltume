# Recursos de los PDF

Se incrustan en cada PDF al imprimirlo (`inyectarRecursos`, `src/servidor/pdf.ts`): el servidor imprime sin red y el
snapshot de cada documento guarda solo la referencia (`neltume-fuente:…`, `neltume-dibujo:…`).

- `fuentes/`: las del estilo común de los documentos (docs/estilo-documentos-v1.md): Fraunces 500, Instrument Sans 400 y
  600 y JetBrains Mono 400, estáticas (`.woff`), con el subconjunto latino y copiadas byte a byte de la fábrica; su
  licencia, la SIL Open Font License 1.1, es `OFL-estandar.txt`. `docs/estilo-documentos-tokens.json` guarda el sha256
  de cada archivo y `tests/pdf-estandar.test.ts` lo comprueba: si cambian aquí, cambian también en la fábrica. Al no ser
  variables, Chromium las incrusta como fuentes normales y el PDF pesa varias veces menos.
  Newsreader y Host Grotesk (`*.woff2`, variables) siguen aquí por dos razones: la interfaz web las usa
  (`src/app/layout.tsx`) y los documentos emitidos antes del estándar se reimprimen desde su snapshot, que referencia
  estos archivos (`neltume-fuente:newsreader.woff2`…): no se borran. El guion de Host Grotesk está acortado con
  `scripts/fuentes-pdf.py`: el original mide medio cuadratín y en códigos y RUT se leía como una raya.
- `dibujos/`: ya no se imprimen en los documentos nuevos (el producto de catálogo puede ser solo la base del precio de un
  modelo especial; estándar, sección 5). Siguen aquí porque los snapshots de los documentos emitidos antes los referencian
  (`neltume-dibujo:…`) y se reimprimen como se emitieron: no se borran. Son dibujos de línea de cada modelo de puerta y del marco, sacados de los modelos 3D de `modelos-3d/puertas`
  con `scripts/dibujos/generar.sh` (Blender). `dibujos.json` dice el archivo de cada modelo del catálogo y dónde está la
  hoja en el dibujo, para las cotas de la nota de pedido. Un modelo sin dibujo se imprime con el esquema genérico.
  Los demás modelos no tienen modelo 3D y se dibujaron a mano con `scripts/dibujos/dibujos-2d.py`, sobre el marco de
  Ancacomoe: Huilo Huilo, Los Ríos y Los Lagos, a partir de las fotos de la planilla de enchapadas; Calafquén,
  Cochamó, Enco, Ensenada, Futaleufú, Fuy, Palena, Petrohué, Ranco, Rupanco y Yelcho, a partir de las fotos de
  puertasneltume.cl. Todos dibujan una hoja de 800 × 2000 mm: Enco y Ranco son correderas más anchas en la foto, y la
  de Rupanco trae un paño fijo al lado que no se dibuja. Para otro modelo hace falta una foto o un plano de referencia.
