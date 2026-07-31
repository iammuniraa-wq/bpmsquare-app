import type { ConnectorDef } from "./types";

/**
 * The connector catalog -- add an entry here to make a new connector
 * available in Settings -> Connectors. Client-safe (no secrets, no
 * server-only imports) since the UI reads it directly.
 *
 * Only one real connector today (Slack). It's deliberately the simplest
 * possible proof of the framework: no OAuth app registration needed (a
 * Slack workspace admin generates the webhook URL themselves, in Slack, and
 * pastes it in here) so the whole mechanism -- catalog, encrypted storage,
 * connect/disconnect, a real test action -- works end to end today.
 */
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
];

export function getConnectorDef(id: string): ConnectorDef | undefined {
  return CONNECTOR_CATALOG.find((c) => c.id === id);
}
