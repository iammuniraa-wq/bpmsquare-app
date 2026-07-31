/**
 * How a connector authenticates. Only two are implemented today, but the
 * catalog/DB shape (an opaque, per-connector "credentials" JSON blob,
 * encrypted at rest) is deliberately built to take two more without a
 * schema change once a specific connector needs them:
 *   - "admin_consent"    Google Workspace / Microsoft Entra org-wide OAuth,
 *                        approved once by an IT admin for the whole tenant
 *                        rather than a per-user grant.
 *   - "client_credentials"  machine-to-machine auth via a dedicated
 *                        service account/API user IT provisions -- no
 *                        human OAuth grant tied to the integration at all.
 * Both are enterprise-integration patterns; see the "how will it work with
 * enterprises" thread that shaped this file. Adding either later only means
 * adding a value to this union and its own connect route -- not touching
 * tenant_connectors or the settings UI shape.
 */
export type ConnectorAuthType = "api_key" | "oauth2";

export type ConnectorField = {
  key: string;
  label: string;
  placeholder?: string;
  /** Encrypted at rest and masked in the UI once saved. */
  secret?: boolean;
};

/** One OAuth app registration (e.g. one Google Cloud project's OAuth client)
 * can back several connectors that each request different scopes -- Google
 * Calendar and Gmail share GOOGLE_CLIENT_ID/SECRET below but consent
 * separately, per the principle of least privilege (connecting Calendar
 * never asks for Gmail access and vice versa). clientIdEnv/clientSecretEnv
 * are env var NAMES, not the secret values themselves -- safe to send to
 * the client along with the rest of the catalog. */
export type OAuthProvider = {
  authorizeUrl: string;
  tokenUrl: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  /** Provider-specific params always added to the authorize request, e.g.
   * Google's access_type=offline + prompt=consent to guarantee a refresh
   * token comes back on every connect, not just the very first one. */
  extraAuthParams?: Record<string, string>;
};

export type ConnectorDef = {
  id: string;
  name: string;
  description: string;
  icon: string;
  authType: ConnectorAuthType;
  /** What the tenant admin fills in to connect (api_key connectors only --
   * oauth2 connectors instead redirect to the provider). */
  fields: ConnectorField[];
  /** oauth2 connectors only. */
  oauth?: { provider: OAuthProvider; scopes: string[] };
  /** Shown after connecting -- a lightweight way to confirm it actually
   * works, not just that credentials were saved. */
  testable: boolean;
};

export type TenantConnectorRow = {
  connector_id: string;
  status: "connected" | "error";
  config: Record<string, string>;
  last_error: string | null;
  connected_at: string;
};
