import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { resolvePermissions, canViewWorkcenter, canCreateWorkcenter, canEditWorkcenter, canDeleteWorkcenter } from "@/lib/permissions";
import { logChange, logChangeBatch, type ChangeEntry } from "@/lib/changeLog";
import { emitEvent } from "@/lib/events/emit";
import { EVENTS } from "@/lib/events/catalog";
import { isSchemaPending } from "@/lib/marketing/pending";
import { resolveCoverageForAccount } from "@/lib/coverage/resolve";
import { matchesAllFilters, type SegmentFilter } from "@/lib/marketingSegmentation";
import { resolveMarketingRecipientsLive } from "@/lib/data/live";
import type { TenantFeatures } from "@/lib/constants";
import type { Account, Segment } from "@/lib/types";
import type { AbmProgram, AbmTargetAccount, AbmTier } from "./types";

// ABM server core (0180-0183, docs/abm-architecture.md).
//
// How tenant isolation holds here, concretely (MULTI_TENANT_GUARDRAILS.md):
//   - every route starts with abmAccess() -> requireTenantUser(); the tenantId
//     used afterwards is only the one that returns, never a body field;
//   - ABM is reachable only when the tenant owns BOTH `marketing` and the
//     platform-admin flag `abm`; otherwise every route answers 404;
//   - queries use the SESSION client (RLS of 0180-0182 is the backstop) and also
//     chain .eq("tenant_id", tenantId); the service-role client is used only
//     for tenant-scoped reads of other modules (coverage, teams, users) and for
//     events, each with its own tenant filter;
//   - every foreign id a body can carry (account, contact, deal, target group,
//     segment) is verified against the tenant before it is used.

export const PENDING_MESSAGE = "ABM is waiting for a database update (migrations 0180 to 0183 have not been applied to this database).";

export const isMissingRelation = isSchemaPending;

export type AbmAction = "view" | "create" | "edit" | "delete";

