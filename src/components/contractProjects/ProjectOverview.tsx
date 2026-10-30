import Link from "next/link";
import { c, pillar, statusInk } from "@/lib/theme";
import Card from "@/components/ui/Card";
import InfoTip from "@/components/ui/InfoTip";
import StatusPill from "@/components/ui/StatusPill";
import SettingsSection from "@/components/settings/SettingsSection";
import { ROUTES } from "@/lib/constants";
import type { ProjectView } from "@/lib/contractProjects/view";
import { day, money, pct } from "@/lib/contractProjects/format";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";
import ApprovalControls from "./ApprovalControls";
import BuyoutProgressCard from "./buyout/BuyoutProgressCard";
import { BidAgainstBudgetCard } from "./ProjectOriginCards";

const SEGMENTS = [pillar.blue.base, pillar.purple.base, pillar.teal.base, pillar.amber.base, pillar.green.base, pillar.red.base];

/** Does the approval control have something for THIS person to do (ask, decide, withdraw)? Then the Needs-you banner carries it. */
export function approvalActionDue(view: ProjectView): boolean {
  const a = view.approval;
  if (!a || !view.revision || view.project.status === "closed") return false;
  if (a.pending) return a.canDecide || a.pending.mine;
  return view.revision.status === "draft" && view.canEdit;
}

/**
 * The first thing on a project, top to bottom: what needs a person (one banner, only when there is something), the one graph of where
 * the budget goes against the contract value, the buy-out progress, how the budget stands against the winning bid, and the project
 * details folded away. The headline figures sit once under the title; the origin sits in the page header.
 */
