// Un único plazo para ambos formatos de CommandCode, sin reintentos automáticos.
export function timeoutIA(): number {
  const valor = Number(process.env.CMD_TIMEOUT_MS ?? 60000);
  return Number.isInteger(valor) && valor >= 1000 && valor <= 120000 ? valor : 60000;
}
