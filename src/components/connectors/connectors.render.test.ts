import { describe, expect, it } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import ExternalRecordLine from "@/components/ExternalRecordLine";
import D365Preview from "./D365Preview";
import D365Runs from "./D365Runs";
import SyncRow from "./SyncRow";
import type { ExternalRef } from "@/lib/connectors/externalRef";
import type { D365Run } from "@/lib/connectors/d365/runSummary";

// First-render markup only (toggles and polling need a browser).
const createElement = create as unknown as (c: unknown, p: object | null, ...kids: unknown[]) => ReactElement;
const html = (c: unknown, p: object) => renderToString(createElement(c, p));

const GUID = "6c1f0a52-3b7e-4c1a-9d3e-0a1b2c3d4e5f";
const ref = (over: Partial<ExternalRef> = {}): ExternalRef => ({
  connectorId: "dynamics365", system: "Dynamics 365", objectLabel: "Quote", readable: "QUO-01002", deepLink: `https://o.crm.dynamics.com/main.aspx?etn=quote&id=${GUID}&pagetype=entityrecord`,
  direction: "push", title: GUID, ...over,
});

describe("ExternalRecordLine", () => {
  it("renders nothing without a link", () => {
    expect(html(ExternalRecordLine, { refs: [] })).toBe("");
  });

  it("is one quiet line: system, readable number, an Open link that leaves safely, the id only as a tooltip", () => {
    const out = html(ExternalRecordLine, { refs: [ref()] });
    expect(out).toContain("Dynamics 365");
    expect(out).toContain("QUO-01002");
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain("Open in Dynamics");
    expect(out).toContain(`title="${GUID}"`);
    expect(out).toContain('aria-label="About Dynamics 365 quote"');
    // read-only: nothing to press
    expect(out).not.toMatch(/Send|Push|Retry|Sync|Settings/);
    expect(out.replace(/title="[^"]*"/g, "").replace(/href="[^"]*"/g, "")).not.toContain(GUID);
  });

  it("shows several connectors as several lines, and no link text when there is no address", () => {
    const out = html(ExternalRecordLine, { refs: [ref(), ref({ connectorId: "sap", system: "SAP", readable: "4500012345", deepLink: null, title: "4500012345" })] });
    expect(out).toContain("SAP");
    expect(out).toContain("4500012345");
    expect(out.match(/Open in/g)).toHaveLength(1);
  });
});

const rows = [{ accountid: GUID, name: "Fabrikam", address1_city: "Seattle", telephone1: null, versionnumber: 9, description: "" }];

describe("D365Preview", () => {
  it("opens on the mapped fields, titled with BPMSquare field names, and keeps raw columns closed", () => {
    const out = html(D365Preview, { title: "Customers", rows, fieldMap: { name: "name", city: "address1_city" } });
    expect(out).toContain(">name<");
    expect(out).toContain(">city<");
    expect(out).toContain("Fabrikam");
    expect(out).toContain("Show all fields");
    expect(out).not.toContain("accountid");
    expect(out).not.toContain("versionnumber");
  });

  it("says what to do when nothing came back", () => {
    expect(html(D365Preview, { title: "Customers", rows: [], fieldMap: {} })).toContain("No rows came back");
  });
});

const run = (over: Partial<D365Run> = {}): D365Run => ({
  id: "r1", entity: "fence_projects", direction: "push", trigger: "manual", status: "succeeded", started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
  counts: { read: 1, created: 1, updated: 0, unchanged: 0, skipped: 0, failed: 0 }, error: null, issues: [], ...over,
});

describe("D365Runs", () => {
  it("lists a push run and shows a spinner row for an action still running", () => {
    const out = html(D365Runs, { runs: [run()], pending: [{ entity: "customers", label: "Syncing Customers → Accounts…" }] });
    expect(out).toContain("Fence projects");
    expect(out).toContain("Syncing Customers");
    expect(out).toContain("bpm-spin");
  });

  it("does not add a second spinner when the entity's own run is already live", () => {
    const out = html(D365Runs, { runs: [run({ entity: "customers", status: "running", finished_at: null })], pending: [{ entity: "customers", label: "Syncing Customers → Accounts…" }] });
    expect(out).not.toContain("Syncing Customers");
    expect(out).toContain("Running");
  });

  it("has an empty state that names the next step", () => {
    expect(html(D365Runs, { runs: [] })).toContain("Run a sync");
  });
});

describe("SyncRow", () => {
  const base = { entityKey: "customers", label: "Customers", direction: "pull", enabled: true, connected: true, busy: null, onSync: () => {}, onPreview: () => {} };

  it("keeps its result line while another row is busy", () => {
    const out = html(SyncRow, { ...base, busy: "sync-contacts", result: { ok: true, text: "6 read · 6 created", at: "2026-10-21T10:00:00Z" } });
    expect(out).toContain("6 read · 6 created");
    expect(out).toContain("disabled");
  });

  it("shows a failed result as an alert", () => {
    const out = html(SyncRow, { ...base, result: { ok: false, text: "Forbidden", at: "2026-10-21T10:00:00Z" } });
    expect(out).toContain('role="alert"');
  });
});
