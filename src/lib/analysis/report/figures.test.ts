import { describe, expect, it } from "vitest";
import {
  digitsOf, figureMatchesSnippets, formatEmployees, formatMoney, formatPercent, growthOf, marginOf, moneyStatus, parseAmount, parseCurrency, parseFiscalYear, parseUnit,
} from "./figures";
import type { Money } from "./types";

// The numbers of a brief: parsed as fields, checked as digits against a snippet, and derived by our code, never by the model.

const NOW = new Date("2026-11-23T00:00:00Z");
const m = (fiscalYear: number, amount: number, currency = "SAR"): Money => ({ fiscalYear, amount, currency, src: 1, matched: true });

describe("parsing", () => {
  it("units, in the forms pages and models write them", () => {
    expect(["million", "Mn", "m", "MM"].map(parseUnit)).toEqual(["million", "million", "million", "million"]);
    expect(["billion", "bn", "B"].map(parseUnit)).toEqual(["billion", "billion", "billion"]);
    expect([undefined, "", "units"].map(parseUnit)).toEqual(["units", "units", "units"]);
    expect(parseUnit("lakhs")).toBeNull();
    expect(parseUnit(5)).toBeNull();
  });

  it("an amount is a number or a plain digit string, never a sentence", () => {
    expect(parseAmount(2.84)).toBe(2.84);
    expect(parseAmount("2,840")).toBe(2840);
    expect(parseAmount("-12.5")).toBe(-12.5);
    for (const bad of ["about 2.84 billion", "SAR 5", "", "1e9", NaN, Infinity, null, {}]) expect(parseAmount(bad), String(bad)).toBeNull();
  });

  it("a currency is an ISO code and a fiscal year is a whole year within five years", () => {
    expect(parseCurrency("sar")).toBe("SAR");
    expect(parseCurrency("riyals")).toBeNull();
    expect(parseFiscalYear(2025, NOW)).toBe(2025);
    expect(parseFiscalYear("2024", NOW)).toBe(2024);
    expect(parseFiscalYear(2020, NOW)).toBeNull();
    expect(parseFiscalYear(2028, NOW)).toBeNull();
    expect(parseFiscalYear(2025.5, NOW)).toBeNull();
  });
});

describe("a figure's digits against what the page said", () => {
  it("separators, zeros and the unit do not matter", () => {
    expect(digitsOf("2,840.0")).toBe("284");
    expect(figureMatchesSnippets(2.84, ["Revenue was SAR 2.84 billion."])).toBe(true);
    expect(figureMatchesSnippets(2840, ["Revenue was SAR 2,840 million."])).toBe(true);
    expect(figureMatchesSnippets(186, ["Net profit of SAR 186 million"])).toBe(true);
  });
  it("a number that is not on the page is not matched, and no snippet is not a match", () => {
    expect(figureMatchesSnippets(3.1, ["Revenue was SAR 2.84 billion."])).toBe(false);
    expect(figureMatchesSnippets(2.84, [])).toBe(false);
    expect(figureMatchesSnippets(0, ["0"])).toBe(false);
  });
  it("any of the three snippets may carry it", () => {
    expect(figureMatchesSnippets(171, ["nothing here", "Net profit was 171 million in FY2024"])).toBe(true);
  });
});

describe("growth and margin come from our code", () => {
  it("growth is the latest year against the year before it, one decimal", () => {
    expect(growthOf([m(2025, 2.84e9), m(2024, 2.53e9), m(2023, 2.21e9)])).toMatchObject({ percent: 12.3 });
    expect(growthOf([m(2025, 100), m(2024, 200)])?.percent).toBe(-50);
  });
  it("needs consecutive years in one currency, and a positive base", () => {
    expect(growthOf([])).toBeNull();
    expect(growthOf([m(2025, 100)])).toBeNull();
    expect(growthOf([m(2025, 100), m(2023, 80)])).toBeNull();
    expect(growthOf([m(2025, 100), m(2024, 80, "USD")])).toBeNull();
    expect(growthOf([m(2025, 100), m(2024, 0)])).toBeNull();
  });
  it("margin is profit over revenue for the latest year that has both", () => {
    expect(marginOf({ revenue: [m(2025, 2.84e9), m(2024, 2.53e9)], profit: [m(2025, 186e6)] })).toMatchObject({ percent: 6.5, fiscalYear: 2025 });
    expect(marginOf({ revenue: [m(2024, 2.53e9)], profit: [m(2025, 186e6), m(2024, 171e6)] })).toMatchObject({ percent: 6.8, fiscalYear: 2024 });
    expect(marginOf({ revenue: [m(2024, 100)], profit: [m(2025, 5)] })).toBeNull();
    expect(marginOf({ revenue: [m(2025, 100)], profit: [m(2025, 5, "USD")] })).toBeNull();
  });
  it("status says what is published", () => {
    expect(moneyStatus({ revenue: [m(2025, 1)], profit: [m(2025, 1)] })).toBe("published");
    expect(moneyStatus({ revenue: [m(2025, 1)], profit: [] })).toBe("partial");
    expect(moneyStatus({ revenue: [], profit: [] })).toBe("not_published");
  });
});

describe("how a figure is written", () => {
  it("money in the units a reader uses", () => {
    expect(formatMoney(2_840_000_000, "SAR")).toBe("SAR 2.84 bn");
    expect(formatMoney(186_000_000, "SAR")).toBe("SAR 186 m");
    expect(formatMoney(6_100_000_000, "SAR")).toBe("SAR 6.1 bn");
    expect(formatMoney(410_000, "SAR")).toBe("SAR 410,000");
    expect(formatMoney(-5_000_000, "USD")).toBe("-USD 5 m");
  });
  it("percent and employees", () => {
    expect(formatPercent(12.34, true)).toBe("+12.3%");
    expect(formatPercent(-3)).toBe("-3%");
    expect(formatEmployees({ count: 4200, approx: true })).toBe("about 4,200");
    expect(formatEmployees({ count: 310, approx: false })).toBe("310");
    expect(formatEmployees({ count: 4000, upTo: 4500, approx: true })).toBe("4,000 to 4,500");
  });
});
