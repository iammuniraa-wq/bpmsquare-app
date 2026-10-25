import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { tipTextProblems } from "@/lib/infoTip";
import { CONNECTOR_CATALOG, getConnectorDef, visibleConnectors } from "@/lib/connectors/registry";
import { EPROMIS_TIPS } from "@/lib/connectors/epromis/tips";
import { cleanEndpointMap } from "@/lib/connectors/epromis/endpointMap";
import { EPROMIS_OPERATIONS } from "@/lib/connectors/epromis/types";
import preset from "@/lib/connectors/epromis/presets/epromis.default.json";
import { connectorTileHref, middlewareConnectors } from "../../middleware/connectors";
import { EMPTY_FORM, TEMPLATE_TEXT, formFromState, formProblem, hostOf, mapSummary, parseEndpointText, saveBody } from "./epromisLogic";
import EpromisForm from "./EpromisForm";

const html = (el: React.ReactElement) => renderToString(el).replace(/<!-- -->/g, "");
const noop = () => {};
const render = (form = EMPTY_FORM, over: Partial<Parameters<typeof EpromisForm>[0]> = {}) =>
  html(createElement(EpromisForm, { form, setForm: noop, secret: "", setSecret: noop, secretStored: false, problem: null, saving: false, onSave: noop, fresh: true, ...over }));

describe("the registry entry", () => {
  const def = getConnectorDef("epromis")!;

  it("is an ERP card named ePROMIS beside Dynamics 365 and SAP", () => {
    expect(def).toMatchObject({ id: "epromis", name: "ePROMIS", configureHref: "/settings/connectors/epromis", featureKey: "gcc_tender", testable: false });
    expect(CONNECTOR_CATALOG.map((c) => c.id)).toEqual(expect.arrayContaining(["dynamics365", "sap_s4", "epromis"]));
  });

  it("is a tile only in a workspace with the tender module", () => {
    expect(visibleConnectors(false).some((c) => c.id === "epromis")).toBe(false);
    expect(visibleConnectors(true).some((c) => c.id === "epromis")).toBe(false);
    expect(visibleConnectors(false, CONNECTOR_CATALOG, { gcc_tender: false }).some((c) => c.id === "epromis")).toBe(false);
    expect(visibleConnectors(false, CONNECTOR_CATALOG, { gcc_tender: true }).some((c) => c.id === "epromis")).toBe(true);
    // Every other tile is unaffected by the new rule.
    expect(visibleConnectors(false).map((c) => c.id)).toEqual(["slack", "google_calendar", "gmail", "mail_server", "dynamics365"]);
  });

  it("opens its own settings page from the tile, flag or no flag", () => {
    expect(connectorTileHref(def, true)).toBe("/settings/connectors/epromis");
    expect(connectorTileHref(def, false)).toBe("/settings/connectors/epromis");
  });

  it("is not a chip on the Integration middleware page yet: that page serves Dynamics for a connector id it does not know", () => {
    expect(middlewareConnectors().map((c) => c.id)).not.toContain("epromis");
  });
});

describe("explanations", () => {
  it.each(Object.entries(EPROMIS_TIPS))("%s fits the limit", (_k, text) => {
    expect(tipTextProblems(text)).toEqual([]);
  });
  it("say who can edit and that the map waits for the documentation", () => {
    expect(EPROMIS_TIPS.page).toMatch(/admins/);
    expect(EPROMIS_TIPS.endpointMap).toMatch(/documentation/);
  });
});

describe("the shipped preset is an honest empty shape", () => {
  it("is labelled a guess, unverified, and holds no address or field", () => {
    expect(preset.verified).toBe(false);
    expect(preset.source).toBe("guess");
    expect(preset.note).toMatch(/NOT ePROMIS/);
    expect(Object.keys(preset.endpoints).sort()).toEqual([...EPROMIS_OPERATIONS].sort());
    const walk = (v: unknown): string[] => (v && typeof v === "object" ? Object.values(v).flatMap(walk) : typeof v === "string" ? [v] : []);
    // Methods are the only text in it; no path, no field name.
    expect(walk(preset.endpoints).filter((s) => s !== "" && !/^(GET|POST|PUT|PATCH)$/.test(s))).toEqual([]);
  });
  it("loads into the box as a map that is valid and still empty", () => {
    expect(cleanEndpointMap(parseEndpointText(TEMPLATE_TEXT).value)).toEqual({ map: {}, problem: null });
  });
});

