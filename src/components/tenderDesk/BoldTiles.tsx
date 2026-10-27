import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import InfoTip from "@/components/ui/InfoTip";
import { tenderDesk as td } from "@/lib/theme";
import type { TenderDeskClient, TenderDeskData } from "@/lib/tenderDesk/types";
import { NoOpenTenders, PendingState } from "./deskParts";
import {
  barPercent, buyoutRow, clientsAria, compact, dayChip, dayTone, daysText, deskSentence, donutSegments, millions, monthsAria, monthsHaveData,
  monthsMax, percentOf, plural, stagesAria, tileMoney, winRateLabel,
} from "./format";
import s from "./TenderDesk.module.css";

const boldVars = {
  "--td-tile-ink": td.tile.ink,
  "--td-tile-ink-soft": td.tile.inkSoft,
  "--td-tile-glow": td.tile.glow,
  "--td-g1": td.tile.pipeline,
  "--td-g2": td.tile.weighted,
  "--td-g3": td.tile.closing,
  "--td-g4": td.tile.win,
  "--td-g5": td.tile.buyout,
  "--td-chip-red": td.chip.red,
  "--td-chip-amber": td.chip.amber,
  "--td-chip-green": td.chip.green,
  "--td-chip-slate": td.chip.slate,
  "--td-chip-ink": td.chip.ink,
  "--td-won": td.won,
  "--td-lost": td.lost,
  "--td-under": td.bold.under,
  "--td-over": td.bold.over,
  "--td-buyout-fill": td.bold.buyoutFill,
  "--td-client-0": td.bold.clients[0],
  "--td-client-1": td.bold.clients[1],
  "--td-client-2": td.bold.clients[2],
  "--td-client-3": td.bold.clients[3],
  "--td-client-4": td.bold.clients[4],
  "--td-client-others": td.bold.others,
} as CSSProperties;

const CHIP = { red: s.chipRed, amber: s.chipAmber, green: s.chipGreen } as const;
const PILL = { awarded: s.pillAwarded, "quotes in": s.pillQuotes, waiting: s.pillWaiting } as const;
const PILL_LABEL = { awarded: "Awarded", "quotes in": "Quotes in", waiting: "Waiting" } as const;
const DIFF = { under: s.diffUnder, over: s.diffOver, none: s.diffNone } as const;

const isOthers = (c: TenderDeskClient) => c.accountId === null && c.name === "Others";
const clientColour = (c: TenderDeskClient, i: number) => (isOthers(c) ? "var(--td-client-others)" : `var(--td-client-${i % 5})`);

function Tile({ tone, guide, label, info, value, unit, note }: { tone: string; guide: string; label: string; info?: ReactNode; value: string; unit: string; note: string }) {
  return (
    <div className={`${s.tile} ${tone}`} data-guide={guide}>
      <div className={s.tileLabel}>
        <span>{label}</span>
        {info && <InfoTip label={label}>{info}</InfoTip>}
      </div>
      <div className={s.tileValue}>{value}{unit && <small>{unit}</small>}</div>
      <div className={s.tileNote}>{note}</div>
    </div>
  );
}

const MONTH_W = 30;
const CHART_H = 150;

