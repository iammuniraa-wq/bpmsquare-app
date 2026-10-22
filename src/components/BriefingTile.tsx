"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { c } from "@/lib/theme";
import InfoTip from "@/components/ui/InfoTip";
import { BRIEFING_EMPTY, BRIEFING_TIPS } from "@/lib/briefing/tips";
import type { Briefing, BriefingLine } from "@/lib/briefing/types";

/**
 * The daily briefing, one pattern in two places: the dashboard tile (Adapt widget `my_briefing`) and the card at the
 * top of the assistant dock. Three rows -- Yesterday, Open, Focus -- as labels, counts and links; every explanation
 * sits behind an "i" (bpmsquarecore.md 6b). Worked out on the server by fixed rules; this file only draws it.
 * Under 480 px the row label stacks above its content and every link is a 44 px tap target.
 */

const FOCUS_SHOWN = 3;

function Segments({ lines }: { lines: BriefingLine[] }) {
  return (
    <span className="bms-brief-segs">
      {lines.map((l, i) => (
        <span key={l.id}>
          {i > 0 && <span aria-hidden="true" style={{ color: c.hint }}> · </span>}
          <Link href={l.href} className="bms-brief-link">{l.label}</Link>
        </span>
      ))}
    </span>
  );
}

function Row({ label, tip, children }: { label: string; tip: string; children: React.ReactNode }) {
  return (
    <div className="bms-brief-row">
      <div className="bms-brief-label">
        <span>{label}</span>
        <InfoTip label={label}>{tip}</InfoTip>
      </div>
      <div className="bms-brief-body">{children}</div>
    </div>
  );
}

export type BriefingViewProps = {
  briefing: Briefing | null;
  status: "loading" | "ready" | "error";
  refreshing?: boolean;
  onRefresh: () => void;
  showAll?: boolean;
  onToggleAll?: () => void;
  /** For tests: the clock the Refresh cool-down is read against. */
  nowMs?: number;
  /** The card inside the dock has no title bar of its own. */
  bare?: boolean;
};

export function BriefingView({ briefing, status, refreshing, onRefresh, showAll, onToggleAll, nowMs, bare }: BriefingViewProps) {
  const cooling = !!briefing?.refreshableAt && Date.parse(briefing.refreshableAt) > (nowMs ?? Date.now());
  const focus = briefing ? (showAll ? briefing.focus : briefing.focus.slice(0, FOCUS_SHOWN)) : [];

  return (
    <div className="bms-brief">
      <div className="bms-brief-head">
        {!bare && <span className="bms-brief-title">Your day</span>}
        <InfoTip label="the briefing">{BRIEFING_TIPS.tile}</InfoTip>
        <button
          type="button" className="bms-brief-refresh" onClick={onRefresh}
          disabled={!!refreshing || cooling || status === "loading"}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {status === "loading" && <div className="bms-brief-note">Loading…</div>}
      {status === "error" && <div className="bms-brief-note" role="alert">Could not load your briefing. Press Refresh to try again.</div>}

      {status === "ready" && briefing && briefing.empty && <div className="bms-brief-note">{BRIEFING_EMPTY}</div>}

      {status === "ready" && briefing && !briefing.empty && (
        <>
          <Row label="Yesterday" tip={BRIEFING_TIPS.yesterday}>
            {briefing.yesterday.length > 0 ? <Segments lines={briefing.yesterday} /> : <span className="bms-brief-none">Nothing recorded</span>}
          </Row>
          <Row label="Open" tip={BRIEFING_TIPS.open}>
            {briefing.today.length > 0 ? <Segments lines={briefing.today} /> : <span className="bms-brief-none">Nothing open</span>}
          </Row>
          <Row label="Focus" tip={BRIEFING_TIPS.focus}>
            {focus.length > 0 ? (
              <ol className="bms-brief-focus">
                {focus.map((f) => (
                  <li key={f.id}>
                    <Link href={f.href} className="bms-brief-link">{f.label}</Link>
                    <span className="bms-brief-why">{f.why}</span>
                  </li>
                ))}
              </ol>
            ) : <span className="bms-brief-none">Nothing to push on</span>}
            {briefing.focus.length > FOCUS_SHOWN && onToggleAll && (
              <button type="button" className="bms-brief-more" onClick={onToggleAll}>
                {showAll ? "Show fewer" : `Show all ${briefing.focus.length}`}
              </button>
            )}
          </Row>
        </>
      )}

      <style>{`
        .bms-brief { display: flex; flex-direction: column; gap: 10px; font-size: 12.5px; color: ${c.ink}; }
        .bms-brief-head { display: flex; align-items: center; gap: 6px; }
        .bms-brief-title { font-weight: 650; font-size: 13px; }
        .bms-brief-refresh { margin-left: auto; background: transparent; border: 1px solid var(--line); border-radius: 999px; padding: 4px 12px; font-size: 11.5px; font-weight: 650; color: ${c.accent}; cursor: pointer; font-family: inherit; min-height: 28px; }
        .bms-brief-refresh:disabled { color: ${c.hint}; cursor: default; }
        .bms-brief-row { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 8px; align-items: start; }
        .bms-brief-label { display: flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; color: ${c.hint}; padding-top: 2px; }
        .bms-brief-body { min-width: 0; line-height: 1.5; }
        .bms-brief-link { color: ${c.accent}; font-weight: 650; text-decoration: none; }
        .bms-brief-link:hover { text-decoration: underline; }
        .bms-brief-none, .bms-brief-note, .bms-brief-why { color: ${c.muted}; }
        .bms-brief-note { padding: 2px 0; }
        .bms-brief-focus { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
        .bms-brief-focus li { display: flex; flex-direction: column; }
        .bms-brief-why { font-size: 11.5px; }
        .bms-brief-more { margin-top: 6px; background: transparent; border: none; padding: 0; font-size: 11.5px; font-weight: 650; color: ${c.accent}; cursor: pointer; font-family: inherit; }
        @media (max-width: 480px) {
          .bms-brief-row { grid-template-columns: minmax(0, 1fr); gap: 2px; }
          .bms-brief-link { display: inline-block; padding: 11px 0; }
          .bms-brief-refresh, .bms-brief-more { min-height: 44px; min-width: 44px; }
          .bms-brief-focus { gap: 0; }
        }
      `}</style>
    </div>
  );
}

