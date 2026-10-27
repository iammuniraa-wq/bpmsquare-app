import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listTenantConnectors } from "@/lib/connectors/server";
import type { ChannelValues } from "./channelInput";

/**
 * Every id a channel form sends is checked against THIS workspace before it is stored (MULTI_TENANT_GUARDRAILS.md): the
 * Business Roles of the team, the estimate template, and that a chosen mailbox is actually connected. Returns the first
 * problem, or null.
 */
export async function verifyChannelRefs(
  admin: SupabaseClient, tenantId: string, v: ChannelValues, estimator: boolean,
): Promise<{ error: string; status: number } | null> {
  if (v.role_ids && v.role_ids.length > 0) {
    const { data } = await admin.from("business_roles").select("id").eq("tenant_id", tenantId).in("id", v.role_ids);
    if ((data ?? []).length !== v.role_ids.length) return { error: "One of the roles was not found.", status: 404 };
  }
  if (v.default_template_id) {
    if (!estimator) return { error: "Estimates are not part of your workspace.", status: 422 };
    const { data } = await admin.from("estimate_templates").select("id").eq("id", v.default_template_id).eq("tenant_id", tenantId).maybeSingle();
    if (!data) return { error: "Template not found.", status: 404 };
  }
  if (v.connector_id) {
    const rows = await listTenantConnectors(admin, tenantId);
    if (!rows.some((r) => r.connector_id === v.connector_id && r.status === "connected")) {
      return { error: `Connect ${v.connector_id === "gmail" ? "Gmail" : "your mail server"} under Settings → Connectors first.`, status: 409 };
    }
  }
  return null;
}
