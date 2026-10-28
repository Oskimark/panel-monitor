import { pct } from "../format";
import { flattenSettled, getJson } from "../http";
import type { Account, Item, Status, UsageMetric } from "../types";

const MAP: Record<string, Status> = {
  READY: "ok",
  ERROR: "error",
  BUILDING: "building",
  INITIALIZING: "building",
  QUEUED: "building",
  CANCELED: "unknown",
};

// Límite del plan Hobby (Free) de Vercel: 100 deploys por día.
const FREE_DAILY_DEPLOYS = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

type Deployment = { readyState: string; createdAt: number; url: string };
type Project = {
  id: string;
  name: string;
  framework?: string | null;
  targets?: { production?: Deployment };
  latestDeployments?: Deployment[];
};

export async function vercel(a: Account): Promise<Item[]> {
  const headers = { Authorization: `Bearer ${a.token}` };

  // Si el token está restringido a un scope sin permiso sobre /v2/teams, continuamos con el scope personal.
  const { teams } = await getJson<{ teams: { id: string; name: string }[] }>(
    "https://api.vercel.com/v2/teams?limit=100",
    { headers }
  ).catch(() => ({ teams: [] as { id: string; name: string }[] }));

  const scopes = [{ id: "", name: "personal" }, ...teams];
  const now = Date.now();

  const results = await Promise.allSettled(
    scopes.map(async (s) => {
      const q = s.id ? `&teamId=${s.id}` : "";
      const { projects } = await getJson<{ projects: Project[] }>(
        `https://api.vercel.com/v9/projects?limit=100${q}`,
        { headers }
      );

      // Contamos cuántos deploys recientes (últimas 24h) hay en el scope para monitorear el límite de 100/día.
      const deploysLast24h = projects.reduce((acc, p) => {
        const recent = (p.latestDeployments ?? []).filter((d) => now - d.createdAt < DAY_MS).length;
        return acc + recent;
      }, 0);
      const deploysPct = pct(deploysLast24h, FREE_DAILY_DEPLOYS);

      return projects.map((p): Item => {
        const prod = p.targets?.production;
        // Si no hay deploy de producción, preferimos el último deploy no cancelado.
        const latestNonCanceled = p.latestDeployments?.find((d) => d.readyState !== "CANCELED");
        const d = prod ?? latestNonCanceled ?? p.latestDeployments?.[0];

        let status: Status = d ? MAP[d.readyState] ?? "unknown" : "unknown";
        const usage: UsageMetric[] = [
          {
            label: `Deploys 24h (cuenta): ${deploysLast24h}/${FREE_DAILY_DEPLOYS}`,
            percent: deploysPct,
          },
        ];

        // Si el último intento falló pero producción sigue arriba, avisamos como warning.
        const latestAttempt = p.latestDeployments?.[0];
        if (prod && prod.readyState === "READY" && latestAttempt && latestAttempt.readyState === "ERROR") {
          status = "warning";
          usage.push({ label: "Último deploy falló (Prod sigue activo)" });
        } else if (status === "ok" && (deploysPct ?? 0) >= 85) {
          status = "warning";
        }

        const detailParts = [
          d ? (prod ? "Producción" : "Preview") : "Sin deploys",
          p.framework ? p.framework : undefined,
        ].filter(Boolean);

        return {
          platform: "vercel",
          account: a.label,
          scope: s.name,
          kind: "app",
          name: p.name,
          status,
          detail: detailParts.join(" · "),
          usage,
          updatedAt: d?.createdAt,
          url: d?.url ? `https://${d.url}` : undefined,
        };
      });
    })
  );

  // En Vercel Hobby las cuentas personales son un Default Team: deduplicamos por nombre de proyecto
  // dentro de la misma cuenta, priorizando el scope con nombre de equipo sobre "personal".
  const byProject = new Map<string, Item>();
  for (const item of flattenSettled(results)) {
    const key = `${item.account}:${item.name}`;
    const prev = byProject.get(key);
    if (!prev || (prev.scope === "personal" && item.scope !== "personal")) {
      byProject.set(key, item);
    }
  }
  return Array.from(byProject.values());
}
