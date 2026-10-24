import { notFound } from "next/navigation";
import { requireFeature, getTenant } from "@/lib/tenant";
import { requireTenantUser } from "@/lib/supabase-server";
import { requireWorkcenterView, resolvePermissions, canEditWorkcenter, canDeleteWorkcenter, canCreateWorkcenter, canViewWorkcenter } from "@/lib/permissions";
import { ROUTES } from "@/lib/constants";
import { lineProductViews } from "@/lib/estimator/catalogue";
import { PENDING_MESSAGE, loadEstimateBundle, loadTenantMeta } from "@/lib/estimator/server";
import PageHeader from "@/components/PageHeader";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import ObjectRecordPage from "@/components/page/ObjectRecordPage";
import ExternalRecordSlot from "@/components/ExternalRecordSlot";
import RecordMoreMenu from "@/components/page/RecordMoreMenu";
import EstimateStatusPill from "../EstimateStatusPill";
import { quoteAbility } from "../quoteAbility";
import EstimateScreen from "./EstimateScreen";
import SourceEmailSlot from "@/components/inbox/SourceEmailSlot";

const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default async function EstimatePage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; line?: string }>;
}) {
  await requireWorkcenterView("estimates");
  await requireFeature("estimator");
  const { supabase, tenantId, userId, role } = await requireTenantUser();
  const { id } = await params;
  const { tab, line } = await searchParams;

  const { bundle, missing } = await loadEstimateBundle(supabase, tenantId, id);
  if (missing) {
    return (
      <>
        <PageHeader title="Estimate" />
        <Card padding={0}><EmptyState title="Estimates are waiting for a database update" text={PENDING_MESSAGE} /></Card>
      </>
    );
  }
  if (!bundle) notFound();
  const { estimate, lines, template, template_outdated, account, contact, quote } = bundle;

  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  const canEdit = canEditWorkcenter(perms, "estimates");
  const canDelete = canDeleteWorkcenter(perms, "estimates");
  const canCreate = canCreateWorkcenter(perms, "estimates");
  const isAdmin = role === "admin";
  const basePath = ROUTES.estimate(estimate.id);

  // The pickers are only needed when something can be edited or quoted.
  const [accountsRes, contactsRes] = canEdit
    ? await Promise.all([
        supabase.from("accounts").select("id, name").eq("tenant_id", tenantId).order("name"),
        supabase.from("contacts").select("id, name, account_id").eq("tenant_id", tenantId).order("name"),
      ])
    : [{ data: [] }, { data: [] }];
  const [meta, tenant] = await Promise.all([loadTenantMeta(tenantId), getTenant()]);
  const { canQuote, quoteUnavailable } = quoteAbility(perms, tenant, canEdit, !!quote);
  const lineProducts = await lineProductViews(supabase, tenantId, lines.map((l) => l.product_id), { canOpenProducts: canViewWorkcenter(perms, "products") });

  return (
    <ObjectRecordPage
      backHref={ROUTES.estimates}
      backLabel="All estimates"
      title={estimate.name}
      reference={estimate.ref}
      meta={[account?.name, template?.name].filter(Boolean).join(" · ") || undefined}
      status={<EstimateStatusPill status={estimate.status} />}
      menu={
        <RecordMoreMenu
          duplicateHref={canCreate ? `${ROUTES.estimateNew}?from=${estimate.id}` : undefined}
          extraItems={[
            { label: "Download bill of materials", href: `/api/estimates/${estimate.id}/export?format=bom&type=xlsx`, hidden: lines.length === 0 },
            { label: "Download work breakdown", href: `/api/estimates/${estimate.id}/export?format=wbs&type=xlsx`, hidden: lines.length === 0 },
          ]}
          adapt={{ objectType: "estimate", objectLabel: "Estimate", isAdmin }}
          remove={canDelete ? {
            endpoint: `/api/estimates/${estimate.id}`, recordName: estimate.name, entityLabel: "estimate", afterHref: ROUTES.estimates,
            confirmBody: estimate.standard_quote_id ? "The quote made from this estimate is kept. You'll have a few seconds to undo." : undefined,
          } : undefined}
        />
      }
      externalLine={<ExternalRecordSlot objectType="estimates" objectId={id} />}
      basePath={basePath}
      tabs={[{
        id: "estimate",
        label: "Estimate",
        content: (
          <>
          <SourceEmailSlot objectType="estimates" objectId={estimate.id} />
          <EstimateScreen
            estimate={estimate} lines={lines} template={template} templateOutdated={template_outdated}
            account={account} contact={contact} quote={quote}
            vatPct={estimate.totals?.vat_pct ?? meta.vat_pct} createdLabel={fmtDate(estimate.created_at)}
            canEdit={canEdit} canQuote={canQuote} quoteUnavailable={quoteUnavailable} isAdmin={isAdmin}
            accounts={(accountsRes.data ?? []) as { id: string; name: string }[]}
            contacts={(contactsRes.data ?? []) as { id: string; name: string; account_id: string | null }[]}
            lineProducts={lineProducts}
            tab={tab} line={line}
          />
          </>
        ),
      }]}
    />
  );
}
