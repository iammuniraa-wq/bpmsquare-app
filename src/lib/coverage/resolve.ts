import "server-only";
import { createAdminSupabase } from "@/lib/supabase-server";
import type { Account, Coverage, Segment, Team } from "@/lib/types";
import { matchesAllFilters } from "@/lib/marketingSegmentation";

/**
 * Coverage's matching/resolution engine -- computes which Segments an
 * account matches, which Team owns/overlays/services it, and where its
 * records should push. Nothing here is stored on the account beyond the
 * cached owner_user_id (applyAutoOwnership); every call recomputes live
 * from the current rules, which is the entire point of the model (see
 * supabase/migrations/0101_coverage.sql).
 *
 * Every query is on the admin client with an explicit tenant_id filter
 * (MULTI_TENANT_GUARDRAILS.md -- RLS is not a backstop here), same
 * convention as src/lib/account360/server.ts.
 */

export type AccountSignals = {
  has_active_amc: boolean;
  /** Space-joined "sku name" pairs, matched via the "contains" operator --
   * a plain string field, not a real column, so it reuses matchesAllFilters
   * unchanged rather than needing a new operator/type. */
  owned_product_skus: string;
};

export async function computeAccountSignals(tenantId: string, accountId: string): Promise<AccountSignals> {
  const admin = createAdminSupabase();
  const [{ data: contractRows }, { data: quoteRows }] = await Promise.all([
    admin.from("contracts").select("status").eq("tenant_id", tenantId).eq("account_id", accountId),
    admin.from("quotes").select("id").eq("tenant_id", tenantId).eq("account_id", accountId),
  ]);
  const has_active_amc = (contractRows ?? []).some((c: { status: string }) => c.status === "active");

  const quoteIds = (quoteRows ?? []).map((q: { id: string }) => q.id);
  let owned_product_skus = "";
  if (quoteIds.length > 0) {
    const { data: lineRows } = await admin
      .from("quote_lines")
      .select("product_id")
      .eq("tenant_id", tenantId)
      .in("quote_id", quoteIds)
      .not("product_id", "is", null);
    const productIds = [...new Set((lineRows ?? []).map((l: { product_id: string | null }) => l.product_id).filter((x: unknown): x is string => typeof x === "string"))];
    if (productIds.length > 0) {
      const { data: productRows } = await admin
        .from("products").select("sku, name")
        .eq("tenant_id", tenantId).in("id", productIds);
      owned_product_skus = (productRows ?? []).map((p: { sku: string | null; name: string }) => `${p.sku ?? ""} ${p.name}`).join(", ");
    }
  }
  return { has_active_amc, owned_product_skus };
}

/** Every Segment whose rule matches this account -- an explicit
 * account_ids hit ORs in regardless of the field-filter result. */
export async function matchedSegments(tenantId: string, account: Account): Promise<Segment[]> {
  const admin = createAdminSupabase();
  const { data: segmentRows } = await admin.from("segments").select("*").eq("tenant_id", tenantId);
  const segments = (segmentRows ?? []) as Segment[];
  if (segments.length === 0) return [];

  const signals = await computeAccountSignals(tenantId, account.id);
  const record: Record<string, unknown> = { ...account, ...signals };
  return segments.filter((s) =>
    (s.account_ids ?? []).includes(account.id) || matchesAllFilters(record, s.filters ?? [], s.match ?? "all")
  );
}

export type ResolvedAssignment = { coverage: Coverage; segment: Segment; team: Team };
export type ResolvedCoverage = {
  owner: ResolvedAssignment | null;
  overlays: ResolvedAssignment[];
  services: ResolvedAssignment[];
};

/** Resolves live coverage for one account: which segments it matches, which
 * effective-dated coverage rows wire to those segments, and -- for OWNER,
 * where more than one coverage can match -- which one wins by priority
 * (lower wins; ties break on the older coverage, per the migration's
 * documented rule). OVERLAY/SERVICE are additive by design: every match
 * is returned, no precedence needed. */
