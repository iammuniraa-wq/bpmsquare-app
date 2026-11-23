import { money, pct } from "@/lib/contractProjects/format";
import type { ProjectRow } from "@/lib/contractProjects/types";
import type { ProjectCtx } from "@/lib/contractProjects/server";
import { getTenant } from "@/lib/tenant";
import { resolveFinanceAccess, getProjectFinance } from "@/lib/projectFinance/server";
import { PF_TIPS } from "@/lib/projectFinance/tips";
import { toneForMargin } from "@/lib/ui/tone";
import Card from "@/components/ui/Card";
import SettingsSection from "@/components/settings/SettingsSection";
import StatTile from "@/components/ui/StatTile";
import CostBar from "./CostBar";
import ForecastPanel from "./ForecastPanel";
import MarginBridge from "./MarginBridge";
import { NOT_CONNECTED, NextStep } from "./FinanceBits";
import s from "./projectFinance.module.css";

/**
 * The Forecast tab: the cost bar, the cost by category with the typed estimate to go, and the margin bridge. A server component that loads
 * its own data, and only when its tab is the open one. For a caller who may not see cost and margin it renders nothing at all: the loader
 * returns null, so no figure is read, let alone sent.
 */
export default async function ForecastSection({ req, project }: { req: ProjectCtx; project: ProjectRow }) {
  const tenant = await getTenant();
  const access = await resolveFinanceAccess({ supabase: req.supabase, tenantId: req.tenantId, userId: req.userId, role: req.role, features: tenant?.features, config: tenant?.config });
  const detail = await getProjectFinance({ admin: req.admin, tenantId: req.tenantId, userId: req.userId, access, features: tenant?.features, project });
  if (!detail) return <p className={s.quiet} role="status">You do not have access to this project&apos;s cost and margin.</p>;
  const { finance: f, labels } = detail;
  const cur = f.currency;
  const isAdmin = req.role === "admin";
  const floor = access.settings.marginFloor;
  const connected = f.costConnected;
  const canEdit = req.canEdit && project.status !== "closed";

  if (!f.baselineApproved) return <p className={s.quiet} role="status" data-guide="pf.no_baseline">Baseline not approved. The forecast starts once the first budget is approved.</p>;

  return (
    <div className={s.stack} data-guide="pf.forecast">
      <div className={s.figures}>
        <StatTile label="Contract value" value={money(f.contractValue, cur)} sub={f.pendingVariations.count > 0 ? `${money(f.pendingVariations.amount, cur)} waiting for approval` : null} info={PF_TIPS.pending} />
        <StatTile label="Baseline margin" info={PF_TIPS.baselineMargin} value={f.baseline?.pct == null ? NOT_CONNECTED : pct(f.baseline.pct)} sub={f.baseline ? money(f.baseline.amount, cur) : null} />
        <StatTile
          label="Planned margin" info={PF_TIPS.plannedMargin} tone={toneForMargin(f.planned?.pct ?? null, floor ?? 10)}
          value={f.planned === null ? "Not complete" : pct(f.planned.pct)} sub={f.planned === null ? (f.coverage ? `${f.coverage.allocated} of ${f.coverage.of} lines costed` : null) : f.planned.complete ? money(f.planned.amount, cur) : `on ${f.planned.allocated} of ${f.planned.of} lines, not complete`}
        />
        <StatTile label="Awarded in Buy-out" info={PF_TIPS.awarded} value={money(f.buyout.awarded, cur)} sub={f.buyout.packages > 0 ? `Saving ${money(f.buyout.saving, cur)} on ${f.buyout.packages} package${f.buyout.packages === 1 ? "" : "s"}` : "No package awarded yet"} />
      </div>
      <div className={s.figures}>
        <StatTile label="Approved budget" value={money(f.budget, cur)} />
        <StatTile label="Forecast cost" info={PF_TIPS.forecastCost} value={f.cost.eac === null ? NOT_CONNECTED : money(f.cost.eac, cur)} sub={f.cost.eac === null ? null : f.variance ? `${f.variance.amount >= 0 ? "Under" : "Over"} budget by ${money(Math.abs(f.variance.amount), cur)}` : null} />
        <StatTile label="Cost to complete" info={PF_TIPS.costToComplete} value={f.cost.costToComplete === null ? NOT_CONNECTED : money(f.cost.costToComplete, cur)} sub={f.cost.estimatePct !== null ? `${pct(f.cost.estimatePct)} is an estimate` : null} />
        <StatTile label="Margin at risk" info={PF_TIPS.marginAtRisk} tone={f.atRisk !== null && f.atRisk > 0 ? "bad" : "neutral"} value={f.atRisk === null ? NOT_CONNECTED : money(f.atRisk, cur)} />
      </div>
      {!connected && <p className={s.quiet} data-guide="pf.next_step"><NextStep isAdmin={isAdmin} /></p>}

      <Card title="Cost against budget" info={PF_TIPS.notConnected}>
        <CostBar finance={f} isAdmin={isAdmin} />
      </Card>
      <Card title="Cost by category" info={PF_TIPS.etgAssumed}>
        <ForecastPanel projectId={project.id} currency={cur} cells={f.cost.cells} labels={labels} entries={f.etg} connected={connected} canEdit={canEdit} etgMissing={detail.etgMissing} />
      </Card>
      <SettingsSection id="pf.bridge" title="Margin bridge" info={PF_TIPS.bridge} defaultOpen summary={f.forecast ? `Forecast margin ${pct(f.forecast.pct)}` : "Forecast needs the ERP cost"}>
        <MarginBridge steps={f.bridge} currency={cur} />
      </SettingsSection>
    </div>
  );
}
