import { describe, expect, it } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import type { ScopeAttribute } from "@/lib/connectors/d365/scope";
import type { SyncEntity } from "./api";
import {
  RESYNC_TABS, addCondition, draftFromScope, draftToSave, lastRunLine, numbersProblem, parseTypedValues, recordIdsProblem, removeCondition, resultLine, sameDraft, scopeCell,
  scopeProblem, setConditionAttribute, toggleConditionValue,
} from "./resyncLogic";
import { EntityRows, runLine } from "./ResyncTab";
import ScopePanel from "./ScopePanel";

const el = create as unknown as (c: unknown, p: object | null, ...kids: unknown[]) => ReactElement;
const html = (e: ReactElement) => renderToString(e);

const ent = (key: string, scope?: SyncEntity["scope"], filters?: SyncEntity["filters"]): SyncEntity => ({
  key: key as never, label: key, direction: "pull", enabled: true, entity_set: "accounts", schedule: "daily", schedule_source: "entity", running: false, linked: 1, last_run: null, filters, scope,
});
const rowsProps = { connected: true, busy: null, lines: {}, onSync: () => undefined, onSchedule: () => undefined };
const attrs: ScopeAttribute[] = [
  { id: "accountclassificationcode", name: "accountclassificationcode", label: "Classification", kind: "option", common: true },
  { id: "territoryid", name: "territoryid", label: "Territory", kind: "lookup", common: true },
  { id: "address1_country", name: "address1_country", label: "Country", kind: "text", common: true },
];

describe("Resync tab: the table", () => {
  it("has two tabs, Full resync first", () => {
    expect([...RESYNC_TABS]).toEqual(["full", "records"]);
  });

  it("marks a run for named records", () => {
    const now = new Date(2026, 9, 21, 18, 0, 0);
    const at = new Date(2026, 9, 21, 17, 29, 0).toISOString();
    const r = { running: false, last_run: { status: "succeeded", trigger: "manual", started_at: at, finished_at: at, counts: { read: 3, filtered: 1 }, error: null } };
    expect(lastRunLine(r, now)).toBe("Today 17:29, 3 records, filtered");
  });

  it("tells a run back with what was not applied and what the scope left alone", () => {
    expect(runLine({ counts: { read: 2, created: 1 }, unsupported: ["Numbers cannot be looked up for this entity."] }))
      .toEqual({ ok: true, text: "2 read, 1 new, 0 updated, 0 unchanged Numbers cannot be looked up for this entity." });
    expect(runLine({ error: "Nothing matches that selection." })).toEqual({ ok: false, text: "Nothing matches that selection." });
    expect(resultLine({ counts: { read: 4, outside_scope: 3 } })).toBe("4 read, 0 new, 0 updated, 0 unchanged, 3 outside scope left unchanged");
  });
});

describe("Resync tab: specific records", () => {
  it("allows up to 100 and refuses anything that is not an id or number", () => {
    expect(recordIdsProblem("C-1, C-2\nC-3")).toBeNull();
    expect(recordIdsProblem(Array.from({ length: 101 }, (_, i) => `C-${i}`).join(" "))).toMatch(/100/);
    expect(recordIdsProblem("C-1 x'or'1")).not.toBeNull();
  });
  it("blocks numbers for an entity that can only be read by id", () => {
    expect(numbersProblem({ numbers: false }, ["C-0001"])).toMatch(/record id/);
    expect(numbersProblem({ numbers: false }, ["11111111-2222-3333-4444-555555555555"])).toBeNull();
    expect(numbersProblem({ numbers: true }, ["C-0001"])).toBeNull();
  });
});

