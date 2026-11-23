import "server-only";
import { NextResponse } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { resolvePermissions } from "@/lib/permissions";
import { resolveMonthlyBudget } from "@/lib/ai/usageCap";
import type { ChatTurn } from "@/lib/ai/assistant";
import type { TenantConfig } from "@/lib/constants";
import { webAvailability } from "./webConsent";

// The session side of the assistant's two entry points: POST /api/ai/ask (the model loop) and POST /api/ai/report/run (the
// streamed company brief). Tenant, person, permissions, the workspace's modules and its allowance all come from the session,
// never from the request; the same function answers both, so the run route cannot be looser than the ask route.

export type AskAccess = {
  supabase: Awaited<ReturnType<typeof requireTenantUser>>["supabase"];
  tenantId: string;
  userId: string;
  perms: Awaited<ReturnType<typeof resolvePermissions>>;
  features: Record<string, boolean | undefined>;
  budget: number;
  /** The workspace role. A member with no Business Role is unrestricted for data (perms.unrestricted) but is not an admin. */
  isAdmin: boolean;
  /** Platform flag, the assistant it hangs off and the workspace's own external-calls policy, folded into one answer. */
  webEnabled: boolean;
  /** Why it is off, when it is: the assistant then says so instead of a generic decline. */
  webOff: Extract<ReturnType<typeof webAvailability>, { enabled: false }>["reason"] | undefined;
  config: Partial<TenantConfig>;
};

// The assistant is the ai_assistant module: a workspace without it gets 403 here, not only a hidden dock.
export async function resolveAskAccess(): Promise<AskAccess | NextResponse> {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const [perms, { data: tenant }] = await Promise.all([
    resolvePermissions(supabase, tenantId, userId, role),
    supabase.from("tenants").select("features, config").eq("id", tenantId).maybeSingle(),
  ]);
  const features = (tenant?.features ?? {}) as Record<string, boolean | undefined>;
  if (features.ai_assistant !== true) return NextResponse.json({ error: "The assistant is not enabled for this workspace." }, { status: 403 });
  const config = (tenant?.config ?? {}) as Partial<TenantConfig>;
  const availability = webAvailability(features, config);
  return {
    supabase, tenantId, userId, perms, features, budget: resolveMonthlyBudget(config.ai_assistant?.monthly_token_budget),
    isAdmin: role === "admin",
    webEnabled: availability.enabled, webOff: availability.enabled ? undefined : availability.reason,
    config,
  };
}

/**
 * Conversation context so follow-ups work. Client-supplied TEXT only: it shapes the model's answer and the words a typed
 * company name may use, never a query directly; every data access still goes through the permission-filtered tools with this
 * session's own tenant id.
 */
export function parseHistory(body: unknown, question: string): ChatTurn[] {
  const raw = (body as { history?: unknown } | null)?.history;
  const rawHistory = Array.isArray(raw) ? raw : [];
  const history: ChatTurn[] = rawHistory
    .filter((t: { role?: string; text?: string }) => (t?.role === "user" || t?.role === "assistant") && typeof t?.text === "string" && t.text.trim())
    .slice(-12)
    .map((t: { role: "user" | "assistant"; text: string; web?: unknown }) => ({
      role: t.role, text: t.text.slice(0, 4000), ...(t.role === "assistant" && t.web === true ? { web: true } : {}),
    }));
  if (history.length === 0 || history[history.length - 1].text !== question || history[history.length - 1].role !== "user") {
    history.push({ role: "user", text: question });
  }
  // Anthropic requires the first message to be from the user.
  while (history.length && history[0].role !== "user") history.shift();
  return history;
}
