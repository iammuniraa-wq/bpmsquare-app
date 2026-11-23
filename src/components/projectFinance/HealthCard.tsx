import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { money, pct } from "@/lib/contractProjects/format";
import { toneForMargin } from "@/lib/ui/tone";
import { PF_TIPS } from "@/lib/projectFinance/tips";
import { stateNote } from "@/lib/projectFinance/state";
import type { ProjectFinance } from "@/lib/projectFinance/model";
import SettingsSection from "@/components/settings/SettingsSection";
import StatTile from "@/components/ui/StatTile";
import { LightChip, NOT_CONNECTED, NextStep } from "./FinanceBits";
import s from "./projectFinance.module.css";

/**
 * The Health card on a project's Overview (design section 7): three lights with their words, four numbers, "as of", and one link to the
 * Forecast tab. No chart here. It is a section that remembers whether the person opened it. Every figure that needs the ERP says "Not
 * connected" and the one next step sits once at the foot, not under each tile.
 */
export default function HealthCard({ finance: f, isAdmin, floor, forecastTab }: { finance: ProjectFinance; isAdmin: boolean; floor: number | null; forecastTab: boolean }) {
  const cur = f.currency;
  const costOn = f.costConnected;
  const forecastPct = f.forecast?.pct ?? null;
  const behind = f.billing.behind;
  const lights = [f.lights.margin, f.lights.cash, f.lights.delivery];
  const needsErp = !costOn || f.lights.delivery.level === "not_connected";
  const summary = lights.map((l) => `${l.id === "margin" ? "Margin" : l.id === "cash" ? "Cash" : "Delivery"} ${l.word.toLowerCase()}`).join(" · ");
  const asOf = costOn ? stateNote(f.costState, f.costAsOf) : null;

  return (
    <SettingsSection id="pf.health" title="Health" info={PF_TIPS.health} defaultOpen summary={summary}>
      <div className={s.stack} data-guide="pf.health">
        {!f.baselineApproved ? (
          <p className={s.quiet} role="status">Baseline not approved. The lights and figures start once the first budget is approved.</p>
        ) : (
          <>
            <div className={s.row} data-guide="pf.lights">{lights.map((l) => <LightChip key={l.id} light={l} />)}</div>
            <div className={s.figures}>
              <StatTile
                label="Forecast margin" info={PF_TIPS.forecastMargin} tone={toneForMargin(forecastPct, floor ?? 10)}
                value={forecastPct === null ? NOT_CONNECTED : pct(forecastPct)}
                sub={forecastPct === null ? (f.planned?.pct != null ? `Plan ${pct(f.planned.pct)}${f.planned.complete ? "" : ", not complete"}` : null) : f.planned?.pct != null ? `Plan ${pct(f.planned.pct)}` : null}
              />
              <StatTile label="Cost to complete" info={PF_TIPS.costToComplete} value={f.cost.costToComplete === null ? NOT_CONNECTED : money(f.cost.costToComplete, cur)} sub={f.cost.estimatePct !== null ? `${pct(f.cost.estimatePct)} of the forecast is an estimate` : null} />
              <StatTile
                label="Behind on billing" info={PF_TIPS.behindBilling} tone={behind && behind.count > 0 ? "warn" : "neutral"}
                value={behind === null ? NOT_CONNECTED : money(behind.amount, cur)}
                sub={behind === null ? null : behind.count === 0 ? "Nothing behind" : `${behind.count} milestone${behind.count === 1 ? "" : "s"}, oldest ${behind.oldestDays} days`}
              />
              <StatTile label="Late" info={PF_TIPS.deliveryLight} value={NOT_CONNECTED} sub="Delivery needs the ERP" />
            </div>
            <div className={s.row}>
              {asOf && <span className={s.quiet}>{asOf}</span>}
              {needsErp && <span className={s.quiet} data-guide="pf.next_step"><NextStep isAdmin={isAdmin} /></span>}
              {forecastTab && <Link href={`${ROUTES.contractProject(f.id)}?tab=forecast`} className={s.nextLink} data-guide="pf.open_forecast" style={{ marginLeft: "auto" }}>Open forecast</Link>}
            </div>
          </>
        )}
      </div>
    </SettingsSection>
  );
}
