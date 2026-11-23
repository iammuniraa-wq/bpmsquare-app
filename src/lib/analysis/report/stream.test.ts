import { describe, expect, it } from "vitest";
import { parseBriefLine, splitBriefChunk } from "./stream";

// How the dock reads POST /api/ai/report/run: one JSON object per line; half lines wait; junk is ignored, never trusted.

describe("a line", () => {
  it("a part change names one of the four parts and a state", () => {
    expect(parseBriefLine('{"type":"part","part":"people","state":"running"}')).toEqual({ type: "part", part: "people", state: "running" });
    expect(parseBriefLine('{"type":"part","part":"people","state":"missing"}')).toMatchObject({ state: "missing" });
  });
  it("a part or state outside the lists is dropped", () => {
    for (const l of ['{"type":"part","part":"gossip","state":"done"}', '{"type":"part","part":"people","state":"waiting"}', '{"type":"part"}']) expect(parseBriefLine(l), l).toBeNull();
  });
  it("the final line carries the answer and the card or the chip", () => {
    expect(parseBriefLine('{"type":"done","answer":"Here it is.","companyReport":{"key":"k"}}')).toEqual({ type: "done", answer: "Here it is.", companyReport: { key: "k" } });
    expect(parseBriefLine('{"type":"done","answer":"Ask first.","consent":{"kind":"research_report"}}')).toMatchObject({ consent: { kind: "research_report" } });
    expect(parseBriefLine('{"type":"done"}')).toEqual({ type: "done", answer: "" });
  });
  it("an error line always has words", () => {
    expect(parseBriefLine('{"type":"error","message":"It took too long."}')).toEqual({ type: "error", message: "It took too long." });
    expect(parseBriefLine('{"type":"error"}')).toEqual({ type: "error", message: "Something went wrong." });
  });
  it("anything that is not a known line is dropped", () => {
    for (const l of ["", "not json", "[]", "null", '{"type":"other"}', "42"]) expect(parseBriefLine(l), l).toBeNull();
  });
});

describe("chunks", () => {
  it("a line split across two chunks is read once it is whole", () => {
    const a = splitBriefChunk("", '{"type":"part","part":"fin');
    expect(a).toEqual({ lines: [], rest: '{"type":"part","part":"fin' });
    const b = splitBriefChunk(a.rest, 'ancials","state":"done"}\n{"type":"done","answer":"x"}\n');
    expect(b.lines).toHaveLength(2);
    expect(b.rest).toBe("");
    expect(parseBriefLine(b.lines[0])).toMatchObject({ part: "financials", state: "done" });
  });
  it("blank lines are skipped and the unfinished tail is kept", () => {
    expect(splitBriefChunk("", "\n\n{\"a\":1}\n{\"b\"")).toEqual({ lines: ['{"a":1}'], rest: '{"b"' });
  });
});
