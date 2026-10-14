import { SaxesParser, type SaxesAttributeNS, type SaxesTagNS } from 'saxes';

/**
 * Validación del logo SVG que sube una administradora. En lugar de buscar patrones peligrosos (una lista negra que se
 * esquiva con entidades como `java&#x73;cript:` o con mayúsculas), el SVG se lee con un parser XML y solo se aceptan
 * elementos y atributos de dibujo conocidos. Lo demás se rechaza con un mensaje que dice qué sobra. El SVG no se
 * reescribe: si pasa, se guarda tal como vino.
 */

const SVG = 'http://www.w3.org/2000/svg';
const XLINK = 'http://www.w3.org/1999/xlink';
const XML = 'http://www.w3.org/XML/1998/namespace';
const XMLNS = 'http://www.w3.org/2000/xmlns/';

// Espacios de nombres que agregan los editores (Inkscape, Illustrator, Sketch, metadatos RDF). Los navegadores no
// dibujan ni ejecutan nada de ellos; su contenido igual se revisa.
const NS_EDITORES = new Set([
  'http://www.inkscape.org/namespaces/inkscape',
  'http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  'http://creativecommons.org/ns#',
  'http://purl.org/dc/elements/1.1/',
  'http://www.bohemiancoding.com/sketch/ns',
  'http://ns.adobe.com/AdobeIllustrator/10.0/',
  'http://ns.adobe.com/Graphs/1.0/',
  'http://ns.adobe.com/Extensibility/1.0/',
  'http://ns.adobe.com/AdobeSVGViewerExtensions/3.0/',
  'http://ns.adobe.com/SaveForWeb/1.0/',
  'http://ns.adobe.com/Variables/1.0/',
  'http://ns.adobe.com/ImageReplacement/1.0/',
]);

const ELEMENTOS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc', 'metadata', 'style', 'switch',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath',
  'linearGradient', 'radialGradient', 'stop', 'pattern', 'clipPath', 'mask', 'marker', 'image',
  'filter', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix',
  'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight', 'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB',
  'feFuncG', 'feFuncR', 'feGaussianBlur', 'feImage', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset',
  'fePointLight', 'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence',
]);

const ATRIBUTOS = new Set([
  // Generales y de estructura
  'id', 'class', 'style', 'lang', 'tabindex', 'version', 'baseProfile', 'viewBox', 'preserveAspectRatio',
  'x', 'y', 'width', 'height', 'transform', 'role', 'focusable', 'enable-background', 'xml:space',
  'requiredFeatures', 'requiredExtensions', 'systemLanguage', 'type', 'media',
  'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-hidden',
  // Geometría
  'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'points', 'pathLength',
  // Presentación
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'opacity', 'color',
  'display', 'visibility', 'overflow', 'clip', 'clip-path', 'clip-rule', 'mask', 'filter', 'isolation',
  'mix-blend-mode', 'paint-order', 'vector-effect', 'shape-rendering', 'image-rendering', 'text-rendering',
  'color-interpolation', 'color-interpolation-filters', 'color-rendering', 'marker-start', 'marker-mid',
  'marker-end', 'stop-color', 'stop-opacity', 'flood-color', 'flood-opacity', 'lighting-color',
  // Texto
  'font-family', 'font-size', 'font-size-adjust', 'font-stretch', 'font-style', 'font-variant', 'font-weight',
  'letter-spacing', 'word-spacing', 'text-anchor', 'text-decoration', 'dominant-baseline', 'alignment-baseline',
  'baseline-shift', 'writing-mode', 'direction', 'unicode-bidi', 'dx', 'dy', 'rotate', 'textLength',
  'lengthAdjust', 'startOffset', 'method', 'spacing', 'side',
  // Degradados, patrones, recortes y marcadores
  'gradientUnits', 'gradientTransform', 'spreadMethod', 'fx', 'fy', 'fr', 'offset', 'patternUnits',
  'patternContentUnits', 'patternTransform', 'clipPathUnits', 'maskUnits', 'maskContentUnits', 'markerUnits',
  'markerWidth', 'markerHeight', 'refX', 'refY', 'orient',
  // Filtros
  'filterUnits', 'primitiveUnits', 'in', 'in2', 'result', 'mode', 'values', 'operator', 'k1', 'k2', 'k3', 'k4',
  'stdDeviation', 'edgeMode', 'radius', 'scale', 'xChannelSelector', 'yChannelSelector', 'baseFrequency',
  'numOctaves', 'seed', 'stitchTiles', 'surfaceScale', 'diffuseConstant', 'specularConstant',
  'specularExponent', 'kernelUnitLength', 'kernelMatrix', 'order', 'divisor', 'bias', 'targetX', 'targetY',
  'preserveAlpha', 'azimuth', 'elevation', 'z', 'pointsAtX', 'pointsAtY', 'pointsAtZ', 'limitingConeAngle',
  'tableValues', 'slope', 'intercept', 'amplitude', 'exponent',
  // Enlaces (el valor se revisa aparte: solo referencias internas)
  'href',
]);

