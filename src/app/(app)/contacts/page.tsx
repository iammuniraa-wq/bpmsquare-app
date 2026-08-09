import { requireFeature } from "@/lib/tenant";
import Link from "next/link";
import { listContacts } from "@/lib/data";
import { c } from "@/lib/theme";
import PageHeader from "@/components/PageHeader";
import { ROUTES } from "@/lib/constants";
import ContactsTable from "@/components/ContactsTable";
import ListFilterBar from "@/components/ListFilterBar";
import { requireWorkcenterView } from "@/lib/permissions";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireWorkcenterView("contacts");
  await requireFeature("contacts");
  const { q } = await searchParams;
  const allRows = await listContacts();

  const rows = allRows.filter(({ contact, account }) => {
    if (!q) return true;
    const term = q.toLowerCase();
    return (
      contact.name.toLowerCase().includes(term) ||
      (contact.role ?? "").toLowerCase().includes(term) ||
      account.name.toLowerCase().includes(term)
    );
  });

  return (
    <>
      <PageHeader
        title="Contacts"
        subtitle={`${allRows.length} people across all accounts`}
        action={
          <Link
            href={ROUTES.contactNew}
            style={{
              padding: "7px 15px", borderRadius: 7, fontSize: 13, fontWeight: 600,
              background: `var(--modern-accent, ${c.accent})`, color: "#fff", textDecoration: "none",
            }}
          >
            + New Contact
          </Link>
        }
      />

      <ListFilterBar
        searchValue={q}
        searchPlaceholder="Search by name, role or account…"
        clearHref={ROUTES.contacts}
      />

      <ContactsTable rows={rows} />
    </>
  );
}
