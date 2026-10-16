"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { Select } from "@/components/ui/Input";

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

  return (
    <Card title="Deal" padding={14}>
      {deal ? (
        <div>
          <Link href={ROUTES.pipelineDetail(deal.id)} style={{ fontSize: 13, fontWeight: 600, color: c.accent, textDecoration: "none" }}>{deal.ref ? `${deal.ref} · ` : ""}{deal.title}</Link>
          <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2, textTransform: "capitalize" }}>{deal.stage} · {deal.outcome}</div>
          <div style={{ marginTop: 6 }}>
            <Button variant="quiet" size="sm" disabled={pending} onClick={() => link(null)}>Unlink</Button>
          </div>
        </div>
      ) : linking ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Open deal">
            <option value="">{deals === null ? "Loading…" : deals.length ? "Pick an open deal" : "No open deal for this account"}</option>
            {(deals ?? []).map((d) => <option key={d.id} value={d.id}>{d.ref ? `${d.ref} · ` : ""}{d.title}</option>)}
          </Select>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="primary" size="sm" disabled={!pick} loading={pending} onClick={() => link(pick)}>Link</Button>
            <Button variant="secondary" size="sm" onClick={() => setLinking(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
          <div style={{ fontSize: 12, color: c.muted }}>Not part of a deal.</div>
          <Button variant="secondary" size="sm" loading={pending} onClick={createDeal}>Create deal from this quote</Button>
          <Button variant="quiet" size="sm" onClick={() => setLinking(true)}>Link to a deal</Button>
        </div>
      )}
      {error && <div role="alert" style={{ fontSize: 12, color: "var(--err-ink)", marginTop: 6 }}>{error}</div>}
    </Card>
  );
}
