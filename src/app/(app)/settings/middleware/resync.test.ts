import { describe, expect, it } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import type { SyncEntity } from "./api";
import {
  NO_FILTERS, RESYNC_TABS, dayWord, filterLine, filtersToRequest, hasFilters, lastRunLine, numbersProblem, recordIdsProblem, unsupportedFilters,
} from "./resyncLogic";
import { EntityRows, RunFilters, runLine } from "./ResyncTab";

const el = create as unknown as (c: unknown, p: object | null, ...kids: unknown[]) => ReactElement;
const html = (e: ReactElement) => renderToString(e);

const ent = (key: string, filters?: SyncEntity["filters"]): SyncEntity => ({
  key: key as never, label: key, direction: "pull", enabled: true, entity_set: "accounts", schedule: "daily", schedule_source: "entity", running: false, linked: 1, last_run: null, filters,
});
const rowsProps = { connected: true, busy: null, lines: {}, onSync: () => undefined, onSchedule: () => undefined };

describe("Resync tab: filters of a full resync", () => {
  it("has two tabs, Full resync first", () => {
    expect([...RESYNC_TABS]).toEqual(["full", "records"]);
  });

  it("no filters means everything", () => {
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(filterLine("Customers", NO_FILTERS)).toBe("Customers: everything");
    expect(filtersToRequest(NO_FILTERS)).toEqual({ ok: true, filters: {} });
  });

  it("says in plain words what will run", () => {
    const d = { since: "2026-10-01", text: " AG ", activeOnly: true };
    expect(filterLine("Customers", d, new Date(2026, 9, 22))).toBe('Customers changed since 1 Oct, name or number contains "AG", active only');
    expect(dayWord("2025-03-04", new Date(2026, 0, 1))).toBe("4 Mar 2025");
  });

  it("builds the request and refuses what the server would refuse", () => {
    expect(filtersToRequest({ since: "2026-10-01", text: " AG ", activeOnly: true })).toEqual({ ok: true, filters: { since: "2026-10-01", text: "AG", active_only: true } });
    expect(filtersToRequest({ ...NO_FILTERS, since: "01/10/2026" }).ok).toBe(false);
    expect(filtersToRequest({ ...NO_FILTERS, text: "x".repeat(81) }).ok).toBe(false);
  });

  it("names the filters an entity cannot express", () => {
    const fo = { since: false, text: true, active: false, numbers: true };
    expect(unsupportedFilters(fo, { since: "2026-10-01", text: "a", activeOnly: true })).toEqual(["Changed since", "Active only"]);
    expect(unsupportedFilters(undefined, { since: "2026-10-01", text: "", activeOnly: true })).toEqual([]);
  });

  it("marks a filtered last run", () => {
    const now = new Date(2026, 9, 21, 18, 0, 0);
    const at = new Date(2026, 9, 21, 17, 29, 0).toISOString();
    const r = { running: false, last_run: { status: "succeeded", trigger: "manual", started_at: at, finished_at: at, counts: { read: 3, filtered: 1 }, error: null } };
    expect(lastRunLine(r, now)).toBe("Today 17:29, 3 records, filtered");
  });

  it("tells a run back with the filters that were not applied", () => {
    expect(runLine({ counts: { read: 2, created: 1 }, unsupported: ["Active only is not available in Business Central."] }))
      .toEqual({ ok: true, text: "2 read, 1 new, 0 updated, 0 unchanged Active only is not available in Business Central." });
    expect(runLine({ error: "Nothing matches that selection." })).toEqual({ ok: false, text: "Nothing matches that selection." });
  });
});

describe("Resync tab: specific records", () => {
  it("allows up to 100 and refuses anything that is not an id or number", () => {
    expect(recordIdsProblem("C-1, C-2\nC-3")).toBeNull();
    expect(recordIdsProblem(Array.from({ length: 101 }, (_, i) => `C-${i}`).join(" "))).toMatch(/100/);
    expect(recordIdsProblem("C-1 x'or'1")).not.toBeNull();
  });
  it("blocks numbers for an entity that can only be read by id", () => {
    const noNum = { since: true, text: true, active: true, numbers: false };
    expect(numbersProblem(noNum, ["C-0001"])).toMatch(/record id/);
    expect(numbersProblem(noNum, ["11111111-2222-3333-4444-555555555555"])).toBeNull();
    expect(numbersProblem({ ...noNum, numbers: true }, ["C-0001"])).toBeNull();
  });
});

describe("Resync tab: render", () => {
  it("shows the filters with their explanations behind an i, not as text lines", () => {
    const out = html(el(RunFilters, { value: NO_FILTERS, onChange: () => undefined, error: null }));
    for (const w of ["Changed since", "Contains", "Active only", 'type="date"']) expect(out).toContain(w);
    expect(out).not.toContain("Clear");
  });
  it("offers Clear and the plain line once a filter is set", () => {
    const out = html(el(RunFilters, { value: { ...NO_FILTERS, text: "AG" }, onChange: () => undefined, error: null }));
    expect(out).toContain("Clear");
    expect(out).toContain("name or number contains");
  });
  it("keeps Sync now and Full resync for every entity, and says what an entity cannot filter by", () => {
    const fo = { since: false, text: true, active: false, numbers: true };
    const out = html(el(EntityRows, { ...rowsProps, rows: [ent("customers", fo), ent("vendors", fo)], filters: { ...NO_FILTERS, activeOnly: true } }));
    expect(out.match(/Sync now/g)).toHaveLength(2);
    expect(out.match(/Full resync/g)).toHaveLength(2);
    expect(out).toContain("Not available here: Active only.");
  });
  it("does not offer the filter note when nothing is set", () => {
    const out = html(el(EntityRows, { ...rowsProps, rows: [ent("customers", { since: false, text: false, active: false, numbers: false })] }));
    expect(out).not.toContain("Not available here");
  });
});
