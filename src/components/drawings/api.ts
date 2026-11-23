"use client";

import { createBrowserSupabase } from "@/lib/supabase-browser";
import { DRAWING_FILE_BUCKET } from "@/lib/drawings/files";

// Browser side of the register's calls. Every call is a plain fetch to the route; the workspace is the server's, never this code's.

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; problems?: string[]; extra?: Record<string, unknown> };

export async function call<T = Record<string, unknown>>(url: string, method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 204) return { ok: true, data: {} as T };
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: typeof json.error === "string" ? json.error : `Something went wrong (${res.status})`, problems: Array.isArray(json.problems) ? (json.problems as string[]) : undefined, extra: json };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, error: "The server could not be reached. Check the connection and try again" };
  }
}

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Attach a file to a draft revision: ask for a target, send the bytes straight to the private bucket, then let the server read what arrived. */
export async function attachFile(drawingId: string, revisionId: string, file: File): Promise<ApiResult<Record<string, unknown>>> {
  const base = `/api/drawings/${drawingId}/revisions/${revisionId}`;
  const target = await call<{ path: string; token: string }>(`${base}/upload`, "POST", { name: file.name, size: file.size });
  if (!target.ok) return target;
  const sha = await sha256Hex(file);
  const { error } = await createBrowserSupabase().storage.from(DRAWING_FILE_BUCKET).uploadToSignedUrl(target.data.path, target.data.token, file, { contentType: file.type || undefined });
  if (error) return { ok: false, error: "The file could not be sent. Try again" };
  return call(`${base}/finalize`, "POST", { name: file.name, sha256: sha });
}
