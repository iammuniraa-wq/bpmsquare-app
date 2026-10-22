import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createAdminSupabase, requireTenantUser } from "@/lib/supabase-server";
import { getTenant } from "@/lib/tenant";
import { listTextFragments } from "@/lib/data";
import { ROUTES, type QuoteStatusDef } from "@/lib/constants";
import type { EmailTemplate } from "@/lib/types";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import QuotationsClient from "./QuotationsClient";
import { quotationTabs } from "./quotationsLogic";
import { QUOTATION_TIPS } from "./tips";

/**
 * Settings > Quotations. Admin only, like the five pages it replaces (Quote statuses, Quote types, Text templates,
 * Email templates, Asset print fields): every route they write through is an admin write. Each tab reads only what
 * its module owns, so a workspace with Assets and no Quotations sees Print alone.
 */
export default async function QuotationsSettingsPage() {
  let ctx: Awaited<ReturnType<typeof requireTenantUser>>;
  try {
    ctx = await requireTenantUser();
  } catch {
    redirect(ROUTES.settings);
  }
  if (ctx.role !== "admin") redirect(ROUTES.settings);

  const tenant = await getTenant();
  const tabs = quotationTabs(tenant?.features);
  if (tabs.length === 0) redirect(ROUTES.settings);
  const admin = createAdminSupabase();

  const { data } = await admin.from("tenants").select("config").eq("id", ctx.tenantId).single();
  const cfg = (data?.config ?? {}) as {
    quote_statuses?: QuoteStatusDef[]; quote_type_visibility?: Record<string, boolean>; asset_print_fields?: string[];
  };

  const withQuotations = tabs.includes("templates");
  const [fragments, emails] = withQuotations
    ? await Promise.all([
        listTextFragments(),
        admin.from("email_templates").select("*").eq("tenant_id", ctx.tenantId).order("category").order("created_at")
          .then((r) => (r.data ?? []) as EmailTemplate[]),
      ])
    : [[], [] as EmailTemplate[]];

  const withPrint = tabs.includes("print");
  const { data: customFields } = withPrint
    ? await admin.from("custom_fields").select("field_key, field_label").eq("tenant_id", ctx.tenantId).eq("object_type", "asset").order("position")
    : { data: [] };

  return (
    <>
      <SettingsPageHeader title="Quotations" info={QUOTATION_TIPS.page} />
      <Suspense fallback={null}>
        <QuotationsClient
          statuses={cfg.quote_statuses ?? null}
          typeVisibility={cfg.quote_type_visibility ?? null}
          printFields={cfg.asset_print_fields ?? []}
          printCustomFields={(customFields ?? []).map((f) => ({ value: f.field_key as string, label: f.field_label as string }))}
          fragments={fragments}
          emails={emails}
        />
      </Suspense>
    </>
  );
}
