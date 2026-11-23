import { describe, expect, it } from "vitest";
import type { PublicConnection } from "@/lib/connections/spec";
import type { ConnectionItem } from "./api";
import { ago, buildConnectionRows, draftFrom, draftProblem, emptyDraft, formFields } from "./customConnectionLogic";

const erp = (id: string, label: string, status: "connected" | "error" | "not_connected", config: object | null = { environment_url: "https://x" }): ConnectionItem =>
  ({ id, label, kind: "erp", state: { status, config, last_error: status === "error" ? "The secret ended." : null, secrets: {} } }) as unknown as ConnectionItem;

const mine = (over: Partial<PublicConnection> = {}): PublicConnection => ({
  id: "c-1", name: "PCBS F&O", family: "odata", config: { base_url: "https://x.operations.dynamics.com/data", auth: "oauth2_cc", oauth_provider: "entra", directory_id: "contoso.onmicrosoft.com", client_id: "cid" },
  secretsSet: { client_secret: true }, status: "ok", lastTestAt: "2026-11-22T10:00:00Z", lastTestMessage: "Connected. The service offers 12 entity sets.", endpointCount: 3, ...over,
});

describe("the fields each type shows: only the minimum", () => {
  const keys = (family: "rest" | "odata", cfg: object) => formFields(family, cfg as never).map((f) => f.key);

  it("no sign-in: a name and an address (and for REST a check path)", () => {
    expect(keys("odata", { auth: "none" })).toEqual(["name", "base_url", "auth"]);
    expect(keys("rest", { auth: "none" })).toEqual(["name", "base_url", "auth", "test_path"]);
  });
  it("API key, basic and bearer add only their own fields", () => {
    expect(keys("rest", { auth: "api_key" })).toEqual(["name", "base_url", "auth", "key_in", "key_name", "api_key", "test_path"]);
    expect(keys("rest", { auth: "basic" })).toEqual(["name", "base_url", "auth", "username", "password", "test_path"]);
    expect(keys("odata", { auth: "bearer" })).toEqual(["name", "base_url", "auth", "token"]);
  });
  it("Microsoft sign-in asks for the directory, the client and the secret: no token address, scope optional", () => {
    const f = formFields("odata", { auth: "oauth2_cc", oauth_provider: "entra" });
    expect(f.map((x) => x.key)).toEqual(["name", "base_url", "auth", "oauth_provider", "directory_id", "client_id", "client_secret", "scope"]);
    expect(f.find((x) => x.key === "scope")).toMatchObject({ optional: true });
  });
  it("another sign-in server asks for its token address instead of the directory", () => {
    const k = keys("odata", { auth: "oauth2_cc", oauth_provider: "custom" });
    expect(k).toContain("token_url");
    expect(k).not.toContain("directory_id");
  });
  it("secrets are the only password fields, and every field with an explanation has one tip key", () => {
    for (const f of formFields("rest", { auth: "oauth2_cc" })) if (f.kind === "secret") expect(f.target).toBe("secret");
  });
});

describe("a draft says what is missing in the server's own words", () => {
  it("a new draft needs a name, an address and its secret", () => {
    const d = emptyDraft("odata");
    expect(draftProblem(d)).toMatch(/name/i);
    d.name = "X";
    expect(draftProblem(d)).toMatch(/service address/i);
    d.config.base_url = "https://x.example.com/data";
    expect(draftProblem(d)).toBeNull();
    d.config.auth = "bearer";
    expect(draftProblem(d)).toMatch(/token/i);
    d.secrets.token = "t";
    expect(draftProblem(d)).toBeNull();
  });
  it("an edit keeps the stored secret when the field is blank", () => {
    const c = mine();
    expect(draftProblem(draftFrom(c), c)).toBeNull();
    const d = draftFrom(c);
    d.config.auth = "bearer";
    expect(draftProblem(d, c)).toMatch(/token/i);
  });
});

describe("the Connections table", () => {
  it("lists the ERP connectors first, unchanged, then the connections you added", () => {
    const rows = buildConnectionRows([erp("dynamics365", "Dynamics 365", "connected"), erp("sap_s4", "SAP S/4HANA", "error")], [mine()]);
    expect(rows.map((r) => [r.kind, r.name, r.status])).toEqual([["existing", "Dynamics 365", "connected"], ["existing", "SAP S/4HANA", "attention"], ["custom", "PCBS F&O", "ok"]]);
    expect(rows[1].detail).toBe("The secret ended.");
    expect(rows[2]).toMatchObject({ type: "OData v4 service", statusText: "Working", endpoints: 3 });
  });

  it("an ERP connector that was never connected is not listed", () => {
    expect(buildConnectionRows([erp("dynamics365", "Dynamics 365", "not_connected", null)], [])).toEqual([]);
  });

  it("while the update is pending the table shows the existing connectors only", () => {
    const rows = buildConnectionRows([erp("dynamics365", "Dynamics 365", "connected")], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("existing");
  });

  it("a connection that was never tested says so; a failed one is flagged", () => {
    const rows = buildConnectionRows([], [mine({ status: "untested", lastTestAt: null, lastTestMessage: null }), mine({ id: "c-2", name: "B", status: "failed", lastTestMessage: "The client secret has expired." })]);
    expect(rows.map((r) => r.statusText)).toEqual(["Not tested", "Needs attention"]);
    expect(rows[1].detail).toBe("The client secret has expired.");
  });
});

describe("ago", () => {
  const now = Date.parse("2026-11-22T12:00:00Z");
  it.each([
    ["2026-11-22T11:59:40Z", "just now"], ["2026-11-22T11:55:00Z", "5 min ago"], ["2026-11-22T09:00:00Z", "3 h ago"], ["2026-11-20T12:00:00Z", "2 d ago"], ["2026-10-01T00:00:00Z", "2026-10-01"], [null, ""],
  ])("%s -> %s", (iso, want) => expect(ago(iso, now)).toBe(want));
});
