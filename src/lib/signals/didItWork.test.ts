import { describe, expect, it } from "vitest";
import { computeDidItWork, type HistoryDay } from "./didItWork";

const SENT = "2026-10-01T09:00:00Z";
const NOW = new Date("2026-10-20T12:00:00Z");
const d = (day: string, score: number, stage: HistoryDay["stage"]): HistoryDay => ({ day, score, stage });

describe("computeDidItWork", () => {
  const history = new Map<string, HistoryDay[]>([
    ["a", [d("2026-09-25", 12, "looking"), d("2026-10-10", 45, "comparing")]],
    ["b", [d("2026-09-25", 30, "comparing"), d("2026-10-10", 25, "looking")]],
    ["c", [d("2026-10-12", 70, "deciding")]],
    ["x", [d("2026-09-25", 10, "looking"), d("2026-10-12", 20, "looking")]],
  ]);
  const input = {
    sentAt: SENT, now: NOW, history, clicked: new Set(["a", "c"]),
    recipients: [{ account_id: "a", name: "Alpha" }, { account_id: "b", name: "Beta" }, { account_id: "c", name: "Gamma" }],
  };

  it("counts who moved up, who clicked and who is now Deciding, by name", () => {
    const r = computeDidItWork(input);
    expect(r).toMatchObject({ recipients: 3, movedUp: 2, clicked: 2, nowDeciding: 1, partial: false, small: true });
    expect(r.rows.map((x) => [x.name, x.before, x.after])).toEqual([["Gamma", "quiet", "deciding"], ["Alpha", "looking", "comparing"]]);
    expect(r.rows[1].what).toContain("Clicked a link in the send");
  });

  it("compares the recipients' average before and after with everyone else's", () => {
    const r = computeDidItWork(input);
    expect(r.avgBefore).toBe(Math.round(((12 + 30 + 0) / 3) * 10) / 10);
    expect(r.avgAfter).toBe(Math.round(((45 + 25 + 70) / 3) * 10) / 10);
    expect(r.others).toEqual({ accounts: 1, before: 10, after: 20 });
  });

  it("says so while the 14 days have not all passed", () => {
    expect(computeDidItWork({ ...input, now: new Date("2026-10-05T00:00:00Z") }).partial).toBe(true);
  });

  it("treats an account with no stored days as Quiet before and after", () => {
    const r = computeDidItWork({ ...input, history: new Map(), clicked: new Set() });
    expect(r).toMatchObject({ movedUp: 0, avgBefore: 0, avgAfter: 0, others: null, rows: [] });
  });
});
