import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// The one place an image is validated and stored in the company-assets bucket.
// /api/upload (logos and certificates, admin only) and the Newsletter Studio's
// image route both use it, so the rules cannot drift.

export const COMPANY_ASSETS_BUCKET = "company-assets";
export const MAX_ASSET_BYTES = 2 * 1024 * 1024; // 2 MB
// No SVG: it's XML and can carry a <script>/onload payload that executes when
// its public storage URL is opened directly -- stored XSS on a trusted-looking
// domain. Logos/certs/pictures render fine as raster.
const ALLOWED = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
// Extension in the storage path is derived from the validated MIME type below,
// never from the attacker-supplied filename -- otherwise a request could send
// an allowed-looking filename while `contentType: file.type` (used verbatim
// below) still stores/serves a different, unvalidated content type.
const EXT_BY_TYPE: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp" };

export type StoreResult =
  | { ok: true; url: string; path: string }
  | { ok: false; status: number; error: string };

/**
 * Validates and uploads one image under `<tenantId>/[folder/]`. The storage RLS
 * of 0038 checks that first folder against the caller's tenant, and the path
 * always starts with the tenantId passed in (which comes from requireTenantUser,
 * never from the request).
 */
export async function storeCompanyImage(admin: SupabaseClient, tenantId: string, file: File, folder?: string): Promise<StoreResult> {
  if (!ALLOWED.includes(file.type)) return { ok: false, status: 400, error: "File type not allowed. Use: PNG, JPG, or WebP" };
  if (file.size > MAX_ASSET_BYTES) return { ok: false, status: 400, error: "File too large — max 2 MB" };
  const ext = EXT_BY_TYPE[file.type];
  const path = `${tenantId}/${folder ? `${folder}/` : ""}${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await admin.storage.from(COMPANY_ASSETS_BUCKET).upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });
  if (error) return { ok: false, status: 500, error: error.message };
  const { data: { publicUrl } } = admin.storage.from(COMPANY_ASSETS_BUCKET).getPublicUrl(path);
  return { ok: true, url: publicUrl, path };
}
