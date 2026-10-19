import { describe, it, expect } from "vitest";
import type { CapabilityEntry } from "@/lib/capability/generate";
import { checkFit, countRatings, type RawFit } from "./ratings";

const entry = (over: Partial<CapabilityEntry> & { id: string }): CapabilityEntry => ({
  kind: "module", label: over.id, plain: "x", module: "m", needs: [], where: null, source: "t", status: "live", ...over,
});

const E = [
  entry({ id: "cap.module.estimator" }),
  entry({ id: "cap.setting.estimate_templates", kind: "setting" }),
  entry({ id: "cap.field.case.notes", kind: "field" }),
  entry({ id: "cap.module.nova", status: "experimental" }),
  entry({ id: "cap.connector.dynamics365", kind: "connector", caveat: "Not yet run with a client." }),
  entry({ id: "cap.module.hidden_elsewhere" }),
];
const catalogue = new Map(E.map((e) => [e.id, e]));
const allowed = new Set(E.filter((e) => e.id !== "cap.module.hidden_elsewhere").map((e) => e.id));

const raw = (over: Partial<RawFit>): RawFit => ({
  step_id: "s1", rating: "standard", capability_ids: ["cap.module.estimator"], why: "It does this.", confidence: "sure", ...over,
});

describe("checkFit", () => {
  it("keeps a Standard row that cites a live entry", () => {
    const r = checkFit(raw({}), catalogue, allowed);
    expect(r.rating).toBe("standard");
    expect(r.capability_ids).toEqual(["cap.module.estimator"]);
    expect(r.confidence).toBe("sure");
    expect(r.warnings).toEqual([]);
  });

  it("turns an uncited Standard claim into Needs review, never Standard", () => {
    const r = checkFit(raw({ capability_ids: [] }), catalogue, allowed);
    expect(r.rating).toBe("needs_review");
    expect(r.confidence).toBe("check_with_us");
    expect(r.warnings.join(" ")).toMatch(/without a named module/i);
  });

  it("drops an id that is not in the catalogue and downgrades to Needs review when nothing is left", () => {
    const r = checkFit(raw({ capability_ids: ["cap.module.invented"] }), catalogue, allowed);
    expect(r.rating).toBe("needs_review");
    expect(r.capability_ids).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/not in the capability catalogue/);
  });

  it("drops an id that exists but was not offered for this area", () => {
    const r = checkFit(raw({ capability_ids: ["cap.module.hidden_elsewhere", "cap.module.estimator"] }), catalogue, allowed);
    expect(r.rating).toBe("standard");
    expect(r.capability_ids).toEqual(["cap.module.estimator"]);
    expect(r.confidence).toBe("likely"); // sure is capped once a citation was dropped
  });

  it("never lets an unreleased entry back a Standard row", () => {
    const r = checkFit(raw({ capability_ids: ["cap.module.nova"] }), catalogue, allowed);
    expect(r.rating).toBe("needs_review");
    expect(r.warnings.join(" ")).toMatch(/not released/);
  });

  it("shows an unreleased-only row as Coming when the owner chooses to show unreleased things", () => {
    const r = checkFit(raw({ capability_ids: ["cap.module.nova"] }), catalogue, allowed, { includeUnreleased: true });
    expect(r.rating).toBe("coming");
    expect(r.capability_ids).toEqual(["cap.module.nova"]);
  });

  it("requires a setting or field citation for Needs setup", () => {
    expect(checkFit(raw({ rating: "needs_setup" }), catalogue, allowed).rating).toBe("needs_review");
    expect(checkFit(raw({ rating: "needs_setup", capability_ids: ["cap.module.estimator", "cap.setting.estimate_templates"] }), catalogue, allowed).rating).toBe("needs_setup");
    expect(checkFit(raw({ rating: "needs_setup", capability_ids: ["cap.field.case.notes"] }), catalogue, allowed).rating).toBe("needs_setup");
  });

  it("requires a citation and a why for Partly covered", () => {
    expect(checkFit(raw({ rating: "partly", capability_ids: [] }), catalogue, allowed).rating).toBe("needs_review");
    expect(checkFit(raw({ rating: "partly", why: "  " }), catalogue, allowed).rating).toBe("needs_review");
    expect(checkFit(raw({ rating: "partly" }), catalogue, allowed).rating).toBe("partly");
  });

  it("allows Not covered with no citation", () => {
    const r = checkFit(raw({ rating: "not_covered", capability_ids: [], why: "No casting schedule exists." }), catalogue, allowed);
    expect(r.rating).toBe("not_covered");
  });

  it("refuses a rating the model made up", () => {
    expect(checkFit(raw({ rating: "perfect" }), catalogue, allowed).rating).toBe("needs_review");
  });

  it("lowers Standard to Partly when the only citation carries a limitation", () => {
    const r = checkFit(raw({ capability_ids: ["cap.connector.dynamics365"] }), catalogue, allowed);
    expect(r.rating).toBe("partly");
    expect(r.warnings.join(" ")).toMatch(/Not yet run/);
    expect(r.confidence).toBe("likely");
  });

  it("does not lower a row that also has an unrestricted citation", () => {
    const r = checkFit(raw({ capability_ids: ["cap.connector.dynamics365", "cap.module.estimator"] }), catalogue, allowed);
    expect(r.rating).toBe("standard");
  });

  it("ignores duplicate ids", () => {
    const r = checkFit(raw({ capability_ids: ["cap.module.estimator", "cap.module.estimator"] }), catalogue, allowed);
    expect(r.capability_ids).toEqual(["cap.module.estimator"]);
  });
});

describe("countRatings", () => {
  it("counts every rating, including the system states", () => {
    const c = countRatings([{ rating: "standard" }, { rating: "standard" }, { rating: "needs_review" }, { rating: "coming" }]);
    expect(c.standard).toBe(2);
    expect(c.needs_review).toBe(1);
    expect(c.coming).toBe(1);
    expect(c.partly).toBe(0);
  });
});
