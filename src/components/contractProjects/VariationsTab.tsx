"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import StatTile, { StatStrip } from "@/components/ui/StatTile";
import StatusPill from "@/components/ui/StatusPill";
import { day, money, signedMoney } from "@/lib/contractProjects/format";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";
import { VARIATION_STATUS_LABEL, VARIATION_TONE } from "@/lib/contractProjects/variations";
import type { VariationsData, VariationView } from "@/lib/contractProjects/variationsServer";
import VariationPanel, { type VariationOutcome } from "./VariationPanel";
import { useReloaded } from "./useReloaded";

// The Variations tab of a contract project (migration 0231): the client's changes after the award. Three tiles, one table, and the side
// panel to add or look at one. Approving a variation moves the contract value, so the page is refreshed after every change.

const PAGE = 10;
const th: React.CSSProperties = { textAlign: "left", fontSize: 11, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4, padding: "9px 12px", background: c.panel2, fontWeight: 600 };

/** One sentence about what an approval did to the budget. */
export function outcomeSentence(o: VariationOutcome, currency: string | null): string {
  if (o.status === "rejected") return "Rejected. It is back with the person who sent it.";
  const value = o.contract_value !== undefined ? `The contract value is now ${money(o.contract_value, currency)}. ` : "";
  switch (o.revision) {
    case "started": return `${value}Budget revision ${o.revision_no} was opened for the cost.`;
    case "already_open": return `${value}A budget revision is already open: add the cost there.`;
    case "no_baseline": return `${value}The baseline budget is not approved yet, so put the cost into the baseline.`;
    case "no_reason": return `${value}No budget revision was opened: add a reason to the justification list in Settings, then start one.`;
    case "failed": return `${value}The budget revision could not be opened. Start one from the Revisions tab.`;
    default: return value.trim() || "Approved.";
  }
}

export default function VariationsTab({ projectId, data: fromServer, initialPanel }: {
  projectId: string;
  data: VariationsData;
  /** Lets a server render (and its test) show the tab with a panel open. The page never passes it. */
  initialPanel?: { id?: string };
}) {
  // Every change reloads the list and the tiles here, then refreshes the page (the contract value, budget and Revisions count are the page's).
  const { data, reload } = useReloaded<VariationsData>(`/api/contract-projects/${projectId}/variations`, fromServer);
  const [panel, setPanel] = useState<{ id?: string } | null>(initialPanel ?? null);
  const [showAll, setShowAll] = useState(false);
  const [notice, setNotice] = useState("");
  const cur = data.currency;
  const t = data.totals;

  if (data.pending) {
    return <div role="alert" data-guide="cp.variations.pending" style={{ fontSize: 13, color: "var(--amberink)" }}>Variations need a database update (migration 0231). Ask your administrator to apply it.</div>;
  }
  const list = showAll ? data.variations : data.variations.slice(0, PAGE);
  const open = panel?.id ? data.variations.find((v) => v.id === panel.id) : undefined;
  const closePanel = () => setPanel(null);
  const changed = (opts?: { keepOpen?: boolean }) => { if (!opts?.keepOpen) setPanel(null); void reload(); };

  return (
    <div data-guide="cp.variations" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <StatStrip guide="cp.variations.kpis">
        <StatTile tone="info" label="Approved variations" info={PROJECT_TIPS.variations} value={signedMoney(t.approved, cur)} sub={t.approvedCost !== 0 ? `cost ${signedMoney(t.approvedCost, cur)}` : "no cost change"} />
        <StatTile tone="info" label="Revised contract value" value={money(t.revised, cur)} sub={`original ${money(t.original, cur)}`} />
        <StatTile tone={t.pendingCount > 0 ? "warn" : "neutral"} label="Waiting for approval" value={String(t.pendingCount)} sub={t.pendingCount > 0 ? signedMoney(t.pending, cur) : "nothing waiting"} />
      </StatStrip>

      {notice && <div role="status" data-guide="cp.variations.notice" style={{ fontSize: 13, color: c.ink, background: "var(--card-bg)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px" }}>{notice}</div>}

      <Card
        title="Variations" padding={0}
        action={data.canEdit ? <Button variant="primary" size="sm" data-guide="cp.variation.add" style={{ minHeight: 44 }} onClick={() => { setNotice(""); setPanel({}); }}>+ Add variation</Button> : undefined}
      >
        {data.variations.length === 0 ? (
          <EmptyState title="No variations yet" text={data.canEdit ? "When the client changes the scope after the award, add it here, price it and send it for approval." : undefined} />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table data-guide="cp.variations.table" style={{ width: "100%", minWidth: 560, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Variation</th><th style={th}>Status</th>
                  <th style={{ ...th, textAlign: "right" }}>Contract value</th><th style={{ ...th, textAlign: "right" }}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {list.map((v: VariationView) => (
                  <tr key={v.id} style={{ borderTop: `1px solid ${c.line}` }}>
                    <td style={{ padding: 0 }}>
                      <button type="button" data-guide="cp.variation.open" aria-label={`Open ${v.ref ?? "variation"} ${v.title}`} onClick={() => { setNotice(""); setPanel({ id: v.id }); }}
                        style={{ all: "unset", boxSizing: "border-box", display: "block", width: "100%", minHeight: 52, padding: "8px 12px", cursor: "pointer" }}>
                        <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: c.ink, overflowWrap: "anywhere" }}>{v.title}</span>
                        <span style={{ display: "block", fontSize: 12, color: c.hint }}>{[v.ref, v.change_request_ref ? `CR ${v.change_request_ref}` : null, v.submitted_at ? day(v.submitted_at) : null].filter(Boolean).join(" · ")}</span>
                      </button>
                    </td>
                    <td style={{ padding: "8px 12px" }}><StatusPill label={VARIATION_STATUS_LABEL[v.status]} tone={VARIATION_TONE[v.status]} /></td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 13 }}>{signedMoney(v.amount, cur)}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 13, color: c.muted }}>{signedMoney(v.cost_amount, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.variations.length > PAGE && (
          <div style={{ padding: "8px 12px", borderTop: `1px solid ${c.line}` }}>
            <Button variant="quiet" size="sm" data-guide="cp.variations.show_all" style={{ minHeight: 44 }} onClick={() => setShowAll((s) => !s)}>{showAll ? "Show fewer" : `Show all ${data.variations.length}`}</Button>
          </div>
        )}
      </Card>

      {panel && (
        <VariationPanel
          key={panel.id ?? "new"} projectId={projectId} variation={open} currency={cur} canEdit={data.canEdit} onClose={closePanel} onChanged={changed}
          onOutcome={(o) => setNotice(outcomeSentence(o, cur))}
        />
      )}
    </div>
  );
}
