import Link from "next/link";
import { requireFeature, getTenant } from "@/lib/tenant";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { tenderDealContext } from "@/lib/tender/estimates/context";
import { requireWorkcenterView, resolvePermissions, canCreateWorkcenter, canEditWorkcenter } from "@/lib/permissions";
import { ROUTES } from "@/lib/constants";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import { PENDING_MESSAGE, isMissingRelation, loadTenantMeta } from "@/lib/estimator/server";
import type { EstimateTemplate } from "@/lib/types";
import type { WorkspaceTemplate } from "@/components/estimator/workspace/types";
import type { DraftInit } from "@/components/estimator/workspace/useEstimateDraft";
import { loadEstimatePrefill } from "@/lib/inbox/estimateLink";
import { quoteAbility } from "../quoteAbility";
import NewEstimateScreen from "./NewEstimateScreen";
import StarterButton from "./StarterButton";
import TemplateCards from "./TemplateCards";
import { aiConfigured } from "@/lib/estimator/aiServer";

type TemplateRow = Pick<EstimateTemplate, "id" | "name" | "description" | "geometry" | "inputs" | "rates" | "rules" | "quote_granularity" | "icon" | "keywords" | "locked" | "visual" | "customer_visible">;

export default async function NewEstimatePage({ searchParams }: { searchParams: Promise<{ account_id?: string; from?: string; template?: string; email?: string; from_email?: string; opportunity?: string }> }) {
  await requireWorkcenterView("estimates");
  await requireFeature("estimator");
  const { supabase, tenantId, userId, role } = await requireTenantUser();
  const { account_id, from, template: templateParam, email: emailParam, from_email: fromEmail, opportunity: opportunityParam } = await searchParams;

  // GCC tender deals (slice 3c-1): "?opportunity=<deal>" makes the estimate for that tender. Only a tender deal of THIS workspace counts
  // (and only with the edition on); anything else is ignored and the page is the ordinary new-estimate page.
  const tenantNow = opportunityParam ? await getTenant() : null;
  const dealCtx = opportunityParam && tenantNow ? await tenderDealContext(createAdminSupabase(), tenantId, tenantNow.features, opportunityParam) : null;

  const [tpl, accounts, contacts] = await Promise.all([
    // "*": the catalogue columns (icon, keywords, locked) exist only once 0213 is applied.
    supabase.from("estimate_templates").select("*").eq("tenant_id", tenantId).eq("is_active", true).order("name"),
    supabase.from("accounts").select("id, name").eq("tenant_id", tenantId).order("name"),
    supabase.from("contacts").select("id, name, account_id").eq("tenant_id", tenantId).order("name"),
  ]);

  const back = (
    <div style={{ marginBottom: 8 }}>
      <Link href={ROUTES.estimates} className="bpm-backlink">← All estimates</Link>
    </div>
  );

  if (tpl.error && isMissingRelation(tpl.error)) {
    return (
      <>
        {back}
        <PageHeader title="New estimate" />
        <Card padding={0}><EmptyState title="Estimates are waiting for a database update" text={PENDING_MESSAGE} /></Card>
      </>
    );
  }

  const rows = (tpl.data ?? []) as TemplateRow[];
  const templates = rows.map((t): WorkspaceTemplate => ({
    id: t.id, name: t.name, description: t.description, geometry: t.geometry ?? null,
    inputs: t.inputs ?? [], rates: t.rates ?? [], rules: t.rules ?? [], quote_granularity: t.quote_granularity ?? "group",
    visual: t.visual ?? null, customer_visible: t.customer_visible === true,
  }));

  if (templates.length === 0) {
    return (
      <>
        {back}
        <PageHeader title="New estimate" />
        <Card padding={0}>
          <EmptyState
            title="There is no estimate template yet"
            text="An estimate starts from a template: its inputs, rates and rules decide the bill of materials and the cost. Start from the illustrative precast villa starter, then reshape it in Settings."
            action={
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                <StarterButton />
                <StarterButton starter="Chain-link fence" label="Start from the chain-link fence starter" variant="secondary" />
                {role === "admin" && <Button href={ROUTES.settingsEstimateTemplates} variant="secondary">Open template settings</Button>}
              </div>
            }
          />
        </Card>
      </>
    );
  }

  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  const canCreate = canCreateWorkcenter(perms, "estimates");
  if (!canCreate) {
    return (
      <>
        {back}
        <PageHeader title="New estimate" />
        <Card padding={0}><EmptyState title="You can't create estimates" text="Ask an administrator to give you create access to Estimates." /></Card>
      </>
    );
  }

  // With more than one template the page opens on "What are you estimating?"; a card (or an
  // old link with ?from=) goes on to the working page with that template chosen.
  const chosen = templateParam && templates.some((t) => t.id === templateParam) ? templateParam : null;
  const viaInbox = !!fromEmail && /^[0-9a-f-]{36}$/i.test(fromEmail);
  if (templates.length > 1 && !chosen && !viaInbox && !(from && /^[0-9a-f-]{36}$/i.test(from))) {
    return (
      <>
        <TabTitle title="New estimate" />
        {back}
        <PageHeader title="What are you estimating?" subtitle="Choose a template. You can paste the customer's email on the next page." />
        <TemplateCards
          templates={rows.map((t) => ({ id: t.id, name: t.name, description: t.description, geometry: t.geometry ?? null, icon: t.icon ?? null, keywords: t.keywords ?? null, locked: t.locked === true }))}
          accountId={account_id && (accounts.data ?? []).some((a) => a.id === account_id) ? account_id : undefined}
          opportunityId={dealCtx?.id}
          canPick={aiConfigured()}
        />
      </>
    );
  }

  // Duplicate: start from another estimate's template, inputs, margin and account.
  let init: DraftInit = {
    templateId: chosen ?? templates[0].id,
    accountId: account_id && (accounts.data ?? []).some((a) => a.id === account_id) ? account_id : undefined,
    ...(dealCtx ? { opportunityId: dealCtx.id } : {}),
  };
  if (from && /^[0-9a-f-]{36}$/i.test(from)) {
    const { data: src } = await supabase
      .from("estimates")
      .select("name, template_id, account_id, contact_id, params, margin_pct")
      .eq("id", from).eq("tenant_id", tenantId).maybeSingle();
    const s = src as { name: string; template_id: string | null; account_id: string | null; contact_id: string | null; params: Record<string, number | string | boolean> | null; margin_pct: number | string | null } | null;
    if (s && s.template_id && templates.some((t) => t.id === s.template_id)) {
      init = {
        templateId: s.template_id, customer: `${s.name} (copy)`, accountId: s.account_id ?? undefined, contactId: s.contact_id ?? undefined,
        params: s.params ?? {}, margin: Number(s.margin_pct ?? 0),
      };
    }
  }

  // Started from the shared Inbox: the customer's email goes in the intake card, the template suggested for it is
  // chosen (when it is one of this workspace's active ones), and the sender's account is picked if they are known.
  if (fromEmail && /^[0-9a-f-]{36}$/i.test(fromEmail)) {
    const prefill = await loadEstimatePrefill(fromEmail);
    if (prefill) {
      const known = (id: string | null) => !!id && (accounts.data ?? []).some((a) => a.id === id);
      init = {
        ...init,
        brief: prefill.brief, sourceEmailId: fromEmail,
        accountId: init.accountId ?? (known(prefill.accountId) ? prefill.accountId! : undefined),
        contactId: known(prefill.accountId) ? prefill.contactId ?? undefined : undefined,
        customer: init.customer ?? prefill.customer ?? undefined,
      };
    }
  }

  const [meta, tenant] = await Promise.all([loadTenantMeta(tenantId), getTenant()]);
  const { canQuote, quoteUnavailable } = quoteAbility(perms, tenant, canEditWorkcenter(perms, "estimates"), false, dealCtx !== null);

  return (
    <>
      <TabTitle title="New estimate" />
      {back}
      {dealCtx && (
        <div data-guide="tender.estimate.for" style={{ marginBottom: 10, fontSize: 13 }}>
          For tender <b>{dealCtx.ref ?? dealCtx.title}</b> · <Link href={`/pipeline/${dealCtx.id}?tab=estimates`} className="bpm-backlink">Back to the tender</Link>
        </div>
      )}
      <PageHeader title={templates.length > 1 ? `New estimate: ${templates.find((t) => t.id === init.templateId)?.name ?? ""}` : "New estimate"} subtitle="Start from the customer's email or fill in the details. Nothing is saved until you create the quote or save a draft." action={templates.length > 1 ? <Button href={dealCtx ? `${ROUTES.estimateNew}?opportunity=${dealCtx.id}` : ROUTES.estimateNew} variant="secondary" size="sm">Change template</Button> : undefined} />
      <NewEstimateScreen
        templates={templates}
        init={init}
        vatPct={meta.vat_pct}
        accounts={(accounts.data ?? []) as { id: string; name: string }[]}
        contacts={(contacts.data ?? []) as { id: string; name: string; account_id: string | null }[]}
        canEdit
        canQuote={canQuote}
        quoteUnavailable={quoteUnavailable}
        fromTender={dealCtx !== null}
        emailFirst={emailParam === "1" || (viaInbox && !chosen)}
      />
    </>
  );
}
