"use client";

import { useCallback, useEffect, useState } from "react";
import { c } from "@/lib/theme";
import Card from "@/components/ui/Card";
import InfoTip from "@/components/ui/InfoTip";
import { CHECK_TIPS } from "@/lib/suppliers/check/tips";
import { VERDICT_LABEL, type CheckHistoryItem, type SupplierCheckResult } from "@/lib/suppliers/check/types";
import type { DockSupplierCheck } from "@/lib/assistant/supplierCheck/tool";
import SupplierCheckView, { CHECK_CSS } from "./SupplierCheckView";

// The Supplier check card. On the supplier's own page it reads the newest saved check and runs a new one (which saves). In the dock it
// is seeded with the assistant's records-only check: web research is a question on the card (Yes, then the result replaces the card),
// and saving is a button, because the assistant never writes on its own. Either way the question "Research on the web?" comes first and
// the answer is a signed, single-use consent from the server; nothing is searched on a No.

type Web = { available: boolean; searches: number; consent: { id: string; token: string } | null };
type Loaded = {
  latest: SupplierCheckResult | null; history: CheckHistoryItem[]; pending: boolean; pendingMessage: string | null; canRun: boolean; web: Web;
};

const btn: React.CSSProperties = { padding: "7px 14px", borderRadius: 7, fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", fontFamily: "inherit" };
const primary: React.CSSProperties = { ...btn, background: c.accent, color: "#fff" };
const ghost: React.CSSProperties = { ...btn, background: c.panel, color: c.ink, border: `1px solid ${c.line}` };

const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default function SupplierCheckPanel({ supplierId, seed }: { supplierId: string; seed?: DockSupplierCheck }) {
  const dock = !!seed;
  const [data, setData] = useState<Loaded | null>(null);
  const [shown, setShown] = useState<SupplierCheckResult | null>(seed?.result ?? null);
  const [saveToken, setSaveToken] = useState<string | null>(seed?.saveToken ?? null);
  const [web, setWeb] = useState<Web | null>(seed?.web ? { available: true, searches: seed.web.searches, consent: seed.web.consent } : null);
  const [saved, setSaved] = useState(false);
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(seed?.notice ?? null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/suppliers/${supplierId}/check`, { cache: "no-store" });
      if (!r.ok) { setError("The supplier check could not be loaded."); setData({ latest: null, history: [], pending: false, pendingMessage: null, canRun: false, web: { available: false, searches: 0, consent: null } }); return; }
      const j = (await r.json()) as Loaded;
      setData(j); setWeb(j.web);
      if (!dock) setShown(j.latest);
    } catch {
      setError("The supplier check could not be loaded.");
    }
  }, [supplierId, dock]);
  useEffect(() => { if (!dock) void load(); }, [dock, load]);

  const run = async (withWeb: boolean) => {
    setBusy(true); setError(null); setNotice(null); setAsk(false); setSaved(false);
    try {
      const r = await fetch(`/api/suppliers/${supplierId}/check`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ web: withWeb, consent_token: withWeb ? web?.consent?.token : undefined, save: dock ? false : undefined }),
      });
      const j = (await r.json().catch(() => ({}))) as { result?: SupplierCheckResult; notice?: string | null; saved?: boolean; pending?: boolean; saveError?: string; saveToken?: string | null; error?: string };
      if (!r.ok || !j.result) { setError(j.error ?? "The check could not run."); return; }
      setShown(j.result); setNotice(j.notice ?? null);
      if (dock) { setSaveToken(j.saveToken ?? null); setWeb(null); }
      else {
        setSaved(j.saved === true);
        if (j.saved !== true) setError(j.saveError ?? "The check ran but could not be saved.");
        await load();
      }
    } catch {
      setError("The check could not run.");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!shown || !saveToken) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/suppliers/${supplierId}/check/save`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ result: shown, token: saveToken }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) setError(j.error ?? "The check could not be saved."); else { setSaved(true); setSaveToken(null); }
    } catch {
      setError("The check could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const canRun = dock ? true : data?.canRun === true;
  const pending = !dock && data?.pending === true;
  const onRun = () => { if (web?.consent && !dock) setAsk(true); else void run(false); };

  const actions = (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {!dock && canRun && !pending && <button type="button" className="sc-btn" data-guide="supplier.check.run" disabled={busy || ask} style={primary} onClick={onRun}>{busy ? "Checking…" : shown ? "Re-check" : "Run check"}</button>}
      {dock && web?.consent && <button type="button" className="sc-btn" data-guide="supplier.check.web" disabled={busy || ask} style={primary} onClick={() => setAsk(true)}>{busy ? "Researching…" : "Research on the web"}</button>}
      {dock && saveToken && !saved && <button type="button" className="sc-btn" data-guide="supplier.check.save" disabled={busy} style={web?.consent ? ghost : primary} onClick={() => void save()}>Save to supplier</button>}
      {dock && saveToken && !saved && <InfoTip label="saving the check">{CHECK_TIPS.save}</InfoTip>}
    </div>
  );

  const body = (
    <div className="sc-card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <style>{CHECK_CSS}</style>
      {pending && <div role="alert" style={{ fontSize: 13, color: "var(--amberink)", background: "var(--amberbg)", borderRadius: 8, padding: "8px 12px" }}>{data?.pendingMessage ?? "Supplier checks need a database update (migration 0263)."}</div>}
      {ask && web?.consent && (
        <div role="group" aria-label="Research on the web?" data-guide="supplier.check.consent" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", border: `1px solid ${c.line}`, borderRadius: 8, padding: "10px 12px", background: c.panel2 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>Research on the web? Up to {web.searches} searches.</span>
          <InfoTip label="web research">{CHECK_TIPS.web}</InfoTip>
          <span style={{ display: "flex", gap: 8 }}>
            <button type="button" className="sc-btn" style={primary} onClick={() => void run(true)}>Yes, research</button>
            <button type="button" className="sc-btn" style={ghost} onClick={() => { setAsk(false); if (!dock) void run(false); }}>{dock ? "No" : "No, records only"}</button>
          </span>
        </div>
      )}
      {error && <div role="alert" style={{ fontSize: 13, color: "var(--redink)" }}>{error}</div>}
      {notice && <div role="status" style={{ fontSize: 12.5, color: "var(--amberink)" }}>{notice}</div>}
      {saved && <div role="status" style={{ fontSize: 12.5, color: "var(--greenink)" }}>Saved to this supplier.</div>}
      {shown ? (
        <>
          <div style={{ fontSize: 12, color: c.hint }}>
            Checked {fmtDate(shown.checkedAt)} · {shown.reputation.webUsed ? `records and web (${shown.reputation.searches} searches)` : "your own records only"}
            {dock && seed?.lastSaved ? ` · last saved check: ${VERDICT_LABEL[seed.lastSaved.verdict]}, ${fmtDate(seed.lastSaved.checkedAt)}` : ""}
          </div>
          <SupplierCheckView result={shown} history={dock ? undefined : data?.history} />
        </>
      ) : !pending && data && (
        <div style={{ fontSize: 13, color: c.muted }}>
          No check yet.{canRun ? " Run one to see whether this supplier looks genuine, how our own history rates it and what is reported about it." : ""}
        </div>
      )}
      {!dock && !data && !error && <div style={{ fontSize: 13, color: c.hint }}>Loading…</div>}
    </div>
  );

  if (dock) {
    return (
      <div style={{ border: `1px solid ${c.line}`, borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 10, background: c.panel, maxWidth: "100%" }} data-guide="supplier.check.card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <a href={seed?.href} style={{ fontSize: 14, fontWeight: 700, color: c.ink, textDecoration: "none" }}>{seed?.name} <span style={{ color: c.hint, fontWeight: 500 }}>· Supplier check</span></a>
          <InfoTip label="the supplier check">{CHECK_TIPS.overall}</InfoTip>
        </div>
        {body}
        {actions}
      </div>
    );
  }
  return (
    <Card title="Supplier check" info={CHECK_TIPS.overall} action={actions}>
      {body}
    </Card>
  );
}
