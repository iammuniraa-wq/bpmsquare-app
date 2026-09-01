"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";

/**
 * Nova — Case Lanes. Cases redesign (owner request 2026-09-01), ported
 * from Quotations' QuoteLanes. Cards grouped into Stuck / Unassigned /
 * Normal, derived only from real fields (intake_at, assigned_to, status)
 * -- see api/nova/case-lanes/route.ts for exactly why 30 days and why
 * "unassigned" is Cases' honest analogue of Quotes' "needs first send".
 *
 * Additive, not a replacement -- CaseBoardSlot still offers Field and
 * List too. There is no case-equivalent of Flow board (that kanban is
 * quote-specific), so the switcher here is only three tabs.
 */

type Card = {
  id: string; ref: string; account: string; status: string;
  assetCount: number; ageDays: number; unassigned: boolean;
  lane: "stuck" | "unassigned"; situation: string;
};
type LaneSummary = { count: number };
type Payload = { cards: Card[]; normal: LaneSummary; stuck: LaneSummary; unassigned: LaneSummary; stuck_days: number };

function Card({ card, onOpen }: { card: Card; onOpen: (id: string) => void }) {
  const stuck = card.lane === "stuck";
  return (
    <article
      style={{
        border: "1px solid var(--nova-line)", borderTop: `2px solid ${stuck ? "#E4634A" : "var(--nova-orange)"}`,
        borderRadius: "var(--nova-radius-card)", background: "var(--nova-glass-bg)",
        padding: 18, display: "flex", flexDirection: "column", gap: 12,
      }}
    >
      <div>
        <div style={{ fontSize: 15, fontWeight: 500, color: "var(--nova-ink)", letterSpacing: "-.005em" }}>{card.account}</div>
        <div style={{ fontFamily: "var(--nova-font-body)", fontSize: 11, color: "var(--nova-ink-faint)", marginTop: 3 }}>{card.ref}</div>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--nova-ink-dim)", lineHeight: 1.5 }}>{card.situation}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, borderTop: "1px solid var(--nova-line-soft)", paddingTop: 12 }}>
        <span style={{ fontSize: 11.5, color: "var(--nova-ink-dim)" }}>
          {card.ageDays}d since intake · {card.assetCount} asset{card.assetCount === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={() => onOpen(card.id)}
          style={{
            border: 0, borderRadius: 7, background: "var(--nova-orange)", color: "#160F02",
            fontSize: 12.5, fontWeight: 600, padding: "7px 13px", cursor: "pointer",
          }}
        >
          Open case
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
        {summary.count} case{summary.count === 1 ? "" : "s"} · {note}
      </span>
      <span style={{ flex: 1, height: 1, background: "var(--nova-line-soft)" }} />
    </div>
  );
}

export default function CaseLanes({ filterQuery }: { filterQuery?: string }) {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const url = filterQuery ? `/api/nova/case-lanes?${filterQuery}` : "/api/nova/case-lanes";
    fetch(url)
      .then((r) => r.json())
      .then((json) => { if (!cancelled) { if (json.error) setError(json.error); else setData(json); } })
      .catch(() => { if (!cancelled) setError("Couldn't load case lanes"); });
    return () => { cancelled = true; };
  }, [filterQuery]);

  if (error) return <div style={{ padding: 24, color: "var(--nova-ink-dim)", fontSize: 13 }}>{error}</div>;
  if (!data) return <div style={{ padding: 24, color: "var(--nova-ink-faint)", fontSize: 13 }}>Loading…</div>;

  const stuck = data.cards.filter((c) => c.lane === "stuck");
  const unassigned = data.cards.filter((c) => c.lane === "unassigned");
  const onOpen = (id: string) => router.push(ROUTES.case(id));
  const gridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(258px, 1fr))", gap: 14, marginBottom: 34 };

  return (
    <div>
      {stuck.length > 0 && (
        <>
          <LaneHead dot="#E4634A" title="Stuck" summary={data.stuck} note={`open ${data.stuck_days} days+`} />
          <div style={gridStyle}>{stuck.map((c) => <Card key={c.id} card={c} onOpen={onOpen} />)}</div>
        </>
      )}
      {unassigned.length > 0 && (
        <>
          <LaneHead dot="var(--nova-orange)" title="Unassigned" summary={data.unassigned} note="no technician" />
          <div style={gridStyle}>{unassigned.map((c) => <Card key={c.id} card={c} onOpen={onOpen} />)}</div>
        </>
      )}
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
            <b style={{ color: "var(--nova-ink)", fontWeight: 500 }}>Moving normally</b> — {data.normal.count} cases. Nothing needed.
          </span>
        </div>
      )}
      {stuck.length === 0 && unassigned.length === 0 && data.normal.count === 0 && (
        <div style={{ padding: 24, color: "var(--nova-ink-faint)", fontSize: 13 }}>No open cases.</div>
      )}
    </div>
  );
}
