export function bytes(n?: number): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = Math.max(0, n);
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function pct(used?: number, limit?: number): number | undefined {
  if (used === undefined || limit === undefined || limit <= 0) return undefined;
  return Math.min(100, Math.round((used / limit) * 100));
}

export function compactNumber(n?: number): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

export function ago(ts?: number): string {
  if (!ts || Number.isNaN(ts)) return "—";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "hace segundos";
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}
