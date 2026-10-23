# Recursos de los PDF

Se incrustan en cada PDF al imprimirlo (`inyectarRecursos`, `src/servidor/pdf.ts`): el servidor imprime sin red y el
snapshot de cada documento guarda solo la referencia (`neltume-fuente:…`, `neltume-dibujo:…`).

- `fuentes/`: Newsreader y Host Grotesk, variables y con el subconjunto latino de Google Fonts, bajo la SIL Open Font
  License 1.1 (`OFL-*.txt`). El guion de Host Grotesk está acortado con `scripts/fuentes-pdf.py`: el original mide
  medio cuadratín y en códigos y RUT se leía como una raya.
- `dibujos/`: dibujos de línea de cada modelo de puerta y del marco, sacados de los modelos 3D de `modelos-3d/puertas`
  con `scripts/dibujos/generar.sh` (Blender). `dibujos.json` dice el archivo de cada modelo del catálogo y dónde está la
  hoja en el dibujo, para las cotas de la nota de pedido. Un modelo sin dibujo se imprime con el esquema genérico.
  Los demás modelos no tienen modelo 3D y se dibujaron a mano con `scripts/dibujos/dibujos-2d.py`, sobre el marco de
  Ancacomoe: Huilo Huilo, Los Ríos y Los Lagos, a partir de las fotos de la planilla de enchapadas; Calafquén,
  Cochamó, Enco, Ensenada, Futaleufú, Fuy, Palena, Petrohué, Ranco, Rupanco y Yelcho, a partir de las fotos de
  puertasneltume.cl. Todos dibujan una hoja de 800 × 2000 mm: Enco y Ranco son correderas más anchas en la foto, y la
  de Rupanco trae un paño fijo al lado que no se dibuja. Para otro modelo hace falta una foto o un plano de referencia.
