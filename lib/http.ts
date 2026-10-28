// Timeout de 6.5s por petición para no exceder el límite de 10s de Vercel Hobby en llamadas encadenadas.
export async function getJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    next: { revalidate: 30 },
    signal: AbortSignal.timeout(6_500),
  });
  if (!res.ok) {
    // Solo host y código: nunca incluir headers ni tokens en los mensajes.
    throw new Error(`${res.status} ${res.statusText} (${new URL(url).host})`);
  }
  return res.json() as Promise<T>;
}

// Junta resultados de varios "scopes" (equipos, organizaciones...).
// Solo falla si TODOS fallaron; así un scope sin permisos no tumba el resto.
export function flattenSettled<T>(results: PromiseSettledResult<T[]>[]): T[] {
  const ok = results.filter((r): r is PromiseFulfilledResult<T[]> => r.status === "fulfilled");
  if (!ok.length && results.length) throw (results[0] as PromiseRejectedResult).reason;
  return ok.flatMap((r) => r.value);
}
