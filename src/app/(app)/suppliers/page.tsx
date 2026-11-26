import { getTenant, requireFeature } from "@/lib/tenant";
import Link from "next/link";
import { requireTenantUser } from "@/lib/supabase-server";
import type { Supplier } from "@/lib/types";
import { c } from "@/lib/theme";
import StatusPill from "@/components/ui/StatusPill";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import { applyAdvancedFilter } from "@/lib/advancedFilter";
import { paginate } from "@/lib/paginate";
import { sortRows, readSortParams, applyColFilters, parseColFilterParams, colFilterQueryParams, type SortExtractor } from "@/lib/listSort";
import { ROUTES } from "@/lib/constants";
import { requireWorkcenterView } from "@/lib/permissions";
import { SupplierCheckChip } from "@/components/suppliers/supplierCheckUi";
import { readSummaries } from "@/lib/suppliers/check/service";
import { VERDICT_LABEL, type CheckSummary } from "@/lib/suppliers/check/types";

const TYPE_LABEL: Record<Supplier["type"], string> = {
  vendor: "Vendor", subcontractor: "Subcontractor", both: "Vendor & Sub",
};

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

type Row = Supplier & { check: CheckSummary | null };

const SORT_EXTRACTORS: Record<string, SortExtractor<Row>> = {
  ref: (s) => s.ref,
  name: (s) => s.name,
  type: (s) => s.type,
  city: (s) => s.city,
  phone: (s) => s.phone,
  gstin: (s) => s.gstin,
  status: (s) => s.status,
  rating: (s) => s.check?.rating ?? null,
  check: (s) => (s.check ? VERDICT_LABEL[s.check.verdict] : null),
  created_at: (s) => s.created_at,
};

