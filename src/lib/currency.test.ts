import { describe, it, expect } from "vitest";
import { CURRENCIES, resolveCurrency, formatMoney, formatMoneyCompact, formatCompactNumber, moneyLabel, parseMoney } from "./currency";

const INR = CURRENCIES.INR;
const QAR = CURRENCIES.QAR;

describe("resolveCurrency", () => {
  it("defaults to INR when unset or unknown", () => {
    expect(resolveCurrency(null).code).toBe("INR");
    expect(resolveCurrency({}).code).toBe("INR");
    expect(resolveCurrency({ currency: "XXX" }).code).toBe("INR");
    expect(resolveCurrency({ currency: "QAR" }).code).toBe("QAR");
  });
});

describe("formatMoney keeps every existing tenant's output byte-identical", () => {
  it("matches the old inline helpers for INR", () => {
    const old0 = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
    const old2 = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
    const oldRaw = (n: number) => "₹" + n.toLocaleString("en-IN");
    for (const n of [0, 5, 999, 1500, 86500, 150000.5, 1234567.891, 10000000]) {
      expect(formatMoney(n, INR)).toBe(old0(n));
      expect(formatMoney(n, INR, { maximumFractionDigits: 2 })).toBe(old2(n));
      expect(formatMoney(n, INR, {})).toBe(oldRaw(n));
    }
  });
  it("formats QAR with an ISO prefix and western grouping", () => {
    expect(formatMoney(2690, QAR)).toBe("QAR 2,690");
    expect(formatMoney(812000, QAR)).toBe("QAR 812,000");
    expect(formatMoney(41.5, QAR, { minimumFractionDigits: 2, maximumFractionDigits: 2 })).toBe("QAR 41.50");
    expect(formatMoney(-1200, QAR)).toBe("-QAR 1,200");
    expect(formatMoney(-1200, INR)).toBe("-₹1,200");
  });
});

describe("compact", () => {
  it("lakh/crore for INR, K/M otherwise", () => {
    expect(formatMoneyCompact(450000, INR)).toBe("₹4.5L");
    expect(formatMoneyCompact(23000000, INR)).toBe("₹2.3Cr");
    expect(formatMoneyCompact(75000, INR)).toBe("₹75,000");
    expect(formatMoneyCompact(450000, QAR)).toBe("QAR 450.0K");
    expect(formatMoneyCompact(2300000, QAR, 2)).toBe("QAR 2.30M");
    expect(formatMoneyCompact(750, QAR)).toBe("QAR 750");
  });
  it("bare axis numbers match the old chart formatter for INR", () => {
    const old = (n: number) => {
      const abs = Math.abs(n);
      if (abs >= 10_000_000) return (n / 10_000_000).toFixed(abs >= 100_000_000 ? 0 : 1).replace(/\.0$/, "") + "Cr";
      if (abs >= 100_000) return (n / 100_000).toFixed(abs >= 1_000_000 ? 0 : 1).replace(/\.0$/, "") + "L";
      if (abs >= 1_000) return (n / 1_000).toFixed(abs >= 10_000 ? 0 : 1).replace(/\.0$/, "") + "K";
      return Math.round(n).toLocaleString("en-IN");
    };
    for (const n of [0, 850, 1500, 12000, 250000, 4500000, 23000000, 150000000]) expect(formatCompactNumber(n, INR)).toBe(old(n));
    expect(formatCompactNumber(2500000, QAR)).toBe("2.5M");
    expect(formatCompactNumber(12000, QAR)).toBe("12K");
  });
});

describe("labels and parsing", () => {
  it("moneyLabel", () => {
    expect(moneyLabel("Rate", INR)).toBe("Rate (₹)");
    expect(moneyLabel("Rate", QAR)).toBe("Rate (QAR)");
  });
  it("parseMoney strips any prefix and grouping", () => {
    expect(parseMoney("₹1,50,000")).toBe(150000);
    expect(parseMoney("QAR 2,690.50")).toBe(2690.5);
    expect(parseMoney("$ 1,200")).toBe(1200);
    expect(parseMoney("-450")).toBe(-450);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
  });
});
