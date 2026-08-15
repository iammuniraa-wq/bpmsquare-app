import { describe, it, expect } from "vitest";
import { parseListQuery, applyListQuery, type QueryableField } from "./query";

const FIELDS: QueryableField[] = [
  { path: "ref", type: "string", searchable: true },
  { path: "status", type: "string" },
  { path: "total", type: "number" },
  { path: "created_at", type: "date" },
  { path: "account.name", type: "string", searchable: true },
];

const ROWS = [
  { ref: "Q-1", status: "draft", total: 100, created_at: "2026-01-01", account: { name: "Alpha" } },
  { ref: "Q-2", status: "won", total: 5000, created_at: "2026-02-01", account: { name: "Beta" } },
  { ref: "Q-3", status: "draft", total: 250, created_at: "2026-03-01", account: { name: "Alpha Corp" } },
  { ref: "Q-4", status: "lost", total: 900, created_at: "2026-04-01", account: { name: "Gamma" } },
];

const parse = (qs: string) => {
  const r = parseListQuery(new URLSearchParams(qs), FIELDS);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.query;
};

describe("enriched query engine", () => {
  it("filters with operators (AND)", () => {
    const out = applyListQuery(ROWS, parse("filter=status:eq:draft;total:gte:200"));
    expect(out.data.map((r) => r.ref)).toEqual(["Q-3"]);
    expect(out.meta.total).toBe(1);
  });

  it("supports like, in, ne, isnull", () => {
    expect(applyListQuery(ROWS, parse("filter=account.name:like:alpha")).data.map((r) => r.ref)).toEqual(["Q-1", "Q-3"]);
    expect(applyListQuery(ROWS, parse("filter=status:in:won,lost")).data.map((r) => r.ref)).toEqual(["Q-2", "Q-4"]);
    expect(applyListQuery(ROWS, parse("filter=status:ne:draft")).data.map((r) => r.ref)).toEqual(["Q-2", "Q-4"]);
  });

  it("sorts multi-key with direction", () => {
    const out = applyListQuery(ROWS, parse("sort=-total"));
    expect(out.data.map((r) => r.total)).toEqual([5000, 900, 250, 100]);
  });

  it("projects with select (nested)", () => {
    const out = applyListQuery(ROWS, parse("select=ref,account.name&filter=ref:eq:Q-1"));
    expect(out.data[0]).toEqual({ ref: "Q-1", account: { name: "Alpha" } });
  });

  it("paginates with meta + links", () => {
    const out = applyListQuery(ROWS, parse("limit=2&page=1&sort=ref"));
    expect(out.data.map((r) => r.ref)).toEqual(["Q-1", "Q-2"]);
    expect(out.meta).toMatchObject({ count: 2, total: 4, page: 1, limit: 2, has_more: true });
    expect(out.links.next).toEqual({ page: "2", limit: "2" });
    expect(out.links.prev).toBeNull();
  });

  it("computes aggregates over the filtered set", () => {
    const out = applyListQuery(ROWS, parse("filter=status:eq:draft&aggregate=count,sum:total,avg:total"));
    expect(out.meta.aggregates).toEqual({ count: 2, sum_total: 350, avg_total: 175 });
  });

  it("rejects unknown fields and bad operators with 422-style errors", () => {
    const bad = parseListQuery(new URLSearchParams("filter=nope:eq:x"), FIELDS);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0].message).toContain("Queryable fields");

    const badOp = parseListQuery(new URLSearchParams("filter=total:bogus:1"), FIELDS);
    expect(badOp.ok).toBe(false);

    const badNum = parseListQuery(new URLSearchParams("filter=total:gt:abc"), FIELDS);
    expect(badNum.ok).toBe(false);
  });

  it("clamps limit to the max", () => {
    expect(parse("limit=99999").limit).toBe(200);
  });

  it("search does OR-contains across searchable fields", () => {
    // 'alpha' matches account.name on Q-1/Q-3; 'gamma' matches Q-4
    expect(applyListQuery(ROWS, parse("search=alpha")).data.map((r) => r.ref)).toEqual(["Q-1", "Q-3"]);
    expect(applyListQuery(ROWS, parse("search=q-2")).data.map((r) => r.ref)).toEqual(["Q-2"]);
  });

  it("group_by returns per-group aggregates, busiest first", () => {
    const out = applyListQuery(ROWS, parse("group_by=status&aggregate=sum:total"));
    expect(out.meta.groups).toEqual([
      { key: "draft", count: 2, sum_total: 350 },
      { key: "won", count: 1, sum_total: 5000 },
      { key: "lost", count: 1, sum_total: 900 },
    ]);
  });

  it("count=only returns meta without data rows", () => {
    const out = applyListQuery(ROWS, parse("count=only&filter=status:eq:draft"));
    expect(out.data).toEqual([]);
    expect(out.meta.total).toBe(2);
  });
});
