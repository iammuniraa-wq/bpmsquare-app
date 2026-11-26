"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { flushQueue, listCaptures, discardRejected, type QueuedCapture } from "@/lib/site/offlineQueue";

// Small pieces the site screens share. Everything is a label, a value or an action: explanations are behind the InfoTip (bpmsquarecore 6b).

export const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

/** One column, 560 px at most, 44 px targets (the .bpm-tap class), no horizontal scroll: the phone is the first screen, the desktop just centres it. */
export function SiteFrame({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return <div className="bpm-tap" style={{ maxWidth: wide ? 980 : 560, marginInline: "auto", display: "flex", flexDirection: "column", gap: 14, paddingBottom: 96 }}>{children}</div>;
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return <Link href={href} className="bpm-backlink" style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>← {label}</Link>;
}

/** The one primary action of a screen, sticky at the bottom on a phone. */
export function StickyBar({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: "sticky", bottom: 0, zIndex: 5, background: "var(--panel)", borderTop: `1px solid ${c.line}`, padding: "10px 0", marginTop: 4, display: "flex", gap: 10 }}>
      {children}
    </div>
  );
}

export function Banner({ tone, children }: { tone: "info" | "warn" | "bad" | "good"; children: React.ReactNode }) {
  const ink = tone === "bad" ? "var(--redink)" : tone === "warn" ? "var(--amberink)" : tone === "good" ? "var(--greenink)" : "var(--blueink)";
  const bg = tone === "bad" ? "var(--redbg)" : tone === "warn" ? "var(--amberbg)" : tone === "good" ? "var(--greenbg)" : "var(--bluebg)";
  return <div role={tone === "bad" ? "alert" : "status"} style={{ background: bg, color: ink, borderRadius: 10, padding: "10px 12px", fontSize: 13, lineHeight: 1.4 }}>{children}</div>;
}

export const sectionCard: React.CSSProperties = { ...cardStyle, display: "flex", flexDirection: "column", gap: 10 };

/** What is saved on this phone and not sent yet, with a Send now button and the entries the server refused. Renders nothing when the queue is empty. */
export function WaitingToUpload({ onChange }: { onChange?: () => void }) {
  const [items, setItems] = useState<QueuedCapture[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = async () => { try { setItems(await listCaptures()); } catch { setItems([]); } };
  useEffect(() => {
    void refresh();
    const on = () => { void flushQueue().then(() => { void refresh(); onChange?.(); }).catch(() => {}); };
    window.addEventListener("online", on);
    if (navigator.onLine) on();
    return () => window.removeEventListener("online", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (items.length === 0) return null;
  const waiting = items.filter((i) => !i.rejected);
  const refused = items.filter((i) => i.rejected);

  async function sendNow() {
    setBusy(true);
    try { await flushQueue(); } finally { setBusy(false); await refresh(); onChange?.(); }
  }

  return (
    <section style={sectionCard} aria-label="Waiting to upload" data-guide="site.waiting">
      {waiting.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 14, color: c.ink }}>{waiting.length} waiting to upload</strong>
            <span style={{ fontSize: 12, color: c.hint }}>Saved on this phone</span>
            <button type="button" className="bpm-btn bpm-btn-secondary bpm-btn-md" style={{ marginLeft: "auto" }} onClick={sendNow} disabled={busy}>{busy ? "Sending…" : "Send now"}</button>
          </div>
          {waiting.map((i) => (
            <div key={i.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: c.muted, gap: 8 }}>
              <span>{i.kind === "expense" ? "Expense" : "Receipt"}: {i.label}</span>
              <span style={{ color: c.hint }}>{new Date(i.queuedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          ))}
        </>
      )}
      {refused.map((i) => (
        <div key={i.id} role="alert" style={{ background: "var(--redbg)", color: "var(--redink)", borderRadius: 10, padding: "10px 12px", fontSize: 13 }}>
          <div style={{ fontWeight: 600 }}>{i.kind === "expense" ? "Expense" : "Receipt"} {i.label} was not accepted</div>
          <div style={{ marginTop: 2 }}>{i.rejected?.reason}</div>
          <button type="button" className="bpm-btn bpm-btn-secondary bpm-btn-md" style={{ marginTop: 8 }} onClick={async () => { await discardRejected(i.id); await refresh(); }}>Remove it, I will enter it again</button>
        </div>
      ))}
    </section>
  );
}

/** A segmented row of chips (categories, reasons): one choice, tap to change, 44 px high. */
export function Chips<T extends string>({ value, options, onChange, label }: { value: T | null; options: { id: T; label: string }[]; onChange: (id: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.id)}
            style={{
              minHeight: 44, padding: "0 14px", borderRadius: 22, cursor: "pointer", fontSize: 13.5, fontWeight: on ? 700 : 500,
              border: `1.5px solid ${on ? c.accent : c.line}`, background: on ? c.accentbg : "var(--panel)", color: on ? c.ink : c.muted,
            }}
          >{o.label}</button>
        );
      })}
    </div>
  );
}

export function Stepper({ value, onChange, min = 0, max = 9_999_999, label }: { value: number; onChange: (n: number) => void; min?: number; max?: number; label: string }) {
  const set = (n: number) => onChange(Math.min(max, Math.max(min, Math.round(n * 1000) / 1000)));
  const btn: React.CSSProperties = { width: 44, height: 44, borderRadius: 10, border: `1px solid ${c.line}`, background: "var(--panel)", color: c.ink, fontSize: 20, cursor: "pointer" };
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }} role="group" aria-label={label}>
      <button type="button" style={btn} aria-label={`Less ${label}`} onClick={() => set(value - 1)}>−</button>
      <input
        className="bpm-input" inputMode="decimal" aria-label={label} value={Number.isFinite(value) ? String(value) : ""} style={{ width: 64, textAlign: "center", fontVariantNumeric: "tabular-nums" }}
        onChange={(e) => { const n = Number(e.target.value.replace(/[^0-9.]/g, "")); if (Number.isFinite(n)) set(n); }}
      />
      <button type="button" style={btn} aria-label={`More ${label}`} onClick={() => set(value + 1)}>+</button>
    </div>
  );
}
