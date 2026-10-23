# Recursos de los PDF

Se incrustan en cada PDF al imprimirlo (`inyectarRecursos`, `src/servidor/pdf.ts`): el servidor imprime sin red y el
snapshot de cada documento guarda solo la referencia (`neltume-fuente:…`, `neltume-dibujo:…`).

- `fuentes/`: Newsreader y Host Grotesk, variables y con el subconjunto latino de Google Fonts, bajo la SIL Open Font
  License 1.1 (`OFL-*.txt`). El guion de Host Grotesk está acortado con `scripts/fuentes-pdf.py`: el original mide
  medio cuadratín y en códigos y RUT se leía como una raya.
- `dibujos/`: dibujos de línea de cada modelo de puerta y del marco, sacados de los modelos 3D de `modelos-3d/puertas`
  con `scripts/dibujos/generar.sh` (Blender). `dibujos.json` dice el archivo de cada modelo del catálogo y dónde está la
  hoja en el dibujo, para las cotas de la nota de pedido. Un modelo sin dibujo se imprime con el esquema genérico.
