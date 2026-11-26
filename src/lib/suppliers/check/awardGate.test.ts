import { describe, expect, it } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";
import { cleanGateReason, evaluateGate, flaggedOf, gateBody, gateNote, gateReady, topFindings, type AwardCheck } from "./awardGate";
import { enforceAwardGate, loadAwardChecks } from "./awardGateServer";
import { VERDICTS, type Verdict } from "./types";

const T1 = "t1";
const T2 = "t2";
const id = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const S1 = id(1), S2 = id(2), S3 = id(3);

const check = (verdict: Verdict, name = "Gulf Skirting"): AwardCheck => ({ supplierId: S1, name, verdict, findings: ["Two suppliers share a bank account"], checkedAt: "2026-11-20T00:00:00Z" });

describe("the award gate rules (verdict x reason x tick)", () => {
  it("looks genuine and unverified never ask for anything", () => {
    for (const v of ["looks_genuine", "unverified"] as const) {
      expect(evaluateGate([check(v)], {})).toEqual({ ok: true, reason: null });
      expect(gateReady([check(v)], "", false)).toBe(true);
    }
    expect(evaluateGate([], {})).toEqual({ ok: true, reason: null });
  });

  it("check first needs a reason of at least 5 characters and no tick", () => {
    const c = check("check_first");
    expect(evaluateGate([c], {})).toMatchObject({ ok: false, code: "supplier_check_reason" });
    expect(evaluateGate([c], { reason: "    " })).toMatchObject({ ok: false, code: "supplier_check_reason" });
    expect(evaluateGate([c], { reason: "abcd" })).toMatchObject({ ok: false, code: "supplier_check_reason" });
    expect(evaluateGate([c], { reason: "Only one in stock" })).toEqual({ ok: true, reason: "Only one in stock" });
    expect(gateReady([c], "Five!", false)).toBe(true);
  });

  it("concerning also needs the tick, and the tick alone is not enough", () => {
    const c = check("concerning");
    expect(evaluateGate([c], { reason: "Only one in stock" })).toMatchObject({ ok: false, code: "supplier_check_ack" });
    expect(evaluateGate([c], { reason: "Only one in stock", ack: "yes" })).toMatchObject({ ok: false, code: "supplier_check_ack" });
    expect(evaluateGate([c], { ack: true })).toMatchObject({ ok: false, code: "supplier_check_reason" });
    expect(evaluateGate([c], { reason: "Only one in stock", ack: true })).toMatchObject({ ok: true });
  });

  it("a split award is held to the strictest verdict among its suppliers", () => {
    const a = check("check_first", "A");
    const b = { ...check("concerning", "B"), supplierId: S2 };
    expect(evaluateGate([a, b], { reason: "Delivery terms" })).toMatchObject({ ok: false, code: "supplier_check_ack", suppliers: [S2] });
    expect(evaluateGate([a, b], { reason: "Delivery terms", ack: true }).ok).toBe(true);
    expect(flaggedOf([a, b, check("looks_genuine")])).toHaveLength(2);
  });

  it("every verdict is accounted for", () => {
    for (const v of VERDICTS) expect(typeof evaluateGate([check(v)], { reason: "A good reason", ack: true }).ok).toBe("boolean");
  });

  it("the findings are the two strongest sentences; informational lines are not warnings", () => {
    const f = { signals: [
      { id: "a", severity: "info", text: "Has a website." },
      { id: "b", severity: "low", text: "No tax number on file." },
      { id: "c", severity: "high", text: "Shares a bank account with Other Co." },
      { id: "d", severity: "medium", text: "Address looks like a residence." },
    ] } as never;
    expect(topFindings(f)).toEqual(["Shares a bank account with Other Co", "Address looks like a residence"]);
    expect(topFindings(null)).toEqual([]);
  });

  it("the history note and the request fields read as the brief says", () => {
    expect(gateNote(check("check_first"), "Only one in stock")).toBe("Awarded despite Supplier check: check first. Reason: Only one in stock");
    expect(gateBody(" Only one ", true, true)).toEqual({ supplier_check_reason: "Only one", supplier_check_ack: true });
    expect(gateBody("x", true, false)).toEqual({});
    expect(cleanGateReason("  a   b  c d ")).toBe("a b c d");
    expect(cleanGateReason(42)).toBeNull();
  });
});

const seed = (extra: Record<string, unknown>[] = []) => new MemoryDb({
  suppliers: [
    { id: S1, tenant_id: T1, name: "Gulf Skirting" }, { id: S2, tenant_id: T1, name: "Desert Supply" }, { id: S3, tenant_id: T2, name: "Theirs" },
  ],
  supplier_checks: [
    { id: id(11), tenant_id: T1, supplier_id: S1, checked_at: "2026-10-01T00:00:00Z", verdict: "looks_genuine", genuine_findings: { signals: [] } },
    { id: id(12), tenant_id: T1, supplier_id: S1, checked_at: "2026-11-01T00:00:00Z", verdict: "check_first", genuine_findings: { signals: [{ id: "x", severity: "high", text: "Shares a bank account with Other Co." }] } },
    { id: id(13), tenant_id: T2, supplier_id: S3, checked_at: "2026-11-01T00:00:00Z", verdict: "concerning", genuine_findings: { signals: [] } },
    ...extra,
  ],
});

describe("reading the newest verdict, tenant-scoped", () => {
  it("the newest check of a supplier wins over an older one", async () => {
    const r = await loadAwardChecks(seed() as never, T1, [S1]);
    expect(r.failed).toBe(false);
    expect(r.checks).toEqual([{ supplierId: S1, name: "Gulf Skirting", verdict: "check_first", findings: ["Shares a bank account with Other Co"], checkedAt: "2026-11-01T00:00:00Z" }]);
  });

  it("another workspace's check never applies, even for a supplier id that is asked about", async () => {
    const r = await loadAwardChecks(seed() as never, T1, [S3]);
    expect(r.checks).toEqual([]);
    const gate = await enforceAwardGate(seed() as never, T1, [S3], {});
    expect(gate).toMatchObject({ ok: true, flagged: [] });
  });

  it("a supplier never checked, or a missing table, changes nothing", async () => {
    expect(await enforceAwardGate(seed() as never, T1, [S2], {})).toMatchObject({ ok: true, flagged: [] });
    const db = seed();
    db.missing.add("supplier_checks");
    expect(await enforceAwardGate(db as never, T1, [S1], {})).toMatchObject({ ok: true, flagged: [] });
  });

  it("a flagged supplier without a reason answers 422 with the findings; with the reason it passes", async () => {
    const no = await enforceAwardGate(seed() as never, T1, [S1, S2], {});
    expect(no).toMatchObject({ ok: false, status: 422, code: "supplier_check_reason" });
    expect(no.ok ? null : (no.extra.flagged as { name: string }[])[0].name).toBe("Gulf Skirting");
    const yes = await enforceAwardGate(seed() as never, T1, [S1], { reason: "Only one in stock" });
    expect(yes).toMatchObject({ ok: true, reason: "Only one in stock" });
  });
});
