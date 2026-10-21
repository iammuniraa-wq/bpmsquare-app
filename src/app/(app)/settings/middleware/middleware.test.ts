import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { SETTINGS_MENU, visibleSettingsMenu } from "@/lib/settingsMenu";
import { CONNECTOR_CATALOG } from "@/lib/connectors/registry";
import type { ConnectorDef } from "@/lib/connectors/types";
import type { ErpField, MonitorMessage } from "./api";
import { MIDDLEWARE_TIPS, environmentTip, secretExpiryTip } from "./tips";
import { TAB_IDS, deriveSetup, sentEvidence, slimLine, type SetupInputs } from "./setup";
import {
  durationWord, filterProblem, filtersToQuery, hasFilters, recordHref, statusFilterWord, statusWord,
} from "./monitorLogic";
import {
  appendPlaceholder, applySuggestions, mapToRows, missingRequired, rowsToMap, sameMap, validateRows,
} from "./mapEditor";
import { connectorTileHref, middlewareConnectors, needsPickLists, shortName } from "./connectors";
import { quoteOptions } from "./quotePick";
import * as server from "@/lib/middleware/types";
import * as client from "./api";

const base: SetupInputs = { connected: false, outcomeOn: true, outcomeConfirmed: true, customersSynced: true, testSent: false, realSeen: false };

describe("the set-up line", () => {
  it("ticks nothing before there is a connection, whatever else is true", () => {
    const g = deriveSetup({ ...base, testSent: true, realSeen: true });
    expect(g.steps.filter((s) => s.id !== "test" && s.id !== "real").map((s) => s.done)).toEqual([false, false, false]);
    expect(g.complete).toBe(false);
  });
  it("is complete only when all five are, and each step names where it is finished", () => {
    const all = deriveSetup({ connected: true, outcomeOn: true, outcomeConfirmed: true, customersSynced: true, testSent: true, realSeen: true });
    expect(all.complete).toBe(true);
    expect(all.doneCount).toBe(5);
    for (const s of all.steps) expect([...TAB_IDS, "connection"]).toContain(s.target);
    expect(slimLine(all)).toBe("");
  });
  it("says how far along and what comes next, in one line", () => {
    const g = deriveSetup({ ...base, connected: true });
    expect(g.doneCount).toBe(3);
    expect(slimLine(g)).toBe("Set up 3 of 5 · Next: send a test quote");
    expect(slimLine(deriveSetup(base))).toBe("Set up 0 of 5 · Next: connect your ERP");
  });
  it("does not call the links chosen when everything is off or nothing was saved", () => {
    expect(deriveSetup({ ...base, connected: true, outcomeOn: false }).steps[1].done).toBe(false);
    expect(deriveSetup({ ...base, connected: true, outcomeConfirmed: false }).steps[1]).toMatchObject({ done: false, target: "links" });
  });
});

const msg = (over: Partial<MonitorMessage>): MonitorMessage => ({ what: null, erpNumber: null, restartable: false, fix: null, hasPayload: false,
  id: "integration:1", source: "integration", at: "2026-10-21T10:00:00Z", direction: "out", channel: "connector", counterpart: "Dynamics 365",
  summary: "SQ-0001 awarded", status: "ok", record: { type: "standard_quotes", id: "q1", label: "SQ-0001" }, duration_ms: 900, ...over,
});

describe("what the recent messages prove", () => {
  it("a sent test quote is not a real quote, and a real one is not a test", () => {
    expect(sentEvidence([msg({ record: null, summary: "ZZ-TEST-2026 awarded", status: "ok" })])).toEqual({ testSent: true, realSeen: false });
    expect(sentEvidence([msg({})])).toEqual({ testSent: false, realSeen: true });
    expect(sentEvidence([msg({ record: { type: "standard_quotes", id: "q", label: "ZZ-TEST-1" } })])).toEqual({ testSent: true, realSeen: false });
  });
  it("counts only what reached the ERP", () => {
    expect(sentEvidence([msg({ status: "failed" }), msg({ status: "pending" }), msg({ direction: "in" }), msg({ channel: "email" })])).toEqual({ testSent: false, realSeen: false });
  });
});