export type AbmCtx = {
  /** The session client: RLS applies. */
  supabase: SupabaseClient;
  /** The service-role client: bypasses RLS. Tenant-filtered on every query. */
  admin: SupabaseClient;
  tenantId: string;
  userId: string;
  role: "admin" | "member";
  email: string | null;
  can: { view: boolean; create: boolean; edit: boolean; delete: boolean };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** The tenant owns the Marketing module AND the platform-admin flag `abm`. Anything else is "not found". */
export function abmEnabled(features: Partial<TenantFeatures> | null | undefined): boolean {
  return features?.marketing === true && features?.abm === true;
}

export async function abmAccess(action: AbmAction): Promise<AbmCtx> {
  const a = await requireTenantUser();
  const admin = createAdminSupabase();
  const [user, tenant] = await Promise.all([
    getAuthUser(),
    admin.from("tenants").select("features").eq("id", a.tenantId).maybeSingle(),
  ]);
  if (!abmEnabled(tenant.data?.features as Partial<TenantFeatures> | undefined)) throw { status: 404, message: "Not found" };
  const perms = await resolvePermissions(a.supabase, a.tenantId, a.userId, a.role);
  const can = {
    view: canViewWorkcenter(perms, "abm"), create: canCreateWorkcenter(perms, "abm"),
    edit: canEditWorkcenter(perms, "abm"), delete: canDeleteWorkcenter(perms, "abm"),
  };
  if (!can[action]) throw { status: 403, message: "Forbidden" };
  return { ...a, admin, email: user?.email ?? null, can };
}

export function errorResponse(e: unknown): Response {
  const err = e as { status?: number; message?: string };
  if (typeof err.status !== "number") console.error("abm route failed:", e);
  return Response.json({ error: typeof err.status === "number" ? (err.message ?? "Unexpected error") : "Unexpected error" }, { status: err.status ?? 500 });
}

export const pendingResponse = (): Response => Response.json({ error: PENDING_MESSAGE, pending_migration: true }, { status: 503 });

// ── Loaders (each one tenant-filtered) ──────────────────────────────────────

export const PROGRAM_COLUMNS = "id, tenant_id, ref, name, kind, goal, goal_metric, goal_target, starts_on, ends_on, owner_user_id, status, default_tier, required_roles, source_target_group_id, source_segment_id, source_snapshot_at, custom_data, created_by, created_at, updated_at";
export const TARGET_COLUMNS = "id, tenant_id, program_id, account_id, tier, progress, progress_source, progress_reason, progress_changed_at, progress_changed_by, owner_user_id, owner_source, next_step, next_step_due, next_step_user_id, added_via, added_by, dropped_reason, opportunity_id, notes, custom_data, created_at, updated_at";

export type Loaded<T> = { data: T | null; missing: boolean };

export async function loadProgram(ctx: Pick<AbmCtx, "supabase" | "tenantId">, id: string): Promise<Loaded<AbmProgram>> {
  if (!isUuid(id)) return { data: null, missing: false };
  const { data, error } = await ctx.supabase.from("abm_programs").select(PROGRAM_COLUMNS).eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (error) return { data: null, missing: isMissingRelation(error) };
  return { data: (data as unknown as AbmProgram | null) ?? null, missing: false };
}

export async function loadTarget(ctx: Pick<AbmCtx, "supabase" | "tenantId">, id: string): Promise<Loaded<AbmTargetAccount>> {
  if (!isUuid(id)) return { data: null, missing: false };
  const { data, error } = await ctx.supabase.from("abm_target_accounts").select(TARGET_COLUMNS).eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (error) return { data: null, missing: isMissingRelation(error) };
  return { data: (data as unknown as AbmTargetAccount | null) ?? null, missing: false };
}

// ── Foreign-id verification ─────────────────────────────────────────────────

/** The subset of `ids` that are accounts of this tenant. A foreign or invented id simply drops out. */
export async function verifiedAccounts(ctx: Pick<AbmCtx, "supabase" | "tenantId">, ids: readonly string[]): Promise<Account[]> {
  const wanted = [...new Set(ids.filter(isUuid))];
  const out: Account[] = [];
  for (let i = 0; i < wanted.length; i += 150) {
    const { data } = await ctx.supabase.from("accounts").select("*").eq("tenant_id", ctx.tenantId).in("id", wanted.slice(i, i + 150));
    out.push(...((data ?? []) as Account[]));
  }
  return out;
}

/** A contact must belong to this tenant AND to the target's own account. */
export async function contactBelongsToAccount(ctx: Pick<AbmCtx, "supabase" | "tenantId">, contactId: string, accountId: string): Promise<{ id: string; name: string } | null> {
  if (!isUuid(contactId)) return null;
  const { data } = await ctx.supabase.from("contacts").select("id, name").eq("id", contactId).eq("tenant_id", ctx.tenantId).eq("account_id", accountId).maybeSingle();
  return (data as { id: string; name: string } | null) ?? null;
}

/** A deal must belong to this tenant AND to the target's account (a deal for another company cannot be claimed). */
export async function dealBelongsToAccount(ctx: Pick<AbmCtx, "supabase" | "tenantId">, dealId: string, accountId: string): Promise<{ id: string; ref: string | null; title: string } | null> {
  if (!isUuid(dealId)) return null;
  const { data, error } = await ctx.supabase.from("opportunities").select("id, ref, title").eq("id", dealId).eq("tenant_id", ctx.tenantId).eq("account_id", accountId).maybeSingle();
  if (error) return null;
  return (data as { id: string; ref: string | null; title: string } | null) ?? null;
}

export async function targetGroupExists(ctx: Pick<AbmCtx, "supabase" | "tenantId">, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const { data } = await ctx.supabase.from("marketing_target_groups").select("id").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle();
  return !!data;
}

export async function segmentExists(ctx: Pick<AbmCtx, "supabase" | "tenantId">, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const { data } = await ctx.supabase.from("segments").select("id").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle();
  return !!data;
}

/** A colleague must be a member of this workspace. */
export async function isTenantMember(ctx: Pick<AbmCtx, "admin" | "tenantId">, userId: string): Promise<boolean> {
  if (!isUuid(userId)) return false;
  const { data } = await ctx.admin.from("tenant_users").select("user_id").eq("tenant_id", ctx.tenantId).eq("user_id", userId).maybeSingle();
  return !!data;
}

// ── Source lists (a target list is a snapshot of one of these) ──────────────

const SIGNAL_KEYS = new Set(["has_active_amc", "owned_product_skus"]);

/** The accounts a Coverage segment matches right now. Computed signals are loaded only when a rule actually uses them. */
export async function accountIdsForSegment(ctx: Pick<AbmCtx, "supabase" | "tenantId">, segmentId: string): Promise<string[]> {
  const { data: seg } = await ctx.supabase.from("segments").select("*").eq("id", segmentId).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (!seg) return [];
  const segment = seg as Segment;
  const { data: rows } = await ctx.supabase.from("accounts").select("*").eq("tenant_id", ctx.tenantId).limit(5000);
  const accounts = (rows ?? []) as Account[];
  const explicit = new Set(segment.account_ids ?? []);
  const filters = (segment.filters ?? []) as SegmentFilter[];
  const needsSignals = filters.some((f) => SIGNAL_KEYS.has(f.field));
  let signals: (a: Account) => Record<string, unknown> = () => ({});
  if (needsSignals) {
    const { computeAccountSignals } = await import("@/lib/coverage/resolve");
    const computed = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < accounts.length; i += 10) {
      await Promise.all(accounts.slice(i, i + 10).map(async (a) => { computed.set(a.id, { ...(await computeAccountSignals(ctx.tenantId, a.id)) }); }));
    }
    signals = (a) => computed.get(a.id) ?? {};
  }
  return accounts
    .filter((a) => explicit.has(a.id) || (filters.length > 0 && matchesAllFilters({ ...a, ...signals(a) } as unknown as Record<string, unknown>, filters, segment.match ?? "all")))
    .map((a) => a.id);
}

