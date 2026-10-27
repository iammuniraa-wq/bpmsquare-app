import Link from "next/link";
import { notFound } from "next/navigation";
import { c, statusInk } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import Card from "@/components/ui/Card";
import InfoTip from "@/components/ui/InfoTip";
import EmptyState from "@/components/ui/EmptyState";
import ObjectRecordPage from "@/components/page/ObjectRecordPage";
import RecordActivity from "@/components/page/RecordActivity";
import { stageDefOf } from "@/lib/marketing/leadStages";
import { SCORE_LABEL, stageForScore } from "@/lib/marketing/scoring";
import { leadPage } from "@/lib/marketing/leads/pageGuard";
import { getScoredLead, loadLeadTimeline } from "@/lib/marketing/leads/queries";
import { listWorkspacePeople, personLabel } from "@/lib/marketing/leads/people";
import { eventDetail, eventWords } from "@/lib/marketing/leads/eventWords";
import { describeDue } from "@/lib/marketing/leads/timing";
import { LEAD_SCORE_TIPS, whyScoreTip } from "@/lib/marketing/leads/tips";
import { AcceptButton, OwnerControl, RescoreButton, StageControl } from "../LeadControls";
import { AssignmentChip, DueChip, ScoreMeter, StagePill } from "../ScoreBits";
import SourceEmailSlot from "@/components/inbox/SourceEmailSlot";

const KIND_WORDS: Record<string, string> = { behaviour: "What they did", profile: "Who they are", market: "The market" };

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function ago(iso: string | null, now: Date): string {
  if (!iso) return "never";
  const mins = (now.getTime() - Date.parse(iso)) / 60000;
  if (!Number.isFinite(mins)) return "never";
  if (mins < 2) return "just now";
  if (mins < 60) return `${Math.floor(mins)} minutes ago`;
  if (mins < 2880) return `${Math.floor(mins / 60)} hours ago`;
  return `${Math.floor(mins / 1440)} days ago`;
}

