import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }) }));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));

import JourneyStudio, { type JourneyStudioProps } from "./JourneyStudio";
import { templateById } from "@/lib/marketing/journeys/definition";
import { DEFAULT_LIMITS } from "@/lib/marketing/journeys/safety";

// A render smoke test: the screen must produce its markup from real props without throwing, with every option
// group carrying its one-line hint, a sentence under each step and the "Try it" and "What is happening" cards.

const props = (over: Partial<JourneyStudioProps> = {}): JourneyStudioProps => ({
  journey: { id: "j1", ref: "JNY-0001", name: "Quote follow-up", status: "draft", definition: templateById("quote_follow_up")!.build(), hasRuns: false },
  topics: [{ key: "offers", label: "Offers" }], limits: DEFAULT_LIMITS, timezone: "Asia/Riyadh", studioOn: true, canEdit: true, ...over,
});
const html = (p: JourneyStudioProps) => renderToString(createElement(JourneyStudio, p));

describe("the journey screen", () => {
  it("has the four option groups, each with a button, a summary and a one-line hint", () => {
    const out = html(props());
    for (const t of ["Name and start", "When it starts", "Rules", "Languages"]) expect(out).toContain(`<b>${t}</b>`);
    expect(out).toContain("The moment a person enters.");
    expect(out).toContain("Whether the same person can go through this journey again later.");
    expect(out).toContain("Messages are written in English first.");
    expect(out.match(/aria-expanded=/g)!.length).toBeGreaterThanOrEqual(4);
  });

  it("puts a plain sentence under every step: when it fires, and what can stop it", () => {
    const out = html(props());
    expect(out).toContain("3 days after");
    expect(out).toContain("Held or skipped if:");
    expect(out).toContain("no consent for Offers");
    expect(out).toContain("Friday");
    expect(out).toContain("Counts 3 day");
    expect(out).toContain("Creates the task");
  });

  it("offers Try it on one person, the activity card, Show me how, Save and Turn on", () => {
    const out = html(props());
    for (const t of ["Try it on one person", "Who would enter today", "What is happening", "Show me how", "Turn on", "Save"]) expect(out).toContain(t);
    expect(out).toContain("nothing is sent");
  });

  it("a journey that is on shows Pause and locks the steps", () => {
    const out = html(props({ journey: { ...props().journey, status: "live" } }));
    expect(out).toContain("Pause");
    expect(out).toContain("Pause it to change them.");
    expect(out).not.toContain(">Turn on<");
  });

  it("a person who cannot edit sees it read-only, with the reason", () => {
    expect(html(props({ canEdit: false }))).toContain("You can look at this journey but not change it.");
  });

  it("without the Newsletter Studio the send step says so instead of offering nothing", () => {
    expect(html(props({ studioOn: false }))).toContain("The Newsletter Studio is not switched on for this workspace");
  });
});
