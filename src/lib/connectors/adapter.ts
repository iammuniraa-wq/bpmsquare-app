// The frame every ERP connector on the Integration middleware page fits (docs/design/erp-connectors-sap-epromis.md,
// section 1). The five tabs never talk to a vendor; they ask an adapter. Client-safe types only, so a screen can
// read an adapter's description. Dynamics 365 is wired to the page directly and is not rewritten onto this yet;
// SAP S/4HANA is the first adapter written against it.

export type ErpAuthMode = "basic" | "api_key" | "oauth_client_credentials" | "client_secret" | "certificate" | "authorization_code";

export type ErpCapabilities = {
  /** Entities BPMSquare can read from the system, by the keys the Links and Resync tabs use. */
  pull: readonly string[];
  /** An awarded quote can be created in the system (a quote, a sales order or a project). */
  pushQuote: boolean;
  pushProject: boolean;
  /** A Sales Order can be checked in the system and sent to it (Check with ERP, Send to ERP): the OrderConnector seam, src/lib/salesOrders/orderConnector.ts. */
  pushOrder: boolean;
  /** The system describes its own fields, so the Mapping tab can list them. */
  metadata: boolean;
  /** The sign-in needs a price list / currency style pick-list before a quote can go out. */
  pickLists: readonly string[];
};

export type ErpField = { name: string; label: string; type: string; required: boolean; creatable: boolean };

export type ErpTestResult = { ok: boolean; line: string; failures: { label: string; fix: string | null }[] };

export type ErpPullOptions = { trigger: "manual" | "schedule"; userId: string | null; full?: boolean; ids?: string[]; deadline?: number; maxRows?: number };

export type ErpPullResult = {
  runId: string | null;
  counts: { read: number; created: number; updated: number; unchanged: number; skipped: number; failed: number; filtered?: number; outside_scope?: number };
  issues: string[];
  error: string | null;
};

/** What the middleware page asks of a connector. A method a connector cannot offer is simply absent. */
export interface ErpAdapter {
  id: string;
  label: string;
  authModes: readonly ErpAuthMode[];
  capabilities: ErpCapabilities;
  /** One authenticated call per scenario the pulls need, told in plain words. Never returns a secret. */
  testConnection(tenantId: string): Promise<ErpTestResult>;
  /** The system's own field list for one entity: the pick-list of the Mapping tab. */
  metadata(tenantId: string, entity: string, opts?: { refresh?: boolean }): Promise<{ fields: ErpField[]; source: "metadata" | "sample" } | { error: string }>;
  /** The first rows of an entity as the system returns them. Nothing is written. */
  preview(tenantId: string, entity: string): Promise<{ rows: Record<string, unknown>[] } | { error: string; status: number }>;
  /** Read one entity into BPMSquare: idempotent through connector_links, one run row as the lock. */
  pull(tenantId: string, entity: string, opts: ErpPullOptions): Promise<ErpPullResult>;
  /** The number people recognise in the system (never a GUID), from a row the system returned. */
  readableKey(entity: string, row: Record<string, unknown>): string | null;
  /** The shipped maps (BPMSquare field to the system's field) so a pull works with zero configuration. */
  presets: Record<string, Record<string, string>>;
}