describe("the form rules", () => {
  const ok = { ...EMPTY_FORM, base_url: "https://erp.example.com/api" };

  it("says what is missing before Save", () => {
    expect(formProblem(EMPTY_FORM, "", false)).toMatch(/base URL/);
    expect(formProblem({ ...ok, base_url: "http://erp.example.com" }, "k", false)).toMatch(/https/);
    expect(formProblem(ok, "", false)).toMatch(/credential/);
    expect(formProblem({ ...ok, key_header: "" }, "k", false)).toMatch(/header name/);
    expect(formProblem({ ...ok, auth_type: "basic" }, "k", false)).toMatch(/user name/);
    expect(formProblem({ ...ok, company_value: "C1" }, "k", false)).toMatch(/company code/);
    expect(formProblem({ ...ok, endpoints_text: "{nope" }, "k", false)).toMatch(/JSON/);
    expect(formProblem(ok, "k", false)).toBeNull();
    expect(formProblem(ok, "", true)).toBeNull();
  });

  it("sends only the fields of the chosen sign-in, and a credential only when one was typed", () => {
    expect(saveBody({ ...ok, auth_type: "bearer", key_header: "X", username: "u" }, "")).toEqual({
      config: expect.objectContaining({ auth_type: "bearer", key_header: "", username: "" }), secrets: {},
    });
    expect(saveBody({ ...ok, auth_type: "basic", username: " bob " }, " pw ").config).toMatchObject({ username: "bob" });
    expect(saveBody({ ...ok, auth_type: "basic", username: "bob" }, " pw ").secrets).toEqual({ secret: "pw" });
    expect(saveBody({ ...ok, company_value: "", company_name: "X-C" }, "k").config).toMatchObject({ company_name: "" });
  });

  it("loads a stored state into the form without a credential, and summarises the map", () => {
    const f = formFromState({
      config: { base_url: "https://erp.example.com/api", auth_type: "basic", key_header: "", username: "bob", company_name: "db", company_value: "K1", company_in: "query", endpoints: { ping: { path: "/ping" } } },
      secret_stored: true, status: "connected", last_error: null,
    });
    expect(f).toMatchObject({ auth_type: "basic", username: "bob", company_in: "query", key_header: "X-API-Key" });
    expect(JSON.parse(f.endpoints_text)).toEqual({ ping: { path: "/ping" } });
    expect(mapSummary({ endpoints: {} })).toBe("Endpoint map not filled yet");
    expect(mapSummary({ endpoints: { ping: { path: "/ping" } } })).toBe("1 of 9 operations set");
    expect(hostOf("https://erp.example.com:8443/api")).toBe("erp.example.com:8443");
  });
});

describe("the form renders", () => {
  it("asks for the address, the sign-in and the credential, each with its explanation, and nothing else", () => {
    const out = render();
    for (const label of ["Base URL", "Sign-in", "Header name", "API key", "Company code", "Endpoint map"]) expect(out).toContain(label);
    expect(out).not.toContain('for="ep-user"');
    expect((out.match(/aria-label="About /g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(out).toContain('type="password"');
    expect(out).toContain("Connect");
  });

  it.each([
    ["bearer", "Token", "Header name"],
    ["basic", "Password", "User name"],
  ] as const)("%s shows %s, and not the API key header", (auth, credential, extra) => {
    const out = render({ ...EMPTY_FORM, auth_type: auth });
    expect(out).toContain(credential);
    if (auth === "basic") expect(out).toContain('for="ep-user"');
    else expect(out).not.toContain(`>${extra}<`);
    expect(out).not.toContain('for="ep-header"');
  });

  it("shows 'Stored' for a stored credential and never its value", () => {
    const out = render({ ...EMPTY_FORM, base_url: "https://erp.example.com" }, { secretStored: true, fresh: false });
    expect(out).toContain("Stored");
    expect(out).toContain("Stored. Leave blank to keep it");
    expect(out).not.toMatch(/id="ep-secret"[^>]*value="[^"]/);
    expect(out).toContain("Save");
  });

  it("offers the company name and where it goes only once a company code is typed", () => {
    expect(render()).not.toContain("Sent as");
    expect(render({ ...EMPTY_FORM, company_value: "K1" })).toContain("Sent as");
  });

  it("shows a problem only once the address has been started", () => {
    expect(render(EMPTY_FORM, { problem: "Enter the base URL." })).not.toContain("Enter the base URL.");
    expect(render({ ...EMPTY_FORM, base_url: "x" }, { problem: "Enter the credential." })).toContain("Enter the credential.");
  });

  it("holds the map in a folded section with the empty-template button", () => {
    const out = render();
    expect(out).toContain("<details>");
    expect(out).toContain("Start from the empty template");
  });
});
