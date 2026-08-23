import { notFound } from "next/navigation";
import Link from "next/link";
import { requireTenantUser } from "@/lib/supabase-server";
import type { Product } from "@/lib/types";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import PageHeader from "@/components/PageHeader";
import { ROUTES } from "@/lib/constants";
import TabTitle from "@/components/TabTitle";
import ObjectSections from "@/components/fields/ObjectSections";
import AdaptObjectDrawer from "@/components/AdaptObjectDrawer";
import DeleteProductButton from "./DeleteProductButton";
import ProductAvailabilityCard from "./ProductAvailabilityCard";
import NovaTimelineSlot from "@/components/NovaTimelineSlot";
import { getSalesConfig } from "@/lib/fieldConfig";
import { categoryLabel, subCategoryLabel } from "@/lib/picklists";
import { getTenant } from "@/lib/tenant";

const inr = (n: number | null) =>
  n == null ? "—" : "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function CtxRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, marginTop: 5 }}>
      <span style={{ color: c.hint, flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: "right", color: c.muted, wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, tenantId, role } = await requireTenantUser();
  const { id } = await params;

  const { data } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!data) notFound();
  const product = data as Product;
  // Stored category values are codes; the header shows display names.
  const salesConfig = await getSalesConfig(supabase, tenantId);
  const catName = categoryLabel(salesConfig.product_categories, product.category);
  const subName = subCategoryLabel(salesConfig.product_categories, product.sub_category);
  const margin = product.list_price != null && product.cost_price != null && product.list_price > 0
    ? Math.round(((product.list_price - product.cost_price) / product.list_price) * 1000) / 10
    : null;
  const tenant = await getTenant();
  const coverageOn = tenant?.features?.coverage_model === true;

  return (
    <>
      <TabTitle title={product.name} />

      <div style={{ marginBottom: 8 }}>
        <Link href={ROUTES.products} style={{ fontSize: 11.5, color: c.muted, textDecoration: "none" }}>
          ← All products
        </Link>
      </div>

      <PageHeader
        title={product.name}
        subtitle={`${product.ref ? `${product.ref} · ` : ""}${catName || "Product"}${subName ? ` › ${subName}` : ""}${product.sku ? ` · ${product.sku}` : ""}`}
        action={<AdaptObjectDrawer objectType="product" objectLabel="Product" isAdmin={role === "admin"} />}
      />

      <div className="prod-body" style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 16, alignItems: "start", marginTop: 16 }}>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <ObjectSections
            objectType="product"
            record={product as unknown as Record<string, unknown>}
            patchUrl={`/api/products/${product.id}`}
            exclude={["name", "status"]}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <section style={{ ...cardStyle, padding: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Pill label={product.status === "active" ? "Active" : "Inactive"} tone={product.status === "active" ? "green" : "red"} />
              {product.category && <Pill label={subName ? `${catName} › ${subName}` : catName} tone="blue" />}
            </div>
            <CtxRow label="List price" value={inr(product.list_price)} />
            <CtxRow label="Cost price" value={inr(product.cost_price)} />
            {margin != null && <CtxRow label="Margin" value={`${margin}%`} />}
            {product.tax_percent != null && <CtxRow label="Tax" value={`${product.tax_percent}%`} />}
            <CtxRow label="Added" value={fmtDate(product.created_at)} />
          </section>

          {coverageOn && <ProductAvailabilityCard productId={product.id} initial={product.available_segment_ids ?? []} />}

          <DeleteProductButton product={product} />
        </div>
      </div>

      <style>{`@media (max-width: 860px) { .prod-body { grid-template-columns: 1fr !important; } }`}</style>
      <NovaTimelineSlot objectType="products" objectId={id} />
    </>
  );
}
