import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// "reopen" is a distinct action from "update" -- moving a quote off a closed
// status back into the pipeline undoes a closed deal, which is worth being
// able to filter/audit separately from an ordinary field edit.
export type ChangeLogAction = "create" | "update" | "delete" | "reopen";

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
  // employees stores these plaintext (bpmsquarecore.md §7's encryption scope
  // is accounts/contacts only), but the audit log redacts them anyway --
  // consistent treatment of a person's contact details regardless of which
  // table they live in.
  employees: new Set(["phone", "email"]),
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

export type LineSnapshot = { label: string; qty: number; rate: number; amount: number };

function formatLine(l: LineSnapshot): string {
  return `${l.label}: qty ${l.qty} × rate ${l.rate} = ${l.amount}`;
}

/**
 * Diffs a wholesale-replaced line-item array (quote/invoice/PO lines are
 * always delete-all-then-insert-all on edit, so there's no stable line id
 * to match on across a save) by position. A line whose content differs at
 * the same index is one "changed" entry; a length mismatch produces
 * added/removed entries for the extra positions. Good enough for "what
 * changed" without needing a real diff/LCS algorithm -- edits in the UI
 * table overwhelmingly keep existing rows in place and add/remove at the end.
 */
export function diffLineItems(before: LineSnapshot[], after: LineSnapshot[]): ChangeEntry[] {
  const changes: ChangeEntry[] = [];
  const max = Math.max(before.length, after.length);
  for (let i = 0; i < max; i++) {
    const b = before[i];
    const a = after[i];
    if (b && a) {
      if (b.label !== a.label || b.qty !== a.qty || b.rate !== a.rate || b.amount !== a.amount) {
        changes.push({ field: `Line ${i + 1}`, from: formatLine(b), to: formatLine(a) });
      }
    } else if (b && !a) {
      changes.push({ field: `Line ${i + 1} removed`, from: formatLine(b), to: null });
    } else if (a && !b) {
      changes.push({ field: `Line ${i + 1} added`, from: null, to: formatLine(a) });
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

export type ChangeLogEntryParams = {
  tenantId: string;
  objectType: string;
  objectId: string;
  objectLabel?: string | null;
  action: ChangeLogAction;
  actorId?: string | null;
  actorEmail?: string | null;
  changes?: ChangeEntry[];
};

/**
 * Same contract as logChange() (never throws, session client only, call
 * after the real mutation succeeds) but for bulk operations -- Data
 * Workbench import/update can touch hundreds of rows in one request, and
 * one round trip beats one logChange() call per row.
 */
export async function logChangeBatch(supabase: SupabaseClient, rows: ChangeLogEntryParams[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    const { error } = await supabase.from("change_log").insert(
      rows.map((r) => ({
        tenant_id: r.tenantId,
        object_type: r.objectType,
        object_id: r.objectId,
        object_label: r.objectLabel ?? null,
        action: r.action,
        changes: r.changes ?? [],
        actor_id: r.actorId ?? null,
        actor_email: r.actorEmail ?? null,
      }))
    );
    if (error) console.error(`[changeLog] batch insert failed (${rows.length} rows)`, error.message);
  } catch (e) {
    console.error(`[changeLog] batch insert threw (${rows.length} rows)`, e);
  }
}
