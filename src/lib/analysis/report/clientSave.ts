import type { ReportSaveTarget } from "@/lib/assistant/reportTool";

// The Save button's request, shared by the dock card and the account tab. Nothing about the brief is sent: `key` only names which
// saved brief (a company key inside the person's own workspace), the record is named by id, and the server reads the brief back
// from the cache and checks the record and the person's rights again.

export async function postBriefSave(key: string, t: ReportSaveTarget): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch("/api/ai/report/save", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: t.kind, id: t.id, competitor_id: t.competitorId, key }),
    });
    const json = await res.json().catch(() => ({}));
    return res.ok
      ? { ok: true, message: typeof json.message === "string" ? json.message : "Saved." }
      : { ok: false, message: typeof json.error === "string" ? json.error : "Could not save just now." };
  } catch {
    return { ok: false, message: "Could not save just now." };
  }
}
