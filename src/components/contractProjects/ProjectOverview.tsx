import Link from "next/link";
import { c, pillar, statusInk } from "@/lib/theme";
import Card from "@/components/ui/Card";
import InfoTip from "@/components/ui/InfoTip";
import StatusPill from "@/components/ui/StatusPill";
import { ROUTES } from "@/lib/constants";
import type { ProjectView } from "@/lib/contractProjects/view";
import { day, money, pct } from "@/lib/contractProjects/format";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";
import ApprovalControls from "./ApprovalControls";
import { BidAgainstBudgetCard, ProjectOriginCard } from "./ProjectOriginCards";

const SEGMENTS = [pillar.blue.base, pillar.purple.base, pillar.teal.base, pillar.amber.base, pillar.green.base, pillar.red.base];

/**
 * The first thing on a project: the budget against the contract value (the four headline figures sit once in the page header), how
 * the cost splits by resource type, which revision stands and who must approve it, and what still needs a person. Detail sits on the
 * other tabs. Labels, values and bars only; the explanations are behind the "i".
 */
export default function ProjectOverview({ view, editor }: { view: ProjectView; editor?: React.ReactNode }) {
  const { project: p, totals, revision } = view;
  const cur = p.currency;
  const scale = Math.max(p.contract_value, totals.total, 1);
  const resourceName = new Map(view.resources.map((r) => [r.code, r.name]));
  const attention: { key: string; text: string; href: string }[] = [];
  if (totals.noResourceCount > 0) attention.push({ key: "res", text: `${totals.noResourceCount} line${totals.noResourceCount === 1 ? "" : "s"} without a resource type`, href: "budget" });
  if (totals.estimatedCount > 0) attention.push({ key: "est", text: `${totals.estimatedCount} line${totals.estimatedCount === 1 ? "" : "s"} with an estimated cost (${money(totals.estimatedAmount, cur)})`, href: "budget" });
  if (totals.noCostCodeCount > 0) attention.push({ key: "code", text: `${totals.noCostCodeCount} line${totals.noCostCodeCount === 1 ? "" : "s"} without a cost code`, href: "budget" });
  const tab = (t: string) => `${ROUTES.contractProject(p.id)}?tab=${t}`;

  return (
    <div data-guide="cp.overview" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card title="Budget against contract value" info={PROJECT_TIPS.budgetVsContract} padding={16}>
        <div data-guide="cp.bar" role="img" aria-label={`Budget ${money(totals.total, cur)} of contract value ${money(p.contract_value, cur)}`} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Bar label="Contract value" amount={p.contract_value} scale={scale} color={pillar.blue.base} cur={cur} />
          <Bar label="Budget" amount={totals.total} scale={scale} color={totals.total > p.contract_value && p.contract_value > 0 ? pillar.red.base : pillar.teal.base} cur={cur} />
        </div>
      </Card>

      <Card title="Budget by cost type" info={PROJECT_TIPS.costTypes} padding={16}>
        {totals.total <= 0 ? (
          <div style={{ fontSize: 13, color: c.hint }}>Add budget lines on the Budget tab.</div>
        ) : (
          <div data-guide="cp.stack" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", height: 16, borderRadius: 8, overflow: "hidden", background: c.panel2 }} role="img" aria-label="Budget split by resource type">
              {totals.byResource.filter((r) => r.amount > 0).map((r, i) => (
                <div key={r.code} title={`${resourceName.get(r.code) ?? (r.code || "No resource")}: ${money(r.amount, cur)}`} style={{ width: `${(r.amount / totals.total) * 100}%`, background: SEGMENTS[i % SEGMENTS.length] }} />
              ))}
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 6 }}>
              {totals.byResource.filter((r) => r.amount > 0).map((r, i) => (
                <li key={r.code} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: c.ink }}>
                  <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: SEGMENTS[i % SEGMENTS.length], flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{resourceName.get(r.code) ?? (r.code ? r.code : "No resource")}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums", color: c.muted }}>{money(r.amount, cur)} · {pct(Math.round((r.amount / totals.total) * 1000) / 10)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
        <Card padding={16} style={{ minWidth: 0 }}>
          <ApprovalControls
            projectId={p.id} revisionId={revision?.id ?? null} revisionStatus={revision?.status ?? null}
            canEdit={view.canEdit} approval={view.approval} closed={p.status === "closed"}
          />
        </Card>
        <Card title="Needs attention" info={PROJECT_TIPS.attention} padding={16} style={{ minWidth: 0 }}>
          {attention.length === 0 ? (
            <div style={{ fontSize: 13, color: c.hint }}>Nothing to fix.</div>
          ) : (
            <ul data-guide="cp.attention" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {attention.map((a) => (
                <li key={a.key} style={{ fontSize: 13 }}>
                  <Link href={tab(a.href)} style={{ color: statusInk.warn, textDecoration: "none", display: "inline-block", minHeight: 24 }}>{a.text}</Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {(view.bidAgainstBudget || view.origin) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
          {view.bidAgainstBudget && <BidAgainstBudgetCard bid={view.bidAgainstBudget} currency={cur} />}
          {view.origin && <ProjectOriginCard origin={view.origin} />}
        </div>
      )}

      <Card title="Details" padding={16}>
        <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px 18px", margin: 0 }}>
          <Detail label="Customer" value={view.account_name} />
          <Detail label="Manager" value={view.manager_name} />
          <Detail label="Planned start" value={p.planned_start ? day(p.planned_start) : null} />
          <Detail label="Planned end" value={p.planned_end ? day(p.planned_end) : null} />
          {!view.origin && <Detail label="Tender" value={view.source ? <Link href={ROUTES.pipelineDetail(view.source.id)} style={{ color: c.accent }}>{view.source.ref ?? view.source.title}</Link> : null} />}
          <Detail label="ERP id" info={PROJECT_TIPS.erpId} value={p.erp_id ? `${p.erp_system ?? "ERP"} · ${p.erp_id}` : null} />
          <Detail label="Status" value={<StatusPill label={p.status === "baseline_pending" ? "Baseline waiting" : p.status === "active" ? "Active" : p.status === "closed" ? "Closed" : "Draft"} tone={p.status === "active" ? "green" : p.status === "baseline_pending" ? "amber" : "blue"} />} />
        </dl>
      </Card>
      {editor}
    </div>
  );
}

function Bar({ label, amount, scale, color, cur }: { label: string; amount: number; scale: number; color: string; cur: string | null }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: c.muted, marginBottom: 3 }}>
        <span>{label}</span><span style={{ fontVariantNumeric: "tabular-nums", color: c.ink }}>{money(amount, cur)}</span>
      </div>
      <div style={{ height: 14, borderRadius: 7, background: c.panel2, overflow: "hidden" }}>
        <div style={{ width: `${Math.min(100, (amount / scale) * 100)}%`, height: "100%", background: color }} />
      </div>
    </div>
  );
}

function Detail({ label, value, info }: { label: string; value: React.ReactNode; info?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <dt style={{ fontSize: 11.5, color: c.hint, display: "flex", alignItems: "center", gap: 4 }}>{label}{info && <InfoTip label={label}>{info}</InfoTip>}</dt>
      <dd style={{ margin: "2px 0 0", fontSize: 13.5, color: c.ink, overflowWrap: "anywhere" }}>{value || "—"}</dd>
    </div>
  );
}
