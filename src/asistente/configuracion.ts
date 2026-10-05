// Plazos de CommandCode. Cada intento tiene su plazo; un mensaje completo (reintento, respaldo y corrección
// incluidos) no excede el plazo total.
export function timeoutIA(): number {
  const valor = Number(process.env.CMD_TIMEOUT_MS ?? 60000);
  return Number.isInteger(valor) && valor >= 1000 && valor <= 120000 ? valor : 60000;
}
/** Plazo de todo el mensaje: por omisión, el de un intento más 30 s para un reintento o el respaldo. */
export function plazoTotalIA(): number {
  const intento = timeoutIA();
  const porOmision = Math.min(intento + 30000, 300000);
  const valor = Number(process.env.CMD_PLAZO_TOTAL_MS ?? porOmision);
  return Number.isInteger(valor) && valor >= intento && valor <= 300000 ? valor : porOmision;
}
/** Espera antes de reintentar un límite o una caída momentánea del proveedor. */
export function esperaReintentoIA(): number {
  const valor = Number(process.env.CMD_REINTENTO_MS ?? 2000);
  return Number.isInteger(valor) && valor >= 0 && valor <= 10000 ? valor : 2000;
}
