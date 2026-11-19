import { describe, expect, it } from "vitest";
import { nameFromEmail, personLabel } from "./personName";

describe("a readable name for a person without a display name", () => {
  it("makes the part before the @ readable", () => {
    expect(nameFromEmail("sap.rashid@gmail.com")).toBe("Sap Rashid");
    expect(nameFromEmail("a_nasser-ali+tenders@kamco.test")).toBe("A Nasser Ali");
    expect(nameFromEmail("KHAN42@kamco.test")).toBe("Khan");
  });

  it("gives nothing when there is nothing to read", () => {
    expect(nameFromEmail(null)).toBeNull();
    expect(nameFromEmail("")).toBeNull();
    expect(nameFromEmail("12345@kamco.test")).toBeNull();
  });

  it("prefers the workspace's name, then the login's profile name, then the address, then the fallback; never a raw address", () => {
    const login = { email: "sap.rashid@gmail.com", user_metadata: { full_name: "Rashid S." } };
    expect(personLabel("A. Nasser", login, "A colleague")).toBe("A. Nasser");
    expect(personLabel(undefined, login, "A colleague")).toBe("Rashid S.");
    expect(personLabel("sap.rashid@gmail.com", { email: "sap.rashid@gmail.com" }, "A colleague")).toBe("Sap Rashid");
    expect(personLabel(undefined, { email: "sap.rashid@gmail.com", user_metadata: { full_name: "sap.rashid@gmail.com" } }, "A colleague")).toBe("Sap Rashid");
    expect(personLabel(undefined, null, "A colleague")).toBe("A colleague");
  });
});
