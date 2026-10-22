import { describe, expect, it } from "vitest";
import { consentReplyOf } from "./consentReply";

describe("a typed answer to a Yes / No question", () => {
  it("counts a bare yes or no", () => {
    for (const t of ["yes", "Yes!", "ok", "OK.", "okay", "sure", "go ahead", "Yes please"]) expect(consentReplyOf(t), t).toBe("yes");
    for (const t of ["no", "No.", "nope", "cancel", "not now", "don't"]) expect(consentReplyOf(t), t).toBe("no");
  });
  it("never counts a sentence, so a new question is a new question", () => {
    for (const t of ["yes and also create an account", "ok analyse siemens", "look up online", "", "   "]) expect(consentReplyOf(t), t).toBeNull();
  });
});
