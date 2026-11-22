import "server-only";
import type { createAdminSupabase } from "@/lib/supabase-server";
import { assertSafeHttpsUrl, fetchPublic } from "@/lib/net/safeHost";
import { SUMMARY_PATH, signSummaryRequest } from "./crypto";
import type { KeyObject } from "node:crypto";
import { sanitizeRemoteSummary } from "./summary";

// The registry of instances (migration 0247, control plane only). Platform-level, no tenant_id: every call here runs on the
// service role behind isPlatformAdmin(). While 0247 is pending a missing relation reads as `pending`, never as a crash.

type Admin = ReturnType<typeof createAdminSupabase>;

export type InstanceStatus = "planned" | "active" | "retired";
export const INSTANCE_STATUSES: InstanceStatus[] = ["planned", "active", "retired"];

export type InstanceRow = {
  id: string;
  slug: string;
  name: string;
  base_url: string;
  region: string | null;
  db_host: string | null;
  branch: string | null;
  status: InstanceStatus;
  notes: string | null;
  last_seen_at: string | null;
  last_summary: (Record<string, unknown> & { fetch_error?: string; fetch_error_at?: string }) | null;
  created_at: string;
};

const COLUMNS = "id, slug, name, base_url, region, db_host, branch, status, notes, last_seen_at, last_summary, created_at";
export const FETCH_TIMEOUT_MS = 8000;

export function isMissingRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && (error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? ""));
}

export async function listInstances(admin: Admin): Promise<{ rows: InstanceRow[]; pending: boolean }> {
  const { data, error } = await admin.from("platform_instances").select(COLUMNS).order("created_at", { ascending: true });
  if (isMissingRelation(error)) return { rows: [], pending: true };
  return { rows: (data ?? []) as InstanceRow[], pending: false };
}

export async function getInstance(admin: Admin, id: string): Promise<InstanceRow | null> {
  const { data } = await admin.from("platform_instances").select(COLUMNS).eq("id", id).maybeSingle();
  return (data as InstanceRow | null) ?? null;
}

export type RegisterInput = {
  name?: unknown; slug?: unknown; base_url?: unknown; region?: unknown; db_host?: unknown; branch?: unknown; status?: unknown; notes?: unknown;
};

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Validates a registration. base_url must be https and public (the SSRF guard), and is stored as its bare origin. */
export async function validateRegistration(
  input: RegisterInput,
): Promise<{ ok: true; value: Omit<InstanceRow, "id" | "last_seen_at" | "last_summary" | "created_at"> } | { ok: false; error: string }> {
  const name = text(input.name, 120);
  if (!name) return { ok: false, error: "Name is required" };
  const slug = typeof input.slug === "string" ? input.slug.trim().toLowerCase() : "";
  if (!SLUG.test(slug)) return { ok: false, error: "Slug is lowercase letters, digits and hyphens (2 to 40 characters)" };
  const status = (typeof input.status === "string" ? input.status : "planned") as InstanceStatus;
  if (!INSTANCE_STATUSES.includes(status)) return { ok: false, error: "Status must be planned, active or retired" };
  if (typeof input.base_url !== "string") return { ok: false, error: "Base URL is required" };
  let url: URL;
  try {
    url = await assertSafeHttpsUrl(input.base_url.trim());
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "That address cannot be used" };
  }
  if (url.username || url.password) return { ok: false, error: "The base URL must not carry a user name or password" };
  return {
    ok: true,
    value: {
      slug, name, base_url: url.origin, status,
      region: text(input.region, 40), db_host: text(input.db_host, 253), branch: text(input.branch, 80), notes: text(input.notes, 1000),
    },
  };
}

export async function recordEvent(admin: Admin, instanceId: string, kind: string, actorEmail: string | null, detail: Record<string, unknown> = {}): Promise<void> {
  const { error } = await admin.from("platform_instance_events").insert({ instance_id: instanceId, kind, actor_email: actorEmail, detail });
  if (error && !isMissingRelation(error)) console.error("[controlPlane] event not recorded", error.message);
}

export async function registerInstance(
  admin: Admin,
  input: RegisterInput,
  actorEmail: string | null,
): Promise<{ ok: true; row: InstanceRow } | { ok: false; error: string; status: number }> {
  const v = await validateRegistration(input);
  if (!v.ok) return { ok: false, error: v.error, status: 422 };
  const { data, error } = await admin.from("platform_instances").insert(v.value).select(COLUMNS).single();
  if (isMissingRelation(error)) return { ok: false, error: "The instance registry needs a database update (migration 0247).", status: 503 };
  if (error?.code === "23505") return { ok: false, error: "An instance with that slug is already registered", status: 409 };
  if (error || !data) return { ok: false, error: "The instance could not be saved", status: 500 };
  const row = data as InstanceRow;
  await recordEvent(admin, row.id, "registered", actorEmail, { slug: row.slug, base_url: row.base_url, status: row.status });
  return { ok: true, row };
}

/**
 * Signed pull of one instance. The result, good or bad, is stored on the row so the page can draw it without a network call:
 * a failure keeps the previous summary and adds fetch_error, so "Unreachable" still shows what was last known.
 */
export async function refreshInstance(
  admin: Admin,
  row: InstanceRow,
  priv: KeyObject,
  fetcher: typeof fetchPublic = fetchPublic,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const fail = async (message: string) => {
    const previous = row.last_summary ? { ...row.last_summary } : {};
    await admin.from("platform_instances").update({ last_summary: { ...previous, fetch_error: message, fetch_error_at: new Date().toISOString() } }).eq("id", row.id);
    return { ok: false as const, error: message };
  };
  try {
    const res = await fetcher(`${row.base_url}${SUMMARY_PATH}`, {
      method: "GET",
      headers: { ...signSummaryRequest(priv), accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.status === 404) return fail("The instance does not answer the control plane (not enabled there, or an old build)");
    if (!res.ok) return fail(`The instance answered ${res.status}`);
    const summary = sanitizeRemoteSummary(await res.json().catch(() => null));
    if (!summary) return fail("The instance sent a summary this console cannot read");
    if (summary.instance.slug !== row.slug) return fail("The instance reports a different slug than the one registered");
    const { error } = await admin.from("platform_instances").update({ last_summary: summary, last_seen_at: new Date().toISOString() }).eq("id", row.id);
    if (error) return { ok: false, error: "The result could not be saved" };
    return { ok: true };
  } catch (e) {
    return fail(e instanceof Error && e.name === "TimeoutError" ? "The instance did not answer in time" : e instanceof Error ? e.message.slice(0, 200) : "The instance could not be reached");
  }
}
