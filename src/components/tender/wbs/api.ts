// The one way the WBS components call the tender WBS routes: JSON in, the error text out. The workspace and the deal are the server's.

export type CallResult<T = Record<string, unknown>> = { ok: true; data: T } | { ok: false; error: string; status: number };

export async function call<T = Record<string, unknown>>(url: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<CallResult<T>> {
  try {
    const res = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: typeof j.error === "string" ? j.error : "Could not save", status: res.status };
    return { ok: true, data: j as T };
  } catch {
    return { ok: false, error: "Network error. Try again.", status: 0 };
  }
}
