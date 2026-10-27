// The one thin client module the supplier Groups view fetches through (API contract: docs/design/contract-buyout.md section 5, "Supplier
// groups"). Every call answers `{ ok, status, json }` and never throws.

export type SupplierGroup = {
  id: string;
  name: string;
  /** The client account the group belongs to; a client has at most one group. */
  account_id: string | null;
  account_name?: string | null;
  active?: boolean;
  note?: string | null;
  member_count?: number | null;
};

export type GroupSupplier = { id: string; name: string; type: string | null; city: string | null; status: string };

export type GroupCall<T> = { ok: boolean; status: number; json: T & { error?: string } };

const J = { "Content-Type": "application/json" };

async function call<T>(url: string, init?: RequestInit): Promise<GroupCall<T>> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: { error: "Network error. Try again." } as T & { error?: string } };
  }
}

export const GROUPS_URL = "/api/supplier-groups";
export const groupUrl = (id: string) => `${GROUPS_URL}/${id}`;
export const membersUrl = (id: string) => `${GROUPS_URL}/${id}/members`;

/** The list answers an array or `{ groups }`. */
export function readGroups(json: unknown): SupplierGroup[] {
  const v = Array.isArray(json) ? json : (json as { groups?: unknown } | null)?.groups;
  return (Array.isArray(v) ? v : []).filter((g): g is SupplierGroup => !!g && typeof (g as SupplierGroup).id === "string");
}

/** A create answers the group itself or `{ group }`. */
export const readCreatedId = (json: unknown): string | null => {
  const j = (json ?? {}) as { id?: string; group?: { id?: string } };
  return j.group?.id ?? j.id ?? null;
};

export const listGroups = () => call<unknown>(GROUPS_URL);
export const createGroup = (body: { name: string; account_id: string | null }) => call<unknown>(GROUPS_URL, { method: "POST", headers: J, body: JSON.stringify(body) });
export const updateGroup = (id: string, body: { name: string; account_id: string | null }) => call<unknown>(groupUrl(id), { method: "PATCH", headers: J, body: JSON.stringify(body) });
export const deleteGroup = (id: string) => call<unknown>(groupUrl(id), { method: "DELETE" });
export const setMembers = (id: string, supplierIds: string[]) => call<unknown>(membersUrl(id), { method: "PUT", headers: J, body: JSON.stringify({ supplier_ids: supplierIds }) });
/** The members of a group: the supplier list filtered by it (GET /api/suppliers?group=). */
export const loadMembers = (id: string) => call<unknown>(`/api/suppliers?group=${encodeURIComponent(id)}`);
