import { pct } from "../format";
import { getJson } from "../http";
import type { Account, Item, Status, UsageMetric } from "../types";

const MAP: Record<string, Status> = {
  ACTIVE_HEALTHY: "ok",
  ACTIVE_UNHEALTHY: "error",
  INIT_FAILED: "error",
  COMING_UP: "building",
  RESTORING: "building",
  UPGRADING: "building",
  RESTARTING: "building",
  RESIZING: "building",
  INACTIVE: "paused",
  PAUSING: "paused",
  PAUSED: "paused",
  GOING_DOWN: "paused",
  REMOVED: "unknown",
};

// Límite del plan Free de Supabase: máximo 2 proyectos activos por organización/cuenta.
const FREE_ACTIVE_PROJECTS_LIMIT = 2;

type Project = {
  id: string;
  name: string;
  region: string;
  status: string;
  created_at?: string;
  database?: { version?: string };
};

type HealthService = { name: string; healthy: boolean; status: string };

export async function supabase(a: Account): Promise<Item[]> {
  const headers = { Authorization: `Bearer ${a.token}` };
  const projects = await getJson<Project[]>("https://api.supabase.com/v1/projects", { headers });

  const activeCount = projects.filter((p) => p.status.startsWith("ACTIVE") || p.status === "COMING_UP").length;
  const activePct = pct(activeCount, FREE_ACTIVE_PROJECTS_LIMIT);

  return Promise.all(
    projects.map(async (p): Promise<Item> => {
      let status: Status = MAP[p.status] ?? "unknown";
      const usage: UsageMetric[] = [
        {
          label: `Cupo Free: ${activeCount}/${FREE_ACTIVE_PROJECTS_LIMIT} activos`,
          percent: activePct,
        },
      ];

      // Si el proyecto está activo, verificamos la salud real de sus subsistemas (db, auth, rest, storage).
      if (status === "ok") {
        const health = await getJson<HealthService[]>(
          `https://api.supabase.com/v1/projects/${p.id}/health?services=db,auth,rest,storage`,
          { headers }
        ).catch(() => null);

        if (Array.isArray(health) && health.length > 0) {
          const healthyCount = health.filter((h) => h.healthy).length;
          const failingServices = health.filter((h) => !h.healthy).map((h) => h.name);
          usage.push({
            label:
              failingServices.length > 0
                ? `Servicios: fallo en ${failingServices.join(", ")}`
                : `Servicios: ${healthyCount}/${health.length} OK (db, auth, rest, storage)`,
          });
          if (failingServices.length > 0) {
            status = "warning";
          }
        }
      }

      const pgVersion = p.database?.version ? `PG ${p.database.version.split(".")[0]}` : undefined;
      const detail = [p.region, pgVersion, p.status.toLowerCase().replaceAll("_", " ")].filter(Boolean).join(" · ");

      return {
        platform: "supabase",
        account: a.label,
        kind: "database",
        name: p.name,
        status,
        detail,
        usage,
        updatedAt: p.created_at ? Date.parse(p.created_at) : undefined,
        url: `https://supabase.com/dashboard/project/${p.id}`,
      };
    })
  );
}
