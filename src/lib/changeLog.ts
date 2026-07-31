import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ChangeLogAction = "create" | "update" | "delete";

export type ChangeEntry = { field: string; from: unknown; to: unknown; redacted?: boolean };

/**
 * Fields that are stored encrypted (see src/lib/encryption.ts). Kept as its
 * own small map here rather than importing encryption.ts's private
 * ACCOUNT_PII/CONTACT_PII consts, since this file's failure mode is
 * different: a bug here must never leak a plaintext PII value into an
 * otherwise-unencrypted audit table, so the list is deliberately explicit
 * and reviewed here, not inherited silently.
 */
const PII_FIELDS: Record<string, Set<string>> = {
  accounts: new Set(["phone", "phone2", "email", "email2", "gstin"]),
  contacts: new Set(["phone", "phone2", "phone3", "email", "email2"]),
};

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Diffs a "before" row against the PLAINTEXT values a caller is about to
 * write (never ciphertext -- AES-GCM here uses a random IV per call, so
 * encrypting the same plaintext twice yields different ciphertext, and
 * diffing ciphertext would make every PII-touching PATCH look like a
 * change even when the value didn't move). Callers pass the same plaintext
 * they're about to hand to encrypt(), and `before` decrypted the same way.
 * PII fields are always redacted in the stored result, whether or not they
 * actually changed -- this file is the boundary that must never let a
 * plaintext PII value reach the change_log table.
 */
export function diffForLog(
  objectType: string,
  before: Record<string, unknown>,
  patchPlaintext: Record<string, unknown>
): ChangeEntry[] {
  const pii = PII_FIELDS[objectType];
  const changes: ChangeEntry[] = [];
  for (const [field, toRaw] of Object.entries(patchPlaintext)) {
    const from = before[field] ?? null;
    const to = toRaw ?? null;
    if (deepEqual(from, to)) continue;
    if (pii?.has(field)) {
      changes.push({ field, from: from ? "[redacted]" : null, to: to ? "[redacted]" : null, redacted: true });
    } else {
      changes.push({ field, from, to });
    }
  }
  return changes;
}

/**
 * Records one change_log row. Never throws -- a logging failure must not
 * fail the mutation it's describing. Call this with the tenant-scoped
 * session client (never createAdminSupabase()) so RLS enforces tenant_id
 * even if a caller ever got that field wrong; call it AFTER the real
 * mutation has already succeeded.
 */
export async function logChange(
  supabase: SupabaseClient,
  params: {
    tenantId: string;
    objectType: string;
    objectId: string;
    objectLabel?: string | null;
    action: ChangeLogAction;
    actorId?: string | null;
    actorEmail?: string | null;
    changes?: ChangeEntry[];
  }
): Promise<void> {
  try {
    const { error } = await supabase.from("change_log").insert({
      tenant_id: params.tenantId,
      object_type: params.objectType,
      object_id: params.objectId,
      object_label: params.objectLabel ?? null,
      action: params.action,
      changes: params.changes ?? [],
      actor_id: params.actorId ?? null,
      actor_email: params.actorEmail ?? null,
    });
    if (error) console.error(`[changeLog] insert failed for ${params.objectType}/${params.objectId}`, error.message);
  } catch (e) {
    console.error(`[changeLog] failed to record ${params.action} on ${params.objectType}/${params.objectId}`, e);
  }
}
