import { describe, it, expect } from "vitest";
import { scheduleGap } from "./scheduleState";

const base = { hasLayout: true, saved: true, canEdit: true, locked: false };

describe("scheduleGap", () => {
  it("a template with no layout module has no schedule to calculate", () => {
    expect(scheduleGap({ ...base, hasLayout: false })).toBe("no_layout");
  });
  it("a saved, editable estimate whose model is missing is offered a Calculate", () => {
    expect(scheduleGap(base)).toBe("calculate");
  });
  it("a quoted estimate or a viewer cannot calculate", () => {
    expect(scheduleGap({ ...base, locked: true })).toBe("locked");
    expect(scheduleGap({ ...base, canEdit: false })).toBe("locked");
  });
  it("an unsaved estimate is told to fill in the details", () => {
    expect(scheduleGap({ ...base, saved: false })).toBe("unsaved");
  });
});
