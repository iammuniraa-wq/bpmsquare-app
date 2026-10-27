import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logChange } from "@/lib/changeLog";
import { canEditWorkcenter, canViewWorkcenter, resolvePermissions } from "@/lib/permissions";
import { createAdminSupabase, getAuthUser, requireTenantUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { isMissingSchema } from "@/lib/tender/server";
import {
  NOT_RESTRICTED, SUPPLIER_GROUPS_BUNDLE, isUuid, outsideRestriction, restrictionFrom, restrictionMessage,
  type GroupInput, type GroupRow, type GroupView, type Restriction,
} from "./rules";

// Server side of the supplier groups (migration 0233). Every query is tenant-scoped on the service-role client (the tables have a tenant
// SELECT policy and nothing that writes), every id from a request is verified against the workspace first, and every read tolerates the
// migration being pending: a missing table reads as "no group", which leaves all suppliers open, never as a crash.

export type GroupCtx = { admin: SupabaseClient; supabase: SupabaseClient; tenantId: string; userId: string; role: "admin" | "member"; canEdit: boolean };
export type Failure = { status: number; error: string; extra?: Record<string, unknown> };
type Result<T> = ({ ok: true } & T) | ({ ok: false } & Failure);

export const needsGroupUpdate = (): Failure => ({
  status: 503, error: "Supplier groups need a database update (migration 0233). Ask your administrator to apply it.",
  extra: { needsDatabaseUpdate: true, bundle: SUPPLIER_GROUPS_BUNDLE },
});

const GROUP_COLS = "id, name, account_id, note, active, created_at, updated_at";

/**
 * The door of the /api/supplier-groups routes: a signed-in member of a workspace that has the tender edition and the Suppliers module,
 * who may open Suppliers (`write` also needs the edit grant). Any miss on the flags is a plain 404, so a standard workspace cannot tell
 * the groups exist.
 */
export async function openGroupRequest(opts: { write?: boolean } = {}): Promise<{ ok: true; req: GroupCtx } | ({ ok: false } & Failure)> {
  let ctx;
  try {
    ctx = await requireTenantUser();
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return { ok: false, status: err.status ?? 401, error: err.message ?? "Unauthorized" };
  }
  const { supabase, tenantId, userId, role } = ctx;
  const notFound = { ok: false as const, status: 404, error: "Not found" };
  for (const key of ["gcc_tender", "suppliers"] as const) {
    if (!(await tenantHasFeature(supabase, tenantId, key))) return notFound;
  }
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  if (!canViewWorkcenter(perms, "suppliers")) return notFound;
  const canEdit = canEditWorkcenter(perms, "suppliers");
  if (opts.write && !canEdit) return { ok: false, status: 403, error: "You can view suppliers but not change them" };
  return { ok: true, req: { admin: createAdminSupabase(), supabase, tenantId, userId, role, canEdit } };
}

const normaliseGroup = (r: Record<string, unknown>): GroupRow => ({ ...(r as unknown as GroupRow), active: r.active !== false });

// ── The restriction ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Which suppliers a client's tenders may ask. An ACTIVE group linked to the account with at least one member means ONLY those suppliers;
 * no group (or an inactive or empty one, or the migration still pending) means all suppliers. `admin` is only for tests and callers that
 * already hold one; it defaults to the service-role client. Always scoped to `tenantId`.
 */
export async function allowedSuppliersForAccount(tenantId: string, accountId: string | null | undefined, admin: SupabaseClient = createAdminSupabase()): Promise<Restriction> {
  if (!accountId || !isUuid(accountId)) return NOT_RESTRICTED;
  const g = await admin.from("supplier_groups").select("id, name, active").eq("tenant_id", tenantId).eq("account_id", accountId).maybeSingle();
  if (g.error || !g.data) return NOT_RESTRICTED;
  const group = g.data as { id: string; name: string; active: boolean };
  if (group.active === false) return NOT_RESTRICTED;
  const m = await admin.from("supplier_group_members").select("supplier_id").eq("tenant_id", tenantId).eq("group_id", group.id).limit(5000);
  if (m.error) return NOT_RESTRICTED;
  return restrictionFrom(group, ((m.data ?? []) as { supplier_id: string }[]).map((x) => x.supplier_id));
}

/** The suppliers of `ids` outside the restriction, as `{ id, name }`, plus the 422 answer a route gives for them. */
export async function checkAllowed(admin: SupabaseClient, tenantId: string, restriction: Restriction, supplierIds: readonly string[]): Promise<{ ok: true } | ({ ok: false } & Failure)> {
  const outside = outsideRestriction(restriction, supplierIds);
  if (outside.length === 0 || !restriction.group) return { ok: true };
  const { data } = await admin.from("suppliers").select("id, name").eq("tenant_id", tenantId).in("id", outside);
  const found = new Map(((data ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));
  const named = outside.map((id) => ({ supplier_id: id, name: found.get(id) ?? "Unknown supplier" }));
  return {
    ok: false, status: 422, error: restrictionMessage(restriction.group.name, named.map((n) => n.name)),
    extra: { code: "outside_approved_list", group: restriction.group, not_allowed: named },
  };
}

/** The account a tender deal belongs to, when `dealId` is a TENDER deal of this workspace (a plain deal answers null: the restriction does not apply to it). */
async function tenderDealAccount(admin: SupabaseClient, tenantId: string, dealId: string): Promise<{ account_id: string | null } | null> {
  if (!isUuid(dealId)) return null;
  const t = await admin.from("opportunity_tenders").select("opportunity_id").eq("tenant_id", tenantId).eq("opportunity_id", dealId).maybeSingle();
  if (t.error || !t.data) return null;
  const o = await admin.from("opportunities").select("account_id").eq("id", dealId).eq("tenant_id", tenantId).maybeSingle();
  if (o.error || !o.data) return null;
  return { account_id: (o.data as { account_id: string | null }).account_id ?? null };
}

async function tenderEdition(admin: SupabaseClient, tenantId: string): Promise<boolean> {
  const { data } = await admin.from("tenants").select("features").eq("id", tenantId).maybeSingle();
  return !!(data?.features as Record<string, boolean> | undefined)?.gcc_tender;
}

/**
 * The restriction for an RFQ that is, or is about to be, a TENDER RFQ: raised from a tender deal (origin opportunity), from an estimate made
 * for one (origin estimate), or a buy-out round (package_id, the project's client). Null when it is none of those, or the workspace has no
 * tender edition: standard RFQs are never restricted.
 */
export async function restrictionForRfqOrigin(admin: SupabaseClient, tenantId: string, a: { origin_type?: string | null; origin_id?: string | null; package_id?: string | null }): Promise<Restriction | null> {
  if (!(await tenderEdition(admin, tenantId))) return null;
  let accountId: string | null | undefined;
  let tender = false;
  if (a.package_id && isUuid(a.package_id)) {
    const p = await admin.from("project_buyout_packages").select("project_id").eq("id", a.package_id).eq("tenant_id", tenantId).maybeSingle();
    const projectId = (p.data as { project_id?: string } | null)?.project_id;
    if (projectId) {
      const c = await admin.from("contract_projects").select("account_id").eq("id", projectId).eq("tenant_id", tenantId).maybeSingle();
      if (c.data) { tender = true; accountId = (c.data as { account_id: string | null }).account_id; }
    }
  } else if (a.origin_type === "opportunity" && a.origin_id) {
    const deal = await tenderDealAccount(admin, tenantId, a.origin_id);
    if (deal) { tender = true; accountId = deal.account_id; }
  } else if (a.origin_type === "estimate" && a.origin_id && isUuid(a.origin_id)) {
    const e = await admin.from("estimates").select("opportunity_id").eq("id", a.origin_id).eq("tenant_id", tenantId).maybeSingle();
    const oppId = (e.data as { opportunity_id?: string | null } | null)?.opportunity_id;
    const deal = oppId ? await tenderDealAccount(admin, tenantId, oppId) : null;
    if (deal) { tender = true; accountId = deal.account_id; }
  }
  if (!tender) return null;
  return allowedSuppliersForAccount(tenantId, accountId, admin);
}

/**
 * The one check every tender RFQ path runs before it links suppliers: create (POST /api/rfqs), add suppliers (POST /api/rfqs/[id]/suppliers) and
 * a buy-out round. `existing` is an RFQ that already exists (its origin and package come from its row). Answers ok, or the 422 naming the suppliers.
 */
export async function assertTenderSuppliersAllowed(
  admin: SupabaseClient, tenantId: string, rfq: { origin_type?: string | null; origin_id?: string | null; package_id?: string | null }, supplierIds: readonly string[],
): Promise<{ ok: true } | ({ ok: false } & Failure)> {
  if (supplierIds.length === 0) return { ok: true };
  const restriction = await restrictionForRfqOrigin(admin, tenantId, rfq);
  if (!restriction || !restriction.restricted) return { ok: true };
  return checkAllowed(admin, tenantId, restriction, supplierIds);
}

/** The package an existing RFQ belongs to, tolerating 0234 not being there yet (then there is none). */
export async function packageOfRfq(admin: SupabaseClient, tenantId: string, rfqId: string): Promise<string | null> {
  const { data, error } = await admin.from("rfqs").select("package_id").eq("id", rfqId).eq("tenant_id", tenantId).maybeSingle();
  if (error || !data) return null;
  return (data as { package_id?: string | null }).package_id ?? null;
}

// ── Reads ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function loadGroups(admin: SupabaseClient, tenantId: string): Promise<{ groups: GroupView[]; pending: boolean }> {
  const g = await admin.from("supplier_groups").select(GROUP_COLS).eq("tenant_id", tenantId).order("name", { ascending: true }).limit(1000);
  if (g.error) return { groups: [], pending: isMissingSchema(g.error) };
  const rows = ((g.data ?? []) as Record<string, unknown>[]).map(normaliseGroup);
  const members = await admin.from("supplier_group_members").select("group_id, supplier_id").eq("tenant_id", tenantId).limit(20000);
  const byGroup = new Map<string, string[]>();
  for (const m of (members.error ? [] : (members.data ?? [])) as { group_id: string; supplier_id: string }[]) byGroup.set(m.group_id, [...(byGroup.get(m.group_id) ?? []), m.supplier_id]);
  const accountIds = [...new Set(rows.map((r) => r.account_id).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  for (let i = 0; i < accountIds.length; i += 100) {
    const { data } = await admin.from("accounts").select("id, name").eq("tenant_id", tenantId).in("id", accountIds.slice(i, i + 100));
    for (const a of (data ?? []) as { id: string; name: string }[]) names.set(a.id, a.name);
  }
  return {
    pending: false,
    groups: rows.map((r) => {
      const ids = byGroup.get(r.id) ?? [];
      return { ...r, account_name: r.account_id ? names.get(r.account_id) ?? null : null, member_count: ids.length, supplier_ids: ids };
    }),
  };
}

export async function loadGroup(admin: SupabaseClient, tenantId: string, id: string): Promise<GroupRow | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await admin.from("supplier_groups").select(GROUP_COLS).eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  return error || !data ? null : normaliseGroup(data as Record<string, unknown>);
}

/** Active suppliers of the workspace for a picker, optionally only the members of a group. */
export async function loadPickerSuppliers(admin: SupabaseClient, tenantId: string, only: readonly string[] | null): Promise<PickerSupplier[]> {
  const out: PickerSupplier[] = [];
  const ids = only ? [...only] : null;
  if (ids && ids.length === 0) return out;
  const cols = "id, ref, name, email, city, status, type";
  if (ids) {
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await admin.from("suppliers").select(cols).eq("tenant_id", tenantId).in("id", ids.slice(i, i + 100));
      out.push(...((data ?? []) as PickerSupplier[]));
    }
  } else {
    const { data } = await admin.from("suppliers").select(cols).eq("tenant_id", tenantId).order("name", { ascending: true }).limit(5000);
    out.push(...((data ?? []) as PickerSupplier[]));
  }
  return out.filter((s) => s.status !== "inactive").sort((a, b) => a.name.localeCompare(b.name));
}

export type PickerSupplier = { id: string; ref: string | null; name: string; email: string | null; city: string | null; status: string; type: string | null };

// ── Writes ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

async function logGroup(req: GroupCtx, group: Pick<GroupRow, "id" | "name">, action: "create" | "update" | "delete", changes: { field: string; from: unknown; to: unknown }[]) {
  const user = await getAuthUser();
  await logChange(req.admin, { tenantId: req.tenantId, objectType: "supplier_groups", objectId: group.id, objectLabel: group.name, action, actorId: user?.id ?? req.userId, actorEmail: user?.email, changes });
}

async function accountProblem(req: GroupCtx, accountId: string, ownGroupId: string | null): Promise<Failure | null> {
  const a = await req.admin.from("accounts").select("id, name").eq("id", accountId).eq("tenant_id", req.tenantId).maybeSingle();
  if (!a.data) return { status: 404, error: "That client account was not found" };
  const other = await req.admin.from("supplier_groups").select("id, name").eq("tenant_id", req.tenantId).eq("account_id", accountId).limit(5);
  const clash = ((other.error ? [] : other.data ?? []) as { id: string; name: string }[]).find((g) => g.id !== ownGroupId);
  if (clash) return { status: 409, error: `That client already has an approved list: "${clash.name}". A client has one list.` };
  return null;
}

async function nameProblem(req: GroupCtx, name: string, ownGroupId: string | null): Promise<Failure | null> {
  const { data, error } = await req.admin.from("supplier_groups").select("id, name").eq("tenant_id", req.tenantId).limit(2000);
  if (error) return isMissingSchema(error) ? needsGroupUpdate() : { status: 500, error: error.message };
  const clash = ((data ?? []) as { id: string; name: string }[]).find((g) => g.id !== ownGroupId && g.name.trim().toLowerCase() === name.trim().toLowerCase());
  return clash ? { status: 409, error: `There is already a group called "${clash.name}"` } : null;
}

export async function createGroup(req: GroupCtx, input: GroupInput): Promise<Result<{ group: GroupRow }>> {
  const name = input.name as string;
  const bad = await nameProblem(req, name, null);
  if (bad) return { ok: false, ...bad };
  if (input.account_id) {
    const p = await accountProblem(req, input.account_id, null);
    if (p) return { ok: false, ...p };
  }
  const ins = await req.admin.from("supplier_groups").insert({
    tenant_id: req.tenantId, name, account_id: input.account_id ?? null, note: input.note ?? null, active: input.active !== false, created_by: req.userId,
  }).select(GROUP_COLS).single();
  if (ins.error || !ins.data) {
    if (isMissingSchema(ins.error)) return { ok: false, ...needsGroupUpdate() };
    if (ins.error?.code === "23505") return { ok: false, status: 409, error: "That name or that client already has a group" };
    return { ok: false, status: 500, error: ins.error?.message ?? "Could not save the group" };
  }
  const group = normaliseGroup(ins.data as Record<string, unknown>);
  await logGroup(req, group, "create", [
    { field: "name", from: null, to: group.name },
    ...(group.account_id ? [{ field: "client account", from: null, to: group.account_id }] : []),
  ]);
  if (input.supplier_ids && input.supplier_ids.length > 0) {
    const set = await setGroupMembers(req, group, input.supplier_ids);
    if (!set.ok) {
      await req.admin.from("supplier_groups").delete().eq("id", group.id).eq("tenant_id", req.tenantId);
      return set;
    }
  }
  return { ok: true, group };
}

export async function updateGroup(req: GroupCtx, group: GroupRow, input: GroupInput): Promise<Result<{ group: GroupRow }>> {
  if (input.name !== undefined && input.name !== group.name) {
    const bad = await nameProblem(req, input.name, group.id);
    if (bad) return { ok: false, ...bad };
  }
  if (input.account_id) {
    const p = await accountProblem(req, input.account_id, group.id);
    if (p) return { ok: false, ...p };
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ["name", "account_id", "note", "active"] as const) if (k in input && input[k] !== undefined) patch[k] = input[k];
  const up = await req.admin.from("supplier_groups").update(patch).eq("id", group.id).eq("tenant_id", req.tenantId).select(GROUP_COLS);
  if (up.error) {
    if (up.error.code === "23505") return { ok: false, status: 409, error: "That name or that client already has a group" };
    return { ok: false, status: isMissingSchema(up.error) ? 503 : 500, error: up.error.message };
  }
  const row = (up.data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return { ok: false, status: 404, error: "Not found" };
  const next = normaliseGroup(row);
  const changes = (["name", "account_id", "note", "active"] as const)
    .filter((k) => k in input && JSON.stringify(group[k] ?? null) !== JSON.stringify(next[k] ?? null))
    .map((k) => ({ field: k === "account_id" ? "client account" : k, from: group[k] ?? null, to: next[k] ?? null }));
  if (changes.length > 0) await logGroup(req, next, "update", changes);
  if (input.supplier_ids) {
    const set = await setGroupMembers(req, next, input.supplier_ids);
    if (!set.ok) return set;
  }
  return { ok: true, group: next };
}

export async function deleteGroup(req: GroupCtx, group: GroupRow): Promise<Result<object>> {
  const del = await req.admin.from("supplier_groups").delete().eq("id", group.id).eq("tenant_id", req.tenantId);
  if (del.error) return { ok: false, status: 500, error: del.error.message };
  await logGroup(req, group, "delete", [{ field: "name", from: group.name, to: null }]);
  return { ok: true };
}

/** Replaces the members of a group with `ids`. Every id is verified against the workspace first; the new rows go in before the old ones come out. */
export async function setGroupMembers(req: GroupCtx, group: Pick<GroupRow, "id" | "name">, ids: readonly string[]): Promise<Result<{ added: string[]; removed: string[] }>> {
  const { admin, tenantId, userId } = req;
  const wanted = [...new Set(ids)];
  const names = new Map<string, string>();
  for (let i = 0; i < wanted.length; i += 100) {
    const { data } = await admin.from("suppliers").select("id, name").eq("tenant_id", tenantId).in("id", wanted.slice(i, i + 100));
    for (const s of (data ?? []) as { id: string; name: string }[]) names.set(s.id, s.name);
  }
  if (names.size !== wanted.length) return { ok: false, status: 404, error: "A supplier was not found" };
  const cur = await admin.from("supplier_group_members").select("supplier_id").eq("tenant_id", tenantId).eq("group_id", group.id).limit(20000);
  if (cur.error) return { ok: false, ...(isMissingSchema(cur.error) ? needsGroupUpdate() : { status: 500, error: cur.error.message }) };
  const have = new Set(((cur.data ?? []) as { supplier_id: string }[]).map((r) => r.supplier_id));
  const added = wanted.filter((id) => !have.has(id));
  const removed = [...have].filter((id) => !names.has(id));
  for (let i = 0; i < added.length; i += 500) {
    const ins = await admin.from("supplier_group_members").insert(added.slice(i, i + 500).map((supplier_id) => ({ tenant_id: tenantId, group_id: group.id, supplier_id, created_by: userId })));
    if (ins.error) return { ok: false, status: 500, error: ins.error.message };
  }
  for (let i = 0; i < removed.length; i += 200) {
    const del = await admin.from("supplier_group_members").delete().eq("tenant_id", tenantId).eq("group_id", group.id).in("supplier_id", removed.slice(i, i + 200));
    if (del.error) return { ok: false, status: 500, error: del.error.message };
  }
  const removedNames = new Map<string, string>();
  if (removed.length) {
    const { data } = await admin.from("suppliers").select("id, name").eq("tenant_id", tenantId).in("id", removed.slice(0, 200));
    for (const s of (data ?? []) as { id: string; name: string }[]) removedNames.set(s.id, s.name);
  }
  if (added.length > 0 || removed.length > 0) {
    await logGroup(req, group, "update", [
      ...(added.length ? [{ field: "suppliers added", from: null, to: added.map((id) => names.get(id)).join(", ").slice(0, 900) }] : []),
      ...(removed.length ? [{ field: "suppliers removed", from: removed.map((id) => removedNames.get(id) ?? id).join(", ").slice(0, 900), to: null }] : []),
    ]);
  }
  return { ok: true, added, removed };
}