/** The accounts a marketing target group currently resolves to (the same resolver the campaign preview uses). */
export async function accountIdsForTargetGroup(ctx: Pick<AbmCtx, "supabase" | "tenantId">, groupId: string): Promise<string[]> {
  const { data: g } = await ctx.supabase.from("marketing_target_groups").select("*").eq("id", groupId).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (!g) return [];
  const group = g as { account_types: string[]; include_account_ids: string[]; exclude_account_ids: string[]; manual_emails: string[]; filters: SegmentFilter[]; match: "all" | "any" };
  const candidates = await resolveMarketingRecipientsLive(ctx.tenantId, {
    account_types: (group.account_types ?? []) as never,
    include_account_ids: group.include_account_ids ?? [],
    exclude_account_ids: group.exclude_account_ids ?? [],
    manual_emails: [],
    filters: group.filters ?? [],
    match: group.match ?? "all",
  });
  return [...new Set(candidates.map((c) => c.account_id).filter((x): x is string => !!x))];
}

// ── Ownership: through Coverage, never writing the account ──────────────────

export type OwnerResolution = { owner_user_id: string | null; owner_source: "coverage" | "program" };

export async function resolveTargetOwner(ctx: Pick<AbmCtx, "tenantId">, account: Account, program: Pick<AbmProgram, "owner_user_id">): Promise<OwnerResolution> {
  try {
    const resolved = await resolveCoverageForAccount(ctx.tenantId, account);
    const lead = resolved.owner?.team.lead_user_id ?? null;
    if (lead) return { owner_user_id: lead, owner_source: "coverage" };
  } catch {
    // Coverage tables absent or a rule failed: fall back to the program owner, same as "no match".
  }
  return { owner_user_id: program.owner_user_id ?? null, owner_source: "program" };
}

// ── Adding accounts to a program ────────────────────────────────────────────

export const MAX_ADD_PER_CALL = 200;

/** Per-account values a caller can set while adding (Data Workbench import). */
export type AddExtras = Partial<Pick<AbmTargetAccount, "tier" | "next_step" | "next_step_due" | "custom_data">>;