export default async function ScoredLeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ctx = await leadPage();
  const { id } = await params;
  const { tab } = await searchParams;

  const { lead, pending } = await getScoredLead(ctx.admin, ctx.tenantId, id);
  if (pending || !lead) notFound();

  const [people, timeline, accountRes, contactRes] = await Promise.all([
    listWorkspacePeople(ctx.admin, ctx.tenantId),
    loadLeadTimeline(ctx.admin, ctx.tenantId, lead),
    ctx.admin.from("accounts").select("name, type, industry, country, city").eq("id", lead.account_id).eq("tenant_id", ctx.tenantId).maybeSingle(),
    lead.contact_id
      ? ctx.admin.from("contacts").select("name, role").eq("id", lead.contact_id).eq("tenant_id", ctx.tenantId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const account = accountRes.data as { name: string; type: string | null; industry: string | null; country: string | null; city: string | null } | null;
  const contact = contactRes.data as { name: string; role: string | null } | null;

  const byId = new Map(people.map((p) => [p.user_id, p]));
  const ownerLabel = lead.owner_user_id ? personLabel(byId.get(lead.owner_user_id)) : "Nobody yet";
  const thresholds = ctx.rubric.thresholds;
  const factors = lead.factors?.factors ?? [];
  const band = lead.score != null ? stageForScore(lead.score, thresholds) : null;
  const next = lead.score == null ? null
    : lead.score < thresholds.engaged ? { need: thresholds.engaged - lead.score, label: SCORE_LABEL.engaged }
    : lead.score < thresholds.ready ? { need: thresholds.ready - lead.score, label: SCORE_LABEL.ready } : null;
  const basePath = ROUTES.marketingLead(lead.id);
  const dueText = lead.stage === "ready" ? describeDue(lead.sla_due_at, ctx.now) : null;

  const scoreCard = (
    <Card
      title={lead.score != null ? `Why ${lead.score}?` : "Score"}
      info={lead.score != null ? whyScoreTip(lead.factors?.rubric_version ?? ctx.rubric.version) : undefined}
      action={<RescoreButton leadId={lead.id} />}
    >
      {lead.score == null ? (
        <EmptyState title="Not scored yet" text="Scores are worked out every fifteen minutes. You can also press Score again to see it now." />
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 6 }}>
            <ScoreMeter score={lead.score} thresholds={thresholds} width={160} />
            <span style={{ fontWeight: 600, color: c.ink }}>{band ? SCORE_LABEL[band] : ""}</span>
          </div>
          <div style={{ fontSize: 12.5, color: c.hint, marginBottom: 12 }}>
            Worked out {ago(lead.scored_at, ctx.now)} from {lead.factors?.events_seen ?? 0} thing{(lead.factors?.events_seen ?? 0) === 1 ? "" : "s"} this person did.
            {next ? ` ${next.need} more point${next.need === 1 ? "" : "s"} to reach "${next.label}".` : ""}
          </div>
          {factors.length === 0 ? (
            <div style={{ fontSize: 13, color: c.muted }}>Nothing has added points yet. The score rises as this person opens quotes, clicks emails, fills in forms or visits the website.</div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {factors.map((f, i) => (
                <li key={`${f.label}-${i}`} style={{ display: "flex", justifyContent: "space-between", gap: 14, padding: "9px 0", borderTop: i === 0 ? "none" : `1px solid ${c.line}` }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: c.ink }}>{f.label}</div>
                    <div style={{ fontSize: 12, color: c.hint, marginTop: 2 }}>{KIND_WORDS[(f as { kind?: string }).kind ?? ""] ?? "Other"} · {f.detail}</div>
                  </div>
                  <div style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, color: f.points < 0 ? statusInk.bad : statusInk.good, whiteSpace: "nowrap" }}>
                    {f.points > 0 ? "+" : ""}{f.points}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );

  const aboutCard = (
    <Card title="About this lead">
      <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "max-content 1fr", gap: "8px 18px", fontSize: 13 }}>
        <dt style={{ color: c.hint }}>Company</dt>
        <dd style={{ margin: 0 }}><Link href={ROUTES.account(lead.account_id)} style={{ color: c.accent }}>{account?.name ?? lead.account_name}</Link>{account?.industry ? ` · ${account.industry}` : ""}</dd>
        <dt style={{ color: c.hint }}>Person{!(lead.contact_id && contact) && <InfoTip label="Person">{LEAD_SCORE_TIPS.person}</InfoTip>}</dt>
        <dd style={{ margin: 0 }}>
          {lead.contact_id && contact ? <><Link href={ROUTES.contact(lead.contact_id)} style={{ color: c.accent }}>{contact.name}</Link>{contact.role ? ` · ${contact.role}` : ""}</> : <span style={{ color: c.muted }}>Not named</span>}
        </dd>
        <dt style={{ color: c.hint }}>Where</dt>
        <dd style={{ margin: 0 }}>{[account?.city, account?.country].filter(Boolean).join(", ") || "—"}</dd>
        <dt style={{ color: c.hint }}>Came from</dt>
        <dd style={{ margin: 0 }}>{lead.source ?? "—"}</dd>
        <dt style={{ color: c.hint }}>Added</dt>
        <dd style={{ margin: 0 }}>{fmtWhen(lead.created_at)}</dd>
      </dl>
    </Card>
  );

  const timelineCard = (
    <Card title="What they did">
      {timeline.length === 0 ? (
        <EmptyState title="Nothing recorded yet" text="Every click, quote opening and form fill by this person appears here, newest first." />
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {timeline.map((e, i) => {
            const extra = eventDetail(e.name, e.payload);
            return (
              <li key={e.id} style={{ display: "flex", justifyContent: "space-between", gap: 14, padding: "9px 0", borderTop: i === 0 ? "none" : `1px solid ${c.line}`, fontSize: 13 }}>
                <span style={{ color: c.ink }}>{eventWords(e.name)}{extra ? <span style={{ color: c.hint }}> · {extra}</span> : null}</span>
                <span style={{ color: c.hint, whiteSpace: "nowrap", fontSize: 12 }}>{fmtWhen(e.occurred_at)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );

  return (
    <ObjectRecordPage
      backHref={ROUTES.marketingLeads}
      backLabel="All scored leads"
      title={lead.title ?? "Untitled lead"}
      meta={[lead.account_name, lead.contact_name].filter(Boolean).join(" · ")}
      status={<StagePill stage={lead.stage} />}
      primaryAction={lead.stage === "ready" ? <AcceptButton leadId={lead.id} /> : undefined}
      facts={[
        { label: "Score", value: <ScoreMeter score={lead.score} thresholds={thresholds} width={70} /> },
        { label: "Lead stage", value: stageDefOf(lead.stage).label },
        { label: "Owner", value: ownerLabel },
        { label: "Respond by", value: lead.stage === "ready" ? <DueChip stage={lead.stage} slaDueAt={lead.sla_due_at} now={ctx.now} /> : "—" },
      ]}
      basePath={basePath}
      activeTab={tab}
      tabs={[
        { id: "overview", label: "Overview", content: <>{scoreCard}{aboutCard}</> },
        { id: "timeline", label: "Timeline", count: timeline.length, content: timelineCard },
        { id: "activity", label: "Activity", content: <RecordActivity objectType="leads" objectId={lead.id} isAdmin={ctx.role === "admin"} /> },
      ]}
      rail={
        <>
          <SourceEmailSlot objectType="leads" objectId={lead.id} />
          <Card title="Lead stage and owner" padding={14}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <StageControl leadId={lead.id} stage={lead.stage} />
              <OwnerControl
                leadId={lead.id}
                ownerId={lead.owner_user_id}
                me={ctx.userId}
                people={people.map((p) => ({ user_id: p.user_id, label: personLabel(p) }))}
              />
            </div>
          </Card>
          {(lead.stage === "ready" || lead.assignment_reason) && (
            <Card title="Hand-over" padding={14}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5, color: c.muted }}>
                {lead.stage === "ready" && dueText && <div>Respond {dueText}.</div>}
                <AssignmentChip reason={lead.assignment_reason} />
              </div>
            </Card>
          )}
        </>
      }
    />
  );
}
