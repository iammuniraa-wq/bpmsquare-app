"use client";

import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { csvCell } from "@/lib/import/template";
import { money, pct } from "@/lib/contractProjects/format";
import { portfolioBridge, type PortfolioRow, type ProjectFinanceAnalytics } from "@/lib/projectFinance/portfolio";
import { PF_TIPS } from "@/lib/projectFinance/tips";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import { CARD_SURFACE } from "@/components/ui/Card";
import { LightDot } from "./FinanceBits";
import s from "./projectFinance.module.css";

const NC = "Not connected";
type Dash = Extract<NonNullable<ProjectFinanceAnalytics>, { status: "ok" }>;

const BRIDGE_LABEL: Record<string, string> = {
  baseline: "Baseline margin", variation_revenue: "Client changes (revenue)", variation_cost: "Client changes (cost)", other_revisions: "Other budget changes",
  buyout_saving: "Buy-out saving", after_buyout: "After buy-out", execution: "Execution", forecast: "Forecast margin",
};

const COLUMNS: { head: string; text: (r: PortfolioRow) => string; csv?: (r: PortfolioRow) => string }[] = [
  { head: "Project", text: (r) => `${r.ref ? `${r.ref} ` : ""}${r.name}` },
  { head: "Status", text: (r) => r.status },
  { head: "Contract value", text: (r) => money(r.contractValue, r.currency), csv: (r) => String(r.contractValue) },
  { head: "Budget", text: (r) => (r.budget === null ? "Baseline not approved" : money(r.budget, r.currency)), csv: (r) => (r.budget === null ? "" : String(r.budget)) },
  { head: "Baseline margin", text: (r) => pct(r.baselinePct), csv: (r) => (r.baselinePct === null ? "" : String(r.baselinePct)) },
  { head: "Planned margin", text: (r) => (r.plannedPct === null ? "Not complete" : `${pct(r.plannedPct)}${r.plannedComplete ? "" : " (partial)"}`), csv: (r) => (r.plannedPct === null ? "" : String(r.plannedPct)) },
  { head: "Awarded in Buy-out", text: (r) => money(r.awarded, r.currency), csv: (r) => String(r.awarded) },
  { head: "Buy-out saving", text: (r) => money(r.buyoutSaving, r.currency), csv: (r) => String(r.buyoutSaving) },
  { head: "Forecast cost", text: (r) => (r.eac === null ? NC : money(r.eac, r.currency)), csv: (r) => (r.eac === null ? "" : String(r.eac)) },
  { head: "Forecast margin", text: (r) => (r.forecastPct === null ? NC : pct(r.forecastPct)), csv: (r) => (r.forecastPct === null ? "" : String(r.forecastPct)) },
  { head: "Margin at risk", text: (r) => (r.atRisk === null ? NC : money(r.atRisk, r.currency)), csv: (r) => (r.atRisk === null ? "" : String(r.atRisk)) },
  { head: "Cost to complete", text: (r) => (r.costToComplete === null ? NC : money(r.costToComplete, r.currency)), csv: (r) => (r.costToComplete === null ? "" : String(r.costToComplete)) },
  { head: "Scheduled to date", text: (r) => money(r.scheduledToDate, r.currency), csv: (r) => String(r.scheduledToDate) },
  { head: "Behind on billing", text: (r) => (r.behindAmount === null ? NC : money(r.behindAmount, r.currency)), csv: (r) => (r.behindAmount === null ? "" : String(r.behindAmount)) },
  { head: "Margin light", text: (r) => r.lights.margin.word },
  { head: "Cash light", text: (r) => r.lights.cash.word },
  { head: "Delivery light", text: (r) => r.lights.delivery.word },
];

/**
 * Reports > Project profitability: one row per project the caller may see, every column of the design, with a CSV. Cells that need the ERP say
 * "Not connected" (empty in the CSV), never 0. Below it, the portfolio margin bridge with the same rule.
 */
export default function ProjectProfitability({ data }: { data: Dash }) {
  const rows = data.rows;
  const bridge = portfolioBridge(rows);

  function download() {
    const head = COLUMNS.map((col) => csvCell(col.head)).join(",");
    const body = rows.map((r) => COLUMNS.map((col) => csvCell((col.csv ?? col.text)(r))).join(","));
    const blob = new Blob([`${head}\n${body.join("\n")}`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url; el.download = "project-profitability.csv"; el.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section style={{ ...CARD_SURFACE, padding: 16, marginBottom: 14, minWidth: 0 }} data-guide="pf.report">
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <b style={{ fontSize: 14, color: c.ink }}>Project profitability</b>
        <InfoTip label="Project profitability">{PF_TIPS.portfolio}</InfoTip>
        <span style={{ marginLeft: "auto" }}><Button size="sm" variant="secondary" onClick={download} data-guide="pf.report.csv" style={{ minHeight: 44 }}>Download CSV</Button></span>
      </div>
      {rows.length === 0 ? (
        <p className={s.quiet}>No contract projects to show.</p>
      ) : (
        <div className={s.tableWrap} tabIndex={0} aria-label="Project profitability table">
          <table className={s.table}>
            <thead><tr>{COLUMNS.map((col) => <th key={col.head} scope="col">{col.head}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  {COLUMNS.map((col, i) => (
                    <td key={col.head} style={col.text(r) === NC ? { color: c.hint } : undefined}>
                      {i === 0 ? <Link href={`${ROUTES.contractProject(r.id)}?tab=forecast`} style={{ color: c.ink, fontWeight: 600 }}>{col.text(r)}</Link>
                        : col.head.endsWith("light") ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><LightDot level={(r.lights[col.head.startsWith("Margin") ? "margin" : col.head.startsWith("Cash") ? "cash" : "delivery"]).level} />{col.text(r)}</span>
                        : col.text(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 13, color: c.ink }}>Margin bridge, all active projects <InfoTip label="Margin bridge">{PF_TIPS.bridge}</InfoTip></div>
        {bridge === null ? <p className={s.quiet}>Needs active projects with an approved budget, in one currency.</p> : (
          <ul className={s.bridgeRows} style={{ display: "block" }}>
            {bridge.map((b) => (
              <li key={b.id}><span>{BRIDGE_LABEL[b.id]}</span><b className={s.mono} style={{ color: b.amount === null ? c.hint : c.ink }}>{b.amount === null ? "Needs ERP cost" : money(b.amount, rows[0]?.currency)}</b></li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
