"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Nova — Account 360. A side drawer holding everything about one account:
 * the health rating and what moved it, what to do next, then a card per
 * dimension, followed by whatever external sources the tenant plugged in.
 *
 * Opened by a `nova:open-account-360` CustomEvent carrying the account id,
 * so any surface can raise it (list row, detail header, palette later)
 * without importing the drawer or holding its state.
 *
 * The interaction model, not just the data, is the point here: the panel
 * springs in, cards arrive staggered, the dial draws itself, factor bars
 * grow, every card expands in place, and on touch the panel follows your
 * finger and can be flung away. All of it collapses to nothing under
 * prefers-reduced-motion -- the states still change, they just stop moving.
 */

type Tone = "good" | "warn" | "bad" | "neutral";
type Stat = { label: string; value: string; hint?: string; tone?: Tone };
type Row = { title: string; meta?: string; value?: string; tone?: Tone; href?: string };
type Card = {
  id: string; title: string; subtitle?: string; kind: "internal" | "external";
  stats?: Stat[]; rows?: Row[]; empty?: string; error?: string;
};
type Payload = {
  account: { id: string; name: string; ref: string | null; type: string; city: string | null; industry: string | null; since: string };
  rating: { score: number; grade: "A" | "B" | "C" | "D"; label: string; factors: { label: string; points: number; detail: string }[] };
  suggestions: { id: string; title: string; detail: string; urgency: "high" | "medium" | "low"; href?: string }[];
  cards: Card[];
};

const CLOSE_AFTER_PX = 90;

