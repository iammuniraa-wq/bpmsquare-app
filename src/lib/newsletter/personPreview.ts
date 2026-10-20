import { safeUrl } from "./sanitize";
import { fillTokens, type TokenValues } from "./tokens";

// "See it as this person": the stored version's email for one language, with the tokens filled for
// one person. Pure. Nothing is sent and nothing is tracked: the click links show where they really
// go, and the unsubscribe, preferences and interest links point nowhere ("#").

export type VersionForPerson = {
  html: Record<string, string>;
  links: { url: string }[];
  snapshot: { languages: { lang: string; subject: string }[] };
};

export function renderForPerson(v: VersionForPerson, lang: string, person: { account_name: string; company_name: string; contact_name: string }): { subject: string; html: string } | null {
  const html = v.html[lang];
  const snap = v.snapshot.languages.find((l) => l.lang === lang);
  if (typeof html !== "string" || !snap) return null;
  const values: TokenValues = { ...person, unsubscribe_url: "#", preferences_url: "#", interest_url: "#", open_pixel_url: "" };
  v.links.forEach((l, i) => { values[`click_${i}`] = safeUrl(l.url) ?? "#"; });
  return { subject: fillTokens(snap.subject, values, { html: false }), html: fillTokens(html, values, { html: true }) };
}
