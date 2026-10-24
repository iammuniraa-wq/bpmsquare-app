import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({ default: (p: { href: string; className?: string; children: unknown }) => createElement("a", { href: p.href, className: p.className }, p.children as never) }));

import TemplateCards from "./TemplateCards";
import EmailIntake from "@/components/estimator/workspace/EmailIntake";
import TemplatePanel from "../../settings/estimate-templates/TemplatePanel";
import { CHAINLINK_FENCE_STARTER, PRECAST_VILLA_STARTER } from "@/lib/estimator/starterTemplates";
import type { WorkspaceTemplate } from "@/components/estimator/workspace/types";
import type { TemplateSummary } from "@/lib/estimator/server";

const cards = [
  { id: "t-fence", name: "Chain-link fence", description: CHAINLINK_FENCE_STARTER.description, geometry: "chainlink_fence", icon: "fence", locked: true },
  { id: "t-villa", name: "Precast villa (illustrative)", description: PRECAST_VILLA_STARTER.description, geometry: "precast_villa", icon: null },
  { id: "t-plain", name: "Plain template", description: null, geometry: null },
];

describe("What are you estimating?", () => {
  const html = (over: Partial<Parameters<typeof TemplateCards>[0]> = {}) => renderToString(createElement(TemplateCards, { templates: cards, canPick: true, ...over }));

  it("shows one card per template with its name and one plain line, each linking to the chosen template", () => {
    const out = html();
    expect(out).toContain("Chain-link fence");
    expect(out).toContain("Perimeter or straight-run chain-link fence: posts, fabric, gates and fittings, priced from your catalogue.");
    expect(out).toContain('href="/estimates/new?template=t-fence"');
    expect(out).toContain('href="/estimates/new?template=t-villa"');
    // A template with no description still has a line.
    expect(out).toContain("Start an estimate from this template.");
    // SVG icons only.
    expect(out).toContain("<svg");
    expect(out.match(/est-pick-card/g)!.length).toBeGreaterThanOrEqual(4);
  });

  it("offers the email card (and carries the account) only when AI is on", () => {
    const withAi = html({ accountId: "acc-1" });
    expect(withAi).toContain("Not sure? Start from the customer");
    expect(withAi).toContain("email=1");
    expect(withAi).toContain("account_id=acc-1");
    expect(html({ canPick: false })).not.toContain("Not sure? Start from the customer");
  });

  it("sorts the cards by name", () => {
    const out = html({ canPick: false });
    expect(out.indexOf("Chain-link fence")).toBeLessThan(out.indexOf("Plain template"));
    expect(out.indexOf("Plain template")).toBeLessThan(out.indexOf("Precast villa"));
  });
});

const wt = (s: typeof CHAINLINK_FENCE_STARTER, id: string): WorkspaceTemplate => ({
  id, name: s.name, description: s.description, geometry: s.geometry ?? null, inputs: s.inputs, rates: s.rates, rules: s.rules, quote_granularity: s.quote_granularity,
});

describe("the email card", () => {
  const out = (over: Partial<Parameters<typeof EmailIntake>[0]> = {}) => renderToString(createElement(EmailIntake, {
    templates: [wt(CHAINLINK_FENCE_STARTER, "t-fence"), wt(PRECAST_VILLA_STARTER, "t-villa")], template: wt(CHAINLINK_FENCE_STARTER, "t-fence"),
    autoPick: false, onTemplate: () => {}, onApply: () => {}, ...over,
  }));

  it("opens on a paste box in the template's own words and a disabled read button", () => {
    const html = out();
    expect(html).toContain("Paste the email");
    expect(html).toContain("chain-link fence");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>.*Read the email/);
    expect(html).toContain("Let AI choose the template");
  });

  it("arriving from the email card ticks 'Let AI choose' and reads 'Choose the template and read'", () => {
    const html = out({ autoPick: true });
    expect(html).toContain("Choose the template and read");
    expect(html).toMatch(/type="checkbox"[^>]*checked/);
  });

  it("with one template there is nothing to choose", () => {
    const html = out({ templates: [wt(CHAINLINK_FENCE_STARTER, "t-fence")] });
    expect(html).not.toContain("Let AI choose the template");
    expect(html).toContain("Read the email");
  });
});

const summary = (over: Partial<TemplateSummary> = {}): TemplateSummary => ({
  id: "t-fence", name: "Chain-link fence", description: "Perimeter fence.", trade: "fencing", geometry: "chainlink_fence", version: 1, is_active: true,
  quote_granularity: "line", input_count: 17, rule_count: 14, estimate_count: 0, updated_at: "2026-10-24",
  keywords: ["fence", "gate"], icon: "fence", locked: true, customer_visible: false, ...over,
});

describe("the template side panel", () => {
  const panel = (t: TemplateSummary) => renderToString(createElement(TemplatePanel, { template: t, busy: false, onClose: () => {}, onCopy: () => {}, onSaved: () => {}, onEdit: () => {} }));

  it("a starter is read-only and offers Copy to customise", () => {
    const html = panel(summary());
    expect(html).toContain("Starter template, read-only");
    expect(html).toContain("Copy to customise");
    expect(html).toContain("fence, gate");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain(">Save<");
  });

  it("a template of the workspace's own can be edited in the panel", () => {
    const html = panel(summary({ locked: false }));
    expect(html).toContain("<textarea");
    expect(html).toContain("Words an email would use");
    expect(html).toContain("Customers may request this");
    expect(html).toContain(">Save<");
    expect(html).toContain("Open the editor");
    expect(html).not.toContain("Copy to customise");
  });
});
