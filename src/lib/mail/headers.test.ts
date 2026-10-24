import { describe, expect, it } from "vitest";
import { FETCHED_HEADERS, parseHeaderBlock } from "./mailbox";

describe("parseHeaderBlock", () => {
  it("reads headers, unfolds continuations and lower-cases names", () => {
    const h = parseHeaderBlock("In-Reply-To: <a@x>\r\nReferences: <r1@x>\r\n <r2@x>\r\nAuto-Submitted: auto-replied\r\n\r\n");
    expect(h["in-reply-to"]).toBe("<a@x>");
    expect(h["references"]).toBe("<r1@x> <r2@x>");
    expect(h["auto-submitted"]).toBe("auto-replied");
  });
  it("keeps the first of a repeated header and ignores junk lines", () => {
    expect(parseHeaderBlock("Precedence: bulk\nPrecedence: list\nnot a header")).toEqual({ precedence: "bulk" });
    expect(parseHeaderBlock("")).toEqual({});
  });
  it("asks the server for the loop-guard and auto-reply headers", () => {
    for (const h of ["auto-submitted", "precedence", "x-bpmsquare-inbox", "references", "in-reply-to"]) expect(FETCHED_HEADERS).toContain(h);
  });
});
