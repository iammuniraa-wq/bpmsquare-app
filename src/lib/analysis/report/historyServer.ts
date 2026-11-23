import "server-only";
import { loadInSystemRaw, ACCOUNT_COLUMNS, type AccountRow } from "../loadLive";
import { analysisAccess, type AnalysisAccess } from "../service";
import { buildBriefHistory, type BriefHistory } from "./history";
import { resolveReportSubject, type ReportInput } from "./service";

// The server half of "Your history with them": the workspace's own rows, read for the person who is looking, through their own
// permissions, with the workspace in every filter (loadInSystemRaw). Nothing here touches the web or the brief cache, and nothing
// it returns is ever written anywhere: it is drawn on the card and gone.

export type HistoryResult = { ok: true; history: BriefHistory } | { ok: false; status: 400 | 403 | 404 | 429 | 502; error: string };

export async function loadBriefHistory(a: AnalysisAccess, input: ReportInput, now: Date = new Date()): Promise<HistoryResult> {
  const gate = analysisAccess(a);
  if (!gate.ok) return { ok: false, status: gate.status, error: gate.error };
  const resolved = await resolveReportSubject(a, input);
  if (!resolved.ok) return { ok: false, status: resolved.status, error: resolved.error };

  let account: AccountRow | null = null;
  if (resolved.account) {
    const { data } = await a.supabase.from("accounts").select(ACCOUNT_COLUMNS).eq("id", resolved.account.id).eq("tenant_id", a.tenantId).maybeSingle();
    account = (data as AccountRow | null) ?? null;
  }
  const raw = await loadInSystemRaw(
    { admin: a.admin, tenantId: a.tenantId, perms: a.perms, features: a.features, config: a.config, now },
    account, resolved.subject,
  );
  return { ok: true, history: buildBriefHistory(raw) };
}
