import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { InteractionEntry, InteractionsData } from "@/lib/tender/interactions/rules";
import { TENDER_TIPS } from "@/lib/tender/tips";

// KAMCO feedback slice 11: the Interactions tab of a tender, rendered on the server with the real component.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/pipeline/x",
}));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown; className?: string }) => createElement("a", { href: p.href, className: p.className }, p.children as never) }));

import InteractionsTab from "./InteractionsTab";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const clean = (h: string) => h.replace(/<!-- -->/g, "");
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";

const entry = (i: number, over: Partial<InteractionEntry> = {}): InteractionEntry => ({
  key: `k${i}`, kind: "received", direction: "in", at: `2026-10-2${i}T09:00:00Z`, who: "Khader <buyer@ministry.gov.sa>", to: null, subject: `RFQ valves ${i}`, text: "Please quote 40 gate valves.", inbox_id: null, redirected: false, ...over,
});
const data = (over: Partial<InteractionsData> = {}): InteractionsData => ({ entries: [], suggested: [], subject: "Re: RFQ valves", messagesPending: false, mailReady: true, inbox: true, ...over });
const tab = (d: InteractionsData | null, props: Record<string, unknown> = {}) => clean(renderToString(createElement(InteractionsTab, { opportunityId: OPP, canEdit: true, initial: d, onError: () => {}, onNotice: () => {}, ...props } as never)));

