import { describe, it, expect } from "vitest";
import { previewColumns, isInternalColumn, isEmptyValue, cellText } from "./preview";
import { countsLine, isLiveRun, latestRunByEntity, pickResult, resultFromRun, LIVE_RUN_MS, type D365Run, type SyncResult } from "./runSummary";
import { D365_TIPS } from "./tips";
import { tipTextProblems } from "@/lib/infoTip";

const row = (over: Record<string, unknown> = {}) => ({
  accountid: "6c1f0a52-3b7e-4c1a-9d3e-0a1b2c3d4e5f", name: "Fabrikam", address1_city: "Seattle", telephone1: null, emailaddress1: "",
  versionnumber: 123456, _ownerid_value: "x", "creditonhold": false, exchangerate: 1, creditlimit_base: 5, timezoneruleversionnumber: 0,
  utcconversiontimezonecode: 1, importsequencenumber: null, description: null, ...over,
});

describe("preview columns", () => {
  it("lists the mapped fields first, titled with the BPMSquare field", () => {
    const c = previewColumns([row(), row({ name: "Contoso" })], { name: "name", city: "address1_city", phone: "telephone1" });
    expect(c.mapped.map((m) => m.target)).toEqual(["name", "city", "phone"]);
    expect(c.mapped.map((m) => m.source)).toEqual(["name", "address1_city", "telephone1"]);
    expect(c.mapped.every((m) => m.found)).toBe(true);
  });

  it("flags a mapped column that is not in the rows, and keeps a mapped internal column (a lookup id) in the mapped list", () => {
    const c = previewColumns([row()], { name: "nme", account_external_id: "_ownerid_value" });
    expect(c.mapped).toEqual([
      { target: "name", source: "nme", found: false },
      { target: "account_external_id", source: "_ownerid_value", found: true },
    ]);
    expect(c.raw).not.toContain("_ownerid_value");
  });

  it("leaves out columns that are empty in every row and internal ones from the raw list", () => {
    const c = previewColumns([row(), row({ telephone1: "555-1" })], { name: "name" });
    expect(c.raw).toEqual(["accountid", "address1_city", "telephone1", "creditonhold"]);
    expect(c.hidden).toBeGreaterThan(5);
    expect(c.raw).not.toContain("emailaddress1");
    expect(c.raw).not.toContain("versionnumber");
  });

  it("does not repeat a mapped source column in the raw list, and keeps false and 0 as data", () => {
    const c = previewColumns([row()], { name: "name", city: "address1_city" });
    expect(c.raw).not.toContain("name");
    expect(c.raw).not.toContain("address1_city");
    expect(c.raw).toContain("creditonhold");
  });

  it("recognises internal column names", () => {
    for (const n of ["_ownerid_value", "@odata.etag", "versionnumber", "creditlimit_base", "timezoneruleversionnumber", "utcconversiontimezonecode", "importsequencenumber", "exchangerate", "entityimage_url"]) {
      expect(isInternalColumn(n), n).toBe(true);
    }
    for (const n of ["name", "accountnumber", "address1_city", "modifiedon", "price"]) expect(isInternalColumn(n), n).toBe(false);
  });

  it("empty means null, blank text, empty list or object; zero and false are values", () => {
    for (const v of [null, undefined, "", "  ", [], {}]) expect(isEmptyValue(v)).toBe(true);
    for (const v of [0, false, "x", [1], { a: 1 }]) expect(isEmptyValue(v)).toBe(false);
    expect(cellText(null)).toBe("");
    expect(cellText(0)).toBe("0");
    expect(cellText({ a: 1 })).toBe('{"a":1}');
  });
});

const run = (over: Partial<D365Run> = {}): D365Run => ({
  id: "r1", entity: "customers", direction: "pull", trigger: "manual", status: "succeeded", started_at: "2026-10-21T10:00:00Z", finished_at: "2026-10-21T10:00:05Z",
  counts: { read: 6, created: 6, updated: 0, unchanged: 0, skipped: 0, failed: 0 }, error: null, issues: [], ...over,
});

describe("run summary", () => {
  it("writes the six counts in a fixed order, zero when missing", () => {
    expect(countsLine({ read: 6, created: 6 })).toBe("6 read · 6 created · 0 updated · 0 unchanged · 0 skipped · 0 failed");
    expect(countsLine(undefined)).toBe("0 read · 0 created · 0 updated · 0 unchanged · 0 skipped · 0 failed");
  });

  it("treats a run as live only while it can still be alive", () => {
    const now = Date.parse("2026-10-21T10:03:00Z");
    expect(isLiveRun({ status: "running", started_at: "2026-10-21T10:00:00Z" }, now)).toBe(true);
    expect(isLiveRun({ status: "running", started_at: "2026-10-21T09:00:00Z" }, now)).toBe(false);
    expect(isLiveRun({ status: "succeeded", started_at: "2026-10-21T10:00:00Z" }, now)).toBe(false);
    expect(LIVE_RUN_MS).toBeGreaterThan(300_000);
  });

  it("picks the newest finished run per entity, push runs included", () => {
    const m = latestRunByEntity([
      run({ id: "a", entity: "fence_projects", direction: "push", started_at: "2026-10-21T12:00:00Z" }),
      run({ id: "b", entity: "customers", status: "running" }),
      run({ id: "c", entity: "customers", started_at: "2026-10-21T09:00:00Z" }),
      run({ id: "d", entity: "customers", started_at: "2026-10-20T09:00:00Z" }),
    ]);
    expect(m.fence_projects.id).toBe("a");
    expect(m.customers.id).toBe("c");
  });

  it("turns a run into a result line, failures into the error", () => {
    expect(resultFromRun(run())).toMatchObject({ ok: true, text: "6 read · 6 created · 0 updated · 0 unchanged · 0 skipped · 0 failed" });
    expect(resultFromRun(run({ status: "failed", error: "Dynamics said no" }))).toMatchObject({ ok: false, text: "Dynamics said no" });
    expect(resultFromRun(run({ status: "partial", issues: ["row 3 skipped"] }))).toMatchObject({ ok: true, issues: ["row 3 skipped"] });
  });

  it("keeps the session's result unless the history is clearly newer", () => {
    const s = (at: string): SyncResult => ({ ok: true, text: "session", at });
    const h = (at: string): SyncResult => ({ ok: true, text: "history", at });
    expect(pickResult(null, null)).toBeNull();
    expect(pickResult(null, h("2026-10-21T10:00:00Z"))?.text).toBe("history");
    expect(pickResult(s("2026-10-21T10:00:00Z"), null)?.text).toBe("session");
    expect(pickResult(s("2026-10-21T10:00:00Z"), h("2026-10-21T10:00:30Z"))?.text).toBe("session");
    expect(pickResult(s("2026-10-21T10:00:00Z"), h("2026-10-21T10:30:00Z"))?.text).toBe("history");
  });
});

describe("explanation texts", () => {
  it("stay within the InfoTip limits", () => {
    for (const [k, t] of Object.entries(D365_TIPS)) expect(tipTextProblems(t), k).toEqual([]);
  });
});
