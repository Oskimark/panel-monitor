import { pct } from "../format";
import { flattenSettled, getJson } from "../http";
import type { Account, Item, Status, UsageMetric } from "../types";

const ENDPOINT = "https://backboard.railway.com/graphql/v2";

const MAP: Record<string, Status> = {
  SUCCESS: "ok",
  FAILED: "error",
  CRASHED: "error",
  BUILDING: "building",
  DEPLOYING: "building",
  INITIALIZING: "building",
  QUEUED: "building",
  WAITING: "building",
  NEEDS_APPROVAL: "building",
  SLEEPING: "idle",
  REMOVED: "unknown",
  REMOVING: "unknown",
  SKIPPED: "unknown",
};

const IGNORED_DEPLOY_STATES = new Set(["REMOVED", "REMOVING", "SKIPPED"]);
const DB_KEYWORDS = ["postgres", "postgresql", "redis", "mysql", "mariadb", "mongo", "mongodb", "clickhouse", "minio"];
// Crédito habitual en Railway Trial / Hobby ($5 USD).
const FREE_CREDIT_LIMIT_USD = 5;

async function gql<T>(token: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await getJson<{ data?: T; errors?: { message: string }[] }>(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (res.errors?.length) throw new Error(`Railway: ${res.errors[0].message}`);
  return res.data as T;
}

type Edges<T> = { edges: { node: T }[] };

function inferKind(serviceName: string, icon?: string | null): "app" | "database" {
  const text = `${serviceName} ${icon ?? ""}`.toLowerCase();
  return DB_KEYWORDS.some((k) => text.includes(k)) ? "database" : "app";
}

export async function railway(a: Account): Promise<Item[]> {
  const { projects } = await gql<{
    projects: Edges<{
      id: string;
      name: string;
      services: Edges<{ id: string; name: string; icon?: string | null }>;
    }>;
  }>(
    a.token,
    `query { projects { edges { node { id name services { edges { node { id name icon } } } } } } }`
  );

  const results = await Promise.allSettled(
    projects.edges.map(async ({ node: p }) => {
      // Consultamos deployments y opcionalmente el consumo estimado del proyecto en el ciclo actual.
      const [deploymentsRes, usageRes] = await Promise.allSettled([
        gql<{
          deployments: Edges<{ serviceId: string | null; status: string; createdAt: string }>;
        }>(
          a.token,
          `query($projectId: String!) { deployments(first: 100, input: { projectId: $projectId }) { edges { node { serviceId status createdAt } } } }`,
          { projectId: p.id }
        ),
        gql<{
          estimatedUsage?: { estimatedValue?: number }[];
        }>(
          a.token,
          `query($projectId: String!) { estimatedUsage(projectId: $projectId, measurements: [CPU_USAGE, MEMORY_USAGE_GB, NETWORK_TX_GB, DISK_USAGE_GB]) { estimatedValue } }`,
          { projectId: p.id }
        ),
      ]);

      if (deploymentsRes.status === "rejected") throw deploymentsRes.reason;
      const deployments = deploymentsRes.value.deployments;

      // Calculamos el gasto estimado del proyecto si Railway lo devuelve para este token.
      let projectEstimatedUsd: number | undefined;
      if (usageRes.status === "fulfilled" && Array.isArray(usageRes.value.estimatedUsage)) {
        projectEstimatedUsd = usageRes.value.estimatedUsage.reduce((sum, u) => sum + (u.estimatedValue ?? 0), 0);
      }

      // Nos quedamos con el deploy activo más reciente de cada servicio (ignorando SKIPPED/REMOVED si hay uno previo).
      const latestActive = new Map<string, { status: string; createdAt: string }>();
      const latestFallback = new Map<string, { status: string; createdAt: string }>();

      for (const { node: d } of deployments.edges) {
        if (!d.serviceId) continue;
        if (!latestFallback.has(d.serviceId)) {
          latestFallback.set(d.serviceId, d);
        }
        if (!IGNORED_DEPLOY_STATES.has(d.status) && !latestActive.has(d.serviceId)) {
          latestActive.set(d.serviceId, d);
        }
      }

      const serviceCount = p.services.edges.length;

      return p.services.edges.map(({ node: s }): Item => {
        const d = latestActive.get(s.id) ?? latestFallback.get(s.id);
        let status: Status = d ? MAP[d.status] ?? "unknown" : "unknown";
        const usage: UsageMetric[] = [];

        if (projectEstimatedUsd !== undefined && projectEstimatedUsd > 0) {
          const creditPct = pct(projectEstimatedUsd, FREE_CREDIT_LIMIT_USD);
          usage.push({
            label: `Uso est. proyecto: $${projectEstimatedUsd.toFixed(2)} / $${FREE_CREDIT_LIMIT_USD}.00`,
            percent: creditPct,
          });
          if (status === "ok" && (creditPct ?? 0) >= 85) {
            status = "warning";
          }
        } else {
          usage.push({ label: `${serviceCount} ${serviceCount === 1 ? "servicio" : "servicios"} en proyecto` });
        }

        return {
          platform: "railway",
          account: a.label,
          scope: p.name,
          kind: inferKind(s.name, s.icon),
          name: s.name,
          status,
          detail: d ? d.status.toLowerCase() : "Sin deploys",
          usage,
          updatedAt: d ? Date.parse(d.createdAt) : undefined,
          url: `https://railway.com/project/${p.id}`,
        };
      });
    })
  );
  return flattenSettled(results);
}
