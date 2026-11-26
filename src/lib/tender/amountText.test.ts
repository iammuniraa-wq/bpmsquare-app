import { describe, expect, it } from "vitest";
import { amountText, amountValue } from "./amountText";

describe("an amount on the tender screens", () => {
  it("has thousands separators and never a single stray decimal", () => {
    expect(amountText(15790416.1)).toBe("15,790,416.10");
    expect(amountText(15790416)).toBe("15,790,416");
    expect(amountText(1234.5678)).toBe("1,234.57");
    expect(amountText(0)).toBe("0");
  });

  it("starts an input from the plain number with two decimals when there are cents", () => {
    expect(amountValue(15790416.1)).toBe("15790416.10");
    expect(amountValue(250000)).toBe("250000");
    expect(amountValue(99.999)).toBe("100");
  });

  it("says nothing for a missing or broken amount", () => {
    expect(amountText(null)).toBe("");
    expect(amountText(undefined)).toBe("");
    expect(amountText(Number.NaN)).toBe("");
    expect(amountValue(null)).toBe("");
  });
});
