import Link from "next/link";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import PageHeader from "@/components/PageHeader";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { journeyPage, PENDING_MESSAGE } from "@/lib/marketing/journeys/access";
import { triggerLabel } from "@/lib/marketing/journeys/definition";
import { listJourneyRows } from "@/lib/marketing/journeys/store";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const STATUS: Record<string, string> = { draft: "Draft", live: "On", paused: "Paused", archived: "Archived" };

type Row = { id: string; ref: string | null; name: string; status: string; when: string; people: number; sent: number; updated_at: string };

export default async function JourneysPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const ctx = await journeyPage("view");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const showArchived = sp.status === "archived";

  const list = await listJourneyRows(ctx.admin, ctx.tenantId);
  if (list.missing) {
    return (
      <>
        <PageHeader title="Journeys" />
        <Card padding={0}><EmptyState title="Journeys are waiting for a database update" text={PENDING_MESSAGE} /></Card>
      </>
    );
  }

  // People in each journey and emails sent this month, from the rows the runner writes.
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const [runs, steps] = await Promise.all([
    ctx.admin.from("journey_runs").select("journey_id").eq("tenant_id", ctx.tenantId).limit(20000),
    ctx.admin.from("journey_run_steps").select("journey_id").eq("tenant_id", ctx.tenantId).eq("sent", true).gte("at", monthStart.toISOString()).limit(20000),
  ]);
  const count = (data: unknown): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of ((data ?? []) as { journey_id: string }[])) m.set(r.journey_id, (m.get(r.journey_id) ?? 0) + 1);
    return m;
  };
  const people = runs.error ? new Map<string, number>() : count(runs.data);
  const sent = steps.error ? new Map<string, number>() : count(steps.data);

  const rows: Row[] = list.rows
    .filter((j) => (showArchived ? j.status === "archived" : j.status !== "archived"))
    .filter((j) => !q || j.name.toLowerCase().includes(q) || (j.ref ?? "").toLowerCase().includes(q))
    .map((j) => ({ id: j.id, ref: j.ref, name: j.name, status: j.status, when: triggerLabel(j.definition.trigger.event), people: people.get(j.id) ?? 0, sent: sent.get(j.id) ?? 0, updated_at: j.updated_at }));

  const chips = [
    { id: "active", label: "Journeys", href: ROUTES.marketingJourneys, active: !showArchived },
    { id: "archived", label: "Archived", href: `${ROUTES.marketingJourneys}?status=archived`, active: showArchived },
  ];

  const COLUMNS: ListColumn<Row>[] = [
    { id: "ref", label: "ID", width: 88, card: "hidden", cellStyle: { fontFamily: MONO, fontSize: 11.5, color: c.hint, whiteSpace: "nowrap" }, render: (j) => j.ref ?? "—" },
    { id: "name", label: "Name", card: "title", render: (j) => <Link href={ROUTES.marketingJourney(j.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none", fontSize: 13.5 }}>{j.name}</Link> },
    { id: "when", label: "When it starts", cellStyle: { color: c.muted, fontSize: 13 }, render: (j) => j.when },
    { id: "status", label: "Status", cellStyle: { color: c.muted, fontSize: 13 }, render: (j) => STATUS[j.status] ?? j.status },
    { id: "people", label: "People in it", cellStyle: { color: c.muted, fontSize: 13 }, render: (j) => String(j.people) },
    { id: "sent", label: "Sent this month", cellStyle: { color: c.muted, fontSize: 13 }, render: (j) => String(j.sent) },
    { id: "updated_at", label: "Updated", cellStyle: { color: c.muted, fontSize: 13, whiteSpace: "nowrap" }, render: (j) => fmtDate(j.updated_at) },
  ];

  return (
    <ObjectListPage
      title="Journeys"
      subtitle={`${rows.length} ${showArchived ? "archived" : `journey${rows.length === 1 ? "" : "s"}`}`}
      newLabel="Journey"
      newHref={ROUTES.marketingJourneyNew}
      chips={chips}
      search={{ value: q || undefined, placeholder: "Search by name or ID…", hiddenParams: { status: showArchived ? "archived" : undefined } }}
      columns={COLUMNS}
      columnSearch={false}
      rows={rows}
      rowKey={(j) => j.id}
      rowHref={(j) => ROUTES.marketingJourney(j.id)}
      total={rows.length}
      page={1}
      pageSize={Math.max(rows.length, 25)}
      baseHref={ROUTES.marketingJourneys}
      linkParams={{ q: q || undefined, status: showArchived ? "archived" : undefined }}
      filtered={!!q}
      empty={{
        title: showArchived ? "Nothing archived" : "No journeys yet",
        text: showArchived ? "A journey that has run is archived instead of deleted, so its log stays readable." : "Start with Quote follow-up: when a quote is sent, wait three days, send a newsletter and ask the owner to call.",
        filteredTitle: `No journeys match "${q}".`,
      }}
    />
  );
}