export async function resolveCoverageForAccount(tenantId: string, account: Account): Promise<ResolvedCoverage> {
  const segments = await matchedSegments(tenantId, account);
  if (segments.length === 0) return { owner: null, overlays: [], services: [] };

  const admin = createAdminSupabase();
  const segmentIds = segments.map((s) => s.id);
  const segmentById = new Map(segments.map((s) => [s.id, s]));
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: coverageRows }, { data: teamRows }] = await Promise.all([
    admin.from("coverages").select("*")
      .eq("tenant_id", tenantId).in("segment_id", segmentIds)
      .lte("effective_from", today)
      .or(`effective_to.is.null,effective_to.gte.${today}`),
    admin.from("teams").select("*").eq("tenant_id", tenantId),
  ]);
  const teamById = new Map(((teamRows ?? []) as Team[]).map((t) => [t.id, t]));

  const assignments = ((coverageRows ?? []) as Coverage[])
    .map((coverage): ResolvedAssignment | null => {
      const segment = segmentById.get(coverage.segment_id);
      const team = teamById.get(coverage.team_id);
      return segment && team ? { coverage, segment, team } : null;
    })
    .filter((a): a is ResolvedAssignment => a !== null);

  const owners = assignments.filter((a) => a.coverage.role === "owner");
  const owner = owners.reduce<ResolvedAssignment | null>((best, cur) => {
    if (!best) return cur;
    if (cur.coverage.priority !== best.coverage.priority) return cur.coverage.priority < best.coverage.priority ? cur : best;
    return new Date(cur.coverage.created_at) < new Date(best.coverage.created_at) ? cur : best;
  }, null);

  return {
    owner,
    overlays: assignments.filter((a) => a.coverage.role === "overlay"),
    services: assignments.filter((a) => a.coverage.role === "service"),
  };
}

/** Recomputes and persists owner_user_id from the winning OWNER coverage's
 * team lead -- the auto-ownership feature. Called after every account
 * create/update. A team with no lead set resolves to no owner rather than
 * guessing a member; the account simply has no auto-owner until the team
 * gets one. Returns the resolved owner id (or null) for the caller to use
 * without a second round-trip. */
export async function applyAutoOwnership(tenantId: string, account: Account): Promise<string | null> {
  const resolved = await resolveCoverageForAccount(tenantId, account);
  const nextOwnerId = resolved.owner?.team.lead_user_id ?? null;
  if (nextOwnerId !== account.owner_user_id) {
    const admin = createAdminSupabase();
    await admin.from("accounts").update({ owner_user_id: nextOwnerId }).eq("id", account.id).eq("tenant_id", tenantId);
  }
  return nextOwnerId;
}

export type ErpEndpoint = { webhook_url: string; webhook_secret: string; source: "default" | "coverage"; name?: string };
type IntegrationPushConfig = {
  webhook_url?: string;
  webhook_secret?: string;
  endpoints?: { id: string; name: string; webhook_url: string; webhook_secret: string }[];
} | undefined;

/** Which ERP endpoint an account's records should push to -- the owning
 * coverage's erp_endpoint_id if set and it still resolves to a configured
 * endpoint, else the tenant's single default pair, else null (nothing
 * configured, same as before this feature existed). */
export async function resolveErpEndpointForAccount(
  tenantId: string, account: Account, integrationPush: IntegrationPushConfig
): Promise<ErpEndpoint | null> {
  const resolved = await resolveCoverageForAccount(tenantId, account);
  const endpointId = resolved.owner?.coverage.erp_endpoint_id;
  if (endpointId) {
    const ep = integrationPush?.endpoints?.find((e) => e.id === endpointId);
    if (ep) return { webhook_url: ep.webhook_url, webhook_secret: ep.webhook_secret, source: "coverage", name: ep.name };
  }
  if (integrationPush?.webhook_url && integrationPush?.webhook_secret) {
    return { webhook_url: integrationPush.webhook_url, webhook_secret: integrationPush.webhook_secret, source: "default" };
  }
  return null;
}

/** Product-availability gating: true when the account matches at least one
 * of the product's restricting segments. Only called when a product
 * actually carries restrictions -- an unrestricted product never needs
 * this (see the quote-line write routes). */
export async function accountMatchesAnySegment(tenantId: string, account: Account, segmentIds: string[]): Promise<boolean> {
  if (segmentIds.length === 0) return false;
  const segments = await matchedSegments(tenantId, account);
  const matchedIds = new Set(segments.map((s) => s.id));
  return segmentIds.some((id) => matchedIds.has(id));
}
