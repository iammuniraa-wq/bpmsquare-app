"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { useFeel } from "@/components/FeelProvider";
import { ROUTES, LOSS_REASONS, LOSS_REASON_LABEL, type OpportunityStageDef } from "@/lib/constants";
import type { Opportunity, OpportunityLine } from "@/lib/types";
import { daysBetween, weightedValue, isClosedStage, outcomeForStage, OPPORTUNITY_SOURCES, OPPORTUNITY_SOURCE_LABEL, TEAM_ROLES, TEAM_ROLE_LABEL, type TeamRole } from "@/lib/sales/opportunity";
import type { LinkedQuote } from "@/lib/sales/opportunityServer";
import { documentTotal } from "@/lib/sales/lineTotals";
import DocumentLinesEditor, { newLine, lineAmount, type Line, type StandardQuoteProduct } from "@/components/sales/DocumentLinesEditor";

// The deal page (§4.5): header with the stage, the money and the people;
// tabs Overview · Lines · Quotes. "Win this deal" and "Approvals" arrive
// with pieces E and C; the Nova timeline under the page is Activity.

type Member = { user_id: string; name: string | null; email: string | null };
type Tab = "overview" | "lines" | "quotes";

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const lbl: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 };
const inp: React.CSSProperties = { width: "100%", padding: "8px 10px", fontSize: 13, border: `1px solid ${c.line}`, borderRadius: 7, background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box" };
const btn = (kind: "primary" | "ghost" | "danger"): React.CSSProperties => ({
  padding: "8px 14px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
  background: kind === "primary" ? c.accent : "transparent", color: kind === "primary" ? "#fff" : kind === "danger" ? "var(--red)" : c.muted,
  border: kind === "primary" ? "none" : `1px solid ${kind === "danger" ? "#f5c0c0" : c.line}`,
});

function toEditorLines(rows: OpportunityLine[]): Line[] {
  return rows.map((l) => ({
    id: l.id, description: l.description, uom: l.uom ?? "Nos", qty: String(l.qty), rate: String(l.rate), discount_pct: String(l.discount_pct),
    product_id: l.product_id ?? "", pricing_document_id: l.pricing_document_id ?? "",
    group_id: l.group_id ?? "", group_label: l.group_label ?? "", group_type: l.group_type === "alternative" ? "alternative" : "",
    break_of: l.break_of ?? "", break_qty: l.break_qty != null ? String(l.break_qty) : "",
    is_selected: l.is_selected !== false, show_on_pdf: l.show_on_pdf !== false,
  }));
}

export default function OpportunityDetailClient({ opp, accountName, contacts, initialLines, quotes, stages, members, products, pricingEnabled, standardQuotesEnabled, todayKey, currentUserId }: {
  opp: Opportunity & { stage_since: string };
  accountName: string;
  contacts: { id: string; name: string }[];
  initialLines: OpportunityLine[];
  quotes: LinkedQuote[];
  stages: OpportunityStageDef[];
  members: Member[];
  products: StandardQuoteProduct[];
  pricingEnabled: boolean;
  standardQuotesEnabled: boolean;
  todayKey: string;
  currentUserId: string;
}) {
  const router = useRouter();
  const { confirm } = useFeel();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>(initialLines.length === 0 && quotes.length === 0 ? "overview" : "lines");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Header fields, saved together.
  const [form, setForm] = useState({
    title: opp.title, description: opp.description ?? "", contact_id: opp.contact_id ?? "", expected_close: opp.expected_close ?? "",
    owner_id: opp.owner_id ?? "", source: opp.source ?? "direct", competitor: opp.competitor ?? "",
    probability_override: opp.probability_override != null ? String(opp.probability_override) : "", probability_override_reason: opp.probability_override_reason ?? "",
    team: (opp.team ?? []) as { user_id: string; role: string }[],
  });
  const [closing, setClosing] = useState<{ stage: string; outcome: "won" | "lost" | "dropped"; loss_reason: string; loss_note: string } | null>(null);

  // Lines tab: the shared editor, saved as one PUT.
  const [lines, setLines] = useState<Line[]>(initialLines.length > 0 ? toEditorLines(initialLines) : [newLine()]);
  const [savedLinesKey, setSavedLinesKey] = useState(JSON.stringify(lines));
  const linesDirty = JSON.stringify(lines) !== savedLinesKey;
  const linesTotal = documentTotal(lines.map((l) => ({ id: l.id, amount: lineAmount(l), group_id: l.group_id || null, group_type: l.group_type || null, break_of: l.break_of || null, is_selected: l.is_selected })));

  const stageDefNow = stages.find((s) => s.value === opp.stage);
  const closed = isClosedStage(stages, opp.stage) || opp.outcome !== "open";
  const memberName = (id: string | null) => { const m = members.find((x) => x.user_id === id); return m?.name ?? m?.email ?? "—"; };

  async function patch(body: Record<string, unknown>, okMessage?: string) {
    setError(""); setNotice("");
    const res = await fetch(`/api/opportunities/${opp.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setError(j.error ?? "Could not save"); return false; }
    if (okMessage) setNotice(okMessage);
    router.refresh();
    return true;
  }

  function saveHeader() {
    startTransition(async () => {
      await patch({
        title: form.title, description: form.description, contact_id: form.contact_id || null, expected_close: form.expected_close || null,
        owner_id: form.owner_id || null, source: form.source, competitor: form.competitor,
        probability_override: form.probability_override === "" ? null : Number(form.probability_override),
        probability_override_reason: form.probability_override_reason, team: form.team,
      }, "Saved");
    });
  }

  function changeStage(stage: string) {
    if (stage === opp.stage) return;
    if (isClosedStage(stages, stage)) {
      const implied = outcomeForStage(stages, stage);
      setClosing({ stage, outcome: implied === "open" ? "won" : implied, loss_reason: "price", loss_note: "" });
      return;
    }
    startTransition(async () => { await patch({ stage, outcome: "open" }); });
  }

  function saveLines() {
    const clean = lines.filter((l) => l.description.trim());
    startTransition(async () => {
      setError(""); setNotice("");
      const res = await fetch(`/api/opportunities/${opp.id}/lines`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: clean.map((l) => ({
          local_id: l.id, description: l.description, uom: l.uom, qty: l.qty, rate: l.rate, discount_pct: l.discount_pct,
          product_id: l.product_id || null, pricing_document_id: l.pricing_document_id || null,
          group_id: l.group_id || null, group_label: l.group_label || null, group_type: l.group_type || null,
          break_of: l.break_of || null, break_qty: l.break_qty ? parseFloat(l.break_qty) || null : null,
          is_selected: l.is_selected, show_on_pdf: l.show_on_pdf,
        })) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not save the lines"); return; }
      const next = toEditorLines((j.lines ?? []) as OpportunityLine[]);
      setLines(next.length ? next : [newLine()]);
      setSavedLinesKey(JSON.stringify(next.length ? next : [newLine()]));
      setNotice(`Lines saved · deal amount ${inr(j.amount ?? 0)}`);
      router.refresh();
    });
  }

  function convert() {
    startTransition(async () => {
      if (linesDirty && !(await confirm({ title: "Save the lines first?", body: "The quote is created from the SAVED lines. Unsaved edits here won't be on it.", confirmLabel: "Convert anyway" }))) return;
      setError(""); setNotice("");
      const res = await fetch(`/api/opportunities/${opp.id}/convert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: "standard_quote" }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not create the quote"); return; }
      router.push(ROUTES.standardQuote(j.id));
    });
  }

  async function remove() {
    if (!(await confirm({ title: `Delete ${opp.ref ?? "this deal"}?`, body: "Linked quotes stay; only the deal goes.", tone: "danger" }))) return;
    startTransition(async () => {
      const res = await fetch(`/api/opportunities/${opp.id}`, { method: "DELETE" });
      if (res.ok) router.push(ROUTES.pipeline);
      else setError("Could not delete");
    });
  }

  const tabBtn = (key: Tab, label: string) => (
    <button type="button" onClick={() => setTab(key)} style={{ padding: "8px 14px", fontSize: 13, fontWeight: 600, background: "none", border: "none", borderBottom: `2px solid ${tab === key ? c.accent : "transparent"}`, color: tab === key ? c.accent : c.muted, cursor: "pointer", marginBottom: -1 }}>{label}</button>
  );

  return (
    <div>
      {/* Header */}
      <div style={{ ...cardStyle, padding: "14px 18px", marginBottom: 12, display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 11, color: c.hint }}>{opp.ref} · {accountName}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: c.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opp.title}</div>
          <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2 }}>
            Owner {memberName(opp.owner_id)} · {daysBetween(opp.stage_since, todayKey)}d in {stageDefNow?.label ?? opp.stage}
            {opp.expected_close ? ` · close by ${fmtDate(opp.expected_close)}` : ""}
            {closed ? ` · ${opp.outcome}${opp.loss_reason ? ` (${LOSS_REASON_LABEL[opp.loss_reason]})` : ""}` : ""}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: c.hint }}>Amount{quotes.length > 0 ? " (latest quote)" : ""}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: c.ink }}>{inr(Number(opp.amount || 0))}</div>
          <div style={{ fontSize: 11, color: c.muted }}>{opp.probability ?? 0}% · weighted {inr(weightedValue(Number(opp.amount || 0), opp.probability ?? 0))}</div>
        </div>
        <div>
          <label style={lbl}>Stage</label>
          <select value={opp.stage} onChange={(e) => changeStage(e.target.value)} disabled={pending} style={{ ...inp, width: 170, borderColor: stageDefNow?.color ?? c.line }}>
            {stages.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {error && <div style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "var(--err-ink)", marginBottom: 10 }}>{error}</div>}
      {notice && <div style={{ background: "var(--tealbg)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "var(--tealink)", marginBottom: 10 }}>{notice}</div>}

      <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${c.line}`, marginBottom: 12 }}>
        {tabBtn("overview", "Overview")}
        {tabBtn("lines", `Lines${lines.filter((l) => l.description.trim() && !l.break_of).length ? ` (${lines.filter((l) => l.description.trim() && !l.break_of).length})` : ""}${linesDirty ? " •" : ""}`)}
        {tabBtn("quotes", `Quotes${quotes.length ? ` (${quotes.length})` : ""}`)}
      </div>

      {tab === "overview" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 14, alignItems: "start" }}>
          <section style={cardStyle}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ gridColumn: "1 / -1" }}><label style={lbl}>Title</label><input style={inp} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
              <div><label style={lbl}>Contact</label>
                <select style={inp} value={form.contact_id} onChange={(e) => setForm({ ...form, contact_id: e.target.value })}>
                  <option value="">— None —</option>{contacts.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
                </select></div>
              <div><label style={lbl}>Expected close</label><input style={inp} type="date" value={form.expected_close} onChange={(e) => setForm({ ...form, expected_close: e.target.value })} /></div>
              <div><label style={lbl}>Owner</label>
                <select style={inp} value={form.owner_id} onChange={(e) => setForm({ ...form, owner_id: e.target.value })}>
                  <option value="">— Unassigned —</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name ?? m.email ?? m.user_id.slice(0, 8)}</option>)}
                </select></div>
              <div><label style={lbl}>Source</label>
                <select style={inp} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                  {OPPORTUNITY_SOURCES.map((s) => <option key={s} value={s}>{OPPORTUNITY_SOURCE_LABEL[s]}</option>)}
                </select></div>
              <div><label style={lbl}>Competitor</label><input style={inp} value={form.competitor} onChange={(e) => setForm({ ...form, competitor: e.target.value })} /></div>
              <div><label style={lbl}>Probability override %</label><input style={inp} type="number" min="0" max="100" value={form.probability_override} onChange={(e) => setForm({ ...form, probability_override: e.target.value })} placeholder={`${stageDefNow?.probability_hint ?? 0} from the stage`} /></div>
              <div style={{ gridColumn: "1 / -1" }}><label style={lbl}>Why the override</label><input style={inp} value={form.probability_override_reason} onChange={(e) => setForm({ ...form, probability_override_reason: e.target.value })} placeholder="Only needed when you override" /></div>
              <div style={{ gridColumn: "1 / -1" }}><label style={lbl}>Description</label><textarea style={{ ...inp, minHeight: 70, resize: "vertical" }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            </div>
            <div style={{ marginTop: 14 }}>
              <label style={lbl}>Team</label>
              {form.team.map((t, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                  <select style={{ ...inp, flex: 1 }} value={t.user_id} onChange={(e) => setForm({ ...form, team: form.team.map((x, j) => (j === i ? { ...x, user_id: e.target.value } : x)) })}>
                    {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name ?? m.email ?? m.user_id.slice(0, 8)}</option>)}
                  </select>
                  <select style={{ ...inp, width: 180 }} value={t.role} onChange={(e) => setForm({ ...form, team: form.team.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)) })}>
                    {TEAM_ROLES.map((r) => <option key={r} value={r}>{TEAM_ROLE_LABEL[r as TeamRole]}</option>)}
                  </select>
                  <button type="button" onClick={() => setForm({ ...form, team: form.team.filter((_, j) => j !== i) })} style={{ ...btn("danger"), padding: "0 10px" }}>×</button>
                </div>
              ))}
              <button type="button" onClick={() => setForm({ ...form, team: [...form.team, { user_id: members.find((m) => !form.team.some((t) => t.user_id === m.user_id))?.user_id ?? currentUserId, role: "sales" }] })} style={{ fontSize: 12, fontWeight: 600, color: c.accent, background: "none", border: "none", cursor: "pointer", padding: 0 }}>+ Add someone</button>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button type="button" onClick={saveHeader} disabled={pending} style={btn("primary")}>{pending ? "Saving…" : "Save"}</button>
            </div>
          </section>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {!closed && standardQuotesEnabled && <button type="button" onClick={convert} disabled={pending} style={btn("primary")}>Convert to Standard Quote</button>}
            {!closed && <button type="button" onClick={() => setClosing({ stage: stages.find((s) => s.is_closed && (s.outcome ?? "won") === "won")?.value ?? opp.stage, outcome: "won", loss_reason: "price", loss_note: "" })} style={btn("ghost")}>Mark won</button>}
            {!closed && <button type="button" onClick={() => setClosing({ stage: stages.find((s) => s.is_closed && s.outcome === "lost")?.value ?? opp.stage, outcome: "lost", loss_reason: "price", loss_note: "" })} style={btn("ghost")}>Mark lost</button>}
            {closed && <button type="button" onClick={() => startTransition(async () => { await patch({ stage: stages.find((s) => !s.is_closed)?.value ?? opp.stage, outcome: "open" }, "Reopened"); })} style={btn("ghost")}>Reopen</button>}
            <button type="button" onClick={remove} disabled={pending} style={btn("danger")}>Delete deal</button>
            <div style={{ fontSize: 11, color: c.hint, marginTop: 6 }}>Created {fmtDate(opp.created_at)}{opp.closed_at ? ` · closed ${fmtDate(opp.closed_at)}` : ""}</div>
          </div>
        </div>
      )}

      {tab === "lines" && (
        <section style={cardStyle}>
          <DocumentLinesEditor
            lines={lines} onChange={setLines} products={products} pricingEnabled={pricingEnabled}
            accountId={opp.account_id} accountName={accountName} documentType="opportunity" documentId={opp.id} onError={setError}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, borderTop: `1px solid ${c.line}`, paddingTop: 12 }}>
            <span style={{ fontSize: 12.5, color: c.muted }}>Lines total <b style={{ color: c.ink }}>{inr(linesTotal)}</b>{quotes.length > 0 ? " · the deal amount follows its latest quote" : ""}</span>
            <span style={{ marginLeft: "auto" }} />
            {linesDirty && <span style={{ fontSize: 11.5, color: "var(--amberink)" }}>Unsaved changes</span>}
            <button type="button" onClick={saveLines} disabled={pending || !linesDirty} style={{ ...btn("primary"), opacity: linesDirty ? 1 : 0.5 }}>{pending ? "Saving…" : "Save lines"}</button>
            {!closed && standardQuotesEnabled && <button type="button" onClick={convert} disabled={pending} style={btn("ghost")}>Convert to Standard Quote</button>}
          </div>
        </section>
      )}

      {tab === "quotes" && (
        <section style={cardStyle}>
          {quotes.length === 0 ? (
            <div style={{ fontSize: 12.5, color: c.hint, padding: "8px 0" }}>No quote yet. Convert the deal to a Standard Quote, or link one from the quote's own page.</div>
          ) : (
            <div style={{ border: `1px solid ${c.line}`, borderRadius: 8, overflow: "hidden" }}>
              {quotes.map((q, i) => (
                <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 13 }}>
                  <Link href={q.object === "standard_quote" ? ROUTES.standardQuote(q.id) : ROUTES.quotation(q.id)} style={{ color: c.accent, fontWeight: 600, textDecoration: "none" }}>{q.ref}</Link>
                  <span style={{ fontSize: 11.5, color: c.hint }}>{q.object === "standard_quote" ? "Standard Quote" : "Quotation"} · {fmtDate(q.created_at)}{i === 0 ? " · latest" : ""}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: c.muted, textTransform: "capitalize" }}>{q.status}</span>
                  <span style={{ marginLeft: "auto", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{inr(q.subtotal)}</span>
                </div>
              ))}
            </div>
          )}
          {!closed && standardQuotesEnabled && (
            <div style={{ marginTop: 12 }}>
              <button type="button" onClick={convert} disabled={pending} style={btn("primary")}>Convert to Standard Quote</button>
              <span style={{ fontSize: 11.5, color: c.hint, marginLeft: 10 }}>Copies the saved lines and re-prices product lines on today&apos;s date.</span>
            </div>
          )}
        </section>
      )}

      {closing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setClosing(null)}>
          <div style={{ ...cardStyle, width: 380, padding: 18 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 700, color: c.ink, marginBottom: 10 }}>Close this deal as…</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {(["won", "lost", "dropped"] as const).map((o) => (
                <button key={o} type="button" onClick={() => setClosing({ ...closing, outcome: o, stage: stages.find((s) => s.is_closed && (s.outcome ?? "won") === (o === "dropped" ? "lost" : o))?.value ?? closing.stage })} style={{ flex: 1, padding: "7px 0", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer", border: `1px solid ${closing.outcome === o ? c.accent : c.line}`, background: closing.outcome === o ? c.accentbg : "transparent", color: closing.outcome === o ? c.accent : c.muted, textTransform: "capitalize" }}>{o}</button>
              ))}
            </div>
            {closing.outcome !== "won" && (
              <>
                <select value={closing.loss_reason} onChange={(e) => setClosing({ ...closing, loss_reason: e.target.value })} style={{ ...inp, marginBottom: 8 }}>
                  {LOSS_REASONS.map((r) => <option key={r} value={r}>{LOSS_REASON_LABEL[r]}</option>)}
                </select>
                <input value={closing.loss_note} onChange={(e) => setClosing({ ...closing, loss_note: e.target.value })} placeholder="What happened (optional)" style={{ ...inp, marginBottom: 8 }} />
              </>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setClosing(null)} style={btn("ghost")}>Cancel</button>
              <button type="button" disabled={pending} onClick={() => { const cl = closing; setClosing(null); startTransition(async () => { await patch({ stage: cl.stage, outcome: cl.outcome, ...(cl.outcome !== "won" ? { loss_reason: cl.loss_reason, loss_note: cl.loss_note || null } : {}) }); }); }} style={btn("primary")}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
