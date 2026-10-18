import { notFound } from "next/navigation";
import { requireFeature, getTenant, getTenantCurrency } from "@/lib/tenant";
import { requireTenantUser } from "@/lib/supabase-server";
import { requireWorkcenterView, resolvePermissions, canEditWorkcenter, canDeleteWorkcenter, canCreateWorkcenter } from "@/lib/permissions";
import { moneyFormatter } from "@/lib/currency";
import { ROUTES } from "@/lib/constants";
import { PENDING_MESSAGE, loadEstimateBundle } from "@/lib/estimator/server";
import PageHeader from "@/components/PageHeader";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import ObjectRecordPage, { type RecordTab } from "@/components/page/ObjectRecordPage";
import RecordMoreMenu from "@/components/page/RecordMoreMenu";
import RecordActivity from "@/components/page/RecordActivity";
import ObjectSections from "@/components/fields/ObjectSections";
import EstimateStatusPill from "../EstimateStatusPill";
import DetailsCard from "./DetailsCard";
import InputsTab from "./InputsTab";
import BomTab from "./BomTab";
import PriceBuilt from "@/components/estimator/workspace/PriceBuilt";
import QuoteTab from "./QuoteTab";
import CreateQuoteButton from "./CreateQuoteButton";
import Button from "@/components/ui/Button";
import { quoteBlockers } from "@/lib/estimator/quoteLines";
import { templateGroupNames, toQuoteSource } from "@/lib/estimator/lines";
import { toBomGroups } from "./bomView";
import SimulationTab from "@/components/estimator/simulation/SimulationTab";

