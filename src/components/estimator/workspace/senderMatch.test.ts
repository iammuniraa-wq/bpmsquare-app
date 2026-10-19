import { describe, it, expect } from "vitest";
import { matchSender, senderAccountName } from "./senderMatch";

const accounts = [{ id: "a1", name: "Al-Rashid Trading Co." }, { id: "a2", name: "Omar Hassan" }];
const contacts = [{ id: "c1", name: "Khalid Al-Rashid", account_id: "a1" }, { id: "c2", name: "Khalid Al-Rashid", account_id: "a9" }];

describe("senderAccountName", () => {
  it("uses the company, else the person", () => {
    expect(senderAccountName({ company: "Acme", contact_name: "Sam", email: null, phone: null })).toBe("Acme");
    expect(senderAccountName({ company: null, contact_name: "Sam", email: null, phone: null })).toBe("Sam");
    expect(senderAccountName({ company: null, contact_name: null, email: "a@b.co", phone: null })).toBeNull();
  });
});

describe("matchSender", () => {
  it("finds the account and its contact, ignoring case and punctuation", () => {
    const m = matchSender({ company: "al rashid trading co", contact_name: "khalid al-rashid", email: null, phone: null }, accounts, contacts);
    expect(m.account?.id).toBe("a1");
    expect(m.contact?.id).toBe("c1");
  });
  it("finds an individual customer by the person's name", () => {
    expect(matchSender({ company: null, contact_name: "Omar Hassan", email: null, phone: null }, accounts, contacts).account?.id).toBe("a2");
  });
  it("never takes a contact from another account", () => {
    const m = matchSender({ company: "Omar Hassan", contact_name: "Khalid Al-Rashid", email: null, phone: null }, accounts, contacts);
    expect(m.account?.id).toBe("a2");
    expect(m.contact).toBeNull();
  });
  it("finds nothing for a stranger", () => {
    const m = matchSender({ company: "New Builders", contact_name: "Fatima", email: null, phone: null }, accounts, contacts);
    expect(m).toEqual({ account: null, contact: null });
  });
});
