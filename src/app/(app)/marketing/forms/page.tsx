import Link from "next/link";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import PageHeader from "@/components/PageHeader";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { PENDING_MESSAGE, listForms, parseFormListParams, type ListedForm } from "@/lib/marketing/forms/server";
import { formsPage } from "./pageData";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const STATUS: Record<string, string> = { draft: "Draft", live: "Live", archived: "Archived" };

export default async function FormsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const ctx = await formsPage();
  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") sp.set(k, v);
  const p = parseFormListParams(sp);

  const list = await listForms(ctx, p);
  if (list.missing) {
    return (
      <>
        <PageHeader title="Forms" />
        <Card padding={0}><EmptyState title="Forms are waiting for a database update" text={PENDING_MESSAGE} /></Card>
      </>
    );
  }

  const href = (status: string | null) => {
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (p.q) q.set("q", p.q);
    const s = q.toString();
    return s ? `${ROUTES.marketingForms}?${s}` : ROUTES.marketingForms;
  };
  const chips = [
    { id: "open", label: "Open", href: href(null), active: !p.status },
    { id: "live", label: "Live", href: href("live"), active: p.status === "live" },
    { id: "archived", label: "Archived", href: href("archived"), active: p.status === "archived" },
  ];

  const COLUMNS: ListColumn<ListedForm>[] = [
    { id: "ref", label: "ID", width: 88, card: "hidden", cellStyle: { fontFamily: MONO, fontSize: 11.5, color: c.hint, whiteSpace: "nowrap" }, render: (f) => f.ref ?? "—" },
    { id: "name", label: "Name", card: "title", render: (f) => <Link href={ROUTES.marketingForm(f.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none", fontSize: 13.5 }}>{f.name}</Link> },
    { id: "slug", label: "Address", cellStyle: { color: c.muted, fontSize: 13 }, render: (f) => `/f/${f.slug}` },
    { id: "status", label: "Status", cellStyle: { color: c.muted, fontSize: 13 }, render: (f) => STATUS[f.status] ?? f.status },
    { id: "submissions", label: "Answers", cellStyle: { color: c.muted, fontSize: 13 }, render: (f) => String(f.submissions) },
    { id: "last", label: "Last answer", cellStyle: { color: c.muted, fontSize: 13, whiteSpace: "nowrap" }, render: (f) => (f.last_submitted ? fmtDate(f.last_submitted) : "—") },
    { id: "updated_at", label: "Updated", cellStyle: { color: c.muted, fontSize: 13, whiteSpace: "nowrap" }, render: (f) => fmtDate(f.updated_at) },
  ];

  return (
    <ObjectListPage
      title="Forms"
      subtitle={`${list.total} form${list.total === 1 ? "" : "s"}`}
      newLabel="Form"
      newHref={ROUTES.marketingFormNew}
      chips={chips}
      search={{ value: p.q || undefined, placeholder: "Search by name, ID or address…", hiddenParams: { status: p.status ?? undefined } }}
      columns={COLUMNS}
      columnSearch={false}
      rows={list.rows}
      rowKey={(f) => f.id}
      rowHref={(f) => ROUTES.marketingForm(f.id)}
      total={list.total}
      page={p.page}
      pageSize={p.page_size}
      baseHref={ROUTES.marketingForms}
      linkParams={{ q: p.q || undefined, status: p.status ?? undefined }}
      filtered={!!p.q}
      empty={{
        title: "No forms yet",
        text: "Make a contact form, put it on your website, and every enquiry arrives as a contact and a lead with the visitor's consent recorded.",
        filteredTitle: `No forms match "${p.q}".`,
      }}
    />
  );
}
