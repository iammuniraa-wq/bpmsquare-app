import { describe, it, expect } from "vitest";
import {
  DEFAULT_MONTHLY_TOKEN_BUDGET, resolveMonthlyBudget, monthStartIso, evaluateAllowance, sumTokens,
} from "./usageCap";
import { resolveMaxMessages, messageAllowed, DEFAULT_MAX_MESSAGES_PER_STUDY, resolveBudget } from "@/lib/studio/caps";

describe("monthly token allowance", () => {
  it("uses the default when nothing sensible is configured", () => {
    expect(resolveMonthlyBudget(undefined)).toBe(DEFAULT_MONTHLY_TOKEN_BUDGET);
    expect(resolveMonthlyBudget("lots")).toBe(DEFAULT_MONTHLY_TOKEN_BUDGET);
    expect(resolveMonthlyBudget(-5)).toBe(DEFAULT_MONTHLY_TOKEN_BUDGET);
    expect(resolveMonthlyBudget(Number.NaN)).toBe(DEFAULT_MONTHLY_TOKEN_BUDGET);
  });

  it("honours a platform admin's figure, including 0 for no AI", () => {
    expect(resolveMonthlyBudget(250000)).toBe(250000);
    expect(resolveMonthlyBudget(0)).toBe(0);
    expect(resolveBudget({ monthly_token_budget: 40000 })).toBe(40000);
    expect(resolveBudget(undefined)).toBe(DEFAULT_MONTHLY_TOKEN_BUDGET);
  });

  it("stops a call once the month's tokens reach the budget", () => {
    expect(evaluateAllowance(0, 1000)).toEqual({ allowed: true, used: 0, budget: 1000, remaining: 1000 });
    expect(evaluateAllowance(999, 1000).allowed).toBe(true);
    expect(evaluateAllowance(1000, 1000).allowed).toBe(false);
    expect(evaluateAllowance(5000, 1000)).toMatchObject({ allowed: false, remaining: 0 });
    expect(evaluateAllowance(0, 0).allowed).toBe(false);
  });

  it("adds input and output tokens, tolerating nulls", () => {
    expect(sumTokens([{ input_tokens: 100, output_tokens: 50 }, { input_tokens: null, output_tokens: 7 }])).toBe(157);
    expect(sumTokens([])).toBe(0);
  });

  it("measures the month from the first of the month, UTC", () => {
    expect(monthStartIso(new Date(Date.UTC(2026, 9, 19, 13, 5)))).toBe("2026-10-01T00:00:00.000Z");
    expect(monthStartIso(new Date(Date.UTC(2026, 0, 31, 23, 59)))).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("messages per study", () => {
  it("defaults to 40 and accepts a sensible override", () => {
    expect(resolveMaxMessages(undefined)).toBe(DEFAULT_MAX_MESSAGES_PER_STUDY);
    expect(DEFAULT_MAX_MESSAGES_PER_STUDY).toBe(40);
    expect(resolveMaxMessages({ max_messages_per_study: 12 })).toBe(12);
    expect(resolveMaxMessages({ max_messages_per_study: 0 })).toBe(40);
    expect(resolveMaxMessages({ max_messages_per_study: 99999 })).toBe(40);
  });

  it("allows messages until the cap is reached", () => {
    expect(messageAllowed(39, 40)).toBe(true);
    expect(messageAllowed(40, 40)).toBe(false);
  });
});
