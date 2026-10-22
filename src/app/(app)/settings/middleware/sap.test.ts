import { describe, expect, it } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { tipTextProblems } from "@/lib/infoTip";
import type { SapPublicState } from "@/lib/connectors/sap_s4/types";
import { withConnector, type ConnectionItem, type SyncEntity } from "./api";
import { addressLine } from "./connectionLogic";
import { SAP_S4, hasOutbound, middlewareConnectors } from "./connectors";
import { SAP_INBOUND_LINKS, buildLinks } from "./linksLogic";
import { inboundChoices, isInboundDocument } from "./mappingLogic";
import { SAP_LOGIN_CHOICES, sapFieldsFor, sapFormProblem, sapSaveBody } from "./sapConnectionLogic";
import { deriveInboundSetup, slimLine } from "./setup";
import { MIDDLEWARE_TIPS } from "./tips";
import { LinksTable } from "./LinksTab";
import { EntityRows, entityWord } from "./ResyncTab";
import SapConnectionForm from "./SapConnectionForm";

const el = create as unknown as (c: unknown, p: object | null, ...kids: unknown[]) => ReactElement;
const html = (e: ReactElement) => renderToString(e);

describe("the SAP chip", () => {
  it("is the second connector on the page, and reads only", () => {
    const list = middlewareConnectors();
    expect(list.map((c) => c.id)).toEqual(["dynamics365", "sap_s4"]);
    expect(list[1]).toMatchObject({ name: "SAP S/4HANA", shortName: "SAP S/4HANA" });
    expect(hasOutbound(SAP_S4)).toBe(false);
    expect(hasOutbound("dynamics365")).toBe(true);
  });

  it("names the connector on every call but the first one's, so Dynamics calls are exactly what they were", () => {
    expect(withConnector("/api/middleware/sync", "dynamics365")).toBe("/api/middleware/sync");
    expect(withConnector("/api/middleware/sync", "sap_s4")).toBe("/api/middleware/sync?connector=sap_s4");
    expect(withConnector("/api/middleware/scope?entity=customers", "sap_s4")).toBe("/api/middleware/scope?entity=customers&connector=sap_s4");
    expect(withConnector("/api/middleware/sync?connector=sap_s4", "sap_s4")).toBe("/api/middleware/sync?connector=sap_s4");
    expect(withConnector("/api/accounts", "sap_s4")).toBe("/api/accounts");
  });
});

describe("the connection panel", () => {
  it("shows one choice and only the fields of that choice", () => {
    expect(SAP_LOGIN_CHOICES.map((c) => c.label)).toEqual(["Communication user", "API key (SAP Business Accelerator Hub sandbox)"]);
    expect(sapFieldsFor("basic")).toEqual(["api_host", "username", "password"]);
    expect(sapFieldsFor("api_key")).toEqual(["api_key"]);
  });

  it("says what is missing before Save, and a stored secret counts", () => {
    const none = { password: false, api_key: false };
    const basic = { auth_mode: "basic" as const, api_host: "my426318-api.s4hana.cloud.sap", username: "BPM_USER" };
    expect(sapFormProblem({ ...basic, api_host: "" }, { password: "x", api_key: "" }, none)).toBe("Enter the API host.");
    expect(sapFormProblem({ ...basic, api_host: "http://x" }, { password: "x", api_key: "" }, none)).toBe("The address must use https.");
    expect(sapFormProblem({ ...basic, username: " " }, { password: "x", api_key: "" }, none)).toBe("Enter the Communication user.");
    expect(sapFormProblem(basic, { password: "", api_key: "" }, none)).toBe("Enter the password.");
    expect(sapFormProblem(basic, { password: "", api_key: "" }, { ...none, password: true })).toBeNull();
    expect(sapFormProblem({ ...basic, auth_mode: "api_key" }, { password: "", api_key: "" }, none)).toBe("Paste the API key.");
    expect(sapFormProblem({ ...basic, auth_mode: "api_key" }, { password: "", api_key: "k" }, none)).toBeNull();
  });

  it("sends the fields of the chosen login and a secret only when one was typed", () => {
    const form = { auth_mode: "basic" as const, api_host: " my426318-api.s4hana.cloud.sap ", username: " BPM_USER " };
    expect(sapSaveBody(form, { password: " pw ", api_key: "ignored" })).toEqual({ config: { auth_mode: "basic", api_host: "my426318-api.s4hana.cloud.sap", username: "BPM_USER" }, secrets: { password: "pw" } });
    expect(sapSaveBody(form, { password: "", api_key: "" }).secrets).toEqual({});
    expect(sapSaveBody({ ...form, auth_mode: "api_key" }, { password: "pw", api_key: " k " })).toEqual({ config: { auth_mode: "api_key" }, secrets: { api_key: "k" } });
  });

  it("the summary names the host, or says the sandbox is sample data", () => {
    expect(addressLine("sap_s4", { environment_url: "https://my426318-api.s4hana.cloud.sap", sandbox: false })).toBe("my426318-api.s4hana.cloud.sap");
    expect(addressLine("sap_s4", { environment_url: "https://sandbox.api.sap.com", sandbox: true })).toBe("Sandbox (sample data)");
    expect(addressLine("dynamics365", { environment_url: "https://org.crm.dynamics.com/" })).toBe("org.crm.dynamics.com");
    expect(addressLine("sap_s4", null)).toBe("");
  });

  const item = (state: Partial<SapPublicState>): ConnectionItem => ({ id: "sap_s4", label: "SAP S/4HANA", kind: "erp", state: state as never });
  const stored = (mode: "basic" | "api_key"): SapPublicState => ({
    config: {
      auth_mode: mode, api_host: mode === "basic" ? "my426318-api.s4hana.cloud.sap" : "sandbox.api.sap.com", username: mode === "basic" ? "BPM_USER" : "", schedule: "off",
      environment_url: "x", sandbox: mode === "api_key", entities: {} as never,
    },
    secrets: { password: mode === "basic", api_key: mode === "api_key" }, status: "connected", last_error: null,
  });

  it("renders the Communication user fields, with the password stored and never shown", () => {
    const out = html(el(SapConnectionForm, { item: item(stored("basic")), connectorId: "sap_s4", onChanged: () => undefined }));
    for (const w of ["Login type", "API host", "Communication user", "Password", "BPM_USER", "Stored"]) expect(out).toContain(w);
    expect(out).not.toContain('id="sap-api_key"');
    expect(out).toContain("Stored. Leave blank to keep it");
  });

  it("renders only the API key for the sandbox login", () => {
    const out = html(el(SapConnectionForm, { item: item(stored("api_key")), connectorId: "sap_s4", onChanged: () => undefined }));
    expect(out).toContain("API key");
    for (const id of ["sap-host", "sap-user", "sap-password"]) expect(out).not.toContain(`id="${id}"`);
    expect(out).toContain('id="sap-api_key"');
  });

  it("a first connection asks for the host, the user and the password and offers Connect", () => {
    const out = html(el(SapConnectionForm, { item: null, connectorId: "sap_s4", onChanged: () => undefined }));
    for (const w of ["API host", "Communication user", "Password", "Connect"]) expect(out).toContain(w);
  });
});

