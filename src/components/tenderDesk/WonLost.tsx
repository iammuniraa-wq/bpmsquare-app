import Link from "next/link";
import type { TenderDeskData, TenderDeskMonth, TenderDeskStyle } from "@/lib/tenderDesk/types";
import { tenderLinks } from "@/lib/tenderDesk/links";
import { monthsAria, monthsHaveData, monthsMax } from "./format";
import { lookVars } from "./look";
import s from "./tenderBlocks.module.css";

const MONTH_W = 30;
const CHART_H = 150;
const BAR_W = 12;

/** Paired columns for the last twelve months. Each column is a link to the tenders decided that way in that month. */
function Columns({ months }: { months: TenderDeskMonth[] }) {
  const max = monthsMax(months);
  const scale = max > 0 ? 118 / max : 0;
  const width = months.length * MONTH_W;
  return (
    <svg className={s.chartBox} viewBox={`0 0 ${width} ${CHART_H + 24}`} role="group" aria-label={monthsAria(months)}>
      <line x1="0" y1={CHART_H} x2={width} y2={CHART_H} style={{ stroke: "var(--line)" }} strokeWidth="1" />
      {months.map((m, i) => {
        const x = i * MONTH_W + MONTH_W / 2;
        const wh = m.won * scale;
        const lh = m.lost * scale;
        return (
          <g key={m.key}>
            {m.won > 0 && (
              <Link href={tenderLinks.outcome("won", m.key)} className={s.markLink} aria-label={`${m.label}: ${m.won} won`}>
                <rect data-hit="true" x={x - MONTH_W / 2} y={0} width={MONTH_W / 2} height={CHART_H} fill="transparent" />
                <rect data-bar="true" x={x - 13} y={CHART_H - wh} width={BAR_W} height={wh} rx="3" style={{ fill: "var(--td-won)" }} />
                <text x={x - 7} y={CHART_H - wh - 4} textAnchor="middle" fontSize="10" style={{ fill: "var(--muted)" }}>{m.won}</text>
              </Link>
            )}
            {m.lost > 0 && (
              <Link href={tenderLinks.outcome("lost", m.key)} className={s.markLink} aria-label={`${m.label}: ${m.lost} lost`}>
                <rect data-hit="true" x={x} y={0} width={MONTH_W / 2} height={CHART_H} fill="transparent" />
                <rect data-bar="true" x={x + 1} y={CHART_H - lh} width={BAR_W} height={lh} rx="3" style={{ fill: "var(--td-lost)" }} />
                <text x={x + 7} y={CHART_H - lh - 4} textAnchor="middle" fontSize="10" style={{ fill: "var(--muted)" }}>{m.lost}</text>
              </Link>
            )}
            <text x={x} y={CHART_H + 17} textAnchor="middle" fontSize="11" style={{ fill: "var(--muted)" }}>{m.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function WonLost({ data, look }: { data: TenderDeskData; look: TenderDeskStyle }) {
  const won = data.months.reduce((n, m) => n + m.won, 0);
  const lost = data.months.reduce((n, m) => n + m.lost, 0);
  return (
    <div className={s.blk} style={lookVars(look)} data-look={look} data-guide="tender.dash.wonlost">
      {monthsHaveData(data.months) ? (
        <>
          <div className={s.legend}>
            <Link href={tenderLinks.outcome("won")} className={s.legendLink} aria-label={`Won: ${won} in the last 12 months`}><i style={{ background: "var(--td-won)" }} />Won <b>{won}</b></Link>
            <Link href={tenderLinks.outcome("lost")} className={s.legendLink} aria-label={`Lost: ${lost} in the last 12 months`}><i style={{ background: "var(--td-lost)" }} />Lost <b>{lost}</b></Link>
          </div>
          <Columns months={data.months} />
        </>
      ) : <p className={s.quiet}>No tender was decided in the last 12 months.</p>}
    </div>
  );
}
