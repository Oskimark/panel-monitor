import { bytes, pct } from "../format";
import { flattenSettled, getJson } from "../http";
import type { Account, Item, Status, UsageMetric } from "../types";

const BASE = "https://console.neon.tech/api/v2";

// Límites del plan Free de Neon: 512 MB de almacenamiento, 191.9 CU-horas/mes y 5 GB de transferencia.
const FREE_STORAGE_BYTES = 512 * 1024 * 1024;
const FREE_COMPUTE_SECONDS = 191.9 * 3600;
const FREE_TRANSFER_BYTES = 5 * 1024 * 1024 * 1024;

type Project = {
  id: string;
  name: string;
  region_id: string;
  synthetic_storage_size?: number;
  branch_logical_size_limit_bytes?: number;
  compute_time_seconds?: number;
  active_time_seconds?: number;
  data_transfer_bytes?: number;
  updated_at?: string;
};
type Endpoint = {
  current_state: string;
  autoscaling_limit_max_cu?: number;
};

export async function neon(a: Account): Promise<Item[]> {
  const headers = { Authorization: `Bearer ${a.token}` };

  // Las cuentas con organizaciones necesitan listar proyectos por org_id.
  const orgs = await getJson<{ organizations: { id: string; name: string }[] }>(
    `${BASE}/users/me/organizations`,
    { headers }
  )
    .then((r) => r.organizations)
    .catch(() => [] as { id: string; name: string }[]);

  const scopes = [{ id: "", name: "personal" }, ...orgs];

  const results = await Promise.allSettled(
    scopes.map(async (s) => {
      const q = s.id ? `&org_id=${s.id}` : "";
      const { projects } = await getJson<{ projects: Project[] }>(`${BASE}/projects?limit=100${q}`, { headers });
      return Promise.all(
        projects.map(async (p): Promise<Item> => {
          const endpoints = await getJson<{ endpoints: Endpoint[] }>(`${BASE}/projects/${p.id}/endpoints`, { headers })
            .then((r) => r.endpoints)
            .catch(() => [] as Endpoint[]);
          const states = endpoints.map((e) => e.current_state);
          let status: Status = states.includes("active")
            ? "ok"
            : states.includes("init")
              ? "building"
              : states.length
                ? "idle"
                : "unknown";

          const usage: UsageMetric[] = [];

          // 1. Almacenamiento vs límite Free (512 MB)
          if (p.synthetic_storage_size !== undefined) {
            const storageLimit = p.branch_logical_size_limit_bytes || FREE_STORAGE_BYTES;
            const storagePct = pct(p.synthetic_storage_size, storageLimit);
            usage.push({
              label: `Disco: ${bytes(p.synthetic_storage_size)} / ${bytes(storageLimit)}`,
              percent: storagePct,
            });
          }

          // 2. Horas de cómputo consumidas en el periodo vs 191.9 CU-h
          if (p.compute_time_seconds !== undefined) {
            const computeHours = (p.compute_time_seconds / 3600).toFixed(1);
            const computePct = pct(p.compute_time_seconds, FREE_COMPUTE_SECONDS);
            usage.push({
              label: `Cómputo: ${computeHours} / 191.9 CU-h`,
              percent: computePct,
            });
          }

          // 3. Transferencia de datos (egress) si existe consumo relevante
          if (p.data_transfer_bytes && p.data_transfer_bytes > 0) {
            const transferPct = pct(p.data_transfer_bytes, FREE_TRANSFER_BYTES);
            usage.push({
              label: `Egress: ${bytes(p.data_transfer_bytes)} / 5 GB`,
              percent: transferPct,
            });
          }

          // Si alguna cuota del plan gratis supera el 85%, elevamos a warning para prevenir corte.
          if ((status === "ok" || status === "idle") && usage.some((u) => (u.percent ?? 0) >= 85)) {
            status = "warning";
          }

          const maxCu = endpoints[0]?.autoscaling_limit_max_cu;
          const detailParts = [
            p.region_id,
            states.includes("active") ? "Compute activo" : states.length ? "Scale-to-zero (idle)" : undefined,
            maxCu ? `máx ${maxCu} CU` : undefined,
          ].filter(Boolean);

          return {
            platform: "neon",
            account: a.label,
            scope: s.name,
            kind: "database",
            name: p.name,
            status,
            detail: detailParts.join(" · "),
            usage,
            updatedAt: p.updated_at ? Date.parse(p.updated_at) : undefined,
            url: `https://console.neon.tech/app/projects/${p.id}`,
          };
        })
      );
    })
  );

  // Una cuenta personal puede devolver también proyectos de sus orgs: quitamos duplicados,
  // priorizando el scope de organización sobre "personal" si aparece en ambos.
  const byUrl = new Map<string, Item>();
  for (const item of flattenSettled(results)) {
    const key = item.url ?? `${item.account}-${item.name}`;
    const prev = byUrl.get(key);
    if (!prev || (prev.scope === "personal" && item.scope !== "personal")) {
      byUrl.set(key, item);
    }
  }
  return Array.from(byUrl.values());
}
