import type { CSSProperties } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import { tenderDesk as td } from "@/lib/theme";
import type { TenderDeskAttention, TenderDeskData } from "@/lib/tenderDesk/types";
import { NoOpenTenders, PendingState } from "./deskParts";
import {
  assignLanes, barPercent, clientsAria, compact, daysText, dayTone, millions, percentOf, plural, ringDash, stagesAria, tileMoney, timelinePosition, trendAria,
  trendDeltaText, trendGeometry, winRateLabel,
} from "./format";
import s from "./TenderDesk.module.css";

const c = td.control;

// The Control room is dark in every app theme. It re-states the app's own neutral variables inside its box, so the shared primitives
// (Card, EmptyState, the InfoTip button) draw dark here without knowing about it.
const controlVars = {
  "--tc-bg": c.bg,
  "--tc-base": c.base,
  "--tc-row": c.row,
  "--tc-border": c.border,
  "--tc-ink": c.ink,
  "--tc-strong": c.strong,
  "--tc-muted": c.muted,
  "--tc-dim": c.dim,
  "--tc-track": c.track,
  "--tc-axis": c.axis,
  "--tc-violet": c.violet,
  "--tc-violet-soft": c.violetSoft,
  "--tc-teal": c.teal,
  "--tc-amber": c.amber,
  "--tc-rose": c.rose,
  "--tc-button-ink": c.buttonInk,
  "--ink": c.ink,
  "--muted": c.muted,
  "--hint": c.dim,
  "--line": c.border,
  "--panel": c.base,
  "--panel2": c.track,
  "--card-bg": c.panel,
  "--card-radius": "18px",
  "--card-shadow": "none",
} as CSSProperties;

const CLIENT_COLOURS = [c.violet, c.teal, c.amber, c.rose, c.blue];
const DOT = { red: s.dotRed, amber: s.dotAmber, green: s.dotTeal } as const;
const SEVERITY = { high: s.sevHigh, medium: s.sevMedium, low: s.sevLow } as const;
const SEVERITY_WORD = { high: "Urgent", medium: "Soon", low: "When you can" } as const;

function Ring({ fraction, colour, value, label, aria }: { fraction: number | null; colour: string; value: string; label: string; aria: string }) {
  const { dash, circumference } = ringDash(fraction);
  return (
    <div className={s.ringItem}>
      <svg viewBox="0 0 100 100" role="img" aria-label={aria}>
        <g transform="rotate(-90 50 50)" fill="none" strokeWidth="10" strokeLinecap="round">
          <circle cx="50" cy="50" r="36" style={{ stroke: "var(--tc-track)" }} />
          {dash > 0 && <circle cx="50" cy="50" r="36" style={{ stroke: colour }} strokeDasharray={`${dash} ${circumference}`} />}
        </g>
      </svg>
      <b className={s.mono}>{value}</b>
      {label}
    </div>
  );
}

function Attention({ item }: { item: TenderDeskAttention }) {
  return (
    <li className={s.at}>
      <div className={`${s.atBar} ${SEVERITY[item.severity]}`} aria-hidden="true" />
      <div>
        <div className={s.atTitle}><span className={s.srOnly}>{SEVERITY_WORD[item.severity]}: </span>{item.title}</div>
        <div className={s.atSub}>{item.sub}</div>
      </div>
      <Link href={item.href} className={s.btn} data-guide="tender.desk.attention" aria-label={`${item.action}: ${item.title}`}>{item.action}</Link>
    </li>
  );
}

