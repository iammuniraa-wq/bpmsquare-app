// The one thin client module the Buy-out screens fetch through (API contract: docs/design/contract-buyout.md section 5). Nothing else in the
// Buy-out components calls fetch, so the routes can change shape in one place and a test can read the list of calls. Every call answers
// `{ ok, status, json }` and never throws: a network failure is `ok: false` with an error sentence, which the screens show.

export type ApiResult<T> = { ok: boolean; status: number; json: T & { error?: string } };

const J = { "Content-Type": "application/json" };

async function call<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: { error: "Network error. Try again." } as T & { error?: string } };
  }
}

const send = (method: string, body: unknown): RequestInit => ({ method, headers: J, body: JSON.stringify(body) });

export const buyoutUrl = (projectId: string) => `/api/contract-projects/${projectId}/buyout`;
export const packagesUrl = (projectId: string) => `${buyoutUrl(projectId)}/packages`;
export const packageUrl = (projectId: string, packageId: string) => `${packagesUrl(projectId)}/${packageId}`;
export const handoverUrl = (projectId: string, packageId: string) => `${packageUrl(projectId, packageId)}/handover`;

/** The 404 / 501 / 503 a route answers while its migration is pending, or the flag the route itself sets. */
export const isPending = (status: number, json: { pending?: boolean } | null | undefined) => !!json?.pending || status === 404 || status === 501 || status === 503;

export const loadBuyout = <T>(projectId: string) => call<T>(buyoutUrl(projectId));
export const loadPackage = <T>(projectId: string, packageId: string) => call<T>(packageUrl(projectId, packageId));
export const loadPackageSuppliers = <T>(projectId: string, packageId: string) => call<T>(`${packageUrl(projectId, packageId)}/suppliers`);

export const createPackage = <T>(projectId: string, body: { name: string; kind: string; budget_line_ids: string[] }) => call<T>(packagesUrl(projectId), send("POST", body));
export const deletePackage = <T>(projectId: string, packageId: string) => call<T>(packageUrl(projectId, packageId), { method: "DELETE" });

export const sendRound = <T>(projectId: string, packageId: string, body: { supplier_ids: string[]; reply_by?: string; note?: string }) => call<T>(`${packageUrl(projectId, packageId)}/rounds`, send("POST", body));
export const awardPackage = <T>(projectId: string, packageId: string, body: { rfq_id: string; supplier_id: string; reason?: string }) => call<T>(`${packageUrl(projectId, packageId)}/award`, send("POST", body));
export const unawardPackage = <T>(projectId: string, packageId: string, body: { reason: string }) => call<T>(`${packageUrl(projectId, packageId)}/unaward`, send("POST", body));
export const markSent = <T>(projectId: string, packageId: string, body: { erp_ref?: string }) => call<T>(handoverUrl(projectId, packageId), send("POST", { action: "mark_sent", ...body }));