export default function ProjectOverview({ view, editor, buyoutOn = false }: { view: ProjectView; editor?: React.ReactNode; buyoutOn?: boolean }) {
  const { project: p, totals, revision } = view;
  const cur = p.currency;
  const tab = (t: string) => `${ROUTES.contractProject(p.id)}?tab=${t}`;
  const attention: { key: string; text: string; link: string; href: string }[] = [];
  if (totals.unallocatedCount > 0) attention.push({ key: "alloc", text: `${totals.unallocatedCount} line${totals.unallocatedCount === 1 ? "" : "s"} not allocated`, link: "Allocate", href: tab("budget") });
  if (totals.noResourceCount > 0) attention.push({ key: "res", text: `${totals.noResourceCount} line${totals.noResourceCount === 1 ? "" : "s"} without a resource type`, link: "Fix", href: tab("budget") });
  if (totals.noCostCodeCount > 0) attention.push({ key: "code", text: `${totals.noCostCodeCount} line${totals.noCostCodeCount === 1 ? "" : "s"} without a cost code`, link: "Fix", href: tab("budget") });
  const approvalDue = approvalActionDue(view);

  const resourceName = new Map(view.resources.map((r) => [r.code, r.name]));
  const contract = Math.max(0, p.contract_value);
  const over = contract > 0 && totals.total > contract ? totals.total - contract : 0;
  // The bar is the contract value; when the budget is larger than it the bar is the budget and a red line says by how much.
  const scale = Math.max(contract, totals.total, 1);
  const parts = totals.byResource.filter((r) => r.amount > 0).map((r, i) => ({
    key: r.code, name: resourceName.get(r.code) ?? (r.code ? r.code : "No resource"), amount: r.amount, color: SEGMENTS[i % SEGMENTS.length],
  }));
  const margin = contract > 0 ? Math.max(0, contract - totals.total) : 0;
  const share = (n: number) => pct(Math.round((n / scale) * 1000) / 10);

  return (
    <div data-guide="cp.overview" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {(approvalDue || attention.length > 0) && (
        <div
          data-guide="cp.needs_you" role="region" aria-label="Needs you"
          style={{ display: "flex", alignItems: "center", gap: "8px 16px", flexWrap: "wrap", padding: "10px 14px", borderRadius: "var(--card-radius)", background: pillar.amber.bg, border: `1px solid ${pillar.amber.base}`, color: pillar.amber.fg }}
        >
          <b style={{ fontSize: 13 }}>Needs you</b>
          {approvalDue && (
            <ApprovalControls
              mode="action" projectId={p.id} revisionId={revision?.id ?? null} revisionStatus={revision?.status ?? null}
              canEdit={view.canEdit} approval={view.approval} closed={p.status === "closed"}
            />
          )}
          {attention.map((a) => (
            <span key={a.key} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              {a.text}
              <Link href={a.href} data-guide={`cp.needs_you.${a.key}`} style={{ color: statusInk.warn, fontWeight: 600, display: "inline-flex", alignItems: "center", minHeight: 44 }}>{a.link}</Link>
            </span>
          ))}
        </div>
      )}

      <Card title="Where the budget goes" info={PROJECT_TIPS.whereBudgetGoes} padding={16}>
        {totals.total <= 0 ? (
          <div style={{ fontSize: 13, color: c.hint }}>Add budget lines on the Budget tab.</div>
        ) : (
          <div data-guide="cp.bar" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12.5, color: c.muted }}>Budget {money(totals.total, cur)} of contract value {money(contract, cur)}. The rest is your margin.</div>
            <div role="img" aria-label={`Budget ${money(totals.total, cur)} of contract value ${money(contract, cur)}`} style={{ display: "flex", height: 18, borderRadius: 9, overflow: "hidden", background: c.panel2 }}>
              {parts.map((r) => (
                <div key={r.key} title={`${r.name}: ${money(r.amount, cur)}`} style={{ width: `${(r.amount / scale) * 100}%`, background: r.color }} />
              ))}
              {margin > 0 && <div title={`Margin: ${money(margin, cur)}`} style={{ width: `${(margin / scale) * 100}%`, background: c.line }} />}
            </div>
            <ul data-guide="cp.stack" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: 12.5, color: c.ink }}>
              {parts.map((r) => (
                <li key={r.key} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: r.color, flexShrink: 0 }} />
                  {r.name} {share(r.amount)}
                </li>
              ))}
              {margin > 0 && (
                <li style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: c.line, flexShrink: 0 }} />
                  Margin {share(margin)}
                </li>
              )}
            </ul>
            {over > 0 && <div role="status" data-guide="cp.over" style={{ fontSize: 13, color: pillar.red.fg, fontWeight: 600 }}>Over by {money(over, cur)}</div>}
          </div>
        )}
      </Card>

      {buyoutOn && <BuyoutProgressCard projectId={p.id} currency={cur} />}

      {view.bidAgainstBudget && <BidAgainstBudgetCard bid={view.bidAgainstBudget} currency={cur} />}

      <SettingsSection id="cp.details" title="Project details" defaultOpen={false} summary={`${view.manager_name ?? "no manager"} · ${p.planned_start ? day(p.planned_start) : "no dates"}`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px 18px", margin: 0 }}>
            <Detail label="Customer" value={view.account_name} />
            <Detail label="Manager" value={view.manager_name} />
            <Detail label="Planned start" value={p.planned_start ? day(p.planned_start) : null} />
            <Detail label="Planned end" value={p.planned_end ? day(p.planned_end) : null} />
            <Detail label="ERP id" info={PROJECT_TIPS.erpId} value={p.erp_id ? `${p.erp_system ?? "ERP"} · ${p.erp_id}` : null} />
            <Detail label="Status" value={<StatusPill label={p.status === "baseline_pending" ? "Baseline waiting" : p.status === "active" ? "Active" : p.status === "closed" ? "Closed" : "Draft"} tone={p.status === "active" ? "green" : p.status === "baseline_pending" ? "amber" : "blue"} />} />
          </dl>
          <ApprovalControls
            mode="status" projectId={p.id} revisionId={revision?.id ?? null} revisionStatus={revision?.status ?? null}
            canEdit={view.canEdit} approval={view.approval} closed={p.status === "closed"}
          />
          {editor}
        </div>
      </SettingsSection>
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
