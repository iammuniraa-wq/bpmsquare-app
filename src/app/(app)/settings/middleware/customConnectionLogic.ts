import {
  AUTH_LABEL, AUTH_MODES, FAMILY_LABEL, OAUTH_PROVIDERS, OAUTH_PROVIDER_LABEL, SECRET_FOR_AUTH, parseConnectionInput,
  type AuthMode, type ConnectionConfig, type ConnectionFamily, type OAuthProvider, type PublicConnection, type SecretKey,
} from "@/lib/connections/spec";
import { CONNECTION_TIPS } from "@/lib/connections/tips";
import type { ConnectionItem, CustomConnectionInput } from "./api";

// The pure parts of Add connection / the Connections table: which fields each type shows, the draft the panel edits, and the rows.
// Nothing here touches the network or the DOM.

export type TipKey = keyof typeof CONNECTION_TIPS;

export type FormField =
  | { key: string; label: string; kind: "text" | "url"; target: "name" | "config"; tip?: TipKey; placeholder?: string; optional?: boolean }
  | { key: string; label: string; kind: "select"; target: "config"; options: { value: string; label: string }[]; tip?: TipKey }
  | { key: SecretKey; label: string; kind: "secret"; target: "secret"; tip?: TipKey };

export type Draft = {
  name: string;
  family: ConnectionFamily;
  config: Partial<ConnectionConfig>;
  secrets: Partial<Record<SecretKey, string>>;
};

export const emptyDraft = (family: ConnectionFamily): Draft => ({ name: "", family, config: { base_url: "", auth: "none" }, secrets: {} });

export const draftFrom = (c: PublicConnection): Draft => ({ name: c.name, family: c.family, config: { ...c.config }, secrets: {} });

export const toInput = (d: Draft): CustomConnectionInput => ({ name: d.name, family: d.family, config: d.config, secrets: d.secrets });

/** The fields a type shows, in order. A type that needs no sign-in shows only the name and the address (and, for REST, the check path). */
export function formFields(family: ConnectionFamily, cfg: Partial<ConnectionConfig>): FormField[] {
  const auth: AuthMode = cfg.auth ?? "none";
  const out: FormField[] = [
    { key: "name", label: "Name", kind: "text", target: "name", placeholder: "Finance and Operations" },
    { key: "base_url", label: family === "odata" ? "Service address" : "Address", kind: "url", target: "config", tip: "address", placeholder: family === "odata" ? "https://yourenv.operations.dynamics.com/data" : "https://api.example.com/v1" },
    { key: "auth", label: "Sign in with", kind: "select", target: "config", tip: "signIn", options: AUTH_MODES.map((m) => ({ value: m, label: AUTH_LABEL[m] })) },
  ];
  if (auth === "api_key") {
    out.push(
      { key: "key_in", label: "Send the key in", kind: "select", target: "config", tip: "keyIn", options: [{ value: "header", label: "Header" }, { value: "query", label: "Web address" }] },
      { key: "key_name", label: "Key name", kind: "text", target: "config", tip: "keyName", placeholder: "X-API-Key", optional: true },
      { key: "api_key", label: "API key", kind: "secret", target: "secret", tip: "secret" },
    );
  } else if (auth === "basic") {
    out.push(
      { key: "username", label: "User name", kind: "text", target: "config" },
      { key: "password", label: "Password", kind: "secret", target: "secret", tip: "secret" },
    );
  } else if (auth === "bearer") {
    out.push({ key: "token", label: "Token", kind: "secret", target: "secret", tip: "secret" });
  } else if (auth === "oauth2_cc") {
    const provider: OAuthProvider = cfg.oauth_provider ?? "entra";
    out.push({ key: "oauth_provider", label: "Sign-in server", kind: "select", target: "config", tip: "provider", options: OAUTH_PROVIDERS.map((p) => ({ value: p, label: OAUTH_PROVIDER_LABEL[p] })) });
    if (provider === "entra") out.push({ key: "directory_id", label: "Directory (tenant) ID", kind: "text", target: "config", tip: "directory" });
    else out.push({ key: "token_url", label: "Token address", kind: "url", target: "config", tip: "tokenUrl", placeholder: "https://idp.example.com/oauth/token" });
    out.push(
      { key: "client_id", label: "Client ID", kind: "text", target: "config", tip: "clientId" },
      { key: "client_secret", label: "Client secret", kind: "secret", target: "secret", tip: "clientSecret" },
      { key: "scope", label: "Scope", kind: "text", target: "config", tip: "scope", optional: true, placeholder: provider === "entra" ? "Default: the address plus /.default" : "Only if the system asks for one" },
    );
  }
  if (family === "rest") out.push({ key: "test_path", label: "Check path", kind: "text", target: "config", tip: "checkPath", optional: true, placeholder: "/health" });
  return out;
}

/** The first reason a draft cannot be tested or saved yet, in the server's own words, or null. `stored` lets a blank secret stand when one is kept. */
export function draftProblem(d: Draft, stored?: PublicConnection | null): string | null {
  const r = parseConnectionInput(toInput(d), stored ? { config: stored.config, has: stored.secretsSet } : null);
  return r.ok ? null : r.errors[0].message;
}

/** Which secret the chosen sign-in keeps, for the "Stored" mark. */
export const secretOf = (cfg: Partial<ConnectionConfig>): SecretKey | null => SECRET_FOR_AUTH[cfg.auth ?? "none"];

// ── The table ───────────────────────────────────────────────────────────────

export type RowStatus = "ok" | "failed" | "untested" | "connected" | "attention" | "not_connected";

export type ConnectionRow = {
  key: string;
  kind: "custom" | "existing";
  name: string;
  type: string;
  status: RowStatus;
  statusText: string;
  /** The plain line of the last Test, or "" . */
  detail: string;
  testedAt: string | null;
  endpoints: number | null;
  custom?: PublicConnection;
  existingId?: string;
};

const STATUS_TEXT: Record<RowStatus, string> = {
  ok: "Working", failed: "Needs attention", untested: "Not tested", connected: "Connected", attention: "Needs attention", not_connected: "Not connected",
};

/** Your ERP connectors first (unchanged), then the connections you added. */
export function buildConnectionRows(existing: readonly ConnectionItem[], custom: readonly PublicConnection[]): ConnectionRow[] {
  const erp: ConnectionRow[] = existing.filter((c) => c.state.config).map((c) => {
    const status: RowStatus = c.state.status === "connected" ? "connected" : c.state.status === "error" ? "attention" : "not_connected";
    return { key: `erp:${c.id}`, kind: "existing", name: c.label, type: "ERP connector", status, statusText: STATUS_TEXT[status], detail: c.state.last_error ?? "", testedAt: null, endpoints: null, existingId: c.id };
  });
  const mine: ConnectionRow[] = custom.map((c) => ({
    key: `conn:${c.id}`, kind: "custom", name: c.name, type: FAMILY_LABEL[c.family], status: c.status, statusText: STATUS_TEXT[c.status],
    detail: c.lastTestMessage ?? "", testedAt: c.lastTestAt, endpoints: c.endpointCount, custom: c,
  }));
  return [...erp, ...mine];
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", or the date. */
export function ago(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  if (s < 14 * 86_400) return `${Math.round(s / 86_400)} d ago`;
  return new Date(t).toISOString().slice(0, 10);
}
