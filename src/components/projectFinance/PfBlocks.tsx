import type { ReactNode } from "react";
import Link from "next/link";
import { ROUTES, type AnalyticsMetricId } from "@/lib/constants";
import { money, pct } from "@/lib/contractProjects/format";
import type { ProjectFinanceAnalytics } from "@/lib/projectFinance/portfolio";
import { PF_TIPS } from "@/lib/projectFinance/tips";
import { LIGHT_WORD, type LightLevel } from "@/lib/projectFinance/types";
import { c } from "@/lib/theme";
import { toneForMargin, toneTokens, type Tone } from "@/lib/ui/tone";
import StatTile from "@/components/ui/StatTile";
import { LightDot, NOT_CONNECTED, NextStep } from "./FinanceBits";
import s from "./projectFinance.module.css";

// The dashboard blocks of the cost and profitability module (features.project_dashboards): four KPI tiles, the portfolio card and the billing
// card, all read from AnalyticsData.projectFinance. They are in no default layout; a workspace adds them in Adapt. They draw with the app's theme
// variables, so the Bold and Control room looks of a tender workspace carry them too. For a person who may not see cost and margin the data is null
// and nothing is drawn.

export const PF_BLOCK_IDS: ReadonlySet<string> = new Set(["pf_margin_at_risk", "pf_forecast_margin", "pf_cost_to_complete", "pf_billing_behind", "pf_portfolio", "pf_cash"]);
export const isPfBlockId = (id: string): boolean => PF_BLOCK_IDS.has(id);

export type PfBlockSpec = { title: string; href?: string; info?: string; body: ReactNode };

const unavailable = (text: string) => <p className={s.quiet} role="status" data-guide="pf.dash.unavailable">{text}</p>;

function cur(d: { rows: { currency: string | null }[] }, summaryCurrency: string | "" | null): string | null {
  return summaryCurrency === "" ? null : summaryCurrency ?? d.rows[0]?.currency ?? null;
}

export function pfBlockSpec(id: AnalyticsMetricId, data: ProjectFinanceAnalytics): PfBlockSpec | null {
  if (!isPfBlockId(id) || data === null) return null;
  if (data.status === "pending") return { title: "Projects", body: unavailable("Project data is not set up yet. Ask your administrator to finish setting up Contract projects.") };
  const { summary: sm } = data;
  const currency = cur(data, sm.currency);
  const mixed = sm.currency === "";
  const sub = (figure: { of: number; total: number }) => (mixed ? "Projects use more than one currency" : figure.of === 0 ? <NextStep isAdmin={data.isAdmin} /> : `${figure.of} of ${figure.total} project${figure.total === 1 ? "" : "s"}`);

  switch (id) {
    case "pf_margin_at_risk": return {
      title: "Margin at risk", href: ROUTES.contractProjects, info: PF_TIPS.marginAtRisk,
      body: <StatTile label="Margin at risk" tone={sm.marginAtRisk.value !== null && sm.marginAtRisk.value > 0 ? "bad" : "neutral"} value={sm.marginAtRisk.value === null ? NOT_CONNECTED : money(sm.marginAtRisk.value, currency)} sub={sub(sm.marginAtRisk)} />,
    };
    case "pf_forecast_margin": return {
      title: "Forecast margin", href: ROUTES.contractProjects, info: PF_TIPS.forecastMargin,
      body: <StatTile label="Forecast margin" tone={toneForMargin(sm.forecastMargin.value, data.floor ?? 10)} value={sm.forecastMargin.value === null ? NOT_CONNECTED : pct(sm.forecastMargin.value)}
        sub={sm.forecastMargin.value === null ? (sm.forecastMargin.plannedPct !== null ? `Planned margin ${pct(sm.forecastMargin.plannedPct)}` : sub(sm.forecastMargin)) : `${sub(sm.forecastMargin)}${sm.forecastMargin.plannedPct !== null ? ` · plan ${pct(sm.forecastMargin.plannedPct)}` : ""}`} />,
    };
    case "pf_cost_to_complete": return {
      title: "Cost to complete", href: ROUTES.contractProjects, info: PF_TIPS.costToComplete,
      body: <StatTile label="Cost to complete" value={sm.costToComplete.value === null ? NOT_CONNECTED : money(sm.costToComplete.value, currency)} sub={sub(sm.costToComplete)} />,
    };
    case "pf_billing_behind": return {
      title: "Behind on billing", href: ROUTES.contractProjects, info: PF_TIPS.behindBilling,
      body: <StatTile label="Behind on billing" tone={sm.billingBehind.value !== null && sm.billingBehind.value > 0 ? "warn" : "neutral"} value={sm.billingBehind.value === null ? NOT_CONNECTED : money(sm.billingBehind.value, currency)}
        sub={sm.billingBehind.value === null ? <NextStep isAdmin={data.isAdmin} text="Turn on Invoices or connect the ERP billing read-back" plain="Needs Invoices or the ERP billing read-back" /> : `${sm.billingBehind.count} milestone${sm.billingBehind.count === 1 ? "" : "s"} · ${sub(sm.billingBehind)}`} />,
    };
    case "pf_portfolio": return { title: "Project health", href: ROUTES.contractProjects, info: PF_TIPS.portfolio, body: <Portfolio data={data} currency={currency} /> };
    case "pf_cash": return { title: "Billing plan and cash", href: ROUTES.contractProjects, info: PF_TIPS.cash, body: <Cash data={data} currency={currency} /> };
    default: return null;
  }
}

