"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import StatusPill from "@/components/ui/StatusPill";
import { Input, Select } from "@/components/ui/Input";
import { EINVOICE_TIPS } from "@/lib/einvoicing/tips";
import { fixTarget, lineAnchor } from "@/lib/einvoicing/fixLinks";
import { DOC_CHIP, VAT_CATEGORY_LABEL } from "@/lib/einvoicing/labels";
import { ROUTES } from "@/lib/constants";
import type { EinvoiceDocType, ReadinessIssue, VatCategory } from "@/lib/einvoicing/rules";

export type PanelLine = {
  id: string;
  label: string;
  description: string;
  vat_category: VatCategory | null;
  vat_rate: number | null;
  vat_exemption_reason: string | null;
};

export type PanelGroup = { label: string; rate: string; taxable: string; vat: string };

export type EinvoicePanelProps = {
  invoiceId: string;
  basePath: string;
  /** The invoice is a draft: its type, lines and VAT can still be changed. */
  editable: boolean;
  docType: EinvoiceDocType;
  /** A note, or an invoice that already has its number: the type cannot be switched. */
  typeLocked: boolean;
  ready: boolean;
  issues: ReadinessIssue[];
  accountHref: string | null;
  uuid: string | null;
  seq: number | null;
  original: { ref: string; href: string } | null;
  creditNotes: { id: string; ref: string }[];
  canCreditNote: boolean;
  lines: PanelLine[];
  groups: PanelGroup[];
  totals: { subtotal: string; discount: string | null; taxable: string; vat: string; grand: string };
};

const OPEN_KEY = "bpm.einvoice.panel.open";

async function send(url: string, method: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (!res) return "Network error";
  if (res.ok) return null;
  return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not save";
}

/**
 * Saudi e-invoice section of an invoice (flag einvoicing_ksa): a Ready / Not ready chip, what is missing with a link to the
 * place that fixes each item, the VAT category of every line, VAT by rate, and the identity of the document. Collapsible and
 * remembers whether it was open; open by default only while something is missing. No explanatory text on the screen: the
 * explanations are behind the "i".
 */
