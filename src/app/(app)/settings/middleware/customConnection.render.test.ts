import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));

import ConnectionSheet from "./ConnectionSheet";
import ConnectionsView from "./ConnectionsView";
import { EndpointForm } from "./EndpointsPanel";
import type { PublicConnection } from "@/lib/connections/spec";
import { CONNECTION_TIPS, ENDPOINT_TIPS } from "@/lib/connections/tips";
import type { ConnectionItem } from "./api";

// What the screens print: labels, values and actions, never an explanation (they sit behind the "i"), never a secret.

const SECRET = "client-secret-0123456789-never-printed";
const mine: PublicConnection = {
  id: "c-1", name: "PCBS F&O", family: "odata", status: "failed", lastTestAt: "2026-11-22T10:00:00Z", lastTestMessage: "The client secret has expired.", endpointCount: 2,
  config: { base_url: "https://x.operations.dynamics.com/data", auth: "oauth2_cc", oauth_provider: "entra", directory_id: "contoso.onmicrosoft.com", client_id: "cid-123" }, secretsSet: { client_secret: true },
};
const erp = { id: "dynamics365", label: "Dynamics 365", kind: "erp", state: { status: "connected", config: { environment_url: "https://x" }, last_error: null, secrets: {} } } as unknown as ConnectionItem;
const piece = (data: unknown) => ({ data, setData: () => {}, error: null, loading: false, reload: async () => {} }) as never;
const sheet = (initial: PublicConnection | null) => renderToString(createElement(ConnectionSheet, { initial, onClose: () => {}, onSaved: () => {} }));

describe("Add connection", () => {
  it("step 1 offers the two types and the two pages that already exist, and prints no explanation", () => {
    const out = sheet(null);
    expect(out).toContain("Add connection");
    expect(out).toContain("Step 1 of 3");
    expect(out).toContain("REST API");
    expect(out).toContain("OData v4 service");
    expect(out).toContain("Email (IMAP, SMTP)");
    expect(out).toContain('aria-label="About Type"');
    for (const tip of Object.values(CONNECTION_TIPS)) expect(out).not.toContain(tip);
  });

  it("editing opens at step 2 on the stored values, shows the secret as Stored and never prints it", () => {
    const out = sheet(mine);
    expect(out).toContain("Edit PCBS F&amp;O");
    expect(out).toContain("Step 2 of 3");
    expect(out).toContain("https://x.operations.dynamics.com/data");
    expect(out).toContain("cid-123");
    expect(out).toContain(">Stored<");
    expect(out).toContain("Stored. Leave blank to keep it");
    expect(out).not.toContain(SECRET);
    expect(out).toMatch(/type="password"/);
    for (const tip of Object.values(CONNECTION_TIPS)) expect(out).not.toContain(tip);
  });

  it("Microsoft sign-in asks for the directory, not a token address; every field has a label", () => {
    const out = sheet(mine);
    expect(out).toContain("Directory (tenant) ID");
    expect(out).not.toContain("Token address");
    expect(out).toContain("Client secret");
    expect(out).toContain("Scope");
  });
});

describe("the Connections table", () => {
  it("lists the ERP connector first and the connection you added, with its status and its plain last-test line", () => {
    const out = renderToString(createElement(ConnectionsView, { existing: [erp], list: piece({ connections: [mine], needsDatabaseUpdate: false }), onOpenExisting: () => {} }));
    expect(out.indexOf("Dynamics 365")).toBeGreaterThan(-1);
    expect(out.indexOf("Dynamics 365")).toBeLessThan(out.indexOf("PCBS F&amp;O"));
    expect(out).toContain("Needs attention");
    expect(out).toContain("The client secret has expired.");
    expect(out).toContain("OData v4 service · 2 endpoints");
    expect(out).toContain("Add connection");
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain("secretsSet");
  });

  it("a workspace with no connection of its own sees its ERP connectors only", () => {
    const out = renderToString(createElement(ConnectionsView, { existing: [erp], list: piece({ connections: [], needsDatabaseUpdate: false }), onOpenExisting: () => {} }));
    expect(out).toContain("Dynamics 365");
    expect(out).not.toContain("Not tested");
  });

  it("while the update is pending the existing connectors are listed, Add is disabled and the reason stays on screen", () => {
    const out = renderToString(createElement(ConnectionsView, { existing: [erp], list: piece({ connections: [], needsDatabaseUpdate: true }), onOpenExisting: () => {} }));
    expect(out).toContain("Dynamics 365");
    expect(out).toContain("An update is needed before you can add connections.");
    expect(out).toMatch(/<button[^>]*disabled[^>]*>.*Add connection/);
  });

  it("nothing at all: one empty state with the next step", () => {
    const out = renderToString(createElement(ConnectionsView, { existing: [], list: piece({ connections: [], needsDatabaseUpdate: false }), onOpenExisting: () => {} }));
    expect(out).toContain("No connections yet");
  });
});

describe("the endpoint form", () => {
  const form = (family: "rest" | "odata") => renderToString(createElement(EndpointForm, { connection: { ...mine, family }, editing: null, onBack: () => {}, onDone: async () => {} }));

  it("an OData connection asks for an entity set; a REST one for a path; neither prints an explanation", () => {
    const o = form("odata");
    expect(o).toContain("Entity set");
    expect(o).toContain("Serves");
    expect(o).toContain("By hand");
    expect(o).toContain("From the system");
    expect(o).toContain("From a template");
    const r = form("rest");
    expect(r).toContain(">Path<");
    for (const tip of Object.values(ENDPOINT_TIPS)) { expect(o).not.toContain(tip); expect(r).not.toContain(tip); }
  });
});
