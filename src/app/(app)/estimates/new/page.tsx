import Link from "next/link";
import { requireFeature } from "@/lib/tenant";
import { requireTenantUser } from "@/lib/supabase-server";
import { requireWorkcenterView } from "@/lib/permissions";
import { ROUTES } from "@/lib/constants";
import PageHeader from "@/components/PageHeader";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import { PENDING_MESSAGE, isMissingRelation } from "@/lib/estimator/server";
import type { EstimateTemplate } from "@/lib/types";
import NewEstimateForm, { type TemplateChoice } from "./NewEstimateForm";
import StarterButton from "./StarterButton";

export default async function NewEstimatePage({ searchParams }: { searchParams: Promise<{ account_id?: string }> }) {
  await requireWorkcenterView("estimates");
  await requireFeature("estimator");
  const { supabase, tenantId, role } = await requireTenantUser();
  const { account_id } = await searchParams;

  const [tpl, accounts, contacts] = await Promise.all([
    supabase.from("estimate_templates").select("id, name, description, trade, inputs").eq("tenant_id", tenantId).eq("is_active", true).order("name"),
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
        <PageHeader title="New Estimate" />
        <Card padding={0}><EmptyState title="Estimates are waiting for a database update" text={PENDING_MESSAGE} /></Card>
      </>
    );
  }

  const templates = ((tpl.data ?? []) as Pick<EstimateTemplate, "id" | "name" | "description" | "trade" | "inputs">[]).map((t): TemplateChoice => ({
    id: t.id, name: t.name, description: t.description, trade: t.trade, inputs: t.inputs ?? [],
  }));

  if (templates.length === 0) {
    const isAdmin = role === "admin";
    return (
      <>
        {back}
        <PageHeader title="New Estimate" />
        <Card padding={0}>
          <EmptyState
            title="There is no estimate template yet"
            text="An estimate starts from a template: its inputs, rates and rules decide the bill of materials and the cost. Start from the illustrative precast villa starter, then reshape it in Settings."
            action={
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                <StarterButton />
                {isAdmin && <Button href={ROUTES.settingsEstimateTemplates} variant="secondary">Open template settings</Button>}
              </div>
            }
          />
        </Card>
      </>
    );
  }

  return (
    <NewEstimateForm
      templates={templates}
      accounts={(accounts.data ?? []) as { id: string; name: string }[]}
      contacts={(contacts.data ?? []) as { id: string; name: string; account_id: string | null }[]}
      defaultAccountId={account_id}
    />
  );
}
