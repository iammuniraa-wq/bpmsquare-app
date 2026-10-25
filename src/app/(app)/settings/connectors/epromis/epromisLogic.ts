import { configuredOperations } from "@/lib/connectors/epromis/endpointMap";
import { EPROMIS_OPERATIONS, type CompanyPlacement, type EpromisAuthType, type EpromisConfig, type EpromisPublicState } from "@/lib/connectors/epromis/types";
import preset from "@/lib/connectors/epromis/presets/epromis.default.json";

// Pure rules behind the ePROMIS settings screen: what the form holds, what makes it incomplete, and the body it sends.
// No React and no server import, so the rules are tested without a browser.

export type EpromisForm = {
  base_url: string;
  auth_type: EpromisAuthType;
  key_header: string;
  username: string;
  company_value: string;
  company_in: CompanyPlacement;
  company_name: string;
  /** The endpoint map as the admin edits it: JSON text. */
  endpoints_text: string;
};

export const DEFAULT_KEY_HEADER = "X-API-Key";

export const EMPTY_FORM: EpromisForm = {
  base_url: "", auth_type: "api_key", key_header: DEFAULT_KEY_HEADER, username: "", company_value: "", company_in: "header", company_name: "", endpoints_text: "",
};

/** The empty shape of an endpoint map, as text for the box. Nothing in it is a guess at ePROMIS's API. */
export const TEMPLATE_TEXT = JSON.stringify((preset as { endpoints: unknown }).endpoints, null, 2);

export const prettyMap = (cfg: Pick<EpromisConfig, "endpoints">): string => (Object.keys(cfg.endpoints).length ? JSON.stringify(cfg.endpoints, null, 2) : "");

export function formFromState(state: EpromisPublicState | null): EpromisForm {
  const c = state?.config;
  if (!c) return EMPTY_FORM;
  return {
    base_url: c.base_url, auth_type: c.auth_type, key_header: c.key_header || DEFAULT_KEY_HEADER, username: c.username,
    company_value: c.company_value, company_in: c.company_in, company_name: c.company_name, endpoints_text: prettyMap(c),
  };
}

export function parseEndpointText(text: string): { value: unknown; problem: string | null } {
  const t = text.trim();
  if (!t) return { value: {}, problem: null };
  try {
    const v = JSON.parse(t);
    if (!v || typeof v !== "object" || Array.isArray(v)) return { value: {}, problem: "The endpoint map must be an object with one entry per operation." };
    return { value: v, problem: null };
  } catch {
    return { value: {}, problem: "The endpoint map is not valid JSON. Check the commas and quotes." };
  }
}

/** Why Save can not go yet, in words, or null. A stored credential counts as entered. */
export function formProblem(form: EpromisForm, secret: string, secretStored: boolean): string | null {
  if (!form.base_url.trim()) return "Enter the base URL.";
  if (/^http:\/\//i.test(form.base_url.trim())) return "The address must use https.";
  if (form.auth_type === "api_key" && !form.key_header.trim()) return "Enter the header name that carries the API key.";
  if (form.auth_type === "basic" && !form.username.trim()) return "Enter the user name.";
  if (!secret.trim() && !secretStored) return "Enter the credential.";
  if (form.company_value.trim() && !form.company_name.trim()) return "Enter the name that carries the company code.";
  return parseEndpointText(form.endpoints_text).problem;
}

export function saveBody(form: EpromisForm, secret: string): { config: Record<string, unknown>; secrets: { secret?: string } } {
  return {
    config: {
      base_url: form.base_url.trim(),
      auth_type: form.auth_type,
      key_header: form.auth_type === "api_key" ? form.key_header.trim() : "",
      username: form.auth_type === "basic" ? form.username.trim() : "",
      company_value: form.company_value.trim(),
      company_in: form.company_in,
      company_name: form.company_value.trim() ? form.company_name.trim() : "",
      endpoints: parseEndpointText(form.endpoints_text).value,
    },
    secrets: secret.trim() ? { secret: secret.trim() } : {},
  };
}

export const credentialLabel = (a: EpromisAuthType): string => (a === "api_key" ? "API key" : a === "bearer" ? "Token" : "Password");

export function hostOf(base: string): string {
  try { return new URL(base).host; } catch { return base; }
}

/** The one-line "what is set" for the connection line. */
export function mapSummary(cfg: Pick<EpromisConfig, "endpoints">): string {
  const n = configuredOperations(cfg.endpoints).length;
  return n === 0 ? "Endpoint map not filled yet" : `${n} of ${EPROMIS_OPERATIONS.length} operations set`;
}
