import { describe, expect, it, vi } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CURRENCIES } from "@/lib/currency";
import type { RichNextStep, RichSummary, RichTouch } from "@/lib/rich/accountRecord";

// TabTitle talks to the browser tab store; it renders nothing, so it is stood in for here.
vi.mock("@/components/TabTitle", () => ({ default: () => null }));

import RichAccountRecord, { RichHero, RichNextStepCard, RichQuickBar, RichSummaryRow, RichTouchTimeline, type RichAction } from "./RichAccountRecord";
import RichSection from "./RichSection";

const createElement = create as unknown as (c: unknown, p: object | null, ...kids: unknown[]) => ReactElement;
const html = (el: ReactElement) => renderToString(el);
const cur = CURRENCIES.INR;

const health = { score: 72, grade: "B" as const, label: "Steady", factors: [
  { label: "Recency", points: 25, detail: "Active 2 days ago" },
  { label: "Payment", points: 8, detail: "2 overdue invoices, oldest 30 days past due" },
] };
const full: RichSummary = {
  health,
  pipeline: { value: 1_800_000, openCount: 3 },
  openCases: { open: 2, aged: 1 },
  outstanding: { amount: 40_000, overdueCount: 2 },
  lastTouch: { id: "case:1:opened", kind: "case", title: "Case C-1 opened", detail: "Service intake", when: "2 days ago", days: 2, tone: "neutral", href: "/cases/1" },
};
const bare: RichSummary = { health, pipeline: null, openCases: null, outstanding: null, lastTouch: null };

const touch = (i: number): RichTouch => ({ id: `quote:${i}:created`, kind: "quote", title: `Quote QT-${i} sent`, detail: "", when: `${i} days ago`, days: i, tone: "neutral", href: `/quotations/${i}` });
const step: RichNextStep = { id: "chase-overdue", title: "Chase ₹900 overdue", detail: "1 invoice past due, the oldest by 10 days.", urgency: "high", href: "/invoices/i1", more: 2 };
const actions: RichAction[] = [
  { key: "call", label: "Call", href: "tel:+910000", kind: "call" },
  { key: "mail", label: "Email", href: "mailto:a@b.co", kind: "mail" },
  { key: "quotation", label: "Quote", href: "/quotations/new?account_id=a1", kind: "quotation" },
  { key: "case", label: "Case", href: "/cases/new?account_id=a1", kind: "case" },
  { key: "contact", label: "Contact", href: "/contacts/new?account_id=a1", kind: "contact" },
];

describe("RichHero", () => {
  const out = html(createElement(RichHero, {
    name: "Vikas Pioneers", reference: "ACC-0007", city: "Pune", status: createElement("span", null, "STATUS-NODE"), actions,
    primaryAction: createElement("button", null, "PRIMARY-NODE"), menu: createElement("button", null, "MENU-NODE"), externalLine: createElement("i", null, "EXT-NODE"),
  }));
  it("shows the name big, initials in the tile, and the reference and city once", () => {
    expect(out).toContain("<h1");
    expect(out).toContain("Vikas Pioneers");
    expect(out).toContain(">VP<");
    expect(out).toContain("ACC-0007 · Pune");
  });
  it("keeps every slot the standard page had", () => {
    for (const n of ["STATUS-NODE", "PRIMARY-NODE", "MENU-NODE", "EXT-NODE"]) expect(out).toContain(n);
  });
  it("names each quick action for assistive tech, and calls are plain anchors", () => {
    expect(out).toContain('aria-label="Call"');
    expect(out).toContain('aria-label="New quote"');
    expect(out).toContain('href="tel:+910000"');
    expect(out).toContain('href="mailto:a@b.co"');
  });
  it("paints the frame from tokens, with no image", () => {
    expect(out).toContain("rich-photo");
    expect(out).not.toContain("<img");
  });
});