describe("the timeline", () => {
  const sample = data({
    entries: [
      entry(4, { key: "m", kind: "message", direction: "out", who: "S. Khan", to: "buyer@ministry.gov.sa", subject: "Clarification on item 4", text: "Dear all, please confirm." }),
      entry(3, { key: "d", kind: "document", direction: "out", who: "S. Khan", to: "Ariba", subject: "Priced BOQ · portal", text: "Bid version 2" }),
      entry(2, { key: "r", kind: "received", inbox_id: "mail-1" }),
      entry(1, { key: "s", kind: "source", subject: "RFQ valves", text: "They want 40 valves by March", inbox_id: null }),
    ],
  });

  it("shows each exchange once, newest first, marked Received or Sent, with its subject and text", () => {
    const out = tab(sample);
    expect(out).toContain('data-guide="tender.interactions.timeline"');
    expect(out.match(/data-guide="tender\.interactions\.entry"/g)).toHaveLength(4);
    expect(out.indexOf("Clarification on item 4")).toBeLessThan(out.indexOf("Priced BOQ · portal"));
    expect(out.indexOf("Priced BOQ · portal")).toBeLessThan(out.indexOf("RFQ valves 2"));
    for (const w of ["Received", "Sent", "Source email", "From the client", "Sent to client", "Email from the tender", "Dear all, please confirm.", "They want 40 valves by March", "From Khader &lt;buyer@ministry.gov.sa&gt;", "S. Khan to buyer@ministry.gov.sa"]) expect(out, w).toContain(w);
    expect(out.match(/data-direction="in"/g)?.length).toBeGreaterThan(0);
    expect(out.match(/data-direction="out"/g)?.length).toBeGreaterThan(0);
  });

  it("opens an Inbox message only where the person may, and explains text that is kept in the Inbox", () => {
    const out = tab(sample);
    expect(out.match(/href="\/inbox\//g)).toHaveLength(1);
    expect(read("src/components/tender/InteractionsTab.tsx")).toContain('data-guide="tender.interactions.open_inbox"');
    expect(out).toContain('href="/inbox/mail-1"');
    const hidden = tab(data({ entries: [entry(1, { text: null, inbox_id: null })] }));
    expect(hidden).toContain('data-guide="tender.interactions.kept"');
    expect(hidden).toContain('aria-label="About Inbox mail"');
    expect(hidden).not.toContain(TENDER_TIPS.interactionsInbox);
  });

  it("draws mail text as text, never as markup", () => {
    const out = tab(data({ entries: [entry(1, { text: "<script>alert(1)</script> hello", subject: "<img src=x onerror=alert(1)>" })] }));
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).not.toContain("<img src=x");
    expect(out).toContain("&lt;script&gt;");
  });

  it("clamps a long message with Show more, pages a long timeline, and says so when empty", () => {
    const long = tab(data({ entries: [entry(1, { text: "word ".repeat(120) })] }));
    expect(long).toContain("Show more");
    expect(long).toContain("aria-expanded=\"false\"");
    const many = tab(data({ entries: Array.from({ length: 13 }, (_, i) => entry(1, { key: `e${i}` })) }));
    expect(many).toContain("Show all 13");
    expect(many.match(/data-guide="tender\.interactions\.entry"/g)).toHaveLength(10);
    const empty = tab(data());
    expect(empty).toContain("Nothing has been exchanged with the client on this tender yet.");
    expect(empty).toContain("Write the first email with New email.");
  });
});

describe("writing to the client", () => {
  it("offers New email (44 px) to a person who may change the deal and mail can be sent; not to a view-only person", () => {
    const out = tab(data());
    const b = out.match(/<button\b[^>]*data-guide="tender\.interactions\.compose"[^>]*>[^<]*/)?.[0] ?? "";
    expect(b).toContain("New email");
    expect(b).toContain("min-height:44px");
    const view = tab(data(), { canEdit: false });
    expect(view).not.toContain("New email");
    expect(view).not.toContain("Write the first email");
  });

  it("while migration 0241 is pending it says a database update is needed and offers no sending; timeline still shows", () => {
    const out = tab(data({ messagesPending: true, mailReady: false, entries: [entry(1)] }));
    expect(out).toContain("Sending from here needs a database update (migration 0241). Ask your administrator to apply it.");
    expect(out).not.toContain("New email");
    expect(out).toContain("RFQ valves 1");
  });

  it("says so when the server cannot send email", () => {
    const out = tab(data({ mailReady: false }));
    expect(out).toContain("Email is not set up on this server.");
    expect(out).not.toContain('data-guide="tender.interactions.compose"');
  });

  it("the explanations sit behind an i", () => {
    const out = tab(data());
    expect(out).toContain('aria-label="About Interactions"');
    expect(out).not.toContain(TENDER_TIPS.interactions);
  });

  it("the compose panel is the shared side panel (a bottom sheet on a phone) with a guide id and 44 px on every control", () => {
    const src = read("src/components/tender/InteractionsTab.tsx");
    expect(src).toContain('import SidePanel from "@/components/ui/SidePanel"');
    for (const g of ["tender.interactions.to", "tender.interactions.subject", "tender.interactions.body", "tender.interactions.send", "tender.interactions.cancel", "tender.interactions.compose"]) expect(src).toContain(`"${g}"`);
    expect([...src.matchAll(/<Button\b[^>]*style=\{\{([^}]*)\}\}/g)].every((m) => m[1].includes("minHeight: 44"))).toBe(true);
    expect(src).toContain("/tender/interactions");
    expect(src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "")).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    const css = read("src/components/tender/InteractionsTab.module.css");
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    expect(css).toMatch(/@media \(max-width: 780px\)/);
  });
});

describe("the tab on the tender page", () => {
  const src = read("src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx");

  it("sits after Bid and before Room, for a tender that has it, and nowhere else", () => {
    expect(src).toMatch(/\.\.\.\(tender\.bids \? \[\{ id: "bid" as Tab[^\n]*\r?\n\s*\.\.\.\(tender\.interactions \? \[\{ id: "interactions" as Tab, label: "Interactions" \}\] : \[\]\),\r?\n\s*\.\.\.\(tender\.room/);
    expect(src).toMatch(/\{tab === "interactions" && tender\?\.interactions && \(\s*<InteractionsTab/);
    expect(read("src/app/(app)/pipeline/[id]/page.tsx")).toContain("interactions: { canEdit: boqEdit }");
  });
});