describe("monitor filters", () => {
  it("builds the query from the filters and leaves out what is empty or unknown", () => {
    expect(filtersToQuery({})).toBe("");
    const q = new URLSearchParams(filtersToQuery({ direction: "out", channel: "connector", status: "failed", q: "  SQ-1 " }, { limit: 50, cursor: "abc" }));
    expect(Object.fromEntries(q)).toEqual({ direction: "out", channel: "connector", status: "failed", q: "SQ-1", cursor: "abc", limit: "50" });
    expect(filtersToQuery({ direction: "sideways" as never, channel: "fax" as never, status: "meh" as never, object_id: "not-a-uuid" })).toBe("");
  });
  it("turns days into whole UTC days and drops a malformed date", () => {
    const q = new URLSearchParams(filtersToQuery({ from: "2026-10-01", to: "2026-10-02" }));
    expect(q.get("from")).toBe("2026-10-01T00:00:00.000Z");
    expect(q.get("to")).toBe("2026-10-02T23:59:59.999Z");
    expect(filtersToQuery({ from: "yesterday" })).toBe("");
  });
  it("clamps the page size and warns about a range that runs backwards", () => {
    expect(new URLSearchParams(filtersToQuery({}, { limit: 5000 })).get("limit")).toBe("100");
    expect(filterProblem({ from: "2026-10-05", to: "2026-10-01" })).not.toBeNull();
    expect(filterProblem({ from: "2026-10-01", to: "2026-10-05" })).toBeNull();
    expect(hasFilters({})).toBe(false);
    expect(hasFilters({ q: "x" })).toBe(true);
  });
  it("accepts a record id as the one-record filter", () => {
    expect(filtersToQuery({ object_id: "0b1f3c3e-8d0b-4a55-9f6e-0a6a3a7d2f10" })).toContain("object_id=");
  });
});

describe("the words for a status", () => {
  it("uses one vocabulary and names the system for a connector message", () => {
    expect(statusWord({ status: "ok", direction: "out", channel: "connector" }, "Dynamics 365")).toBe("Sent to Dynamics 365");
    expect(statusWord({ status: "ok", direction: "in", channel: "connector" }, "Dynamics 365")).toBe("Received from Dynamics 365");
    expect(statusWord({ status: "ok", direction: "out", channel: "email" })).toBe("Sent");
    expect(statusWord({ status: "failed", direction: "out", channel: "connector" })).toBe("Failed");
    expect(statusWord({ status: "pending", direction: "out", channel: "connector" })).toBe("Waiting");
    expect(statusWord({ status: "skipped", direction: "out", channel: "connector" })).toBe("Skipped");
    expect(statusWord({ status: "redirected", direction: "out", channel: "email" })).toBe("Redirected (demo)");
  });
  it("shows no status code or technical word in any chip", () => {
    for (const status of ["ok", "failed", "pending", "skipped", "redirected", "dry_run"] as const) {
      for (const direction of ["in", "out"] as const) {
        const w = statusWord({ status, direction, channel: "connector" }, "Dynamics 365");
        expect(w).not.toMatch(/_|statecode|pending|http/i);
      }
      expect(statusFilterWord(status)).not.toMatch(/_/);
    }
  });
  it("formats durations and record links", () => {
    expect(durationWord(null)).toBe("—");
    expect(durationWord(340)).toBe("340 ms");
    expect(durationWord(1234)).toBe("1.2 s");
    expect(durationWord(42_000)).toBe("42 s");
    expect(recordHref({ type: "standard_quotes", id: "abc", label: null })).toBe("/standard-quotes/abc");
    expect(recordHref({ type: "unknown_thing", id: "abc", label: null })).toBeNull();
    expect(recordHref({ type: "accounts", id: null, label: "x" })).toBeNull();
  });
});

const row = (field: string, value: string) => ({ key: field, field, value });

