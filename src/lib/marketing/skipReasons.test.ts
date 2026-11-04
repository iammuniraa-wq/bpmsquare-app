import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { ALL_SKIP_CODES, recipientStatusLabel, skipReason } from "./skipReasons";

describe("skip reasons", () => {
  it("every reason is one short plain sentence", () => {
    for (const code of ALL_SKIP_CODES) {
      const r = skipReason(code, { accountId: "a1", contactId: "c1", email: "x@y.com" });
      expect(tipTextProblems(r.why), code).toEqual([]);
      expect(r.label.length).toBeGreaterThan(0);
    }
  });

  it("accepts a recorded status as well as a reason code", () => {
    expect(skipReason("skipped_no_email").code).toBe("no_email");
    expect(skipReason("skipped_opt_out").code).toBe("account_opted_out");
    expect(skipReason("skipped_no_consent").code).toBe("no_consent");
    expect(skipReason("skipped_no_contact").code).toBe("no_contact");
  });

  it("links an address that is not a contact to a create form with the address filled in", () => {
    const r = skipReason("no_contact", { email: "a+b@example.com" });
    expect(r.fix?.href).toBe("/contacts/new?email=a%2Bb%40example.com");
    expect(r.fix?.label).toBe("Create contact");
  });

  it("links to the account or contact that can fix it, and to Consent settings when there is none", () => {
    expect(skipReason("no_email", { accountId: "a1" }).fix?.href).toBe("/accounts/a1");
    expect(skipReason("bounced", { contactId: "c1" }).fix?.href).toBe("/contacts/c1");
    expect(skipReason("no_consent", { contactId: "c1" }).fix?.href).toBe("/contacts/c1");
    expect(skipReason("no_consent").fix?.href).toBe("/settings/marketing-consent");
  });

  it("never says 'Skipped' in a label", () => {
    expect(recipientStatusLabel("skipped_no_email")).toBe("No email address");
    expect(recipientStatusLabel("sent")).toBe("Sent");
  });
});
