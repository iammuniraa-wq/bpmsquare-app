"use client";

import { useMemo, useState } from "react";
import { c, statusInk } from "@/lib/theme";
import InfoTip from "@/components/ui/InfoTip";
import { InlineMarkdown } from "./Markdown";
import { plainText } from "@/lib/assistant/markdown";
import { missingRequired, type CardDuplicate, type CardField, type CardSettled, type ConfirmCard, type NextStep } from "@/lib/assistant/cards";

/**
 * The confirm card: one layout for every record the assistant proposes (label, value, one button named after the
 * act). A field with a value, and every required field, is shown; the rest sit behind "More fields". Every value
 * is editable here; nothing is created until the button is pressed, and the press goes to POST /api/ai/act, which
 * runs the object's own route. A create card carries no "i": its labels and buttons say what happens, and the
 * duplicate warning and missing-field notices are visible text (bpmsquarecore.md 6b). A change card shows what each field holds
 * now under the new value; a tender step card lists the facts it acts on and the checks that are not a pass, and carries one "i"
 * saying what the press does. The classic dock and the Nova dock draw the same card.
 */

type Done = { id: string; href: string; label: string; message?: string; details?: string[] };

const input: React.CSSProperties = {
  width: "100%", minWidth: 0, boxSizing: "border-box", minHeight: 36, border: "1px solid var(--line)", borderRadius: 8,
  padding: "6px 10px", fontSize: 16, fontFamily: "inherit", color: "var(--ink)", background: "var(--card-bg, #fff)",
};

