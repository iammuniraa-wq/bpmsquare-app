import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NOVA_OBJECTS, novaTypeAllowed } from "@/lib/novaAccess";
import type { PermissionSet } from "@/lib/permissions";
import type { TenantFeatures } from "@/lib/constants";
import { isMissingSchema } from "@/lib/tender/server";
import { PENDING_RESEARCH, loadCompetitor } from "@/lib/tender/competitors/server";
import type { CompetitorEvidence, SourcedFact } from "@/lib/tender/competitors/rules";
import { readReport } from "./cache";
import { formatEmployees, formatMoney, formatPercent, growthOf, latest, marginOf } from "./figures";
import { OWNERSHIP_LABEL, REPORT_BLOCK_LABEL, REPORT_PART_LABEL, ROLE_FUNCTION_LABEL, type CompanyReport, type ReportItem } from "./types";

// Saving a report: "Save" writes nothing new of its own. The report is already in the cache; saving posts a readable copy
// on the record's timeline (the Nova comment thread, written with the service role after the same module and workcenter
// checks the comments route makes), or, for a competitor of a tender deal, puts the sourced facts in that competitor's
// evidence. The content is always read back from the workspace's own cache by company key, never taken from the request.

export type SaveKind = "account" | "lead" | "deal";
const COMMENT_TYPE: Record<SaveKind, string> = { account: "accounts", lead: "leads", deal: "opportunities" };

export type SaveFail = { ok: false; status: 400 | 403 | 404 | 500 | 503; error: string };

/** Whether this person may post a comment on this kind of record, with the features and grants already in hand. */
export function commentAllowed(features: Partial<TenantFeatures> | null | undefined, perms: PermissionSet, kind: SaveKind): boolean {
  return (features?.next_experience === true || features?.spectacular_theme === true) && novaTypeAllowed(features, perms, COMMENT_TYPE[kind]);
}

const MAX_COMMENT = 4000;

const dateText = (on?: string): string => (on ? ` (${on})` : "");

/**
 * The brief as a plain-text comment on the timeline: the tiles, Why now, Who to talk to, Where we fit (labelled as the
 * assistant's reading), Performance, Watch-outs, then the numbered sources. Never "Your history": that is read live for the
 * person who opens the card and is not part of the brief. Limited to MAX_COMMENT characters; the body is shortened before the sources are.
 */
