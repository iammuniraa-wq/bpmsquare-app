import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { isMissingSchema } from "@/lib/tender/server";
import { COMPETITOR_LIMITS, findByName, inDisplayOrder, readEvidence, type CompetitorView } from "./rules";

// Server side of the Competitors tab (migration 0229). Every query is on the service-role client and carries the workspace and the deal;
// a missing table answers `pending` instead of an error. The deal's winner lives in two older places as well (opportunity_tenders
// .winning_bidder and opportunities.competitor): everything that marks or clears a winner goes through syncDealWinner so the three
// never disagree.

/** The columns migration 0239 adds; until it is applied a read without them is the only one that works. */
export const COMPETITOR_COLS_LEGACY = "id, name, website, country, expected_price, strengths, notes, is_winner, sort, created_at";
export const COMPETITOR_COLS = `${COMPETITOR_COLS_LEGACY}, status, origin, evidence`;
export const PENDING_COMPETITORS = "Competitors need a database update (migration 0229). Ask your administrator to apply it.";
export const PENDING_RESEARCH = "Market research needs a database update (migration 0239). Ask your administrator to apply it.";
export const UUID = /^[0-9a-f-]{36}$/i;

/** A stored row as the screen gets it: rows saved before migration 0239 are the team's own, and evidence is only ever shown with an https source. */
export function toView(row: Record<string, unknown>): CompetitorView {
  const status = row.status === "proposed" || row.status === "rejected" ? row.status : "accepted";
  return { ...(row as unknown as CompetitorView), status, origin: row.origin === "research" ? "research" : "manual", evidence: readEvidence(row.evidence) };
}

type Db = { rows: CompetitorView[]; pending: boolean; researchPending: boolean };

/** Reads with the 0239 columns, and without them when they are not there yet. A table that is missing altogether is `pending`. */
async function selectRows(admin: SupabaseClient, tenantId: string, opportunityId: string): Promise<Db & { error?: string }> {
  const query = (cols: string) => admin.from("opportunity_competitors").select(cols).eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).limit(COMPETITOR_LIMITS.perDeal * 2);
  let r = await query(COMPETITOR_COLS);
  let researchPending = false;
  if (r.error && isMissingSchema(r.error)) { r = await query(COMPETITOR_COLS_LEGACY); researchPending = !r.error; }
  if (r.error) {
    if (!isMissingSchema(r.error)) console.error("Competitors read failed:", r.error.message);
    return { rows: [], pending: isMissingSchema(r.error), researchPending: false, error: r.error.message };
  }
  return { rows: ((r.data ?? []) as unknown as Record<string, unknown>[]).map(toView), pending: false, researchPending };
}

/**
 * The deal's competitors in display order. Rejected rows are left out unless `includeRejected` (the research route and the duplicate
 * checks need them: a rejected company keeps its name so it is not proposed again).
 */
export async function listCompetitors(admin: SupabaseClient, tenantId: string, opportunityId: string, opts: { includeRejected?: boolean } = {}): Promise<{ rows: CompetitorView[]; pending: boolean; researchPending: boolean }> {
  const r = await selectRows(admin, tenantId, opportunityId);
  const rows = opts.includeRejected ? r.rows : r.rows.filter((x) => x.status !== "rejected");
  return { rows: inDisplayOrder(rows), pending: r.pending, researchPending: r.researchPending };
}

/** One competitor by its id, this deal and this workspace (another workspace's id is simply not found). */
export async function loadCompetitor(admin: SupabaseClient, tenantId: string, opportunityId: string, competitorId: string): Promise<{ row: CompetitorView | null; error: { code?: string; message: string } | null; legacy: boolean }> {
  const one = (cols: string) => admin.from("opportunity_competitors").select(cols).eq("id", competitorId).eq("opportunity_id", opportunityId).eq("tenant_id", tenantId).maybeSingle();
  let r = await one(COMPETITOR_COLS);
  let legacy = false;
  if (r.error && isMissingSchema(r.error)) { r = await one(COMPETITOR_COLS_LEGACY); legacy = !r.error; }
  return { row: r.data ? toView(r.data as unknown as Record<string, unknown>) : null, error: r.error, legacy };
}

/** Writes the winner's name (or clears it) where the older screens read it. `onlyIf` clears only when the stored name is still that one. */
export async function syncDealWinner(admin: SupabaseClient, tenantId: string, opportunityId: string, name: string | null, onlyIf?: string): Promise<void> {
  const now = new Date().toISOString();
  let tender = admin.from("opportunity_tenders").update({ winning_bidder: name, updated_at: now }).eq("opportunity_id", opportunityId).eq("tenant_id", tenantId);
  if (onlyIf !== undefined) tender = tender.eq("winning_bidder", onlyIf);
  const t = await tender;
  if (t.error && !isMissingSchema(t.error)) console.error("Winning bidder sync failed:", t.error.message);
  let deal = admin.from("opportunities").update({ competitor: name, updated_at: now }).eq("id", opportunityId).eq("tenant_id", tenantId);
  if (onlyIf !== undefined) deal = deal.eq("competitor", onlyIf);
  const d = await deal;
  if (d.error) console.error("Competitor sync failed:", d.error.message);
}

