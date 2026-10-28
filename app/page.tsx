import { headers } from "next/headers";
import { collect } from "@/lib/connectors";
import { isAuthorized } from "@/lib/auth";
import { ago } from "@/lib/format";
import type { Item, Platform, Status } from "@/lib/types";
import AutoRefresh from "./auto-refresh";

export const dynamic = "force-dynamic";

const PLATFORMS: Record<Platform, string> = {
  vercel: "Vercel",
  railway: "Railway",
  supabase: "Supabase",
  neon: "Neon",
  cloudflare: "Cloudflare",
};
const STATUS_TEXT: Record<Status, string> = {
  ok: "Activo",
  building: "En proceso",
  warning: "Alerta cuota/salud",
  error: "Con error",
  paused: "Pausado",
  idle: "En reposo",
  unknown: "Sin dato",
};
const KIND_TEXT = { app: "Aplicación", database: "Base de datos", worker: "Worker" };
const RANK: Record<Status, number> = {
  error: 0,
  warning: 1,
  building: 2,
  paused: 3,
  idle: 4,
  unknown: 5,
  ok: 6,
};
const byStatus = (a: Item, b: Item) => RANK[a.status] - RANK[b.status] || a.name.localeCompare(b.name);

function barTone(pct: number): string {
  if (pct >= 90) return "crit";
  if (pct >= 75) return "warn";
  return "ok";
}

function Table({ items }: { items: Item[] }) {
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Cuenta</th>
            <th>Tipo</th>
            <th>Detalle</th>
            <th>Uso / Cuota Free</th>
            <th>Estado</th>
            <th>Actualizado</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={`${i.platform}-${i.account}-${i.scope}-${i.name}-${i.url ?? ""}`} className={`s-${i.status}`}>
              <td className="name">
                {i.url ? (
                  <a href={i.url} target="_blank" rel="noreferrer">
                    {i.name}
                  </a>
                ) : (
                  i.name
                )}
              </td>
              <td>{i.scope && i.scope !== "personal" ? `${i.account}, ${i.scope}` : i.account}</td>
              <td>{KIND_TEXT[i.kind]}</td>
              <td className="detail">{i.detail || "—"}</td>
              <td className="usage-cell">
                {i.usage && i.usage.length > 0 ? (
                  <ul className="usage-list">
                    {i.usage.map((u, idx) => (
                      <li key={idx} className="usage-item">
                        <div className="usage-row">
                          <span>{u.label}</span>
                          {u.percent !== undefined && <span className="usage-pct">{u.percent}%</span>}
                        </div>
                        {u.percent !== undefined && (
                          <div className="meter" aria-hidden="true">
                            <div
                              className={`meter-fill m-${barTone(u.percent)}`}
                              style={{ width: `${Math.min(100, Math.max(2, u.percent))}%` }}
                            />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td className="state">{STATUS_TEXT[i.status]}</td>
              <td className="when">{ago(i.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function Home() {
  // Segunda barrera además del middleware.
  if (!isAuthorized(headers().get("authorization"))) {
    return (
      <main className="wrap">
        <h1>Acceso restringido</h1>
      </main>
    );
  }

  const { items, errors, configError, accountCount } = await collect();
  const failing = items.filter((i) => i.status === "error").sort(byStatus);
  const warnings = items.filter((i) => i.status === "warning").sort(byStatus);

  const headline = configError
    ? "Falta configurar las cuentas"
    : failing.length
      ? `${failing.length} ${failing.length === 1 ? "recurso con error" : "recursos con error"}`
      : warnings.length
        ? `${warnings.length} ${warnings.length === 1 ? "recurso en alerta de cuota" : "recursos en alerta de cuota"}`
        : errors.length
          ? "Algunas cuentas no respondieron"
          : items.length
            ? "Todo en orden"
            : "No hay proyectos para mostrar";
  const tone =
    configError || failing.length ? "error" : warnings.length || errors.length ? "building" : "ok";

  const tally = (Object.keys(STATUS_TEXT) as Status[])
    .map((s) => [s, items.filter((i) => i.status === s).length] as const)
    .filter(([, n]) => n > 0);

  const groups = (Object.keys(PLATFORMS) as Platform[])
    .map((p) => [p, items.filter((i) => i.platform === p).sort(byStatus)] as const)
    .filter(([, list]) => list.length > 0);

  return (
    <main className="wrap">
      <header>
        <h1 className={`headline t-${tone}`}>{headline}</h1>
        {configError && <p className="note">{configError} Revisa el archivo .env.example para ver el formato.</p>}
        {failing.length > 0 && (
          <p className="note">{failing.map((i) => `${PLATFORMS[i.platform]}: ${i.name}`).join(", ")}</p>
        )}
        {warnings.length > 0 && (
          <p className="note">
            Alerta de cuota/salud: {warnings.map((i) => `${PLATFORMS[i.platform]} (${i.name})`).join(", ")}
          </p>
        )}
        {items.length > 0 && (
          <ul className="tally">
            {tally.map(([s, n]) => (
              <li key={s}>
                <span className={`dot s-${s}`} aria-hidden="true" />
                {n} {STATUS_TEXT[s].toLowerCase()}
              </li>
            ))}
            <li className="muted">
              {items.length} recursos en {accountCount} {accountCount === 1 ? "cuenta" : "cuentas"}
            </li>
          </ul>
        )}
        <AutoRefresh />
      </header>

      {errors.length > 0 && (
        <section className="problems">
          <h2>No se pudo leer</h2>
          <ul>
            {errors.map((e, i) => (
              <li key={i}>
                <strong>
                  {PLATFORMS[e.platform]}, cuenta {e.account}:
                </strong>{" "}
                {e.message}. Revisa que el token siga vigente y tenga permiso de lectura.
              </li>
            ))}
          </ul>
        </section>
      )}

      {groups.map(([p, list]) => (
        <section key={p}>
          <h2>
            {PLATFORMS[p]} <span className="count">{list.length}</span>
          </h2>
          <Table items={list} />
        </section>
      ))}
    </main>
  );
}
