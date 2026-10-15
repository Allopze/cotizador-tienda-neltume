import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  configuracionNegocioPredeterminada,
  configuracionNegocioSchema,
  leerConfiguracionNegocio,
} from '../src/servidor/configuracion-negocio';
import { problemaSvg } from '../src/servidor/svg-seguro';

// #20/#40: el logo se valida con un parser y una lista de elementos y atributos permitidos, no con una lista negra.

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const NS_XLINK = 'xmlns:xlink="http://www.w3.org/1999/xlink"';
const envolver = (cuerpo: string, extra = '') => `<svg ${NS} ${NS_XLINK} ${extra} viewBox="0 0 10 10">${cuerpo}</svg>`;

describe('problemaSvg acepta logos de dibujo', () => {
  it('acepta el logo predeterminado', () => {
    expect(problemaSvg(readFileSync(join(process.cwd(), 'public/logo-neltume.svg'), 'utf8'))).toBeNull();
  });

  it('acepta degradados, referencias internas, estilos sin url externa y metadatos de Inkscape', () => {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Creado con Inkscape -->
<svg ${NS} ${NS_XLINK} xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
  xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" width="100" height="50">
  <sodipodi:namedview id="nv" inkscape:zoom="1"/>
  <defs>
    <style><![CDATA[.a{fill:url(#g);stroke:#333}]]></style>
    <linearGradient id="g"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
    <path id="p" d="M0 0h10v10z"/>
  </defs>
  <g inkscape:label="Capa 1" style="fill:url('#g')"><use xlink:href="#p" class="a"/><use href="#p"/></g>
  <text x="1" y="9" font-family="Arial">Neltume</text>
  <image width="1" height="1" href="data:image/png;base64,iVBORw0KGgo="/>
</svg>`;
    expect(problemaSvg(svg)).toBeNull();
  });
});

describe('problemaSvg rechaza vectores conocidos', () => {
  const casos: [string, string, RegExp][] = [
    ['script', envolver('<script>alert(1)</script>'), /script/],
    ['script con mayúsculas en otro espacio', envolver('<SCRIPT>alert(1)</SCRIPT>'), /SCRIPT/],
    ['foreignObject', envolver('<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>'), /foreignObject/],
    ['HTML incrustado', envolver('<html:img xmlns:html="http://www.w3.org/1999/xhtml" src="x"/>'), /no es de SVG/],
    ['manejador onload', envolver('', 'onload="alert(1)"'), /onload/],
    ['manejador con mayúsculas', envolver('<rect OnClick="alert(1)"/>'), /OnClick/],
    ['href javascript', envolver('<use href="javascript:alert(1)"/>'), /apunta fuera/],
    ['xlink:href con entidad', envolver('<use xlink:href="java&#x73;cript:alert(1)"/>'), /apunta fuera/],
    ['href externo', envolver('<use href="https://malicioso.test/x.svg#a"/>'), /apunta fuera/],
    ['imagen SVG anidada', envolver('<image href="data:image/svg+xml;base64,PHN2Zz4="/>'), /apunta fuera/],
    ['enlace <a>', envolver('<a href="#x"><rect/></a>'), /«a»/],
    ['animate que cambia href', envolver('<animate attributeName="href" to="javascript:alert(1)"/>'), /animate/],
    ['set', envolver('<set attributeName="onmouseover" to="alert(1)"/>'), /set/],
    ['iframe', envolver('<iframe src="https://x"/>'), /iframe/],
    ['style con url externa', envolver('<style>rect{fill:url(https://malicioso.test/a)}</style>'), /recurso externo/],
    ['style con url escapada', envolver('<style>rect{background:u\\rl(//malicioso.test)}</style>'), /recurso externo/],
    ['style con @import', envolver('<style>@import "https://malicioso.test/a.css";</style>'), /@import/],
    ['atributo style con url externa', envolver('<rect style="fill:url(http://x/y)"/>'), /recurso externo/],
    ['atributo de presentación con url externa', envolver('<rect fill="url(http://x/y#a)"/>'), /recurso externo/],
    ['javascript con entidad en otro atributo', envolver('<rect fill="java&#x73;cript:alert(1)"/>'), /javascript/],
    ['DOCTYPE con entidades', `<!DOCTYPE svg [<!ENTITY x "y">]>${envolver('<text>&x;</text>')}`, /DOCTYPE/],
    ['instrucción de procesamiento', `<?xml-stylesheet href="https://x/a.css"?>${envolver('')}`, /instrucción/],
    ['atributo desconocido', envolver('<rect formaction="x"/>'), /formaction/],
    ['raíz que no es svg', '<html xmlns="http://www.w3.org/1999/xhtml"><svg/></html>', /principal/],
  ];

  it.each(casos)('%s', (_nombre, svg, motivo) => {
    const problema = problemaSvg(svg);
    expect(problema).toMatch(/^El SVG contiene contenido no permitido: /);
    expect(problema).toMatch(motivo);
  });

  it('rechaza XML mal formado o sin <svg>', () => {
    expect(problemaSvg('<svg><g></svg>')).toMatch(/No es un SVG válido/);
    expect(problemaSvg('hola')).toMatch(/No es un SVG válido/);
    expect(problemaSvg(`<svg ${NS}><rect xlink:href="#a"/></svg>`)).toMatch(/No es un SVG válido/);
  });
});

describe('Validación del logo en la configuración del negocio', () => {
  const conLogo = (logoSvg: string | null) => {
    const base = configuracionNegocioPredeterminada();
    return { ...base, empresa: { ...base.empresa, logoSvg } };
  };

  it('el esquema rechaza el logo con el motivo y acepta uno de dibujo', () => {
    const malo = configuracionNegocioSchema.safeParse(conLogo(envolver('<use href="java&#x73;cript:alert(1)"/>')));
    expect(malo.success).toBe(false);
    expect(malo.error?.issues[0]?.message).toMatch(/apunta fuera del SVG/);
    expect(configuracionNegocioSchema.safeParse(conLogo(envolver('<rect width="5" height="5"/>'))).success).toBe(true);
  });

  it('un logo guardado que ya no pasa se ignora sin perder el resto de la configuración', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE ajustes (clave TEXT PRIMARY KEY, valor_json TEXT NOT NULL, actualizada TEXT)');
    const guardada = conLogo(envolver('<foreignObject/>'));
    guardada.empresa.nombre = 'Neltume SpA';
    db.prepare('INSERT INTO ajustes VALUES (?, ?, ?)').run('negocio', JSON.stringify(guardada), '2026-10-01');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const leida = leerConfiguracionNegocio(db);
    expect(leida.empresa.nombre).toBe('Neltume SpA');
    expect(leida.empresa.logoSvg).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    db.close();
  });
});
