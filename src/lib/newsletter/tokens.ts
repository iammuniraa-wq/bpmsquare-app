import { escapeHtml } from "@/lib/emailTemplates";

// Per-recipient replacement of the tokens a rendered version keeps in place:
// {{account_name}} {{company_name}} {{contact_name}} (merge fields),
// {{unsubscribe_url}} {{preferences_url}} {{interest_url}} {{open_pixel_url}}
// and {{click_N}} (tracked links). One pass over the string, so a value that
// itself contains "{{...}}" is never expanded again, and any token that is not
// in the map is removed rather than shown to a customer.

const TOKEN = /\{\{(\w+)\}\}/g;

export type TokenValues = Record<string, string | null | undefined>;

/** `html: true` HTML-escapes every value (an account name is free text any tenant user can set). */
export function fillTokens(template: string, values: TokenValues, opts: { html: boolean }): string {
  return template.replace(TOKEN, (_m, key: string) => {
    const v = values[key];
    if (v === null || v === undefined) return "";
    return opts.html ? escapeHtml(v) : v;
  });
}

/** The merge-field tokens a text mentions that the renderer does not know, for the checks. */
export function unknownTokens(text: string, known: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(TOKEN)) if (!known.has(m[1])) out.add(m[1]);
  return [...out];
}

export const SAMPLE_MERGE: TokenValues = {
  account_name: "Qatar Steel Fabrication WLL",
  contact_name: "Ahmed",
  company_name: "Your company",
};
