import { describe, expect, it } from "vitest";
import { intakeSchemaV2 } from "./aiIntake";

describe("the email-reading output schema stays simple enough for the model service", () => {
  it("has no union types, whatever the template (the service refuses more than a handful)", () => {
    const inputs = Array.from({ length: 30 }, (_, k) => ({ key: `n${k}`, label: `N ${k}`, type: "number" as const }));
    const json = JSON.stringify(intakeSchemaV2(inputs as never));
    expect(json).not.toContain("anyOf");
    expect(json).not.toContain('"type":"null"');
  });
});
