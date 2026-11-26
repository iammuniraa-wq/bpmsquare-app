import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PermissionSet } from "@/lib/permissions";
import { formatMoney, type CurrencyDef } from "@/lib/currency";
import { dateKeyIn } from "@/lib/tenantClock";
import { DEFAULT_WFM_CONFIG, type TenantConfig } from "@/lib/constants";
import type { PriceAccess } from "./tools";

/** What a price tool needs from the ask that is running it: the caller's own session, their rights, and a metered model client. */
export type PriceEnv = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string | null;
  isAdmin: boolean;
  perms: PermissionSet;
  features: Record<string, boolean | undefined>;
  access: PriceAccess;
  currency: CurrencyDef;
  now: Date;
  /** The meter's wrapped client: every call through it is checked against the allowance first and logged after. */
  client: Pick<Anthropic, "messages"> | null;
  allowed: () => boolean;
  /** The deal the person has open, found by the server from the route (never sent by the client). */
  openDealId?: string | null;
  newId?: () => string;
};

/** Today as the workspace counts it (its own timezone, the one Workforce keeps), not the server's. */
export function dayFor(config: unknown, now: Date): string {
  const tz = (config as TenantConfig | null | undefined)?.wfm?.timezone;
  return dateKeyIn(typeof tz === "string" && tz ? tz : DEFAULT_WFM_CONFIG.timezone, now);
}

export const moneyOf = (cur: CurrencyDef): ((n: number) => string) =>
  (n) => formatMoney(n, cur, { minimumFractionDigits: cur.decimals, maximumFractionDigits: cur.decimals });

export const currencyView = (cur: CurrencyDef): { symbol: string; locale: string; decimals: number } => ({ symbol: cur.symbol, locale: cur.locale, decimals: cur.decimals });
