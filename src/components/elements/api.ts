// The one fetch helper of the buildings and elements screens: JSON in, JSON out, the server's own words for a refusal.

export type CallResult<T = Record<string, unknown>> = { ok: boolean; status: number; j: T & { error?: string } };

export async function call<T = Record<string, unknown>>(url: string, method: string, body?: unknown): Promise<CallResult<T>> {
  try {
    const res = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = (await res.json().catch(() => ({}))) as T & { error?: string };
    return { ok: res.ok, status: res.status, j };
  } catch {
    return { ok: false, status: 0, j: { error: "Network error. Try again." } as T & { error?: string } };
  }
}

/** The API root of a record: `/api/contract-projects/<id>` or `/api/opportunities/<id>/tender`. The routes below it have the same names on both. */
export const projectRoot = (id: string) => `/api/contract-projects/${id}`;
export const tenderRoot = (id: string) => `/api/opportunities/${id}/tender`;
