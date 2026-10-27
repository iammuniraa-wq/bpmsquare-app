// Supplier groups: a client's approved vendor list (docs/design/contract-buyout.md section 0b, decision 2). PURE: the routes, the screens and
// the tests share these rules.

export const GROUP_LIMITS = { name: 120, note: 1000, maxMembers: 2000 } as const;
export const SUPPLIER_GROUPS_BUNDLE = "scripts/run-bundle-42-contract-buyout-2026-10-28.sql";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export type GroupRow = {
  id: string;
  name: string;
  account_id: string | null;
  note: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type GroupView = GroupRow & { account_name: string | null; member_count: number; supplier_ids: string[] };

export type GroupInput = { name?: string; account_id?: string | null; note?: string | null; active?: boolean; supplier_ids?: string[] };
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t.slice(0, max);
};

/** The shape of a group from a request body. A new group needs a name; the account, the note, the active switch and the first members are optional. */
export function parseGroup(body: unknown, mode: "create" | "update"): Parsed<GroupInput> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid body" };
  const o = body as Record<string, unknown>;
  const out: GroupInput = {};
  if (mode === "create" || "name" in o) {
    const name = text(o.name, GROUP_LIMITS.name);
    if (!name) return { ok: false, error: "Give the group a name" };
    out.name = name;
  }
  if ("account_id" in o) {
    if (o.account_id === null || o.account_id === "") out.account_id = null;
    else if (isUuid(o.account_id)) out.account_id = o.account_id.toLowerCase();
    else return { ok: false, error: "The client account is not valid" };
  }
  if ("note" in o) {
    if (o.note !== null && typeof o.note !== "string") return { ok: false, error: "Note must be text" };
    out.note = text(o.note, GROUP_LIMITS.note);
  }
  if ("active" in o) {
    if (typeof o.active !== "boolean") return { ok: false, error: "Active must be true or false" };
    out.active = o.active;
  }
  if ("supplier_ids" in o) {
    const m = parseMembers(o);
    if (!m.ok) return m;
    out.supplier_ids = m.value;
  }
  return { ok: true, value: out };
}

/** `{ supplier_ids: [...] }` -> the unique ids. An empty list is allowed (it empties the group). */
export function parseMembers(body: unknown): Parsed<string[]> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid body" };
  const ids = (body as Record<string, unknown>).supplier_ids;
  if (!Array.isArray(ids)) return { ok: false, error: "supplier_ids must be a list" };
  if (ids.some((x) => !isUuid(x))) return { ok: false, error: "A supplier id is not valid" };
  const unique = [...new Set((ids as string[]).map((x) => x.toLowerCase()))];
  if (unique.length > GROUP_LIMITS.maxMembers) return { ok: false, error: `A group holds up to ${GROUP_LIMITS.maxMembers} suppliers` };
  return { ok: true, value: unique };
}

export type Restriction = {
  /** The client's approved list limits the suppliers. False means every supplier may be asked. */
  restricted: boolean;
  group: { id: string; name: string } | null;
  /** Only meaningful when restricted. */
  supplier_ids: string[];
};

export const NOT_RESTRICTED: Restriction = { restricted: false, group: null, supplier_ids: [] };

/** The rule: an ACTIVE group with at least one member limits the pickers to its members; anything else leaves all suppliers open. */
export function restrictionFrom(group: { id: string; name: string; active: boolean } | null | undefined, memberIds: readonly string[]): Restriction {
  if (!group || !group.active || memberIds.length === 0) return NOT_RESTRICTED;
  return { restricted: true, group: { id: group.id, name: group.name }, supplier_ids: [...new Set(memberIds)] };
}

/** The suppliers among `wanted` that the restriction does not allow. */
export function outsideRestriction(r: Restriction, wanted: readonly string[]): string[] {
  if (!r.restricted) return [];
  const ok = new Set(r.supplier_ids);
  return [...new Set(wanted)].filter((id) => !ok.has(id));
}

export function restrictionMessage(groupName: string, names: readonly string[]): string {
  const shown = names.slice(0, 5).join(", ");
  const more = names.length > 5 ? ` and ${names.length - 5} more` : "";
  return `Not on the approved list "${groupName}": ${shown}${more}. Add them to the group in Suppliers, or choose suppliers from the list.`;
}
