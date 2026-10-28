import type { Account, Item, Platform } from "../types";
import { cloudflare } from "./cloudflare";
import { neon } from "./neon";
import { railway } from "./railway";
import { supabase } from "./supabase";
import { vercel } from "./vercel";

// Para sumar otra plataforma: crea su conector y regístralo aquí.
const CONNECTORS: Record<Platform, (a: Account) => Promise<Item[]>> = {
  vercel,
  railway,
  supabase,
  neon,
  cloudflare,
};

export type CollectError = { platform: Platform; account: string; message: string };

export async function collect() {
  let accounts: Account[] = [];
  let configError: string | null = null;

  const raw = process.env.ACCOUNTS_JSON;
  if (!raw) {
    configError = "Falta la variable de entorno ACCOUNTS_JSON.";
  } else {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("not an array");
      accounts = parsed.filter((a) => String(a?.platform) in CONNECTORS && a?.token && a?.label);
      if (!accounts.length) configError = "ACCOUNTS_JSON no tiene cuentas válidas (platform, label y token).";
    } catch {
      configError = "ACCOUNTS_JSON no es un JSON válido. Debe ser una lista de cuentas.";
    }
  }

  const results = await Promise.allSettled(accounts.map((a) => CONNECTORS[a.platform](a)));

  const items: Item[] = [];
  const errors: CollectError[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") items.push(...r.value);
    else
      errors.push({
        platform: accounts[i].platform,
        account: accounts[i].label,
        message: r.reason instanceof Error ? r.reason.message : "Error desconocido",
      });
  });

  return { items, errors, configError, accountCount: accounts.length };
}
