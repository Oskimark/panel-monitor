import { bytes, compactNumber, pct } from "../format";
import { flattenSettled, getJson } from "../http";
import type { Account, Item, Status, UsageMetric } from "../types";

const BASE = "https://api.cloudflare.com/client/v4";

// Límites del plan Free de Cloudflare:
// - Workers: 100,000 peticiones/día por cuenta
// - D1: 500 MB por base de datos (y 5 GB total)
const FREE_WORKER_DAILY_REQ = 100_000;
const FREE_D1_STORAGE_BYTES = 500 * 1024 * 1024;

type CF<T> = { success: boolean; result: T; errors?: { message: string }[] };

async function cf<T>(token: string, path: string): Promise<T> {
  const r = await getJson<CF<T>>(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.success) throw new Error(r.errors?.[0]?.message ?? "Error de Cloudflare");
  return r.result;
}

type WorkerMetric = { requests: number; errors: number };

// Consulta opcional a GraphQL Analytics de Cloudflare para obtener peticiones y errores de hoy (UTC) por Worker.
async function fetchWorkersDailyMetrics(token: string, accountId: string): Promise<Map<string, WorkerMetric>> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const query = `
    query($accountTag: string!, $since: Time!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersInvocationsAdaptive(limit: 500, filter: { datetime_geq: $since }) {
            dimensions { scriptName }
            sum { requests errors }
          }
        }
      }
    }
  `;
  const res = await getJson<{
    data?: {
      viewer?: {
        accounts?: {
          workersInvocationsAdaptive?: {
            dimensions: { scriptName: string };
            sum: { requests: number; errors: number };
          }[];
        }[];
      };
    };
  }>(`${BASE}/graphql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { accountTag: accountId, since: todayStart.toISOString() } }),
  });

  const map = new Map<string, WorkerMetric>();
  const rows = res.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? [];
  for (const row of rows) {
    const name = row.dimensions?.scriptName;
    if (!name) continue;
    const prev = map.get(name) ?? { requests: 0, errors: 0 };
    map.set(name, {
      requests: prev.requests + (row.sum?.requests ?? 0),
      errors: prev.errors + (row.sum?.errors ?? 0),
    });
  }
  return map;
}

type PagesProject = {
  name: string;
  subdomain: string;
  latest_deployment?: { created_on: string; latest_stage?: { status: string } };
};

const PAGES: Record<string, Status> = {
  success: "ok",
  failure: "error",
  active: "building",
  canceled: "unknown",
  skipped: "unknown",
  idle: "building",
};

export async function cloudflare(a: Account): Promise<Item[]> {
  const accounts = await cf<{ id: string; name: string }[]>(a.token, "/accounts");

  const results = await Promise.allSettled(
    accounts.map(async (acc) => {
      const [pages, workers, d1, workerMetrics] = await Promise.allSettled([
        cf<PagesProject[]>(a.token, `/accounts/${acc.id}/pages/projects`),
        cf<{ id: string; modified_on: string }[]>(a.token, `/accounts/${acc.id}/workers/scripts`),
        cf<{ uuid: string; name: string; file_size?: number; num_tables?: number; created_at?: string }[]>(
          a.token,
          `/accounts/${acc.id}/d1/database`
        ),
        fetchWorkersDailyMetrics(a.token, acc.id),
      ]);

      // Si el token no tiene permiso para ninguno de los tres recursos principales, lanzamos el error.
      if ([pages, workers, d1].every((r) => r.status === "rejected")) {
        throw (pages as PromiseRejectedResult).reason;
      }

      const metricsMap = workerMetrics.status === "fulfilled" ? workerMetrics.value : new Map<string, WorkerMetric>();
      let totalAccountWorkerReq = 0;
      for (const m of metricsMap.values()) totalAccountWorkerReq += m.requests;
      const accountWorkerPct = pct(totalAccountWorkerReq, FREE_WORKER_DAILY_REQ);

      const items: Item[] = [];
      if (pages.status === "fulfilled") {
        for (const p of pages.value) {
          const d = p.latest_deployment;
          const stageStatus = d?.latest_stage?.status;
          items.push({
            platform: "cloudflare",
            account: a.label,
            scope: acc.name,
            kind: "app",
            name: `${p.name} (Pages)`,
            status: stageStatus ? PAGES[stageStatus] ?? "unknown" : "unknown",
            detail: stageStatus ? `Deploy: ${stageStatus}` : "Sin deploys",
            updatedAt: d ? Date.parse(d.created_on) : undefined,
            url: p.subdomain ? `https://${p.subdomain}` : undefined,
          });
        }
      }
      if (workers.status === "fulfilled") {
        for (const w of workers.value) {
          const m = metricsMap.get(w.id);
          let status: Status = "ok";
          const usage: UsageMetric[] = [];

          if (workerMetrics.status === "fulfilled") {
            const reqs = m?.requests ?? 0;
            const errs = m?.errors ?? 0;
            usage.push({
              label: `Hoy: ${compactNumber(reqs)} req (${compactNumber(totalAccountWorkerReq)}/100k cuenta)`,
              percent: accountWorkerPct,
            });
            if (errs > 0) {
              const errRate = reqs > 0 ? Math.round((errs / reqs) * 100) : 100;
              usage.push({ label: `Errores hoy: ${compactNumber(errs)} (${errRate}%)` });
              if (errRate >= 20) status = "error";
              else if (errRate >= 5) status = "warning";
            }
            if (status === "ok" && (accountWorkerPct ?? 0) >= 85) {
              status = "warning";
            }
          }

          items.push({
            platform: "cloudflare",
            account: a.label,
            scope: acc.name,
            kind: "worker",
            name: w.id,
            status,
            detail:
              workerMetrics.status === "fulfilled"
                ? "Worker activo"
                : "Publicado (añade permiso Account Analytics para ver uso)",
            usage: usage.length ? usage : undefined,
            updatedAt: Date.parse(w.modified_on),
          });
        }
      }
      if (d1.status === "fulfilled") {
        for (const db of d1.value) {
          let status: Status = "ok";
          const usage: UsageMetric[] = [];
          if (db.file_size !== undefined) {
            const storagePct = pct(db.file_size, FREE_D1_STORAGE_BYTES);
            usage.push({
              label: `Disco: ${bytes(db.file_size)} / 500 MB`,
              percent: storagePct,
            });
            if ((storagePct ?? 0) >= 85) status = "warning";
          }
          const detailParts = [
            db.num_tables !== undefined ? `${db.num_tables} tablas` : undefined,
            db.file_size !== undefined ? bytes(db.file_size) : "D1 SQLite",
          ].filter(Boolean);

          items.push({
            platform: "cloudflare",
            account: a.label,
            scope: acc.name,
            kind: "database",
            name: `${db.name} (D1)`,
            status,
            detail: detailParts.join(" · "),
            usage: usage.length ? usage : undefined,
            updatedAt: db.created_at ? Date.parse(db.created_at) : undefined,
          });
        }
      }
      return items;
    })
  );
  return flattenSettled(results);
}
