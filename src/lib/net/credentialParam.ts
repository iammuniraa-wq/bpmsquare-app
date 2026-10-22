// Query names that carry a credential. An address a tenant types is stored and logged in
// the clear, so a key in it is readable by every member; it belongs in a header (sealed).
export const CREDENTIAL_PARAM = /(^|[_-])(key|apikey|api[_-]?key|token|access[_-]?token|secret|password|passwd|pwd|auth|authorization|sig|signature|credential)($|[_-])/i;

// A bare "code" is the Azure Functions key, but country_code or zip_code are plain data, so only the whole name counts.
const BARE_CODE = /^code$/i;

/** True when any query name of `raw` looks like a credential. Tolerates `{{token}}` placeholders and odd encodings. */
export function hasCredentialParam(raw: string): boolean {
  const q = raw.split("#")[0].split("?").slice(1).join("?");
  if (!q) return false;
  for (const pair of q.split("&")) {
    let name = pair.split("=")[0];
    try { name = decodeURIComponent(name); } catch { /* keep the raw name */ }
    name = name.trim();
    if (CREDENTIAL_PARAM.test(name) || BARE_CODE.test(name)) return true;
  }
  return false;
}
