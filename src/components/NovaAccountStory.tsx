"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { AccountStoryEvent } from "@/lib/nova/accountStory";
import type { Account360Rating } from "@/lib/account360/types";

const TONE_COLOR: Record<AccountStoryEvent["tone"], string> = {
  good: "var(--nova-teal-soft)",
  bad: "var(--nova-orange-soft)",
  neutral: "var(--nova-purple-softer)",
};

const GRADE_COLOR: Record<Account360Rating["grade"], { color: string; bg: string }> = {
  A: { color: "var(--nova-teal-soft)", bg: "var(--nova-teal-bg)" },
  B: { color: "var(--nova-purple-softer)", bg: "var(--nova-purple-bg)" },
  C: { color: "var(--nova-orange-soft)", bg: "var(--nova-orange-bg)" },
  D: { color: "var(--nova-pink-soft)", bg: "var(--nova-pink-bg)" },
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/**
 * Nova's Account story -- a real, scrubbable timeline of what actually
 * happened on this account (quotes, cases, invoices, AMC coverage), not
 * the design prototype's fictional health-over-time curve. Position along
 * the axis is proportional to real elapsed time between the first and
 * most recent event; there is no projected/future segment because nothing
 * here is forecast.
 */
export default function NovaAccountStory({
  accountName,
  events,
  health,
}: {
  accountName: string;
  events: AccountStoryEvent[];
  health: Account360Rating;
}) {
  const [index, setIndex] = useState(events.length - 1);
  const grade = GRADE_COLOR[health.grade];
  const trackRef = useRef<HTMLDivElement>(null);

  const positions = useMemo(() => {
    if (events.length <= 1) return events.map(() => 50);
    const first = new Date(events[0].date).getTime();
    const last = new Date(events[events.length - 1].date).getTime();
    const span = Math.max(1, last - first);
    return events.map((e) => ((new Date(e.date).getTime() - first) / span) * 100);
  }, [events]);

  if (events.length === 0) {
    return (
      <div style={{ border: "1px solid var(--nova-line)", borderRadius: "var(--nova-radius-card)", padding: "28px 20px", textAlign: "center", color: "var(--nova-ink-dim)", fontSize: 14, marginBottom: 20 }}>
        No history yet on {accountName} — the story fills in as quotes, cases, and invoices happen.
      </div>
    );
  }

  const current = events[index];

  // Single scrub gesture driving the whole card -- click or drag anywhere
  // along the track, snapping to the nearest event by its real (time-
  // proportional) position. Replaces what used to be two separate controls
  // for the same index: the dot row and a native range slider underneath
  // it, which also duplicated the date the event card already shows
  // (owner-flagged 2026-08-25: "these 3 sections can be clubbed into one").
  function scrubToPointer(e: React.PointerEvent<HTMLDivElement>) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    let nearest = 0;
    let best = Infinity;
    positions.forEach((p, i) => {
      const d = Math.abs(p - pct);
      if (d < best) { best = d; nearest = i; }
    });
    setIndex(nearest);
  }

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <div>
          <div className="nova-display" style={{ fontSize: 18 }}>{accountName} — Account story</div>
          <div style={{ fontSize: 12, color: "var(--nova-ink-faint)" }}>
            {fmtDate(events[0].date)} → {fmtDate(events[events.length - 1].date)}
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: grade.color, background: grade.bg, borderRadius: "var(--nova-radius-pill)", padding: "5px 14px" }}>
            Health {health.score}
          </span>
          <span style={{ fontSize: 12, fontWeight: 500, color: "var(--nova-ink-dim)", background: "var(--nova-glass-bg)", border: "1px solid var(--nova-glass-border)", borderRadius: "var(--nova-radius-pill)", padding: "5px 14px" }}>
            {health.label}
          </span>
        </div>
      </div>

      <div style={{ border: "1px solid var(--nova-line)", borderRadius: "var(--nova-radius-card)", padding: "18px 20px" }}>
        <div
          ref={trackRef}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrubToPointer(e); }}
          onPointerMove={(e) => { if (e.buttons === 1) scrubToPointer(e); }}
          style={{ position: "relative", height: 32, marginBottom: 4, cursor: "pointer", touchAction: "none" }}
        >
          <div style={{ position: "absolute", left: 0, right: 0, top: 15, height: 2, background: "var(--nova-line)" }} />
          {positions.map((pos, i) => (
            <div
              key={events[i].id}
              title={events[i].title}
              style={{
                position: "absolute",
                left: `${pos}%`,
                top: 10,
                width: 12,
                height: 12,
                borderRadius: "50%",
                transform: "translateX(-50%)",
                background: i === index ? TONE_COLOR[events[i].tone] : "var(--nova-glass-border)",
                border: i === index ? "2px solid var(--nova-bg)" : "none",
                boxShadow: i === index ? `0 0 0 2px ${TONE_COLOR[events[i].tone]}` : "none",
                pointerEvents: "none",
              }}
            />
          ))}
        </div>

        <Link
          href={current.href}
          style={{ display: "block", textDecoration: "none", color: "inherit", paddingTop: 10, borderTop: "1px solid var(--nova-line-soft)" }}
        >
          <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: TONE_COLOR[current.tone], marginBottom: 5 }}>
            {fmtDate(current.date)}
          </div>
          <div style={{ fontSize: 14, color: "var(--nova-ink)", opacity: 0.9 }}>{current.title}</div>
          <div style={{ fontSize: 12, color: "var(--nova-ink-faint)", marginTop: 3 }}>{current.detail}</div>
        </Link>
      </div>
    </div>
  );
}
