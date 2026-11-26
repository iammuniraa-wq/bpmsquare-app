import { beforeAll, describe, expect, it } from "vitest";
import { CHECK_CONSENT_PREFIX, consentQueryFor, issueSaveToken, resultHash, supplierIdFromQuery, verifySaveToken } from "./token";
import { issueOnceConsent, verifyConsent } from "@/lib/assistant/consentToken";
import { emptyReputation } from "./reputation";
import { SID } from "./fixtures";
import type { SupplierCheckResult } from "./types";

beforeAll(() => { process.env.ASSISTANT_ACTION_SECRET = "test-secret-for-supplier-check"; });

const result = (over: Partial<SupplierCheckResult> = {}): SupplierCheckResult => ({
  supplierId: SID.wadi, supplierName: "Wadi", checkedAt: "2026-11-26T09:00:00.000Z", verdict: "unverified", verdictSentence: "Could not verify.",
  findings: { signals: [], positives: [] }, rating: { value: null, basis: { months: 24, rfqs: 0, replied: 0, won: 0, enough: false, components: [], formula: "f" } },
  reputation: emptyReputation(), sharpen: [], model: null, ...over,
});
const ME = { tenantId: "t1", userId: "u1" };

describe("the save token", () => {
  it("verifies the exact result it was issued for", () => {
    const r = result();
    expect(verifySaveToken(issueSaveToken({ ...ME, result: r }), { ...ME, result: r })).toEqual({ ok: true });
  });

  it("the hash does not depend on the order of keys", () => {
    const a = result();
    const b = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(a).reverse()))) as SupplierCheckResult;
    expect(resultHash(b)).toBe(resultHash(a));
  });

  it("a result the client changed is refused (a check steers who is awarded)", () => {
    const r = result();
    const token = issueSaveToken({ ...ME, result: r });
    expect(verifySaveToken(token, { ...ME, result: result({ verdict: "looks_genuine" }) })).toEqual({ ok: false, reason: "changed" });
    expect(verifySaveToken(token, { ...ME, result: result({ verdictSentence: "Looks genuine." }) })).toEqual({ ok: false, reason: "changed" });
  });

  it("another person, another workspace, another supplier and an old token are refused", () => {
    const r = result();
    const token = issueSaveToken({ ...ME, result: r }, 1_000);
    expect(verifySaveToken(token, { tenantId: "t2", userId: "u1", result: r }, 2_000)).toEqual({ ok: false, reason: "tenant" });
    expect(verifySaveToken(token, { tenantId: "t1", userId: "u2", result: r }, 2_000)).toEqual({ ok: false, reason: "user" });
    expect(verifySaveToken(token, { ...ME, result: result({ supplierId: SID.tihama }) }, 2_000)).toEqual({ ok: false, reason: "supplier" });
    expect(verifySaveToken(token, { ...ME, result: r }, 1_000 + 31 * 60 * 1000)).toEqual({ ok: false, reason: "expired" });
  });

  it("garbage and a tampered signature are refused without throwing", () => {
    const r = result();
    expect(verifySaveToken("nope", { ...ME, result: r })).toEqual({ ok: false, reason: "malformed" });
    expect(verifySaveToken(undefined, { ...ME, result: r })).toEqual({ ok: false, reason: "malformed" });
    const [body] = issueSaveToken({ ...ME, result: r }).split(".");
    expect(verifySaveToken(`${body}.AAAA`, { ...ME, result: r })).toEqual({ ok: false, reason: "signature" });
  });
});

describe("the web consent for one supplier", () => {
  it("is bound to exactly this supplier: a yes to one cannot be spent on another, and a web-search consent never verifies", () => {
    const id = "c1";
    const token = issueOnceConsent({ ...ME, query: consentQueryFor(SID.wadi), id });
    expect(verifyConsent(token, { ...ME, query: consentQueryFor(SID.wadi) })).toEqual({ ok: true, id });
    expect(verifyConsent(token, { ...ME, query: consentQueryFor(SID.tihama) })).toEqual({ ok: false, reason: "query" });
    const other = issueOnceConsent({ ...ME, query: "Wadi Precast company news", id });
    expect(verifyConsent(other, { ...ME, query: consentQueryFor(SID.wadi) })).toEqual({ ok: false, reason: "query" });
    expect(verifyConsent(token, { tenantId: "t2", userId: "u1", query: consentQueryFor(SID.wadi) })).toEqual({ ok: false, reason: "tenant" });
  });

  it("reads the supplier id back from a query, only for a real id", () => {
    expect(supplierIdFromQuery(consentQueryFor(SID.wadi))).toBe(SID.wadi);
    expect(supplierIdFromQuery(`${CHECK_CONSENT_PREFIX}not-an-id`)).toBeNull();
    expect(supplierIdFromQuery("analyse_company|x")).toBeNull();
  });
});