describe("RichSummaryRow", () => {
  const tabs = new Set(["quotations", "cases", "invoices"]);
  const render = (s: RichSummary, has = (id: string) => tabs.has(id)) =>
    html(createElement(RichSummaryRow, { summary: s, cur, tabHref: (id: string) => `/accounts/a1?tab=${id}`, hasTab: has }));

  it("draws the health ring with its number and says what is weakest", () => {
    const out = render(full);
    expect(out).toContain('aria-label="Account health: 72 percent"');
    expect(out).toContain(">72<");
    expect(out).toContain("Steady");
    expect(out).toContain("2 overdue invoices, oldest 30 days past due");
  });
  it("shows a card only when its data exists", () => {
    const out = render(bare);
    expect(out).toContain("Health");
    for (const absent of ["Pipeline", "Open cases", "Owed", "Last touch"]) expect(out).not.toContain(absent);
    const withAll = render(full);
    for (const present of ["Pipeline", "Open cases", "Owed", "Last touch"]) expect(withAll).toContain(present);
  });
  it("links a card to its tab, and to nothing for a tab the tenant does not have", () => {
    expect(render(full)).toContain('href="/accounts/a1?tab=quotations"');
    expect(render(full, () => false)).not.toContain("?tab=quotations");
  });
  it("puts the explanations behind the i, not in the text", () => {
    const out = render(full);
    expect(out).toContain('aria-label="About Health"');
    expect(out).toContain('aria-label="About Pipeline"');
    expect(out).not.toContain("still open");
  });
  it("says what the numbers are in words, not only colour", () => {
    const out = render(full);
    expect(out).toContain("2 overdue");
    expect(out).toContain("1 over 30 days");
    expect(out).toContain("3 open");
  });
});

describe("RichNextStepCard", () => {
  it("shows the step, how urgent it is, where to go, and that others wait in Account 360", () => {
    const out = html(createElement(RichNextStepCard, { step }));
    expect(out).toContain("Chase ₹900 overdue");
    expect(out).toContain("Do first");
    expect(out).toContain('href="/invoices/i1"');
    expect(out).toContain("2 more in Account 360");
  });
  it("keeps the how-it-works behind an i and never claims AI", () => {
    const out = html(createElement(RichNextStepCard, { step }));
    expect(out).toContain('aria-label="About Next best step"');
    expect(out).not.toContain("not by AI");
  });
  it("has a calm empty state", () => {
    expect(html(createElement(RichNextStepCard, { step: null }))).toContain("All clear");
  });
});

describe("RichTouchTimeline", () => {
  it("lists the touches in the order given, each a link", () => {
    const out = html(createElement(RichTouchTimeline, { touches: [touch(1), touch(2), touch(3)] }));
    expect(out.indexOf("QT-1")).toBeLessThan(out.indexOf("QT-2"));
    expect(out.indexOf("QT-2")).toBeLessThan(out.indexOf("QT-3"));
    expect(out).toContain('href="/quotations/2"');
    expect(out).toContain("<ol");
  });
  it("renders nothing without touches", () => {
    expect(html(createElement(RichTouchTimeline, { touches: [] }))).toBe("");
  });
});

describe("RichQuickBar", () => {
  it("shows at most four actions, each with a visible label", () => {
    const out = html(createElement(RichQuickBar, { actions }));
    expect(out).toContain('aria-label="Quick actions"');
    expect((out.match(/rich-acct__barbtn/g) ?? []).length).toBe(4);
    expect(out).not.toContain(">Contact<");
  });
  it("is absent with no actions", () => {
    expect(html(createElement(RichQuickBar, { actions: [] }))).toBe("");
  });
});

