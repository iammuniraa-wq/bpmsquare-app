"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import type { BriefHistory } from "@/lib/analysis/report/history";
import { postBriefSave } from "@/lib/analysis/report/clientSave";
import { askDockForBrief } from "@/lib/analysis/dockAsk";
import type { DockReport } from "@/lib/assistant/reportTool";
import ReportCardView from "./ReportCardView";

// The account's "Company brief" tab (docs/design/company-brief-sales.md section 7). The same component the dock draws, read from the
// workspace's saved brief: opening the tab costs nothing and searches nothing. "Your history with them" is read live beside it and
// is never part of the brief. Making, refreshing or retrying a brief asks the assistant, which owns the consent chip, the progress
// and the limits; when it finishes, this tab reads the saved brief again.

type Loaded = { brief: DockReport | null; history: BriefHistory | null };

export const BRIEF_UPDATED_EVENT = "bpm:brief-updated";

export default function CompanyBriefTab({ accountId, accountName }: { accountId: string; accountName: string }) {
  const router = useRouter();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/ai/report/brief?account_id=${encodeURIComponent(accountId)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(typeof json.error === "string" ? json.error : "The brief could not be read just now."); return; }
      setError(null);
      setData({ brief: json.brief ?? null, history: json.history ?? null });
    } catch {
      setError("The brief could not be read just now.");
    }
  }, [accountId]);

  useEffect(() => {
    void load();
    const on = () => { void load(); };
    window.addEventListener(BRIEF_UPDATED_EVENT, on);
    return () => window.removeEventListener(BRIEF_UPDATED_EVENT, on);
  }, [load]);

  if (error) return <div role="alert" style={{ color: c.muted, fontSize: 13 }}>{error}</div>;
  if (!data) return <div role="status" style={{ color: c.hint, fontSize: 13 }}>Loading the saved brief…</div>;

  if (!data.brief) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }} data-guide="brief.empty">
        <div style={{ color: c.muted, fontSize: 13 }}>{`No brief for ${accountName} yet.`}</div>
        <button type="button" className="bms-dock-chip" onClick={() => askDockForBrief(accountName, accountId)} data-guide="brief.make"
          style={{ background: "var(--accentbg)", border: "1px solid var(--line)", borderRadius: 999, padding: "6px 14px", fontSize: 12, fontWeight: 650, color: c.accent, cursor: "pointer", fontFamily: "inherit", minHeight: 44, minWidth: 44 }}>
          Make a brief
        </button>
      </div>
    );
  }

  const brief = data.brief;
  return (
    <ReportCardView
      data={brief} history={data.history}
      onRefresh={() => askDockForBrief(accountName, accountId, { refresh: true })}
      onRetry={() => askDockForBrief(accountName, accountId, { retry: true })}
      onSave={(t) => postBriefSave(brief.key, t)}
      onOpen={(href) => router.push(href)}
    />
  );
}
