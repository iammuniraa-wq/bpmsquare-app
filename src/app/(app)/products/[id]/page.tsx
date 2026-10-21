import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import type { Product } from "@/lib/types";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import StatusPill from "@/components/ui/StatusPill";
import Card from "@/components/ui/Card";
import ObjectRecordPage from "@/components/page/ObjectRecordPage";
import RecordMoreMenu from "@/components/page/RecordMoreMenu";
import RecordActivity from "@/components/page/RecordActivity";
import ObjectSections from "@/components/fields/ObjectSections";
import ProductAvailabilityCard from "./ProductAvailabilityCard";
import ProductCostSheetCard from "./ProductCostSheetCard";
import ProductQtyBreaksCard from "./ProductQtyBreaksCard";
import ProductSupplierPanel from "./ProductSupplierPanel";
import { supplierPickerOptions } from "@/lib/products/supplier";
import ItemTypeBadge from "@/components/products/ItemTypeBadge";
import { canHaveComponents, itemTypeLabel } from "@/lib/products/itemTypes";
import { loadBomPageData } from "@/lib/products/bomPage";
import { resolvePermissions, canEditWorkcenter } from "@/lib/permissions";
import ProductComponentsPanel from "./ProductComponentsPanel";
import ProductUsedInCard from "./ProductUsedInCard";
import { getSalesConfig } from "@/lib/fieldConfig";
import { categoryLabel, subCategoryLabel } from "@/lib/picklists";
import { getTenant, getTenantCurrency } from "@/lib/tenant";
import { formatMoney } from "@/lib/currency";

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function CtxRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, marginTop: 6 }}>
      <span style={{ color: c.hint, flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: "right", color: c.muted, wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}

export default async function ProductDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { supabase, tenantId, userId, role } = await requireTenantUser();
  const cur = await getTenantCurrency();
  const inr = (n: number | null) => (n == null ? "—" : formatMoney(n, cur, { maximumFractionDigits: 2 }));
  const { id } = await params;
  const { tab } = await searchParams;

  const { data } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!data) notFound();
  const product = data as Product;
  const isAdmin = role === "admin";
  // Stored category values are codes; the header shows display names.
  const salesConfig = await getSalesConfig(supabase, tenantId);
  const catName = categoryLabel(salesConfig.product_categories, product.category);
  const subName = subCategoryLabel(salesConfig.product_categories, product.sub_category);
  const margin = product.list_price != null && product.cost_price != null && product.list_price > 0
    ? Math.round(((product.list_price - product.cost_price) / product.list_price) * 1000) / 10
    : null;
  const tenant = await getTenant();
  const coverageOn = tenant?.features?.coverage_model === true;
  const costSheetOn = tenant?.features?.pricing_engine === true;
  const qtyBreaksOn = tenant?.features?.standard_quotes === true;
  const basePath = ROUTES.product(product.id);
  const typeLabel = itemTypeLabel(tenant?.config, product.item_type);
  // Only a BOM / kit has components (owner rule); every product can be "used in" one.
  const isKit = canHaveComponents(tenant?.config, product.item_type);
  const bom = await loadBomPageData(supabase, tenantId, product.id, tenant?.config, isKit);
  const canEditBom = canEditWorkcenter(await resolvePermissions(supabase, tenantId, userId, role), "products");
  // Preferred supplier (0132): no supplier_id key on the row = migration
  // pending, so the picker is not offered at all.
  const supplierOptions = "supplier_id" in product ? await supplierPickerOptions(supabase, tenantId, product.supplier_id) : null;
  const supplierName = supplierOptions?.find((s) => s.id === product.supplier_id)?.name;

  const pricingCards = (
    <>
      {costSheetOn && (
        <ProductCostSheetCard
          productId={product.id}
          initial={(product.cost_sheet as { path: string; qty: number; kind?: string }[] | null | undefined) ?? null}
          initialAsOf={product.cost_price_as_of ?? null}
          costPrice={product.cost_price}
        />
      )}
      {qtyBreaksOn && (
        <ProductQtyBreaksCard
          productId={product.id}
          initial={(product.qty_breaks as { from: number; rate: number | null }[] | null | undefined) ?? null}
          uom={product.uom}
        />
      )}
      {coverageOn && <ProductAvailabilityCard productId={product.id} initial={product.available_segment_ids ?? []} />}
    </>
  );
  const hasPricingTab = costSheetOn || qtyBreaksOn || coverageOn;

  return (
    <ObjectRecordPage
      backHref={ROUTES.products}
      backLabel="All products"
      title={product.name}
      reference={product.ref}
      meta={`${catName || "Product"}${subName ? ` › ${subName}` : ""}${product.sku ? ` · ${product.sku}` : ""}`}
      status={
        <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <ItemTypeBadge typeKey={product.item_type} label={typeLabel} />
          <StatusPill label={product.status === "active" ? "Active" : "Inactive"} tone={product.status === "active" ? "green" : "red"} />
        </span>
      }
      menu={
        <RecordMoreMenu
          inlineEdit={{ overviewHref: basePath }}
          adapt={{ objectType: "product", objectLabel: "Product", isAdmin }}
          remove={{
            endpoint: `/api/products/${product.id}`,
            recordName: product.name,
            entityLabel: "product",
            confirmBody: "Existing quote lines keep their copied details. You'll have a few seconds to undo.",
            afterHref: ROUTES.products,
          }}
        />
      }
      facts={[
        ...(typeLabel ? [{ label: "Item type", value: typeLabel }] : []),
        { label: "List price", value: inr(product.list_price) },
        { label: "Cost price", value: inr(product.cost_price) },
        ...(margin != null ? [{ label: "Margin", value: `${margin}%` }] : []),
        ...(product.tax_percent != null ? [{ label: "Tax", value: `${product.tax_percent}%` }] : []),
      ]}
      basePath={basePath}
      activeTab={tab}
      tabs={[
        {
          id: "overview",
          label: "Overview",
          content: (
            <ObjectSections
              objectType="product"
              record={product as unknown as Record<string, unknown>}
              patchUrl={`/api/products/${product.id}`}
              exclude={["name", "status", "supplier_id", "qty_breaks"]}
            />
          ),
        },
        ...(isKit && bom.summary ? [{
          id: "components",
          label: "Components",
          count: bom.rows.length,
          content: (
            <ProductComponentsPanel
              productId={product.id}
              kitLabel={itemTypeLabel(tenant?.config, "bom_kit") ?? "BOM / kit"}
              rows={bom.rows}
              summary={bom.summary}
              storedCost={product.cost_price}
              storedAsOf={product.cost_price_as_of ?? null}
              canEdit={canEditBom}
            />
          ),
        }] : []),
        ...(hasPricingTab ? [{ id: "pricing", label: "Pricing", content: pricingCards }] : []),
        { id: "used-in", label: "Used in", count: bom.used.length, content: <ProductUsedInCard rows={bom.used} /> },
        {
          id: "activity",
          label: "Activity",
          content: <RecordActivity objectType="products" objectId={product.id} isAdmin={isAdmin} />,
        },
      ]}
      rail={
        <>
          <Card title="Details" padding={14}>
            {product.category && <CtxRow label="Category" value={subName ? `${catName} › ${subName}` : catName} />}
            {product.uom && <CtxRow label="Unit" value={product.uom} />}
            {supplierName && product.supplier_id && (
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, marginTop: 6 }}>
                <span style={{ color: c.hint, flexShrink: 0 }}>Supplier</span>
                <Link href={ROUTES.supplier(product.supplier_id)} style={{ textAlign: "right", color: c.accent, textDecoration: "none", wordBreak: "break-word" }}>{supplierName}</Link>
              </div>
            )}
            <CtxRow label="Added" value={fmtDate(product.created_at)} />
          </Card>
          {supplierOptions && <ProductSupplierPanel productId={product.id} supplierId={product.supplier_id ?? null} suppliers={supplierOptions} />}
        </>
      }
    />
  );
}
