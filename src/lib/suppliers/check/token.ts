import "server-only";
import crypto from "crypto";
import type { SupplierCheckResult } from "./types";

// Two signed proofs the supplier check uses, both bound to the workspace and the person:
//  - the web consent: the query the person said yes to, "supplier_check|<supplier id>", signed by the shared consent token (assistant/
//    consentToken.ts), so a yes to one supplier cannot be spent on another and a web-search token never verifies here;
//  - the save token: a hash of the exact result the dock showed. The dock sends the result back when the person presses "Save to
//    supplier"; the route saves it only if the hash matches, so what lands on the record is what the server computed, never text a
//    client made up (a check steers who is awarded).

export const CHECK_CONSENT_PREFIX = "supplier_check|";
export const consentQueryFor = (supplierId: string): string => `${CHECK_CONSENT_PREFIX}${supplierId}`;
export const supplierIdFromQuery = (q: unknown): string | null => {
  if (typeof q !== "string" || !q.startsWith(CHECK_CONSENT_PREFIX)) return null;
  const id = q.slice(CHECK_CONSENT_PREFIX.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id.toLowerCase() : null;
};

export const SAVE_TTL_MS = 30 * 60 * 1000;

function key(): Buffer {
  const base = process.env.ASSISTANT_ACTION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error("assistant action signing key is not configured");
  return crypto.createHmac("sha256", "bpmsquare.supplier.check.v1").update(base).digest();
}

const sign = (body: string): string => crypto.createHmac("sha256", key()).update(body).digest("base64url");

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export const resultHash = (r: SupplierCheckResult): string => crypto.createHash("sha256").update(canonical(r)).digest("base64url").slice(0, 32);

type Payload = { v: 1; tid: string; uid: string; sid: string; h: string; exp: number };

export function issueSaveToken(i: { tenantId: string; userId: string; result: SupplierCheckResult }, now = Date.now()): string {
  const p: Payload = { v: 1, tid: i.tenantId, uid: i.userId, sid: i.result.supplierId, h: resultHash(i.result), exp: now + SAVE_TTL_MS };
  const body = Buffer.from(JSON.stringify(p)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export type SaveFailure = "malformed" | "signature" | "expired" | "tenant" | "user" | "supplier" | "changed";

export function verifySaveToken(
  token: unknown, expect: { tenantId: string; userId: string; result: SupplierCheckResult }, now = Date.now(),
): { ok: true } | { ok: false; reason: SaveFailure } {
  if (typeof token !== "string" || token.length > 2000) return { ok: false, reason: "malformed" };
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return { ok: false, reason: "malformed" };
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: "signature" };
  let p: Payload;
  try { p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return { ok: false, reason: "malformed" }; }
  if (p?.v !== 1) return { ok: false, reason: "malformed" };
  if (!Number.isFinite(p.exp) || now > p.exp) return { ok: false, reason: "expired" };
  if (p.tid !== expect.tenantId) return { ok: false, reason: "tenant" };
  if (p.uid !== expect.userId) return { ok: false, reason: "user" };
  if (p.sid !== expect.result.supplierId) return { ok: false, reason: "supplier" };
  if (p.h !== resultHash(expect.result)) return { ok: false, reason: "changed" };
  return { ok: true };
}
