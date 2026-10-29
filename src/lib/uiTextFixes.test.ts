import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { SEGMENT_FIELDS } from "@/lib/marketingSegmentation";
import { SETTINGS_MENU } from "@/lib/settingsMenu";
import { WORKFORCE_TIPS } from "@/app/(app)/settings/workforce/tips";
import { PEOPLE_TIPS } from "@/app/(app)/settings/people/tips";
import { EMPLOYEE_TIPS } from "@/app/(app)/employees/tips";
import { locationRequiredFor, selfieRequiredFor } from "@/lib/wfm/punchRules";
import { OLD_SETTINGS_ROUTES } from "@/lib/settingsFolded";

// Text that has to say what the product does. Each of these was a label or help text that contradicted the screen or the code.

const options = (key: string) => (SEGMENT_FIELDS.find((f) => f.key === key) as { options?: { value: string; label: string }[] }).options ?? [];

describe("words that match across screens", () => {
  it("the segmentation builder says Silent and Responding, with the stored values unchanged", () => {
    expect(options("buying_stage")).toContainEqual({ value: "quiet", label: "Silent" });
    expect(options("abm_progress")).toContainEqual({ value: "engaged", label: "Responding" });
  });
});

describe("workforce help texts agree with the rules in code", () => {
  it("the location mandate text names breaks as blocked, as locationRequiredFor does", () => {
    expect(locationRequiredFor("break_start")).toBe(true);
    expect(WORKFORCE_TIPS.requireLocation).toMatch(/breaks/i);
    expect(WORKFORCE_TIPS.requireLocation).not.toMatch(/breaks and overtime are never blocked/i);
  });
  it("a selfie is required for breaks in the default mode, so the option label says breaks", () => {
    expect(selfieRequiredFor("break_start", "shift")).toBe(true);
  });
  it("the night shift text no longer claims the switch moves the hours to the start day", () => {
    expect(WORKFORCE_TIPS.shiftNight).not.toMatch(/day the shift began/i);
  });
  it("every tip stays within the InfoTip limit", () => {
    for (const [key, text] of Object.entries({ ...WORKFORCE_TIPS, page: PEOPLE_TIPS.page, employees: EMPLOYEE_TIPS.page })) expect(tipTextProblems(text), key).toEqual([]);
  });
});

describe("settings menu text is complete", () => {
  const desc = (id: string) => SETTINGS_MENU.find((m) => m.id === id)?.description ?? "";
  it("Connectors names every connector", () => {
    for (const name of ["Slack", "Google Calendar", "Gmail", "mail server", "Dynamics 365", "SAP S/4HANA", "ePROMIS"]) expect(desc("connectors")).toContain(name);
  });
  it("Contract projects names all six lists and Tenders the default markup", () => {
    for (const name of ["resource levels", "cost codes", "justification reasons", "reserve types", "divisions", "job locations"]) expect(desc("contract-projects").toLowerCase()).toContain(name);
    expect(desc("tenders")).toMatch(/markup/i);
  });
});

describe("the old employment-types address", () => {
  it("lands on the Rules tab, where employment types now sit", () => {
    expect(OLD_SETTINGS_ROUTES.workforceEmployment).toBe("/settings/workforce");
  });
});
