import type { Call, EmployeeLite, Login, Member, RoleFull } from "./logic";

// Thin wrappers over the routes Settings > Team, Business Users and Business Roles always used. Nothing here
// decides who may do what: every route keeps its own admin, feature and tenant checks.

async function send<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `Request failed (${res.status})`);
  return json as T;
}

export type PeopleData = { members: Member[]; logins: Login[]; roles: RoleFull[]; employees: EmployeeLite[] };

/** The Business Roles module adds the login controls, the roles and the employee list; without it a person is just a member. */
export async function loadPeople(businessRoles: boolean): Promise<PeopleData> {
  const team = await send<{ members?: Member[] }>("/api/settings/team");
  if (!businessRoles) return { members: team.members ?? [], logins: [], roles: [], employees: [] };
  const [users, roles, employees] = await Promise.all([
    send<{ users?: Login[] }>("/api/business-users"),
    send<{ roles?: RoleFull[] }>("/api/business-roles"),
    send<EmployeeLite[]>("/api/employees"),
  ]);
  return {
    members: team.members ?? [],
    logins: users.users ?? [],
    roles: roles.roles ?? [],
    employees: Array.isArray(employees) ? employees : [],
  };
}

export function run<T = Record<string, unknown>>(call: Call): Promise<T> {
  return send<T>(call.url, {
    method: call.method,
    headers: { "Content-Type": "application/json" },
    body: call.method === "DELETE" ? undefined : JSON.stringify(call.body),
    keepalive: call.method === "DELETE",
  });
}

export const removeMember = (userId: string) => send(`/api/settings/team/${userId}`, { method: "DELETE", keepalive: true });

export type RoleInput = { name: string; description: string | null; grants: unknown[] };
export const createRole = (input: RoleInput) =>
  send<RoleFull>("/api/business-roles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
export const updateRole = (id: string, input: RoleInput) =>
  send(`/api/business-roles/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
export const deleteRole = (id: string) => send(`/api/business-roles/${id}`, { method: "DELETE", keepalive: true });
export const duplicateRole = (id: string) =>
  send<RoleFull>("/api/business-roles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ duplicate_of: id }) });
export const resyncRole = (id: string) => send(`/api/business-roles/${id}/resync`, { method: "POST" });
export const saveRoleDashboard = (id: string, layout: unknown[]) =>
  send(`/api/business-roles/${id}/dashboard`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dashboard_layout: layout }) });
