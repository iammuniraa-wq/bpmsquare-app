"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES } from "@/lib/constants";

// "Deal" on a Standard Quote (§4.3, decision 5): a quote MAY belong to a
// deal. Shows the link when there is one; otherwise "Create deal from
// this quote" (lines copied, quote linked) or "Link to deal" (an open deal
// of the same account).

type DealLite = { id: string; ref: string | null; title: string; stage: string; outcome: string };

export default function StandardQuoteDealCard({ quoteId, accountId, deal }: { quoteId: string; accountId: string; deal: DealLite | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [linking, setLinking] = useState(false);
  const [deals, setDeals] = useState<DealLite[] | null>(null);
  const [pick, setPick] = useState("");

  useEffect(() => {
    if (!linking || deals !== null) return;
    fetch(`/api/opportunities?account_id=${encodeURIComponent(accountId)}&outcome=open`).then(async (r) => setDeals(r.ok ? await r.json() : [])).catch(() => setDeals([]));
  }, [linking, deals, accountId]);

  function createDeal() {
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/standard-quotes/${quoteId}/create-deal`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not create the deal"); return; }
      router.push(ROUTES.pipelineDetail(j.id));
    });
  }
  function link(opportunityId: string | null) {
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/standard-quotes/${quoteId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ opportunity_id: opportunityId }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not link"); return; }
      setLinking(false);
      router.refresh();
    });
  }

  const small: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: c.accent, background: "none", border: "none", cursor: "pointer", padding: 0 };
  return (
    <section style={{ ...cardStyle, padding: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6 }}>Deal</div>
      {deal ? (
        <div>
          <Link href={ROUTES.pipelineDetail(deal.id)} style={{ fontSize: 13, fontWeight: 600, color: c.accent, textDecoration: "none" }}>{deal.ref ? `${deal.ref} · ` : ""}{deal.title}</Link>
          <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2, textTransform: "capitalize" }}>{deal.stage} · {deal.outcome}</div>
          <button type="button" disabled={pending} onClick={() => link(null)} style={{ ...small, color: c.hint, marginTop: 6, fontWeight: 400 }}>Unlink</button>
        </div>
      ) : linking ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ padding: "6px 8px", fontSize: 12.5, borderRadius: 6, border: `1px solid ${c.line}`, background: c.panel, color: c.ink }}>
            <option value="">{deals === null ? "Loading…" : deals.length ? "Pick an open deal" : "No open deal for this account"}</option>
            {(deals ?? []).map((d) => <option key={d.id} value={d.id}>{d.ref ? `${d.ref} · ` : ""}{d.title}</option>)}
          </select>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" disabled={!pick || pending} onClick={() => link(pick)} style={small}>Link</button>
            <button type="button" onClick={() => setLinking(false)} style={{ ...small, color: c.hint, fontWeight: 400 }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 12, color: c.muted }}>Not part of a deal.</div>
          <button type="button" disabled={pending} onClick={createDeal} style={small}>Create deal from this quote</button>
          <button type="button" onClick={() => setLinking(true)} style={small}>Link to a deal</button>
        </div>
      )}
      {error && <div style={{ fontSize: 12, color: "var(--err-ink)", marginTop: 6 }}>{error}</div>}
    </section>
  );
}
