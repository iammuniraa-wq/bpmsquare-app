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

const TYPE_LABEL: Record<Supplier["type"], string> = {
  vendor: "Vendor", subcontractor: "Subcontractor", both: "Vendor & Sub",
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
  searchParams: Promise<{ tab?: string }>;
}) {
  const { supabase, tenantId, role } = await requireTenantUser();
  const { id } = await params;
  const { tab } = await searchParams;

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