describe("the map editor", () => {
  const out = ["name", "ref", "description", "qty"];
  it("turns rows into a map and back, skipping half-empty rows", () => {
    expect(rowsToMap([row("name", "{name}"), row("", "x"), row("y", "")])).toEqual({ name: "{name}" });
    expect(rowsToMap(mapToRows({ a: "{ref}", b: "{name}" }))).toEqual({ a: "{ref}", b: "{name}" });
    expect(sameMap({ a: "1", b: "2" }, { b: "2", a: "1" })).toBe(true);
    expect(sameMap({ a: "1" }, { a: "2" })).toBe(false);
  });
  it("rejects a placeholder BPMSquare does not offer, an unclosed brace and a bad field name", () => {
    expect(validateRows("outbound", "quote", [row("name", "{nope}")], out)[0].message).toContain("{nope}");
    expect(validateRows("outbound", "quote", [row("name", "{name")], out)[0].message).toContain("not closed");
    expect(validateRows("outbound", "quote", [row("na me", "{name}")], out)[0].part).toBe("field");
    expect(validateRows("outbound", "quote", [row("name", "{name} · {ref}")], out)).toEqual([]);
  });
  it("accepts a lookup bind as a field name and refuses a unit of measure on a write-in line", () => {
    expect(validateRows("outbound", "quote", [row("customerid_account@odata.bind", "/accounts({account_external_id})")], [...out, "account_external_id"])).toEqual([]);
    expect(validateRows("outbound", "quote_line", [row("uomid", "{qty}")], out)[0].message).toContain("unit of measure");
  });
  it("names an empty half and a duplicate field", () => {
    const issues = validateRows("outbound", "quote", [row("name", ""), row("", "{name}"), row("a", "{name}"), row("A", "{ref}")], out);
    expect(issues.map((i) => i.part)).toEqual(["value", "field", "field"]);
    expect(issues[2].message).toContain("already used");
  });
  it("checks an inbound map against the BPMSquare fields it may fill and a plain column name", () => {
    const allowed = ["name", "city"];
    expect(validateRows("inbound", "inbound", [row("name", "OrganizationName")], allowed)).toEqual([]);
    expect(validateRows("inbound", "inbound", [row("secret", "x")], allowed)[0].part).toBe("field");
    expect(validateRows("inbound", "inbound", [row("name", "bad column!")], allowed)[0].part).toBe("value");
  });
  it("flags required, creatable ERP fields nothing fills, except what the engine sets itself", () => {
    const erp: ErpField[] = [
      { name: "name", label: "Name", type: "String", required: true, creatable: true },
      { name: "customerid", label: "Customer", type: "Lookup", required: true, creatable: true },
      { name: "statecode", label: "Status", type: "State", required: true, creatable: false },
      { name: "revisionnumber", label: "Revision", type: "Integer", required: true, creatable: true },
      { name: "description", label: "Description", type: "Memo", required: false, creatable: true },
    ];
    expect(missingRequired(erp, [row("description", "{description}")], "quote").map((f) => f.name)).toEqual(["revisionnumber"]);
    expect(missingRequired(erp, [row("revisionnumber@odata.bind", "1")], "quote")).toEqual([]);
    expect(missingRequired(erp, [], "project").map((f) => f.name)).toEqual(["name", "customerid", "revisionnumber"]);
  });
  it("adds suggestions as new rows and never overwrites a field already mapped", () => {
    const rows = [row("name", "{ref}")];
    const r = applySuggestions(rows, [{ bpm: "name", erp: "name", score: 1, reason: "same name" }, { bpm: "description", erp: "description", score: 1, reason: "same name" }], "outbound");
    expect(r.added).toBe(1);
    expect(rowsToMap(r.rows)).toEqual({ name: "{ref}", description: "{description}" });
    const inb = applySuggestions([], [{ bpm: "city", erp: "address1_city", score: 0.9, reason: "known pair" }], "inbound");
    expect(rowsToMap(inb.rows)).toEqual({ city: "address1_city" });
  });
  it("inserts a placeholder after existing text", () => {
    expect(appendPlaceholder("", "ref")).toBe("{ref}");
    expect(appendPlaceholder("{ref} ·", "name")).toBe("{ref} · {name}");
  });
});