// Una referencia interna (`#id`) o una imagen rasterizada incrustada; nada que cargue otro documento.
const REFERENCIA_INTERNA = /^#[\w.:-]*$/;
const IMAGEN_INCRUSTADA = /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]*$/i;

/** `url(...)` solo puede apuntar a un `#id` del mismo SVG; `@import` y `expression()` no se aceptan. */
function problemaCss(css: string): string | null {
  const plano = css.replace(/\\/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  if (/@import/i.test(plano)) return 'importa otra hoja de estilos (@import)';
  if (/expression\s*\(/i.test(plano)) return 'usa expression() en un estilo';
  if (/javascript\s*:/i.test(plano)) return 'tiene un enlace javascript:';
  for (const coincidencia of plano.matchAll(/url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi))
    if (!REFERENCIA_INTERNA.test(coincidencia[2].trim())) return `carga un recurso externo (url(${coincidencia[2].trim().slice(0, 60)}))`;
  if (/url\s*\(/i.test(plano.replace(/url\s*\(\s*(['"]?)#[\w.:-]*\1\s*\)/gi, '')))
    return 'usa url() con un destino no permitido';
  return null;
}

function problemaAtributo(elemento: string, atributo: SaxesAttributeNS): string | null {
  const { uri, local, prefix, name, value } = atributo;
  if (prefix === 'xmlns' || name === 'xmlns' || uri === XMLNS) return null;
  if (NS_EDITORES.has(uri)) return null;
  const nombre = uri === XML ? `xml:${local}` : uri === XLINK ? `xlink:${local}` : uri === '' ? local : null;
  if (nombre === null) return `el atributo «${name}» no está permitido`;
  if (/^on/i.test(local)) return `el atributo «${name}» ejecuta código`;
  const valor = value.trim();
  if (local === 'href' && (uri === '' || uri === XLINK)) {
    if (REFERENCIA_INTERNA.test(valor)) return null;
    if (elemento === 'image' && IMAGEN_INCRUSTADA.test(valor)) return null;
    return `el enlace «${valor.slice(0, 60)}» apunta fuera del SVG`;
  }
  if (uri === XLINK) return local === 'title' || local === 'type' ? null : `el atributo «${name}» no está permitido`;
  if (!ATRIBUTOS.has(nombre)) return `el atributo «${name}» no está permitido`;
  if (/javascript\s*:/i.test(valor.replace(/[\s\u0000-\u001f]/g, ''))) return 'tiene un enlace javascript:';
  return problemaCss(valor);
}

/**
 * Devuelve `null` si el SVG solo dibuja, o el motivo del rechazo (en español, para mostrarlo tal cual).
 */
export function problemaSvg(svg: string): string | null {
  const parser = new SaxesParser({ xmlns: true, position: false });
  let problema: string | null = null;
  let raiz = true;
  let enEstilo = 0;
  const marcar = (motivo: string) => {
    problema ??= motivo;
  };
  parser.on('doctype', () => marcar('declara un DOCTYPE o entidades'));
  parser.on('processinginstruction', (pi) => marcar(`tiene una instrucción de procesamiento (<?${pi.target}?>)`));
  parser.on('opentag', (tag: SaxesTagNS) => {
    if (raiz) {
      raiz = false;
      if (tag.local !== 'svg' || (tag.uri !== SVG && tag.uri !== '')) marcar('el elemento principal no es <svg>');
    }
    if (NS_EDITORES.has(tag.uri)) {
      // Metadatos del editor: no se dibujan, pero sus atributos y su contenido se revisan igual.
    } else if (tag.uri !== SVG && tag.uri !== '') marcar(`el elemento «${tag.name}» no es de SVG`);
    else if (!ELEMENTOS.has(tag.local)) marcar(`el elemento «${tag.name}» no está permitido`);
    if (tag.local === 'style') enEstilo += 1;
    for (const atributo of Object.values(tag.attributes)) {
      const motivo = problemaAtributo(tag.local, atributo);
      if (motivo) marcar(motivo);
    }
  });
  parser.on('closetag', (tag: SaxesTagNS) => {
    if (tag.local === 'style') enEstilo -= 1;
  });
  const revisarTexto = (texto: string) => {
    if (enEstilo > 0) {
      const motivo = problemaCss(texto);
      if (motivo) marcar(motivo);
    }
  };
  parser.on('text', revisarTexto);
  parser.on('cdata', revisarTexto);
  try {
    parser.write(svg).close();
  } catch {
    // Un DOCTYPE con entidades propias hace fallar el parser al usarlas: se informa el motivo, no el error genérico.
    if (problema) return `El SVG contiene contenido no permitido: ${problema}.`;
    return 'No es un SVG válido: revisa que el archivo esté completo y bien formado.';
  }
  if (raiz) return 'No es un SVG válido: no tiene un elemento <svg>.';
  return problema ? `El SVG contiene contenido no permitido: ${problema}.` : null;
}
