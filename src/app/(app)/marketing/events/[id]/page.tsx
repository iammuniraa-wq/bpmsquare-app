import { notFound } from "next/navigation";
import { c } from "@/lib/theme";
import { ROUTES, tenantOrigin } from "@/lib/constants";
import ObjectRecordPage from "@/components/page/ObjectRecordPage";
import RecordMoreMenu from "@/components/page/RecordMoreMenu";
import RecordActionButton from "@/components/page/recordActions";
import PageHeader from "@/components/PageHeader";
import StatusPill from "@/components/ui/StatusPill";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { pendingMessage } from "@/lib/marketing/moduleAccess";
import { EVENTS_SPEC, listAttendees, loadEvent, loadResults } from "@/lib/marketing/events/server";
import { FOLLOW_UP_LABEL, KIND_LABEL, STATUS_LABEL, localInputs, resultsSentence } from "@/lib/marketing/events/rules";
import EventForm from "../EventForm";
import { eventsPage } from "../pageData";
import { formPickers } from "../pickers";
import AttendeesPanel from "./AttendeesPanel";
import FollowUpPanel from "./FollowUpPanel";

const TONE = { draft: "purple", open: "green", closed: "amber", completed: "blue", cancelled: "red" } as const;

export default async function EventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ctx = await eventsPage();
  const { id } = await params;
  const { tab } = await searchParams;

  const r = await loadEvent(ctx, id);
  if (r.missing) return <><PageHeader title="Events" /><Card padding={0}><EmptyState title="Events are waiting for a database update" text={pendingMessage(EVENTS_SPEC)} /></Card></>;
  // Another workspace's event answers exactly like a missing one.
  if (!r.data) notFound();
  const ev = r.data;
  const tz = ctx.tenant.timezone;

  const [attendees, results, pickers] = await Promise.all([listAttendees(ctx, ev.id), loadResults(ctx, ev), formPickers(ctx)]);
  const started = Date.parse(ev.starts_at) <= Date.now();
  const start = localInputs(ev.starts_at, tz);
  const end = localInputs(ev.ends_at, tz);
  const basePath = ROUTES.marketingEvent(ev.id);

  // Registration form address and the chosen journey, loaded by id AND this workspace.
  const [{ data: form }, { data: journey }] = await Promise.all([
    ev.form_id ? ctx.supabase.from("forms").select("id, name, slug, status").eq("id", ev.form_id).eq("tenant_id", ctx.tenantId).maybeSingle() : Promise.resolve({ data: null }),
    ev.follow_up_journey_id ? ctx.supabase.from("journeys").select("id, name, status").eq("id", ev.follow_up_journey_id).eq("tenant_id", ctx.tenantId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const f = form as { name: string; slug: string; status: string } | null;
  const j = journey as { id: string; name: string; status: string } | null;
  const origin = ctx.tenant.customDomain || ctx.tenant.isDemo ? tenantOrigin(ctx.tenant.customDomain) : "";

  const forCount = await ctx.supabase.from("event_registrations").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).eq("event_id", ev.id).eq("status", ev.follow_up_on);
  const startedCount = await ctx.supabase.from("event_registrations").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).eq("event_id", ev.id).eq("status", ev.follow_up_on).not("follow_up_started_at", "is", null);

  const primary = ev.status === "draft" ? { label: "Open registration", status: "open" } : ev.status === "open" ? { label: "Close registration", status: "closed" } : ev.status === "closed" ? { label: "Mark completed", status: "completed" } : null;
  const dateText = `${new Date(`${start.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}, ${start.time}${end.time ? ` to ${end.time}` : ""}`;

  return (
    <ObjectRecordPage
      backHref={ROUTES.marketingEvents}
      backLabel="All events"
      title={ev.name}
      reference={ev.ref}
      meta={KIND_LABEL[ev.kind]}
      status={<StatusPill label={STATUS_LABEL[ev.status]} tone={TONE[ev.status]} />}
      primaryAction={primary && ctx.can.edit ? <RecordActionButton action={{ label: primary.label, endpoint: `/api/marketing-events/${ev.id}`, method: "PATCH", body: { status: primary.status }, successText: "Updated" }} /> : undefined}
      menu={
        <RecordMoreMenu
          actions={[
            { label: "Cancel the event", endpoint: `/api/marketing-events/${ev.id}`, method: "PATCH", body: { status: "cancelled" }, hidden: ev.status === "cancelled" || !ctx.can.edit, confirm: { title: `Cancel "${ev.name}"?`, body: "Registration stops. The people who registered stay on the list." }, successText: "Cancelled" },
            { label: "Mark completed", endpoint: `/api/marketing-events/${ev.id}`, method: "PATCH", body: { status: "completed" }, hidden: ev.status === "completed" || ev.status === "cancelled" || !ctx.can.edit, successText: "Marked completed" },
          ]}
          remove={ctx.can.delete ? { endpoint: `/api/marketing-events/${ev.id}`, recordName: ev.name, entityLabel: "event", afterHref: ROUTES.marketingEvents, confirmBody: "An event people registered for is cancelled instead, so the list stays. You'll have a few seconds to undo." } : undefined}
        />
      }
      facts={[
        { label: "When", value: dateText },
        { label: "Where", value: ev.venue || (ev.kind === "webinar" ? "Online" : "—") },
        { label: "Registered", value: <>{results.registered}{ev.capacity ? ` of ${ev.capacity}` : ""}{results.over > 0 && <div style={{ fontSize: 11.5, fontWeight: 400, color: "var(--amberink)" }}>{results.over} over capacity</div>}</> },
        { label: "Came", value: <>{results.attended}<div style={{ fontSize: 11.5, fontWeight: 400, color: c.muted }}>{results.showRate === null ? "no show rate yet" : `${results.showRate}% show rate`}</div></> },
      ]}
      basePath={basePath}
      activeTab={tab}
      tabs={[
        {
          id: "details", label: "Details",
          content: (
            <div style={{ display: "grid", gap: 14 }}>
              {ev.link && <Card padding={14}><div style={{ fontSize: 13 }}><b>Link.</b> <a href={ev.link} target="_blank" rel="noopener noreferrer" style={{ color: c.accent, overflowWrap: "anywhere" }}>{ev.link}</a></div></Card>}
              {f && (
                <Card padding={14}>
                  <div style={{ fontSize: 13, overflowWrap: "anywhere" }}>
                    <b>Registration page.</b> {f.status === "live" && origin ? `${origin}/f/${f.slug}` : `The form “${f.name}” is ${f.status === "live" ? "live" : "not live yet"}${f.status === "live" ? "." : ", so nobody can register through it."}`}
                    {ev.status !== "open" && <span style={{ color: c.muted }}> Registration is {STATUS_LABEL[ev.status].toLowerCase()}, so a submission does not register anyone.</span>}
                  </div>
                </Card>
              )}
              <EventForm
                mode="edit" id={ev.id} canEdit={ctx.can.edit} timezone={tz} forms={pickers.forms} journeys={pickers.journeys} members={pickers.members}
                initial={{
                  name: ev.name, kind: ev.kind, status: ev.status, date: start.date, time: start.time, end_time: end.time, venue: ev.venue ?? "", link: ev.link ?? "",
                  capacity: ev.capacity ? String(ev.capacity) : "", description: ev.description ?? "", form_id: ev.form_id ?? "", follow_up_journey_id: ev.follow_up_journey_id ?? "",
                  follow_up_on: ev.follow_up_on, owner_user_id: ev.owner_user_id ?? ctx.userId,
                }}
              />
            </div>
          ),
        },
        {
          id: "attendees", label: "Attendees", count: attendees.total,
          content: (
            <AttendeesPanel
              eventId={ev.id} canEdit={ctx.can.edit} started={started} cancelled={ev.status === "cancelled"} total={attendees.total}
              rows={attendees.rows.map((a) => ({ id: a.id, name: a.name, company: a.company, status: a.status, source: a.source, registeredAt: a.registeredAt, checkedInAt: a.checkedInAt, ownerName: a.ownerName }))}
            />
          ),
        },
        {
          id: "followup", label: "Follow-up",
          content: <FollowUpPanel eventId={ev.id} journey={j} forLabel={FOLLOW_UP_LABEL[ev.follow_up_on]} count={forCount.count ?? 0} started={startedCount.count ?? 0} canEdit={ctx.can.edit} />,
        },
        {
          id: "results", label: "Results",
          content: (
            <Card title="Did it work?" padding={16}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
                {([["Registered", results.registered], ["Came", results.attended], ["Did not come", results.noShow], ["Not marked yet", results.waiting], ["Cancelled", results.cancelled]] as const).map(([label, n]) => (
                  <div key={label} style={{ background: c.panel2, borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: c.ink }}>{n}</div>
                    <div style={{ fontSize: 11.5, color: c.muted }}>{label}</div>
                  </div>
                ))}
                <div style={{ background: c.panel2, borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: c.ink }}>{results.showRate === null ? "—" : `${results.showRate}%`}</div>
                  <div style={{ fontSize: 11.5, color: c.muted }}>Show rate</div>
                </div>
              </div>
              <div style={{ fontSize: 13, marginTop: 12 }}>{resultsSentence(results, ev.status === "completed" || ev.status === "cancelled")}</div>
              {results.capacity !== null && <div style={{ fontSize: 12.5, color: c.muted, marginTop: 6 }}>Capacity {results.capacity}: {results.over > 0 ? `${results.over} over.` : `${Math.max(0, results.capacity - results.registered)} places left.`}</div>}
              <div style={{ fontSize: 12, color: c.hint, marginTop: 8 }}>The show rate is people who came out of everyone marked either way. The revenue that events help start is on Revenue by campaign.</div>
            </Card>
          ),
        },
      ]}
    />
  );
}
