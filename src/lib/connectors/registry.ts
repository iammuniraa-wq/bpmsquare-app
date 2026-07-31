import type { ConnectorDef } from "./types";

/**
 * The connector catalog -- add an entry here to make a new connector
 * available in Settings -> Connectors. Client-safe (no secrets, no
 * server-only imports) since the UI reads it directly.
 *
 * Every entry here is api_key: the tenant admin copies one value out of a
 * settings page THEY already have (Slack's own Incoming Webhook setup,
 * Google Calendar's own "secret address in iCal format," a Gmail App
 * Password) and pastes it in -- zero registration with us, zero external
 * developer console, connects in under a minute.
 *
 * A genuine OAuth2 "click a Connect button, land on the real provider's
 * consent screen" flow is also fully built (lib/connectors/oauthState.ts,
 * /api/connectors/[id]/oauth/{start,callback}, ConnectorDef.oauth) and
 * still the right answer eventually -- but it requires BPMSquare itself
 * (the platform, not the tenant) to register an OAuth app with each
 * provider ONE TIME, which is real setup work with its own console, its
 * own redirect URIs, its own client secret. That's a one-time platform
 * cost that then makes every tenant's own connect one click forever --
 * not a per-tenant cost -- but it's still a real setup step someone has to
 * do first, so no catalog entry uses it today. Add an `oauth` field to a
 * future entry once that setup is worth doing for a specific connector.
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
  {
    id: "google_calendar",
    name: "Google Calendar",
    description: "Read upcoming events from a calendar's private iCal feed — Calendar settings → \"Integrate calendar\" → \"Secret address in iCal format.\"",
    icon: "⇄",
    authType: "api_key",
    fields: [
      { key: "ical_url", label: "Secret iCal URL", placeholder: "https://calendar.google.com/calendar/ical/…/private-…/basic.ics", secret: true },
    ],
    testable: true,
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Send email via Gmail using an App Password — Google Account → Security → 2-Step Verification → App passwords (requires 2-Step Verification to be turned on).",
    icon: "⇄",
    authType: "api_key",
    fields: [
      { key: "email", label: "Gmail address", placeholder: "you@gmail.com" },
      { key: "app_password", label: "App password", placeholder: "16-character app password", secret: true },
    ],
    testable: true,
  },
];

export function getConnectorDef(id: string): ConnectorDef | undefined {
  return CONNECTOR_CATALOG.find((c) => c.id === id);
}
