import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NOVA_OBJECTS, novaTypeAllowed } from "@/lib/novaAccess";
import type { PermissionSet } from "@/lib/permissions";
import type { TenantFeatures } from "@/lib/constants";
import { isMissingSchema } from "@/lib/tender/server";
import { PENDING_RESEARCH, loadCompetitor } from "@/lib/tender/competitors/server";
import type { CompetitorEvidence, SourcedFact } from "@/lib/tender/competitors/rules";
import { readReport } from "./cache";
import { REPORT_SECTION_LABEL, type CompanyReport, type ReportItem, type ReportSectionId } from "./types";

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

/** The report as a plain-text comment: sections with their statements, then the numbered sources. Limited to MAX_COMMENT characters. */
export function reportToComment(r: CompanyReport): string {
  const out: string[] = [`Company report: ${r.name}${r.country ? ` (${r.country})` : ""}`, "From public web pages, written by the AI assistant and saved by a person. Check before relying on it."];
  const ref = (n: number) => `[${n}]`;
  const items = (id: Exclude<ReportSectionId, "leadership" | "compete">) => {
    const rows = r[id] as ReportItem[];
    if (!rows.length) return;
    out.push("", REPORT_SECTION_LABEL[id]);
    for (const i of rows) out.push(`- ${i.text}${dateText(i.on)} ${ref(i.src)}`);
  };
  items("overview"); items("products"); items("size");
  if (r.leadership.length) {
    out.push("", REPORT_SECTION_LABEL.leadership);
    for (const l of r.leadership) out.push(`- ${l.name}, ${l.title} ${ref(l.src)}`);
  }
  items("news"); items("projects"); items("strengths"); items("weaknesses");
  if (r.compete.length) {
    out.push("", `${REPORT_SECTION_LABEL.compete} (the assistant's own inference, not from a source)`);
    for (const c of r.compete) out.push(`- ${c.offering}: ${c.text}`);
  }
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
  return row ? { ok: true, report: row.report } : { ok: false, status: 404, error: "That report is no longer saved. Run it again, then save it." };
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

const FACT_KIND: Record<string, SourcedFact["kind"]> = { award: "award", tender: "tender", project: "project", client: "project" };
const MAX_FACTS = 12;

/** The report's sourced statements as a competitor's evidence. Only statements with an https page are kept (every statement has one). */
export function reportToEvidence(r: CompanyReport, previous: CompetitorEvidence | null): CompetitorEvidence {
  const facts: SourcedFact[] = [];
  const add = (rows: ReportItem[], kind: (i: ReportItem) => SourcedFact["kind"]) => {
    for (const i of rows) {
      const s = r.sources.find((x) => x.n === i.src);
      if (!s || facts.length >= MAX_FACTS) continue;
      facts.push({
        text: i.text.slice(0, 400), kind: kind(i), source_url: s.url, source_title: s.title || null,
        published_on: i.on && /^\d{4}-\d{2}-\d{2}$/.test(i.on) ? i.on : null,
      });
    }
  };
  add(r.overview.slice(0, 1), () => "profile");
  add(r.projects, (i) => FACT_KIND[i.kind ?? "project"] ?? "project");
  add(r.strengths, () => "strength");
  add(r.products, () => "profile");
  add(r.news, () => "other");
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
