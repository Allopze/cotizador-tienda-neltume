import { clienteVacio, type Cliente } from '../catalogo/tipos';

const CAMPOS = ['nombre', 'rut', 'giro', 'telefono', 'direccion', 'comuna', 'proyecto'] as const;
const MAX_CAMPO = 300;

/** Dígito verificador módulo 11 de un cuerpo de RUT. */
export function digitoVerificador(cuerpo: string) {
  let suma = 0,
    factor = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const dv = 11 - (suma % 11);
  return dv === 11 ? '0' : dv === 10 ? 'K' : String(dv);
}

/** Normaliza a «12.345.678-5» si el dígito verificador es válido; null si no lo es. */
export function normalizarRut(texto: string): string | null {
  const compacto = texto.replace(/[.\s‐-]/g, '').toUpperCase();
  const m = compacto.match(/^(\d{1,9})([\dK])$/);
  if (!m) return null;
  const cuerpo = m[1].replace(/^0+(?=\d)/, '');
  if (digitoVerificador(cuerpo) !== m[2]) return null;
  return `${cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${m[2]}`;
}

/** RUT sin puntos ni guion, en minúsculas; sirve para búsqueda. */
export const rutCompacto = (rut: string | null) => (rut ?? '').replace(/[^0-9kK]/g, '').toLowerCase();

/** Recorta espacios, vacía los textos en blanco y normaliza el RUT. Un RUT inválido se conserva con aviso. */
export function sanearCliente(entrada: Partial<Cliente>, base: Cliente = clienteVacio()) {
  const cliente: Cliente = { ...clienteVacio(), ...base };
  const avisos: string[] = [];
  for (const campo of CAMPOS) {
    if (!(campo in entrada)) continue;
    const valor = entrada[campo];
    const texto = typeof valor === 'string' ? valor.replace(/\s+/g, ' ').trim().slice(0, MAX_CAMPO) : '';
    cliente[campo] = texto || null;
  }
  if (cliente.rut) {
    const rut = normalizarRut(cliente.rut);
    if (rut) cliente.rut = rut;
    else
      avisos.push(`El RUT «${cliente.rut}» no tiene un dígito verificador válido. Revísalo antes de emitir.`);
  }
  return { cliente, avisos };
}

const plano = (s: string | null) =>
  (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Compara clientes ignorando mayúsculas, tildes, espacios y formato del RUT. */
export const mismoCliente = (a: Cliente, b: Cliente) =>
  CAMPOS.every((campo) =>
    campo === 'rut' ? rutCompacto(a.rut) === rutCompacto(b.rut) : plano(a[campo]) === plano(b[campo]),
  );
