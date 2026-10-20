import "server-only";
import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import { isPrivateAddress } from "@/lib/net/safeHost";

// "Check this address": is it written like an address, and can its domain receive
// mail? Only DNS is used (the domain's MX records, or its address records when it
// has none, as mail delivery itself does). No mail server is contacted, no message
// is sent and no third-party service is asked -- so this proves the domain, not the
// mailbox. A real delivery or bounce is the only proof of the mailbox.
//
// A domain whose mail servers point at a private, loopback or link-local network is
// refused: our servers are never made to look at, or be steered towards, an internal
// address by something a user typed.

export type CheckResult = { ok: true; message: string } | { ok: false; reason: string };

export type DnsLike = {
  resolveMx(domain: string): Promise<{ exchange: string; priority: number }[]>;
  resolve4(host: string): Promise<string[]>;
  resolve6(host: string): Promise<string[]>;
};

const TIMEOUT_MS = 5000;

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error("DNS timeout"), { code: "ETIMEOUT" })), TIMEOUT_MS);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export function nodeDns(): DnsLike {
  const r = new Resolver({ timeout: TIMEOUT_MS, tries: 2 });
  return {
    resolveMx: (d) => withTimeout(r.resolveMx(d)),
    resolve4: (h) => withTimeout(r.resolve4(h)),
    resolve6: (h) => withTimeout(r.resolve6(h)),
  };
}

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const RESERVED_SUFFIX = [".local", ".localhost", ".internal", ".lan", ".home", ".corp", ".intranet", ".test", ".invalid", ".example"];

/** Splits and validates the shape only. Returns the lower-cased domain, or the plain reason it is wrong. */
export function parseAddress(raw: string | null | undefined): { ok: true; domain: string } | { ok: false; reason: string } {
  const v = (raw ?? "").normalize("NFKC").trim().toLowerCase();
  if (!v) return { ok: false, reason: "There is no email address." };
  if (v.length > 254) return { ok: false, reason: "The address is too long." };
  if (/\s/.test(v)) return { ok: false, reason: "The address has a space in it." };
  const at = v.lastIndexOf("@");
  if (at < 1 || v.indexOf("@") !== at) return { ok: false, reason: "The address needs exactly one @ with a name before it." };
  const local = v.slice(0, at);
  // An internationalised domain is checked in its ASCII (xn--) form, which is what DNS holds.
  const domain = domainToASCII(v.slice(at + 1)) || v.slice(at + 1);
  if (local.length > 64) return { ok: false, reason: "The part before the @ is too long." };
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return { ok: false, reason: "The part before the @ has a misplaced dot." };
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return { ok: false, reason: "The part before the @ has a character an email address cannot have." };
  if (!domain) return { ok: false, reason: "The part after the @ is missing." };
  if (domain.startsWith("[") || isIP(domain)) return { ok: false, reason: "The address uses a numeric address instead of a domain name." };
  if (domain === "localhost" || RESERVED_SUFFIX.some((s) => domain.endsWith(s))) return { ok: false, reason: "That domain is for internal or test use and cannot receive real mail." };
  const labels = domain.split(".");
  if (labels.length < 2) return { ok: false, reason: "The domain needs a dot, like company.com." };
  if (!labels.every((l) => LABEL.test(l))) return { ok: false, reason: "The domain has a character a domain name cannot have." };
  if (!/^[a-z]{2,}$|^xn--[a-z0-9-]+$/.test(labels[labels.length - 1])) return { ok: false, reason: "The ending of the domain (like .com) does not look right." };
  return { ok: true, domain };
}

const noRecords = (e: unknown): boolean => {
  const code = (e as { code?: string } | null)?.code;
  return code === "ENODATA" || code === "ENOTFOUND" || code === "NXDOMAIN" || code === "ENOENT";
};

async function addressesOf(dns: DnsLike, host: string): Promise<string[]> {
  const out: string[] = [];
  for (const f of [dns.resolve4, dns.resolve6]) {
    try { out.push(...(await f.call(dns, host))); } catch (e) { if (!noRecords(e)) throw e; }
  }
  return out;
}

export async function checkEmailAddress(raw: string | null | undefined, dns: DnsLike = nodeDns()): Promise<CheckResult> {
  const parsed = parseAddress(raw);
  if (!parsed.ok) return parsed;
  const { domain } = parsed;

  let mx: { exchange: string; priority: number }[] = [];
  try {
    mx = await dns.resolveMx(domain);
  } catch (e) {
    if (!noRecords(e)) return { ok: false, reason: "We could not look up this domain right now. Try again in a few minutes." };
  }

  // No MX records: mail falls back to the domain's own address records.
  const hosts = mx.length > 0 ? [...mx].sort((a, b) => a.priority - b.priority).slice(0, 5).map((m) => m.exchange.replace(/\.$/, "").toLowerCase()) : [domain];

  // "Null MX" (RFC 7505): the domain states it takes no mail.
  if (mx.length === 1 && (mx[0].exchange === "" || mx[0].exchange === ".")) return { ok: false, reason: "This domain says it does not accept email." };

  let usable = 0;
  let privateSeen = false;
  for (const host of hosts) {
    if (!host || host === "localhost" || RESERVED_SUFFIX.some((s) => host.endsWith(s))) { privateSeen = true; continue; }
    if (isIP(host)) { if (isPrivateAddress(host)) privateSeen = true; else usable++; continue; }
    let addrs: string[];
    try { addrs = await addressesOf(dns, host); } catch { return { ok: false, reason: "We could not look up this domain right now. Try again in a few minutes." }; }
    if (addrs.length === 0) continue;
    if (addrs.some((a) => isPrivateAddress(a))) { privateSeen = true; continue; }
    usable++;
  }

  if (usable > 0) {
    return { ok: true, message: "The address looks right and its domain can receive email. Only a real delivery can prove the mailbox itself exists." };
  }
  if (privateSeen) return { ok: false, reason: "This domain's mail servers are on a private or internal network, so it cannot receive real email." };
  return { ok: false, reason: mx.length > 0 ? "This domain's mail servers could not be found." : "This domain does not exist or has no way to receive email." };
}
