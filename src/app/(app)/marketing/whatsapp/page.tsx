import Link from "next/link";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import PageHeader from "@/components/PageHeader";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import StatusPill from "@/components/ui/StatusPill";
import { pendingMessage } from "@/lib/marketing/moduleAccess";
import { WHATSAPP_SPEC, listTemplates, parseListParams, type ListedTemplate } from "@/lib/marketing/whatsapp/server";
import { CATEGORY_LABEL, STATUS_LABEL, type TemplateCategory, type TemplateStatus } from "@/lib/marketing/whatsapp/template";
import { whatsappPage } from "./pageData";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const TONE = { draft: "purple", approved: "green", rejected: "red", archived: "purple" } as const;

export default async function WhatsappPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const ctx = await whatsappPage();
  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") sp.set(k, v);
  const p = parseListParams(sp);

  const list = await listTemplates(ctx, p);
  if (list.missing) {
    return (
      <>
        <PageHeader title="WhatsApp" />
        <Card padding={0}><EmptyState title="WhatsApp is waiting for a database update" text={pendingMessage(WHATSAPP_SPEC)} /></Card>
      </>
    );
  }

  const href = (status: string | null) => {
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (p.q) q.set("q", p.q);
    const s = q.toString();
    return s ? `${ROUTES.marketingWhatsapp}?${s}` : ROUTES.marketingWhatsapp;
  };
  const chips = [
    { id: "open", label: "Open", href: href(null), active: !p.status },
    { id: "approved", label: "Approved", href: href("approved"), active: p.status === "approved" },
    { id: "draft", label: "Draft", href: href("draft"), active: p.status === "draft" },
    { id: "archived", label: "Archived", href: href("archived"), active: p.status === "archived" },
  ];

  const COLUMNS: ListColumn<ListedTemplate>[] = [
    { id: "ref", label: "ID", width: 88, card: "hidden", cellStyle: { fontFamily: MONO, fontSize: 11.5, color: c.hint, whiteSpace: "nowrap" }, render: (t) => t.ref ?? "—" },
    { id: "name", label: "Name", card: "title", render: (t) => <Link href={ROUTES.marketingWhatsappTemplate(t.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none", fontSize: 13.5 }}>{t.name}</Link> },
    { id: "language", label: "Language", cellStyle: { color: c.muted, fontSize: 13 }, render: (t) => t.language.toUpperCase() },
    { id: "category", label: "Kind", cellStyle: { color: c.muted, fontSize: 13 }, render: (t) => (CATEGORY_LABEL[t.category as TemplateCategory] ?? t.category).split(" (")[0] },
    { id: "status", label: "Status", render: (t) => <StatusPill label={STATUS_LABEL[t.status as TemplateStatus] ?? t.status} tone={TONE[t.status as TemplateStatus] ?? "purple"} /> },
    { id: "sent", label: "Messages", cellStyle: { color: c.muted, fontSize: 13 }, render: (t) => String(t.sent) },
    { id: "updated_at", label: "Updated", cellStyle: { color: c.muted, fontSize: 13, whiteSpace: "nowrap" }, render: (t) => fmtDate(t.updated_at) },
  ];

  return (
    <ObjectListPage
      title="WhatsApp"
      subtitle={`${list.total} template${list.total === 1 ? "" : "s"}`}
      newLabel="Template"
      newHref={ctx.can.create ? ROUTES.marketingWhatsappNew : undefined}
      menuItems={[{ label: "Number and messages", href: ROUTES.marketingWhatsappSetup }]}
      chips={chips}
      search={{ value: p.q || undefined, placeholder: "Search by name or ID…", hiddenParams: { status: p.status ?? undefined } }}
      columns={COLUMNS}
      columnSearch={false}
      rows={list.rows}
      rowKey={(t) => t.id}
      rowHref={(t) => ROUTES.marketingWhatsappTemplate(t.id)}
      total={list.total}
      page={p.page}
      pageSize={p.page_size}
      baseHref={ROUTES.marketingWhatsapp}
      linkParams={{ q: p.q || undefined, status: p.status ?? undefined }}
      filtered={!!p.q}
      empty={{
        title: "No WhatsApp templates yet",
        text: "A template is the approved message WhatsApp lets you start a conversation with. Write one, mark it approved, and a journey or a person can send it to anyone who agreed to hear from you on WhatsApp.",
        filteredTitle: `No templates match "${p.q}".`,
      }}
    />
  );
}
