import crypto from "crypto";
import { tenantOrigin } from "@/lib/constants";

// The addresses of a form. Built from the tenant's own domain (tenantOrigin), never
// from PRIMARY_HOST: a link that leaves the system must land on the tenant it is for.

/** The credential of the public submit route. Not guessable, not a tenant id, and revocable by regenerating. */
export function newPublicKey(): string {
  return `frm_${crypto.randomBytes(18).toString("base64url")}`;
}

export const PUBLIC_KEY_PATTERN = /^frm_[A-Za-z0-9_-]{20,40}$/;

export function hostedUrl(customDomain: string | null | undefined, slug: string): string {
  return `${tenantOrigin(customDomain)}/f/${encodeURIComponent(slug)}`;
}

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The snippet an admin pastes into the client's website. An iframe isolates the form's styles from the page. */
export function embedSnippet(customDomain: string | null | undefined, slug: string, title: string): string {
  const src = `${hostedUrl(customDomain, slug)}?embed=1`;
  return `<iframe src="${attr(src)}" title="${attr(title || "Contact form")}" width="100%" height="640" style="border:0;max-width:640px;" loading="lazy"></iframe>`;
}
