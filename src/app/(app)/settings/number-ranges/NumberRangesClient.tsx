"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { DEFAULT_QUOTE_ID_FORMAT, type QuoteIdFormat, type TenantConfig, type TenantFeatures } from "@/lib/constants";
import { formatQuoteRef } from "@/lib/quoteRefFormat";

// The single home for business-ID configuration. Quotations are fully
// configurable today (moved here from Settings → Entities & Tax); every
// other object shows its system convention read-only until per-object
// configuration ships. Changing a format never rewrites existing records —
// it applies to new IDs only.

const lbl: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 700, color: c.hint,
  textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4,
};
const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 7,
  border: `1px solid ${c.line}`, fontSize: 13, background: c.panel, color: c.ink, outline: "none",
};
const mono: React.CSSProperties = { fontFamily: "monospace" };
const th: React.CSSProperties = { textAlign: "left", fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4, padding: "7px 8px", borderBottom: `1px solid ${c.line}` };
const td: React.CSSProperties = { fontSize: 12.5, color: c.ink, padding: "7px 8px", borderBottom: `1px solid ${c.line}` };

// System-fixed conventions (generation code is the source of truth for each):
// masterRef.ts, employeeRef.ts, invoiceRef.ts, poRef.ts, standardQuoteRef.ts,
// api/cases (CS-). Listed here so admins have ONE page that answers "what
// will the next ID look like" for every object.
const FIXED_RANGES: { object: string; example: string; reset: string; note?: string; feature: keyof TenantFeatures }[] = [
  { object: "Accounts", example: "ACC-0001", reset: "Never", feature: "accounts" },
  { object: "Contacts", example: "CON-0001", reset: "Never", feature: "contacts" },
  { object: "Assets", example: "AST-0001", reset: "Never", feature: "assets" },
  { object: "Suppliers", example: "SUP-0001", reset: "Never", feature: "suppliers" },
  { object: "Inventory items", example: "INV-0001", reset: "Never", feature: "purchasing" },
  { object: "Employees", example: "EMP-0001", reset: "Never", note: "Immutable after creation", feature: "business_roles" },
  { object: "Standard Quotes", example: "SQ-2026-0001", reset: "Yearly", feature: "standard_quotes" },
  { object: "Invoices", example: "INV-2026-0001", reset: "Yearly", feature: "invoices" },
  { object: "Purchase Orders", example: "PO-2026-0001", reset: "Yearly", feature: "purchasing" },
  { object: "Cases", example: "CS-2026-0001", reset: "Yearly", feature: "cases" },
];

export default function NumberRangesClient({ features = {} }: { features?: Partial<TenantFeatures> }) {
  const showQuoteFormat = features.quotations === true;
  const visibleRanges = FIXED_RANGES.filter((r) => features[r.feature] === true);
  const [fmt, setFmt] = useState<QuoteIdFormat>(DEFAULT_QUOTE_ID_FORMAT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!showQuoteFormat) { setLoading(false); return; }
    fetch("/api/settings/entities")
      .then((r) => r.json())
      .then((cfg: TenantConfig) => setFmt({ ...DEFAULT_QUOTE_ID_FORMAT, ...(cfg.quote_id_format ?? {}) }))
      .catch(() => setError("Could not load the current Quote ID format"))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/settings/entities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote_id_format: fmt } as Partial<TenantConfig>),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Failed to save");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(`Could not reach the server: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 860 }}>
      {/* ── Quotations: configurable (hidden for tenants without the module) ── */}
      {showQuoteFormat && <section style={cardStyle}>
        <h2 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 600, color: c.ink }}>Quotations — configurable</h2>
        <p style={{ margin: "0 0 16px", fontSize: 12, color: c.muted, lineHeight: 1.5 }}>
          Tokens: <code style={mono}>{"{PREFIX}"}</code> <code style={mono}>{"{YYYY}"}</code> <code style={mono}>{"{YY}"}</code>{" "}
          <code style={mono}>{"{MM}"}</code> <code style={mono}>{"{SEQ}"}</code>. Applies to new quotations only.
        </p>

        {loading ? (
          <div style={{ fontSize: 12.5, color: c.hint }}>Loading…</div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px", marginBottom: 12 }}>
              <div>
                <label style={lbl}>Prefix</label>
                <input style={inp} value={fmt.prefix} placeholder="QT"
                  onChange={(e) => setFmt((f) => ({ ...f, prefix: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Template</label>
                <input style={{ ...inp, ...mono }} value={fmt.template} placeholder="{PREFIX}-{YYYY}-{SEQ}"
                  onChange={(e) => setFmt((f) => ({ ...f, template: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px", marginBottom: 12 }}>
              <div>
                <label style={lbl}>Sequence digits</label>
                <input style={inp} type="number" min={2} max={6} value={fmt.seq_digits}
                  onChange={(e) => setFmt((f) => ({ ...f, seq_digits: Math.min(6, Math.max(2, parseInt(e.target.value) || 4)) }))} />
              </div>
              <div>
                <label style={lbl}>Sequence resets</label>
                <select style={inp} value={fmt.reset}
                  onChange={(e) => setFmt((f) => ({ ...f, reset: e.target.value as QuoteIdFormat["reset"] }))}>
                  <option value="yearly">Every year</option>
                  <option value="never">Never — keep counting</option>
                </select>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 14, paddingTop: 12, borderTop: `1px solid ${c.line}` }}>
              <div>
                <label style={lbl}>Example</label>
                <div style={{ ...mono, fontSize: 15, fontWeight: 600, color: c.ink }}>{formatQuoteRef(fmt, new Date(), 1)}</div>
              </div>
              <span style={{ flex: 1 }} />
              <button
                onClick={save} disabled={saving}
                style={{ padding: "8px 18px", borderRadius: 7, border: "none", background: c.accent, color: "#fff", fontWeight: 600, fontSize: 12.5, cursor: saving ? "not-allowed" : "pointer" }}
              >
                {saving ? "Saving…" : saved ? "✓ Saved" : "Save"}
              </button>
            </div>
            {error && <div style={{ fontSize: 12, color: "var(--err-ink)", marginTop: 8 }}>{error}</div>}
          </>
        )}
      </section>}

      {/* ── System-fixed ranges ── */}
      <section style={cardStyle}>
        <h2 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 600, color: c.ink }}>System-managed ranges</h2>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: c.muted, lineHeight: 1.5 }}>
          These IDs are generated automatically with the conventions below and are never user-editable. Per-object format
          configuration (like Quotations above) is planned; the range itself will remain system-owned.
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr><th style={th}>Object</th><th style={th}>Format</th><th style={th}>Sequence resets</th><th style={th}></th></tr>
          </thead>
          <tbody>
            {visibleRanges.map((r) => (
              <tr key={r.object}>
                <td style={td}>{r.object}</td>
                <td style={{ ...td, ...mono }}>{r.example}</td>
                <td style={td}>{r.reset}</td>
                <td style={{ ...td, fontSize: 11.5, color: c.hint }}>{r.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
