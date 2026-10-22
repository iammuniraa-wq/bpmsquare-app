// The calls Settings > Workforce makes. Every route is an existing one with its own admin guard; this only wraps the
// fetch so each panel reports a failure the same way.

export class CallError extends Error {}

export async function call<T = unknown>(url: string, method = "GET", body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new CallError("Network error. Try again.");
  }
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new CallError((json as { error?: string } | null)?.error ?? "Could not save.");
  return json as T;
}

export const messageOf = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Try again.");
