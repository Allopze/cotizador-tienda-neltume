# Verificación de fuentes

Este script no procesa reunion.pdf: la transcripción se revisa manualmente y sus conclusiones (uso interno, revisión humana, correlativo automático, datos del cliente en el mensaje, salida PDF y nota de pedido tras la aprobación) están en el README.

- **COTIZADOR_2026.xlsx**: hojas `Cotización`, `Precio`, `Categorias`.
- **Cotizador Puertas Neltume.Co-rev-4F.xlsx**: hojas `Cotización`, `Precio`, `Categorias`.
  Comparación A–G, O y P de Precio: idénticas. H–N no se compararon por confidencialidad.
  Q8: -25 %.
- **NOTA DE PEDIDO_PTAS FLORES SPA_N°.xlsx**: hojas `Cotización Tipo`.
  Encabezado verificado: NOTA DE PEDIDO N°. Tabla: CÓDIGO / DESCRIPCIÓN PRODUCTO / CANT. /  PRECIO UNIT. / TOTAL.
- **NOTA DE PEDIDO_PTAS SOLIDAS_N°.xlsx**: hojas `Cotización Tipo`.
  Encabezado verificado: NOTA DE PEDIDO N°. Tabla: CÓDIGO / DESCRIPCIÓN PRODUCTO / CANT. /  PRECIO UNIT. / TOTAL.
- **VALORES PUERTAS ENCHAPADAS_NELTUME.CO.xlsx**: hojas `HUILO HUILO ENCHP`, `LOS RIOS ENCHP`, `LOS LAGOS ENCHP`, `ANCACOMOE ENCHP`, `COZ COZ PREPINTADA`, `MARCOS `.
  Solo se listaron sus hojas; no se leyeron celdas. Línea y proveedor fuera de alcance.

LibreOffice no está instalado. No se ejecutó recálculo de paridad; se verifican los ocho oráculos de la especificación sobre precios netos reales en npm test.