function Control({ f, value, onChange, disabled }: { f: CardField; value: string; onChange: (v: string) => void; disabled: boolean }) {
  const common = { disabled, "aria-label": f.label, className: "bms-card-input", style: input } as const;
  if (f.widget === "textarea") return <textarea {...common} rows={3} value={value} onChange={(e) => onChange(e.target.value)} />;
  if ((f.widget === "enum" || f.widget === "ref") && f.options) {
    return (
      <select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{f.widget === "ref" ? "Choose…" : "—"}</option>
        {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  if (f.widget === "checkbox") {
    return (
      <select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option><option value="true">Yes</option><option value="false">No</option>
      </select>
    );
  }
  return <input {...common} type={f.widget === "date" ? "date" : f.widget === "number" ? "number" : "text"} value={value} onChange={(e) => onChange(e.target.value)} />;
}

const CONFIDENCE_WORD = { found: "Found", likely: "Likely", not_found: "Not found" } as const;

/** The small line under a field's label: where a value came from, how sure the lookup was, or that the person changed it. */
export function fieldMeta(f: CardField, current: string): string | null {
  if (f.origin === "web") return current !== f.value ? "Edited by you" : `From the web · ${CONFIDENCE_WORD[f.confidence ?? "likely"] ?? "Likely"}`;
  if (f.confidence === "not_found") return current !== "" ? "Added by you" : CONFIDENCE_WORD.not_found;
  return null;
}

/** The buttons under a created record: the "Open" button already covers the record itself, and in the web window an "ask" step is left out. */
export function visibleNextSteps(next: NextStep[], recordHref: string, modelLocked: boolean): NextStep[] {
  return next.filter((n) => !(n.kind === "navigate" && n.target === recordHref) && !(modelLocked && n.kind === "ask"));
}

export default function ConfirmCardView({ card, onOpen, onAsk, modelLocked = false, settled, onSettled }: {
  card: ConfirmCard;
  onOpen: (href: string) => void;
  onAsk: (question: string) => void;
  /**
   * The chat is in the web-derived window (assistant.ts, WEB_TAINT_WINDOW), where the assistant cannot propose another
   * record. This card's own button still works (it runs no model); a "next step" that would ask the assistant to create
   * something is left out rather than shown as a button that answers "ask again later".
   */
  modelLocked?: boolean;
  /** How this card ended earlier in the chat, and where to keep it when it ends now. */
  settled?: CardSettled;
  onSettled?: (s: CardSettled) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(card.fields.map((f) => [f.key, f.value])));
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dupes, setDupes] = useState<CardDuplicate[]>(card.duplicates);
  const [ackDupes, setAckDupes] = useState(false);
  const [dismissed, setDismissed] = useState(settled?.kind === "cancelled");
  const [done, setDone] = useState<{ record: Done; next: NextStep[]; message?: string; details?: string[] } | null>(settled?.kind === "done" ? settled : null);
  const finish = (d: { record: Done; next: NextStep[]; message?: string; details?: string[] }) => { setDone(d); onSettled?.({ kind: "done", ...d }); };
  const cancel = () => { setDismissed(true); onSettled?.({ kind: "cancelled" }); };
  const creating = card.action === "create";

  const missing = useMemo(() => missingRequired(card.fields, values), [card.fields, values]);
  const visible = card.fields.filter((f) => showAll || f.required || (values[f.key] ?? "") !== "" || f.value !== "");
  const hiddenCount = card.fields.length - visible.length;
  const notFound = card.fields.filter((f) => f.confidence === "not_found" && (values[f.key] ?? "") === "").map((f) => f.label);

  async function press() {
    if (busy || missing.length > 0) return;
    setBusy(true); setError("");
    try {
      const res = await fetch(card.press?.startsWith("/api/ai/act/") ? card.press : "/api/ai/act", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card_id: card.id, token: card.token, values, confirm_duplicates: ackDupes || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) { finish({ record: json.record, next: json.next ?? [], message: json.message, details: json.details }); return; }
      if (res.status === 409 && json.code === "already_done" && json.result?.id) {
        finish({ record: json.result, next: [], message: json.result.message, details: json.result.details });
        return;
      }
      if (json.code === "duplicates_changed" && Array.isArray(json.duplicates)) { setDupes(json.duplicates); setAckDupes(true); }
      setError(json.error ?? (creating ? "Could not create it." : "Could not do that."));
    } catch {
      setError(`Could not reach the server. Nothing was ${creating ? "created" : "changed"}; check before trying again.`);
    } finally {
      setBusy(false);
    }
  }

  const box: React.CSSProperties = { border: `1px solid ${c.line}`, borderRadius: "var(--card-radius, 10px)", background: "var(--card-bg, #fff)", overflow: "hidden" };
  const btn: React.CSSProperties = { borderRadius: "var(--card-radius, 10px)", padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };

  if (dismissed) return <div style={{ ...box, padding: "8px 12px", fontSize: 12, color: c.hint }}>Cancelled. Nothing was {creating ? "created" : "changed"}.</div>;

  if (done) {
    return (
      <div style={{ ...box, padding: 12, display: "flex", flexDirection: "column", gap: 8 }} data-testid="card-done">
        <div style={{ fontSize: 12.5, fontWeight: 700 }}>{done.message ?? `Created ${done.record.label}`}</div>
        {done.details && done.details.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12, color: c.muted }}>
            {done.details.map((d) => <span key={d}>{d}</span>)}
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <button className="bms-dock-chip" onClick={() => onOpen(done.record.href)} style={{ ...btn, background: "var(--accentbg)", border: `1px solid ${c.line}`, color: c.accent }}>Open →</button>
          {visibleNextSteps(done.next, done.record.href, modelLocked).map((n) => (
            <button
              key={n.id} className="bms-dock-chip"
              onClick={() => (n.kind === "navigate" && n.target ? onOpen(n.target) : n.question ? onAsk(n.question) : undefined)}
              style={{ ...btn, background: "var(--accentbg)", border: `1px solid ${c.line}`, color: c.accent }}
            >{n.label}</button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={box} data-testid="confirm-card">
      <div style={{ padding: "9px 12px", background: "var(--panel2)", display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700 }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{plainText(card.title)}</span>
        {card.info && <InfoTip label={card.title}>{card.info}</InfoTip>}
      </div>
      {card.summary && <div style={{ padding: "8px 12px 0", fontSize: 12, color: c.muted }}><InlineMarkdown text={card.summary} /></div>}

      {card.facts && card.facts.length > 0 && (
        <div data-guide="assistant.card.facts" style={{ padding: "8px 12px 0", display: "flex", flexDirection: "column", gap: 3 }}>
          {card.facts.map((f) => (
            <div key={f.label} style={{ display: "grid", gridTemplateColumns: "minmax(86px, 34%) 1fr", gap: 8, fontSize: 12 }}>
              <span style={{ color: c.muted, fontWeight: 600 }}>{f.label}</span>
              <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{f.value}</span>
            </div>
          ))}
        </div>
      )}

      {card.checks && card.checks.length > 0 && (
        <div role="status" data-guide="assistant.card.checks" style={{ margin: "8px 12px 0", display: "flex", flexDirection: "column", gap: 2, fontSize: 12, color: statusInk.warn }}>
          <span style={{ fontWeight: 650 }}>Before you go on</span>
          {card.checks.map((k) => <span key={k}>{k}</span>)}
        </div>
      )}

      {card.notices.map((n) => (
        <div key={n} role="status" style={{ margin: "8px 12px 0", fontSize: 12, color: statusInk.warn }}><InlineMarkdown text={n} /></div>
      ))}

      {dupes.length > 0 && (
        <div style={{ margin: "8px 12px 0", display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 650, color: statusInk.warn }}>Similar already exists</div>
          {dupes.map((d) => (
            <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</span>
              <button className="bms-dock-chip" onClick={() => onOpen(d.href)} style={{ ...btn, padding: "5px 10px", background: "var(--accentbg)", border: `1px solid ${c.line}`, color: c.accent }}>Open instead</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        {visible.map((f) => {
          const meta = fieldMeta(f, values[f.key] ?? "");
          return (
            <label key={f.key} style={{ display: "grid", gridTemplateColumns: "minmax(86px, 34%) 1fr", alignItems: "center", gap: 8, fontSize: 12 }}>
              <span style={{ color: c.muted, fontWeight: 600 }}>
                {f.label}{f.required ? " *" : ""}
                {meta && <span data-testid="field-meta" style={{ display: "block", fontSize: 10.5, fontWeight: 600, color: c.hint }}>{meta}</span>}
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <Control f={f} value={values[f.key] ?? ""} disabled={busy} onChange={(v) => setValues((p) => ({ ...p, [f.key]: v }))} />
                {f.before !== undefined && <span data-testid="field-before" style={{ fontSize: 10.5, fontWeight: 600, color: c.hint }}>Now: {f.before || "empty"}</span>}
              </span>
            </label>
          );
        })}
        {notFound.length > 0 && (
          <div style={{ fontSize: 11.5, color: c.hint }}>Not found on the web: {notFound.join(", ")}</div>
        )}
        {hiddenCount > 0 && (
          <div>
            <button className="bms-dock-chip" onClick={() => setShowAll(true)} style={{ ...btn, padding: "5px 10px", background: "transparent", border: `1px dashed ${c.line}`, color: c.muted }}>
              More fields ({hiddenCount})
            </button>
          </div>
        )}
      </div>

      {missing.length > 0 && (
        <div role="status" style={{ padding: "0 12px 8px", fontSize: 12, color: statusInk.warn }}>
          Fill in: {missing.map((k) => card.fields.find((f) => f.key === k)?.label ?? k).join(", ")}
        </div>
      )}
      {error && <div role="alert" style={{ padding: "0 12px 8px", fontSize: 12, color: statusInk.bad }}>{error}</div>}

      <div style={{ padding: "0 12px 12px", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          className="bms-dock-chip" onClick={press} disabled={busy || missing.length > 0} data-guide="assistant.card.primary"
          style={{ ...btn, background: "var(--tenant-accent, #1e3a6e)", color: "#fff", border: "none", opacity: busy || missing.length > 0 ? 0.55 : 1 }}
        >
          {busy ? (creating ? "Creating…" : "Working…") : error && ackDupes ? `${card.primaryLabel} anyway` : card.primaryLabel}
        </button>
        <button className="bms-dock-chip" onClick={cancel} disabled={busy} data-guide="assistant.card.cancel" style={{ ...btn, background: "transparent", border: `1px solid ${c.line}`, color: c.muted }}>Cancel</button>
      </div>
      <style>{`@media (max-width: 899px) { .bms-card-input { min-height: 44px !important; } }`}</style>
    </div>
  );
}