describe("Resync tab: the scope being edited", () => {
  it("says what an entity reads in one short cell", () => {
    expect(scopeCell(ent("customers", { summary: "Class A, B, C · Territory North", narrowed: true, needs_full: false }))).toBe("Class A, B, C · Territory North");
    expect(scopeCell(ent("customers", { summary: "All customers", narrowed: false, needs_full: false }))).toBe("All customers");
    expect(scopeCell(ent("vendors"))).toBe("All vendors");
  });

  it("starts a row on the next attribute not used yet, at most five rows", () => {
    let d = addCondition([], attrs);
    expect(d).toEqual([{ id: "accountclassificationcode", values: [], labels: [] }]);
    d = addCondition(d, attrs);
    d = addCondition(d, attrs);
    expect(d.map((c) => c.id)).toEqual(["accountclassificationcode", "territoryid", "address1_country"]);
    expect(addCondition(d, attrs)).toHaveLength(3);
    const six = attrs.concat(Array.from({ length: 5 }, (_, i) => ({ ...attrs[0], id: `x${i}`, name: `x${i}` })));
    let many = [] as ReturnType<typeof addCondition>;
    for (let i = 0; i < 8; i++) many = addCondition(many, six);
    expect(many).toHaveLength(5);
  });

  it("picking another attribute starts its values again; ticking a value twice removes it", () => {
    let d = addCondition([], attrs);
    d = toggleConditionValue(d, 0, "1", "Class A");
    d = toggleConditionValue(d, 0, "2", "Class B");
    expect(d[0]).toEqual({ id: "accountclassificationcode", values: ["1", "2"], labels: ["Class A", "Class B"] });
    expect(toggleConditionValue(d, 0, "1", "Class A")[0].values).toEqual(["2"]);
    expect(setConditionAttribute(d, 0, "territoryid")[0]).toEqual({ id: "territoryid", values: [], labels: [] });
    expect(removeCondition(d, 0)).toEqual([]);
  });

  it("a row takes at most 50 values", () => {
    let d = addCondition([], attrs);
    for (let i = 0; i < 60; i++) d = toggleConditionValue(d, 0, String(i), `L${i}`);
    expect(d[0].values).toHaveLength(50);
  });

  it("blocks a save that has an empty row, a repeated attribute or an attribute the system no longer has", () => {
    expect(scopeProblem([], attrs)).toBeNull();
    expect(scopeProblem([{ id: "territoryid", values: [], labels: [] }], attrs)).toMatch(/at least one value for Territory/);
    expect(scopeProblem([{ id: "territoryid", values: ["a"], labels: ["a"] }, { id: "territoryid", values: ["b"], labels: ["b"] }], attrs)).toMatch(/used twice/);
    expect(scopeProblem([{ id: "gone", values: ["a"], labels: ["a"] }], attrs)).toMatch(/no longer in the system/);
    expect(scopeProblem([{ id: "address1_country", values: ["Qatar"], labels: ["Qatar"] }], attrs)).toBeNull();
  });

  it("round-trips through the saved shape, a customer attribute included", () => {
    const stored = [{ attribute: "territoryid", kind: "lookup" as const, values: ["g"], labels: ["North"], via: "customer" as const }, { attribute: "address1_country", kind: "text" as const, values: ["Qatar"] }];
    const d = draftFromScope(stored);
    expect(d).toEqual([{ id: "customer:territoryid", values: ["g"], labels: ["North"] }, { id: "address1_country", values: ["Qatar"], labels: ["Qatar"] }]);
    expect(draftToSave(d)).toEqual([
      { attribute: "territoryid", values: ["g"], labels: ["North"], via: "customer" },
      { attribute: "address1_country", values: ["Qatar"], labels: ["Qatar"] },
    ]);
    expect(sameDraft(d, draftFromScope(stored))).toBe(true);
    expect(sameDraft(d, [])).toBe(false);
  });

  it("typed values: commas and new lines, blanks and duplicates dropped, at most 50", () => {
    expect(parseTypedValues("Qatar, UAE\n Oman ,, Qatar")).toEqual(["Qatar", "UAE", "Oman"]);
    expect(parseTypedValues(Array.from({ length: 80 }, (_, i) => `v${i}`).join(","))).toHaveLength(50);
    expect(parseTypedValues("")).toEqual([]);
  });
});

describe("Resync tab: render", () => {
  it("one table, one row per entity, with a Scope cell and no search or date filters", () => {
    const out = html(el(EntityRows, {
      ...rowsProps,
      rows: [ent("customers", { summary: "Class A, B, C · Territory North", narrowed: true, needs_full: false }), ent("vendors", { summary: "All vendors", narrowed: false, needs_full: false })],
      onScope: () => undefined,
    }));
    expect(out).toContain("<th>Scope</th>");
    expect(out).toContain("Class A, B, C · Territory North");
    expect(out).toContain("All vendors");
    expect(out).toContain("Edit the scope of Customers");
    expect(out.match(/Sync now/g)).toHaveLength(2);
    expect(out.match(/Full resync/g)).toHaveLength(2);
    for (const gone of ["Contains", "Changed since", "Active only", "Filters", 'type="date"']) expect(out).not.toContain(gone);
  });

  it("says in one line that a changed scope needs a full resync, only where it applies", () => {
    const changed = html(el(EntityRows, { ...rowsProps, rows: [ent("customers", { summary: "Country Qatar", narrowed: true, needs_full: true })] }));
    expect(changed).toContain("Scope changed: run Full resync to bring in the rest.");
    const fine = html(el(EntityRows, { ...rowsProps, rows: [ent("customers", { summary: "Country Qatar", narrowed: true, needs_full: false }), ent("vendors")] }));
    expect(fine).not.toContain("Scope changed");
  });

  it("the Scope button is off while there is no connection", () => {
    const out = html(el(EntityRows, { ...rowsProps, connected: false, rows: [ent("customers")], onScope: () => undefined }));
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Edit the scope of Customers"/);
  });

  it("the panel opens on its title and the rule, with the explanation behind an i", () => {
    const out = html(el(ScopePanel, { entity: "customers", entityName: "Customers", onClose: () => undefined, onSaved: () => undefined }));
    expect(out).toContain("Scope: Customers");
    expect(out).toContain("Read only records where");
    expect(out).toContain("About Scope");
    expect(out).not.toContain("nothing is deleted");
  });
});
