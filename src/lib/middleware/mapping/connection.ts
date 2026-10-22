import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSchemaPending } from "@/lib/marketing/pending";

// The connection a mapping belongs to: an ERP adapter by its fixed name, or a Call webhook as `webhook:<uuid>`. The id comes
// from a request, so a webhook is resolved with the tenant before anything is read or written under it.

export const ADAPTER_CONNECTIONS = ["dynamics365", "sap", "epromis"] as const;
export type AdapterId = (typeof ADAPTER_CONNECTIONS)[number];

export type Connection =
  | { id: AdapterId; kind: "adapter"; label: string }
  | { id: string; kind: "webhook"; label: string; webhookId: string; allowPersonalData: boolean };

export type Resolved = { ok: true; conn: Connection } | { ok: false; status: number; error: string };

const ADAPTER_LABEL: Record<AdapterId, string> = { dynamics365: "Dynamics 365", sap: "SAP", epromis: "ePROMIS" };
const WEBHOOK_ID = /^webhook:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export async function resolveConnection(admin: SupabaseClient, tenantId: string, raw: unknown): Promise<Resolved> {
  if (raw === undefined || raw === null || raw === "") return { ok: true, conn: { id: "dynamics365", kind: "adapter", label: ADAPTER_LABEL.dynamics365 } };
  if (typeof raw !== "string") return { ok: false, status: 422, error: "Choose a connection." };
  if ((ADAPTER_CONNECTIONS as readonly string[]).includes(raw)) return { ok: true, conn: { id: raw as AdapterId, kind: "adapter", label: ADAPTER_LABEL[raw as AdapterId] } };
  const m = WEBHOOK_ID.exec(raw);
  if (!m) return { ok: false, status: 422, error: "Choose a connection from the list." };
  const { data, error } = await admin.from("webhooks").select("id, name, kind, allow_personal_data").eq("id", m[1].toLowerCase()).eq("tenant_id", tenantId).maybeSingle();
  if (isSchemaPending(error) || error) return { ok: false, status: 404, error: "That webhook was not found." };
  const w = data as { id: string; name: string; kind: string; allow_personal_data?: boolean } | null;
  if (!w || w.kind !== "call") return { ok: false, status: 404, error: "That webhook was not found." };
  return { ok: true, conn: { id: `webhook:${w.id}`, kind: "webhook", label: w.name, webhookId: w.id, allowPersonalData: w.allow_personal_data === true } };
}

/** Webhooks only ever send; the ERP documents other than the Quote are what a pull brings in. */
export const directionOf = (conn: Connection, document: string): "out" | "in" => (conn.kind === "webhook" || document === "quote" ? "out" : "in");