describe("the explanations behind the i", () => {
  it("every fixed one fits the InfoTip limit", () => {
    for (const [key, text] of Object.entries(MIDDLEWARE_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
  });
  it("so do the ones built from the product and the secret's expiry", () => {
    for (const p of ["dataverse", "fo", "bc"]) for (const a of ["client_secret", "basic"]) expect(tipTextProblems(environmentTip(p, a)), `${p} ${a}`).toEqual([]);
    for (const d of [null, -3, 0, 1, 30]) expect(tipTextProblems(secretExpiryTip(d)), String(d)).toEqual([]);
  });
});

describe("the connector list and the flag", () => {
  it("lists the connectors that sync, from the registry, with a short name", () => {
    const list = middlewareConnectors();
    expect(list.map((c) => c.id)).toEqual(CONNECTOR_CATALOG.filter((d) => d.middleware).map((d) => d.id));
    expect(list.length).toBeGreaterThan(0);
    expect(shortName("Microsoft Dynamics 365")).toBe("Dynamics 365");
  });
  it("a connector added to the registry shows up without touching the page", () => {
    const extra: ConnectorDef = { id: "sap", name: "SAP", description: "", icon: "", authType: "api_key", fields: [], testable: false, middleware: true };
    expect(middlewareConnectors([...CONNECTOR_CATALOG, extra]).map((c) => c.id)).toContain("sap");
  });
  it("sends a syncing connector's tile to the middleware page only when the flag is on", () => {
    const d = CONNECTOR_CATALOG.find((x) => x.middleware)!;
    expect(connectorTileHref(d, false)).toBe(d.configureHref);
    expect(connectorTileHref(d, true)).toBe(`/settings/middleware?connector=${d.id}`);
    const slack = CONNECTOR_CATALOG.find((x) => x.id === "slack")!;
    expect(connectorTileHref(slack, true)).toBe(slack.configureHref);
  });
  it("shows the Settings entry first in Integrations only with the flag on, to admins", () => {
    const entry = SETTINGS_MENU.find((m) => m.id === "middleware")!;
    expect(entry.adminOnly).toBe(true);
    expect(entry.featureKey).toBe("integration_middleware");
    const ctx = (features: Record<string, boolean>, isAdmin = true) => visibleSettingsMenu({ isAdmin, canEdit: () => false, features: features as never });
    const ids = (g: ReturnType<typeof visibleSettingsMenu>) => g.find((x) => x.id === "integrations")?.items.map((i) => i.id) ?? [];
    expect(ids(ctx({}))).not.toContain("middleware");
    expect(ids(ctx({ integration_middleware: false }))).not.toContain("middleware");
    expect(ids(ctx({ integration_middleware: true }, false))).not.toContain("middleware");
    expect(ids(ctx({ integration_middleware: true }))[0]).toBe("middleware");
    expect(ids(ctx({}))).toEqual(["connectors", "developer", "push", "email-output"]);
  });
  it("knows which products need a price list and currency", () => {
    expect(needsPickLists("dataverse")).toBe(true);
    expect(needsPickLists("fo")).toBe(false);
    expect(needsPickLists(null)).toBe(false);
  });
});

describe("the Standard Quote picker", () => {
  it("lists only awarded and rejected quotes, awarded first, with the customer and total", () => {
    const o = quoteOptions(
      [
        { id: "1", ref: "SQ-0001", status: "draft", total: 5, account_id: "a" },
        { id: "2", ref: "SQ-0002", status: "rejected", total: 10, account_id: "a" },
        { id: "3", ref: "SQ-0003", status: "accepted", total: 1234.5, account_id: "a" },
      ],
      [{ id: "a", name: "Acme" }],
    );
    expect(o.map((x) => x.id)).toEqual(["3", "2"]);
    expect(o[0].group).toBe("Awarded");
    expect(o[0].label).toContain("Acme");
    expect(o[0].label).toContain("SQ-0003");
  });
});

describe("the client layer stays in step with the server's vocabulary", () => {
  it("shares the same parts, channels, statuses and labels", () => {
    expect([...client.FENCE_PARTS]).toEqual([...server.FENCE_PARTS]);
    expect([...client.ESTIMATE_PARTS]).toEqual([...server.ESTIMATE_PARTS]);
    expect(client.FENCE_PART_LABEL).toEqual(server.FENCE_PART_LABEL);
    expect(client.ESTIMATE_PART_LABEL).toEqual(server.ESTIMATE_PART_LABEL);
    expect([...client.MESSAGE_CHANNELS]).toEqual([...server.MESSAGE_CHANNELS]);
    expect([...client.MESSAGE_DIRECTIONS]).toEqual([...server.MESSAGE_DIRECTIONS]);
    expect([...client.MONITOR_STATUSES].filter((x) => x !== "dry_run")).toEqual([...server.STORED_STATUSES]);
  });
});
