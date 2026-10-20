import { SOURCE_LANGUAGE, isKnownLanguage } from "./types";

// Which language a recipient gets (docs/newsletter-studio-architecture.md 2.3).
// Order: the contact's preferred language, then the account's, then the
// campaign's fallback. Only languages the campaign includes are eligible; a
// preference for anything else falls to the fallback. A country -> language
// guess is deliberately NOT applied: a wrong guess in a customer's inbox costs
// more than a fallback.

export type LanguageChoice = { lang: string; via: "contact" | "account" | "fallback" };

const norm = (v: string | null | undefined): string | null => {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return /^[a-z]{2}$/.test(s) ? s : null;
};

export function resolveRecipientLanguage(input: {
  contactLanguage?: string | null;
  accountLanguage?: string | null;
  included: readonly string[];
  fallback?: string | null;
}): LanguageChoice {
  const included = new Set(input.included.map((l) => l.toLowerCase()));
  const c = norm(input.contactLanguage);
  if (c && included.has(c)) return { lang: c, via: "contact" };
  const a = norm(input.accountLanguage);
  if (a && included.has(a)) return { lang: a, via: "account" };
  const f = norm(input.fallback);
  if (f && included.has(f)) return { lang: f, via: "fallback" };
  // A fallback that was not ticked cannot be sent either; English is the last resort only when it is included.
  if (included.has(SOURCE_LANGUAGE)) return { lang: SOURCE_LANGUAGE, via: "fallback" };
  const first = [...included][0];
  return { lang: first ?? SOURCE_LANGUAGE, via: "fallback" };
}

/** Counts per language for the audience preview ("English 120 · Arabic 45"). */
export function countByLanguage(choices: readonly LanguageChoice[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of choices) out[c.lang] = (out[c.lang] ?? 0) + 1;
  return out;
}

/**
 * A preferred_language value from a request body: a two-letter code the studio can write in, or null to
 * clear it. undefined means "not provided, or not usable": the caller leaves the column alone.
 */
export function cleanPreferredLanguage(v: unknown): string | null | undefined {
  if (v === null || v === "") return null;
  const code = typeof v === "string" ? v.trim().toLowerCase() : "";
  return isKnownLanguage(code) ? code : undefined;
}
