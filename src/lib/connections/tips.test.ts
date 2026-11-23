import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { CONNECTION_TIPS, ENDPOINT_TIPS } from "./tips";

// bpmsquarecore 6b: every explanation sits behind an "i" and fits two sentences, 160 characters.
describe("the Connections and Endpoints tips", () => {
  for (const [key, text] of Object.entries({ ...CONNECTION_TIPS })) {
    it(`connection tip ${key} fits the limit`, () => expect(tipTextProblems(text)).toEqual([]));
  }
  for (const [key, text] of Object.entries({ ...ENDPOINT_TIPS })) {
    it(`endpoint tip ${key} fits the limit`, () => expect(tipTextProblems(text)).toEqual([]));
  }
});
