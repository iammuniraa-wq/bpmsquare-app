import Link from "next/link";
import { listContacts } from "@/lib/data";
import { c } from "@/lib/theme";
import PageHeader from "@/components/PageHeader";
import { ROUTES } from "@/lib/constants";
import ContactsTable from "@/components/ContactsTable";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
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
              background: c.accent, color: "#fff", textDecoration: "none",
            }}
          >
            + New Contact
          </Link>
        }
      />

      {/* Search */}
      <form method="GET" style={{ marginBottom: 12 }}>
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by name, role or account…"
          autoComplete="off"
          style={{
            width: "100%", maxWidth: 380, padding: "7px 12px", borderRadius: 7,
            border: `1px solid ${c.line}`, fontSize: 13, color: c.ink,
            background: "#fff", outline: "none",
          }}
        />
        {q && (
          <Link href={ROUTES.contacts} style={{ marginLeft: 10, fontSize: 12, color: c.hint, textDecoration: "none" }}>
            Clear ✕
          </Link>
        )}
      </form>

      <ContactsTable rows={rows} />
    </>
  );
}