export type AddResult = { added: number; already_in: number; not_found: number; capped: number; ids: string[] };

export async function addTargets(ctx: AbmCtx, program: AbmProgram, accountIds: readonly string[], via: AbmTargetAccount["added_via"], tier?: AbmTier, extras?: Map<string, AddExtras>): Promise<AddResult> {
  const unique = [...new Set(accountIds.filter(isUuid))];
  const capped = Math.max(0, unique.length - MAX_ADD_PER_CALL);
  const accounts = await verifiedAccounts(ctx, unique.slice(0, MAX_ADD_PER_CALL));
  const notFound = Math.min(unique.length, MAX_ADD_PER_CALL) - accounts.length;

  const { data: existingRows } = await ctx.supabase.from("abm_target_accounts").select("account_id").eq("tenant_id", ctx.tenantId).eq("program_id", program.id);
  const already = new Set(((existingRows ?? []) as { account_id: string }[]).map((r) => r.account_id));
  const fresh = accounts.filter((a) => !already.has(a.id));

  const owners = new Map<string, OwnerResolution>();
  for (let i = 0; i < fresh.length; i += 10) {
    await Promise.all(fresh.slice(i, i + 10).map(async (a) => { owners.set(a.id, await resolveTargetOwner(ctx, a, program)); }));
  }

  const rows = fresh.map((a) => ({
    tenant_id: ctx.tenantId,
    program_id: program.id,
    account_id: a.id,
    tier: tier ?? program.default_tier,
    progress: "planned",
    progress_source: "rule",
    owner_user_id: owners.get(a.id)?.owner_user_id ?? null,
    owner_source: owners.get(a.id)?.owner_source ?? "program",
    added_via: via,
    added_by: ctx.userId,
    ...(extras?.get(a.id) ?? {}),
  }));
  if (rows.length === 0) return { added: 0, already_in: accounts.length, not_found: notFound, capped, ids: [] };

  const { data, error } = await ctx.supabase.from("abm_target_accounts").upsert(rows, { onConflict: "tenant_id,program_id,account_id", ignoreDuplicates: true }).select("id, account_id");
  if (error) throw error;
  const made = (data ?? []) as { id: string; account_id: string }[];
  const nameOf = new Map(fresh.map((a) => [a.id, a.name]));

  await logChangeBatch(ctx.supabase, made.map((m) => ({
    tenantId: ctx.tenantId, objectType: "abm_target_accounts", objectId: m.id, objectLabel: `${nameOf.get(m.account_id) ?? "Account"} in ${program.name}`,
    action: "create" as const, actorId: ctx.userId, actorEmail: ctx.email, changes: [{ field: "added_via", from: null, to: via }],
  })));
  for (let i = 0; i < made.length; i += 25) {
    await Promise.all(made.slice(i, i + 25).map((m) => emitEvent(ctx.tenantId, {
      name: EVENTS.ABM_TARGET_ADDED, object_type: "abm_target", object_id: m.id, actor_id: ctx.userId, account_id: m.account_id,
      key: `${m.id}:added`, payload: { program_id: program.id, target_account_id: m.id, tier: tier ?? program.default_tier, added_via: via },
    }, ctx.admin)));
  }
  return { added: made.length, already_in: accounts.length - fresh.length, not_found: notFound, capped, ids: made.map((m) => m.id) };
}

// ── Change history ──────────────────────────────────────────────────────────

/** A private rep note is logged as "changed", never as its text. */
export function redactNotes(changes: ChangeEntry[]): ChangeEntry[] {
  return changes.map((c) => (c.field === "notes" ? { field: "notes", from: c.from ? "[note]" : null, to: c.to ? "[note]" : null, redacted: true } : c));
}

export async function logTargetChange(ctx: AbmCtx, target: Pick<AbmTargetAccount, "id">, label: string, changes: ChangeEntry[]) {
  if (changes.length === 0) return;
  await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "abm_target_accounts", objectId: target.id, objectLabel: label, action: "update", actorId: ctx.userId, actorEmail: ctx.email, changes: redactNotes(changes) });
}
