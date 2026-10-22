import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/link", () => ({ default: (p: { href: string; className?: string; children: unknown }) => createElement("a", { href: p.href, className: p.className }, p.children as never) }));

import { BriefingView, type BriefingViewProps } from "./BriefingTile";
import { BRIEFING_EMPTY, BRIEFING_TIPS } from "@/lib/briefing/tips";
import type { Briefing } from "@/lib/briefing/types";

// The tile draws the server's briefing as three rows of labels and links, never as running explanation text: the
// four explanations sit behind an "i" and are not printed. Rendered here with real props, no browser.

const working = { urgency: 75, urgencyWhy: "expires tomorrow", valueFactor: 1.3, ownership: 1, ownershipWhy: "yours" as const };
const briefing = (over: Partial<Briefing> = {}): Briefing => ({
  day: "2026-10-22", timeZone: "UTC", computedAt: "2026-10-22T10:00:00.000Z", empty: false, cached: true, stored: true, refreshableAt: null,
  yesterday: [
    { id: "y1", label: "Created 2 quotes", href: "/quotations", objectType: "quote", count: 2 },
    { id: "y2", label: "Updated 5 accounts", href: "/accounts", objectType: "account", count: 5 },
  ],
  today: [{ id: "o1", label: "3 quotes expiring", href: "/quotations", objectType: "quote", count: 3 }],
  focus: Array.from({ length: 5 }, (_, i) => ({
    id: `f${i}`, label: `SQ-2026-000${i}`, href: `/quotations/f${i}`, objectType: "quote", score: 90 - i,
    why: i === 0 ? "Expires tomorrow · ₹4.2L" : `Draft for ${10 + i} days`, working,
  })),
  ...over,
});
const view = (p: Partial<BriefingViewProps> = {}) =>
  renderToString(createElement(BriefingView, { briefing: briefing(), status: "ready", onRefresh: () => {}, ...p }));

describe("the briefing tile", () => {
  it("shows Yesterday, Open and Focus rows with links, the first three focus lines and their reasons", () => {
    const out = view();
    for (const label of ["Yesterday", "Open", "Focus"]) expect(out).toContain(`>${label}</span>`);
    expect(out).toContain(">Created 2 quotes</a>");
    expect(out).toContain(">3 quotes expiring</a>");
    expect(out).toContain('href="/quotations/f0"');
    expect(out).toContain("Expires tomorrow · ₹4.2L");
    expect(out).toContain("SQ-2026-0002");
    expect(out).not.toContain("SQ-2026-0003");
  });
  it("offers the rest of the focus list on request", () => {
    expect(view({ onToggleAll: () => {} })).toContain("Show all 5");
    const all = view({ showAll: true, onToggleAll: () => {} });
    expect(all).toContain("SQ-2026-0004");
    expect(all).toContain("Show fewer");
  });
  it("the rows carry no i; the tile keeps its one, and the dock's bare card has none (owner 2026-10-22)", () => {
    const out = view();
    for (const label of ["Yesterday", "Open", "Focus"]) expect(out).not.toContain(`aria-label="About ${label}"`);
    expect(out).toContain('aria-label="About the briefing"');
    for (const tip of Object.values(BRIEFING_TIPS)) expect(out).not.toContain(tip);
    expect(view({ bare: true })).not.toContain('aria-label="About');
  });
  it("resolves markdown markers in the wording instead of printing them", () => {
    const out = view({ briefing: briefing({ focus: [{ ...briefing().focus[0], label: "**SQ-1**", why: "Expires **tomorrow** <b>x</b>" }] }) });
    expect(out).toContain(">SQ-1</a>");
    expect(out).toContain("<strong>tomorrow</strong>");
    expect(out).not.toContain("**");
    expect(out).not.toContain("<b>");
  });
  it("a new user sees the one-line empty state and no rows", () => {
    const out = view({ briefing: briefing({ empty: true, yesterday: [], today: [], focus: [] }) });
    expect(out).toContain(BRIEFING_EMPTY);
    expect(out).not.toContain('class="bms-brief-row"');
  });
  it("says so when a row has nothing in it", () => {
    const out = view({ briefing: briefing({ today: [], focus: [], yesterday: briefing().yesterday }) });
    expect(out).toContain("Nothing open");
    expect(out).toContain("Nothing to push on");
  });
  it("shows loading and error states without rows", () => {
    expect(view({ briefing: null, status: "loading" })).toContain("Loading…");
    const err = view({ briefing: null, status: "error" });
    expect(err).toContain('role="alert"');
    expect(err).not.toContain('class="bms-brief-row"');
  });
  it("Refresh is disabled while it works and during the five-minute cool-down", () => {
    expect(view()).toMatch(/<button[^>]*class="bms-brief-refresh"[^>]*>Refresh<\/button>/);
    expect(view({ refreshing: true })).toMatch(/disabled[^>]*>Refreshing…/);
    const cooling = view({ briefing: briefing({ refreshableAt: "2026-10-22T10:05:00.000Z" }), nowMs: Date.parse("2026-10-22T10:02:00.000Z") });
    expect(cooling).toMatch(/class="bms-brief-refresh"[^>]*disabled|disabled=""[^>]*class="bms-brief-refresh"/);
    const ready = view({ briefing: briefing({ refreshableAt: "2026-10-22T10:05:00.000Z" }), nowMs: Date.parse("2026-10-22T10:06:00.000Z") });
    expect(ready).not.toMatch(/class="bms-brief-refresh"[^>]*disabled/);
  });
  it("is laid out for 375 px: rows stack and every link is a 44 px target", () => {
    const out = view();
    expect(out).toMatch(/@media \(max-width: 480px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
    expect(out).toMatch(/@media \(max-width: 480px\)[\s\S]*\.bms-brief-link \{[^}]*padding: 11px 0/);
    expect(out).toMatch(/@media \(max-width: 480px\)[\s\S]*min-height: 44px/);
  });
  it("the dock's bare variant has no title of its own", () => {
    expect(view()).toContain("Your day");
    expect(view({ bare: true })).not.toContain("Your day");
  });
});
