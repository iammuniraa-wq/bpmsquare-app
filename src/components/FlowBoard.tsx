"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFeel } from "@/components/FeelProvider";

/**
 * Nova — the Flow Board.
 *
 * Every CRM ships a status board, and they all tell the same lie: a quote
 * that reached Sent this morning and one stranded there since March are
 * drawn identically, because the board only knows position. This one is
 * built on TIME instead.
 *
 * Three things follow from that, and they're what make it not-a-kanban:
 *
 *  1. Cards SINK. Position inside a column is age in that stage, freshest
 *     at the top. Each column draws a waterline at its own typical dwell --
 *     measured from this tenant's real history, not a guessed constant --
 *     and everything below that line is running late, visibly, without
 *     anyone running a report.
 *  2. Columns report FLOW, not just counts: value held, typical dwell, and
 *     how many actually left in the last 14 days. A column holding a lot of
 *     money that nothing exits is a bottleneck, and it says so.
 *  3. The board REWINDS. change_log has every status change with a
 *     timestamp, so the scrubber reassembles the board as it stood on any
 *     day in the window and the cards fly to where they were. Nobody can
 *     drag while the past is on screen -- history isn't editable.
 */

type StatusDef = { value: string; label: string; color: string; is_closed: boolean };
type Timeline = { at: string; status: string }[];
type Quote = {
  id: string; ref: string; account: string; total: number; outcome: string;
  valid_until: string | null; created_at: string; timeline: Timeline;
};
type Payload = { statuses: StatusDef[]; quotes: Quote[]; history_days: number };

const DAY = 86_400_000;
const FALLBACK_DWELL = 14;
const money = (n: number) =>
  n >= 10_000_000 ? `₹${(n / 10_000_000).toFixed(1)}Cr`
  : n >= 100_000 ? `₹${(n / 100_000).toFixed(1)}L`
  : `₹${Math.round(n).toLocaleString("en-IN")}`;

