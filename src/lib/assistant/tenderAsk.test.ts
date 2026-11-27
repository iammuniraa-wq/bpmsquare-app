import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WHICH_TENDER, parseTenderAsk, parseWhichTenderAnswer } from "./tenderAsk";
import { linesNamed, namesLines } from "./lineWords";
import { keepTypedName } from "./typedName";
import { ActivityRow } from "@/components/page/RecordActivity";

describe("the plain tender instructions", () => {
  it.each([
    ["Match the BOQ to products.", { verb: "match" }],
    ["please match the bill of quantities to the product catalogue", { verb: "match" }],
    ["Price all lines with 12 percent markup.", { verb: "price", markupPct: "12" }],
    ["Price all BOQ lines at a markup of 7.5%", { verb: "price", markupPct: "7.5" }],
    ["Price the BOQ on OPP-0034", { verb: "price", deal: "OPP-0034" }],
    ["Can you price all the lines on this tender?", { verb: "price" }],
    ["Raise an RFQ to Tihama Geosynthetics and Arkan Waterproofing Systems for the geotextile lines.", { verb: "rfq", suppliers: "Tihama Geosynthetics and Arkan Waterproofing Systems", lines: "the geotextile lines" }],
    ["Create an RFQ for the geotextile lines to Tihama", { verb: "rfq", suppliers: "Tihama", lines: "the geotextile lines" }],
    ["Raise an RFQ to Tihama for the unpriced lines", { verb: "rfq", suppliers: "Tihama" }],
    ["Award the geotextile line to Tihama", { verb: "award", lines: "geotextile", supplier: "Tihama", mode: "single" }],
    ["Award line 2 on RFQ-0014 to Beta Trading", { verb: "award", lines: "2", supplier: "Beta Trading", mode: "single", rfq: "RFQ-0014" }],
    ["Award the geotextile lines to the cheapest supplier", { verb: "award", lines: "geotextile", supplier: "", mode: "split" }],
  ])("%s", (sentence, want) => {
    expect(parseTenderAsk(sentence)).toEqual(want);
  });

  it.each([
    "How do I match the BOQ to products?", "Which lines are priced?", "Price the geotextile line at 40", "Price this line", "Show me the BOQ", "Open the bill of quantities",
    "Raise an RFQ to Tihama and ask them to reply by Sunday", "Raise an RFQ", "Award RFQ-0014 to Beta Trading", "Propose awarding RFQ-0014 to Alpha Supply.",
    "Award the geotextile line to Tihama with 12 percent markup", "Did we award the geotextile line to Tihama?", "match the BOQ to products and then price it",
  ])("leaves '%s' to the model", (sentence) => {
    expect(parseTenderAsk(sentence)).toBeNull();
  });

  it("a reference typed after 'which tender' completes the instruction asked before it, and nothing else does", () => {
    const history = (answer: string) => [{ role: "user" as const, text: "Match the BOQ to products." }, { role: "assistant" as const, text: WHICH_TENDER }, { role: "user" as const, text: answer }];
    expect(parseWhichTenderAnswer(history("OPP-0034"))).toEqual({ verb: "match", deal: "OPP-0034" });
    expect(parseWhichTenderAnswer(history("what is OPP-0034 worth"))).toBeNull();
    expect(parseWhichTenderAnswer([{ role: "user", text: "OPP-0034" }])).toBeNull();
  });
});

describe("the lines the person named", () => {
  const lines = [{ description: "Non-woven geotextile 300 gsm", item: "1.2" }, { description: "HDPE geomembrane", item: "1.10" }, { description: "Mobilisation", item: "1" }];
  const found = (words: string) => linesNamed(lines, words).map((l) => l.item);
  it("by words, several groups, or item number", () => {
    expect(found("the geotextile lines")).toEqual(["1.2"]);
    expect(found("geotextile and geomembrane")).toEqual(["1.2", "1.10"]);
    expect(found("item 1")).toEqual(["1"]);
    expect(found("asphalt")).toEqual([]);
    expect(namesLines("the unpriced lines")).toBe(false);
  });
});

describe("a typed name is kept", () => {
  it("puts back the brackets that followed it, and changes nothing else", () => {
    expect(keepTypedName("Delta Contracting", ["Add Delta Contracting [qa] as a competitor"])).toBe("Delta Contracting [qa]");
    expect(keepTypedName("delta contracting", ["add Delta Contracting (KSA) [qa] please"])).toBe("Delta Contracting (KSA) [qa]");
    expect(keepTypedName("Delta Contracting [qa]", ["Add Delta Contracting [qa] as a competitor"])).toBe("Delta Contracting [qa]");
    expect(keepTypedName("Delta Contracting", ["Add Delta Contracting as a competitor"])).toBe("Delta Contracting");
    expect(keepTypedName("Echo", ["add the other one"])).toBe("Echo");
  });
});

describe("the record's own change history shows how a change was made", () => {
  const row = { id: "1", action: "update" as const, changes: [{ field: "competitor added", from: null, to: "Delta" }], actor_email: "me@kamco.test", actor_name: "S. Khan", created_at: "2026-11-26T09:00:00Z" };
  const draw = (via: string | null) => renderToStaticMarkup(createElement(ActivityRow, { r: { ...row, via }, first: true })).replace(/<!-- -->/g, "");
  it("says 'via assistant' beside the name, and nothing for a change made on a screen", () => {
    expect(draw("assistant")).toContain("S. Khan · via assistant · ");
    expect(draw(null)).not.toContain("via ");
  });
});
