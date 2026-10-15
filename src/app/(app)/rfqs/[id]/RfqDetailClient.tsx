"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";
import {
  RFQ_STATUS_LABEL, RFQ_ORIGIN_LABEL, RFQ_SUPPLIER_STATUS_LABEL,
  type Rfq, type RfqLine, type RfqResponse, type RfqMessage, type RfqSupplier,
} from "@/lib/rfq/types";
import { bestByLine, landedUnit } from "@/lib/rfq/rules";
import ObjectSections from "@/components/fields/ObjectSections";
import { RFQ_STATUS_TONE, SUPPLIER_STATUS_TONE, inp, lbl, btnPrimary, btnGhost, fmtDate, fmtDateTime, fmtMoney } from "@/components/rfq/rfqUi";

type SupplierRow = RfqSupplier & {
  suppliers: { id: string; ref: string | null; name: string; email: string | null; phone: string | null } | null;
  reply_link: string | null;
  whatsapp_text: string | null;
};

type Bundle = {
  rfq: Rfq;
  lines: RfqLine[];
  suppliers: SupplierRow[];
  responses: RfqResponse[];
  messages: RfqMessage[];
  products: { id: string; ref: string | null; name: string }[];
  origin_href: string | null;
  mail_mode: "platform" | "mailbox";
  tenant_currency: string;
};

type Tab = "compare" | "suppliers" | "conversation" | "details";

async function call(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? `Request failed (${res.status})`);
  return j;
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function Modal({ title, onClose, children, width = 640 }: { title: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()} style={{ background: c.panel, borderRadius: 12, width, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.35)" }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${c.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: c.ink }}>{title}</div>
          <button type="button" aria-label="Close" onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, color: c.hint, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
      </div>
    </div>
  );
}

