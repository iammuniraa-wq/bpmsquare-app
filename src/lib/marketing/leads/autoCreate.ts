import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emitEvent } from "@/lib/events/emit";
import { EVENTS } from "@/lib/events/catalog";
import { isSchemaPending } from "../pending";
import { computeLeadScore, type ScoringRubric } from "../scoring";
import { loadLeadEvents, loadLeadProfile, scoreLead, type ScorerDeps } from "./scorer";

// Leads that appear by themselves (docs/shells/leads-shell.md, hand-over). When a person with no open lead
// has done enough to count as Engaged, the scoring run makes the lead; from there it is the same lead as any
// other: it is scored, moves to Ready for sales when it earns it, is handed to a salesperson through
// Coverage, and has a response time.
//
// Only the scheduled scoring run calls this, never a request, and only for a workspace that switched
// config.marketing.lifecycle.auto_create_leads on. Idempotent: a person with an open lead gets nothing, and
// migration 0198's unique index stops two overlapping runs both making one.

/** A lead is closed once it is won, converted to a deal, or lost (Not now and Not a fit both read as lost). */
const CLOSED = ["won", "converted", "lost"];
const MAX_PER_RUN = 25;
const IN_CHUNK = 100;

export type AutoCreateResult = { considered: number; created: number; moved_to_ready: number; pending_migration: boolean };

type ContactRow = { id: string; account_id: string; name: string | null };

const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/**
 * `contactIds` are the people who did something since the last run (the caller already read the event stream).
 * Every query below names the workspace, and a contact id that is not this workspace's simply is not found.
 */
export async function autoCreateLeads(
  admin: SupabaseClient,
  tenantId: string,
  contactIds: string[],
  opts: { now: Date; rubric: ScoringRubric; deps?: ScorerDeps; max?: number },
): Promise<AutoCreateResult> {
  const out: AutoCreateResult = { considered: 0, created: 0, moved_to_ready: 0, pending_migration: false };
  const max = opts.max ?? MAX_PER_RUN;
  const unique = [...new Set(contactIds)];
  if (unique.length === 0) return out;

  // Who already has an open lead? Those are done.
  const hasOpen = new Set<string>();
  for (const part of chunks(unique, IN_CHUNK)) {
    const { data, error } = await admin.from("leads").select("contact_id, status").eq("tenant_id", tenantId).in("contact_id", part);
    if (error) {
      if (!isSchemaPending(error)) console.error(`[leads] auto-create could not read leads: ${error.message}`);
      return out;
    }
    for (const r of (data ?? []) as { contact_id: string | null; status: string | null }[]) {
      if (r.contact_id && !CLOSED.includes(r.status ?? "new")) hasOpen.add(r.contact_id);
    }
  }
  const candidates = unique.filter((id) => !hasOpen.has(id));
  if (candidates.length === 0) return out;

  const contacts: ContactRow[] = [];
  for (const part of chunks(candidates, IN_CHUNK)) {
    const { data } = await admin.from("contacts").select("id, account_id, name").eq("tenant_id", tenantId).in("id", part);
    contacts.push(...((data ?? []) as ContactRow[]));
  }

  for (const c of contacts) {
    if (out.created >= max) break;
    out.considered++;
    try {
      const events = await loadLeadEvents(admin, tenantId, { account_id: c.account_id, contact_id: c.id }, opts.rubric, opts.now);
      const profile = await loadLeadProfile(admin, tenantId, { account_id: c.account_id, contact_id: c.id }, opts.rubric, opts.deps);
      const result = computeLeadScore(opts.rubric, events, profile, null, opts.now);
      if (result.stage === "new") continue;

      const name = (c.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
      const now = opts.now.toISOString();
      const ins = await admin.from("leads").insert({
        tenant_id: tenantId, account_id: c.account_id, contact_id: c.id,
        title: name ? `Interest from ${name}` : "Interest from a contact",
        source: "inbound", status: "new", last_activity_at: now,
      }).select("id").single();
      if (ins.error) {
        // 23505: another run made it a moment ago (0198's unique index). 23514 / 42703: 0198 is not applied yet.
        if (ins.error.code === "23505") continue;
        if (ins.error.code === "23514" || isSchemaPending(ins.error)) { out.pending_migration = true; break; }
        console.error(`[leads] auto-create failed: ${ins.error.message}`);
        continue;
      }
      const leadId = (ins.data as { id: string }).id;
      out.created++;
      await emitEvent(tenantId, {
        name: EVENTS.LEAD_CREATED, object_type: "lead", object_id: leadId, source: "runner",
        contact_id: c.id, account_id: c.account_id, lead_id: leadId, key: leadId, payload: { source: "inbound", via: "auto" },
      }, admin);
      // Score it now, so it carries its number and, if it has already earned it, moves up and is handed over.
      const scored = await scoreLead(admin, tenantId, leadId, { now: opts.now, rubric: opts.rubric, deps: opts.deps });
      if (scored.ok && scored.moved_to === "ready") out.moved_to_ready++;
    } catch (e) {
      console.error("[leads] auto-create failed for one contact", e);
    }
  }
  return out;
}
