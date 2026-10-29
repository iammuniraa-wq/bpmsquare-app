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
    description: "Connect a Slack Incoming Webhook and test the connection. Nothing is posted to Slack yet.",
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
    description: "Connect a calendar's private iCal address (Calendar settings → \"Integrate calendar\" → \"Secret address in iCal format\") and test the connection. Events are not read yet.",
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
    description: "Send quote emails via your own Gmail account using an App Password — Google Account → Security → 2-Step Verification → App passwords (requires 2-Step Verification to be turned on). When a customer's original email is found in your inbox with a matching subject, the quote sends as a real reply in that same thread instead of a new email.",
    icon: "⇄",
    authType: "api_key",
    fields: [
      { key: "email", label: "Gmail address", placeholder: "you@gmail.com" },
      { key: "app_password", label: "App password", placeholder: "16-character app password", secret: true },
    ],
    testable: true,
  },
  {
    id: "mail_server",
    name: "Mail server (SMTP / IMAP)",
    description: "Your own business mailbox on any mail server — Zoho, Microsoft 365 with IMAP enabled, cPanel or your hosting provider. Used to send RFQs to suppliers from your own address and read their replies back into BPMSquare (Settings → RFQ → Mail channel: your mailbox).",
    icon: "⇄",
    authType: "api_key",
    fields: [
      { key: "email", label: "Email address", placeholder: "purchasing@yourcompany.com" },
      { key: "username", label: "Username (usually the email address)", placeholder: "purchasing@yourcompany.com" },
      { key: "password", label: "Password or app password", placeholder: "Mailbox password", secret: true },
      { key: "smtp_host", label: "SMTP server", placeholder: "smtp.yourcompany.com" },
      { key: "smtp_port", label: "SMTP port", placeholder: "587 (or 465)" },
      { key: "imap_host", label: "IMAP server", placeholder: "imap.yourcompany.com" },
      { key: "imap_port", label: "IMAP port", placeholder: "993" },
    ],
    testable: true,
  },
  {
    id: "dynamics365",
    name: "Microsoft Dynamics 365",
    shortName: "Dynamics 365",
    description: "Bring customers, contacts, vendors, products and projects in from Dynamics 365 Finance & Operations, Dataverse (Sales, Field Service, Project Operations) or Business Central — and send awarded Standard Quotes back as projects. Sign in with an app secret, a certificate, a user account, or (Business Central on-premises) a username and password.",
    icon: "⇄",
    authType: "api_key",
    fields: [],
    testable: false,
    configureHref: "/settings/connectors/dynamics365",
    middleware: true,
  },
  {
    id: "sap_s4",
    name: "SAP S/4HANA",
    description: "Bring customers, suppliers and products in from SAP S/4HANA (Cloud public edition or any S/4HANA with the standard OData APIs), and read its sales orders, deliveries and invoices; Sales Orders can be checked with SAP and sent to it. Sign in with the Communication User of a Communication Arrangement, or try it first with an API key from the SAP Business Accelerator Hub sandbox.",
    icon: "⇄",
    authType: "api_key",
    fields: [],
    testable: false,
    middleware: true,
    middlewareOnly: true,
  },
  {
    // Not `middleware`: the Integration middleware routes serve Dynamics for a connector id they do not know, so a chip
    // there would show another system's data. ePROMIS has its own settings page until its entities exist.
    id: "epromis",
    name: "ePROMIS",
    description: "Read tenders, the Resource Master, Cost Codes and justifications from ePROMIS, and send an awarded tender's project and budget to it. Sign in with an API key, a bearer token or a user name and password; where each operation lives is filled in once the ePROMIS API documentation is available.",
    icon: "⇄",
    authType: "api_key",
    fields: [],
    testable: false,
    configureHref: "/settings/connectors/epromis",
    featureKey: "gcc_tender",
  },
];

/**
 * The connectors a workspace sees as tiles: one that lives only on the Integration middleware page needs that module,
 * and one that belongs to a sold module needs that tenant feature (a call that passes no `features` sees none of them).
 */
export function visibleConnectors(
  middlewareOn: boolean,
  catalog: readonly ConnectorDef[] = CONNECTOR_CATALOG,
  features?: Readonly<Record<string, boolean | undefined>> | null,
): ConnectorDef[] {
  return catalog.filter((d) => (!d.middlewareOnly || middlewareOn) && (!d.featureKey || features?.[d.featureKey] === true));
}

export function getConnectorDef(id: string): ConnectorDef | undefined {
  return CONNECTOR_CATALOG.find((c) => c.id === id);
}
