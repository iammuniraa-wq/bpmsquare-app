import { getTenant } from "@/lib/tenant";
import { canEditWorkcenter, canViewWorkcenter, resolvePermissions } from "@/lib/permissions";
import { createAdminSupabase, requireTenantUser } from "@/lib/supabase-server";
import { ROUTES } from "@/lib/constants";
import { listMembersForPicker } from "@/lib/sales/opportunityServer";
import { loadQuoteSource } from "@/lib/contractProjects/fromQuote";
import { loadProjectBySource } from "@/lib/contractProjects/server";
import Button from "@/components/ui/Button";
import CreateContractProjectButton, { type QuoteProjectSource } from "./CreateContractProjectButton";

/** The project made from this quote, for a "Project" fact on the quote's page; null when the module is off, the caller may not open projects, or none exists. */
export async function findQuoteProject(type: "standard_quote" | "quotation", id: string): Promise<{ id: string; ref: string | null } | null> {
  const tenant = await getTenant();
  if (tenant?.features?.contract_projects !== true) return null;
  try {
    const { supabase, tenantId, userId, role } = await requireTenantUser();
    if (!canViewWorkcenter(await resolvePermissions(supabase, tenantId, userId, role), "contract_projects")) return null;
    return await loadProjectBySource(createAdminSupabase(), tenantId, { type, id });
  } catch {
    return null;
  }
}

/**
 * The contract-project action on an accepted quote, a won quotation, or an estimate whose quote was accepted: the project made from it as a
 * link ("Open project"), else the button that makes one. Renders nothing unless the workspace has Contract projects, the caller may open them
 * and (for the button) edit them, and the source is ready, so every other workspace sees exactly the page it had.
 */
export default async function QuoteProjectAction({ sourceType, sourceId, ready, variant = "secondary", strip = false }: {
  sourceType: QuoteProjectSource;
  sourceId: string;
  /** The source is accepted or won. A project that already exists is shown whatever the state. */
  ready: boolean;
  variant?: "primary" | "secondary";
  /** Wraps the result in a row of its own, for a page that has no action bar (the quotation and the deal). */
  strip?: boolean;
}) {
  const tenant = await getTenant();
  if (tenant?.features?.contract_projects !== true) return null;
  const place = (node: React.ReactNode) => (strip ? <div data-guide="quote.project_strip" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 12px" }}>{node}</div> : node);
  try {
    const { supabase, tenantId, userId, role } = await requireTenantUser();
    const perms = await resolvePermissions(supabase, tenantId, userId, role);
    if (!canViewWorkcenter(perms, "contract_projects")) return null;
    const admin = createAdminSupabase();

    let quote: { type: "standard_quote" | "quotation"; id: string } | null = sourceType === "estimate" ? null : { type: sourceType, id: sourceId };
    if (sourceType === "estimate") {
      const { data } = await admin.from("estimates").select("standard_quote_id").eq("id", sourceId).eq("tenant_id", tenantId).maybeSingle();
      const qid = (data as { standard_quote_id: string | null } | null)?.standard_quote_id;
      if (qid) quote = { type: "standard_quote", id: qid };
    }
    if (!quote) return null;

    const existing = await loadProjectBySource(admin, tenantId, quote);
    if (existing) {
      return place(<Button variant={variant} href={ROUTES.contractProject(existing.id)} data-guide="quote.open_project" style={{ minHeight: 44 }}>Open project{existing.ref ? ` ${existing.ref}` : ""}</Button>);
    }
    if (!ready || !canEditWorkcenter(perms, "contract_projects")) return null;

    const src = await loadQuoteSource(admin, tenantId, { type: sourceType, id: sourceId });
    if (!src.ok) return null;
    const members = await listMembersForPicker(admin, tenantId);
    return place(
      <CreateContractProjectButton
        sourceType={sourceType} sourceId={sourceId} defaultName={src.source.title} lineCount={src.source.lines.length}
        contractValue={src.source.contractValue} currency={src.source.currency} members={members} variant={variant}
      />,
    );
  } catch {
    return null;
  }
}
