import { describe, it, expect } from "vitest";
import { checkEmailAddress, parseAddress, type DnsLike } from "./addressCheck";

const enodata = () => Object.assign(new Error("no data"), { code: "ENODATA" });

function dns(opts: { mx?: { exchange: string; priority: number }[] | "none" | "error"; a?: Record<string, string[]> }): DnsLike & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    resolveMx: async (d) => {
      asked.push(`mx:${d}`);
      if (opts.mx === "none" || opts.mx === undefined) throw enodata();
      if (opts.mx === "error") throw Object.assign(new Error("timeout"), { code: "ETIMEOUT" });
      return opts.mx;
    },
    resolve4: async (h) => { asked.push(`a:${h}`); const v = opts.a?.[h]; if (!v) throw enodata(); return v; },
    resolve6: async (h) => { asked.push(`aaaa:${h}`); throw enodata(); },
  };
}

describe("parseAddress -- shape only", () => {
  it("accepts an ordinary address and an international domain", () => {
    expect(parseAddress("Buyer@Example.com")).toEqual({ ok: true, domain: "example.com" });
    expect(parseAddress("a@bücher.example.de")).toMatchObject({ ok: true });
  });
  it.each([
    ["", "no email"],
    ["no-at-sign", "@"],
    ["two@@ats.com", "@"],
    ["sp ace@x.com", "space"],
    ["a@localhost", "internal"],
    ["a@printer.local", "internal"],
    ["a@10.0.0.1", "numeric"],
    ["a@[127.0.0.1]", "numeric"],
    ["a@nodot", "dot"],
    [".a@x.com", "dot"],
    ["a@x.c", "ending"],
  ])("refuses %s", (v) => {
    expect(parseAddress(v).ok).toBe(false);
  });
});

describe("checkEmailAddress -- DNS only", () => {
  it("passes a domain with a public mail server", async () => {
    const r = await checkEmailAddress("a@company.com", dns({ mx: [{ exchange: "mail.company.com", priority: 10 }], a: { "mail.company.com": ["93.184.216.34"] } }));
    expect(r.ok).toBe(true);
  });

  it("falls back to the domain's own address when it has no MX record", async () => {
    const r = await checkEmailAddress("a@company.com", dns({ mx: "none", a: { "company.com": ["93.184.216.34"] } }));
    expect(r.ok).toBe(true);
  });

  it("refuses a domain whose mail servers are on a private or loopback network, and never looks further", async () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "192.168.0.5", "169.254.169.254", "172.16.0.9"]) {
      const d = dns({ mx: [{ exchange: "mx.evil.com", priority: 1 }], a: { "mx.evil.com": [ip] } });
      const r = await checkEmailAddress("a@evil.com", d);
      expect(r.ok, ip).toBe(false);
      if (!r.ok) expect(r.reason).toContain("private");
    }
  });

  it("refuses a mail server that is an internal name or an IP literal", async () => {
    expect((await checkEmailAddress("a@evil.com", dns({ mx: [{ exchange: "mail.internal", priority: 1 }] }))).ok).toBe(false);
    expect((await checkEmailAddress("a@evil.com", dns({ mx: [{ exchange: "127.0.0.1", priority: 1 }] }))).ok).toBe(false);
  });

  it("is not fooled by one public server beside private ones only when a public one really exists", async () => {
    const mixed = dns({ mx: [{ exchange: "in.evil.com", priority: 1 }, { exchange: "mx.good.com", priority: 5 }], a: { "in.evil.com": ["10.0.0.1"], "mx.good.com": ["93.184.216.34"] } });
    expect((await checkEmailAddress("a@evil.com", mixed)).ok).toBe(true);
  });

  it("refuses a domain that does not exist, and one that says it takes no mail", async () => {
    expect((await checkEmailAddress("a@nope.example.org", dns({ mx: "none" }))).ok).toBe(false);
    const nullMx = await checkEmailAddress("a@nomail.com", dns({ mx: [{ exchange: "", priority: 0 }] }));
    expect(nullMx.ok).toBe(false);
  });

  it("does not call a lookup failure an invalid address", async () => {
    const r = await checkEmailAddress("a@company.com", dns({ mx: "error" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("Try again");
  });

  it("does not look anything up for an address that is wrong in shape", async () => {
    const d = dns({});
    await checkEmailAddress("a@localhost", d);
    expect(d.asked).toEqual([]);
  });
});
