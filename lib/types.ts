export type Platform = "vercel" | "railway" | "supabase" | "neon" | "cloudflare";
export type Status = "ok" | "building" | "warning" | "error" | "paused" | "idle" | "unknown";

export type Account = { platform: Platform; label: string; token: string };

export type UsageMetric = {
  label: string;
  percent?: number;
};

export type Item = {
  platform: Platform;
  account: string;
  scope?: string;
  kind: "app" | "database" | "worker";
  name: string;
  status: Status;
  detail?: string;
  usage?: UsageMetric[];
  updatedAt?: number;
  url?: string;
};
