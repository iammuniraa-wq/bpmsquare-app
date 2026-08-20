import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteFaces } from "./face";

/**
 * Revoke one employee's face enrollment everywhere it lives: templates at
 * the provider, our photo copies in the private `wfm` bucket, and the row
 * flipped to `revoked` (kept as the audit record that an enrollment
 * existed and when it ended). Shared by the explicit revoke action and by
 * employee deactivation, so "deactivated" can never mean "still enrolled".
 *
 * Best-effort by design: a provider hiccup must not block deactivating an
 * employee. Failures log loudly; the row is still marked revoked so the
 * kiosk stops accepting the face (search only matches rows with active
 * status at punch time — enforced by the kiosk route, not here).
 */
export async function revokeFaceEnrollment(
  admin: SupabaseClient,
  tenantId: string,
  employeeId: string
): Promise<void> {
  const { data: row } = await admin
    .from("wfm_face_enrollments")
    .select("id, provider_face_ids, photo_paths, status")
    .eq("tenant_id", tenantId)
    .eq("employee_id", employeeId)
    .maybeSingle();
  if (!row || row.status === "revoked") return;

  try {
    await deleteFaces(tenantId, (row.provider_face_ids as string[]) ?? []);
  } catch (e) {
    console.error("face revoke: provider delete failed:", (e as Error).message);
  }

  const paths = (row.photo_paths as string[]) ?? [];
  if (paths.length > 0) {
    const { error } = await admin.storage.from("wfm").remove(paths);
    if (error) console.error("face revoke: photo delete failed:", error.message);
  }

  await admin
    .from("wfm_face_enrollments")
    .update({ status: "revoked", provider_face_ids: [], photo_paths: [] })
    .eq("id", row.id)
    .eq("tenant_id", tenantId);
}
