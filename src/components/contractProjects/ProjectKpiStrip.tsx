import StatTile, { StatStrip } from "@/components/ui/StatTile";
import SettingsSection from "@/components/settings/SettingsSection";
import type { ProjectView } from "@/lib/contractProjects/view";
import { marginCoverage } from "@/lib/contractProjects/budget";
import { marginTone, marginWords, money } from "@/lib/contractProjects/format";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";
import { REVISION_STATUS_LABEL, projectSourceNote, sourceTypeOf } from "@/lib/contractProjects/types";
import BudgetOrdered from "./BudgetOrdered";
import type { BuyoutData } from "./buyout/types";

/**
 * The three figures of a contract project under the title, visible on every tab, in one section that folds away (open on a PC, closed on
 * a phone, and it remembers what the person chose). Tone follows meaning: money is info, the margin tone comes from the workspace's
 * margin floor (amber under it, red when negative). While lines still wait for a cost the margin is the allocated lines' only and says
 * so ("on 2 of 12 lines"), in a plain tile. On a project with Buy-out, the Budget tile also says what has been ordered against it.
 */
export default function ProjectKpiStrip({ view, buyoutOn = false, initialBuyout, hideMargin = false }: {
  view: ProjectView;
  /** Cost and margin are granted (project_dashboards, finance_visibility "granted") and this person does not hold the grant: no margin figure here. */
  hideMargin?: boolean;
  buyoutOn?: boolean;
  /** Lets a server render (and its test) show the Ordered line. The page never passes it. */
  initialBuyout?: BuyoutData | null;
}) {
  const { project: p, totals, margin, revision } = view;
  const cur = p.currency;
  const words = marginWords(margin, marginCoverage(view.lines));
  return (
    <div style={{ marginBottom: 14 }}>
      <SettingsSection id="cp.key_figures" title="Key figures" defaultOpen defaultOpenNarrow={false} summary={hideMargin ? money(p.contract_value, cur) : `${money(p.contract_value, cur)} · margin ${words.partial ? "not complete" : words.value === "Not allocated yet" ? "not allocated yet" : words.value}`}>
        <StatStrip guide="cp.kpis">
          <StatTile tone="info" label="Contract value" info={PROJECT_TIPS.contractValue} value={money(p.contract_value, cur)} sub={projectSourceNote(sourceTypeOf(p), view.quoteOrigin?.ref)} />
          <StatTile
            tone="info" label="Budget" info={PROJECT_TIPS.allocated} value={money(totals.total, cur)}
            sub={<>
              {revision ? `${totals.allocatedCount} of ${totals.lineCount} lines allocated · ${revision.rev_no === 0 ? "Baseline" : `Revision ${revision.rev_no}`} · ${REVISION_STATUS_LABEL[revision.status]}` : "No budget yet"}
              {buyoutOn && revision && <BudgetOrdered projectId={p.id} budget={totals.total} currency={cur} initial={initialBuyout} />}
            </>}
          />
          {!hideMargin && <StatTile
            tone={words.partial ? "neutral" : marginTone(margin.state)} label="Planned margin" info={words.partial ? PROJECT_TIPS.marginPartial : PROJECT_TIPS.plannedMargin}
            value={words.value}
            sub={words.sub ?? (margin.pct === null ? "Needs a contract value" : margin.state === "none" ? "allocate a cost on the Budget tab" : money(margin.amount, cur))}
          />}
        </StatStrip>
      </SettingsSection>
    </div>
  );
}
