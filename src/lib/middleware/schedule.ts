import "server-only";
import { after } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { dispatchQuoteOutcome } from "./dispatch";

/**
 * Hand a status change to the engine AFTER the response: the user's save is
 * already done, and nothing here can fail or slow it. Uses Next's after() so
 * the work survives the response; outside a request scope it falls back to a
 * detached promise. Either way every outcome is recorded as a message.
 */
export function scheduleQuoteDispatch(tenantId: string, quoteId: string, userId: string | null): void {
  const run = async () => {
    try {
      await dispatchQuoteOutcome(createAdminSupabase(), tenantId, quoteId, { trigger: "auto", userId });
    } catch (e) {
      console.error("[middleware] dispatch failed", (e as Error).message);
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}