export default function ControlRoom({ data, dateLabel }: { data: TenderDeskData; dateLabel?: string }) {
  const { kpis, currency } = data;
  const subLine = [
    dateLabel,
    data.pending ? null : kpis.closingSoonCount > 0 ? `${plural(kpis.closingSoonCount, "bid")} ${kpis.closingSoonCount === 1 ? "closes" : "close"} within 14 days` : null,
  ].filter(Boolean).join(" · ");

  const header = (
    <div>
      <h1>Tender control room</h1>
      {subLine && <p className={s.ctlSub}>{subLine}</p>}
    </div>
  );

  if (data.pending) {
    return <div className={`${s.desk} ${s.ctl}`} style={controlVars} data-guide="tender.desk.control">{header}<PendingState /></div>;
  }

  const open = tileMoney(kpis.openValue, currency);
  const trend = trendGeometry(data.trend);
  const noOpen = kpis.openCount === 0;
  const stageTotal = data.stages.reduce((sum, st) => sum + st.value, 0);
  const weightedFraction = kpis.openValue > 0 ? kpis.weightedValue / kpis.openValue : null;
  const committedPct = percentOf(kpis.buyoutCommitted, kpis.buyoutBudget);
  const maxClient = data.clients.reduce((m, cl) => Math.max(m, cl.value), 0);
  const within = data.closing.filter((x) => x.daysLeft <= 28);
  const later = data.closing.length - within.length;
  const positions = within.map((d) => timelinePosition(d.daysLeft));
  const lanes = assignLanes(positions);
  const second = lanes.some((l) => l >= 2);
  const axisY = second ? 129 : 79;
  const timelineHeight = (lanes.includes(3) ? axisY + 19 + 50 + 49 : axisY + 79);
  // Row tops relative to the axis: nearest above, nearest below, second above, second below.
  const LANE_OFFSET = [-75, 19, -125, 69];

  return (
    <div className={`${s.desk} ${s.ctl}`} style={controlVars} data-guide="tender.desk.control">
      {header}

      <div className={s.grid}>
        <div className={s.hero}>
          <Card title="Open pipeline, last 12 weeks" info="Open value rebuilt week by week from each tender's created and closed dates. Later edits to an amount are not replayed." padding={20} style={{ height: "100%" }}>
            <div className={s.heroTop}>
              <div className={`${s.big} ${s.mono}`}>{open.value}<small>{open.unit}</small></div>
              {trend && <span className={`${s.delta} ${s.mono} ${trend.delta < 0 ? s.deltaDown : ""}`}>{trendDeltaText(trend.delta, trend.from)}</span>}
            </div>
            {trend ? (
              <div className={s.trend}>
                <svg viewBox="0 0 520 120" preserveAspectRatio="none" role="img" aria-label={trendAria(data.trend, currency)}>
                  <defs>
                    <linearGradient id="tdTrendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" style={{ stopColor: "var(--tc-violet)", stopOpacity: 0.5 }} />
                      <stop offset="1" style={{ stopColor: "var(--tc-violet)", stopOpacity: 0 }} />
                    </linearGradient>
                  </defs>
                  <path d={trend.area} fill="url(#tdTrendFill)" />
                  <path d={trend.line} fill="none" style={{ stroke: "var(--tc-violet-soft)" }} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                </svg>
                <span className={s.trendDot} style={{ left: `${trend.lastXPct}%`, top: `${trend.lastYPct}%` }} aria-hidden="true" />
              </div>
            ) : <p className={s.ctlQuiet}>Not enough history yet to draw the trend.</p>}
          </Card>
        </div>

        <div className={s.ringBox}>
          <Card title="Health" info="Win rate over 12 months, the weighted share of the open pipeline, and how much of the buy-out budget is awarded." padding={20} style={{ height: "100%" }}>
            <div className={s.rings}>
              <Ring
                fraction={kpis.winRate} colour="var(--tc-teal)" value={winRateLabel(kpis.winRate)} label="Win rate, 12 months"
                aria={kpis.winRate === null ? "Win rate, 12 months: nothing decided yet" : `Win rate, 12 months: ${winRateLabel(kpis.winRate)}, ${kpis.won12} won and ${kpis.lost12} lost`}
              />
              <Ring
                fraction={weightedFraction} colour="var(--tc-violet)" value={millions(kpis.weightedValue)} label="Weighted by chance"
                aria={`Weighted by chance: ${millions(kpis.weightedValue)} of ${millions(kpis.openValue)} open`}
              />
              <Ring
                fraction={committedPct === null ? null : committedPct / 100} colour="var(--tc-amber)" value={committedPct === null ? "—" : `${committedPct}%`} label="Buy-out committed"
                aria={committedPct === null ? "Buy-out committed: no packages yet" : `Buy-out committed: ${committedPct}% of the package budget`}
              />
            </div>
          </Card>
        </div>

        {noOpen ? (
          <div className={s.wide}><NoOpenTenders /></div>
        ) : (
          <>
            <div className={s.wide}>
              <Card title="Pipeline by stage" info="Open tenders only. Each segment is a stage, sized by its share of the open value." padding={20}>
                {data.stages.length === 0 || stageTotal <= 0 ? <p className={s.ctlQuiet}>No open stages.</p> : (
                  <>
                    <div className={s.seg2} role="img" aria-label={stagesAria(data.stages, currency)} data-guide="tender.desk.stages">
                      {data.stages.filter((st) => st.value > 0).map((st) => (
                        <div key={st.stage} style={{ width: `${(st.value / stageTotal) * 100}%`, background: st.color }} />
                      ))}
                    </div>
                    <ul className={s.lgd}>
                      {data.stages.map((st) => (
                        <li key={st.stage} className={s.lg} style={{ "--c": st.color } as CSSProperties}>
                          {st.label}
                          <b className={s.mono}>{millions(st.value)}</b>
                          {plural(st.count, "tender")}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </Card>
            </div>

            <div className={s.wide}>
              <Card title="Bid deadlines, next 28 days" info="Each marker is a bid end date. Red is three days or less, amber is ten days or less, teal is later." padding={20}>
                {within.length === 0 ? <p className={s.ctlQuiet}>No bid ends in the next 28 days.</p> : (
                  <>
                    <div className={s.tlWrap} data-guide="tender.desk.deadlines">
                      <div className={s.tlAxis} aria-hidden="true" />
                      <ol className={s.tl} style={{ "--a": `${axisY}px`, "--h": `${timelineHeight}px` } as CSSProperties}>
                        {within.map((d, i) => {
                          const pos = positions[i];
                          const align = pos.align === "start" ? s.alignStart : pos.align === "end" ? s.alignEnd : "";
                          return (
                            <li key={d.id} className={s.mk} style={{ "--x": `${pos.pct}%` } as CSSProperties}>
                              <span className={`${s.mkDot} ${DOT[dayTone(d.daysLeft)]}`} aria-hidden="true" />
                              <Link href={d.href} className={`${s.mkLabel} ${align}`} style={{ top: `calc(var(--a) + ${LANE_OFFSET[lanes[i]]}px)` }} data-guide="tender.desk.closing" title={d.title}>
                                <b className={s.mono}>{[d.ref, daysText(d.daysLeft)].filter(Boolean).join(" · ")}</b>
                                <span>{d.title} · {compact(d.value)}</span>
                              </Link>
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                    <div className={`${s.tlTicks} ${s.mono}`} aria-hidden="true"><span>today</span><span>+7 days</span><span>+14 days</span><span>+21 days</span><span>+28 days</span></div>
                  </>
                )}
                {later > 0 && <p className={s.later}>{later} more {later === 1 ? "bid ends" : "bids end"} after 28 days.</p>}
              </Card>
            </div>
          </>
        )}

        <div className={s.half}>
          <Card title="Needs you today" info="Things only a person can move, most urgent first. Each button opens the record." padding={20} style={{ height: "100%" }}>
            {data.attention.length === 0 ? <p className={s.ctlQuiet}>Nothing needs you today.</p> : (
              <ul className={s.todoList}>
                {data.attention.map((a, i) => <Attention key={`${a.kind}-${i}`} item={a} />)}
              </ul>
            )}
          </Card>
        </div>

        {!noOpen && (
          <div className={s.half}>
            <Card title="Open value by client" info="The five largest clients by open value, then everything else together." padding={20} style={{ height: "100%" }}>
              {data.clients.length === 0 ? <p className={s.ctlQuiet}>No open value to show.</p> : (
                <ul className={s.clientList} aria-label={clientsAria(data.clients, currency)}>
                  {data.clients.map((cl, i) => {
                    const colour = cl.accountId === null && cl.name === "Others" ? c.others : CLIENT_COLOURS[i % CLIENT_COLOURS.length];
                    return (
                      <li key={`${cl.accountId ?? "x"}-${cl.name}`} className={s.cl}>
                        <div className={s.clName}>
                          {cl.name}
                          <div className={s.clTrack} aria-hidden="true"><div className={`${s.clFill} ${s.fill}`} style={{ width: `${barPercent(cl.value, maxClient)}%`, background: colour }} /></div>
                        </div>
                        <span className={`${s.clVal} ${s.mono}`}>{millions(cl.value)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