export default function RfqDetailClient({ id, canEdit, isAdmin }: { id: string; canEdit: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const [b, setB] = useState<Bundle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("compare");
  const [flash, setFlash] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [keyIn, setKeyIn] = useState<SupplierRow | null>(null);
  const [award, setAward] = useState<{ line: RfqLine; resp: RfqResponse; supplier: SupplierRow } | null>(null);
  const [addSup, setAddSup] = useState(false);

  const load = useCallback(async () => {
    try {
      setB(await call(`/api/rfqs/${id}`));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setFlash(null);
    try {
      const msg = await fn();
      if (msg) setFlash({ tone: "good", text: msg });
      await load();
    } catch (e) {
      setFlash({ tone: "bad", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (err) return <div style={{ ...cardStyle, color: "var(--redink)" }}>{err}</div>;
  if (!b) return <div style={{ ...cardStyle, color: c.hint }}>Loading…</div>;

  const { rfq } = b;
  const live = b.suppliers.filter((s) => s.status !== "cancelled");
  const pendingCount = live.filter((s) => s.status === "pending").length;
  const waiting = live.filter((s) => s.status === "sent" || s.status === "viewed").length;
  const closed = rfq.status === "closed" || rfq.status === "cancelled";
  const unread = b.messages.filter((m) => m.direction === "in" && !m.read_at).length;

  const sendAll = (kind: "request" | "reminder") => run(async () => {
    const j = await call(`/api/rfqs/${id}/send`, json("POST", { kind }));
    const bad = (j.results as { supplier: string; ok: boolean; reason?: string }[]).filter((r) => !r.ok);
    const good = j.results.length - bad.length;
    if (bad.length) throw new Error(`${good} sent. Not sent: ${bad.map((r) => `${r.supplier} — ${r.reason}`).join("; ")}`);
    return `${kind === "reminder" ? "Reminder sent" : "Sent"} to ${good} supplier${good === 1 ? "" : "s"}.`;
  });

  const action = (a: "cancel" | "close" | "reopen") => run(async () => {
    if (a === "cancel" && !confirm("Cancel this RFQ? Every supplier's reply link stops working. The conversation is kept.")) return;
    await call(`/api/rfqs/${id}`, json("PATCH", { action: a }));
    return a === "cancel" ? "RFQ cancelled." : a === "close" ? "RFQ closed." : "RFQ reopened.";
  });

  const del = () => run(async () => {
    if (!confirm("Delete this draft RFQ?")) return;
    await call(`/api/rfqs/${id}`, { method: "DELETE" });
    router.push("/rfqs");
  });

  const tabs: { id: Tab; label: string }[] = [
    { id: "compare", label: "Compare & award" },
    { id: "suppliers", label: `Suppliers (${live.length})` },
    { id: "conversation", label: `Conversation${unread ? ` · ${unread} new` : ""}` },
    { id: "details", label: "Details" },
  ];

  return (
    <>
      <PageHeader
        title={rfq.title}
        subtitle={`${rfq.ref ?? "RFQ"} · ${RFQ_ORIGIN_LABEL[rfq.origin_type]}${rfq.origin_label ? ` ${rfq.origin_label}` : ""}${rfq.respond_by ? ` · reply by ${fmtDate(rfq.respond_by)}` : ""}`}
        action={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Pill label={RFQ_STATUS_LABEL[rfq.status]} tone={RFQ_STATUS_TONE[rfq.status]} />
            {canEdit && !closed && pendingCount > 0 && <button type="button" style={btnPrimary} disabled={busy} onClick={() => sendAll("request")}>Send to {pendingCount} supplier{pendingCount === 1 ? "" : "s"}</button>}
            {canEdit && !closed && waiting > 0 && <button type="button" style={btnGhost} disabled={busy} onClick={() => sendAll("reminder")}>Remind {waiting}</button>}
            {canEdit && rfq.status === "awarded" && <button type="button" style={btnGhost} disabled={busy} onClick={() => action("close")}>Close</button>}
            {canEdit && !closed && rfq.status !== "draft" && <button type="button" style={btnGhost} disabled={busy} onClick={() => action("cancel")}>Cancel RFQ</button>}
            {canEdit && closed && <button type="button" style={btnGhost} disabled={busy} onClick={() => action("reopen")}>Reopen</button>}
            {canEdit && rfq.status === "draft" && <button type="button" style={{ ...btnGhost, color: "var(--redink)" }} disabled={busy} onClick={del}>Delete</button>}
          </div>
        }
      />

      {b.origin_href && (
        <div style={{ fontSize: 12.5, color: c.muted, marginTop: -8, marginBottom: 12 }}>
          Raised from <Link href={b.origin_href} style={{ color: c.accent, textDecoration: "none", fontWeight: 600 }}>{RFQ_ORIGIN_LABEL[rfq.origin_type]} {rfq.origin_label ?? ""}</Link>
          {rfq.origin_type !== "manual" && " — awarded costs feed the price there on the next Price."}
        </div>
      )}

      {flash && (
        <div role={flash.tone === "bad" ? "alert" : "status"} style={{ marginBottom: 12, fontSize: 13, padding: "9px 12px", borderRadius: 8, color: flash.tone === "bad" ? "var(--redink)" : "var(--greenink)", background: flash.tone === "bad" ? "var(--redbg)" : "var(--greenbg)" }}>{flash.text}</div>
      )}

      <div role="tablist" style={{ display: "flex", gap: 4, borderBottom: `1px solid ${c.line}`, marginBottom: 14, overflowX: "auto" }}>
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} type="button" onClick={() => setTab(t.id)} style={{
            padding: "9px 14px", fontSize: 13, fontWeight: tab === t.id ? 700 : 500, background: "none", border: "none", whiteSpace: "nowrap",
            borderBottom: `2px solid ${tab === t.id ? c.accent : "transparent"}`, color: tab === t.id ? c.ink : c.muted, cursor: "pointer",
          }}>{t.label}</button>
        ))}
      </div>

      {tab === "compare" && <CompareTab b={b} canEdit={canEdit && !closed} onKeyIn={setKeyIn} onAward={setAward} run={run} id={id} onAddSupplier={() => setAddSup(true)} />}
      {tab === "compare" && <PurchaseOrdersPanel id={id} canEdit={canEdit} version={b.responses.filter((r) => r.is_awarded).length} run={run} />}
      {tab === "suppliers" && <SuppliersTab b={b} canEdit={canEdit && !closed} onKeyIn={setKeyIn} run={run} id={id} onAddSupplier={() => setAddSup(true)} />}
      {tab === "conversation" && <ConversationTab b={b} canEdit={canEdit} id={id} run={run} />}
      {tab === "details" && <DetailsTab b={b} canEdit={canEdit && !closed} id={id} run={run} isAdmin={isAdmin} onReload={load} />}

      {keyIn && <KeyInModal b={b} rs={keyIn} id={id} onClose={() => setKeyIn(null)} onSaved={async (m) => { setKeyIn(null); setFlash({ tone: "good", text: m }); await load(); }} />}
      {award && <AwardModal b={b} {...award} id={id} onClose={() => setAward(null)} onDone={async (m, warn) => { setAward(null); setFlash({ tone: warn ? "bad" : "good", text: warn ?? m }); await load(); }} />}
      {addSup && <AddSupplierModal b={b} id={id} onClose={() => setAddSup(false)} onDone={async (m) => { setAddSup(false); setFlash({ tone: "good", text: m }); await load(); }} />}
    </>
  );
}

// ── Compare & award ─────────────────────────────────────────────────────────

function CompareTab({ b, canEdit, onKeyIn, onAward, run, id, onAddSupplier }: {
  b: Bundle; canEdit: boolean; id: string;
  onKeyIn: (s: SupplierRow) => void;
  onAward: (x: { line: RfqLine; resp: RfqResponse; supplier: SupplierRow }) => void;
  run: (fn: () => Promise<string | void>) => void;
  onAddSupplier: () => void;
}) {
  const sups = b.suppliers.filter((s) => s.status !== "cancelled");
  const lines = b.lines;
  const best = useMemo(() => bestByLine(b.responses), [b.responses]);
  const respOf = (lineId: string, rsId: string) => b.responses.find((r) => r.rfq_line_id === lineId && r.rfq_supplier_id === rsId);
  const productName = (pid: string | null) => b.products.find((p) => p.id === pid);

  if (!sups.length) {
    return (
      <div style={{ ...cardStyle, textAlign: "center", padding: 36, color: c.hint }}>
        No suppliers on this RFQ yet.
        {canEdit && <div style={{ marginTop: 12 }}><button type="button" style={btnPrimary} onClick={onAddSupplier}>Add suppliers</button></div>}
      </div>
    );
  }

  const cellTh: React.CSSProperties = { textAlign: "left", padding: "10px 12px", fontSize: 11.5, color: c.hint, fontWeight: 700, background: c.panel2, borderBottom: `1px solid ${c.line}`, verticalAlign: "bottom", minWidth: 170 };
  return (
    <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ ...cellTh, minWidth: 240, position: "sticky", left: 0, zIndex: 1 }}>Item</th>
              {sups.map((s) => (
                <th key={s.id} style={cellTh}>
                  <div style={{ color: c.ink, fontSize: 13, textTransform: "none" }}>{s.suppliers?.name}</div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, flexWrap: "wrap", fontWeight: 500 }}>
                    <Pill label={RFQ_SUPPLIER_STATUS_LABEL[s.status]} tone={SUPPLIER_STATUS_TONE[s.status]} />
                    {s.currency && <span style={{ color: c.hint }}>{s.currency}</span>}
                    {s.incoterm && <span style={{ color: c.hint }}>{s.incoterm}</span>}
                  </div>
                  {canEdit && (
                    <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                      <button type="button" style={{ ...btnGhost, padding: "3px 8px", fontSize: 11.5 }} onClick={() => onKeyIn(s)}>Enter reply</button>
                      {b.responses.some((r) => r.rfq_supplier_id === s.id && r.status !== "no_quote") && b.rfq.status !== "draft" && (
                        <button type="button" style={{ ...btnGhost, padding: "3px 8px", fontSize: 11.5 }} onClick={() => run(async () => {
                          const foreign = b.responses.find((r) => r.rfq_supplier_id === s.id && r.currency && r.currency !== b.tenant_currency);
                          let fx: string | null = null;
                          if (foreign) {
                            fx = prompt(`${s.suppliers?.name} quoted in ${foreign.currency}. Exchange rate to ${b.tenant_currency} (1 ${foreign.currency} = ? ${b.tenant_currency}):`, "1");
                            if (fx === null) return;
                          }
                          const j = await call(`/api/rfqs/${id}/award`, json("POST", { rfq_supplier_id: s.id, all: true, fx_rate: fx }));
                          return `Awarded ${j.results.length} line(s) to ${s.suppliers?.name}. Re-price the source document to use the new cost.`;
                        })}>Award all</button>
                      )}
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const prod = productName(l.product_id);
              return (
                <tr key={l.id} style={{ borderBottom: `1px solid ${c.line}`, opacity: l.status === "cancelled" ? 0.45 : 1 }}>
                  <td style={{ padding: "10px 12px", verticalAlign: "top", background: c.panel, position: "sticky", left: 0 }}>
                    <div style={{ fontWeight: 600, color: c.ink }}>{l.sl_no}. {l.description}</div>
                    <div style={{ fontSize: 12, color: c.hint, marginTop: 2 }}>
                      {l.qty ?? ""} {l.uom ?? ""}{prod ? ` · ${prod.ref ?? "catalog"}` : " · free text"}
                    </div>
                    {l.status === "awarded" && <div style={{ marginTop: 4 }}><Pill label={`Awarded · ${fmtMoney(l.awarded_unit_cost, b.tenant_currency)}`} tone="green" /></div>}
                    {l.status === "no_award" && <div style={{ marginTop: 4 }}><Pill label="No award" tone="amber" /></div>}
                    {canEdit && l.status !== "cancelled" && b.rfq.status !== "draft" && (
                      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                        {l.status !== "no_award" && <button type="button" style={{ ...btnGhost, padding: "2px 8px", fontSize: 11 }} onClick={() => run(async () => { await call(`/api/rfqs/${id}/award`, json("POST", { line_id: l.id, response_id: null })); return `Line ${l.sl_no} marked no award.`; })}>No award</button>}
                      </div>
                    )}
                  </td>
                  {sups.map((s) => {
                    const r = respOf(l.id, s.id);
                    if (!r) return <td key={s.id} style={{ padding: "10px 12px", color: c.hint, verticalAlign: "top" }}>—</td>;
                    const isBest = best.get(l.id) === r.id;
                    const landed = landedUnit(r);
                    const foreign = r.currency && r.currency !== b.tenant_currency;
                    return (
                      <td key={s.id} style={{ padding: "10px 12px", verticalAlign: "top", background: r.is_awarded ? "var(--greenbg)" : isBest ? "var(--bluebg)" : undefined }}>
                        {r.status === "no_quote" ? (
                          <span style={{ color: c.hint }}>Can&apos;t quote</span>
                        ) : (
                          <>
                            <div style={{ fontWeight: 700, color: c.ink, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(r.unit_price, r.currency)}</div>
                            {foreign && r.fx_rate && r.fx_rate !== 1 && <div style={{ fontSize: 11.5, color: c.muted }}>≈ {fmtMoney(landed, b.tenant_currency)}</div>}
                            <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2 }}>
                              {[r.lead_time_days != null ? `${r.lead_time_days} d` : null, r.moq != null ? `MOQ ${r.moq}` : null, r.valid_until ? `valid ${fmtDate(r.valid_until)}` : null].filter(Boolean).join(" · ")}
                            </div>
                            {r.status === "alternative" && <div style={{ fontSize: 11.5, color: "var(--amberink)", marginTop: 2 }}>Alternative: {r.offered_description}</div>}
                            {r.note && <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2 }}>{r.note}</div>}
                            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
                              {isBest && !r.is_awarded && <Pill label="Lowest" tone="blue" />}
                              {r.is_awarded && <Pill label="Awarded" tone="green" />}
                              {canEdit && !r.is_awarded && l.status !== "cancelled" && b.rfq.status !== "draft" && (
                                <button type="button" style={{ ...btnGhost, padding: "2px 8px", fontSize: 11 }} onClick={() => onAward({ line: l, resp: r, supplier: s })}>Award</button>
                              )}
                            </div>
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ padding: "10px 14px", fontSize: 12, color: c.hint, borderTop: `1px solid ${c.line}` }}>
        Blue marks the lowest price per line (after exchange rate). An award is a <strong>cost</strong>: for a catalog product it becomes the confirmed supplier cost the pricing engine uses on the next Price — margin is added there, never here.
      </div>
    </div>
  );
}

function AwardModal({ b, line, resp, supplier, id, onClose, onDone }: {
  b: Bundle; line: RfqLine; resp: RfqResponse; supplier: SupplierRow; id: string;
  onClose: () => void; onDone: (m: string, warn?: string) => void;
}) {
  const foreign = !!resp.currency && resp.currency !== b.tenant_currency;
  const [fx, setFx] = useState(resp.fx_rate && resp.fx_rate !== 1 ? String(resp.fx_rate) : foreign ? "" : "1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cost = resp.unit_price !== null && Number(fx) > 0 ? Number(resp.unit_price) * Number(fx) : null;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const j = await call(`/api/rfqs/${id}/award`, json("POST", { line_id: line.id, response_id: resp.id, fx_rate: fx || null }));
      onDone(`Line ${line.sl_no} awarded to ${supplier.suppliers?.name} at ${fmtMoney(j.unit_cost, b.tenant_currency)}.${line.product_id ? " Re-price the source document to use it." : ""}`, j.warning);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal title={`Award line ${line.sl_no}`} onClose={onClose} width={480}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13, color: c.ink }}>
        <div><strong>{line.description}</strong> to <strong>{supplier.suppliers?.name}</strong> at {fmtMoney(resp.unit_price, resp.currency)} per {line.uom ?? "unit"}.</div>
        {foreign && (
          <div>
            <label style={lbl} htmlFor="fx">Exchange rate: 1 {resp.currency} = ? {b.tenant_currency}</label>
            <input id="fx" style={inp} inputMode="decimal" value={fx} onChange={(e) => setFx(e.target.value)} placeholder="e.g. 3.64" />
          </div>
        )}
        <div style={{ color: c.muted }}>Cost recorded: <strong style={{ color: c.ink }}>{cost !== null ? fmtMoney(Math.round(cost * 10000) / 10000, b.tenant_currency) : "—"}</strong>{line.product_id ? " as the confirmed supplier cost for this product." : " on this RFQ line (free-text item — type the rate on the quote)."}</div>
        {error && <div role="alert" style={{ color: "var(--redink)" }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" style={btnGhost} onClick={onClose}>Cancel</button>
          <button type="button" style={btnPrimary} disabled={busy || (foreign && !(Number(fx) > 0))} onClick={submit}>{busy ? "Awarding…" : "Award"}</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Suppliers ───────────────────────────────────────────────────────────────

function SuppliersTab({ b, canEdit, onKeyIn, run, id, onAddSupplier }: {
  b: Bundle; canEdit: boolean; id: string;
  onKeyIn: (s: SupplierRow) => void;
  run: (fn: () => Promise<string | void>) => void;
  onAddSupplier: () => void;
}) {
  const [uploadFor, setUploadFor] = useState<string | null>(null);
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); return `${what} copied.`; } catch { return `Copy failed — select the text manually: ${text}`; }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {canEdit && <div><button type="button" style={btnGhost} onClick={onAddSupplier}>+ Add suppliers</button></div>}
      {b.suppliers.map((s) => {
        const phone = (s.suppliers?.phone ?? "").replace(/[^\d]/g, "");
        return (
          <div key={s.id} style={{ ...cardStyle, opacity: s.status === "cancelled" ? 0.55 : 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: c.ink, fontSize: 14 }}>
                  {s.suppliers ? <Link href={`/suppliers/${s.suppliers.id}`} style={{ color: c.ink, textDecoration: "none" }}>{s.suppliers.name}</Link> : "Supplier"}
                </div>
                <div style={{ fontSize: 12.5, color: c.muted, marginTop: 2 }}>{s.email_to || "No email — share the link on WhatsApp"}{s.contact_name ? ` · ${s.contact_name}` : ""}</div>
              </div>
              <Pill label={RFQ_SUPPLIER_STATUS_LABEL[s.status]} tone={SUPPLIER_STATUS_TONE[s.status]} />
            </div>
            <div style={{ fontSize: 12, color: c.hint, marginTop: 8, display: "flex", gap: 14, flexWrap: "wrap" }}>
              <span>Sent {fmtDateTime(s.sent_at)}</span>
              <span>Opened {fmtDateTime(s.viewed_at)}</span>
              <span>Replied {fmtDateTime(s.replied_at)}{s.reply_source ? ` (${s.reply_source})` : ""}</span>
              {s.reminder_count > 0 && <span>{s.reminder_count} reminder{s.reminder_count === 1 ? "" : "s"}</span>}
              {s.supplier_quote_ref && <span>Their ref {s.supplier_quote_ref}</span>}
              {s.valid_until && <span>Valid until {fmtDate(s.valid_until)}</span>}
              {s.payment_terms && <span>Payment {s.payment_terms}</span>}
              {s.freight_amount != null && <span>Freight {fmtMoney(s.freight_amount, s.currency)}</span>}
            </div>
            {s.note && <div style={{ fontSize: 12.5, color: c.muted, marginTop: 6, whiteSpace: "pre-wrap" }}>{s.note}</div>}
            {canEdit && s.status !== "cancelled" && (
              <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                <button type="button" style={btnGhost} onClick={() => run(async () => {
                  const kind = s.status === "pending" ? "request" : "reminder";
                  const j = await call(`/api/rfqs/${id}/send`, json("POST", { rfq_supplier_ids: [s.id], kind }));
                  const r = j.results[0];
                  if (!r.ok) throw new Error(r.reason);
                  return `${kind === "request" ? "Sent" : "Reminder sent"} to ${s.suppliers?.name}${r.redirected ? " (redirected to your internal inbox by the email output setting)" : ""}.`;
                })}>{s.status === "pending" ? "Send" : "Send again"}</button>
                <button type="button" style={btnGhost} onClick={() => onKeyIn(s)}>Enter reply</button>
                <button type="button" style={btnGhost} onClick={() => setUploadFor(uploadFor === s.id ? null : s.id)}>Upload reply sheet</button>
                {s.reply_link && <button type="button" style={btnGhost} onClick={() => run(() => copy(s.reply_link!, "Reply link"))}>Copy reply link</button>}
                {s.whatsapp_text && (
                  <a href={`https://wa.me/${phone}?text=${encodeURIComponent(s.whatsapp_text)}`} target="_blank" rel="noopener noreferrer" style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}
                    onClick={() => fetch(`/api/rfqs/${id}/messages`, json("POST", { rfq_supplier_id: s.id, kind: "note", channel: "whatsapp", body: "Reply link shared on WhatsApp." }))}>
                    WhatsApp
                  </a>
                )}
                <button type="button" style={btnGhost} onClick={() => run(async () => {
                  const email = prompt(`Email address for ${s.suppliers?.name}:`, s.email_to ?? "");
                  if (email === null) return;
                  await call(`/api/rfqs/${id}/suppliers/${s.id}`, json("PATCH", { email_to: email }));
                  return "Email address updated.";
                })}>Change email</button>
                <button type="button" style={btnGhost} onClick={() => run(async () => {
                  if (!confirm("Issue a new reply link? Every link sent to this supplier so far stops working.")) return;
                  await call(`/api/rfqs/${id}/suppliers/${s.id}`, json("PATCH", { action: "new_link" }));
                  return "New link issued — send again so the supplier gets it.";
                })}>New link</button>
                <button type="button" style={{ ...btnGhost, color: "var(--redink)" }} onClick={() => run(async () => {
                  if (s.status === "pending") {
                    await call(`/api/rfqs/${id}/suppliers/${s.id}`, { method: "DELETE" });
                    return "Supplier removed.";
                  }
                  if (!confirm(`Remove ${s.suppliers?.name} from this RFQ? Their link stops working; their replies stay on record.`)) return;
                  await call(`/api/rfqs/${id}/suppliers/${s.id}`, json("PATCH", { action: "remove" }));
                  return "Supplier removed.";
                })}>Remove</button>
              </div>
            )}
            {uploadFor === s.id && (
              <form style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }} onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                run(async () => {
                  const j = await call(`/api/rfqs/${id}/suppliers/${s.id}/responses`, { method: "POST", body: fd });
                  setUploadFor(null);
                  return `${j.saved} line(s) read from the reply sheet.`;
                });
              }}>
                <input type="file" name="file" accept=".xlsx" required style={{ fontSize: 12.5 }} />
                <button type="submit" style={btnPrimary}>Read prices</button>
                <span style={{ fontSize: 12, color: c.hint }}>The Excel sheet attached to the RFQ email, filled in by the supplier.</span>
              </form>
            )}
          </div>
        );
      })}
      {!b.suppliers.length && <div style={{ ...cardStyle, color: c.hint, textAlign: "center" }}>No suppliers yet.</div>}
    </div>
  );
}