const lang = () => (typeof navigator !== "undefined" ? navigator.language : "");

/** Fetches and refreshes the person's briefing. `active` lets the dock hold the fetch until its card is open. */
export default function BriefingTile({ active = true, bare = false }: { active?: boolean; bare?: boolean }) {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const run = useCallback(async (refresh: boolean) => {
    if (refresh) setRefreshing(true);
    try {
      const res = await fetch(`/api/ai/briefing${refresh ? "/refresh" : ""}?lang=${encodeURIComponent(lang())}`, { method: refresh ? "POST" : "GET" });
      if (!res.ok) throw new Error(String(res.status));
      setBriefing((await res.json()) as Briefing);
      setStatus("ready");
    } catch {
      setStatus((s) => (s === "ready" ? s : "error"));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!active || briefing) return;
    void run(false);
  }, [active, briefing, run]);

  return (
    <BriefingView
      briefing={briefing} status={status} refreshing={refreshing} bare={bare}
      onRefresh={() => void run(status === "ready")}
      showAll={showAll} onToggleAll={() => setShowAll((v) => !v)}
    />
  );
}

const OPEN_KEY = "bms_dock_briefing_open";

/** The dock's card: "Today", open by default, collapsible. Nothing is fetched while it is collapsed on a fresh load. */
export function BriefingCard() {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try { if (localStorage.getItem(OPEN_KEY) === "0") setOpen(false); } catch { /* private mode */ }
  }, []);
  function toggle() {
    setOpen((v) => {
      try { localStorage.setItem(OPEN_KEY, v ? "0" : "1"); } catch { /* ignore */ }
      return !v;
    });
  }
  return (
    <div style={{ border: `1px solid ${c.line}`, borderRadius: "var(--card-radius, 10px)", padding: "8px 12px", background: "var(--card-bg, #fff)" }}>
      <button
        type="button" onClick={toggle} aria-expanded={open}
        style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", minHeight: 32, background: "transparent", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 650, color: c.ink, textAlign: "left" }}
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span> Today
      </button>
      {open && <div style={{ marginTop: 6 }}><BriefingTile bare /></div>}
    </div>
  );
}
