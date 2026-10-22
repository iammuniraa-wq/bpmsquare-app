import { describe, it, expect, vi } from "vitest";
import { followNewsletters, newsletterOfStep, stepPatchForPick, withKeptVersion, type NewsletterChoice, type SendNewsletterStep } from "./newsletterSteps";
import { templateById } from "./definition";
import type { JourneyDefinition } from "./types";

const list: NewsletterChoice[] = [
  { id: "n1", name: "October update", topic: "offers", languages: ["en"], versionIds: ["v2", "v1"] },
  { id: "n2", name: "Eid", topic: null, languages: ["en", "ar"], versionIds: ["v9"] },
];
const step = (v: string | null): SendNewsletterStep => ({ id: "s1", kind: "send_newsletter", newsletter_version_id: v, topic: "offers", languages: ["ar"], fallback_language: "en" });
const def = (v: string | null): JourneyDefinition => ({ ...templateById("quote_follow_up")!.build(), steps: [{ id: "s0", kind: "wait", amount: 1, unit: "days" }, step(v)] });

describe("a send step picks a newsletter by name", () => {
  it("finds the newsletter through the version the step holds, and none for an empty or unknown one", () => {
    expect(newsletterOfStep(list, step("v1"))?.name).toBe("October update");
    expect(newsletterOfStep(list, step("v9"))?.id).toBe("n2");
    expect(newsletterOfStep(list, step(null))).toBeNull();
    expect(newsletterOfStep(list, step("zzz"))).toBeNull();
  });

  it("choosing takes the kept version and the newsletter's own topic, and sends every ready language", () => {
    expect(stepPatchForPick({ version_id: "v3", topic: "events", languages: ["en"] })).toEqual({ newsletter_version_id: "v3", topic: "events", languages: [] });
  });

  it("remembers a freshly kept version so the step still finds its newsletter", () => {
    const next = withKeptVersion(list, "n1", { version_id: "v3", topic: "offers", languages: ["en", "ar"] });
    expect(next[0].versionIds).toEqual(["v3", "v2", "v1"]);
    expect(next[0].languages).toEqual(["en", "ar"]);
    expect(next[1]).toBe(list[1]);
    expect(withKeptVersion(list, "n1", { version_id: "v2", topic: null, languages: [] })[0]).toBe(list[0]);
  });
});

describe("a draft follows its newsletters when it is saved", () => {
  it("swaps in the new version when the newsletter changed, and leaves the rest of the journey alone", async () => {
    const resolve = vi.fn(async () => ({ version_id: "v3", topic: "events", languages: ["en"] }));
    const before = def("v2");
    const r = await followNewsletters(before, list, resolve);
    expect(resolve).toHaveBeenCalledWith("n1");
    expect(r.changed).toBe(true);
    expect(r.def.steps[1]).toMatchObject({ newsletter_version_id: "v3", topic: "events", languages: [] });
    expect(r.def.steps[0]).toBe(before.steps[0]);
    expect(r.def.trigger).toBe(before.trigger);
  });

  it("changes nothing when the newsletter is the same, when the step is empty or unknown, or when the refresh fails", async () => {
    const same = await followNewsletters(def("v2"), list, async () => ({ version_id: "v2", topic: "offers", languages: ["en"] }));
    expect(same.changed).toBe(false);
    const none = vi.fn(async () => null);
    expect((await followNewsletters(def(null), list, none)).changed).toBe(false);
    expect((await followNewsletters(def("unknown"), list, none)).changed).toBe(false);
    expect(none).not.toHaveBeenCalled();
    const failed = await followNewsletters(def("v2"), list, async () => null);
    expect(failed.changed).toBe(false);
    expect((failed.def.steps[1] as SendNewsletterStep).newsletter_version_id).toBe("v2");
  });
});
