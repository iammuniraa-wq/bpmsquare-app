import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));

import SendPanel from "./SendPanel";
import { NEWSLETTER_TIPS } from "@/lib/newsletter/tips";
import { tipTextProblems } from "@/lib/infoTip";

// The Send panel is the whole of "send a newsletter": one audience choice, a live count, one Send. It never asks
// for a name, a topic or a language again, and prints no explanation (those sit behind the i).

const html = (over: Partial<Parameters<typeof SendPanel>[0]> = {}) => renderToString(createElement(SendPanel, {
  newsletterId: "n1", name: "October update", topicLabel: "Offers", languageNames: ["English", "Arabic"], waiting: [], onClose: () => {}, onSent: () => {}, ...over,
}));

describe("the Send panel", () => {
  it("opens on one audience choice with everyone selected, One-off behind More, and a Send button", () => {
    const out = html();
    expect(out).toContain("Send October update");
    expect(out).toContain("Everyone we can email");
    expect(out).toContain('aria-label="About Audience"');
    expect(out).toMatch(/aria-expanded="false"[^>]*>More</);
    expect(out).toMatch(/<button[^>]*disabled[^>]*>Send<\/button>/);
    expect(out).not.toContain("Add email addresses");
  });

  it("shows the inherited languages and topic as a line, and asks for none of them", () => {
    const out = html();
    expect(out).toContain("English + Arabic · Offers");
    expect(out.match(/<select/g)!.length).toBe(1);
    for (const gone of ["Campaign name", "Consent topic", "Languages to send", "Fallback"]) expect(out).not.toContain(gone);
  });

  it("says plainly that a language still to be checked is not sent", () => {
    expect(html({ waiting: ["Arabic"] })).toContain("Arabic still has lines to check, so it is not sent.");
    expect(html()).not.toContain("still has lines to check");
  });

  it("prints none of its explanations, and each fits the InfoTip limit", () => {
    const out = html();
    expect(out).not.toContain(NEWSLETTER_TIPS.sendAudience);
    expect(out).not.toContain(NEWSLETTER_TIPS.sendMore);
    for (const key of ["sendAudience", "sendMore"] as const) expect(tipTextProblems(NEWSLETTER_TIPS[key]), key).toEqual([]);
  });
});
