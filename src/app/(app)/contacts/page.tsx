import { requireFeature, getTenant } from "@/lib/tenant";
import Link from "next/link";
import { listContacts } from "@/lib/data";
import type { Account, Contact } from "@/lib/types";
import { c, pillar, type PillarKey } from "@/lib/theme";
import StatusPill from "@/components/ui/StatusPill";
import ObjectListPage, { type ListColumn, type ListChip } from "@/components/page/ObjectListPage";
import { optionalColumnsMenu, parseOptionalCols, type OptionalColumn } from "@/components/page/optionalColumns";
import { Phone, Mail } from "@/components/Icons";
import { applyAdvancedFilter } from "@/lib/advancedFilter";
import { paginate } from "@/lib/paginate";
import { sortRows, readSortParams, applyColFilters, parseColFilterParams, colFilterQueryParams, type SortExtractor } from "@/lib/listSort";
import { ROUTES } from "@/lib/constants";
import { requireWorkcenterView } from "@/lib/permissions";
import { createAdminSupabase } from "@/lib/supabase-server";
import { emailHealthOn } from "@/lib/marketing/contactHealth";
import { loadAttention, ownerNames, type AttentionEntry } from "@/lib/marketing/attentionList";
import { EMAIL_STATUS_COPY } from "@/lib/marketing/emailHealth";

type Row = { contact: Contact; account: Account };

const ACCOUNT_TYPE_LABEL: Record<Account["type"], string> = {
  prospect: "Prospect", oem: "OEM", direct: "Direct", end_customer: "End customer",
};
const TYPE_TONE: Record<Account["type"], PillarKey> = {
  prospect: "amber", oem: "purple", direct: "blue", end_customer: "teal",
};

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const SORT_EXTRACTORS: Record<string, SortExtractor<Row>> = {
  ref: (r) => r.contact.ref,
  name: (r) => r.contact.name,
  account: (r) => r.account.name,
  role: (r) => r.contact.role,
  phone: (r) => r.contact.phone,
  email: (r) => r.contact.email,
  acct_type: (r) => r.account.type,
};

// Off until asked for (the old in-table "Columns" picker's defaults).
const OPTIONAL: OptionalColumn[] = [
  { id: "email", label: "Email" },
  { id: "acct_type", label: "Account type" },
];

