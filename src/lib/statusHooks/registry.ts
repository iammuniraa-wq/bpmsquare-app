import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StatusEntityType } from "../statusEngine";

export type StatusHookContext = {
  supabase: SupabaseClient;
  tenantId: string;
  entityType: StatusEntityType;
  entityId: string;
  fromCode: string | null;
  toCode: string;
  actorUserId?: string | null;
};

export type StatusHook = (ctx: StatusHookContext) => Promise<void>;

/**
 * Static import map -- Next's bundler requires a literal map here, not a
 * dynamic variable import, same constraint src/extensions/registry.ts is
 * already built around. Reserved for genuine cross-object status
 * propagation (e.g. a quote's status driving a linked case's status);
 * empty until a later batch has a concrete reusable reaction to register --
 * a single well-understood call site (like quotes/route.ts setting a linked
 * case to "quote_sent" today) stays a direct call, not a hook, per the plan.
 */
const HOOK_REGISTRY: Record<string, () => Promise<{ default: StatusHook }>> = {};

/** Never throws -- a hook failure must not fail the status change it reacts to. */
export async function runStatusHook(name: string, ctx: StatusHookContext): Promise<void> {
  const loader = HOOK_REGISTRY[name];
  if (!loader) {
    console.error(`[statusHooks] unknown hook "${name}"`);
    return;
  }
  try {
    const { default: hook } = await loader();
    await hook(ctx);
  } catch (e) {
    console.error(`[statusHooks] hook "${name}" threw`, e);
  }
}
