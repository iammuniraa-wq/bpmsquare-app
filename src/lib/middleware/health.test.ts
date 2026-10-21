import { describe, it, expect } from "vitest";
import { secretExpiry, schemaRows, parsePriceLists, parseCurrencies, probeResult } from "./health";
import { SQL_BUNDLES } from "./types";

describe("secret expiry", () => {
  const now = new Date("2026-10-21T12:00:00Z");
  it("warns 30 days before, and after", () => {
    expect(secretExpiry("2027-04-19", now).state).toBe("ok");
    expect(secretExpiry("2026-11-20", now)).toMatchObject({ state: "soon", days_left: 30 });
    expect(secretExpiry("2026-11-21", now).state).toBe("ok");
    expect(secretExpiry("2026-10-21", now)).toMatchObject({ state: "soon", days_left: 0 });
    expect(secretExpiry("2026-10-20", now).state).toBe("expired");
  });
  it("is unknown when no date is set or it is malformed", () => {
    expect(secretExpiry(undefined, now).state).toBe("unknown");
    expect(secretExpiry("next spring", now).state).toBe("unknown");
    expect(secretExpiry("2026-99-99", now).state).toBe("unknown");
  });
});

describe("schema health", () => {
  it("names the SQL bundle for every missing table", () => {
    const rows = schemaRows({ integration_messages: false, tenant_connectors: true, connector_links: true });
    expect(rows.find((r) => r.table === "integration_messages")).toMatchObject({ exists: false, bundle: SQL_BUNDLES.middleware });
    expect(rows.find((r) => r.table === "tenant_connectors")).toMatchObject({ exists: true, bundle: null });
    expect(rows.find((r) => r.table === "connector_sync_runs")).toMatchObject({ exists: false, bundle: SQL_BUNDLES.connectors });
  });
});

describe("pick-lists", () => {
  it("price lists: active only, by name, never a bare GUID as the label", () => {
    const l = parsePriceLists({ value: [{ pricelevelid: "b", name: "Standard", statecode: 0 }, { pricelevelid: "a", name: "Archive", statecode: 1 }, { pricelevelid: "c", name: "Export", statecode: 0 }, { name: "no id" }] });
    expect(l.map((x) => x.name)).toEqual(["Export", "Standard"]);
  });
  it("currencies: name and ISO code", () => {
    const l = parseCurrencies({ value: [{ transactioncurrencyid: "u", currencyname: "Euro", isocurrencycode: "EUR", statecode: 0 }] });
    expect(l).toEqual([{ id: "u", name: "Euro", code: "EUR" }]);
    expect(parseCurrencies(null)).toEqual([]);
  });
});

describe("permission probes", () => {
  it("turns an error into a yes, a no with a fix, or an honest unknown", () => {
    expect(probeResult("a", "Read accounts", null).ok).toBe(true);
    expect(probeResult("a", "Read accounts", { status: 403 })).toMatchObject({ ok: false });
    expect(probeResult("a", "Read accounts", { status: 401 }).fix).toMatch(/Test the connection/);
    expect(probeResult("a", "Read accounts", { status: 503 }).ok).toBeNull();
  });
});