const initials = (name: string) =>
  name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; af?: string; cols?: string; sort?: string; dir?: string; page?: string; view?: string } & Record<string, string | undefined>>;
}) {
  await requireWorkcenterView("contacts");
  await requireFeature("contacts");
  const params = await searchParams;
  const { q, af } = params;
  const colFilters = parseColFilterParams(params);
  const cfParams = colFilterQueryParams(colFilters);
  const { sort, dir } = readSortParams(params);
  const page = Math.max(1, Number(params.page) || 1);
  const shownOptional = parseOptionalCols(params.cols, OPTIONAL);

  const allRows = await listContacts();

  // Email health (Newsletter Studio): a second view of this same list -- the contacts whose
  // address bounced, was reported as spam, looks invalid or is having trouble.
  const tenant = await getTenant();
  const healthOn = emailHealthOn(tenant?.features);
  const attention: Map<string, AttentionEntry> | null = healthOn && tenant ? await loadAttention(createAdminSupabase(), tenant.id) : null;
  const view = attention && params.view === "email" ? "email" : undefined;
  const owners = view && tenant
    ? await ownerNames(createAdminSupabase(), tenant.id, allRows.filter((r) => attention?.has(r.contact.id)).map((r) => r.account.owner_user_id ?? ""))
    : new Map<string, string>();

  const basicFiltered = allRows.filter(({ contact, account }) => {
    if (view && !attention?.has(contact.id)) return false;
    if (!q) return true;
    const term = q.toLowerCase();
    return (
      contact.name.toLowerCase().includes(term) ||
      (contact.role ?? "").toLowerCase().includes(term) ||
      account.name.toLowerCase().includes(term)
    );
  });
  const advFiltered = applyAdvancedFilter(basicFiltered, af, ({ contact }) => contact as unknown as Record<string, unknown>);
  const colFiltered = applyColFilters(advFiltered, colFilters, SORT_EXTRACTORS);
  const filtered = sortRows(colFiltered, sort, dir, SORT_EXTRACTORS);
  const pageRows = paginate(filtered, page);

  const baseParams = { q, af, view, ...cfParams };
  const { colsParam, menuItems } = optionalColumnsMenu({ baseHref: ROUTES.contacts, optional: OPTIONAL, shown: shownOptional, linkParams: baseParams, sort, dir });
  const linkParams = { ...baseParams, cols: colsParam };

  const columns: ListColumn<Row>[] = [
    {
      id: "ref", label: "ID", sortKey: "ref", width: 88, card: "hidden",
      cellStyle: { fontFamily: MONO, fontSize: 11.5, color: c.hint, whiteSpace: "nowrap" },
      render: ({ contact }) => contact.ref ?? "—",
    },
    {
      id: "name", label: "Name", sortKey: "name", card: "title",
      render: ({ contact, account }) => {
        const p = pillar[TYPE_TONE[account.type]];
        return (
          <Link href={ROUTES.contact(contact.id)} style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
            <div style={{
              width: 30, height: 30, borderRadius: "50%", flexShrink: 0, background: p.bg, color: p.fg,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700,
            }}>
              {initials(contact.name)}
            </div>
            <span style={{ fontWeight: 600, fontSize: 13.5, color: c.ink }}>{contact.name}</span>
          </Link>
        );
      },
    },
    {
      id: "account", label: "Account", sortKey: "account",
      render: ({ account }) => (
        <Link href={ROUTES.account(account.id)} style={{ fontSize: 13, fontWeight: 500, color: c.accent, textDecoration: "none" }}>
          {account.name}
        </Link>
      ),
    },
    { id: "role", label: "Role", sortKey: "role", cellStyle: { color: c.muted }, render: ({ contact }) => contact.role ?? <span style={{ color: c.line }}>—</span> },
    {
      id: "phone", label: "Phone", sortKey: "phone",
      render: ({ contact }) => contact.phone
        ? <a href={`tel:${contact.phone}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, color: c.muted, textDecoration: "none", fontSize: 13 }}><Phone size={11} color={c.hint} />{contact.phone}</a>
        : <span style={{ color: c.line }}>—</span>,
    },
    ...(shownOptional.has("email") ? [{
      id: "email", label: "Email", sortKey: "email",
      render: ({ contact }: Row) => contact.email
        ? <a href={`mailto:${contact.email}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, color: c.accent, textDecoration: "none", fontSize: 13 }}><Mail size={11} color={c.accent} />{contact.email}</a>
        : <span style={{ color: c.line }}>—</span>,
    }] : []),
    ...(shownOptional.has("acct_type") ? [{
      id: "acct_type", label: "Account type", sortKey: "acct_type",
      render: ({ account }: Row) => <StatusPill label={ACCOUNT_TYPE_LABEL[account.type]} tone={TYPE_TONE[account.type]} />,
    }] : []),
  ];

  const hasFilter = !!(q || af || Object.keys(cfParams).length > 0);

  const chips: ListChip[] | undefined = attention ? [
    { id: "all", label: "All contacts", href: ROUTES.contacts, active: !view },
    { id: "email", label: `Email needs attention (${attention.size})`, href: `${ROUTES.contacts}?view=email`, active: view === "email" },
  ] : undefined;

  const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
  const healthColumns: ListColumn<Row>[] = view ? [
    {
      id: "email_status", label: "Email status",
      render: ({ contact }) => {
        const a = attention?.get(contact.id);
        return a ? <StatusPill label={EMAIL_STATUS_COPY[a.status].label} tone={EMAIL_STATUS_COPY[a.status].tone} /> : <span style={{ color: c.line }}>—</span>;
      },
    },
    { id: "since", label: "Since", cellStyle: { color: c.muted, whiteSpace: "nowrap", fontSize: 12.5 }, render: ({ contact }) => fmtDate(attention?.get(contact.id)?.at ?? null) },
    { id: "owner", label: "Account owner", cellStyle: { color: c.muted }, render: ({ account }) => (account.owner_user_id && owners.get(account.owner_user_id)) || <span style={{ color: c.line }}>Nobody yet</span> },
  ] : [];

  return (
    <ObjectListPage
      title="Contacts"
      subtitle={`${allRows.length} people across all accounts`}
      newLabel="Contact"
      newHref={ROUTES.contactNew}
      menuItems={menuItems}
      search={{
        value: q,
        placeholder: "Search by name, role or account…",
        hiddenParams: { af, view, cols: colsParam, ...cfParams },
      }}
      advancedFilterObject="contact"
      chips={chips}
      columns={[...columns, ...healthColumns]}
      rows={pageRows}
      rowKey={({ contact }) => contact.id}
      rowHref={({ contact }) => ROUTES.contact(contact.id)}
      total={filtered.length}
      page={page}
      baseHref={ROUTES.contacts}
      sort={sort}
      dir={dir}
      linkParams={linkParams}
      filtered={hasFilter || !!view}
      empty={{
        title: "No contacts yet",
        text: "Contacts are the people at your accounts. Add the first one to start.",
        filteredTitle: q ? `No contacts match "${q}".` : view ? "No contact has an email problem right now." : "No contacts match these filters.",
      }}
    />
  );
}
