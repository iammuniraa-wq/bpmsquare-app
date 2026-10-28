import type { CSSProperties } from "react";
import Link from "next/link";
import type { TenderDeskData, TenderDeskStyle } from "@/lib/tenderDesk/types";
import { assignLanes, compact, dayTone, daysText, timelinePosition } from "./format";
import { lookVars } from "./look";
import s from "./tenderBlocks.module.css";

const DOT = { red: s.dotRed, amber: s.dotAmber, green: s.dotGreen } as const;
// Row tops relative to the axis: nearest above, nearest below, second above, second below.
const LANE_OFFSET = [-75, 19, -125, 69];

/**
 * The next 28 days as a line with a marker on each bid end date; labels take free rows so two close dates never overlap. Every marker's label
 * is a link to the deal. Under 640 px the line becomes a plain list (CSS).
 */
export default function DeadlineTimeline({ data, look }: { data: TenderDeskData; look: TenderDeskStyle }) {
  const within = data.closing.filter((x) => x.daysLeft <= 28);
  // Bids past the 28 days that the (capped) list did not draw are counted from the whole workspace, not from the list.
  const later = data.closingAfter28;
  const positions = within.map((d) => timelinePosition(d.daysLeft));
  const lanes = assignLanes(positions);
  const second = lanes.some((l) => l >= 2);
  const axisY = second ? 129 : 79;
  const height = lanes.includes(3) ? axisY + 19 + 50 + 49 : axisY + 79;
  return (
    <div className={s.blk} style={lookVars(look)} data-look={look}>
      {within.length === 0 ? <p className={s.quiet}>No bid ends in the next 28 days.</p> : (
        <>
          <div className={s.tlWrap} data-guide="tender.dash.deadlines">
            <div className={s.tlAxis} style={{ "--a": `${axisY}px` } as CSSProperties} aria-hidden="true" />
            <ol className={s.tl} style={{ "--a": `${axisY}px`, "--h": `${height}px` } as CSSProperties}>
              {within.map((d, i) => {
                const pos = positions[i];
                const align = pos.align === "start" ? s.alignStart : pos.align === "end" ? s.alignEnd : "";
                return (
                  <li key={d.id} className={s.mk} style={{ "--x": `${pos.pct}%` } as CSSProperties}>
                    <span className={`${s.mkDot} ${DOT[dayTone(d.daysLeft)]}`} aria-hidden="true" />
                    <Link
                      href={d.href}
                      className={`${s.mkLabel} ${align}`}
                      style={{ top: `calc(var(--a) + ${LANE_OFFSET[lanes[i]]}px)` }}
                      data-guide="tender.dash.deadline"
                      title={d.title}
                      aria-label={`${d.title}, closes in ${daysText(d.daysLeft)}, ${compact(d.value)} ${data.currency}`}
                    >
                      <b>{[d.ref, daysText(d.daysLeft)].filter(Boolean).join(" · ")}</b>
                      <span>{d.title} · {compact(d.value)}</span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </div>
          <div className={s.tlTicks} aria-hidden="true"><span>today</span><span>+7 days</span><span>+14 days</span><span>+21 days</span><span>+28 days</span></div>
        </>
      )}
      {later > 0 && <p className={s.later}>{later} more {later === 1 ? "bid ends" : "bids end"} after 28 days.</p>}
    </div>
  );
}
