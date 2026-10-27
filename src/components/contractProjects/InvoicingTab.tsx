"use client";

import { useState } from "react";
import Link from "next/link";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import StatTile, { StatStrip } from "@/components/ui/StatTile";
import StatusPill from "@/components/ui/StatusPill";
import { ROUTES } from "@/lib/constants";
import { day, money } from "@/lib/contractProjects/format";
import { MILESTONE_STATUS_LABEL, MILESTONE_TONE } from "@/lib/contractProjects/milestones";
import type { MilestonesData, MilestoneView } from "@/lib/contractProjects/milestonesServer";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";
import { taxBasisText, taxOn } from "@/lib/contractProjects/milestoneTax";
import MilestonePanel from "./MilestonePanel";
import { useReloaded } from "./useReloaded";

// The Invoicing tab of a contract project (migration 0232): the billing schedule. Three tiles, a warning that stays visible when the
// schedule is out of step with the contract, one table, and the side panel to add or edit a milestone. "Create invoice" on a row makes
// the draft invoice through the invoices object; the invoice's reference then links to it.

const PAGE = 10;
const th: React.CSSProperties = { textAlign: "left", fontSize: 11, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4, padding: "9px 12px", background: c.panel2, fontWeight: 600 };

export default function InvoicingTab({ projectId, data: fromServer, projectClosed = false, initialPanel }: {
  projectId: string;
  data: MilestonesData;
  projectClosed?: boolean;
  /** Lets a server render (and its test) show the tab with a panel open. The page never passes it. */
  initialPanel?: { id?: string };
}) {
  // Every change reloads the schedule and the tiles here, then refreshes the page.
  const { data, reload } = useReloaded<MilestonesData>(`/api/contract-projects/${projectId}/milestones`, fromServer);
  const [panel, setPanel] = useState<{ id?: string } | null>(initialPanel ?? null);
  const [showAll, setShowAll] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const cur = data.currency;
  const t = data.totals;

  if (data.pending) {
    return <div role="alert" data-guide="cp.invoicing.pending" style={{ fontSize: 13, color: "var(--amberink)" }}>Invoicing needs a database update (migration 0232). Ask your administrator to apply it.</div>;
  }
  const list = showAll ? data.milestones : data.milestones.slice(0, PAGE);
  const open = panel?.id ? data.milestones.find((m) => m.id === panel.id) : undefined;
  const canInvoice = data.canEdit && data.invoicesOn && data.hasCustomer && !projectClosed;
  const changed = () => { setPanel(null); void reload(); };

  async function createInvoice(m: MilestoneView) {
    setError(""); setNotice(""); setBusyId(m.id);
    try {
      const res = await fetch(`/api/contract-projects/${projectId}/milestones/${m.id}/invoice`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not create the invoice"); await reload(); return; }
      setNotice(`Draft invoice ${j.invoice_ref ?? ""} created for ${m.title}.`.replace("  ", " "));
      await reload();
    } finally { setBusyId(""); }
  }

  return (
    <div data-guide="cp.invoicing" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <StatStrip guide="cp.invoicing.kpis">
        <StatTile tone="info" label="Contracted" info={PROJECT_TIPS.milestones} value={money(t.contracted, cur)} sub={t.scheduled > 0 ? `${money(t.scheduled, cur)} scheduled` : "nothing scheduled"} />
        <StatTile tone="good" label="Invoiced" value={money(t.invoiced, cur)} sub={t.paid > 0 ? `${money(t.paid, cur)} paid` : "none paid yet"} />
        <StatTile tone={t.toInvoice > 0 ? "warn" : "neutral"} label="Still to invoice" info={PROJECT_TIPS.stillToInvoice} value={money(t.toInvoice, cur)} sub={t.contracted > 0 ? `${Math.round((t.toInvoice / t.contracted) * 100)}% of the contract` : "no contract value"} />
      </StatStrip>

      {t.warning && <div role="status" data-guide="cp.invoicing.warning" style={{ fontSize: 13, color: "var(--amberink)" }}>{t.warning}</div>}
      {error && <div role="alert" style={{ fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
      {notice && <div role="status" data-guide="cp.invoicing.notice" style={{ fontSize: 13, color: c.ink }}>{notice}</div>}
      {data.canEdit && !data.hasCustomer && <div role="status" style={{ fontSize: 13, color: "var(--amberink)" }}>This project has no customer yet. An invoice needs one.</div>}

      <Card
        title="Billing schedule" padding={0}
        action={data.canEdit && !projectClosed ? <Button variant="primary" size="sm" data-guide="cp.milestone.add" style={{ minHeight: 44 }} onClick={() => { setError(""); setPanel({}); }}>+ Add milestone</Button> : undefined}
      >
        {data.milestones.length === 0 ? (
          <EmptyState title="No milestones yet" text={data.canEdit ? "Add the amounts you will bill and when, as a percent of the contract value or a fixed amount." : undefined} />
        ) : (
          <>
          <div className="bpm-rows-table" style={{ overflowX: "auto" }}>
            <table data-guide="cp.invoicing.table" style={{ width: "100%", minWidth: 600, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Milestone</th><th style={{ ...th, textAlign: "right" }}>Amount before tax</th><th style={th}>Status</th><th style={th}>Invoice</th>
                </tr>
              </thead>
              <tbody>
                {list.map((m) => (
                  <tr key={m.id} style={{ borderTop: `1px solid ${c.line}` }}>
                    <td style={{ padding: 0 }}>
                      <button type="button" data-guide="cp.milestone.open" aria-label={`Open ${m.title}`} onClick={() => { setError(""); setPanel({ id: m.id }); }}
                        style={{ all: "unset", boxSizing: "border-box", display: "block", width: "100%", minHeight: 52, padding: "8px 12px", cursor: "pointer" }}>
                        <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: c.ink, overflowWrap: "anywhere" }}>{m.title}</span>
                        <span style={{ display: "block", fontSize: 12, color: c.hint }}>{m.due_date ? `due ${day(m.due_date)}` : "no due date"}</span>
                      </button>
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 13 }}>
                      {money(m.amount, cur)}
                      {m.basis === "percent" && <span style={{ display: "block", fontSize: 12, color: c.hint }}>{m.percent}%</span>}
                      <span data-guide="cp.milestone.tax" style={{ display: "block", fontSize: 12, color: data.tax.kind === "none" ? "var(--amberink)" : c.hint }}>
                        {data.tax.kind === "added" ? `${taxBasisText(data.tax)}: ${money(taxOn(m.amount, data.tax).gross, cur)} with ${data.tax.label}` : taxBasisText(data.tax)}
                      </span>
                    </td>
                    <td style={{ padding: "8px 12px" }}><StatusPill label={MILESTONE_STATUS_LABEL[m.display_status]} tone={MILESTONE_TONE[m.display_status]} /></td>
                    <td style={{ padding: "4px 12px", whiteSpace: "nowrap" }}>
                      {m.invoice_id && (m.display_status === "invoiced" || m.display_status === "paid") ? (
                        <Link href={ROUTES.invoice(m.invoice_id)} data-guide="cp.milestone.invoice_link" style={{ display: "inline-flex", alignItems: "center", minHeight: 44, color: c.accent, fontSize: 13 }}>{m.invoice_ref ?? "Invoice"}</Link>
                      ) : canInvoice && m.amount > 0 ? (
                        <Button variant="secondary" size="sm" loading={busyId === m.id} disabled={!!busyId} data-guide="cp.milestone.create_invoice" style={{ minHeight: 44 }} onClick={() => createInvoice(m)}>Create invoice</Button>
                      ) : <span style={{ fontSize: 12.5, color: c.hint }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bpm-rows-cards" data-guide="cp.invoicing.cards" style={{ gap: 10, padding: 12 }}>
            {list.map((m) => {
              const taxText = data.tax.kind === "added" ? `${money(taxOn(m.amount, data.tax).gross, cur)} with ${data.tax.label}` : taxBasisText(data.tax);
              return (
                <div key={m.id} data-guide="cp.milestone.card" style={{ boxSizing: "border-box", width: "100%", padding: 12, border: `1px solid ${c.line}`, borderRadius: 12, background: "var(--card-bg)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                    <span style={{ minWidth: 0, fontSize: 14, fontWeight: 600, color: c.ink, overflowWrap: "anywhere" }}>{m.title}</span>
                    <StatusPill label={MILESTONE_STATUS_LABEL[m.display_status]} tone={MILESTONE_TONE[m.display_status]} />
                  </div>
                  <MilestoneCardRow label="Amount before tax" value={m.basis === "percent" ? `${money(m.amount, cur)} (${m.percent}%)` : money(m.amount, cur)} />
                  <MilestoneCardRow label="Tax"value={taxText} ink={data.tax.kind === "none" ? "var(--amberink)" : undefined} />
                  <MilestoneCardRow label="Due" value={m.due_date ? day(m.due_date) : "No due date"} />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
                    {m.invoice_id && (m.display_status === "invoiced" || m.display_status === "paid") ? (
                      <Link href={ROUTES.invoice(m.invoice_id)} data-guide="cp.milestone.card.invoice_link" style={{ display: "inline-flex", alignItems: "center", minHeight: 44, color: c.accent, fontSize: 13 }}>{m.invoice_ref ?? "Invoice"}</Link>
                    ) : canInvoice && m.amount > 0 ? (
                      <Button variant="secondary" size="sm" loading={busyId === m.id} disabled={!!busyId} data-guide="cp.milestone.card.create_invoice" style={{ minHeight: 44 }} onClick={() => createInvoice(m)}>Create invoice</Button>
                    ) : null}
                    <Button variant="quiet" size="sm" data-guide="cp.milestone.card.open" aria-label={`Open ${m.title}`} style={{ minHeight: 44 }} onClick={() => { setError(""); setPanel({ id: m.id }); }}>Open</Button>
                  </div>
                </div>
              );
            })}
          </div>
          </>
        )}
        {data.milestones.length > PAGE && (
          <div style={{ padding: "8px 12px", borderTop: `1px solid ${c.line}` }}>
            <Button variant="quiet" size="sm" data-guide="cp.invoicing.show_all" style={{ minHeight: 44 }} onClick={() => setShowAll((s) => !s)}>{showAll ? "Show fewer" : `Show all ${data.milestones.length}`}</Button>
          </div>
        )}
      </Card>

      {panel && (
        <MilestonePanel key={panel.id ?? "new"} projectId={projectId} milestone={open} contractValue={t.contracted} currency={cur} tax={data.tax} canEdit={data.canEdit && !projectClosed} onClose={() => setPanel(null)} onChanged={changed} />
      )}
    </div>
  );
}

function MilestoneCardRow({ label, value, ink }: { label: string; value: string; ink?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 6, fontSize: 13 }}>
      <span style={{ color: c.muted }}>{label}</span>
      <b style={{ color: ink ?? c.ink, fontVariantNumeric: "tabular-nums", fontWeight: 600, textAlign: "right", overflowWrap: "anywhere" }}>{value}</b>
    </div>
  );
}
