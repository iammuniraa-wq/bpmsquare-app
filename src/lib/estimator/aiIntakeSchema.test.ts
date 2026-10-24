import { describe, expect, it } from "vitest";
import { clampIntakeV2, intakeSchemaV2 } from "./aiIntake";

describe("the email-reading output schema stays simple enough for the model service", () => {
  it("has no union types, whatever the template (the service refuses more than a handful)", () => {
    const inputs = Array.from({ length: 30 }, (_, k) => ({ key: `n${k}`, label: `N ${k}`, type: "number" as const }));
    const json = JSON.stringify(intakeSchemaV2(inputs as never));
    expect(json).not.toContain("anyOf");
    expect(json).not.toContain('"type":"null"');
  });
});

describe("the answer list", () => {
  const inputs = [
    { key: "length_m", label: "Length", type: "number" as const, default: 10, min: 1, max: 5000 },
    { key: "closed", label: "Closed", type: "boolean" as const, default: false },
    { key: "mesh", label: "Mesh", type: "select" as const, default: "a", options: [{ key: "a", label: "A", value: 1 }, { key: "b", label: "B", value: 2 }] },
  ];
  it("does not grow with the number of inputs beyond the key list", () => {
    const small = JSON.stringify(intakeSchemaV2(inputs as never)).length;
    const big = JSON.stringify(intakeSchemaV2([...inputs, ...Array.from({ length: 30 }, (_, k) => ({ key: `n${k}`, label: "x", type: "number" as const, default: 0 }))] as never)).length;
    expect(big - small).toBeLessThan(600);
  });
  it("reads the number, the yes/no and the choice from the right field, and ignores a missing one", () => {
    const p = clampIntakeV2(inputs as never, {
      name: "Yard", sender: {}, assumptions: [],
      answers: [
        { key: "length_m", status: "found", number: 320, choice: "", yes: false, source: "320 m" },
        { key: "closed", status: "likely", number: 0, choice: "", yes: true, source: "around our new yard" },
        { key: "mesh", status: "missing", number: 0, choice: "", yes: false, source: "" },
      ],
    }, "about 320 m of fence around our new yard");
    expect(p.values).toEqual({ length_m: 320, closed: true });
    expect(p.fields?.length_m?.status).toBe("found");
    expect(p.fields?.mesh?.status).toBe("missing");
  });
});
