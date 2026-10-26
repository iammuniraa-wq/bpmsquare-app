import StatTile, { StatStrip } from "@/components/ui/StatTile";

// The strip at the top of an RFQ (colour system, docs/design/colour-system.md): who was asked, who answered, how many lines have a
// winner and how many are still open. Counts only, from the bundle the page already loaded.

export type RfqProgress = { invited: number; unsent: number; replied: number; waiting: number; lines: number; awarded: number; open: number };

type SupplierLike = { status: string };
type LineLike = { id: string };
type AwardLike = { rfq_line_id: string };
type ResponseLike = { rfq_line_id: string; is_awarded?: boolean | null };

/** Suppliers that were not cancelled are the invited ones; a line is awarded once it has a standing award (or an awarded reply on an older database). */
export function rfqProgress(b: { suppliers: SupplierLike[]; lines: LineLike[]; awards?: AwardLike[]; awards_pending?: boolean; responses: ResponseLike[] }): RfqProgress {
  const live = b.suppliers.filter((s) => s.status !== "cancelled");
  const replied = live.filter((s) => s.status === "replied" || s.status === "declined").length;
  const unsent = live.filter((s) => s.status === "pending").length;
  const waiting = live.filter((s) => s.status === "sent" || s.status === "viewed").length;
  const lineIds = new Set(b.lines.map((l) => l.id));
  const awardedIds = new Set<string>();
  if (b.awards && !b.awards_pending) for (const a of b.awards) awardedIds.add(a.rfq_line_id);
  else for (const r of b.responses) if (r.is_awarded) awardedIds.add(r.rfq_line_id);
  const awarded = [...awardedIds].filter((id) => lineIds.has(id)).length;
  return { invited: live.length, unsent, replied, waiting, lines: b.lines.length, awarded, open: Math.max(0, b.lines.length - awarded) };
}

export default function RfqStatStrip({ progress: p }: { progress: RfqProgress }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <StatStrip guide="rfq.strip">
        <StatTile label="Suppliers invited" value={String(p.invited)} sub={p.invited === 0 ? "add suppliers to start" : p.unsent > 0 ? `${p.unsent} not sent yet` : "all sent"} />
        <StatTile tone={p.waiting > 0 ? "warn" : p.replied > 0 ? "good" : "neutral"} label="Replies in" value={String(p.replied)} sub={p.waiting > 0 ? `${p.waiting} still waiting` : p.replied > 0 ? "none waiting" : "none yet"} />
        <StatTile tone={p.awarded > 0 ? "good" : "neutral"} label="Awarded lines" value={`${p.awarded} of ${p.lines}`} sub={p.awarded > 0 && p.open === 0 ? "every line has a winner" : "a supplier chosen"} />
        <StatTile tone={p.open > 0 ? "warn" : "neutral"} label="Still open" value={String(p.open)} sub={p.open > 0 ? "lines without a winner" : "nothing left to award"} />
      </StatStrip>
    </div>
  );
}
