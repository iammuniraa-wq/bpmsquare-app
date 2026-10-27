import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { INBOX_TIPS } from "./tips";

// bpmsquarecore 6b: every explanation sits behind an "i" and fits two sentences, 160 characters.
describe("the Inbox tips", () => {
  for (const [key, text] of Object.entries(INBOX_TIPS)) {
    it(`${key} fits the limit`, () => expect(tipTextProblems(text)).toEqual([]));
  }
});
