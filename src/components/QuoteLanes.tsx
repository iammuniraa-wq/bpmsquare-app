"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";

/**
 * Nova — Quote Lanes ("Living quotes"). First shipped slice of the
 * Quotations redesign (owner discussion 2026-08-31, sequencing borrowed
 * from the "Quote List 2050" concept study's own recommendation: ship
 * Lanes first since it reuses real signals rather than needing a new
 * query parser or chart primitive). Same 182-quote question the List view
 * answers, redrawn by consequence instead of by date -- see
 * api/nova/quote-lanes/route.ts for exactly which real fields each lane
 * is derived from and why "Waiting on you" was narrowed to "Needs send"
 * (no reply-tracking exists in this codebase to detect the former).
 *
 * This is additive, not a replacement -- FlowBoardSlot still offers Field,
 * List and Flow board too (Field is the default view; see FlowBoardSlot.tsx
 * for why it was split back out of this component into its own tab).
 * Retiring Flow board is a later call once Lanes is validated on a real
 * tenant.
 */

type Card = {
  id: string; ref: string; account: string; total: number; status: string;
  lineCount: number; ageDays: number; neverSent: boolean;
  lane: "cold" | "action"; situation: string;
};
type LaneSummary = { count: number; value: number };
type Payload = { cards: Card[]; normal: LaneSummary; cold: LaneSummary; action: LaneSummary; cold_days: number };

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const money = (n: number) =>
  n >= 10_000_000 ? `₹${(n / 10_000_000).toFixed(1)}Cr`
  : n >= 100_000 ? `₹${(n / 100_000).toFixed(1)}L`
  : inr(n);

function Card({ card, onOpen }: { card: Card; onOpen: (id: string) => void }) {
  const cold = card.lane === "cold";
  return (
    <article
      style={{
        border: "1px solid var(--nova-line)", borderTop: `2px solid ${cold ? "#E4634A" : "var(--nova-orange)"}`,
        borderRadius: "var(--nova-radius-card)", background: "var(--nova-glass-bg)",
        padding: 18, display: "flex", flexDirection: "column", gap: 12,
      }}
    >
      <div>
        <div style={{ fontSize: 15, fontWeight: 500, color: "var(--nova-ink)", letterSpacing: "-.005em" }}>{card.account}</div>
        <div style={{ fontFamily: "var(--nova-font-body)", fontSize: 11, color: "var(--nova-ink-faint)", marginTop: 3 }}>{card.ref}</div>
      </div>
      <div style={{ fontFamily: "var(--nova-font-display)", fontSize: 26, fontWeight: 700, letterSpacing: "-.02em", color: "var(--nova-ink)" }}>
        {inr(card.total)}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--nova-ink-dim)", lineHeight: 1.5 }}>{card.situation}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, borderTop: "1px solid var(--nova-line-soft)", paddingTop: 12 }}>
        <span style={{ fontSize: 11.5, color: "var(--nova-ink-dim)" }}>
          {card.ageDays}d {card.neverSent ? "since created" : "idle"} · {card.lineCount} line{card.lineCount === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={() => onOpen(card.id)}
          style={{
            border: 0, borderRadius: 7, background: "var(--nova-orange)", color: "#160F02",
            fontSize: 12.5, fontWeight: 600, padding: "7px 13px", cursor: "pointer",
          }}
        >
          {card.neverSent ? "Send today" : "Open quote"}
        </button>
      </div>
    </article>
  );
}

function LaneHead({ dot, title, summary, note }: { dot: string; title: string; summary: LaneSummary; note: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "6px 0 16px" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flexShrink: 0 }} />
      <h3 style={{ fontFamily: "var(--nova-font-display)", fontSize: 15, fontWeight: 650, color: "var(--nova-ink)", margin: 0 }}>{title}</h3>
      <span style={{ fontSize: 11.5, color: "var(--nova-ink-faint)", fontVariantNumeric: "tabular-nums" }}>
        {summary.count} quote{summary.count === 1 ? "" : "s"} · {money(summary.value)} · {note}
      </span>
      <span style={{ flex: 1, height: 1, background: "var(--nova-line-soft)" }} />
    </div>
  );
}

export default function QuoteLanes({ filterQuery }: { filterQuery?: string }) {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const url = filterQuery ? `/api/nova/quote-lanes?${filterQuery}` : "/api/nova/quote-lanes";
    fetch(url)
      .then((r) => r.json())
      .then((json) => { if (!cancelled) { if (json.error) setError(json.error); else setData(json); } })
      .catch(() => { if (!cancelled) setError("Couldn't load quote lanes"); });
    return () => { cancelled = true; };
  }, [filterQuery]);

  if (error) return <div style={{ padding: 24, color: "var(--nova-ink-dim)", fontSize: 13 }}>{error}</div>;
  if (!data) return <div style={{ padding: 24, color: "var(--nova-ink-faint)", fontSize: 13 }}>Loading…</div>;

  const cold = data.cards.filter((c) => c.lane === "cold");
  const action = data.cards.filter((c) => c.lane === "action");
  const onOpen = (id: string) => router.push(`${ROUTES.quotations}/${id}`);
  const gridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(258px, 1fr))", gap: 14, marginBottom: 34 };

  return (
    <div>
      {cold.length > 0 && (
        <>
          <LaneHead dot="#E4634A" title="Going cold" summary={data.cold} note={`no movement in ${data.cold_days} days+`} />
          <div style={gridStyle}>{cold.map((c) => <Card key={c.id} card={c} onOpen={onOpen} />)}</div>
        </>
      )}
      {action.length > 0 && (
        <>
          <LaneHead dot="var(--nova-orange)" title="Needs first send" summary={data.action} note="never submitted" />
          <div style={gridStyle}>{action.map((c) => <Card key={c.id} card={c} onOpen={onOpen} />)}</div>
        </>
      )}
      {/* Deliberately never expands to a card grid -- "nothing needed = no
          space" is one of the design's non-negotiable rules across every
          view, not just a default here. Open the List view to see these. */}
      {data.normal.count > 0 && (
        <div
          style={{
            display: "flex", alignItems: "center", gap: 14,
            border: "1px dashed var(--nova-line)", borderRadius: 10, padding: "14px 18px",
            color: "var(--nova-ink-faint)", fontSize: 13,
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--nova-teal)", flexShrink: 0 }} />
          <span>
            <b style={{ color: "var(--nova-ink)", fontWeight: 500 }}>Moving normally</b> — {data.normal.count} quotes · {money(data.normal.value)}. Nothing needed.
          </span>
        </div>
      )}
      {cold.length === 0 && action.length === 0 && data.normal.count === 0 && (
        <div style={{ padding: 24, color: "var(--nova-ink-faint)", fontSize: 13 }}>No open quotes.</div>
      )}
    </div>
  );
}
