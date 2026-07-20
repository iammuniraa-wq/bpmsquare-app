"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { c } from "@/lib/theme";
import type { Quote, QuoteLine, Account, Contact } from "@/lib/types";
import type { TenantTaxConfig, QuoteStatusDef } from "@/lib/constants";
import { OFFER_TYPE_LABEL, DEFAULT_QUOTE_STATUSES, ROUTES } from "@/lib/constants";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import ComingSoon from "@/components/ComingSoon";
import { MessageSquare } from "@/components/Icons";
import QuoteEditPanel from "@/components/QuoteEditPanel";
import ObjectSections from "@/components/fields/ObjectSections";
import AdaptObjectDrawer from "@/components/AdaptObjectDrawer";

// ── Status helpers ────────────────────────────────────────────────────────────

function statusDef(statuses: QuoteStatusDef[], value: string): QuoteStatusDef {
  return statuses.find((s) => s.value === value) ?? { value, label: value, color: "#94a3b8" };
}

function StatusPill({ status, statuses }: { status: string; statuses: QuoteStatusDef[] }) {
  const def = statusDef(statuses, status);
  return (
    <span style={{
      display: "inline-block", padding: "3px 12px", borderRadius: 12,
      fontSize: 12, fontWeight: 600,
      background: `${def.color}22`, color: def.color, border: `1px solid ${def.color}55`,
    }}>
      {def.label}
    </span>
  );
}

