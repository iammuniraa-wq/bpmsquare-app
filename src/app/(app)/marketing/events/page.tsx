import Link from "next/link";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import PageHeader from "@/components/PageHeader";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import StatusPill from "@/components/ui/StatusPill";
import { pendingMessage } from "@/lib/marketing/moduleAccess";
import { EVENTS_SPEC, listEvents, parseListParams, type ListedEvent } from "@/lib/marketing/events/server";
import { KIND_LABEL, STATUS_LABEL, localInputs } from "@/lib/marketing/events/rules";
import { eventsPage } from "./pageData";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const TONE = { draft: "purple", open: "green", closed: "amber", completed: "blue", cancelled: "red" } as const;

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const ctx = await eventsPage();
  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") sp.set(k, v);
  const p = parseListParams(sp);

  const list = await listEvents(ctx, p);
  if (list.missing) {
    return (
      <>
        <PageHeader title="Events" />
        <Card padding={0}><EmptyState title="Events are waiting for a database update" text={pendingMessage(EVENTS_SPEC)} /></Card>
      </>
    );
  }

  const href = (status: string | null) => {
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (p.q) q.set("q", p.q);
    const s = q.toString();
    return s ? `${ROUTES.marketingEvents}?${s}` : ROUTES.marketingEvents;
  };
  const chips = [
    { id: "all", label: "All", href: href(null), active: !p.status },
    { id: "open", label: "Registration open", href: href("open"), active: p.status === "open" },
    { id: "draft", label: "Draft", href: href("draft"), active: p.status === "draft" },
    { id: "completed", label: "Completed", href: href("completed"), active: p.status === "completed" },
  ];
  const when = (iso: string) => { const l = localInputs(iso, ctx.tenant.timezone); return `${new Date(`${l.date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}, ${l.time}`; };

  const COLUMNS: ListColumn<ListedEvent>[] = [
    { id: "ref", label: "ID", width: 88, card: "hidden", cellStyle: { fontFamily: MONO, fontSize: 11.5, color: c.hint, whiteSpace: "nowrap" }, render: (e) => e.ref ?? "—" },
    { id: "name", label: "Name", card: "title", render: (e) => <Link href={ROUTES.marketingEvent(e.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none", fontSize: 13.5 }}>{e.name}</Link> },
    { id: "kind", label: "Kind", cellStyle: { color: c.muted, fontSize: 13 }, render: (e) => KIND_LABEL[e.kind] },
    { id: "when", label: "When", cellStyle: { color: c.muted, fontSize: 13, whiteSpace: "nowrap" }, render: (e) => when(e.starts_at) },
    { id: "venue", label: "Where", cellStyle: { color: c.muted, fontSize: 13 }, render: (e) => e.venue || (e.kind === "webinar" ? "Online" : "—") },
    { id: "registered", label: "Registered", cellStyle: { color: c.muted, fontSize: 13 }, render: (e) => (e.capacity ? `${e.registered} of ${e.capacity}` : String(e.registered)) },
    { id: "attended", label: "Came", cellStyle: { color: c.muted, fontSize: 13 }, render: (e) => String(e.attended) },
    { id: "status", label: "Status", render: (e) => <StatusPill label={STATUS_LABEL[e.status]} tone={TONE[e.status]} /> },
  ];

  return (
    <ObjectListPage
      title="Events"
      subtitle={`${list.total} event${list.total === 1 ? "" : "s"}`}
      newLabel="Event"
      newHref={ctx.can.create ? ROUTES.marketingEventNew : undefined}
      chips={chips}
      search={{ value: p.q || undefined, placeholder: "Search by name, ID or place…", hiddenParams: { status: p.status ?? undefined } }}
      columns={COLUMNS}
      columnSearch={false}
      rows={list.rows}
      rowKey={(e) => e.id}
      rowHref={(e) => ROUTES.marketingEvent(e.id)}
      total={list.total}
      page={p.page}
      pageSize={p.page_size}
      baseHref={ROUTES.marketingEvents}
      linkParams={{ q: p.q || undefined, status: p.status ?? undefined }}
      filtered={!!p.q}
      empty={{
        title: "No events yet",
        text: "Plan a webinar, a show or a site visit, link a registration form to it, check people in on the day and see how many came.",
        filteredTitle: `No events match "${p.q}".`,
      }}
    />
  );
}
