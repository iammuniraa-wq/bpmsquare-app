import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hasValidEmail, splitReachable, unreachableMessage, type Recipient } from "./reach";

// Live bug 2026-10-27: "Send to N suppliers" for suppliers with no e-mail answered a bare "Request failed (502)".

const r = (id: string, name: string, email: string | null, phone: string | null = null): Recipient => ({ id, name, email, phone });
const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

describe("who an RFQ can be e-mailed to", () => {
  it("accepts an address and refuses empty, blank and malformed ones", () => {
    expect(hasValidEmail("sales@gulfpipes.example")).toBe(true);
    expect(hasValidEmail("  sales@gulfpipes.example ")).toBe(true);
    for (const bad of [null, undefined, "", "   ", "sales", "sales@", "a b@c.d"]) expect(hasValidEmail(bad as string | null)).toBe(false);
  });

  it("splits the reachable from the unreachable and keeps everyone", () => {
    const list = [r("1", "Gulf Pipes", "a@gulf.example"), r("2", "Al Noor", null, "+966500000000"), r("3", "Delta", "")];
    const { reachable, unreachable } = splitReachable(list);
    expect(reachable.map((x) => x.id)).toEqual(["1"]);
    expect(unreachable.map((x) => x.id)).toEqual(["2", "3"]);
  });

  it("names the suppliers and what to do, and says when nothing was sent", () => {
    const m = unreachableMessage([r("2", "Al Noor", null, "+966500000000"), r("3", "Delta", null)], true);
    expect(m).toBe("Nothing was sent. Al Noor and Delta (no phone either) have no email address. Add one on the supplier, or copy the reply link and share it on WhatsApp.");
    expect(unreachableMessage([r("2", "Al Noor", null, "+966500000000")], false)).toBe("Al Noor has no email address. Add one on the supplier, or copy the reply link and share it on WhatsApp.");
    expect(unreachableMessage([r("1", "A", null, "1"), r("2", "B", null, "2"), r("3", "C", null, "3")], false)).toContain("A, B and C have no email address");
  });
});

describe("the routes use it", () => {
  it("the send route answers 422 with the message before sending anything, still sends to the suppliers it can reach, and never answers a bare 502", () => {
    const src = read("src/app/api/rfqs/[id]/send/route.ts");
    expect(src).toContain("splitReachable(");
    expect(src).toMatch(/unreachable\.length > 0 && reachable\.length === 0/);
    expect(src).toMatch(/error: unreachableMessage\(unreachable, true\)[\s\S]*status: 422/);
    expect(src).toContain("for (const { rs } of reachable)");
    expect(src).toMatch(/\.\.\.\(okCount \? \{\} : \{ error:/);
  });

  it("creating an RFQ with Send checks the suppliers first, so the Costing composer gets the same message", () => {
    const src = read("src/app/api/rfqs/route.ts");
    expect(src).toContain("splitReachable(");
    expect(src.indexOf("splitReachable(")).toBeLessThan(src.indexOf("await createRfq("));
    expect(src).toMatch(/unreachableMessage\(unreachable, true\)[\s\S]*status: 422/);
    expect(read("src/components/rfq/submitRfq.ts")).toContain("j.error");
  });
});