function StatusChanger({ quoteId, currentStatus, statuses, onChanged }: {
  quoteId: string; currentStatus: string; statuses: QuoteStatusDef[]; onChanged: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const def = statusDef(statuses, currentStatus);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function change(value: string) {
    if (value === currentStatus) { setOpen(false); return; }
    setSaving(true);
    const res = await fetch(`/api/quotes/${quoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: value }),
    });
    setSaving(false);
    if (res.ok) { onChanged(value); setOpen(false); }
  }

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={saving}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "3px 12px 3px 10px", borderRadius: 12,
          fontSize: 12, fontWeight: 600, cursor: "pointer",
          background: `${def.color}22`, color: def.color, border: `1px solid ${def.color}55`,
        }}
      >
        {saving ? "…" : def.label} <span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 50,
          background: c.panel, border: `1px solid ${c.line}`, borderRadius: 10,
          boxShadow: "0 8px 24px rgba(0,0,0,.15)", minWidth: 160, overflow: "hidden",
        }}>
          {statuses.map((s) => (
            <button
              key={s.value}
              onClick={() => change(s.value)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "9px 14px", border: "none", cursor: "pointer",
                background: s.value === currentStatus ? `${s.color}15` : "transparent",
                color: s.value === currentStatus ? s.color : c.ink,
                fontSize: 13, fontWeight: s.value === currentStatus ? 700 : 400,
                textAlign: "left",
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
              {s.label}
              {s.value === currentStatus && <span style={{ marginLeft: "auto", fontSize: 11 }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const ACCT_LABEL: Record<string, string> = {
  prospect: "Prospect", oem: "OEM / Vendor",
  direct: "Direct customer", end_customer: "End-customer (under OEM)",
};
const ACCT_TONE: Record<string, "amber" | "purple" | "green" | "teal"> = {
  prospect: "amber", oem: "purple", direct: "green", end_customer: "teal",
};

// ── Types ─────────────────────────────────────────────────────────────────────

type WOItem = { id: string; ref: string; status: string };

interface Props {
  quote: Quote & { custom_data?: Record<string, unknown> | null };
  account: Account | null;
  contact: Contact | null;
  lines: QuoteLine[];
  workOrders: WOItem[];
  tenantTax?: TenantTaxConfig;
  quoteStatuses?: QuoteStatusDef[];
  existingInvoice?: { id: string; ref: string } | null;
  isAdmin: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 500,
  padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 11.5,
};
const td: React.CSSProperties = {
  padding: "10px 12px", borderBottom: `1px solid ${c.line}`,
  fontSize: 12.5, verticalAlign: "top",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function QuoteDetailLayout({
  quote, account, contact, lines, workOrders, tenantTax,
  quoteStatuses = DEFAULT_QUOTE_STATUSES, existingInvoice = null, isAdmin,
}: Props) {
  const router = useRouter();
  const isTechnical = quote.type === "technical";
  const [currentStatus, setCurrentStatus] = useState<string>(quote.status);
  useEffect(() => { setCurrentStatus(quote.status); }, [quote.status]);
  // CR-010: GST is optional per quote — no rate entered means no tax row at all
  // (the "GST @ 18%" statement lives in Terms & Conditions text instead).
  const hasGst      = quote.gst_rate !== null && quote.gst_rate !== undefined;
  const taxRate     = quote.gst_rate ?? 0;
  const taxLabel    = tenantTax?.label ?? "GST";
  const subtotal    = lines.reduce((s, l) => s + l.amount, 0);
  const gst         = hasGst ? Math.round(subtotal * taxRate / 100) : 0;
  const grandTotal  = subtotal + gst;

  // ── Revisions (sibling quotes sharing same base ref) ────────────────────────
  type RevRow = { id: string; ref: string; status: string; revision: number; created_at: string };
  const [revisions, setRevisions] = useState<RevRow[]>([]);
  useEffect(() => {
    fetch(`/api/quotes/${quote.id}/revisions`)
      .then(r => r.ok ? r.json() : [])
      .then((data: RevRow[]) => setRevisions(data))
      .catch(() => {});
  }, [quote.id]);

  const [moreOpen, setMoreOpen]     = useState(false);
  const [copying, setCopying]       = useState(false);
  const [converting, setConverting] = useState(false);
  const moreRef                     = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: MouseEvent) => { if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [moreOpen]);

  return (
    <>
      {/* Page action bar */}
      <div style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Link href={ROUTES.quotations} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>← All quotations</Link>
        <StatusChanger quoteId={quote.id} currentStatus={currentStatus} statuses={quoteStatuses} onChanged={setCurrentStatus} />

        {currentStatus === "approved" && (
          existingInvoice ? (
            <Link
              href={ROUTES.invoice(existingInvoice.id)}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, background: c.accentbg, color: c.accent, borderRadius: 7, padding: "6px 14px", fontSize: 12.5, fontWeight: 600, textDecoration: "none" }}
            >
              View invoice {existingInvoice.ref}
            </Link>
          ) : (
            <button
              onClick={async () => {
                setConverting(true);
                const res = await fetch(`/api/quotes/${quote.id}/convert-to-invoice`, { method: "POST" });
                setConverting(false);
                if (res.ok) { const j = await res.json(); router.push(ROUTES.invoice(j.id)); }
              }}
              disabled={converting}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#1d9e75", color: "#fff", borderRadius: 7, padding: "6px 14px", fontSize: 12.5, fontWeight: 600, border: "none", cursor: converting ? "wait" : "pointer" }}
            >
              {converting ? "Converting…" : "⊟ Convert to Invoice"}
            </button>
          )
        )}

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <AdaptObjectDrawer objectType="quote" objectLabel="Quote" isAdmin={isAdmin} />
          <QuoteEditPanel quote={quote} quoteStatuses={quoteStatuses} />

          {/* More dropdown */}
          <div ref={moreRef} style={{ position: "relative" }}>
            <button
              onClick={() => setMoreOpen((o) => !o)}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, background: c.panel2, color: c.ink, border: `1px solid ${c.line}`, borderRadius: 7, padding: "6px 14px", fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}
            >
              More <span style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
            </button>
            {moreOpen && (
              <div style={{
                position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 100,
                background: c.panel, border: `1px solid ${c.line}`, borderRadius: 10,
                boxShadow: "0 8px 24px rgba(0,0,0,.15)", minWidth: 200, overflow: "hidden",
              }}>
                <Link
                  href={ROUTES.quotationPrint(quote.id)}
                  target="_blank"
                  rel="noopener"
                  onClick={() => setMoreOpen(false)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", fontSize: 13, color: c.ink, textDecoration: "none", borderBottom: `1px solid ${c.line}` }}
                >
                  <span style={{ fontSize: 15 }}>↓</span> Download PDF
                </Link>
                <Link
                  href={`/api/quotes/${quote.id}/export`}
                  onClick={() => setMoreOpen(false)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", fontSize: 13, color: c.ink, textDecoration: "none", borderBottom: `1px solid ${c.line}` }}
                >
                  <span style={{ fontSize: 15 }}>↓</span> Download CSV
                </Link>
                <button
                  onClick={async () => {
                    setMoreOpen(false);
                    setCopying(true);
                    const res = await fetch(`/api/quotes/${quote.id}/copy`, { method: "POST" });
                    setCopying(false);
                    if (res.ok) { const j = await res.json(); router.push(ROUTES.quotation(j.id)); }
                  }}
                  style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "11px 16px", fontSize: 13, color: c.ink, background: "none", border: "none", borderBottom: `1px solid ${c.line}`, cursor: "pointer", textAlign: "left" }}
                >
                  <span style={{ fontSize: 15 }}>⎘</span> {copying ? "Copying…" : "Copy quote"}
                </button>
                <div style={{ padding: "11px 16px", borderBottom: `1px solid ${c.line}`, display: "flex", alignItems: "center", gap: 10, cursor: "not-allowed", opacity: 0.5 }}>
                  <span style={{ fontSize: 13 }}>✉</span>
                  <span style={{ fontSize: 13, color: c.ink }}>Email quote</span>
                  <ComingSoon size="xs" />
                </div>
                <div style={{ padding: "11px 16px", display: "flex", alignItems: "center", gap: 10, cursor: "not-allowed", opacity: 0.5 }}>
                  <MessageSquare size={13} color={c.ink} />
                  <span style={{ fontSize: 13, color: c.ink }}>WhatsApp</span>
                  <ComingSoon size="xs" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main grid */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 260px", gap: 12 }} className="hub-grid">

        {/* Left */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <ObjectSections
            objectType="quote"
            record={quote as unknown as Record<string, unknown>}
            patchUrl={`/api/quotes/${quote.id}`}
          />

          <section style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
            <div style={{ padding: "12px 14px 10px", borderBottom: `1px solid ${c.line}` }}>
              <h3 style={{ fontSize: 13, margin: 0, fontWeight: 600 }}>Scope of work</h3>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 28 }}>#</th>
                  <th style={th}>Description</th>
                  <th style={{ ...th, textAlign: "right", whiteSpace: "nowrap" }}>Qty</th>
                  <th style={{ ...th, textAlign: "right", whiteSpace: "nowrap" }}>Rate (₹)</th>
                  <th style={{ ...th, textAlign: "right", whiteSpace: "nowrap" }}>Amount (₹)</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={line.id}>
                    <td style={{ ...td, color: c.hint, fontSize: 11 }}>{i + 1}</td>
                    <td style={td}>{line.description}</td>
                    <td style={{ ...td, textAlign: "right", color: c.muted }}>{line.qty}</td>
                    <td style={{ ...td, textAlign: "right", color: c.muted }}>{line.rate.toLocaleString("en-IN")}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 500 }}>{inr(line.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!isTechnical && (
              <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", borderTop: `1px solid ${c.line}` }}>
                <TotalRow label="Subtotal"                value={inr(subtotal)} />
                {hasGst && <TotalRow label={`${taxLabel} @ ${taxRate}%`} value={inr(gst)} muted />}
                <div style={{ display: "flex", justifyContent: "space-between", width: 220, paddingTop: 8, borderTop: `2px solid ${c.ink}` }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Grand total</span>
                  <span style={{ fontSize: 15, fontWeight: 600, color: c.accent }}>{inr(grandTotal)}</span>
                </div>
              </div>
            )}
          </section>

          {workOrders.length > 0 && (
            <section style={cardStyle}>
              <h3 style={{ fontSize: 13, margin: "0 0 10px", fontWeight: 600 }}>Work order — authorized by this quote</h3>
              {workOrders.map(wo => (
                <div key={wo.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: `1px solid ${c.line}`, fontSize: 12.5 }}>
                  <span style={{ fontWeight: 600, fontFamily: "monospace" }}>{wo.ref}</span>
                  <Pill label={wo.status.replace("_", " ")} tone="amber" />
                </div>
              ))}
            </section>
          )}
        </div>

        {/* Right — fixed sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {account && (
            <section style={cardStyle}>
              <h3 style={{ fontSize: 13, margin: "0 0 12px", fontWeight: 600 }}>Account</h3>
              <Link href={ROUTES.account(account.id)} style={{ fontSize: 14, fontWeight: 600, color: c.accent, display: "block", marginBottom: 4 }}>{account.name}</Link>
              <Pill label={ACCT_LABEL[account.type]} tone={ACCT_TONE[account.type]} />
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                {account.city  && <Detail label="City"  value={account.city} />}
                {account.phone && <Detail label="Phone" value={account.phone} />}
                {account.email && <Detail label="Email" value={account.email} />}
              </div>
            </section>
          )}

          {contact && (
            <section style={cardStyle}>
              <h3 style={{ fontSize: 13, margin: "0 0 10px", fontWeight: 600 }}>Contact</h3>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{contact.name}</div>
              {contact.role && <div style={{ fontSize: 12, color: c.muted, marginBottom: 8 }}>{contact.role}</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {contact.phone && <Detail label="Phone" value={contact.phone} />}
                {contact.email && <Detail label="Email" value={contact.email} />}
              </div>
            </section>
          )}

          {revisions.length > 1 && (
            <section style={cardStyle}>
              <h3 style={{ fontSize: 13, margin: "0 0 10px", fontWeight: 600 }}>Versions · {revisions.length}</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {revisions.map((rev) => {
                  const isCurrent = rev.id === quote.id;
                  return (
                    <div key={rev.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 8px", borderRadius: 7, background: isCurrent ? c.accentbg : "transparent", border: isCurrent ? `1px solid ${c.accent}40` : "1px solid transparent" }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: isCurrent ? 700 : 500, fontFamily: "monospace", color: isCurrent ? c.accent : c.ink }}>{rev.ref}</div>
                        <div style={{ fontSize: 10.5, color: c.hint, marginTop: 1 }}>
                          {new Date(rev.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Pill label={rev.status.charAt(0).toUpperCase() + rev.status.slice(1)} tone={rev.status === "approved" ? "green" : rev.status === "rejected" ? "red" : rev.status === "sent" ? "purple" : "blue"} />
                        {!isCurrent && (
                          <Link href={ROUTES.quotation(rev.id)} style={{ fontSize: 11, color: c.accent, textDecoration: "none", fontWeight: 600 }}>View →</Link>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section style={cardStyle}>
            <h3 style={{ fontSize: 13, margin: "0 0 10px", fontWeight: 600 }}>Summary</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Detail label="Line items" value={String(lines.length)} />
              <Detail label="Offer type" value={OFFER_TYPE_LABEL[quote.type] ?? quote.type} />
              {!isTechnical && <>
                <Detail label="Subtotal"              value={inr(subtotal)} />
                {hasGst && <Detail label={`${taxLabel} ${taxRate}%`} value={inr(gst)} />}
                <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, borderTop: `1px solid ${c.line}`, fontSize: 13, fontWeight: 600 }}>
                  <span>Total</span>
                  <span style={{ color: c.accent }}>{inr(grandTotal)}</span>
                </div>
              </>}
            </div>
          </section>

        </div>
      </div>
    </>
  );
}

// ── Small helper components ───────────────────────────────────────────────────

function TotalRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", width: 220, fontSize: 12.5 }}>
      <span style={{ color: muted ? c.muted : c.ink }}>{label}</span>
      <span style={{ color: muted ? c.muted : c.ink }}>{value}</span>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
      <span style={{ color: c.muted }}>{label}</span>
      <span style={{ textAlign: "right" }}>{value}</span>
    </div>
  );
}
