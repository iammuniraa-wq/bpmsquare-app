import Link from "next/link";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import ObjectListPage, { type ListColumn, type ListChip } from "@/components/page/ObjectListPage";
import PageHeader from "@/components/PageHeader";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { parseListParams } from "@/lib/newsletter/requests";
import { PENDING_MESSAGE, listNewsletters, type ListedNewsletter } from "@/lib/newsletter/server";
import { languageDef } from "@/lib/newsletter/types";
import { studioPage } from "./pageData";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const STATUS: Record<string, string> = { draft: "Draft", ready: "Ready to use", archived: "Archived" };

/**
 * The Newsletters and Templates lists. Rendered inside Email (src/app/(app)/marketing/email) as two of its views; the old
 * /marketing/newsletters address redirects there. `view` is the Email tab that is open, `viewChips` the tab strip.
 */
export default async function DesignsList({ raw, template, viewChips }: { raw: Record<string, string | undefined>; template: boolean; viewChips: ListChip[] }) {
  const ctx = await studioPage();
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") sp.set(k, v);
  if (template) sp.set("template", "1"); else sp.delete("template");
  const p = parseListParams(sp);

  const list = await listNewsletters(ctx, p);
  if (list.missing) {
    return (
      <>
        <PageHeader title="Newsletters" />
        <Card padding={0}><EmptyState title="The Newsletter Studio is waiting for a database update" text={PENDING_MESSAGE} /></Card>
      </>
    );
  }


  const COLUMNS: ListColumn<ListedNewsletter>[] = [
    { id: "ref", label: "ID", width: 88, card: "hidden", cellStyle: { fontFamily: MONO, fontSize: 11.5, color: c.hint, whiteSpace: "nowrap" }, render: (n) => n.ref ?? "—" },
    { id: "name", label: "Name", card: "title", render: (n) => <Link href={ROUTES.marketingNewsletter(n.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none", fontSize: 13.5 }}>{n.name}</Link> },
    { id: "category", label: "Category", cellStyle: { color: c.muted, fontSize: 13 }, render: (n) => n.category },
    { id: "languages", label: "Languages", cellStyle: { color: c.muted, fontSize: 13 }, render: (n) => n.languages.map((l) => languageDef(l)?.name ?? l).join(", ") || "—" },
    { id: "status", label: "Status", cellStyle: { color: c.muted, fontSize: 13 }, render: (n) => STATUS[n.status] ?? n.status },
    { id: "updated_at", label: "Updated", cellStyle: { color: c.muted, fontSize: 13, whiteSpace: "nowrap" }, render: (n) => fmtDate(n.updated_at) },
  ];

  return (
    <ObjectListPage
      title="Newsletters"
      subtitle={`${list.total} ${p.template ? `template${list.total === 1 ? "" : "s"}` : `newsletter${list.total === 1 ? "" : "s"}`}`}
      newLabel="Newsletter"
      newHref={ROUTES.marketingNewsletterNew}
      chips={viewChips}
      search={{ value: p.q || undefined, placeholder: "Search by name or ID…", hiddenParams: { view: p.template ? "templates" : "designs" } }}
      columns={COLUMNS}
      columnSearch={false}
      rows={list.rows}
      rowKey={(n) => n.id}
      rowHref={(n) => ROUTES.marketingNewsletter(n.id)}
      total={list.total}
      page={p.page}
      pageSize={p.page_size}
      baseHref={ROUTES.marketingEmail}
      linkParams={{ q: p.q || undefined, view: p.template ? "templates" : "designs" }}
      filtered={!!p.q}
      empty={{
        title: p.template ? "No templates yet" : "No newsletters yet",
        text: p.template ? "Open a newsletter and choose Save as template to keep a design to start from." : "Write one line about this issue and let the studio draft it, or start from a design.",
        filteredTitle: `No ${p.template ? "templates" : "newsletters"} match "${p.q}".`,
      }}
    />
  );
}
