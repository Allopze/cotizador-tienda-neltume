/**
 * Descripción corta y legible del navegador y el sistema a partir del User-Agent («Chrome en Windows»), para la
 * lista de sesiones y el registro de inicios de sesión. Si no se reconoce, `null`: la interfaz dice «Dispositivo
 * desconocido» en vez de mostrar la cadena cruda.
 */
export function describirDispositivo(userAgent: string | null | undefined): string | null {
  const ua = (userAgent ?? '').slice(0, 500);
  if (!ua.trim()) return null;
  // La app de Android se presenta como «NeltumeCotizador/1.0.0 (Android 16; Google Pixel 8)».
  if (/^NeltumeCotizador\//.test(ua)) {
    const modelo = /\(Android [^;)]*;\s*([^)]+)\)/.exec(ua)?.[1]?.trim();
    return modelo ? `App Android en ${modelo}` : 'App Android';
  }
  const navegador = /Edg(?:e|A|iOS)?\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /SamsungBrowser\//.test(ua)
        ? 'Samsung Internet'
        : /Firefox\/|FxiOS\//.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua) && /Version\//.test(ua)
              ? 'Safari'
              : null;
  const sistema = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'macOS'
            : /CrOS/.test(ua)
              ? 'ChromeOS'
              : /Linux/.test(ua)
                ? 'Linux'
                : null;
  if (navegador && sistema) return `${navegador} en ${sistema}`;
  return navegador ?? sistema;
}
