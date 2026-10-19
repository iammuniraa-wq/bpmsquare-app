import type { SupabaseClient } from "@supabase/supabase-js";
import { DOC_LINE_TABLE, checkSourceLineIds } from "./linking";
import type { RfqOriginType } from "./types";

// Database half of "always linked to the quote and the item": every document
// line an RFQ claims must be a line of THIS origin document in THIS tenant.
// Runs before anything is inserted, so a bad id stops the whole request
// instead of silently producing an unlinked RFQ.

export async function verifySourceLines(
  admin: SupabaseClient,
  tenantId: string,
  type: RfqOriginType,
  originId: string | null,
  lines: { source_line_id?: unknown }[],
): Promise<void> {
  const check = checkSourceLineIds(type, lines);
  if (!check.ok) throw { status: 422, message: check.error };
  if (!check.ids.length) return;
  const def = DOC_LINE_TABLE[type];
  if (!def || !originId) throw { status: 422, message: "Lines can only be linked to the quote they are on." };
  const { data, error } = await admin.from(def.table).select("id")
    .eq("tenant_id", tenantId).eq(def.parent, originId).in("id", check.ids);
  if (error) throw { status: 500, message: error.message };
  if ((data ?? []).length !== check.ids.length) {
    throw { status: 422, message: "A line you selected is not on this quote. Reload the quote and try again." };
  }
}
