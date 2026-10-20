import { notFound } from "next/navigation";
import Link from "next/link";
import { c, pillar } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import ObjectRecordPage from "@/components/page/ObjectRecordPage";
import RecordMoreMenu from "@/components/page/RecordMoreMenu";
import RecordActivity from "@/components/page/RecordActivity";
import ObjectSections from "@/components/fields/ObjectSections";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { PENDING_MESSAGE } from "@/lib/abm/server";
import { loadTargetBundle, userNames } from "@/lib/abm/views";
import { getAbmBuyingStage, STAGE_LABEL } from "@/lib/abm/stage";
import { roleGaps } from "@/lib/abm/roles";
import { describeProgressSource, shortDate } from "@/lib/abm/progress";
import { TIER_LABEL } from "@/lib/abm/types";
import { abmPage, fmtDate, isOverdue } from "../../../pageData";
import ProgressWhy from "../../../ProgressWhy";
import UpdateProgressButton from "./UpdateProgressButton";
import BuyingGroupGrid, { type GridMember } from "./BuyingGroupGrid";
import PlanPanel from "./PlanPanel";

export default async function AbmTargetPage({ params, searchParams }: { params: Promise<{ id: string; targetId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ctx = await abmPage();
  const { id, targetId } = await params;
  const { tab } = await searchParams;

  const { missing, bundle } = await loadTargetBundle(ctx, targetId);
  if (missing) return <Card padding={0}><EmptyState title="ABM is waiting for a database update" text={PENDING_MESSAGE} /></Card>;
  if (!bundle || bundle.program.id !== id) notFound();
  const { target, program, account, members } = bundle;

  const names = await userNames(ctx);
  const users = [...names.entries()].map(([uid, name]) => ({ id: uid, name })).sort((a, b) => a.name.localeCompare(b.name));
  const stage = await getAbmBuyingStage(ctx.tenantId, account.id);
  const closed = ["won", "lost", "dropped"].includes(target.progress);
  const gaps = closed ? [] : roleGaps(program.required_roles, members);
  const isAdmin = ctx.role === "admin";
  const basePath = ROUTES.marketingAbmTarget(program.id, target.id);
  const actor = target.progress_changed_by ? names.get(target.progress_changed_by) ?? null : null;
  const overdue = isOverdue(target.next_step_due) && !closed;

  const gridMembers: GridMember[] = members.map((m) => ({
    id: m.id, contactId: m.contact_id, name: m.contact_name, jobTitle: m.contact_role, role: m.role, isPrimary: m.is_primary, ownerId: m.owner_user_id,
    lastEngagement: m.last_engagement ? shortDate(m.last_engagement) : null,
  }));

  return (
    <ObjectRecordPage
      backHref={ROUTES.marketingAbmProgram(program.id)}
      backLabel={program.name}
      title={account.name}
      reference={program.ref}
      meta={[TIER_LABEL[target.tier], account.city, account.industry].filter(Boolean).join(" · ")}
      primaryAction={ctx.can.edit ? <UpdateProgressButton targetId={target.id} current={target.progress} /> : undefined}
      menu={
        <RecordMoreMenu
          inlineEdit={{ overviewHref: `${basePath}?tab=details` }}
          adapt={{ objectType: "abm_target", objectLabel: "ABM target account", isAdmin }}
          extraItems={[{ label: "Open the account", href: ROUTES.account(account.id) }]}
          remove={ctx.can.delete ? { endpoint: `/api/abm/targets/${target.id}`, recordName: account.name, entityLabel: "target account", afterHref: ROUTES.marketingAbmProgram(program.id), confirmBody: "The company leaves this program's list, with its buying group. The account itself is untouched. You'll have a few seconds to undo." } : undefined}
        />
      }
      facts={[
        { label: "Buying stage", value: stage ? STAGE_LABEL[stage] : <span style={{ color: c.hint, fontWeight: 400 }}>— <span style={{ fontSize: 11.5 }}>needs Buying signals</span></span> },
        {
          label: "Progress",
          value: (
            <>
              <ProgressWhy targetId={target.id} progress={target.progress} />
              <div style={{ fontSize: 11.5, fontWeight: 400, color: c.muted, marginTop: 4 }}>
                {describeProgressSource({ progress_source: target.progress_source, progress_reason: target.progress_reason, progress_changed_at: target.progress_changed_at, actorName: actor })}
              </div>
            </>
          ),
        },
        {
          label: "Next step",
          value: target.next_step
            ? <>{target.next_step}<div style={{ fontSize: 11.5, fontWeight: overdue ? 700 : 400, color: overdue ? pillar.red.fg : c.muted }}>{overdue ? "Overdue: " : "Due "}{fmtDate(target.next_step_due)}</div></>
            : <span style={{ color: c.hint, fontWeight: 400 }}>None set</span>,
        },
        { label: "Owner", value: target.owner_user_id ? names.get(target.owner_user_id) ?? "—" : "—" },
      ]}
      basePath={basePath}
      activeTab={tab}
      tabs={[
        {
          id: "group", label: "Buying group", count: members.length || undefined,
          content: (
            <>
              {gaps.length > 0 && (
                <div role="status" style={{ background: pillar.amber.bg, color: pillar.amber.fg, borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 600 }}>
                  {gaps.map((g) => g.text).join(" · ")}
                </div>
              )}
              <BuyingGroupGrid targetId={target.id} accountId={account.id} members={gridMembers} requiredRoles={closed ? [] : program.required_roles} users={users} canEdit={ctx.can.edit} />
              <div style={{ fontSize: 12, color: c.hint }}>
                Roles are for this program only. <Link href={ROUTES.account(account.id)} style={{ color: c.accent }}>Open the account</Link> to add a contact that is not listed.
              </div>
            </>
          ),
        },
        {
          id: "plan", label: "Plan",
          content: (
            <PlanPanel
              targetId={target.id} accountId={account.id} users={users} canEdit={ctx.can.edit}
              initial={{
                tier: target.tier, ownerId: target.owner_user_id, ownerSource: target.owner_source, nextStep: target.next_step ?? "", nextStepDue: target.next_step_due ?? "",
                nextStepUserId: target.next_step_user_id, opportunityId: target.opportunity_id, notes: target.notes ?? "",
              }}
            />
          ),
        },
        { id: "activity", label: "Activity", content: <RecordActivity objectType="abm_targets" objectId={target.id} changeLogType="abm_target_accounts" isAdmin={isAdmin} /> },
        {
          id: "details", label: "Details",
          content: <ObjectSections objectType="abm_target" record={target as unknown as Record<string, unknown>} patchUrl={`/api/abm/targets/${target.id}`} exclude={["next_step", "next_step_due", "tier"]} />,
        },
      ]}
    />
  );
}
