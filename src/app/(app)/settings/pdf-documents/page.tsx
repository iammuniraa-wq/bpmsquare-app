import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { ROUTES } from "@/lib/constants";
import { getTenant, requireFeature } from "@/lib/tenant";
import { listStandardQuoteTemplates } from "@/lib/data/live";
import { pickEntity, readPdfDesign } from "@/lib/pdf/frameServer";
import { PDF_TIPS } from "@/lib/pdf/tips";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import PdfDocumentsClient from "./PdfDocumentsClient";

/** Settings > PDF documents. Admin only: the frame and the layouts change every document the workspace sends. */
export default async function PdfDocumentsPage() {
  let role: string;
  try {
    ({ role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.settings);
  }
  if (role !== "admin") redirect(ROUTES.settings);
  await requireFeature("standard_quotes");

  const [tenant, templates] = await Promise.all([getTenant(), listStandardQuoteTemplates()]);

  return (
    <>
      <SettingsPageHeader title="PDF documents" info={PDF_TIPS.page} />
      <Suspense fallback={null}>
        <PdfDocumentsClient
          initial={readPdfDesign(tenant?.config)}
          layouts={templates.map((t) => ({ id: t.id, name: t.name, is_default: t.is_default, updated_at: t.updated_at }))}
          entity={pickEntity(tenant?.config, null)}
          companyInfo={tenant?.company_info ?? {}}
          tenantName={tenant?.name ?? ""}
          logoUrl={tenant?.company_info?.logo_url || tenant?.logo_url || null}
          accent={tenant?.accent_color ?? ""}
        />
      </Suspense>
    </>
  );
}