export default function Account360Drawer() {
  const router = useRouter();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [openCards, setOpenCards] = useState<Set<string>>(new Set());
  const [showWorking, setShowWorking] = useState(false);
  const [drag, setDrag] = useState(0);

  const panelRef = useRef<HTMLElement>(null);
  const dragStart = useRef<{ x: number; y: number; axis: "x" | "y" | null } | null>(null);

  const close = useCallback(() => {
    setClosing(true);
    // Let the exit animation play; reduced-motion users get the same
    // teardown, just without watching it.
    window.setTimeout(() => {
      setAccountId(null);
      setData(null);
      setError(null);
      setClosing(false);
      setDrag(0);
      setScrolled(false);
      setShowWorking(false);
      setOpenCards(new Set());
    }, 180);
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) return;
      setData(null); setError(null); setClosing(false); setDrag(0);
      setScrolled(false); setShowWorking(false); setOpenCards(new Set());
      setAccountId(id);
    };
    window.addEventListener("nova:open-account-360", onOpen);
    return () => window.removeEventListener("nova:open-account-360", onOpen);
  }, []);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    fetch(`/api/nova/account-360/${accountId}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) { setError(json.error ?? "Could not load this account"); return; }
        const payload = json as Payload;
        setData(payload);
        // Open the first card that has detail, so the drawer arrives with
        // something already unfolded rather than a column of shut lids.
        const first = payload.cards.find((cd) => (cd.rows ?? []).length > 0);
        if (first) setOpenCards(new Set([first.id]));
      })
      .catch(() => { if (!cancelled) setError("Could not reach the server"); });
    return () => { cancelled = true; };
  }, [accountId]);

  useEffect(() => {
    if (!accountId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [accountId, close]);

  if (!accountId) return null;

  function go(href: string) {
    close();
    router.push(href);
  }

  function toggleCard(id: string) {
    setOpenCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Touch: the panel tracks the finger rightwards and is flung away past a
  // threshold. Direction-locked on the first few pixels, so an ordinary
  // vertical scroll with a bit of sideways drift doesn't wobble the panel;
  // leftward drag is clamped to 0 so it can't be pulled off-screen.
  function onTouchStart(e: React.TouchEvent) {
    dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, axis: null };
  }
  function onTouchMove(e: React.TouchEvent) {
    const start = dragStart.current;
    if (!start) return;
    const dx = e.touches[0].clientX - start.x;
    const dy = e.touches[0].clientY - start.y;
    if (start.axis === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      start.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (start.axis === "y") return;
    setDrag(Math.max(0, dx));
  }
  function onTouchEnd() {
    if (!dragStart.current) return;
    dragStart.current = null;
    if (drag > CLOSE_AFTER_PX) close(); else setDrag(0);
  }

  const dragging = drag > 0;

  return (
    <div className={`a360 ${closing ? "a360--closing" : ""}`} role="dialog" aria-modal="true" aria-label="Account 360">
      <style>{CSS}</style>

      <div className="a360__scrim" onClick={close} style={dragging ? { opacity: Math.max(0, 1 - drag / 320) } : undefined} />

      <aside
        ref={panelRef}
        className="a360__panel"
        onScroll={(e) => setScrolled((e.target as HTMLElement).scrollTop > 48)}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={dragging ? { transform: `translateX(${drag}px)`, transition: "none" } : undefined}
      >
        <div className="a360__grabber" aria-hidden="true" />

        <header className={`a360__head ${scrolled ? "is-condensed" : ""}`}>
          <div className="a360__headMain">
            <span className="a360__eyebrow">Account 360</span>
            <h2 className="a360__title">{data?.account.name ?? "Loading…"}</h2>
            {data && (
              <span className="a360__sub">
                {[data.account.ref, data.account.industry, data.account.city].filter(Boolean).join(" · ") || data.account.type}
              </span>
            )}
          </div>
          {data && <span className={`a360__chip a360__chip--${data.rating.grade}`}>{data.rating.grade}</span>}
          <button className="a360__close" onClick={close} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="a360__body">
          {!data && !error && <Skeleton />}
          {error && <p className="a360__error">{error}</p>}

          {data && (
            <>
              <section className="a360__card a360__enter" style={{ animationDelay: "0ms" }}>
                <div className="a360__ratingTop">
                  <Dial score={data.rating.score} grade={data.rating.grade} />
                  <div className="a360__ratingText">
                    <div className={`a360__ratingLabel a360__ink--${data.rating.grade}`}>{data.rating.label}</div>
                    <div className="a360__muted">Health {data.rating.score} of 100</div>
                    <button className="a360__linkBtn" onClick={() => setShowWorking((v) => !v)} aria-expanded={showWorking}>
                      {showWorking ? "Hide the working" : "How is this scored?"}
                      <Chevron open={showWorking} />
                    </button>
                  </div>
                </div>

                <div className={`a360__reveal ${showWorking ? "is-open" : ""}`}>
                  <div className="a360__revealInner">
                    {data.rating.factors.map((f, i) => (
                      <div className="a360__factor" key={f.label}>
                        <span className="a360__factorName">{f.label}</span>
                        <span className="a360__factorBody">
                          <span className="a360__track">
                            <span
                              className={`a360__fill a360__fill--${data.rating.grade}`}
                              style={{
                                // Weights differ per factor (25/25/20/15/15), so
                                // each bar is drawn against its own maximum --
                                // a full Service bar and a full Recency bar both
                                // mean "nothing wrong here".
                                width: showWorking ? `${Math.min(100, (f.points / factorMax(f.label)) * 100)}%` : "0%",
                                transitionDelay: `${i * 55}ms`,
                              }}
                            />
                          </span>
                          <span className="a360__factorDetail">{f.detail}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              {data.suggestions.length > 0 && (
                <section className="a360__card a360__enter" style={{ animationDelay: "60ms" }}>
                  <h3 className="a360__cardTitle">What to do next</h3>
                  <div className="a360__stack">
                    {data.suggestions.map((s) => (
                      <button
                        key={s.id}
                        className={`a360__suggestion a360__suggestion--${s.urgency} ${s.href ? "is-clickable" : ""}`}
                        onClick={() => s.href && go(s.href)}
                        disabled={!s.href}
                      >
                        <span className="a360__urgency" />
                        <span className="a360__suggestionText">
                          <span className="a360__suggestionTitle">{s.title}</span>
                          <span className="a360__muted">{s.detail}</span>
                        </span>
                        {s.href && <span className="a360__go" aria-hidden="true">→</span>}
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {data.cards.map((card, i) => {
                const open = openCards.has(card.id);
                const rows = card.rows ?? [];
                const expandable = rows.length > 0;
                return (
                  <section key={card.id} className="a360__card a360__enter" style={{ animationDelay: `${120 + i * 55}ms` }}>
                    <button
                      className={`a360__cardHead ${expandable ? "is-expandable" : ""}`}
                      onClick={() => expandable && toggleCard(card.id)}
                      aria-expanded={expandable ? open : undefined}
                      disabled={!expandable}
                    >
                      <h3 className="a360__cardTitle">{card.title}</h3>
                      {card.subtitle && <span className="a360__muted">{card.subtitle}</span>}
                      {card.kind === "external" && <span className="a360__tag">Source</span>}
                      {expandable && (
                        <span className="a360__cardToggle">
                          {open ? "Less" : rows.length > 1 ? `${rows.length} items` : "1 item"}
                          <Chevron open={open} />
                        </span>
                      )}
                    </button>

                    {card.error && <p className="a360__warn">{card.error}</p>}

                    {card.stats && card.stats.length > 0 && (
                      <div className="a360__stats">
                        {card.stats.map((s) => (
                          <div className="a360__stat" key={s.label}>
                            <span className="a360__statLabel">{s.label}</span>
                            <span className={`a360__statValue ${s.tone ? `a360__tone--${s.tone}` : ""}`}>{s.value}</span>
                            {s.hint && <span className="a360__statHint">{s.hint}</span>}
                          </div>
                        ))}
                      </div>
                    )}

                    {expandable && (
                      <div className={`a360__reveal ${open ? "is-open" : ""}`}>
                        <div className="a360__revealInner a360__rows">
                          {rows.map((r, ri) => {
                            const inner = (
                              <>
                                <span className="a360__rowText">
                                  <span className="a360__rowTitle">{r.title}</span>
                                  {r.meta && <span className="a360__rowMeta">{r.meta}</span>}
                                </span>
                                {r.value && <span className={`a360__rowValue ${r.tone ? `a360__tone--${r.tone}` : ""}`}>{r.value}</span>}
                                {r.href && <span className="a360__go" aria-hidden="true">→</span>}
                              </>
                            );
                            return r.href ? (
                              <button key={`${r.title}-${ri}`} className="a360__row is-clickable" onClick={() => go(r.href!)}>{inner}</button>
                            ) : (
                              <div key={`${r.title}-${ri}`} className="a360__row">{inner}</div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {!card.error && !card.stats?.length && rows.length === 0 && (
                      <p className="a360__muted a360__emptyLine">{card.empty ?? "Nothing here yet"}</p>
                    )}
                  </section>
                );
              })}

              <button className="a360__full a360__enter" style={{ animationDelay: `${180 + data.cards.length * 55}ms` }} onClick={() => go(`/accounts/${data.account.id}`)}>
                Open the full account record
                <span className="a360__go" aria-hidden="true">→</span>
              </button>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

/** Each factor's own weight, so a bar reads as "how much of what's
 *  available did this account keep" rather than a share of 100. Mirrors
 *  src/lib/account360/rating.ts. */
function factorMax(label: string): number {
  switch (label) {
    case "Recency": return 25;
    case "Win rate": return 25;
    case "Payment": return 20;
    default: return 15;
  }
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`a360__chev ${open ? "is-open" : ""}`} width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 6.5 8 10.5l4-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Dial({ score, grade }: { score: number; grade: string }) {
  const r = 27;
  const circumference = 2 * Math.PI * r;
  const [drawn, setDrawn] = useState(0);

  // Draw on mount rather than rendering finished: the arc filling up is the
  // one moment that says "this was just calculated for you".
  useEffect(() => {
    const t = window.setTimeout(() => setDrawn(score), 60);
    return () => window.clearTimeout(t);
  }, [score]);

  return (
    <div className="a360__dial">
      <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true">
        <circle className="a360__dialTrack" cx="36" cy="36" r={r} />
        <circle
          className={`a360__dialArc a360__arc--${grade}`}
          cx="36" cy="36" r={r}
          strokeDasharray={`${(drawn / 100) * circumference} ${circumference}`}
        />
      </svg>
      <span className={`a360__dialGrade a360__ink--${grade}`}>{grade}</span>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="a360__stack" aria-hidden="true">
      {[104, 150, 128, 128].map((h, i) => (
        <div key={i} className="a360__skel" style={{ height: h, animationDelay: `${i * 90}ms` }} />
      ))}
    </div>
  );
}

const CSS = `
.a360 {
  position: fixed; inset: 0; z-index: 500; display: flex; justify-content: flex-end;
  --a360-bg: var(--sb-panel-bg, #fff);
  --a360-line: var(--sb-panel-border, #e5e7eb);
  --a360-ink: var(--sb-panel-text, #111827);
  --a360-dim: var(--sb-panel-text-dim, #8b93a1);
  --a360-accent: var(--modern-accent, var(--accent, #1f6feb));
  --a360-good: #12a150; --a360-warn: #d97706; --a360-bad: #e5484d;
  --a360-ease: cubic-bezier(.22,1,.36,1);
}
.a360__scrim {
  position: absolute; inset: 0; background: rgba(8,12,20,.45);
  backdrop-filter: blur(3px); animation: a360-fade .22s ease-out;
}
.a360--closing .a360__scrim { animation: a360-fade .16s ease-in reverse both; }

.a360__panel {
  position: relative; width: min(560px, 100%); height: 100%; overflow-y: auto;
  overscroll-behavior: contain; -webkit-overflow-scrolling: touch;
  background: var(--a360-bg); border-left: 1px solid var(--a360-line);
  box-shadow: -28px 0 70px rgba(0,0,0,.3);
  animation: a360-slide .34s var(--a360-ease);
  transition: transform .28s var(--a360-ease);
}
.a360--closing .a360__panel { animation: a360-slide .18s ease-in reverse both; }

.a360__grabber { display: none; }

.a360__head {
  position: sticky; top: 0; z-index: 3; display: flex; align-items: flex-start; gap: 10px;
  padding: 16px 20px 13px; background: var(--a360-bg);
  border-bottom: 1px solid transparent; transition: border-color .2s, padding .24s var(--a360-ease);
}
.a360__head.is-condensed { border-bottom-color: var(--a360-line); padding-top: 11px; padding-bottom: 10px; }
.a360__headMain { flex: 1; min-width: 0; }
.a360__eyebrow {
  display: block; font-size: 10px; font-weight: 750; letter-spacing: .09em;
  text-transform: uppercase; color: var(--a360-dim);
  max-height: 16px; overflow: hidden; transition: max-height .24s var(--a360-ease), opacity .18s;
}
.a360__head.is-condensed .a360__eyebrow { max-height: 0; opacity: 0; }
.a360__title { margin: 2px 0 0; font-size: 17px; font-weight: 750; color: var(--a360-ink); line-height: 1.25; }
.a360__sub {
  display: block; margin-top: 3px; font-size: 11.5px; color: var(--a360-dim);
  max-height: 18px; overflow: hidden; transition: max-height .24s var(--a360-ease), opacity .18s;
}
.a360__head.is-condensed .a360__sub { max-height: 0; opacity: 0; }

.a360__chip {
  flex-shrink: 0; width: 26px; height: 26px; border-radius: 8px; margin-top: 2px;
  display: flex; align-items: center; justify-content: center;
  font-size: 12.5px; font-weight: 800; color: #fff;
  opacity: 0; transform: scale(.7); transition: opacity .2s, transform .28s var(--a360-ease);
}
.a360__head.is-condensed .a360__chip { opacity: 1; transform: none; }
.a360__chip--A, .a360__chip--B { background: var(--a360-good); }
.a360__chip--C { background: var(--a360-warn); }
.a360__chip--D { background: var(--a360-bad); }

.a360__close {
  flex-shrink: 0; width: 32px; height: 32px; border-radius: 9px; cursor: pointer;
  border: 1px solid var(--a360-line); background: transparent; color: var(--a360-dim);
  display: flex; align-items: center; justify-content: center;
  transition: background .16s, color .16s, transform .16s;
}
.a360__close:hover { background: color-mix(in srgb, var(--a360-ink) 7%, transparent); color: var(--a360-ink); }
.a360__close:active { transform: scale(.92); }

.a360__body { padding: 14px 20px 44px; display: flex; flex-direction: column; gap: 12px; }

.a360__card {
  padding: 14px 16px; border-radius: 15px; border: 1px solid var(--a360-line);
  background: color-mix(in srgb, var(--a360-ink) 3%, transparent);
}
.a360__enter { animation: a360-rise .4s var(--a360-ease) both; }

.a360__cardHead {
  display: flex; align-items: baseline; gap: 8px; width: 100%; padding: 0; margin: 0 0 10px;
  background: none; border: none; font: inherit; text-align: left; color: inherit;
}
.a360__cardHead.is-expandable { cursor: pointer; }
.a360__cardTitle { margin: 0; font-size: 13px; font-weight: 750; color: var(--a360-ink); }
.a360__cardToggle {
  margin-left: auto; display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0;
  font-size: 11px; font-weight: 650; color: var(--a360-accent);
}
.a360__cardHead.is-expandable:hover .a360__cardToggle { text-decoration: underline; }
.a360__tag {
  margin-left: auto; font-size: 9.5px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase;
  padding: 2px 6px; border-radius: 5px; color: var(--a360-dim); border: 1px solid var(--a360-line);
}
.a360__cardHead .a360__tag + .a360__cardToggle { margin-left: 8px; }

.a360__chev { transition: transform .24s var(--a360-ease); }
.a360__chev.is-open { transform: rotate(180deg); }

/* 0fr -> 1fr animates an unknown height without measuring it. */
.a360__reveal { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .3s var(--a360-ease); }
.a360__reveal.is-open { grid-template-rows: 1fr; }
.a360__revealInner { overflow: hidden; min-height: 0; }

.a360__ratingTop { display: flex; align-items: center; gap: 15px; }
.a360__ratingText { min-width: 0; }
.a360__ratingLabel { font-size: 16px; font-weight: 750; }
.a360__muted { display: block; font-size: 11.5px; color: var(--a360-dim); line-height: 1.5; }
.a360__linkBtn {
  display: inline-flex; align-items: center; gap: 5px; margin-top: 6px; padding: 0;
  background: none; border: none; cursor: pointer; font: inherit;
  font-size: 11.5px; font-weight: 650; color: var(--a360-accent);
}
.a360__linkBtn:hover { text-decoration: underline; }

.a360__factor { display: flex; align-items: flex-start; gap: 10px; padding-top: 9px; }
.a360__factor:first-child { padding-top: 13px; }
.a360__factorName { width: 74px; flex-shrink: 0; font-size: 11px; font-weight: 650; color: var(--a360-ink); }
.a360__factorBody { flex: 1; min-width: 0; }
.a360__track {
  display: block; height: 5px; border-radius: 3px; overflow: hidden;
  background: color-mix(in srgb, var(--a360-ink) 10%, transparent);
}
.a360__fill { display: block; height: 100%; border-radius: 3px; width: 0; transition: width .55s var(--a360-ease); }
.a360__fill--A, .a360__fill--B { background: var(--a360-good); }
.a360__fill--C { background: var(--a360-warn); }
.a360__fill--D { background: var(--a360-bad); }
.a360__factorDetail { display: block; font-size: 10.5px; margin-top: 3px; color: var(--a360-dim); }

.a360__stack { display: flex; flex-direction: column; gap: 8px; }

.a360__suggestion {
  display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; font: inherit;
  padding: 10px 11px; border-radius: 11px; border: 1px solid var(--a360-line);
  background: transparent; color: inherit;
  transition: background .16s, border-color .16s, transform .12s;
}
.a360__suggestion.is-clickable { cursor: pointer; }
.a360__suggestion.is-clickable:hover { background: color-mix(in srgb, var(--a360-ink) 5%, transparent); border-color: color-mix(in srgb, var(--a360-ink) 22%, transparent); }
.a360__suggestion.is-clickable:active { transform: scale(.985); }
.a360__urgency { width: 5px; border-radius: 3px; flex-shrink: 0; align-self: stretch; }
.a360__suggestion--high .a360__urgency { background: var(--a360-bad); }
.a360__suggestion--medium .a360__urgency { background: var(--a360-warn); }
.a360__suggestion--low .a360__urgency { background: var(--a360-dim); }
.a360__suggestionText { flex: 1; min-width: 0; }
.a360__suggestionTitle { display: block; font-size: 12.5px; font-weight: 700; color: var(--a360-ink); margin-bottom: 2px; }
.a360__go { flex-shrink: 0; font-size: 13px; color: var(--a360-dim); transition: transform .18s var(--a360-ease), color .18s; }
.is-clickable:hover .a360__go { transform: translateX(3px); color: var(--a360-accent); }

.a360__stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(108px, 1fr)); gap: 10px; }
.a360__stat { min-width: 0; }
.a360__statLabel { display: block; font-size: 9.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--a360-dim); }
.a360__statValue { display: block; font-size: 16.5px; font-weight: 750; margin-top: 2px; color: var(--a360-ink); font-variant-numeric: tabular-nums; }
.a360__statHint { display: block; font-size: 10.5px; margin-top: 1px; color: var(--a360-dim); }
.a360__tone--good { color: var(--a360-good); }
.a360__tone--warn { color: var(--a360-warn); }
.a360__tone--bad { color: var(--a360-bad); }
.a360__tone--neutral { color: var(--a360-accent); }

.a360__rows { padding-top: 2px; }
.a360__row {
  display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; font: inherit;
  padding: 9px 0; background: none; border: none; border-top: 1px solid var(--a360-line); color: inherit;
}
.a360__rows > .a360__row:first-child { border-top: none; }
.a360__row.is-clickable { cursor: pointer; }
.a360__row.is-clickable:hover .a360__rowTitle { color: var(--a360-accent); }
.a360__rowText { flex: 1; min-width: 0; }
.a360__rowTitle { display: block; font-size: 12px; font-weight: 650; color: var(--a360-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: color .16s; }
.a360__rowMeta { display: block; font-size: 11px; margin-top: 1px; color: var(--a360-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.a360__rowValue { flex-shrink: 0; font-size: 11.5px; font-weight: 700; color: var(--a360-dim); font-variant-numeric: tabular-nums; }

.a360__dial { position: relative; width: 72px; height: 72px; flex-shrink: 0; }
.a360__dial svg { transform: rotate(-90deg); }
.a360__dialTrack { fill: none; stroke-width: 6; stroke: color-mix(in srgb, var(--a360-ink) 10%, transparent); }
.a360__dialArc { fill: none; stroke-width: 6; stroke-linecap: round; transition: stroke-dasharray 1s var(--a360-ease); }
.a360__arc--A, .a360__arc--B { stroke: var(--a360-good); }
.a360__arc--C { stroke: var(--a360-warn); }
.a360__arc--D { stroke: var(--a360-bad); }
.a360__dialGrade {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 20px; font-weight: 800;
}
.a360__ink--A, .a360__ink--B { color: var(--a360-good); }
.a360__ink--C { color: var(--a360-warn); }
.a360__ink--D { color: var(--a360-bad); }

.a360__full {
  display: flex; align-items: center; justify-content: center; gap: 7px;
  padding: 11px 14px; border-radius: 11px; cursor: pointer; font: inherit;
  font-size: 12.5px; font-weight: 700; color: var(--a360-ink);
  border: 1px solid var(--a360-line); background: transparent;
  transition: background .16s, transform .12s;
}
.a360__full:hover { background: color-mix(in srgb, var(--a360-ink) 6%, transparent); }
.a360__full:active { transform: scale(.99); }
.a360__full:hover .a360__go { transform: translateX(3px); color: var(--a360-accent); }

.a360__error { margin: 0; padding: 15px; border-radius: 12px; border: 1px solid color-mix(in srgb, var(--a360-bad) 40%, transparent); font-size: 12.5px; color: var(--a360-bad); }
.a360__warn { margin: 0; font-size: 11.5px; color: var(--a360-warn); line-height: 1.5; }
.a360__emptyLine { margin: 0; }

.a360__skel {
  border-radius: 15px; border: 1px solid var(--a360-line);
  background: linear-gradient(100deg,
    color-mix(in srgb, var(--a360-ink) 4%, transparent) 30%,
    color-mix(in srgb, var(--a360-ink) 8%, transparent) 50%,
    color-mix(in srgb, var(--a360-ink) 4%, transparent) 70%);
  background-size: 220% 100%; animation: a360-shimmer 1.5s ease-in-out infinite;
}

@keyframes a360-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes a360-slide { from { transform: translateX(100%) } to { transform: none } }
@keyframes a360-rise { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
@keyframes a360-shimmer { from { background-position: 130% 0 } to { background-position: -30% 0 } }

@media (max-width: 640px) {
  .a360__panel { width: 100%; border-left: none; border-top-left-radius: 0; }
  .a360__grabber {
    display: block; position: sticky; top: 0; z-index: 4; width: 38px; height: 4px; margin: 8px auto -4px;
    border-radius: 2px; background: color-mix(in srgb, var(--a360-ink) 18%, transparent);
  }
  .a360__body { padding: 12px 16px 40px; }
  /* Comfortable touch targets -- rows and suggestions are the things people
     actually tap on a phone. */
  .a360__row { padding: 12px 0; }
  .a360__suggestion { padding: 12px 11px; }
  .a360__close { width: 38px; height: 38px; }
}

@media (prefers-reduced-motion: reduce) {
  .a360__scrim, .a360__panel, .a360__enter, .a360__skel { animation: none; }
  .a360 *, .a360 *::before, .a360 *::after { transition-duration: .01ms !important; }
  .a360__panel { transition: none; }
}
`;
