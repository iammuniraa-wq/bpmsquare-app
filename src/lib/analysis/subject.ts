import { companyKey, normaliseDomain } from "./companyKey";
import { cleanText } from "./validate";

// The only things that may describe a company to the web: its name, website domain, city, country and industry
// (docs/design/account-analysis.md section 7). Everything else about an account stays in the workspace. Pure.

export type Subject = {
  name: string;
  domain: string | null;
  city: string | null;
  country: string | null;
  industry: string | null;
};

const MAX = { name: 120, place: 60, industry: 80 };

const clip = (v: unknown, max: number): string | null => {
  const t = cleanText(v).replace(/[`"\\{}[\]]/g, "");
  return t ? t.slice(0, max) : null;
};

/** A person's e-mail or phone number is not an organisation: refuse it before it can reach a search. */
export const looksPersonal = (t: string): boolean => t.includes("@") || /\d[\d\s().-]{6,}\d/.test(t);

export type SubjectInput = { name?: unknown; domain?: unknown; website?: unknown; city?: unknown; country?: unknown; industry?: unknown };

export function toSubject(i: SubjectInput): Subject | { error: string } {
  const domain = normaliseDomain(typeof i.domain === "string" ? i.domain : typeof i.website === "string" ? i.website : null);
  const name = clip(i.name, MAX.name) ?? (domain ? domain : null);
  if (!name) return { error: "Name the company or give its website." };
  if (looksPersonal(name)) return { error: "Company analysis is for organisations, not people." };
  return {
    name, domain, city: clip(i.city, MAX.place), country: clip(i.country, MAX.place), industry: clip(i.industry, MAX.industry),
  };
}

export const keyOfSubject = (s: Subject): string => companyKey({ domain: s.domain, name: s.name, country: s.country });