type Dash = Extract<NonNullable<ProjectFinanceAnalytics>, { status: "ok" }>;

const GROUPS: { key: string; word: string; levels: LightLevel[]; tone: Tone | null }[] = [
  { key: "good", word: LIGHT_WORD.good, levels: ["good"], tone: "good" },
  { key: "watch", word: LIGHT_WORD.watch, levels: ["watch"], tone: "warn" },
  { key: "risk", word: LIGHT_WORD.risk, levels: ["risk"], tone: "bad" },
  { key: "plan", word: LIGHT_WORD.plan_watch, levels: ["plan_watch", "plan_risk"], tone: null },
  { key: "none", word: LIGHT_WORD.not_connected, levels: ["not_connected"], tone: null },
];

function Portfolio({ data, currency }: { data: Dash; currency: string | null }) {
  const { summary: sm } = data;
  if (sm.counted === 0) {
    return unavailable(sm.noBaseline > 0 ? `${sm.noBaseline} active project${sm.noBaseline === 1 ? " has" : "s have"} no approved budget yet, so there is nothing to show.` : "No active contract projects yet.");
  }
  const counts = GROUPS.map((g) => ({ ...g, n: g.levels.reduce((t, l) => t + sm.marginLevels[l], 0) }));
  const total = counts.reduce((t, g) => t + g.n, 0) || 1;
  const colorOf = (g: (typeof GROUPS)[number]) => (g.tone ? toneTokens(g.tone).edge : g.key === "plan" ? toneTokens("bad").edge : c.line);
  let offset = 0;
  const worst = sm.worst;
  const maxRisk = Math.max(1, ...worst.rows.map((r) => r.atRisk ?? 0));
  return (
    <div className={s.stack} data-guide="pf.portfolio">
      <div className={s.donutWrap}>
        <svg width="112" height="112" viewBox="0 0 112 112" role="img" aria-label={`Margin light of ${sm.counted} projects: ${counts.filter((g) => g.n > 0).map((g) => `${g.n} ${g.word.toLowerCase()}`).join(", ")}`}>
          <circle cx="56" cy="56" r="44" fill="none" stroke={c.line} strokeWidth="14" />
          {counts.filter((g) => g.n > 0).map((g) => {
            const len = (g.n / total) * 100;
            const el = <circle key={g.key} cx="56" cy="56" r="44" fill="none" stroke={colorOf(g)} strokeWidth="14" pathLength={100} strokeDasharray={`${len} ${100 - len}`} strokeDashoffset={-offset} transform="rotate(-90 56 56)" opacity={g.key === "plan" ? 0.55 : 1} />;
            offset += len;
            return el;
          })}
          <text x="56" y="61" textAnchor="middle" fontSize="20" fontWeight="700" fill={c.ink}>{sm.counted}</text>
        </svg>
        <ul className={s.legend} style={{ flexDirection: "column", gap: 2 }}>
          {counts.filter((g) => g.n > 0).map((g) => (
            <li key={g.key} style={{ minHeight: 28 }}>
              <LightDot level={g.levels[0]} />
              <span>{g.word}</span><b className={s.mono}>{g.n}</b>
            </li>
          ))}
        </ul>
      </div>
      <p className={s.quiet}>{projects(sm.counted)}{sm.noBaseline > 0 ? ` · ${sm.noBaseline} without an approved budget are left out` : ""}</p>
      {worst.rows.length > 0 && (
        <>
          <div className={s.figLabel}>{worst.basis === "forecast" ? "Needing the most attention" : "Lowest planned margin"}</div>
          <ul className={s.worst}>
            {worst.rows.map((r) => (
              <li key={r.id}>
                <Link href={`${ROUTES.contractProject(r.id)}?tab=forecast`} className={s.worstRow}>
                  <span style={{ minWidth: 0, overflowWrap: "anywhere", fontSize: 13, color: c.ink }}>{r.ref ? `${r.ref} ` : ""}{r.name}</span>
                  {worst.basis === "forecast" ? (
                    <span className={s.trackBar} aria-hidden="true"><span className={s.trackFill} style={{ display: "block", width: `${((r.atRisk ?? 0) / maxRisk) * 100}%`, background: toneTokens("bad").edge }} /></span>
                  ) : <span />}
                  <b className={s.mono} style={{ fontSize: 13, color: c.ink }}>{worst.basis === "forecast" ? money(r.atRisk, r.currency ?? currency) : pct(r.plannedPct)}</b>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {worst.basis === "plan" && <p className={s.quiet}><NextStep isAdmin={data.isAdmin} /></p>}
    </div>
  );
}

const projects = (n: number) => `${n} active project${n === 1 ? "" : "s"}`;

function Cash({ data, currency }: { data: Dash; currency: string | null }) {
  const { cash, counted, currency: cc } = data.summary;
  if (counted === 0) return unavailable("No active contract projects with an approved budget yet.");
  if (cc === "") return unavailable("Projects use more than one currency, so a total would mean nothing.");
  const scale = Math.max(cash.scheduled ?? 0, cash.invoiced ?? 0, 1);
  const bar = (label: string, value: number | null, tone: Tone, note?: string) => (
    <div key={label} style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
        <span style={{ color: c.ink }}>{label}</span>
        <b className={s.mono} style={{ color: value === null ? c.hint : c.ink }}>{value === null ? NOT_CONNECTED : money(value, currency)}</b>
      </div>
      <div className={s.trackBar} aria-hidden="true"><div className={s.trackFill} style={{ width: value === null ? "0%" : `${(value / scale) * 100}%`, background: toneTokens(tone).edge }} /></div>
      {note && <span className={s.quiet}>{note}</span>}
    </div>
  );
  return (
    <div className={s.stack} data-guide="pf.cash">
      {bar("Planned to bill", cash.scheduled, "info")}
      {bar("Due by today", cash.scheduledToDate, "info")}
      {bar("Invoiced", cash.invoiced, "good", cash.invoiced === null ? undefined : `${cash.ofInvoiced} of ${counted} projects`)}
      {bar("Received", cash.received, "good")}
      {(cash.invoiced === null || cash.received === null) && <p className={s.quiet}><NextStep isAdmin={data.isAdmin} text="Turn on Invoices or connect the ERP billing read-back" plain="Needs Invoices or the ERP billing read-back" /></p>}
    </div>
  );
}