/** Where a quote sat at time t, and when it arrived there. */
function stateAt(q: Quote, t: number): { status: string; since: number } | null {
  let cur: { status: string; since: number } | null = null;
  for (const e of q.timeline) {
    const at = new Date(e.at).getTime();
    if (at > t) break;
    cur = { status: e.status, since: at };
  }
  return cur;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export default function FlowBoard() {
  const router = useRouter();
  const { toast } = useFeel();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [daysBack, setDaysBack] = useState(0);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; over: string | null } | null>(null);
  const [pendingClose, setPendingClose] = useState<{ quote: Quote; status: StatusDef } | null>(null);
  const [saving, setSaving] = useState(false);

  const boardRef = useRef<HTMLDivElement>(null);
  const positions = useRef<Map<string, DOMRect>>(new Map());

  const load = useCallback(() => {
    fetch("/api/nova/flow-board")
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { setError(json.error ?? "Could not load the board"); return; }
        setData(json as Payload);
      })
      .catch(() => setError("Could not reach the server"));
  }, []);
  useEffect(load, [load]);

  const at = Date.now() - daysBack * DAY;
  const live = daysBack === 0;

  // Typical dwell per stage, from this tenant's own completed transits.
  const typicalDwell = useMemo(() => {
    const byStatus = new Map<string, number[]>();
    for (const q of data?.quotes ?? []) {
      for (let i = 0; i < q.timeline.length - 1; i++) {
        const from = q.timeline[i];
        const days = (new Date(q.timeline[i + 1].at).getTime() - new Date(from.at).getTime()) / DAY;
        if (days >= 0) byStatus.set(from.status, [...(byStatus.get(from.status) ?? []), days]);
      }
    }
    const out = new Map<string, number>();
    for (const [status, list] of byStatus) {
      const m = median(list);
      if (m !== null) out.set(status, Math.max(1, Math.round(m)));
    }
    return out;
  }, [data]);

  const columns = useMemo(() => {
    if (!data) return [];
    return data.statuses.map((s) => {
      const cards = data.quotes
        .map((q) => {
          const st = stateAt(q, at);
          if (!st || st.status !== s.value) return null;
          return { quote: q, ageDays: Math.max(0, Math.floor((at - st.since) / DAY)) };
        })
        .filter((x): x is { quote: Quote; ageDays: number } => x !== null)
        .sort((a, b) => a.ageDays - b.ageDays);

      // Exits in the 14 days before the viewed moment.
      const exits = data.quotes.reduce((n, q) => {
        for (let i = 0; i < q.timeline.length - 1; i++) {
          const leftAt = new Date(q.timeline[i + 1].at).getTime();
          if (q.timeline[i].status === s.value && leftAt <= at && leftAt > at - 14 * DAY) return n + 1;
        }
        return n;
      }, 0);

      const dwell = typicalDwell.get(s.value) ?? FALLBACK_DWELL;
      return {
        status: s,
        cards,
        value: cards.reduce((t, c) => t + c.quote.total, 0),
        dwell,
        exits,
        stalled: cards.filter((c) => c.ageDays > dwell).length,
      };
    });
  }, [data, at, typicalDwell]);

  // FLIP: capture where every card is before the board changes, then play
  // the difference. This is what makes scrubbing read as the pipeline
  // MOVING rather than as a table refreshing.
  const capture = useCallback(() => {
    const map = new Map<string, DOMRect>();
    boardRef.current?.querySelectorAll<HTMLElement>("[data-card]").forEach((el) => {
      map.set(el.dataset.card!, el.getBoundingClientRect());
    });
    positions.current = map;
  }, []);

  useLayoutEffect(() => {
    if (positions.current.size === 0) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    boardRef.current?.querySelectorAll<HTMLElement>("[data-card]").forEach((el) => {
      const prev = positions.current.get(el.dataset.card!);
      if (!prev) return;
      const next = el.getBoundingClientRect();
      const dx = prev.left - next.left;
      const dy = prev.top - next.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      if (reduce) return;
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: 420, easing: "cubic-bezier(.22,1,.36,1)" }
      );
    });
    positions.current = new Map();
  }, [daysBack, data]);

  function scrubTo(v: number) {
    capture();
    setDaysBack(v);
  }

  // ── Drag ────────────────────────────────────────────────────────────────
  function onPointerDown(e: React.PointerEvent, id: string) {
    if (!live) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ id, x: e.clientX, y: e.clientY, over: null });
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const col = el?.closest<HTMLElement>("[data-col]");
    setDrag({ ...drag, x: e.clientX, y: e.clientY, over: col?.dataset.col ?? null });
  }
  function onPointerUp() {
    if (!drag) return;
    const target = drag.over;
    const quote = data?.quotes.find((q) => q.id === drag.id);
    setDrag(null);
    if (!target || !quote || !data) return;
    const current = stateAt(quote, Date.now())?.status;
    if (current === target) return;
    const status = data.statuses.find((s) => s.value === target);
    if (!status) return;
    // A closed status can't be entered without a decided outcome -- the same
    // rule the API enforces, asked here instead of failing after the drop.
    if (status.is_closed && quote.outcome === "open") { setPendingClose({ quote, status }); return; }
    void move(quote, status.value);
  }

  // Keyboard alternative to drag (a11y): Enter on a focused card opens a
  // small "move to" menu; picking a stage calls the same move() the drop does.
  const [kbMenu, setKbMenu] = useState<string | null>(null);

  async function move(quote: Quote, status: string, outcome?: string) {
    setSaving(true);
    const body: Record<string, unknown> = { status };
    if (outcome) body.outcome = outcome;
    const res = await fetch(`/api/quotes/${quote.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).catch(() => null);
    setSaving(false);
    if (!res || !res.ok) {
      const j = res ? await res.json().catch(() => ({})) : {};
      toast({ text: j.error ?? `Could not move ${quote.ref}`, tone: "error" });
      return;
    }
    capture();
    // Extend the timeline in place so the card flies immediately; the
    // authoritative reload follows behind it.
    setData((prev) => prev && ({
      ...prev,
      quotes: prev.quotes.map((q) => q.id === quote.id
        ? { ...q, outcome: outcome ?? q.outcome, timeline: [...q.timeline, { at: new Date().toISOString(), status }] }
        : q),
    }));
    toast({ text: `${quote.ref} moved to ${data?.statuses.find((s) => s.value === status)?.label ?? status}`, tone: "success" });
    load();
  }

  if (error) return <p className="flow__error">{error}</p>;
  if (!data) {
    // Skeleton columns instead of a bare sentence (Nova audit: loading states).
    return (
      <div aria-hidden style={{ display: "flex", gap: 12, padding: "4px 2px", overflow: "hidden" }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ flex: "0 0 220px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ height: 13, width: "55%", borderRadius: 6, background: "var(--panel2)" }} />
            {[0, 1, 2].map((j) => (
              <div key={j} style={{ height: 58, borderRadius: 10, background: "var(--panel2)" }} />
            ))}
          </div>
        ))}
      </div>
    );
  }

  const viewed = new Date(at);
  const dragQuote = drag ? data.quotes.find((q) => q.id === drag.id) : null;

  return (
    <div className="flow" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      <style>{CSS}</style>

      <div className="flow__scrubBar">
        <div className="flow__scrubLabel">
          <span className={`flow__when ${live ? "is-live" : ""}`}>
            {live ? "Now" : viewed.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
          </span>
          <span className="flow__scrubHint">
            {live ? "Drag a card to move it" : `${daysBack} days ago · history is read-only`}
          </span>
        </div>
        <input
          className="flow__scrub"
          type="range"
          min={0}
          max={data.history_days}
          value={data.history_days - daysBack}
          onChange={(e) => scrubTo(data.history_days - Number(e.target.value))}
          aria-label="Rewind the board"
        />
        {!live && (
          <button className="flow__now" onClick={() => scrubTo(0)}>Back to now</button>
        )}
      </div>

      <div className="flow__board" ref={boardRef}>
        {columns.map((col) => (
          <section
            key={col.status.value}
            data-col={col.status.value}
            className={`flow__col ${drag?.over === col.status.value ? "is-target" : ""} ${drag ? "is-dragging" : ""}`}
          >
            <header className="flow__colHead" style={{ ["--col" as string]: col.status.color }}>
              <div className="flow__colTop">
                <span className="flow__colName">{col.status.label}</span>
                <span className="flow__colCount">{col.cards.length}</span>
              </div>
              <div className="flow__colValue">{money(col.value)}</div>
              <div className="flow__colFlow">
                <span title="Typical time quotes spend in this stage, from your own history">
                  ~{col.dwell}d typical
                </span>
                <span className={col.exits === 0 && col.cards.length > 0 ? "flow__bottleneck" : ""}
                  title="Quotes that left this stage in the 14 days before the date shown">
                  {col.exits} left in 14d
                </span>
              </div>
              {col.stalled > 0 && (
                <div className="flow__stalledTag">{col.stalled} past typical</div>
              )}
            </header>

            <div className="flow__cards">
              {col.cards.length === 0 && <p className="flow__empty">Nothing here</p>}
              {col.cards.map((c, i) => {
                const late = c.ageDays > col.dwell;
                const firstLate = late && (i === 0 || col.cards[i - 1].ageDays <= col.dwell);
                return (
                  <div key={c.quote.id}>
                    {firstLate && (
                      <div className="flow__waterline">
                        <span>past {col.dwell} days</span>
                      </div>
                    )}
                    <article
                      data-card={c.quote.id}
                      className={`flow__card ${late ? "is-late" : ""} ${drag?.id === c.quote.id ? "is-lifted" : ""}`}
                      style={{ ["--age" as string]: `${Math.min(1, c.ageDays / (col.dwell * 3))}`, position: "relative" }}
                      tabIndex={0}
                      role="button"
                      aria-label={`${c.quote.ref}, ${c.quote.account}, in ${col.status.label} — Enter to move`}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setKbMenu(kbMenu === c.quote.id ? null : c.quote.id); }
                        if (e.key === "Escape") setKbMenu(null);
                      }}
                      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setKbMenu(null); }}
                      onPointerDown={(e) => onPointerDown(e, c.quote.id)}
                      onDoubleClick={() => router.push(`/quotations/${c.quote.id}`)}
                    >
                      {kbMenu === c.quote.id && (
                        <div className="flow__kbMenu" role="menu" aria-label="Move to stage">
                          {data.statuses.filter((st) => st.value !== col.status.value).map((st) => (
                            <button key={st.value} role="menuitem" className="flow__kbItem"
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                setKbMenu(null);
                                // Same closed-status rule as the drop path: a
                                // closed stage needs a decided outcome first.
                                if (st.is_closed && c.quote.outcome === "open") { setPendingClose({ quote: c.quote, status: st }); return; }
                                void move(c.quote, st.value);
                              }}>
                              {st.label}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="flow__cardTop">
                        <span className="flow__ref">{c.quote.ref}</span>
                        <span className="flow__total">{money(c.quote.total)}</span>
                      </div>
                      <div className="flow__account">{c.quote.account}</div>
                      <div className="flow__cardFoot">
                        <span className="flow__ageBar" aria-hidden="true"><span /></span>
                        <span className="flow__age">{c.ageDays}d here</span>
                        {c.quote.outcome !== "open" && (
                          <span className={`flow__outcome flow__outcome--${c.quote.outcome}`}>{c.quote.outcome}</span>
                        )}
                      </div>
                    </article>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {drag && dragQuote && (
        <div className="flow__ghost" style={{ left: drag.x, top: drag.y }}>
          <span className="flow__ref">{dragQuote.ref}</span>
          <span className="flow__total">{money(dragQuote.total)}</span>
        </div>
      )}

      {pendingClose && (
        <div className="flow__sheet" role="dialog" aria-modal="true">
          <div className="flow__sheetScrim" onClick={() => setPendingClose(null)} />
          <div className="flow__sheetBody">
            <h3>Closing {pendingClose.quote.ref}</h3>
            <p>
              <b>{pendingClose.status.label}</b> closes the quotation, so it needs a result.
              This is what win-rate is counted from.
            </p>
            <div className="flow__outcomes">
              {(["won", "lost", "dropped"] as const).map((o) => (
                <button
                  key={o}
                  className={`flow__outcomeBtn flow__outcomeBtn--${o}`}
                  disabled={saving}
                  onClick={() => { const p = pendingClose; setPendingClose(null); void move(p.quote, p.status.value, o); }}
                >
                  {o === "won" ? "Won" : o === "lost" ? "Lost" : "Dropped"}
                </button>
              ))}
            </div>
            <button className="flow__cancel" onClick={() => setPendingClose(null)}>Leave it where it was</button>
          </div>
        </div>
      )}
    </div>
  );
}

const CSS = `
.flow {
  --f-bg: var(--card-bg, #fff); --f-line: var(--line, #e5e7eb);
  --f-ink: var(--ink, #111827); --f-dim: var(--muted, #6b7280);
  --f-accent: var(--modern-accent, var(--accent, #1f6feb));
  --f-late: #d97706; --f-bad: #e5484d; --f-good: #12a150;
  --f-ease: cubic-bezier(.22,1,.36,1);
  display: flex; flex-direction: column; gap: 14px;
}
.flow__loading, .flow__error { font-size: 13px; color: var(--f-dim); padding: 30px 0; }
.flow__error { color: var(--f-bad); }

.flow__scrubBar {
  display: flex; align-items: center; gap: 16px; padding: 11px 14px;
  border: 1px solid var(--f-line); border-radius: 12px; background: var(--f-bg);
}
.flow__scrubLabel { min-width: 168px; }
.flow__when { display: block; font-size: 14px; font-weight: 750; color: var(--f-ink); font-variant-numeric: tabular-nums; }
.flow__when.is-live { color: var(--f-good); }
.flow__scrubHint { display: block; font-size: 11px; color: var(--f-dim); margin-top: 1px; }
.flow__scrub { flex: 1; accent-color: var(--f-accent); cursor: ew-resize; }
.flow__now {
  padding: 7px 12px; border-radius: 8px; cursor: pointer; font: inherit; font-size: 12px; font-weight: 650;
  border: 1px solid var(--f-line); background: transparent; color: var(--f-ink);
}
.flow__now:hover { background: color-mix(in srgb, var(--f-ink) 6%, transparent); }

.flow__board { display: flex; gap: 12px; align-items: flex-start; overflow-x: auto; padding-bottom: 8px; }
.flow__col {
  flex: 1 0 232px; min-width: 232px; border: 1px solid var(--f-line); border-radius: 14px;
  background: color-mix(in srgb, var(--f-ink) 2.5%, transparent);
  transition: background .18s, border-color .18s, transform .18s var(--f-ease);
}
.flow__col.is-dragging { border-style: dashed; }
.flow__col.is-target {
  border-color: var(--f-accent); background: color-mix(in srgb, var(--f-accent) 9%, transparent);
  transform: translateY(-2px);
}

.flow__colHead { padding: 12px 13px 10px; border-bottom: 1px solid var(--f-line); border-top: 3px solid var(--col); border-radius: 13px 13px 0 0; }
.flow__colTop { display: flex; align-items: baseline; gap: 8px; }
.flow__colName { font-size: 12.5px; font-weight: 750; color: var(--f-ink); }
.flow__colCount {
  margin-left: auto; font-size: 11px; font-weight: 700; color: var(--f-dim);
  padding: 1px 7px; border-radius: 999px; background: color-mix(in srgb, var(--f-ink) 8%, transparent);
}
.flow__colValue { font-size: 17px; font-weight: 750; margin-top: 4px; color: var(--f-ink); font-variant-numeric: tabular-nums; }
.flow__colFlow { display: flex; gap: 10px; margin-top: 3px; font-size: 10.5px; color: var(--f-dim); }
.flow__bottleneck { color: var(--f-bad); font-weight: 700; }
.flow__stalledTag {
  margin-top: 7px; display: inline-block; font-size: 10px; font-weight: 700;
  padding: 2px 7px; border-radius: 6px; color: var(--f-late);
  background: color-mix(in srgb, var(--f-late) 14%, transparent);
}

.flow__cards { padding: 10px; display: flex; flex-direction: column; gap: 8px; min-height: 80px; }
.flow__empty { margin: 0; padding: 14px 2px; font-size: 11.5px; color: var(--f-dim); }

.flow__waterline {
  display: flex; align-items: center; gap: 8px; margin: 6px 0 10px;
  font-size: 9.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--f-late);
}
.flow__waterline::before, .flow__waterline::after {
  content: ""; flex: 1; height: 1px;
  background: repeating-linear-gradient(90deg, color-mix(in srgb, var(--f-late) 55%, transparent) 0 4px, transparent 4px 8px);
}

.flow__card {
  padding: 10px 11px; border-radius: 11px; background: var(--f-bg);
  border: 1px solid var(--f-line); cursor: grab; touch-action: none;
  transition: box-shadow .16s, transform .12s, border-color .16s;
}
.flow__card:hover { box-shadow: 0 4px 16px rgba(0,0,0,.09); transform: translateY(-1px); }
.flow__card:active { cursor: grabbing; }
.flow__card:focus-visible { outline: 2px solid var(--modern-accent, var(--accent)); outline-offset: 2px; }
.flow__kbMenu { position: absolute; top: 6px; right: 6px; z-index: 30; display: flex; flex-direction: column;
  background: var(--card-bg); border: 1px solid var(--line); border-radius: 9; border-radius: 9px;
  box-shadow: 0 10px 30px rgba(0,0,0,.25); overflow: hidden; min-width: 150px; }
.flow__kbItem { border: none; background: transparent; text-align: left; padding: 8px 12px; font: inherit;
  font-size: 12px; color: var(--ink); cursor: pointer; }
.flow__kbItem:hover, .flow__kbItem:focus-visible { background: var(--panel2); }
.flow__card.is-late { border-left: 3px solid color-mix(in srgb, var(--f-late) calc(40% + var(--age) * 60%), transparent); }
.flow__card.is-lifted { opacity: .35; }
.flow__cardTop { display: flex; align-items: baseline; gap: 8px; }
.flow__ref { font-size: 12px; font-weight: 700; color: var(--f-ink); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.flow__total { margin-left: auto; font-size: 12px; font-weight: 750; color: var(--f-ink); font-variant-numeric: tabular-nums; }
.flow__account { font-size: 11.5px; color: var(--f-dim); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.flow__cardFoot { display: flex; align-items: center; gap: 7px; margin-top: 8px; }
.flow__ageBar { flex: 1; height: 3px; border-radius: 2px; background: color-mix(in srgb, var(--f-ink) 9%, transparent); overflow: hidden; }
.flow__ageBar > span {
  display: block; height: 100%; border-radius: 2px;
  width: calc(var(--age) * 100%);
  background: color-mix(in srgb, var(--f-late) calc(30% + var(--age) * 70%), var(--f-accent));
}
.flow__age { font-size: 10px; color: var(--f-dim); font-variant-numeric: tabular-nums; }
.flow__outcome { font-size: 9.5px; font-weight: 750; text-transform: uppercase; padding: 1px 5px; border-radius: 4px; }
.flow__outcome--won { color: var(--f-good); background: color-mix(in srgb, var(--f-good) 14%, transparent); }
.flow__outcome--lost, .flow__outcome--dropped { color: var(--f-bad); background: color-mix(in srgb, var(--f-bad) 14%, transparent); }

.flow__ghost {
  position: fixed; z-index: 600; pointer-events: none; transform: translate(-50%, -50%) rotate(-2deg);
  display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 10px;
  background: var(--f-bg); border: 1px solid var(--f-accent); box-shadow: 0 14px 36px rgba(0,0,0,.26);
}

.flow__sheet { position: fixed; inset: 0; z-index: 620; display: flex; align-items: center; justify-content: center; padding: 20px; }
.flow__sheetScrim { position: absolute; inset: 0; background: rgba(8,12,20,.5); backdrop-filter: blur(3px); }
.flow__sheetBody {
  position: relative; width: min(400px, 100%); padding: 22px; border-radius: 16px;
  background: var(--f-bg); border: 1px solid var(--f-line); box-shadow: 0 24px 70px rgba(0,0,0,.35);
}
.flow__sheetBody h3 { margin: 0; font-size: 16px; font-weight: 750; color: var(--f-ink); }
.flow__sheetBody p { margin: 8px 0 0; font-size: 12.5px; line-height: 1.6; color: var(--f-dim); }
.flow__outcomes { display: flex; gap: 8px; margin-top: 18px; }
.flow__outcomeBtn {
  flex: 1; padding: 11px 8px; border-radius: 10px; cursor: pointer; font: inherit;
  font-size: 13px; font-weight: 700; color: #fff; border: none; transition: transform .12s, filter .15s;
}
.flow__outcomeBtn:hover { filter: brightness(1.08); }
.flow__outcomeBtn:active { transform: scale(.97); }
.flow__outcomeBtn--won { background: var(--f-good); }
.flow__outcomeBtn--lost { background: var(--f-bad); }
.flow__outcomeBtn--dropped { background: var(--f-dim); }
.flow__cancel {
  width: 100%; margin-top: 10px; padding: 9px; border-radius: 9px; cursor: pointer; font: inherit;
  font-size: 12.5px; font-weight: 600; color: var(--f-dim); border: 1px solid var(--f-line); background: transparent;
}

@media (max-width: 640px) {
  .flow__scrubBar { flex-wrap: wrap; gap: 10px; }
  .flow__scrub { order: 3; flex-basis: 100%; }
  .flow__col { flex: 0 0 82vw; min-width: 82vw; }
}

@media (prefers-reduced-motion: reduce) {
  .flow *, .flow *::before, .flow *::after { transition-duration: .01ms !important; }
}
`;