const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const num = (n: number, dp = 2) => n.toLocaleString("en-GB", { maximumFractionDigits: dp });

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
  const { tab, line: highlightLine } = await searchParams;

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
  const locked = !!estimate.standard_quote_id;
  const cur = await getTenantCurrency();
  const money = moneyFormatter(cur, { maximumFractionDigits: 0 });
  const totals = estimate.totals;
  const basePath = ROUTES.estimate(estimate.id);

  const pieces = estimate.model?.pieces ?? [];
  const concrete = pieces.reduce((a, p) => a + p.vol, 0);
  const facts = [
    { label: "Quote total incl. VAT", value: totals ? money(totals.price_incl_vat) : "—" },
    { label: "Cost", value: totals ? money(totals.cost_total) : "—" },
    ...(pieces.length > 0
      ? [{ label: "Concrete", value: `${num(concrete)} m³` }, { label: "Pieces", value: String(pieces.length) }]
      : [{ label: "Margin", value: `${estimate.margin_pct}%` }]),
  ];

  // The editor needs the workspace's accounts and contacts only when it can be used.
  const needLists = canEdit;
  const [accountsRes, contactsRes] = needLists
    ? await Promise.all([
        supabase.from("accounts").select("id, name").eq("tenant_id", tenantId).order("name"),
        supabase.from("contacts").select("id, name, account_id").eq("tenant_id", tenantId).order("name"),
      ])
    : [{ data: [] }, { data: [] }];

  const tenant = await getTenant();
  const quotesOn = tenant?.features?.standard_quotes === true;
  const canQuote = canEdit && quotesOn && canCreateWorkcenter(perms, "standard_quotes");
  const quoteUnavailable = !quotesOn ? "Standard Quotes isn't enabled for your workspace, so this estimate has nowhere to become a quote."
    : !canQuote && !quote ? "You don't have permission to create a quote." : null;
  const groupNames = template ? templateGroupNames(template.rules) : new Map<string, string>();
  const blockers = quoteBlockers(lines.filter((l) => l.qty > 0).map((l) => toQuoteSource(l, groupNames)));

  const tabs: RecordTab[] = [
    {
      id: "overview",
      label: "Overview",
      content: (
        <>
          <DetailsCard
            id={estimate.id} name={estimate.name} notes={estimate.notes} status={estimate.status}
            accountId={account?.id ?? null} accountName={account?.name ?? null}
            contactId={contact?.id ?? null} contactName={contact?.name ?? null}
            templateName={template?.name ?? null} templateVersion={estimate.template_version}
            templateOutdated={template_outdated} currency={estimate.currency} marginPct={estimate.margin_pct}
            createdLabel={fmtDate(estimate.created_at)} canEdit={canEdit} locked={locked}
            accounts={(accountsRes.data ?? []) as { id: string; name: string }[]}
            contacts={(contactsRes.data ?? []) as { id: string; name: string; account_id: string | null }[]}
          />
          <ObjectSections
            objectType="estimate"
            record={estimate as unknown as Record<string, unknown>}
            patchUrl={`/api/estimates/${estimate.id}`}
            exclude={["ref", "name", "status", "currency", "margin_pct", "notes"]}
          />
        </>
      ),
    },
    {
      id: "inputs",
      label: "Inputs",
      content: (
        <InputsTab
          estimateId={estimate.id} inputs={template?.inputs ?? []} params={estimate.params ?? {}} marginPct={estimate.margin_pct}
          locked={locked} canEdit={canEdit} outdated={template_outdated} templateMissing={!template}
        />
      ),
    },
    {
      id: "bom",
      label: "BOM",
      count: lines.length,
      content: (
        <BomTab
          estimateId={estimate.id} groups={toBomGroups(lines, template?.rules ?? [])} locked={locked} canEdit={canEdit}
          hasSchedule={lines.some((l) => l.source === "schedule")} hasTemplate={!!template}
        />
      ),
    },
    {
      id: "costing",
      label: "Costing",
      content: <PriceBuilt totals={totals} money={moneyFormatter(cur, { maximumFractionDigits: 2 })} estimateId={estimate.id} canReview={canEdit && lines.length > 0} />,
    },
    {
      id: "simulation",
      label: "Simulation",
      content: tab !== "simulation" ? null : (
        <SimulationTab
          model={estimate.model}
          hasGeometry={!!template?.geometry || !!estimate.model}
          lines={lines.map((l) => ({
            code: l.code, group_key: l.group_key, component: l.component, uom: l.uom, qty: l.qty,
            cost_total: l.cost_total, source: l.source, description: l.description, element_ref: l.element_ref,
          }))}
          rules={(template?.rules ?? []).map((r) => ({ code: r.code, qty: r.qty, cost: r.cost }))}
          rates={template?.rates ?? []}
          price={totals?.price ?? 0}
          costTotal={totals?.cost_total ?? 0}
          marginPct={estimate.margin_pct}
          vatPct={totals?.vat_pct ?? 0}
          currency={cur}
          highlightCode={highlightLine}
        />
      ),
    },
    {
      id: "quote",
      label: "Quote",
      content: (
        <QuoteTab
          estimateId={estimate.id} quote={quote} template={template} lines={lines} marginPct={estimate.margin_pct}
          blockers={blockers} money={moneyFormatter(cur, { maximumFractionDigits: 2 })}
          canQuote={canQuote} quoteUnavailable={quoteUnavailable}
        />
      ),
    },
    {
      id: "activity",
      label: "Activity",
      content: <RecordActivity objectType="estimates" objectId={estimate.id} isAdmin={isAdmin} />,
    },
  ];


  return (
    <ObjectRecordPage
      backHref={ROUTES.estimates}
      backLabel="All estimates"
      title={estimate.name}
      reference={estimate.ref}
      meta={[account?.name, template?.name].filter(Boolean).join(" · ") || undefined}
      status={<EstimateStatusPill status={estimate.status} />}
      primaryAction={
        quote ? <Button href={ROUTES.standardQuote(quote.id)} variant="primary">Open quote</Button>
        : canQuote && lines.length > 0 && blockers.length === 0 ? <CreateQuoteButton estimateId={estimate.id} />
        : undefined
      }
      menu={
        <RecordMoreMenu
          inlineEdit={canEdit ? { overviewHref: basePath } : undefined}
          duplicateHref={canCreate ? `${ROUTES.estimateNew}?from=${estimate.id}` : undefined}
          extraItems={[
            { label: "Export BOM (Excel)", href: `/api/estimates/${estimate.id}/export?format=bom&type=xlsx`, hidden: lines.length === 0 },
            { label: "Export WBS (Excel)", href: `/api/estimates/${estimate.id}/export?format=wbs&type=xlsx`, hidden: lines.length === 0 },
            { label: "Export options (ERP layout, CSV)", href: `${basePath}?tab=bom#export`, hidden: lines.length === 0 },
          ]}
          adapt={{ objectType: "estimate", objectLabel: "Estimate", isAdmin }}
          remove={canDelete ? {
            endpoint: `/api/estimates/${estimate.id}`, recordName: estimate.name, entityLabel: "estimate", afterHref: ROUTES.estimates,
            confirmBody: locked ? "The quote made from this estimate is kept. You'll have a few seconds to undo." : undefined,
          } : undefined}
        />
      }
      facts={facts}
      basePath={basePath}
      activeTab={tab}
      tabs={tabs}
    />
  );
}