const COLUMNS: ListColumn<Row>[] = [
  {
    id: "ref", label: "ID", sortKey: "ref", width: 88, card: "hidden",
    cellStyle: { fontFamily: MONO, fontSize: 11.5, color: c.hint, whiteSpace: "nowrap" },
    render: (s) => s.ref ?? "—",
  },
  {
    id: "name", label: "Name", sortKey: "name", card: "title",
    render: (s) => (
      <>
        <Link href={ROUTES.supplier(s.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none", fontSize: 13.5 }}>
          {s.name}
        </Link>
        {s.email && <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2, fontWeight: 400 }}>{s.email}</div>}
      </>
    ),
  },
  {
    id: "type", label: "Type", sortKey: "type",
    render: (s) => <StatusPill label={TYPE_LABEL[s.type]} tone={s.type === "vendor" ? "blue" : s.type === "subcontractor" ? "amber" : "teal"} />,
  },
  { id: "city", label: "City", sortKey: "city", cellStyle: { color: c.muted, fontSize: 13 }, render: (s) => s.city ?? "—" },
  { id: "phone", label: "Phone", sortKey: "phone", cellStyle: { color: c.muted, fontSize: 13 }, render: (s) => s.phone ?? "—" },
  {
    id: "gstin", label: "GSTIN", sortKey: "gstin",
    cellStyle: { color: c.muted, fontSize: 12, fontFamily: "monospace" },
    render: (s) => s.gstin ?? "—",
  },
  {
    id: "rating", label: "Rating", sortKey: "rating", cellStyle: { color: c.muted, fontSize: 13, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
    render: (s) => (s.check?.rating == null ? "—" : s.check.rating.toFixed(1)),
  },
  { id: "check", label: "Check", sortKey: "check", render: (s) => (s.check ? <SupplierCheckChip summary={{ ...s.check, rating: null }} /> : "—") },
  {
    id: "status", label: "Status", sortKey: "status",
    render: (s) => <StatusPill label={s.status === "active" ? "Active" : "Inactive"} tone={s.status === "active" ? "green" : "red"} />,
  },
];

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; sort?: string; dir?: string; page?: string; af?: string } & Record<string, string | undefined>>;
}) {
  await requireWorkcenterView("suppliers");
  await requireFeature("suppliers");
  const { supabase, tenantId } = await requireTenantUser();
  const params = await searchParams;
  const { q, type: typeFilter, af } = params;
  const colFilters = parseColFilterParams(params);
  const cfParams = colFilterQueryParams(colFilters);
  const { sort, dir } = readSortParams(params);
  const page = Math.max(1, Number(params.page) || 1);

  let query = supabase.from("suppliers").select("*").eq("tenant_id", tenantId).order("name");
  // "inactive" is a status, not a supplier type; every other chip value is a type.
  if (typeFilter === "inactive") query = query.eq("status", "inactive");
  else if (typeFilter && typeFilter !== "all") query = query.eq("type", typeFilter);

  const { data: rows } = await query;
  const { summaries } = await readSummaries({ admin: supabase, tenantId }, null);
  const checkOf = new Map(summaries.map((x) => [x.supplierId, x]));
  const suppliers: Row[] = ((rows ?? []) as Supplier[]).map((s) => ({ ...s, check: checkOf.get(s.id) ?? null }));

  const searched = suppliers.filter((s) => {
    if (!q) return true;
    const term = q.toLowerCase();
    return (
      s.name.toLowerCase().includes(term) ||
      (s.city ?? "").toLowerCase().includes(term) ||
      (s.email ?? "").toLowerCase().includes(term) ||
      (s.gstin ?? "").toLowerCase().includes(term)
    );
  });
  const advFiltered = applyAdvancedFilter(searched, af, (s) => s as unknown as Record<string, unknown>);
  const colFiltered = applyColFilters(advFiltered, colFilters, SORT_EXTRACTORS);
  const filtered = sortRows(colFiltered, sort, dir, SORT_EXTRACTORS);
  const pageRows = paginate(filtered, page);

  const active   = suppliers.filter((s) => s.status === "active").length;
  const inactive = suppliers.filter((s) => s.status === "inactive").length;

  const filterHref = (t: string) =>
    `${ROUTES.suppliers}?type=${t}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  const chips = [
    { id: "all",           label: `All (${suppliers.length})` },
    { id: "vendor",        label: `Vendors` },
    { id: "subcontractor", label: `Subcontractors` },
    { id: "both",          label: `Both` },
  ].map(({ id, label }) => ({ id, label, href: filterHref(id), active: (typeFilter ?? "all") === id }));
  if (inactive > 0) {
    chips.push({ id: "inactive", label: `Inactive (${inactive})`, href: filterHref("inactive"), active: typeFilter === "inactive" });
  }

  // The Groups view (a client's approved suppliers) exists where the tender edition is on.
  const tenant = await getTenant();
  if (tenant?.features?.gcc_tender === true) chips.push({ id: "groups", label: "Groups", href: ROUTES.supplierGroups, active: false });

  const hasFilter = !!(q || af || (typeFilter && typeFilter !== "all") || Object.keys(cfParams).length > 0);

  return (
    <ObjectListPage
      title="Suppliers"
      subtitle={`${suppliers.length} total · ${active} active`}
      newLabel="Supplier"
      newHref={ROUTES.supplierNew}
      chips={chips}
      search={{
        value: q,
        placeholder: "Search by name, city, email or GSTIN…",
        hiddenParams: { type: typeFilter && typeFilter !== "all" ? typeFilter : undefined, af, ...cfParams },
      }}
      advancedFilterObject="supplier"
      columns={COLUMNS}
      rows={pageRows}
      rowKey={(s) => s.id}
      rowHref={(s) => ROUTES.supplier(s.id)}
      total={filtered.length}
      page={page}
      baseHref={ROUTES.suppliers}
      sort={sort}
      dir={dir}
      linkParams={{ q, type: typeFilter, af, ...cfParams }}
      filtered={hasFilter}
      empty={{
        title: "No suppliers yet",
        text: "Add the vendors and subcontractors you buy from, then request quotes from them.",
        filteredTitle: q ? `No suppliers match "${q}".` : "No suppliers match these filters.",
      }}
    />
  );
}