/** This competitor becomes the deal's one winner: the others are cleared first (a partial unique index allows only one). */
export async function markWinner(admin: SupabaseClient, tenantId: string, opportunityId: string, competitor: { id: string; name: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = new Date().toISOString();
  const cleared = await admin.from("opportunity_competitors").update({ is_winner: false, updated_at: now })
    .eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).eq("is_winner", true).neq("id", competitor.id);
  if (cleared.error) return { ok: false, error: cleared.error.message };
  const set = await admin.from("opportunity_competitors").update({ is_winner: true, updated_at: now }).eq("id", competitor.id).eq("opportunity_id", opportunityId).eq("tenant_id", tenantId);
  if (set.error) return { ok: false, error: set.error.message };
  await syncDealWinner(admin, tenantId, opportunityId, competitor.name);
  return { ok: true };
}

/**
 * "Who won" was typed or picked (the close dialog, the Outcome section, the stage move to Lost): find the deal's competitor of that
 * name, or add it, and make it the winner. Best effort: the typed name is already saved on the deal, so a table that is not there yet,
 * a full list or a lost race only means the Competitors tab does not show it.
 */
export async function recordWinnerByName(args: {
  admin: SupabaseClient; supabase: SupabaseClient; tenantId: string; userId: string;
  opportunity: { id: string; ref: string | null; title: string }; name: string | null | undefined;
}): Promise<void> {
  const { admin, supabase, tenantId, userId, opportunity } = args;
  const name = typeof args.name === "string" ? args.name.trim().replace(/\s+/g, " ").slice(0, COMPETITOR_LIMITS.nameMax) : "";
  if (!name) return;
  try {
    const { rows, pending } = await listCompetitors(admin, tenantId, opportunity.id, { includeRejected: true });
    if (pending) return;
    let target = findByName(rows, name);
    let created = false;
    if (target?.is_winner) return;
    if (!target) {
      if (rows.filter((x) => x.status !== "rejected").length >= COMPETITOR_LIMITS.perDeal) return;
      const { data, error } = await admin.from("opportunity_competitors")
        .insert({ tenant_id: tenantId, opportunity_id: opportunity.id, name, created_by: userId, sort: rows.length })
        .select(COMPETITOR_COLS_LEGACY).maybeSingle();
      if (error) {
        if (error.code !== "23505") { console.error("Competitor insert failed:", error.message); return; }
        target = findByName((await listCompetitors(admin, tenantId, opportunity.id, { includeRejected: true })).rows, name);
        if (!target) return;
      } else {
        target = data ? toView(data as unknown as Record<string, unknown>) : null;
        created = true;
      }
    }
    if (!target) return;
    // Naming a proposed or rejected company as the winner is the person's own yes: it joins the team's list first.
    if (target.status !== "accepted") {
      const accepted = await admin.from("opportunity_competitors").update({ status: "accepted", updated_at: new Date().toISOString() }).eq("id", target.id).eq("opportunity_id", opportunity.id).eq("tenant_id", tenantId);
      if (accepted.error) { console.error("Competitor accept failed:", accepted.error.message); return; }
    }
    const marked = await markWinner(admin, tenantId, opportunity.id, target);
    if (!marked.ok) { console.error("Winner mark failed:", marked.error); return; }
    const user = await getAuthUser();
    await logChange(supabase, {
      tenantId, objectType: "opportunity_competitors", objectId: opportunity.id, objectLabel: `${opportunity.ref ?? ""} ${opportunity.title}`.trim(), action: "update",
      actorId: user?.id ?? userId, actorEmail: user?.email,
      changes: [...(created ? [{ field: "competitor added", from: null, to: name }] : []), { field: "winner", from: null, to: name }],
    });
  } catch (e) {
    console.error("Recording the winner failed:", e);
  }
}

/** Who the deal says won, from any of its three places: a stage move to Lost accepts a competitor marked as the winner as well as a typed name. */
export async function standingWinnerName(admin: SupabaseClient, tenantId: string, opportunityId: string): Promise<string | null> {
  const { data, error } = await admin.from("opportunity_competitors").select("name").eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).eq("is_winner", true).maybeSingle();
  if (error || !data) return null;
  const name = (data as { name?: unknown }).name;
  return typeof name === "string" && name ? name : null;
}
