import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }), useSearchParams: () => new URLSearchParams() }));

import { tipTextProblems } from "@/lib/infoTip";
import type { PricingItem } from "@/lib/types";
import { blankPrice, draftOfItem, filterItems, planPriceSave, priceProblem, pricingParts, PRICE_FILTERS } from "./pricingLogic";
import { PRICING_TIPS } from "./tips";
import PricingClient from "./PricingClient";

const html = (el: React.ReactElement) => renderToString(el).replace(/<!-- -->/g, "");
const item = (id: string, category: PricingItem["category"], description: string, rate = 100): PricingItem => ({ id, category, description, unit: "per job", rate, notes: null });
const items = [item("1", "labour", "Rewinding"), item("2", "material", "Copper wire", 40), item("3", "testing", "Insulation test")];

describe("pricing: one table, category as a chip", () => {
  it("filters by category", () => {
    expect(filterItems(items, "all")).toHaveLength(3);
    expect(filterItems(items, "material").map((i) => i.description)).toEqual(["Copper wire"]);
    expect(PRICE_FILTERS.map((f) => f.id)).toEqual(["all", "labour", "material", "testing", "transport"]);
  });

  it("starts a new rate in the category being looked at", () => {
    expect(blankPrice("testing").category).toBe("testing");
    expect(blankPrice("all").category).toBe("labour");
  });

  it("needs a description and a unit, and a rate that is zero or more", () => {
    const ok = { ...blankPrice("all"), description: "Rewind", unit: "per job", rate: "120" };
    expect(priceProblem(ok)).toBeNull();
    expect(priceProblem({ ...ok, rate: "" })).toBeNull();
    expect(priceProblem({ ...ok, description: " " })).toMatch(/Describe/);
    expect(priceProblem({ ...ok, unit: "" })).toMatch(/per/);
    expect(priceProblem({ ...ok, rate: "-1" })).toMatch(/zero/);
  });

  it("creates through POST and edits through PATCH on the id, with notes cleared to null", () => {
    const create = planPriceSave({ ...blankPrice("all"), description: " Rewind ", unit: "per job", rate: "120.5", notes: " " });
    expect(create).toEqual({ url: "/api/settings/pricing", method: "POST", body: { category: "labour", description: "Rewind", unit: "per job", rate: 120.5, notes: null } });
    const edit = planPriceSave(draftOfItem(items[1]));
    expect(edit).toMatchObject({ url: "/api/settings/pricing/2", method: "PATCH", body: { rate: 40, category: "material" } });
  });

  it("offers the rate card with Quotations and the Dynamic Pricing link with that module", () => {
    expect(pricingParts({ quotations: true })).toEqual({ rateCard: true, engine: false });
    expect(pricingParts({ pricing_engine: true })).toEqual({ rateCard: false, engine: true });
    expect(pricingParts({ wfm: true })).toEqual({ rateCard: false, engine: false });
  });
});

describe("the Pricing screen", () => {
  it("is one table with a row per rate and a chip per category, no card per category", () => {
    const out = html(createElement(PricingClient, { initialItems: items, rateCard: true, engine: false }));
    expect((out.match(/<table/g) ?? []).length).toBe(1);
    expect((out.match(/<tr/g) ?? []).length).toBe(items.length + 1);
    for (const chip of ["All", "Labour", "Material", "Testing", "Transport"]) expect(out).toContain(`>${chip}</button>`);
    expect(out).toContain("+ New rate");
    expect(out).toContain("Rewinding");
    expect(out).not.toContain("Dynamic Pricing");
    expect(out).not.toContain("items</span>");
  });

  it("shows Dynamic Pricing as one link row when that module is on, alone when there is no rate card", () => {
    const both = html(createElement(PricingClient, { initialItems: items, rateCard: true, engine: true }));
    expect(both).toContain("Dynamic Pricing");
    expect(both).toContain('href="/pricing/setup"');
    const engineOnly = html(createElement(PricingClient, { initialItems: [], rateCard: false, engine: true }));
    expect(engineOnly).toContain("Open Pricing setup");
    expect(engineOnly).not.toContain("<table");
    expect(engineOnly).not.toContain("+ New rate");
  });

  it("says what to do on an empty rate card", () => {
    expect(html(createElement(PricingClient, { initialItems: [], rateCard: true, engine: false }))).toContain("No rates yet");
  });

  it("keeps its explanations behind the i", () => {
    for (const [key, text] of Object.entries(PRICING_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
  });
});

describe("PC and 375 px", () => {
  const css = readFileSync(join(process.cwd(), "src/app/(app)/settings/pricing/pricing.module.css"), "utf8");
  it("has 44 px chips and buttons on a phone", () => {
    expect(css).toMatch(/@media \(max-width: 780px\)[\s\S]*\.chip \{ min-height: 44px/);
    expect(css).toMatch(/@media \(max-width: 780px\)[\s\S]*\.bpm-btn\) \{ min-height: 44px/);
  });
});
