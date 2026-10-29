import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import DetailsSection from "./[id]/DetailsSection";
import { toBody, toDraft } from "@/components/estimator/templateDraft";
import { PIPES_FITTINGS_STARTER } from "@/lib/estimator/starterTemplatesPipes";
import { PRECAST_VILLA_STARTER } from "@/lib/estimator/starterTemplates";
import type { TemplateVisual } from "@/lib/estimator/types";

const clean = (h: string) => h.replace(/<!-- -->/g, "");
const base = { name: "T", description: null, trade: null, quote_granularity: "group" as const };
const pipes = (visual?: TemplateVisual) => toDraft({ ...base, geometry: null, inputs: PIPES_FITTINGS_STARTER.inputs, rates: PIPES_FITTINGS_STARTER.rates, rules: PIPES_FITTINGS_STARTER.rules, visual });
const html = (d: ReturnType<typeof pipes>, visualAvailable = true) => clean(renderToString(createElement(DetailsSection, { draft: d, onChange: () => {}, visualAvailable })));

describe("the Visual section of the template editor", () => {
  it("replaces the geometry card: a picture choice, and six selects when built from the inputs", () => {
    const out = html(pipes());
    expect(out).toContain("Visual");
    expect(out).not.toContain("Geometry module");
    for (const w of ["Built-in model", "Built from the inputs", "None", "Picture follows", "Length", "Width", "Height", "Run (a pipe, cable or fence)", "How many", "Area"]) expect(out, w).toContain(w);
  });

  it("prefills the selects from what the inputs suggest, and shows a saved mapping as it is", () => {
    expect(html(pipes())).toMatch(/<option value="length_m" selected/);
    const saved = html(pipes({ run: "length_m", count: "valves_n" }));
    expect(saved).toMatch(/<option value="valves_n" selected/);
    expect(saved).toMatch(/<option value="length_m" selected/);
  });

  it("shows the module picker, not the mapping, for a template that has a module", () => {
    const villa = toDraft({ ...base, geometry: "precast_villa", inputs: PRECAST_VILLA_STARTER.inputs, rates: PRECAST_VILLA_STARTER.rates, rules: PRECAST_VILLA_STARTER.rules });
    const out = html(villa);
    expect(out).toContain("Piece families");
    expect(out).not.toContain("Picture follows");
  });

  it("says the settings cannot be saved while the column is missing", () => {
    expect(html(pipes(), false)).toContain("database update");
    expect(html(pipes(), true)).not.toContain("database update");
  });

  it("keeps its explanations behind an i", () => {
    const out = html(pipes());
    expect(out).toContain("About picture follows");
    expect(out).toContain("About Picture");
  });
});

describe("the draft round trip", () => {
  it("carries a mapping into the body, and an untouched draft sends none (the picture is inferred)", () => {
    expect(toBody(pipes({ run: "length_m", count: "valves_n" })).visual).toEqual({ run: "length_m", count: "valves_n" });
    expect(toBody(pipes()).visual).toBeUndefined();
  });
  it("carries the switch-off, and drops the mapping when a module is chosen", () => {
    expect(toBody(pipes({ picture: "none" })).visual).toEqual({ picture: "none" });
    const withModule = { ...pipes({ run: "length_m" }), geometry: "precast_villa" };
    expect(toBody(withModule).visual).toBeUndefined();
  });
});
