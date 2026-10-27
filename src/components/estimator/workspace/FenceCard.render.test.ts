import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/dynamic", () => ({ default: () => () => null }));

import FenceCard from "./FenceCard";
import { computeEstimate } from "@/lib/estimator/compute";
import { fenceViewOf } from "@/lib/estimator/fenceView";
import { CHAINLINK_FENCE_STARTER } from "@/lib/estimator/starterTemplates";

function view(params: Record<string, unknown>) {
  const r = computeEstimate(CHAINLINK_FENCE_STARTER, params);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  const v = fenceViewOf(r.model, CHAINLINK_FENCE_STARTER.inputs, r.params);
  if (!v) throw new Error("no view");
  return v;
}

describe("the fence card (plan)", () => {
  it("draws every post and the gates, and says what it shows", () => {
    const v = view({});
    const html = renderToString(createElement(FenceCard, { view: v, model: null, lines: [], rates: [], money: (n: number) => String(n) })).replace(/<!-- -->/g, "");
    expect(html).toContain("The fence");
    expect(html).toContain("<svg");
    expect(html.match(/<circle/g)!.length).toBe(v.geometry.total_posts);
    expect(html.match(/<rect/g)!.length).toBe(1 + v.gates.length);
    expect(html).toContain("all the way round");
    expect(html).toContain("m² of fabric");
    expect(html).toContain("4</b> corner posts");
    expect(html).toContain(">Plan<");
    expect(html).toContain(">3D<");
  });

  it("draws an open run as a line with end posts", () => {
    const v = view({ closed_perimeter: false, total_length_m: 90, gates_double_n: 0 });
    const html = renderToString(createElement(FenceCard, { view: v, model: null, lines: [], rates: [], money: (n: number) => String(n) })).replace(/<!-- -->/g, "");
    expect(html).toContain("<line");
    expect(html).toContain("straight run");
    expect(html).toContain("end posts");
    expect(html).not.toContain("corner posts");
  });
});
