import StatTile, { StatStrip } from "@/components/ui/StatTile";
import { toneForMargin } from "@/lib/ui/tone";
import type { ProjectView } from "@/lib/contractProjects/view";
import { money, pct } from "@/lib/contractProjects/format";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";
import { REVISION_STATUS_LABEL } from "@/lib/contractProjects/types";

/**
 * The four figures of a contract project, shown once, under the title and visible on every tab. The Overview tab no longer repeats
 * them. Tone follows meaning: money is info, the margin tone comes from toneForMargin, the line count is a plain fact.
 */
export default function ProjectKpiStrip({ view }: { view: ProjectView }) {
  const { project: p, totals, margin, revision } = view;
  const cur = p.currency;
  return (
    <div style={{ marginBottom: 14 }}>
      <StatStrip guide="cp.kpis">
        <StatTile tone="info" label="Contract value" info={PROJECT_TIPS.contractValue} value={money(p.contract_value, cur)} sub={p.source_opportunity_id ? "from the awarded tender" : "entered by hand"} />
        <StatTile tone="info" label="Budget" value={money(totals.total, cur)} sub={revision ? `${revision.rev_no === 0 ? "Baseline" : `Revision ${revision.rev_no}`} · ${REVISION_STATUS_LABEL[revision.status]}` : "No budget yet"} />
        <StatTile tone={toneForMargin(margin.pct)} label="Planned margin" info={PROJECT_TIPS.plannedMargin} value={pct(margin.pct)} sub={margin.pct === null ? "Needs a contract value" : money(margin.amount, cur)} />
        <StatTile label="Lines" value={String(totals.lineCount)} sub={totals.reserve > 0 ? `${money(totals.reserve, cur)} in reserve` : "no reserve"} />
      </StatStrip>
    </div>
  );
}
