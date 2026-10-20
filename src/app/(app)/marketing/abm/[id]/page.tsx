import { notFound } from "next/navigation";
import Link from "next/link";
import { c, pillar } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import ObjectRecordPage from "@/components/page/ObjectRecordPage";
import RecordMoreMenu from "@/components/page/RecordMoreMenu";
import RecordActionButton from "@/components/page/recordActions";
import RecordActivity from "@/components/page/RecordActivity";
import ObjectSections from "@/components/fields/ObjectSections";
import StatusPill from "@/components/ui/StatusPill";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { loadProgram, PENDING_MESSAGE } from "@/lib/abm/server";
import { loadProgramResults, loadProgramTargets, userNames } from "@/lib/abm/views";
import { goalSentence } from "@/lib/abm/results";
import { STAGE_LABEL } from "@/lib/abm/stage";
import { PROGRAM_STATUS_LABEL, KIND_LABEL, TIER_LABEL, GOAL_METRIC_LABEL, PROGRESS_LABEL, ROLE_LABEL } from "@/lib/abm/types";
import { abmPage, fmtDate, isOverdue } from "../pageData";
import TargetsTable, { type TargetListRow } from "../TargetsTable";
import AddAccountsButton from "../AddAccountsButton";
import { CheckProgressButton, RefreshSourceButton, RequiredRolesEditor } from "../ProgramTools";

const STATUS_TONE = { draft: "purple", active: "green", paused: "amber", completed: "blue", archived: "purple" } as const;

const daysLeft = (end: string | null): string => {
  if (!end) return "";
  const d = Math.ceil((new Date(`${end}T00:00:00Z`).getTime() - Date.now()) / 86_400_000);
  return d >= 0 ? `${d} ${d === 1 ? "day" : "days"} left` : `ended ${-d} ${d === -1 ? "day" : "days"} ago`;
};

