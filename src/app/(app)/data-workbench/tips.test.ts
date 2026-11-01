import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { DW_CATALOG, DW_OBJECT_IDS } from "@/lib/import/catalog";
import { DW_TIPS } from "./tips";

// bpmsquarecore 6b: every explanation on a Data Workbench screen sits behind an "i" and is held to the InfoTip limit
// (two short sentences, 160 characters). The screens never print them as running text.

describe("the Data Workbench explanations", () => {
  it.each(Object.entries(DW_TIPS))("%s fits behind an i", (_key, text) => {
    expect(tipTextProblems(text)).toEqual([]);
  });

  it("every catalog note and mode note fits behind an i", () => {
    for (const id of DW_OBJECT_IDS) {
      const e = DW_CATALOG[id];
      if (e.note) expect(tipTextProblems(e.note), `${id}.note`).toEqual([]);
      for (const [mode, text] of Object.entries(e.modeNote ?? {})) expect(tipTextProblems(text), `${id}.modeNote.${mode}`).toEqual([]);
    }
  });
});
