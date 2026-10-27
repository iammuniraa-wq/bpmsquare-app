import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import InputsForm, { initialValues } from "./InputsForm";
import { VisualPicker } from "./VisualPicker";
import { CHAINLINK_FENCE_STARTER } from "@/lib/estimator/starterTemplates";
import type { TemplateInput } from "@/lib/estimator/types";

const html = (inputs: TemplateInput[]) =>
  renderToString(createElement(InputsForm, { inputs, values: initialValues(inputs), onChange: () => {} })).replace(/<!-- -->/g, "");

describe("InputsForm: design attributes", () => {
  it("shows a choice that paints the model as swatch chips (a radio group), the others as a plain select", () => {
    const out = html(CHAINLINK_FENCE_STARTER.inputs.filter((i) => ["mesh_colour", "mesh"].includes(i.key)));
    expect(out).toContain('role="radiogroup"');
    expect(out.match(/type="radio"/g)!.length).toBe(4);
    expect(out).toContain("Green PVC");
    expect(out).toContain("background:#2f6b45");
    expect(out.match(/<select/g)!.length).toBe(1);
  });

  it("marks the chosen chip checked", () => {
    const out = html(CHAINLINK_FENCE_STARTER.inputs.filter((i) => i.key === "mesh_colour"));
    const checked = out.match(/<input[^>]*checked[^>]*>/g) ?? [];
    expect(checked).toHaveLength(1);
    expect(checked[0]).toContain('value="green"');
  });

  it("keeps a choice with a paints slot but no visuals as an ordinary select", () => {
    const plain: TemplateInput = { key: "k", label: "K", type: "select", default: "a", paints: "mesh", options: [{ key: "a", label: "A", value: 1 }] };
    expect(html([plain])).not.toContain("radiogroup");
  });
});

describe("VisualPicker", () => {
  it("renders a closed swatch button that names the current look", () => {
    const out = renderToString(createElement(VisualPicker, { value: "pvc_black", label: "Black", onChange: () => {} }));
    expect(out).toContain("Black: Black PVC coating. Change");
    expect(out).not.toContain('role="dialog"');
  });
});