function AddSupplierModal({ b, id, onClose, onDone }: { b: Bundle; id: string; onClose: () => void; onDone: (m: string) => void }) {
  const [all, setAll] = useState<{ id: string; name: string; email: string | null; city: string | null; status: string }[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const have = new Set(b.suppliers.map((s) => s.supplier_id));
  useEffect(() => { fetch("/api/suppliers").then((r) => r.json()).then((d) => setAll(Array.isArray(d) ? d : [])).catch(() => {}); }, []);
  const shown = all.filter((s) => !have.has(s.id) && s.status !== "inactive" && (!filter || `${s.name} ${s.city ?? ""}`.toLowerCase().includes(filter.toLowerCase())));
  return (
    <Modal title="Add suppliers" onClose={onClose} width={520}>
      <input style={{ ...inp, marginBottom: 8 }} placeholder="Search suppliers…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div style={{ maxHeight: 320, overflowY: "auto", border: `1px solid ${c.line}`, borderRadius: 8 }}>
        {shown.map((s) => (
          <label key={s.id} style={{ display: "flex", gap: 10, padding: "8px 10px", borderBottom: `1px solid ${c.line}`, fontSize: 13, color: c.ink, cursor: "pointer" }}>
            <input type="checkbox" checked={chosen.includes(s.id)} onChange={() => setChosen((cs) => (cs.includes(s.id) ? cs.filter((x) => x !== s.id) : [...cs, s.id]))} />
            <span><strong>{s.name}</strong> <span style={{ color: c.hint, fontSize: 12 }}>{[s.city, s.email ?? "no email"].filter(Boolean).join(" · ")}</span></span>
          </label>
        ))}
        {!shown.length && <div style={{ padding: 12, color: c.hint, fontSize: 12.5 }}>No more suppliers to add.</div>}
      </div>
      {error && <div role="alert" style={{ color: "var(--redink)", fontSize: 13, marginTop: 8 }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button type="button" style={btnGhost} onClick={onClose}>Cancel</button>
        <button type="button" style={btnPrimary} disabled={!chosen.length} onClick={async () => {
          try {
            const j = await call(`/api/rfqs/${id}/suppliers`, json("POST", { supplier_ids: chosen }));
            onDone(`${j.added} supplier(s) added — press Send to email them.`);
          } catch (e) { setError((e as Error).message); }
        }}>Add {chosen.length || ""}</button>
      </div>
    </Modal>
  );
}

function KeyInModal({ b, rs, id, onClose, onSaved }: { b: Bundle; rs: SupplierRow; id: string; onClose: () => void; onSaved: (m: string) => void }) {
  const lines = b.lines.filter((l) => l.status !== "cancelled");
  const existing = (lineId: string) => b.responses.find((r) => r.rfq_supplier_id === rs.id && r.rfq_line_id === lineId);
  const [rows, setRows] = useState(lines.map((l) => {
    const r = existing(l.id);
    return { rfq_line_id: l.id, status: r?.status ?? "quoted", unit_price: r?.unit_price != null ? String(r.unit_price) : "", lead_time_days: r?.lead_time_days != null ? String(r.lead_time_days) : "", moq: r?.moq != null ? String(r.moq) : "", note: r?.note ?? "" };
  }));
  const [header, setHeader] = useState({ currency: rs.currency ?? b.rfq.currency ?? "", supplier_quote_ref: rs.supplier_quote_ref ?? "", valid_until: rs.valid_until ?? "", incoterm: rs.incoterm ?? "", payment_terms: rs.payment_terms ?? "", freight_amount: rs.freight_amount != null ? String(rs.freight_amount) : "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (declined: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const j = await call(`/api/rfqs/${id}/suppliers/${rs.id}/responses`, json("PUT", { rows: declined ? [] : rows.map((r) => ({ ...r, currency: header.currency })), header: { ...header, freight_amount: header.freight_amount || null }, declined }));
      onSaved(declined ? `${rs.suppliers?.name} marked as declined.` : `${j.saved} line(s) recorded for ${rs.suppliers?.name}.`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal title={`Reply from ${rs.suppliers?.name ?? "supplier"}`} onClose={onClose} width={760}>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", marginBottom: 14 }}>
        <div><label style={lbl}>Currency</label><input style={inp} maxLength={3} value={header.currency} onChange={(e) => setHeader({ ...header, currency: e.target.value.toUpperCase() })} placeholder={b.tenant_currency} /></div>
        <div><label style={lbl}>Their quote ref</label><input style={inp} value={header.supplier_quote_ref} onChange={(e) => setHeader({ ...header, supplier_quote_ref: e.target.value })} /></div>
        <div><label style={lbl}>Valid until</label><input type="date" style={inp} value={header.valid_until} onChange={(e) => setHeader({ ...header, valid_until: e.target.value })} /></div>
        <div><label style={lbl}>Incoterm</label><input style={inp} value={header.incoterm} onChange={(e) => setHeader({ ...header, incoterm: e.target.value })} placeholder="EXW, FOB, DAP…" /></div>
        <div><label style={lbl}>Payment terms</label><input style={inp} value={header.payment_terms} onChange={(e) => setHeader({ ...header, payment_terms: e.target.value })} /></div>
        <div><label style={lbl}>Freight</label><input style={inp} inputMode="decimal" value={header.freight_amount} onChange={(e) => setHeader({ ...header, freight_amount: e.target.value })} /></div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {lines.map((l, i) => {
          const r = rows[i];
          const set = (p: Partial<typeof r>) => setRows((rs2) => rs2.map((x, j) => (j === i ? { ...x, ...p } : x)));
          return (
            <div key={l.id} style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: c.ink, marginBottom: 6 }}>{l.sl_no}. {l.description} <span style={{ color: c.hint, fontWeight: 400 }}>· {l.qty ?? ""} {l.uom ?? ""}</span></div>
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", alignItems: "end" }}>
                <div><label style={lbl}>Unit price</label><input style={inp} inputMode="decimal" disabled={r.status === "no_quote"} value={r.unit_price} onChange={(e) => set({ unit_price: e.target.value })} /></div>
                <div><label style={lbl}>Lead days</label><input style={inp} inputMode="numeric" value={r.lead_time_days} onChange={(e) => set({ lead_time_days: e.target.value })} /></div>
                <div><label style={lbl}>MOQ</label><input style={inp} inputMode="decimal" value={r.moq} onChange={(e) => set({ moq: e.target.value })} /></div>
                <label style={{ fontSize: 12.5, color: c.muted, display: "flex", gap: 6, alignItems: "center", paddingBottom: 8 }}>
                  <input type="checkbox" checked={r.status === "no_quote"} onChange={(e) => set({ status: e.target.checked ? "no_quote" : "quoted", unit_price: e.target.checked ? "" : r.unit_price })} /> Can&apos;t quote
                </label>
              </div>
            </div>
          );
        })}
      </div>
      {error && <div role="alert" style={{ color: "var(--redink)", fontSize: 13, marginTop: 10 }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <button type="button" style={{ ...btnGhost, color: "var(--redink)" }} disabled={busy} onClick={() => save(true)}>Supplier declined</button>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={btnGhost} onClick={onClose}>Cancel</button>
          <button type="button" style={btnPrimary} disabled={busy} onClick={() => save(false)}>{busy ? "Saving…" : "Save reply"}</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Conversation ────────────────────────────────────────────────────────────

function ConversationTab({ b, canEdit, id, run }: { b: Bundle; canEdit: boolean; id: string; run: (fn: () => Promise<string | void>) => void }) {
  const [who, setWho] = useState<string>("all");
  const [kind, setKind] = useState<"email" | "note">("email");
  const [to, setTo] = useState<string>(b.suppliers.find((s) => s.status !== "cancelled")?.id ?? "");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const nameOf = (rsId: string | null) => b.suppliers.find((s) => s.id === rsId)?.suppliers?.name ?? null;
  const msgs = b.messages.filter((m) => who === "all" || m.rfq_supplier_id === who);

  const send = () => run(async () => {
    const fd = new FormData();
    fd.append("kind", kind);
    if (to) fd.append("rfq_supplier_id", to);
    fd.append("body", text);
    for (const f of Array.from(files ?? [])) fd.append("files", f);
    await call(`/api/rfqs/${id}/messages`, { method: "POST", body: fd });
    setText("");
    setFiles(null);
    return kind === "email" ? `Email sent to ${nameOf(to)}.` : "Note saved.";
  });

  return (
    <div style={{ display: "grid", gap: 14, gridTemplateColumns: "minmax(0, 1fr)" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12.5, color: c.hint }}>Show</span>
        <select style={{ ...inp, width: "auto" }} value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="all">Everyone</option>
          {b.suppliers.map((s) => <option key={s.id} value={s.id}>{s.suppliers?.name}</option>)}
        </select>
        <span style={{ fontSize: 12, color: c.hint }}>
          {b.mail_mode === "mailbox" ? "Email goes out from your own mailbox; replies are read from it every few minutes." : "Email goes out from BPMSquare; supplier replies come straight back here."}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {msgs.map((m) => {
          const incoming = m.direction === "in";
          const note = m.direction === "note";
          return (
            <div key={m.id} style={{
              ...cardStyle, padding: "12px 14px", maxWidth: "92%", alignSelf: incoming ? "flex-start" : "flex-end",
              background: note ? "var(--amberbg)" : incoming ? "var(--card-bg)" : "var(--bluebg)",
            }}>
              <div style={{ display: "flex", gap: 8, justifyContent: "space-between", flexWrap: "wrap", fontSize: 12, color: c.hint }}>
                <span style={{ fontWeight: 700, color: c.ink }}>
                  {incoming ? (nameOf(m.rfq_supplier_id) ?? m.from_address ?? "Supplier") : note ? (m.channel === "whatsapp" ? "WhatsApp (logged)" : "Internal note") : `To ${nameOf(m.rfq_supplier_id) ?? (m.to_addresses ?? []).join(", ")}`}
                  {m.channel === "portal" && " · via reply page"}
                  {m.status === "failed" && <span style={{ color: "var(--redink)" }}> · failed</span>}
                  {m.status === "redirected" && " · redirected"}
                </span>
                <span>{fmtDateTime(m.created_at)}</span>
              </div>
              {m.subject && !note && <div style={{ fontSize: 12.5, color: c.muted, marginTop: 4 }}>{m.subject}</div>}
              {m.body_text && <div style={{ fontSize: 13, color: c.ink, marginTop: 6, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 320, overflowY: "auto" }}>{m.body_text}</div>}
              {m.error && <div style={{ fontSize: 12, color: "var(--redink)", marginTop: 4 }}>{m.error}</div>}
              {m.attachments?.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {m.attachments.map((a, i) => a.path ? (
                    <a key={i} href={`/api/rfqs/${id}/attachments?path=${encodeURIComponent(a.path)}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, padding: "3px 9px", borderRadius: 6, border: `1px solid ${c.line}`, color: c.accent, textDecoration: "none", background: c.panel }}>📎 {a.filename}</a>
                  ) : (
                    <span key={i} style={{ fontSize: 12, padding: "3px 9px", borderRadius: 6, border: `1px solid ${c.line}`, color: c.hint }}>📎 {a.filename}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!msgs.length && <div style={{ ...cardStyle, color: c.hint, textAlign: "center" }}>No messages yet. Everything sent to and received from suppliers on this RFQ appears here.</div>}
      </div>

      {canEdit && (
        <div style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select style={{ ...inp, width: "auto" }} value={kind} onChange={(e) => setKind(e.target.value as "email" | "note")}>
              <option value="email">Email supplier</option>
              <option value="note">Internal note</option>
            </select>
            <select style={{ ...inp, width: "auto" }} value={to} onChange={(e) => setTo(e.target.value)}>
              {kind === "note" && <option value="">Whole RFQ</option>}
              {b.suppliers.filter((s) => s.status !== "cancelled").map((s) => <option key={s.id} value={s.id}>{s.suppliers?.name}</option>)}
            </select>
          </div>
          <textarea rows={4} style={{ ...inp, resize: "vertical" }} value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === "email" ? "Write to the supplier — it goes out under this RFQ's reference, so their reply lands back here." : "Visible to your team only."} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            <input type="file" multiple onChange={(e) => setFiles(e.target.files)} style={{ fontSize: 12.5 }} />
            <button type="button" style={btnPrimary} disabled={!text.trim() || (kind === "email" && !to)} onClick={send}>{kind === "email" ? "Send email" : "Save note"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Details ─────────────────────────────────────────────────────────────────

function DetailsTab({ b, canEdit, id, run, isAdmin, onReload }: { b: Bundle; canEdit: boolean; id: string; run: (fn: () => Promise<string | void>) => void; isAdmin: boolean; onReload: () => void }) {
  const { rfq } = b;
  const [f, setF] = useState({
    title: rfq.title, respond_by: rfq.respond_by ?? "", required_by: rfq.required_by ?? "", delivery_terms: rfq.delivery_terms ?? "",
    currency: rfq.currency ?? "", notes_to_supplier: rfq.notes_to_supplier ?? "", notes_internal: rfq.notes_internal ?? "",
  });
  const [nl, setNl] = useState({ description: "", spec: "", qty: "1", uom: "Nos" });
  const grid: React.CSSProperties = { display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 12 }}>
        <div><label style={lbl}>Title</label><input style={inp} disabled={!canEdit} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        <div style={grid}>
          <div><label style={lbl}>Reply by</label><input type="date" style={inp} disabled={!canEdit} value={f.respond_by} onChange={(e) => setF({ ...f, respond_by: e.target.value })} /></div>
          <div><label style={lbl}>Needed by</label><input type="date" style={inp} disabled={!canEdit} value={f.required_by} onChange={(e) => setF({ ...f, required_by: e.target.value })} /></div>
          <div><label style={lbl}>Delivery terms</label><input style={inp} disabled={!canEdit} value={f.delivery_terms} onChange={(e) => setF({ ...f, delivery_terms: e.target.value })} /></div>
          <div><label style={lbl}>Preferred currency</label><input style={inp} disabled={!canEdit} maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} placeholder={b.tenant_currency} /></div>
        </div>
        <div style={grid}>
          <div><label style={lbl}>Note to suppliers</label><textarea rows={3} style={{ ...inp, resize: "vertical" }} disabled={!canEdit} value={f.notes_to_supplier} onChange={(e) => setF({ ...f, notes_to_supplier: e.target.value })} /></div>
          <div><label style={lbl}>Internal note</label><textarea rows={3} style={{ ...inp, resize: "vertical" }} disabled={!canEdit} value={f.notes_internal} onChange={(e) => setF({ ...f, notes_internal: e.target.value })} /></div>
        </div>
        {canEdit && <div style={{ display: "flex", justifyContent: "flex-end" }}><button type="button" style={btnPrimary} onClick={() => run(async () => { await call(`/api/rfqs/${id}`, json("PATCH", f)); return "Saved."; })}>Save</button></div>}
      </div>

      <div style={cardStyle}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: c.ink, marginBottom: 8 }}>Lines</div>
        {b.lines.map((l) => (
          <div key={l.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderTop: `1px solid ${c.line}`, fontSize: 13, opacity: l.status === "cancelled" ? 0.5 : 1 }}>
            <span style={{ color: c.hint, minWidth: 22 }}>{l.sl_no}.</span>
            <span style={{ flex: 1, minWidth: 0, color: c.ink }}>{l.description}{l.spec ? <span style={{ color: c.hint }}> — {l.spec}</span> : null}</span>
            <span style={{ color: c.muted, whiteSpace: "nowrap" }}>{l.qty ?? ""} {l.uom ?? ""}</span>
            {canEdit && (
              <button type="button" style={{ ...btnGhost, padding: "3px 9px", fontSize: 11.5 }} onClick={() => run(async () => {
                await call(`/api/rfqs/${id}/lines`, json("PATCH", { line_id: l.id, action: l.status === "cancelled" ? "reopen" : "cancel" }));
                return l.status === "cancelled" ? "Line restored." : "Line withdrawn.";
              })}>{l.status === "cancelled" ? "Restore" : "Withdraw"}</button>
            )}
          </div>
        ))}
        {canEdit && (
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "minmax(0,3fr) minmax(0,2fr) 80px 90px auto", marginTop: 10, alignItems: "end" }} className="rfq-addline">
            <input style={inp} placeholder="Add a line — description" value={nl.description} onChange={(e) => setNl({ ...nl, description: e.target.value })} />
            <input style={inp} placeholder="Specification" value={nl.spec} onChange={(e) => setNl({ ...nl, spec: e.target.value })} />
            <input style={inp} inputMode="decimal" value={nl.qty} onChange={(e) => setNl({ ...nl, qty: e.target.value })} aria-label="Quantity" />
            <input style={inp} value={nl.uom} onChange={(e) => setNl({ ...nl, uom: e.target.value })} aria-label="Unit" />
            <button type="button" style={btnGhost} disabled={!nl.description.trim()} onClick={() => run(async () => {
              if (rfq.status === "draft") {
                await call(`/api/rfqs/${id}/lines`, json("PUT", { lines: [...b.lines.filter((l) => l.status !== "cancelled").map((l) => ({ product_id: l.product_id, description: l.description, spec: l.spec, uom: l.uom, qty: l.qty, required_by: l.required_by, cost_model_code: l.cost_model_code, path: l.path })), nl] }));
              } else {
                await call(`/api/rfqs/${id}/lines`, json("POST", { line: nl }));
              }
              setNl({ description: "", spec: "", qty: "1", uom: "Nos" });
              return rfq.status === "draft" ? "Line added." : "Line added — send again so suppliers see it.";
            })}>Add</button>
          </div>
        )}
        <style>{`@media (max-width: 760px) { .rfq-addline { grid-template-columns: 1fr !important; } }`}</style>
      </div>
      {/* The tenant's own custom fields on the RFQ header -- the standard
          ones are the form above, so only cf_ fields render here. */}
      <ObjectSections
        objectType="rfq"
        record={b.rfq as unknown as Record<string, unknown>}
        patchUrl={`/api/rfqs/${id}`}
        onSaved={onReload}
        exclude={["ref", "title", "status", "origin_label", "delivery_terms", "currency", "respond_by", "required_by", "notes_to_supplier", "notes_internal"]}
      />
      {isAdmin && <div style={{ fontSize: 12, color: c.hint }}>Mail channel, reply window and supplier terms are set in Settings → RFQ.</div>}
    </div>
  );
}

// ── Awards -> purchase orders ───────────────────────────────────────────────

type PoRow = { id: string; ref: string; status: string; total: number; suppliers: { name: string } | null };

function PurchaseOrdersPanel({ id, canEdit, version, run }: { id: string; canEdit: boolean; version: number; run: (fn: () => Promise<string | void>) => void }) {
  const [info, setInfo] = useState<{ purchasing: boolean; pending_migration: boolean; purchase_orders: PoRow[]; to_order: number } | null>(null);
  const reload = useCallback(() => {
    fetch(`/api/rfqs/${id}/purchase-orders`).then((r) => (r.ok ? r.json() : null)).then(setInfo).catch(() => {});
  }, [id]);
  useEffect(() => { reload(); }, [reload, version]);
  if (!info || !info.purchasing || (!info.purchase_orders.length && !info.to_order && !info.pending_migration)) return null;
  return (
    <div style={{ ...cardStyle, marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: c.ink }}>Purchase orders</div>
          <div style={{ fontSize: 12.5, color: c.hint, marginTop: 2 }}>
            {info.pending_migration ? "Raising purchase orders from an RFQ needs the database update (migration 0130)." : info.to_order ? `${info.to_order} awarded line${info.to_order === 1 ? "" : "s"} not on a purchase order yet — one draft PO per supplier, at the awarded cost.` : "Every awarded line is on a purchase order."}
          </div>
        </div>
        {canEdit && info.to_order > 0 && !info.pending_migration && (
          <button type="button" style={btnPrimary} onClick={() => run(async () => {
            const j = await call(`/api/rfqs/${id}/purchase-orders`, json("POST", {}));
            reload();
            return `Draft purchase order${j.created.length === 1 ? "" : "s"} ${j.created.map((x: { ref: string; supplier: string }) => `${x.ref} (${x.supplier})`).join(", ")} created — check and send from Purchase Orders.`;
          })}>Create purchase orders</button>
        )}
      </div>
      {info.purchase_orders.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {info.purchase_orders.map((po) => (
            <Link key={po.id} href={`/purchase-orders/${po.id}`} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 2px", borderTop: `1px solid ${c.line}`, textDecoration: "none", color: c.ink, fontSize: 13 }}>
              <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11.5, color: c.hint, minWidth: 90 }}>{po.ref}</span>
              <span style={{ flex: 1 }}>{po.suppliers?.name ?? ""}</span>
              <span style={{ color: c.muted, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(Number(po.total))}</span>
              <Pill label={po.status} tone={po.status === "received" ? "green" : po.status === "cancelled" ? "red" : "blue"} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