export function reportToComment(r: CompanyReport): string {
  const ref = (n: number) => `[${n}]`;
  const out: string[] = [`Company brief: ${r.name}${r.country ? ` (${r.country})` : ""}`, "From public web pages, written by the AI assistant and saved by a person. Check before relying on it."];
  const tiles: string[] = [];
  if (r.oneLiner) tiles.push(`${r.oneLiner.text} ${ref(r.oneLiner.src)}`);
  const rev = latest(r.money.revenue);
  if (rev) tiles.push(`Revenue FY${rev.fiscalYear}: ${formatMoney(rev.amount, rev.currency)}${rev.matched ? "" : " (not confirmed on the cited page, check)"} ${ref(rev.src)}`);
  const profit = latest(r.money.profit);
  if (profit) tiles.push(`Net profit FY${profit.fiscalYear}: ${formatMoney(profit.amount, profit.currency)}${profit.matched ? "" : " (not confirmed on the cited page, check)"} ${ref(profit.src)}`);
  const g = growthOf(r.money.revenue);
  if (g) tiles.push(`Growth vs FY${g.previous.fiscalYear}: ${formatPercent(g.percent, true)}, calculated from ${[...new Set([g.current.src, g.previous.src])].map(ref).join(" and ")}`);
  const mg = marginOf(r.money);
  if (mg) tiles.push(`Margin FY${mg.fiscalYear}: ${formatPercent(mg.percent)}, calculated from ${[...new Set([mg.profit.src, mg.revenue.src])].map(ref).join(" and ")}`);
  if (r.money.status === "not_published") tiles.push("Revenue and profit: not published");
  if (r.facts.employees) tiles.push(`Employees: ${formatEmployees(r.facts.employees)} ${ref(r.facts.employees.src)}`);
  if (r.facts.hq) tiles.push(`Head office: ${r.facts.hq.value} ${ref(r.facts.hq.src)}`);
  if (r.facts.ownership) tiles.push(`Ownership: ${OWNERSHIP_LABEL[r.facts.ownership.value.kind]}${r.facts.ownership.value.detail ? `, ${r.facts.ownership.value.detail}` : ""} ${ref(r.facts.ownership.src)}`);
  for (const p of r.money.proxies) tiles.push(`Found instead (not turnover): ${p.text} ${ref(p.src)}`);
  if (tiles.length) out.push("", ...tiles);
  if (r.signals.length) {
    out.push("", REPORT_BLOCK_LABEL.why_now);
    for (const s of r.signals) out.push(`- ${s.text}${dateText(s.on)} ${ref(s.src)}${s.why ? ` Why it matters (the assistant's reading): ${s.why}` : ""}`);
  }
  if (r.roles.length) {
    out.push("", REPORT_BLOCK_LABEL.who);
    for (const x of r.roles) {
      const names = x.named.map((p) => `${p.name}, ${p.title} ${ref(p.src)}`).join("; ");
      out.push(`- ${ROLE_FUNCTION_LABEL[x.fn]}: ${names || "no name published"}${x.talkAbout ? ` Talk about (the assistant's reading): ${x.talkAbout}` : ""}`);
    }
  }
  if (r.fit) {
    out.push("", `${REPORT_BLOCK_LABEL.fit} (the assistant's own reading, not from a source)`);
    if (r.fit.angle) out.push(`Opening angle: ${r.fit.angle}`);
    for (const p of r.fit.priorities) out.push(`- ${p.offering}: ${p.why}`);
    for (const q of r.fit.questions) out.push(`? ${q}`);
  }
  if (r.compete.length) {
    out.push("", "How they compete with us (the assistant's own inference, not from a source)");
    for (const c of r.compete) out.push(`- ${c.offering}: ${c.text}`);
  }
  const perf: string[] = [];
  for (const m of r.money.revenue) perf.push(`Revenue FY${m.fiscalYear}: ${formatMoney(m.amount, m.currency)} ${ref(m.src)}`);
  for (const m of r.money.profit) perf.push(`Net profit FY${m.fiscalYear}: ${formatMoney(m.amount, m.currency)} ${ref(m.src)}`);
  const items = (label: string, rows: ReportItem[]) => { for (const i of rows) perf.push(`${label}${i.text}${dateText(i.on)} ${ref(i.src)}`); };
  items("", r.performance.market); items("", r.performance.highlights); items("Tailwind: ", r.performance.tailwinds); items("Headwind: ", r.performance.headwinds);
  if (perf.length) out.push("", REPORT_BLOCK_LABEL.performance, ...perf.map((x) => `- ${x}`));
  if (r.watchouts.length) {
    out.push("", REPORT_BLOCK_LABEL.watchouts);
    for (const w of r.watchouts) out.push(`- ${w.text}${dateText(w.on)} ${ref(w.src)}`);
  }
  if (r.missing.length) out.push("", `Not researched: ${r.missing.map((p) => REPORT_PART_LABEL[p]).join(", ")}.`);
  const head = out.join("\n");
  const tail = ["", "Sources", ...r.sources.map((s) => `${ref(s.n)} ${s.title} ${s.url}`)].join("\n");
  if (head.length + tail.length <= MAX_COMMENT) return `${head}\n${tail}`;
  // Too long for one comment: keep the sources whole (they are the point) and shorten the body, saying so.
  const room = Math.max(400, MAX_COMMENT - tail.length - 40);
  return `${head.slice(0, room).trimEnd()}\n(shortened)\n${tail}`.slice(0, MAX_COMMENT);
}

export type CommentSaveCtx = {
  admin: SupabaseClient;
  tenantId: string;
  userId: string;
  email: string | null;
  features: Partial<TenantFeatures>;
  perms: PermissionSet;
};

/** The report for this company key, from this workspace's cache, or a plain failure. */
async function loadReport(admin: SupabaseClient, tenantId: string, key: string): Promise<{ ok: true; report: CompanyReport } | SaveFail> {
  const { row } = await readReport(admin, tenantId, key);
  if (row?.legacy && !row.report) return { ok: false, status: 404, error: "That report is in an older format. Refresh it to get the new brief, then save it." };
  return row?.report ? { ok: true, report: row.report } : { ok: false, status: 404, error: "That report is no longer saved. Run it again, then save it." };
}

export async function saveReportComment(c: CommentSaveCtx, kind: SaveKind, recordId: string, key: string): Promise<{ ok: true; message: string } | SaveFail> {
  // 404, not 403, so a member without the module or workcenter grant cannot tell that a record exists.
  if (!commentAllowed(c.features, c.perms, kind)) return { ok: false, status: 404, error: "Record not found" };
  const type = COMMENT_TYPE[kind];
  const def = NOVA_OBJECTS[type];
  const { data: found } = await c.admin.from(def.table).select("id").eq("id", recordId).eq("tenant_id", c.tenantId).maybeSingle();
  if (!found) return { ok: false, status: 404, error: "Record not found" };
  const loaded = await loadReport(c.admin, c.tenantId, key);
  if (!loaded.ok) return loaded;
  const { error } = await c.admin.from("record_comments").insert({
    tenant_id: c.tenantId, object_type: type, object_id: recordId, author_id: c.userId, author_email: c.email,
    body: reportToComment(loaded.report), mentions: [],
  });
  if (error) return { ok: false, status: 500, error: "Could not save the report to the timeline just now." };
  return { ok: true, message: `Saved to the ${kind === "deal" ? "deal" : kind}'s timeline.` };
}

const SIGNAL_FACT: Record<string, SourcedFact["kind"]> = { award: "award", tender: "tender", expansion: "project", plant: "project" };
const MAX_FACTS = 12;

/** The brief's sourced statements as a competitor's evidence. Only statements with an https page are kept (every statement has one). */
export function reportToEvidence(r: CompanyReport, previous: CompetitorEvidence | null): CompetitorEvidence {
  const facts: SourcedFact[] = [];
  const push = (text: string, kind: SourcedFact["kind"], src: number, on?: string) => {
    const s = r.sources.find((x) => x.n === src);
    if (!s || facts.length >= MAX_FACTS) return;
    facts.push({ text: text.slice(0, 400), kind, source_url: s.url, source_title: s.title || null, published_on: on && /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : null });
  };
  if (r.oneLiner) push(r.oneLiner.text, "profile", r.oneLiner.src);
  for (const s of r.signals) push(s.text, SIGNAL_FACT[s.kind] ?? "other", s.src, s.on);
  for (const i of r.profile.projects) push(i.text, "project", i.src, i.on);
  for (const i of r.profile.clients) push(i.text, "project", i.src, i.on);
  for (const i of [...r.performance.tailwinds, ...r.performance.highlights, ...r.performance.market]) push(i.text, "strength", i.src, i.on);
  for (const i of r.profile.what) push(i.text, "profile", i.src, i.on);
  return { v: 1, facts, price: previous?.price ?? null, wins: previous?.wins ?? null, researched_at: r.generatedAt, model: "company_report" };
}

export type CompetitorSaveCtx = { admin: SupabaseClient; tenantId: string };

/** The deal and the caller's edit right on the Pipeline were already checked by openTenderDealRequest; this checks the competitor is this deal's. */
export async function saveReportCompetitor(c: CompetitorSaveCtx, dealId: string, competitorId: string, key: string): Promise<{ ok: true; message: string } | SaveFail> {
  const { row, error, legacy } = await loadCompetitor(c.admin, c.tenantId, dealId, competitorId);
  if (error) return isMissingSchema(error) ? { ok: false, status: 503, error: "Competitors need a database update. Ask your administrator to apply it." } : { ok: false, status: 500, error: "The competitor could not be read just now." };
  if (!row || row.status === "rejected") return { ok: false, status: 404, error: "Competitor not found" };
  if (legacy) return { ok: false, status: 503, error: PENDING_RESEARCH };
  const loaded = await loadReport(c.admin, c.tenantId, key);
  if (!loaded.ok) return loaded;
  const { error: upErr } = await c.admin.from("opportunity_competitors")
    .update({ evidence: reportToEvidence(loaded.report, row.evidence), updated_at: new Date().toISOString() })
    .eq("id", competitorId).eq("opportunity_id", dealId).eq("tenant_id", c.tenantId);
  if (upErr) return isMissingSchema(upErr) ? { ok: false, status: 503, error: PENDING_RESEARCH } : { ok: false, status: 500, error: "The competitor could not be updated just now." };
  return { ok: true, message: "Saved to the competitor's evidence." };
}
