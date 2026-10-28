import Link from "next/link";
import type { TenderDeskData, TenderDeskStyle } from "@/lib/tenderDesk/types";
import { tenderLinks } from "@/lib/tenderDesk/links";
import { tileMoney, trendAria, trendDeltaText, trendGeometry } from "./format";
import { lookVars } from "./look";
import s from "./tenderBlocks.module.css";

/** The open pipeline as one big figure with its 12-week area chart. The whole card is a link to the tenders. */
export default function TrendArea({ data, look }: { data: TenderDeskData; look: TenderDeskStyle }) {
  const open = tileMoney(data.kpis.openValue, data.currency);
  const trend = trendGeometry(data.trend);
  const id = `tdTrend-${look}`;
  return (
    <div className={s.blk} style={lookVars(look)} data-look={look} data-guide="tender.dash.trend">
      <Link href={tenderLinks.tab} className={s.trendLink} aria-label={`${trendAria(data.trend, data.currency)} Opens all tenders.`}>
        <span className={s.heroTop}>
          <span className={`${s.big}`}>{open.value}<small>{open.unit}</small></span>
          {trend && <span className={`${s.delta} ${trend.delta < 0 ? s.deltaDown : ""}`}>{trendDeltaText(trend.delta, trend.from)}</span>}
        </span>
        {trend ? (
          <span className={s.trend}>
            <svg viewBox="0 0 520 120" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" style={{ stopColor: "var(--td-trend-fill)", stopOpacity: 0.5 }} />
                  <stop offset="1" style={{ stopColor: "var(--td-trend-fill)", stopOpacity: 0 }} />
                </linearGradient>
              </defs>
              <path className={s.trendArea} d={trend.area} fill={`url(#${id})`} />
              <path d={trend.line} fill="none" style={{ stroke: "var(--td-trend)" }} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </svg>
            <span className={s.trendDot} style={{ left: `${trend.lastXPct}%`, top: `${trend.lastYPct}%` }} aria-hidden="true" />
          </span>
        ) : <span className={s.quiet}>Not enough history yet to draw the trend.</span>}
      </Link>
    </div>
  );
}