describe("Links, Mapping, Resync for SAP", () => {
  const ent = (key: string): SyncEntity => ({ key: key as never, label: key, direction: "pull", enabled: true, entity_set: "x", schedule: "daily", schedule_source: "entity", running: false, linked: 2, last_run: null });
  const entities = [ent("customers"), ent("vendors"), ent("products")];

  it("shows three inbound rows and no outbound one", () => {
    const rows = buildLinks([], entities, SAP_INBOUND_LINKS);
    expect(rows.map((r) => [r.kind, r.bpm, r.erp])).toEqual([["in", "Accounts", "Customers"], ["in", "Suppliers", "Suppliers"], ["in", "Products", "Products"]]);
    const out = html(el(LinksTable, { rows, connected: true, busy: null, onOpen: () => undefined, onToggle: () => undefined, onTest: () => undefined }));
    expect(out).not.toContain("Standard Quote");
    expect(out).not.toContain("When awarded");
    expect(out).not.toContain("Send a test quote");
    expect(out).toContain("Suppliers");
  });

  it("the Dynamics Links rows are unchanged", () => {
    expect(buildLinks([], [ent("customers"), ent("vendors"), ent("products")]).map((r) => r.bpm)).toEqual(["Accounts", "Products"]);
  });

  it("maps customers, suppliers and products, and calls vendors 'Suppliers' only for SAP", () => {
    expect(inboundChoices("SAP S/4HANA").map((c) => c.key)).toEqual(["customers", "vendors", "products"]);
    expect(isInboundDocument("vendors")).toBe(true);
    expect(entityWord("vendors", "sap_s4")).toBe("Suppliers");
    expect(entityWord("vendors")).toBe("Vendors");
    expect(entityWord("vendors", "dynamics365")).toBe("Vendors");
    const out = html(el(EntityRows, { rows: [ent("vendors")], connectorId: "sap_s4", connected: true, busy: null, lines: {}, onSync: () => undefined, onSchedule: () => undefined }));
    expect(out).toContain("Suppliers");
    expect(out).toContain("All "); // the Scope cell
    expect(out.match(/Sync now/g)).toHaveLength(1);
  });

  it("the set-up line has two steps and none about sending", () => {
    const s0 = deriveInboundSetup({ connected: false, customersSynced: false });
    expect(s0.steps.map((s) => s.id)).toEqual(["connect", "customers"]);
    expect(slimLine(s0)).toBe("Set up 0 of 2 · Next: connect your ERP");
    expect(slimLine(deriveInboundSetup({ connected: true, customersSynced: false }))).toBe("Set up 1 of 2 · Next: read your customers in Resync");
    expect(deriveInboundSetup({ connected: true, customersSynced: true }).complete).toBe(true);
  });
});

describe("the texts", () => {
  it("every SAP explanation fits the InfoTip limit", () => {
    for (const key of ["sapLogin", "sapHost", "sapUser", "sapPassword", "sapApiKey", "linksSap", "scopeSap"] as const) expect(tipTextProblems(MIDDLEWARE_TIPS[key]), key).toEqual([]);
  });
});