export default function EinvoicePanel(p: EinvoicePanelProps) {
  const router = useRouter();
  const [open, setOpen] = useState(!p.ready);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [creditOpen, setCreditOpen] = useState(false);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(OPEN_KEY);
      if (v === "1") setOpen(true);
      else if (v === "0") setOpen(false);
    } catch { /* storage can be blocked: the default stands */ }
  }, []);
  const toggle = (next: boolean) => {
    setOpen(next);
    try { window.localStorage.setItem(OPEN_KEY, next ? "1" : "0"); } catch { /* ignore */ }
  };

  async function run(fn: () => Promise<string | null>) {
    setBusy(true); setError("");
    const err = await fn();
    setBusy(false);
    if (err) setError(err); else router.refresh();
  }

  const patchLine = (lineId: string, body: Record<string, unknown>) =>
    run(() => send(`/api/invoices/${p.invoiceId}/lines/${lineId}`, "PATCH", body));
  const setType = (t: string) => run(() => send(`/api/invoices/${p.invoiceId}`, "PATCH", { einvoice_doc_type: t }));
  const applyDefault = () => run(() => send(`/api/invoices/${p.invoiceId}/einvoice`, "POST", { action: "apply_default_vat" }));
  async function createCredit() {
    setBusy(true); setError("");
    const res = await fetch(`/api/invoices/${p.invoiceId}/credit-note`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }),
    }).catch(() => null);
    const json = res ? ((await res.json().catch(() => ({}))) as { id?: string; error?: string }) : {};
    setBusy(false);
    if (res?.ok && json.id) router.push(ROUTES.invoice(json.id));
    else setError(json.error ?? "Could not create the credit note");
  }

  const missingCategory = p.lines.some((l) => !l.vat_category);
  const n = p.issues.length;

  return (
    <Card padding={0}>
      <details
        open={open}
        onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; if (o !== open) toggle(o); }}
        data-guide="invoice.einvoice.panel"
      >
        <summary style={{ cursor: "pointer", padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", listStyle: "none", minHeight: 44 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5 }}>Saudi e-invoice</span>
          <StatusPill label={p.ready ? "Ready" : `Not ready · ${n}`} tone={p.ready ? "green" : "amber"} />
          <StatusPill label={DOC_CHIP[p.docType]} tone={p.docType === "credit_note" || p.docType === "debit_note" ? "purple" : "blue"} />
          <InfoTip label="Saudi e-invoice">{EINVOICE_TIPS.panel}</InfoTip>
        </summary>

        <div style={{ padding: "0 14px 14px", display: "grid", gap: 14 }}>
          {error && <div role="alert" style={{ color: "var(--err-ink)", fontSize: 12.5 }}>{error}</div>}

          {/* What is missing */}
          {n > 0 && (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }} data-guide="invoice.einvoice.missing">
              {p.issues.map((i, idx) => {
                const fix = fixTarget(i, { basePath: p.basePath, accountHref: p.accountHref });
                return (
                  <li key={`${i.field}-${idx}`} id={`einv-issue-${idx}`} style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", fontSize: 13, color: c.ink, borderLeft: "3px solid #ba7517", paddingLeft: 10, minHeight: 28, alignItems: "center" }}>
                    <span>{i.message}</span>
                    {fix && (fix.href.startsWith("#")
                      ? <a href={fix.href} style={{ color: c.accent, fontSize: 12.5, fontWeight: 600, textDecoration: "none", minHeight: 44, display: "inline-flex", alignItems: "center" }}>{fix.label}</a>
                      : <Link href={fix.href} style={{ color: c.accent, fontSize: 12.5, fontWeight: 600, textDecoration: "none", minHeight: 44, display: "inline-flex", alignItems: "center" }}>{fix.label}</Link>)}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Type */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span className="bpm-label-row"><span className="bpm-t-label">Type</span><InfoTip label="Type">{EINVOICE_TIPS.docType}</InfoTip></span>
            {p.editable && !p.typeLocked ? (
              <Select aria-label="E-invoice type" value={p.docType} disabled={busy} onChange={(e) => setType(e.target.value)} style={{ width: "auto", minHeight: 44 }} data-guide="invoice.einvoice.type">
                <option value="standard">Standard</option>
                <option value="simplified">Simplified</option>
              </Select>
            ) : (
              <span style={{ fontSize: 13, fontWeight: 600 }}>{DOC_CHIP[p.docType]}</span>
            )}
            {p.original && <Link href={p.original.href} style={{ fontSize: 12.5, color: c.accent, fontFamily: "monospace", textDecoration: "none" }}>Corrects {p.original.ref}</Link>}
            {p.creditNotes.map((cn) => (
              <Link key={cn.id} href={ROUTES.invoice(cn.id)} style={{ fontSize: 12.5, color: c.accent, fontFamily: "monospace", textDecoration: "none" }}>Credit note {cn.ref}</Link>
            ))}
          </div>

          {/* Line VAT */}
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "space-between" }}>
              <span className="bpm-label-row"><span className="bpm-t-label">Line VAT</span><InfoTip label="Line VAT">{EINVOICE_TIPS.vatCategory}</InfoTip></span>
              {p.editable && missingCategory && (
                <Button size="sm" variant="secondary" loading={busy} onClick={applyDefault} data-guide="invoice.einvoice.apply_default_vat">Set standard VAT on all lines</Button>
              )}
            </div>
            {p.lines.map((l) => (
              <div key={l.id} id={lineAnchor(l.id)} style={{ display: "grid", gap: 6, gridTemplateColumns: "minmax(0,1fr)", paddingBottom: 8, borderBottom: `1px solid ${c.line}` }}>
                <div style={{ fontSize: 13, color: c.ink, overflowWrap: "anywhere" }}>{l.label} · {l.description}</div>
                {p.editable ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <Select
                      aria-label={`VAT category, line ${l.label}`} value={l.vat_category ?? ""} disabled={busy}
                      onChange={(e) => patchLine(l.id, { vat_category: e.target.value || null })}
                      style={{ width: "auto", minHeight: 44 }}
                    >
                      <option value="">Not set</option>
                      {(["S", "Z", "E", "O"] as const).map((k) => <option key={k} value={k}>{VAT_CATEGORY_LABEL[k].en}</option>)}
                    </Select>
                    {l.vat_category === "S" && (
                      <Input
                        key={`${l.id}-${l.vat_rate}`} aria-label={`VAT rate %, line ${l.label}`} type="number" inputMode="decimal" min={0} max={100} step="0.01"
                        defaultValue={l.vat_rate ?? ""} disabled={busy} style={{ width: 90, minHeight: 44 }}
                        onBlur={(e) => { if (e.target.value !== String(l.vat_rate ?? "")) patchLine(l.id, { vat_rate: e.target.value }); }}
                      />
                    )}
                    {l.vat_category && l.vat_category !== "S" && (
                      <Input
                        key={`${l.id}-${l.vat_exemption_reason}`} aria-label={`Reason, line ${l.label}`} placeholder="Reason" maxLength={300}
                        defaultValue={l.vat_exemption_reason ?? ""} disabled={busy} style={{ flex: "1 1 180px", minHeight: 44 }}
                        onBlur={(e) => { if (e.target.value !== (l.vat_exemption_reason ?? "")) patchLine(l.id, { vat_exemption_reason: e.target.value }); }}
                      />
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: 12.5, color: c.muted }}>
                    {l.vat_category ? `${VAT_CATEGORY_LABEL[l.vat_category].en} · ${l.vat_rate ?? 0}%${l.vat_exemption_reason ? ` · ${l.vat_exemption_reason}` : ""}` : "Not set"}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* VAT by rate */}
          <div style={{ display: "grid", gap: 6 }}>
            <span className="bpm-label-row"><span className="bpm-t-label">VAT by rate</span><InfoTip label="VAT by rate">{EINVOICE_TIPS.byRate}</InfoTip></span>
            {p.groups.map((g, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, flexWrap: "wrap" }}>
                <span>{g.label} {g.rate}</span>
                <span style={{ color: c.muted }}>{g.taxable} + {g.vat}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, fontWeight: 700, borderTop: `1px solid ${c.line}`, paddingTop: 6, flexWrap: "wrap" }}>
              <span>Taxable {p.totals.taxable} · VAT {p.totals.vat}</span>
              <span>Total {p.totals.grand}</span>
            </div>
          </div>

          {/* Identity */}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: c.muted, alignItems: "center" }}>
            <InfoTip label="Document identity">{EINVOICE_TIPS.identity}</InfoTip>
            <span>UUID <span style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{p.uuid ?? "—"}</span></span>
            <span>Counter <span style={{ fontFamily: "monospace" }}>{p.seq ?? "—"}</span></span>
          </div>

          {/* Credit note */}
          {p.canCreditNote && (
            <div style={{ display: "grid", gap: 8 }}>
              {!creditOpen ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Button variant="secondary" onClick={() => setCreditOpen(true)} data-guide="invoice.einvoice.credit_note">Create credit note</Button>
                  <InfoTip label="Credit note">{EINVOICE_TIPS.creditNote}</InfoTip>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <Input aria-label="Reason for the credit note" placeholder="Reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} style={{ flex: "1 1 220px", minHeight: 44 }} />
                  <Button variant="primary" loading={busy} disabled={reason.trim() === ""} onClick={createCredit}>Create</Button>
                  <Button variant="quiet" onClick={() => { setCreditOpen(false); setReason(""); }}>Cancel</Button>
                </div>
              )}
            </div>
          )}
        </div>
      </details>
    </Card>
  );
}
