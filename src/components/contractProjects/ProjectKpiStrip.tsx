import StatTile, { StatStrip } from "@/components/ui/StatTile";
import SettingsSection from "@/components/settings/SettingsSection";
import { marginState } from "@/lib/contractProjects/budget";
import type { ProjectView } from "@/lib/contractProjects/view";
import { marginTone, money, pct } from "@/lib/contractProjects/format";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";
import { REVISION_STATUS_LABEL } from "@/lib/contractProjects/types";

/**
 * The three figures of a contract project under the title, visible on every tab, in one section that folds away (open on a PC, closed on
 * a phone, and it remembers what the person chose). Tone follows meaning: money is info, the margin tone comes from the workspace's
 * margin floor (amber under it, red when negative).
 */
export default function ProjectKpiStrip({ view }: { view: ProjectView }) {
  const { project: p, totals, margin, revision } = view;
  const cur = p.currency;
  const state = marginState(margin.pct, view.marginFloor);
  return (
    <div style={{ marginBottom: 14 }}>
      <SettingsSection id="cp.key_figures" title="Key figures" defaultOpen defaultOpenNarrow={false} summary={`${money(p.contract_value, cur)} · margin ${pct(margin.pct)}`}>
        <StatStrip guide="cp.kpis">
          <StatTile tone="info" label="Contract value" info={PROJECT_TIPS.contractValue} value={money(p.contract_value, cur)} sub={p.source_opportunity_id ? "from the awarded tender" : "entered by hand"} />
          <StatTile tone="info" label="Budget" value={money(totals.total, cur)} sub={revision ? `${revision.rev_no === 0 ? "Baseline" : `Revision ${revision.rev_no}`} · ${REVISION_STATUS_LABEL[revision.status]}` : "No budget yet"} />
          <StatTile tone={marginTone(state)} label="Planned margin" info={PROJECT_TIPS.plannedMargin} value={pct(margin.pct)} sub={margin.pct === null ? "Needs a contract value" : money(margin.amount, cur)} />
        </StatStrip>
      </SettingsSection>
    </div>
  );
}
