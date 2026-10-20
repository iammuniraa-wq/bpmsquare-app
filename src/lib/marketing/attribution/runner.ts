import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantFeatures } from "@/lib/constants";
import { isSchemaPending } from "@/lib/marketing/pending";
import { recompute } from "./compute";
import { ingestTouches } from "./touches";

// The attribution cron, per workspace (docs/shells/attribution-shell.md). Tenant-rotated (least recently run
// first), time-budgeted (nothing new starts after the deadline) and idempotent (touches are unique per source event,
// results are replaced in place), so a repeated or overlapping call changes nothing the second time.
//
//   1. take this workspace's lock (a conditional update, so two overlapping calls cannot both work on it);
//   2. read new domain_event rows after the workspace's cursor and write their touches;
//   3. recompute the results from touches, deals and invoices.
// With the flag off the workspace is never read past the tenants list.

const LOCK_MS = 4.5 * 60_000;
const MAX_BATCHES = 40;

export type TenantResult = {
  tenantId: string;
  status: "ran" | "disabled" | "locked" | "pending_migration";
  read: number;
  touches: number;
  resultRows: number;
  errors: number;
};

const blank = (tenantId: string, status: TenantResult["status"]): TenantResult => ({ tenantId, status, read: 0, touches: 0, resultRows: 0, errors: 0 });

export const attributionEnabled = (f: Partial<TenantFeatures> | null | undefined): boolean => f?.marketing === true && f?.marketing_attribution === true;

async function takeLock(admin: SupabaseClient, tenantId: string, now: Date): Promise<"taken" | "busy" | "pending"> {
  const seed = await admin.from("attribution_state").upsert({ tenant_id: tenantId }, { onConflict: "tenant_id", ignoreDuplicates: true });
  if (seed.error) return isSchemaPending(seed.error) ? "pending" : "busy";
  const { data, error } = await admin.from("attribution_state")
    .update({ locked_until: new Date(now.getTime() + LOCK_MS).toISOString(), last_run_at: now.toISOString() })
    .eq("tenant_id", tenantId).lt("locked_until", now.toISOString()).select("tenant_id");
  if (error) return isSchemaPending(error) ? "pending" : "busy";
  return Array.isArray(data) && data.length > 0 ? "taken" : "busy";
}

export async function runTenant(admin: SupabaseClient, tenantId: string, deps: { now?: () => Date; deadline?: number } = {}): Promise<TenantResult> {
  const now = deps.now ?? (() => new Date());
  const { data: t } = await admin.from("tenants").select("features").eq("id", tenantId).maybeSingle();
  if (!t || !attributionEnabled((t as { features: Partial<TenantFeatures> | null }).features)) return blank(tenantId, "disabled");

  const lock = await takeLock(admin, tenantId, now());
  if (lock === "pending") return blank(tenantId, "pending_migration");
  if (lock === "busy") return blank(tenantId, "locked");

  const res = blank(tenantId, "ran");
  let failure: string | null = null;
  try {
    const { data: st } = await admin.from("attribution_state").select("last_created_at, last_event_id, touches_total").eq("tenant_id", tenantId).maybeSingle();
    const state = st as { last_created_at: string | null; last_event_id: string | null; touches_total: number | null } | null;
    let cursor = state?.last_created_at ? { created_at: state.last_created_at, id: state.last_event_id ?? "" } : null;
    let total = state?.touches_total ?? 0;

    for (let i = 0; i < MAX_BATCHES; i++) {
      if (deps.deadline && Date.now() > deps.deadline) break;
      const r = await ingestTouches(admin, tenantId, cursor);
      if (r.missing) { res.status = "pending_migration"; return res; }
      res.read += r.read;
      res.touches += r.written;
      total += r.written;
      if (r.last) {
        cursor = r.last;
        await admin.from("attribution_state").update({ last_created_at: r.last.created_at, last_event_id: r.last.id, touches_total: total, updated_at: now().toISOString() }).eq("tenant_id", tenantId);
      }
      if (r.done) break;
    }

    if (!deps.deadline || Date.now() <= deps.deadline) {
      const c = await recompute(admin, tenantId, now());
      if (c.missing) { res.status = "pending_migration"; return res; }
      res.resultRows = c.rows;
    }
  } catch (e) {
    failure = (e as { message?: string })?.message?.slice(0, 300) ?? "failed";
    res.errors++;
    console.error(`[attribution] run failed for ${tenantId}`, e);
  } finally {
    await admin.from("attribution_state").update({ locked_until: new Date(0).toISOString(), last_error: failure }).eq("tenant_id", tenantId);
  }
  return res;
}

/** Which workspaces to look at, least recently run first, so a large fleet is covered round-robin. */
export async function tenantsToRun(admin: SupabaseClient): Promise<string[]> {
  const { data, error } = await admin.from("tenants").select("id, features").contains("features", { marketing: true, marketing_attribution: true });
  if (error) return [];
  const ids = ((data ?? []) as { id: string }[]).map((t) => t.id);
  const { data: states } = await admin.from("attribution_state").select("tenant_id, last_run_at");
  const lastRun = new Map(((states ?? []) as { tenant_id: string; last_run_at: string | null }[]).map((l) => [l.tenant_id, l.last_run_at ?? ""]));
  return ids.sort((a, b) => (lastRun.get(a) ?? "").localeCompare(lastRun.get(b) ?? ""));
}
