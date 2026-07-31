import type { ConnectorDef, OAuthProvider } from "./types";

/**
 * The connector catalog -- add an entry here to make a new connector
 * available in Settings -> Connectors. Client-safe (no secrets, no
 * server-only imports) since the UI reads it directly.
 *
 * Slack is api_key: no OAuth app registration needed (a Slack workspace
 * admin generates the webhook URL themselves, in Slack, and pastes it in
 * here), so it works end to end with zero external setup.
 *
 * Google Calendar and Gmail are oauth2, sharing one Google Cloud OAuth
 * client (GOOGLE_CLIENT_ID/SECRET) but consenting to different scopes
 * separately -- connecting one never asks for the other's access. Requires
 * that OAuth app to actually exist before either can be tested; see
 * RELEASE_PROCESS.md or ask for the setup steps.
 */
const GOOGLE_PROVIDER: OAuthProvider = {
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  clientIdEnv: "GOOGLE_CLIENT_ID",
  clientSecretEnv: "GOOGLE_CLIENT_SECRET",
  // offline + consent guarantees a refresh_token comes back every time --
  // without them Google only issues one on a user's very first-ever consent.
  extraAuthParams: { access_type: "offline", prompt: "consent" },
};

export const CONNECTOR_CATALOG: ConnectorDef[] = [
  {
    id: "slack",
    name: "Slack",
    description: "Post BPMSquare notifications to a Slack channel via an Incoming Webhook.",
    icon: "⇄",
    authType: "api_key",
    fields: [
      { key: "webhook_url", label: "Incoming Webhook URL", placeholder: "https://hooks.slack.com/services/…", secret: true },
    ],
    testable: true,
  },
  {
    id: "google_calendar",
    name: "Google Calendar",
    description: "Read upcoming events on the connected Google account's calendar — a first step toward technician scheduling.",
    icon: "⇄",
    authType: "oauth2",
    fields: [],
    oauth: { provider: GOOGLE_PROVIDER, scopes: ["https://www.googleapis.com/auth/calendar.readonly"] },
    testable: true,
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Send email from the connected Gmail account — send-only access plus the account's own address (to address test messages), nothing is ever read from the mailbox.",
    icon: "⇄",
    authType: "oauth2",
    fields: [],
    oauth: { provider: GOOGLE_PROVIDER, scopes: ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/userinfo.email"] },
    testable: true,
  },
];

export function getConnectorDef(id: string): ConnectorDef | undefined {
  return CONNECTOR_CATALOG.find((c) => c.id === id);
}