describe("RichSection", () => {
  it("starts closed with the body mounted but hidden, so an editor inside keeps its state", () => {
    const out = html(createElement(RichSection, { id: "d", title: "Details", hint: "All fields" }, createElement("p", null, "BODY")));
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain("BODY");
    expect(out).toMatch(/class="rich-sec__body"[^>]*hidden/);
    expect(out).toContain("All fields");
  });
  it("opens by default when asked", () => {
    const out = html(createElement(RichSection, { id: "c", title: "Contact", defaultOpen: true }, "x"));
    expect(out).toContain('aria-expanded="true"');
    expect(out).not.toMatch(/class="rich-sec__body"[^>]*hidden/);
  });
  it("keeps the i beside the toggle, never inside the button", () => {
    const out = html(createElement(RichSection, { id: "i", title: "Details", info: "What this is." }, "x"));
    expect(out).toContain('aria-label="About Details"');
    const button = out.slice(out.indexOf('<button type="button" class="rich-sec__title"'), out.indexOf("</button>") + 9);
    expect(button).not.toContain("bpm-tip");
  });
});

describe("RichAccountRecord", () => {
  const tabs = [
    { id: "overview", label: "Overview", content: "UNUSED-OVERVIEW" },
    { id: "cases", label: "Cases", count: 2, content: "CASES-CONTENT" },
    { id: "activity", label: "Activity", content: "ACTIVITY-CONTENT" },
  ];
  const base = {
    backHref: "/accounts", backLabel: "All accounts", name: "Vikas Pioneers", reference: "ACC-0007", city: "Pune", status: "S",
    summary: full, cur, nextStep: step, touches: [touch(1), touch(2)], actions,
    primaryAction: createElement("b", null, "PRIMARY"), menu: createElement("b", null, "MENU"), externalLine: null,
    tabs, basePath: "/accounts/a1", overviewDetail: createElement("div", null, "OVERVIEW-DETAIL"),
  };
  const render = (activeTab?: string) => html(createElement(RichAccountRecord, { ...base, activeTab }));

  it("opens on Overview with the next step, the touches and the detail sections", () => {
    const out = render();
    for (const n of ["Next best step", "Latest touches", "OVERVIEW-DETAIL"]) expect(out).toContain(n);
    expect(out).not.toContain("CASES-CONTENT");
    expect(out).not.toContain("UNUSED-OVERVIEW");
  });
  it("shows only the chosen tab's own content on the other tabs, and keeps the glance row and hero", () => {
    const out = render("cases");
    expect(out).toContain("CASES-CONTENT");
    expect(out).not.toContain("OVERVIEW-DETAIL");
    expect(out).not.toContain("Latest touches");
    expect(out).toContain("Account at a glance");
    expect(out).toContain("Vikas Pioneers");
  });
  it("keeps the existing tab strip with its links and counts", () => {
    const out = render("activity");
    expect(out).toContain('role="tablist"');
    expect(out).toContain('href="/accounts/a1?tab=overview"');
    expect(out).toContain('href="/accounts/a1?tab=cases"');
    expect(out).toContain('aria-selected="true"');
    expect(out).toContain(">2<");
  });
  it("falls back to Overview for an unknown tab", () => {
    expect(render("nope")).toContain("OVERVIEW-DETAIL");
  });
  it("keeps the back link, primary action and menu", () => {
    const out = render();
    expect(out).toContain('href="/accounts"');
    expect(out).toContain("PRIMARY");
    expect(out).toContain("MENU");
  });
});

describe("rich-account-record.css", () => {
  const css = readFileSync(path.resolve(__dirname, "../../styles/rich-account-record.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  it("scopes every selector under the Rich gate, so other tenants are untouched", () => {
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((s) => s && !s.startsWith("@"));
    expect(selectors.length).toBeGreaterThan(20);
    const topLevel = (sel: string) => {
      const parts: string[] = [];
      let depth = 0, cur = "";
      for (const ch of sel) {
        if (ch === "(" || ch === "[") depth++;
        if (ch === ")" || ch === "]") depth--;
        if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; } else cur += ch;
      }
      parts.push(cur.trim());
      return parts;
    };
    for (const sel of selectors) for (const part of topLevel(sel)) expect(part).toMatch(/^\[data-rich="true"\]/);
  });
  it("holds no hex colours; every colour is a token", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
  it("stops moving under prefers-reduced-motion", () => {
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});
