// Autenticación básica con una contraseña. Falla cerrado si no hay DASHBOARD_PASSWORD.
// Soporta caracteres UTF-8 y comparación en tiempo constante compatible con Edge Runtime.
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ua = enc.encode(a);
  const ub = enc.encode(b);
  if (ua.length !== ub.length) return false;
  let diff = 0;
  for (let i = 0; i < ua.length; i++) {
    diff |= ua[i] ^ ub[i];
  }
  return diff === 0;
}

export function isAuthorized(header: string | null): boolean {
  const pass = process.env.DASHBOARD_PASSWORD;
  if (!pass || !header?.startsWith("Basic ")) return false;
  try {
    const bin = atob(header.slice(6));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    const i = decoded.indexOf(":");
    if (i === -1) return false;
    return safeEqual(decoded.slice(i + 1), pass);
  } catch {
    return false;
  }
}
