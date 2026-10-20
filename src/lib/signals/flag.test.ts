import { describe, expect, it } from "vitest";
import { signalsEnabled } from "./flag";
import { OBJECT_FEATURE } from "@/lib/objectFeatures";
import { FEATURE_DEPENDENCIES } from "@/lib/moduleDependencies";

describe("the buying_signals flag", () => {
  it("is off unless the workspace owns Marketing AND the platform-admin flag", () => {
    expect(signalsEnabled(undefined)).toBe(false);
    expect(signalsEnabled(null)).toBe(false);
    expect(signalsEnabled({})).toBe(false);
    expect(signalsEnabled({ marketing: true })).toBe(false);
    expect(signalsEnabled({ buying_signals: true })).toBe(false);
    expect(signalsEnabled({ marketing: true, buying_signals: true })).toBe(true);
  });

  it("owns its three objects in the one map that says which module owns which object", () => {
    expect(OBJECT_FEATURE.signals).toBe("buying_signals");
    expect(OBJECT_FEATURE.account_intent).toBe("buying_signals");
    expect(OBJECT_FEATURE.signal_topics).toBe("buying_signals");
  });

  it("needs Marketing", () => {
    expect(FEATURE_DEPENDENCIES.some((d) => d.key === "buying_signals" && d.needs === "marketing" && d.strength === "hard")).toBe(true);
  });
});
