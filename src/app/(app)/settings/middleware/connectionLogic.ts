import type { HealthView, PermissionCheck, TestView } from "./api";

// The connection panel's pure parts: what the connector chip says, the one result
// line of Test, and the one banner the health check may show.

export type TestOutcome = { ok: boolean; line: string; failures: { label: string; fix: string | null }[] };

/** The server already tells Test as one line plus only what failed; the screen shows it as it is. */
export const testOutcome = (t: TestView): TestOutcome => ({ ok: t.ok, line: t.line, failures: t.failures });

/**
 * The older two-call Test (connection, then the permission probes), told as ONE line. Kept for a
 * server that still answers that way. A permission that could not be confirmed is not a failure.
 */
export function summarizeTest(
  connection: { ok: boolean; message: string | null },
  checks: readonly PermissionCheck[] | null,
  checksError: string | null = null,
): TestOutcome {
  if (!connection.ok) {
    return { ok: false, line: "Could not connect.", failures: [{ label: connection.message ?? "The ERP did not accept the sign-in.", fix: null }] };
  }
  if (!checks) {
    return { ok: true, line: "The connection works. Permissions could not be checked just now.", failures: checksError ? [{ label: checksError, fix: null }] : [] };
  }
  const missing = checks.filter((c) => c.ok === false);
  const unknown = checks.filter((c) => c.ok === null);
  if (missing.length > 0) {
    return { ok: false, line: `The connection works, but ${missing.length} permission${missing.length === 1 ? " is" : "s are"} missing.`, failures: missing.map((c) => ({ label: c.label, fix: c.fix })) };
  }
  if (unknown.length > 0) return { ok: true, line: "The connection works. Some permissions could not be confirmed; send a test quote to be sure.", failures: [] };
  return { ok: true, line: "The connection and the permissions are fine.", failures: [] };
}

/** "contoso.crm4.dynamics.com": the address without the scheme, for the one-line summary. */
export function addressWord(url: string | undefined | null): string {
  if (!url) return "";
  return url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

/** What the connection panel shows beside "Connected": the address, or for the SAP sandbox login the plain words that it is sample data. */
export function addressLine(connectorId: string, cfg: { environment_url?: string; sandbox?: boolean } | null | undefined): string {
  if (!cfg) return "";
  if (connectorId === "sap_s4" && cfg.sandbox === true) return "Sandbox (sample data)";
  return addressWord(cfg.environment_url);
}

/** The small chip on the connector, only within 30 days of the secret ending. An ended secret is a problem banner, not a chip. */
export function expiryChip(health: Pick<HealthView, "secretSoon"> | null | undefined): string | null {
  const d = health?.secretSoon?.days;
  if (d === undefined || d === null) return null;
  return d <= 0 ? "Secret ends today" : `Secret ends in ${d} day${d === 1 ? "" : "s"}`;
}

/** One warning, only when something is missing (a table, a working connection, a live secret). Null otherwise. */
export function healthBanner(health: Pick<HealthView, "problems"> | null | undefined): string | null {
  if (!health || health.problems.length === 0) return null;
  const lines = health.problems.map((p) => {
    const msg = p.message.replace(/\.?\s*$/, "");
    return p.kind === "database" && p.bundle ? `${msg}: run ${p.bundle} once, then reload.` : `${msg}.`;
  });
  return lines.join(" ");
}
