import { SITE_LIMITS, type SiteConfig } from "./types";

// Evidence files of a site expense or receipt (photos, a finger signature, a forwarded PDF), pure: what a file really is, decided from its
// first bytes and never from the name or the type the phone claimed, and the workspace's site settings read defensively.

export const EVIDENCE_BUCKET = "site-evidence";

export type EvidenceType = { mime: "image/jpeg" | "image/png" | "image/webp" | "application/pdf"; ext: "jpg" | "png" | "webp" | "pdf" };

/** What the bytes are, or null when it is not one of the four types a site person may attach. */
export function sniffEvidence(bytes: Uint8Array): EvidenceType | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: "image/png", ext: "png" };
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { mime: "image/webp", ext: "webp" };
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return { mime: "application/pdf", ext: "pdf" };
  return null;
}

export type EvidenceProblem = { name: string; error: string };

/** A file's size and type, as a message for the person, or null when it can be stored. A signature must be an image. */
export function evidenceProblem(file: { name: string; size: number }, bytes: Uint8Array, opts: { imageOnly?: boolean } = {}): string | null {
  if (file.size <= 0) return `${file.name || "A file"} is empty`;
  if (file.size > SITE_LIMITS.maxPhotoBytes) return `${file.name || "A file"} is larger than 8 MB`;
  const t = sniffEvidence(bytes);
  if (!t) return `${file.name || "A file"} is not a photo or PDF`;
  if (opts.imageOnly && t.mime === "application/pdf") return `${file.name || "A file"} must be a photo`;
  return null;
}

/** The storage path of a file: always under the workspace's own folder, named by a fresh id and the type the bytes really are. */
export const evidencePath = (tenantId: string, objectType: string, objectId: string, fileId: string, ext: string): string => `${tenantId}/${objectType}/${objectId}/${fileId}.${ext}`;

/** Does this storage path belong to this workspace? Every signed link checks it first. */
export const pathBelongsTo = (tenantId: string, path: string): boolean => path.startsWith(`${tenantId}/`) && !path.includes("..");

const posNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/** tenants.config.site, read defensively: a missing or odd value is "no limit". */
export function siteConfig(config: { site?: unknown } | null | undefined): SiteConfig & { notify_receipts: string[] } {
  const raw = (config?.site ?? {}) as Record<string, unknown>;
  const notify = Array.isArray(raw.notify_receipts) ? raw.notify_receipts.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 20) : [];
  return { pm_limit: posNum(raw.pm_limit), monthly_cap: posNum(raw.monthly_cap), notify_receipts: [...new Set(notify)] };
}
