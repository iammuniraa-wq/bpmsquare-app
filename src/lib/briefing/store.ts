import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Briefing } from "./types";

// assistant_briefings (migration 0204): one row per (workspace, person, day). Reads and writes are service-role only,
// always with the workspace and the person in the filter. While the migration is pending the table is missing and every
// call here reports `pending: true`, so the briefing is simply worked out on each open.

export type StoredBriefing = { data: Briefing; lang: string | null; computedAt: string };

export type BriefingStore = {
  read(tenantId: string, userId: string, day: string): Promise<{ row: StoredBriefing | null; pending: boolean }>;
  write(row: { tenantId: string; userId: string; day: string; lang: string | null; data: Briefing; tokens?: number }): Promise<{ pending: boolean }>;
};

function isMissing(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "42P01" || err.code === "42703" || err.code === "PGRST205" || err.code === "PGRST204"
    || /does not exist|Could not find the table|schema cache/i.test(err.message ?? "");
}

export function supabaseBriefingStore(admin: SupabaseClient): BriefingStore {
  return {
    async read(tenantId, userId, day) {
      const { data, error } = await admin.from("assistant_briefings")
        .select("data, lang, computed_at")
        .eq("tenant_id", tenantId).eq("user_id", userId).eq("day", day).maybeSingle();
      if (error) return { row: null, pending: isMissing(error) };
      if (!data || typeof data.data !== "object" || data.data === null) return { row: null, pending: false };
      return { row: { data: data.data as Briefing, lang: (data.lang as string | null) ?? null, computedAt: String(data.computed_at) }, pending: false };
    },
    async write(row) {
      const { error } = await admin.from("assistant_briefings").upsert({
        tenant_id: row.tenantId, user_id: row.userId, day: row.day, lang: row.lang,
        data: row.data, wording: row.data.wording ?? null, tokens: row.tokens ?? 0, computed_at: row.data.computedAt,
      }, { onConflict: "tenant_id,user_id,day" });
      if (error && !isMissing(error)) console.error(`[briefing] store failed: ${error.message}`);
      return { pending: isMissing(error) };
    },
  };
}