function MonthsChart({ data }: { data: TenderDeskData }) {
  const { months } = data;
  const max = monthsMax(months);
  const scale = max > 0 ? 118 / max : 0;
  const width = months.length * MONTH_W;
  return (
    <svg className={s.chartBox} viewBox={`0 0 ${width} ${CHART_H + 24}`} role="img" aria-label={monthsAria(months)}>
      <line x1="0" y1={CHART_H} x2={width} y2={CHART_H} style={{ stroke: "var(--line)" }} strokeWidth="1" />
      {months.map((m, i) => {
        const x = i * MONTH_W + MONTH_W / 2;
        const wh = m.won * scale;
        const lh = m.lost * scale;
        return (
          <g key={m.key}>
            {m.won > 0 && <rect x={x - 13} y={CHART_H - wh} width="12" height={wh} rx="3" style={{ fill: "var(--td-won)" }} />}
            {m.lost > 0 && <rect x={x + 1} y={CHART_H - lh} width="12" height={lh} rx="3" style={{ fill: "var(--td-lost)" }} />}
            {m.won > 0 && <text x={x - 7} y={CHART_H - wh - 4} textAnchor="middle" fontSize="10" style={{ fill: "var(--muted)" }}>{m.won}</text>}
            {m.lost > 0 && <text x={x + 7} y={CHART_H - lh - 4} textAnchor="middle" fontSize="10" style={{ fill: "var(--muted)" }}>{m.lost}</text>}
            <text x={x} y={CHART_H + 17} textAnchor="middle" fontSize="11" style={{ fill: "var(--muted)" }}>{m.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function ClientsDonut({ data }: { data: TenderDeskData }) {
  const { clients, currency } = data;
  const total = clients.reduce((sum, c) => sum + c.value, 0);
  const segs = donutSegments(clients.map((c) => c.value));
  const circumference = 2 * Math.PI * 54;
  return (
    <div className={s.donutRow}>
      <svg className={s.donut} viewBox="0 0 140 140" role="img" aria-label={clientsAria(clients, currency)}>
        <g transform="rotate(-90 70 70)" fill="none" strokeWidth="22">
          {segs.map((g, i) => g.dash > 0 && (
            <circle key={i} cx="70" cy="70" r="54" style={{ stroke: clientColour(clients[i], i) }} strokeDasharray={`${g.dash} ${circumference.toFixed(1)}`} strokeDashoffset={g.offset} />
          ))}
        </g>
        <text x="70" y="68" textAnchor="middle" fontSize="19" fontWeight="800" style={{ fill: "var(--ink)" }}>{millions(total)}</text>
        <text x="70" y="85" textAnchor="middle" fontSize="9" style={{ fill: "var(--muted)" }}>{currency} open</text>
      </svg>
      <ul className={s.donutList}>
        {clients.map((c, i) => (
          <li key={`${c.accountId ?? "x"}-${c.name}`}>
            <i style={{ background: clientColour(c, i) }} aria-hidden="true" />
            <span className={s.nm}>{c.name}</span>
            <span className={s.vl}>{millions(c.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function BoldTiles({ data, userName, greeting, dateLabel }: { data: TenderDeskData; userName: string | null; greeting: string; dateLabel: string }) {
  if (data.pending) return <div className={`${s.desk} ${s.bold}`} style={boldVars} data-guide="tender.desk.bold"><PendingState /></div>;

  const { kpis, currency } = data;
  const open = tileMoney(kpis.openValue, currency);
  const weighted = tileMoney(kpis.weightedValue, currency);
  const committed = tileMoney(kpis.buyoutCommitted, currency);
  const weightedShare = percentOf(kpis.weightedValue, kpis.openValue);
  const committedShare = percentOf(kpis.buyoutCommitted, kpis.buyoutBudget);
  const sentence = deskSentence(data);
  const maxStage = data.stages.reduce((m, st) => Math.max(m, st.value), 0);
  const noOpen = kpis.openCount === 0;

  return (
    <div className={`${s.desk} ${s.bold}`} style={boldVars} data-guide="tender.desk.bold">
      <div className={s.hello}>
        {dateLabel && <span className={s.dateLine}>{dateLabel}</span>}
        <h1>{userName ? `${greeting}, ${userName}` : greeting}</h1>
        <p>{sentence.map((r, i) => (r.bold ? <b key={i}>{r.text}</b> : <span key={i}>{r.text}</span>))}</p>
      </div>

      <div className={s.tiles}>
        <Tile tone={s.g1} guide="tender.desk.tile.pipeline" label="Open pipeline" value={open.value} unit={open.unit} note={plural(kpis.openCount, "open tender")} />
        <Tile
          tone={s.g2} guide="tender.desk.tile.weighted" label="Weighted by chance" info="Each open tender's value times its chance of winning, added up."
          value={weighted.value} unit={weighted.unit} note={weightedShare === null ? "No open value yet" : `${weightedShare}% of the open value`}
        />
        <Tile
          tone={s.g3} guide="tender.desk.tile.closing" label="Closing in 14 days" info="Open tenders whose bid end date is today or within the next 14 days."
          value={String(kpis.closingSoonCount)} unit={kpis.closingSoonCount === 1 ? " bid" : " bids"}
          note={kpis.closingSoonCount === 0 ? "Nothing due soon" : `${millions(kpis.closingSoonValue)} ${currency} still to finish`}
        />
        <Tile
          tone={s.g4} guide="tender.desk.tile.win" label="Win rate, 12 months" info="Won out of won plus lost over the last 12 months. Dropped tenders do not count."
          value={winRateLabel(kpis.winRate).replace("%", "")} unit={kpis.winRate === null ? "" : "%"}
          note={kpis.winRate === null ? "Nothing decided yet" : `${kpis.won12} won, ${kpis.lost12} lost`}
        />
        <Tile
          tone={s.g5} guide="tender.desk.tile.buyout" label="Buy-out committed"
          value={committed.value} unit={committed.unit}
          note={committedShare === null ? "No buy-out packages yet" : `${committedShare}% of the package budget`}
        />
      </div>

      {noOpen ? <NoOpenTenders /> : (
        <div className={s.row2}>
          <Card title="Pipeline by stage" info="Open tenders only. The bar is the value in millions, the figure in brackets is the number of tenders." style={{ borderRadius: 18 }}>
            {data.stages.length === 0 ? <p className={s.quiet}>No open stages.</p> : (
              <ul className={s.closeList} aria-label={stagesAria(data.stages, currency)} data-guide="tender.desk.stages">
                {data.stages.map((st) => (
                  <li key={st.stage} className={s.stage}>
                    <span className={s.stageName}>{st.label}</span>
                    <div className={s.track} aria-hidden="true"><div className={`${s.trackFill} ${s.fill}`} style={{ width: `${barPercent(st.value, maxStage)}%`, background: st.color }} /></div>
                    <span className={s.stageNum}><b>{millions(st.value)}</b> ({st.count})</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Bids closing soonest" info="Red is three days or less, amber is ten days or less, green is later. A row opens the tender." style={{ borderRadius: 18 }}>
            {data.closing.length === 0 ? <p className={s.quiet}>No bid is waiting for its end date.</p> : (
              <ul className={s.closeList}>
                {data.closing.map((c) => {
                  const chip = dayChip(c.daysLeft);
                  return (
                    <li key={c.id}>
                      <Link href={c.href} className={s.closeRow} data-guide="tender.desk.closing" aria-label={`${c.title}, closes in ${daysText(c.daysLeft)}`}>
                        <span className={`${s.chip} ${CHIP[dayTone(c.daysLeft)]}`}>{chip.big}<small>{chip.small}</small></span>
                        <span>
                          <span className={s.closeTitle}>{c.title}</span>
                          <span className={s.closeSub} style={{ display: "block" }}>{[c.ref, c.client].filter(Boolean).join(" · ")}</span>
                        </span>
                        <span className={s.closeVal}>{compact(c.value)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      )}

      <div className={s.row2}>
        <Card title="Won and lost by month" style={{ borderRadius: 18 }}>
          {monthsHaveData(data.months) ? (
            <>
              <div className={s.legend}><span><i style={{ background: "var(--td-won)" }} />Won</span><span><i style={{ background: "var(--td-lost)" }} />Lost</span></div>
              <MonthsChart data={data} />
            </>
          ) : <p className={s.quiet}>No tender was decided in the last 12 months.</p>}
        </Card>
        {!noOpen && (
          <Card title="Open value by client" info="The five largest clients by open value, then everything else together." style={{ borderRadius: 18 }}>
            {data.clients.length === 0 ? <p className={s.quiet}>No open value to show.</p> : <ClientsDonut data={data} />}
          </Card>
        )}
      </div>

      {data.buyout && (
        <Card
          title={`Buy-out against budget, ${data.buyout.projectName}`}
          info="The bar is the budget, the marker is the best quote, the filled part is what is awarded."
          action={<Link href={data.buyout.href} className={s.link} data-guide="tender.desk.buyout">Open buy-out</Link>}
          style={{ borderRadius: 18 }}
        >
          {data.buyout.packages.length === 0 ? <p className={s.quiet}>No buy-out packages yet.</p> : (() => {
            const maxBudget = data.buyout.packages.reduce((m, p) => Math.max(m, p.budget), 0);
            return data.buyout.packages.map((p) => {
              const row = buyoutRow(p, maxBudget);
              return (
                <div key={p.name} className={s.pkg}>
                  <span className={s.pkgName}>{p.name}</span>
                  <div className={s.pkgTrack} style={{ width: `${row.trackPct}%` }} aria-hidden="true">
                    <div className={`${s.pkgFill} ${s.fill}`} style={{ width: `${row.committedPct}%` }} />
                    {row.quotePct !== null && <div className={`${s.pkgMarker} ${row.diff.kind === "over" ? s.markerOver : s.markerUnder}`} style={{ left: `${row.quotePct}%` }} />}
                  </div>
                  <span className={s.pkgEnd}>
                    <span className={`${s.pill} ${PILL[p.status]}`}>{PILL_LABEL[p.status]}</span>
                    <span className={DIFF[row.diff.kind]}>{row.diff.text}</span>
                  </span>
                </div>
              );
            });
          })()}
        </Card>
      )}
    </div>
  );
}
