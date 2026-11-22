import "server-only";
import { createAdminSupabase } from "@/lib/supabase-server";

// One assistant_actions row per report run, refusal or save (migration 0205). A pending migration or a failed insert never
// stops the report: the audit is a record of what happened, not a gate.

export type ReportAuditKind = "research_company_report" | "report_save";

export type ReportAudit = {
  kind: ReportAuditKind;
  tenantId: string; userId: string; route: string | null;
  params: Record<string, unknown>;
  status: "done" | "refused" | "failed";
  reason?: string;
  sources: { title: string; url: string }[];
  result: Record<string, unknown>;
};

function isMissing(err: { code?: string; message?: string } | null | undefined): boolean {
  return !!err && (err.code === "42P01" || err.code === "42703" || err.code === "PGRST205" || err.code === "PGRST204"
    || /does not exist|Could not find the table|schema cache/i.test(err.message ?? ""));
}

export async function recordReportAudit(a: ReportAudit): Promise<void> {
  try {
    const { error } = await createAdminSupabase().from("assistant_actions").insert({
      tenant_id: a.tenantId, user_id: a.userId, kind: a.kind, action_key: a.kind, route: a.route,
      params: a.params, status: a.status, result: { reason: a.reason ?? null, ...a.result }, sources: a.sources, tokens: 0,
    });
    if (error && !isMissing(error)) console.error("assistant_actions insert failed:", error.message);
  } catch (e) {
    console.error("assistant_actions insert failed:", e);
  }
}