export default async function AbmProgramPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ctx = await abmPage();
  const { id } = await params;
  const { tab } = await searchParams;

  const { data: program, missing } = await loadProgram(ctx, id);
  if (missing) return <Card padding={0}><EmptyState title="ABM is waiting for a database update" text={PENDING_MESSAGE} /></Card>;
  if (!program) notFound();

  const names = await userNames(ctx);
  const [{ rows }, { results }] = await Promise.all([loadProgramTargets(ctx, program, names), loadProgramResults(ctx, program)]);
  const isAdmin = ctx.role === "admin";
  const basePath = ROUTES.marketingAbmProgram(program.id);

  const listRows: TargetListRow[] = rows.map((r) => ({
    id: r.target.id,
    href: ROUTES.marketingAbmTarget(program.id, r.target.id),
    accountName: r.account.name,
    place: [r.account.city, r.account.industry].filter(Boolean).join(" · "),
    tier: r.target.tier,
    stage: r.stage ? STAGE_LABEL[r.stage] : null,
    progress: r.target.progress,
    nextStep: r.target.next_step,
    nextStepDue: r.target.next_step_due ? fmtDate(r.target.next_step_due) : null,
    overdue: isOverdue(r.target.next_step_due) && !["won", "lost", "dropped"].includes(r.target.progress),
    groupText: r.summary.text,
    hasGap: r.summary.hasGap && !["won", "lost", "dropped"].includes(r.target.progress),
    owner: r.ownerName,
  }));

  const open = rows.filter((r) => !["won", "lost", "dropped"].includes(r.target.progress));
  const withGap = open.filter((r) => r.gaps.length > 0);
  const f = results.funnel;
  const fmtMoney = (n: number) => Math.round(n).toLocaleString("en-US");

  const primary = program.status === "draft" ? { label: "Start", status: "active" }
    : program.status === "active" ? { label: "Pause", status: "paused" }
    : program.status === "paused" ? { label: "Resume", status: "active" }
    : null;

  return (
    <ObjectRecordPage
      backHref={ROUTES.marketingAbm}
      backLabel="All programs"
      title={program.name}
      reference={program.ref}
      meta={`${KIND_LABEL[program.kind]} · default tier ${TIER_LABEL[program.default_tier]}`}
      status={<StatusPill label={PROGRAM_STATUS_LABEL[program.status]} tone={STATUS_TONE[program.status]} />}
      primaryAction={primary && ctx.can.edit ? (
        <RecordActionButton action={{ label: primary.label, endpoint: `/api/abm/programs/${program.id}`, method: "PATCH", body: { status: primary.status }, successText: `Program ${primary.status === "active" ? "is active" : "paused"}` }} />
      ) : undefined}
      menu={
        <RecordMoreMenu
          inlineEdit={{ overviewHref: `${basePath}?tab=details` }}
          adapt={{ objectType: "abm_program", objectLabel: "ABM program", isAdmin }}
          actions={[
            { label: "Archive", endpoint: `/api/abm/programs/${program.id}`, method: "PATCH", body: { status: "archived" }, hidden: program.status === "archived" || !ctx.can.edit, confirm: { title: `Archive "${program.name}"?`, body: "It leaves the active lists. Its results stay." }, successText: "Archived" },
            { label: "Mark completed", endpoint: `/api/abm/programs/${program.id}`, method: "PATCH", body: { status: "completed" }, hidden: program.status === "completed" || program.status === "archived" || !ctx.can.edit, successText: "Marked completed" },
          ]}
          remove={ctx.can.delete ? { endpoint: `/api/abm/programs/${program.id}`, recordName: program.name, entityLabel: "program", afterHref: ROUTES.marketingAbm, confirmBody: "Its target list and buying groups are deleted with it. You'll have a few seconds to undo." } : undefined}
        />
      }
      facts={[
        { label: "Goal", value: <>{goalSentence(results)}<div style={{ fontSize: 11.5, fontWeight: 400, color: c.muted }}>{GOAL_METRIC_LABEL[program.goal_metric]}</div></> },
        { label: "Window", value: program.starts_on || program.ends_on ? <>{fmtDate(program.starts_on)} to {fmtDate(program.ends_on)}<div style={{ fontSize: 11.5, fontWeight: 400, color: c.muted }}>{daysLeft(program.ends_on)}</div></> : "No dates set" },
        { label: "Owner", value: program.owner_user_id ? names.get(program.owner_user_id) ?? "—" : "—" },
        { label: "Targets", value: <>{f.targets}<div style={{ fontSize: 11.5, fontWeight: 400, color: c.muted }}>{f.engaged} engaged · {f.deals} in a deal</div></> },
      ]}
      basePath={basePath}
      activeTab={tab}
      tabs={[
        {
          id: "targets", label: "Target accounts", count: f.targets,
          content: (
            <>
              {program.goal && <Card padding={14}><div style={{ fontSize: 13.5 }}><b>Goal.</b> {program.goal}</div></Card>}
              {ctx.can.edit && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <AddAccountsButton programId={program.id} defaultTier={program.default_tier} />
                  <CheckProgressButton programId={program.id} />
                  {(program.source_target_group_id || program.source_segment_id) && <RefreshSourceButton programId={program.id} />}
                </div>
              )}
              {program.source_snapshot_at && (
                <div style={{ fontSize: 12, color: c.hint }}>List copied from {program.source_target_group_id ? "a marketing target group" : "a Coverage segment"} on {fmtDate(program.source_snapshot_at)}. It does not change by itself.</div>
              )}
              <TargetsTable rows={listRows} />
            </>
          ),
        },
        {
          id: "groups", label: "Buying groups", count: withGap.length || undefined,
          content: (
            <>
              <Card title="Roles every company needs" padding={16}>
                <RequiredRolesEditor programId={program.id} roles={program.required_roles} canEdit={ctx.can.edit} />
                <div style={{ fontSize: 12.5, color: c.muted, marginTop: 8 }}>
                  A company with none of a required role shows a gap. By default it is not marked Engaged until the gap is filled.
                </div>
              </Card>
              <Card title={withGap.length === 0 ? "No gaps" : `${withGap.length} of ${open.length} open ${open.length === 1 ? "company has" : "companies have"} a gap`} padding={0}>
                {rows.length === 0 ? <EmptyState title="No target accounts yet" /> : (
                  <div>
                    {rows.map((r) => (
                      <div key={r.target.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "10px 16px", borderTop: `1px solid ${c.line}`, fontSize: 13 }}>
                        <Link href={ROUTES.marketingAbmTarget(program.id, r.target.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none" }}>{r.account.name}</Link>
                        <span style={{ color: c.muted }}>
                          {r.members.length} {r.members.length === 1 ? "person" : "people"}
                          {r.gaps.length > 0 && ["won", "lost", "dropped"].includes(r.target.progress) === false && (
                            <span style={{ color: pillar.amber.fg, fontWeight: 600 }}> · {r.gaps.map((g) => ROLE_LABEL[g.role].toLowerCase()).join(", ")} missing</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </>
          ),
        },
        {
          id: "results", label: "Results",
          content: (
            <>
              <Card title="Did it work?" padding={16}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
                  {([
                    ["Targets", f.targets], ["Reached", f.reached], ["Engaged", f.engaged], ["In talks", f.inTalks], ["In a deal", f.deals], ["Won", f.won],
                  ] as const).map(([label, n]) => (
                    <div key={label} style={{ background: c.panel2, borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: c.ink }}>{n}</div>
                      <div style={{ fontSize: 11.5, color: c.muted }}>{label}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 13, marginTop: 12 }}>
                  <b>Goal:</b> {goalSentence(results)}. {results.money.openDeals > 0 && <>{results.money.openDeals} open {results.money.openDeals === 1 ? "deal" : "deals"} worth {fmtMoney(results.money.openValue)}. </>}
                  {results.money.wonDeals > 0 && <>Won so far: {fmtMoney(results.money.wonValue)}. </>}
                  <span style={{ color: c.hint }}>Money is from the deals linked to targets.</span>
                </div>
                {(f.dropped > 0 || f.lost > 0) && <div style={{ fontSize: 12.5, color: c.muted, marginTop: 6 }}>{f.dropped} dropped and {f.lost} lost are counted in Targets, not in the steps after.</div>}
                {results.smallSample && f.targets > 0 && <div style={{ fontSize: 12, color: c.hint, marginTop: 6 }}>Fewer than 20 targets. Read this as a list, not a trend.</div>}
              </Card>
              <Card title="By tier" padding={0}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead><tr style={{ textAlign: "left", color: c.hint, fontSize: 11, textTransform: "uppercase" }}>
                    <th style={{ padding: "8px 16px" }}>Tier</th><th>Targets</th><th>Engaged</th><th>In a deal</th><th>Won</th>
                  </tr></thead>
                  <tbody>
                    {results.byTier.filter((t) => t.targets > 0).map((t) => (
                      <tr key={t.tier} style={{ borderTop: `1px solid ${c.line}` }}>
                        <td style={{ padding: "8px 16px", fontWeight: 600 }}>{TIER_LABEL[t.tier]}</td><td>{t.targets}</td><td>{t.engaged}</td><td>{t.deals}</td><td>{t.won}</td>
                      </tr>
                    ))}
                    {f.targets === 0 && <tr><td colSpan={5} style={{ padding: "14px 16px", color: c.hint }}>No targets yet.</td></tr>}
                  </tbody>
                </table>
              </Card>
              <Card title="Where the targets are" padding={16}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12.5 }}>
                  {(Object.keys(results.byProgress) as (keyof typeof results.byProgress)[]).filter((k) => results.byProgress[k] > 0).map((k) => (
                    <span key={k} style={{ background: c.panel2, borderRadius: 8, padding: "4px 10px" }}>{PROGRESS_LABEL[k]} <b>{results.byProgress[k]}</b></span>
                  ))}
                  {f.targets === 0 && <span style={{ color: c.hint }}>No targets yet.</span>}
                </div>
              </Card>
            </>
          ),
        },
        { id: "activity", label: "Activity", content: <RecordActivity objectType="abm_programs" objectId={program.id} isAdmin={isAdmin} /> },
        {
          id: "details", label: "Details",
          content: <ObjectSections objectType="abm_program" record={program as unknown as Record<string, unknown>} patchUrl={`/api/abm/programs/${program.id}`} exclude={["ref"]} />,
        },
      ]}
    />
  );
}
