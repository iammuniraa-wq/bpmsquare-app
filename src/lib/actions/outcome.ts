import type { SupabaseClient } from "@supabase/supabase-js";
import type { PermissionSet } from "@/lib/permissions";

// The shapes every press shares: what the act route hands the executor, what comes back, and the one way a refusal is
// written. Kept apart from execute.ts so the three kinds of press (create, change, tender step) can all import them.

export type ExecCtx = {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  tenantId: string;
  userId: string;
  /** The workspace role, for the checks the tender routes run on the session. */
  role?: "admin" | "member";
  perms: PermissionSet;
  features: Record<string, boolean | undefined>;
  /** Base for the in-process request to the route; only the path is used. */
  baseUrl: string;
  now?: number;
};

export type ActBody = { card_id?: unknown; token?: unknown; values?: unknown; confirm_duplicates?: unknown };

export type ExecOutcome = { status: number; body: Record<string, unknown> };

export const refuse = (status: number, code: string, error: string, extra: Record<string, unknown> = {}): ExecOutcome =>
  ({ status, body: { ok: false, code, error, ...extra } });

/** The status a press answers with when the object's own route said no: a missing record is a question for the person, a crash is ours. */
export const routeStatus = (status: number): number => (status === 404 ? 422 : status >= 500 ? 502 : status);
