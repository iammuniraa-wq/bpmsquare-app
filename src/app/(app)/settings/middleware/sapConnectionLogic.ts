import { SAP_AUTH_LABEL, SAP_AUTH_MODES, SAP_SANDBOX_HOST, type SapAuthMode } from "@/lib/connectors/sap_s4/types";
import type { SapConnectionInput } from "./api";

// The SAP connection panel's pure parts: which fields the chosen login type shows, what is missing before Save,
// and the body that is sent. The password and the API key are write-only: a blank one keeps what is stored.

export type SapForm = { auth_mode: SapAuthMode; api_host: string; username: string };
export type SapSecretInput = { password: string; api_key: string };

export const SAP_LOGIN_CHOICES = SAP_AUTH_MODES.map((id) => ({ id, label: SAP_AUTH_LABEL[id] }));

/** The fields of one login type, and nothing else. */
export function sapFieldsFor(mode: SapAuthMode): readonly ("api_host" | "username" | "password" | "api_key")[] {
  return mode === "api_key" ? ["api_key"] : ["api_host", "username", "password"];
}

/** Why Save can not be pressed yet, or null. The server checks again; this only saves the round trip. */
export function sapFormProblem(form: SapForm, secrets: SapSecretInput, stored: { password: boolean; api_key: boolean }): string | null {
  if (form.auth_mode === "api_key") return secrets.api_key.trim() || stored.api_key ? null : "Paste the API key.";
  if (!form.api_host.trim()) return "Enter the API host.";
  if (/^http:\/\//i.test(form.api_host.trim())) return "The address must use https.";
  if (!form.username.trim()) return "Enter the Communication user.";
  return secrets.password.trim() || stored.password ? null : "Enter the password.";
}

export function sapSaveBody(form: SapForm, secrets: SapSecretInput): { config: SapConnectionInput; secrets: Partial<Record<"password" | "api_key", string>> } {
  if (form.auth_mode === "api_key") return { config: { auth_mode: "api_key" }, secrets: secrets.api_key.trim() ? { api_key: secrets.api_key.trim() } : {} };
  return {
    config: { auth_mode: "basic", api_host: form.api_host.trim(), username: form.username.trim() },
    secrets: secrets.password.trim() ? { password: secrets.password.trim() } : {},
  };
}

export const SAP_SANDBOX_NOTE = `Sample data from ${SAP_SANDBOX_HOST}, read only.`;
