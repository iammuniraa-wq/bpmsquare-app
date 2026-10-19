import { notFound } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import type { Supplier } from "@/lib/types";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import StatusPill from "@/components/ui/StatusPill";
import Card from "@/components/ui/Card";
import ObjectRecordPage from "@/components/page/ObjectRecordPage";
import RecordMoreMenu from "@/components/page/RecordMoreMenu";
import RecordActivity from "@/components/page/RecordActivity";
import ObjectSections from "@/components/fields/ObjectSections";
import SupplierRfqCard from "@/components/rfq/SupplierRfqCard";
import RelatedList from "@/components/page/RelatedList";
import PagerLink from "@/components/PagerLink";
import { getTenant, getTenantCurrency } from "@/lib/tenant";
import { formatMoney } from "@/lib/currency";
import { canViewWorkcenter, resolvePermissions } from "@/lib/permissions";
import { isSupplierColumnMissing } from "@/lib/products/supplier";

const PRODUCTS_PAGE_SIZE = 20;

const TYPE_LABEL: Record<Supplier["type"], string> = {
  vendor: "Vendor", subcontractor: "Subcontractor", both: "Vendor & Sub",
};

type SuppliedProduct = {
  id: string; ref: string | null; name: string; sku: string | null; uom: string | null;
  list_price: number | null; status: "active" | "inactive";
};

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function ContactRow({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, marginTop: 6 }}>
      <span style={{ color: c.hint, flexShrink: 0 }}>{label}</span>
      <a href={href} style={{ textAlign: "right", color: c.accent, wordBreak: "break-all" }}>{value}</a>
    </div>
  );
}

export default async function SupplierDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const { supabase, tenantId, userId, role } = await requireTenantUser();
  const { id } = await params;
  const { tab, page: pageParam } = await searchParams;

  const { data } = await supabase
    .from("suppliers")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!data) notFound();
  const supplier = data as Supplier;
  const isAdmin = role === "admin";
  const basePath = ROUTES.supplier(supplier.id);

  // Products that name this supplier as their preferred one (0132). Shown only
  // to a tenant that owns the Products module and a user who may view it, and
  // not at all while the column is missing (the query's own error says so).
  const tenant = await getTenant();
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  let supplied: { rows: SuppliedProduct[]; total: number; page: number } | null = null;
  if (tenant?.features?.products === true && canViewWorkcenter(perms, "products")) {
    const page = Math.max(1, Number(pageParam) || 1);
    const { data: prodRows, count, error: prodError } = await supabase
      .from("products")
      .select("id, ref, name, sku, uom, list_price, status", { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("supplier_id", supplier.id)
      .order("name")
      .range((page - 1) * PRODUCTS_PAGE_SIZE, page * PRODUCTS_PAGE_SIZE - 1);
    if (!isSupplierColumnMissing(prodError)) supplied = { rows: (prodRows ?? []) as SuppliedProduct[], total: count ?? 0, page };
  }
  const cur = supplied ? await getTenantCurrency() : null;

  return (
    <ObjectRecordPage
      backHref={ROUTES.suppliers}
      backLabel="All suppliers"
      title={supplier.name}
      reference={supplier.ref}
      meta={`${TYPE_LABEL[supplier.type]}${supplier.city ? ` · ${supplier.city}` : ""}`}
      status={<StatusPill label={supplier.status === "active" ? "Active" : "Inactive"} tone={supplier.status === "active" ? "green" : "red"} />}
      menu={
        <RecordMoreMenu
          inlineEdit={{ overviewHref: basePath }}
          adapt={{ objectType: "supplier", objectLabel: "Supplier", isAdmin }}
          remove={{
            endpoint: `/api/suppliers/${supplier.id}`,
            recordName: supplier.name,
            entityLabel: "supplier",
            afterHref: ROUTES.suppliers,
          }}
        />
      }
      facts={[
        { label: "Type", value: TYPE_LABEL[supplier.type] },
        { label: "City", value: supplier.city ?? "—" },
        { label: "Added", value: fmtDate(supplier.created_at) },
      ]}
      basePath={basePath}
      activeTab={tab}
      tabs={[
        {
          id: "overview",
          label: "Overview",
          content: (
            <ObjectSections
              objectType="supplier"
              record={supplier as unknown as Record<string, unknown>}
              patchUrl={`/api/suppliers/${supplier.id}`}
              exclude={["name", "type", "city", "status"]}
            />
          ),
        },
        ...(supplied && cur ? [{
          id: "products",
          label: "Products",
          count: supplied.total,
          content: (
            <RelatedList
              title="Products supplied"
              emptyText="No product lists this supplier as its preferred supplier yet."
              rows={supplied.rows}
              rowKey={(p) => p.id}
              rowHref={(p) => ROUTES.product(p.id)}
              columns={[
                { label: "Name", render: (p) => <span style={{ fontWeight: 600, color: c.ink }}>{p.name}</span> },
                { label: "SKU", cellStyle: { color: c.muted, fontFamily: "monospace", fontSize: 12 }, render: (p) => p.sku ?? "—" },
                { label: "UoM", cellStyle: { color: c.muted }, render: (p) => p.uom ?? "—" },
                { label: "List price", align: "right" as const, cellStyle: { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }, render: (p) => (p.list_price == null ? "—" : formatMoney(p.list_price, cur, { maximumFractionDigits: 2 })) },
                { label: "Status", render: (p) => <StatusPill label={p.status === "active" ? "Active" : "Inactive"} tone={p.status === "active" ? "green" : "red"} /> },
              ]}
              footer={supplied.total > PRODUCTS_PAGE_SIZE ? (
                <PagerLink page={supplied.page} total={supplied.total} pageSize={PRODUCTS_PAGE_SIZE} baseHref={basePath} hiddenParams={{ tab: "products" }} />
              ) : undefined}
            />
          ),
        }] : []),
        {
          id: "activity",
          label: "Activity",
          content: <RecordActivity objectType="suppliers" objectId={supplier.id} isAdmin={isAdmin} />,
        },
      ]}
      rail={
        <>
          {(supplier.email || supplier.phone) && (
            <Card title="Contact" padding={14}>
              {supplier.email && <ContactRow label="Email" value={supplier.email} href={`mailto:${supplier.email}`} />}
              {supplier.phone && <ContactRow label="Phone" value={supplier.phone} href={`tel:${supplier.phone}`} />}
            </Card>
          )}
          <SupplierRfqCard supplierId={supplier.id} />
        </>
      }
    />
  );
}
