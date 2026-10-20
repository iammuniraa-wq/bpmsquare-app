import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));

import JourneyStudio, { type JourneyStudioProps } from "./JourneyStudio";
import { templateById } from "@/lib/marketing/journeys/definition";
import { DEFAULT_LIMITS } from "@/lib/marketing/journeys/safety";

// A render smoke test: the screen must produce its markup from real props without throwing, with three option
// groups each carrying an "i", a sentence under each step with a guards chip, and the Build tab's cards.

const props = (over: Partial<JourneyStudioProps> = {}): JourneyStudioProps => ({
  journey: { id: "j1", ref: "JNY-0001", name: "Quote follow-up", status: "draft", definition: templateById("quote_follow_up")!.build(), hasRuns: false },
  topics: [{ key: "offers", label: "Offers" }], limits: DEFAULT_LIMITS, timezone: "Asia/Riyadh", studioOn: true, canEdit: true, ...over,
});
const html = (p: JourneyStudioProps) => renderToString(createElement(JourneyStudio, p));

describe("the journey screen", () => {
  it("has three option groups, each a row with its own button and an i, and prints none of their explanations", () => {
    const out = html(props());
    for (const t of ["Name and start", "When it starts", "Rules"]) {
      expect(out).toMatch(new RegExp(`class="bpm-og-title"[^>]*>${t}</button><button[^>]*aria-label="About ${t}"`));
    }
    expect(out).not.toContain(">Languages<");
    expect(out.match(/class="bpm-og(?: [a-z]+)*"/g)!.length).toBe(3);
    expect(out).not.toContain("The moment a person enters.");
    expect(out).not.toContain("Whether the same person can go through it again later.");
  });

  it("splits the canvas into Build, Test and Running tabs, with Setup as the first tab on a phone", () => {
    const out = html(props());
    expect(out).toMatch(/aria-label="Journey"/);
    expect(out).toMatch(/aria-label="Journey sections"/);
    for (const t of ["Setup", "Build", "Test", "Running"]) expect(out).toMatch(new RegExp(`role="tab"[^>]*>${t}`));
    expect(out).toContain('data-tab="build"');
  });

  it("keeps the sentence under every step, and puts what can hold or skip it behind a guards chip", () => {
    const out = html(props());
    expect(out).toContain("3 days after");
    expect(out).toContain("Friday");
    expect(out).toContain("Counts 3 day");
    expect(out).toContain("Creates the task");
    expect(out).not.toContain("Held or skipped if");
    expect(out).toMatch(/\d guards?<button[^>]*aria-label="About guards on step 2"/);
  });

  it("offers Who would enter today and the journey in Build, and Save and Go live in the header and the phone bar", () => {
    const out = html(props());
    for (const t of ["Who would enter today", "The journey", "Go live", "Save", "Show me how"]) expect(out).toContain(t);
    expect(out.match(/Go live/g)!.length).toBe(2);
    expect(out).not.toContain("Turn on");
    expect(out).not.toContain("Try it on one person");
  });

  it("a journey that is live shows Pause and locks the steps", () => {
    const out = html(props({ journey: { ...props().journey, status: "live" } }));
    expect(out).toContain("Pause");
    expect(out).toContain("Pause it to change them.");
    expect(out).not.toContain(">Go live<");
  });

  it("a person who cannot edit sees it read-only, with the reason", () => {
    expect(html(props({ canEdit: false }))).toContain("You can look at this journey but not change it.");
  });

  it("without the Newsletter Studio the send step says so instead of offering nothing", () => {
    expect(html(props({ studioOn: false }))).toContain("The Newsletter Studio is not switched on for this workspace");
  });

  it("the send step asks for a consent topic, not a subject", () => {
    const out = html(props());
    expect(out).toContain('aria-label="Consent topic"');
    expect(out).toContain("Any consent topic");
  });
});
