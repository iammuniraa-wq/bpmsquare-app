import { contrastRatio, type ResolvedBrandKit } from "./brandKit";
import { pendingBlocks, isTenantAssetPath } from "./sanitize";
import { renderNewsletter } from "./render";
import { MERGE_TOKENS, TEXT_FIELDS, languageDef, type LanguageRow, type NewsletterBlock } from "./types";
import { unknownTokens } from "./tokens";

// "Check before sending" (docs/newsletter-studio-architecture.md section 2.4):
// rules that run every time, not opinions. Deterministic code, unit-tested --
// a pass/fail a person acts on is never an AI output (same doctrine as
// Account 360's rating). AI may later EXPLAIN an amber chip in plain words,
// never decide one.

export type Check = {
  id: string;
  tone: "good" | "warn";
  label: string;
  /** Language the check is about, when it is per language. */
  lang?: string;
};

export const SUBJECT_MAX = 60;
const MIN_TEXT_WITH_IMAGES = 150;

// A short list of words spam filters dislike. A starting list, not a verdict.
export const SPAM_WORDS = ["free money", "act now", "limited time", "100% free", "click here", "guarantee", "winner", "urgent", "cash bonus", "no obligation", "risk-free", "buy now"];

const KNOWN_TOKENS: ReadonlySet<string> = new Set([...MERGE_TOKENS]);

const langName = (code: string): string => languageDef(code)?.name ?? code;

function allText(row: Pick<LanguageRow, "subject" | "preheader" | "texts">): string {
  const parts = [row.subject, row.preheader];
  for (const fields of Object.values(row.texts)) for (const v of Object.values(fields)) parts.push(v);
  return parts.join("\n");
}

export function runChecks(input: {
  blocks: readonly NewsletterBlock[];
  languages: readonly LanguageRow[];
  kit: ResolvedBrandKit;
  tenantId: string;
}): Check[] {
  const { blocks, languages, kit, tenantId } = input;
  const out: Check[] = [];
  const visible = blocks.filter((b) => b.visible);
  const multi = languages.length > 1;

  // The footer is forced by the block gate, so a design can't lose it; what can be
  // missing is the link wording in a language, which would fall back to English.
  const footer = visible.find((b) => b.type === "footer");
  if (!footer) out.push({ id: "footer", tone: "warn", label: "The footer with the unsubscribe line is missing" });
  else {
    const gaps = languages.filter((l) => l.lang !== "en").filter((l) => !l.texts[footer.id]?.unsub || !l.texts[footer.id]?.prefs);
    if (gaps.length) for (const l of gaps) out.push({ id: `footer-${l.lang}`, tone: "warn", lang: l.lang, label: `${langName(l.lang)}: unsubscribe and preferences links are not worded in this language yet` });
    else out.push({ id: "footer", tone: "good", label: "Unsubscribe and Manage preferences in the footer" });
  }

  // Images: a picture chosen, and a description for people who cannot see it.
  const images = visible.filter((b) => b.type === "image" || (b.type === "product" && b.settings.path));
  const imgProblems: string[] = [];
  for (const b of visible.filter((x) => x.type === "image")) {
    if (!isTenantAssetPath(b.settings.path, tenantId)) imgProblems.push("An image block has no picture yet");
    for (const l of languages) if (!l.texts[b.id]?.alt) { imgProblems.push(`${multi ? `${langName(l.lang)}: ` : ""}an image has no description`); break; }
  }
  out.push(imgProblems.length
    ? { id: "images", tone: "warn", label: [...new Set(imgProblems)].join("; ") }
    : { id: "images", tone: "good", label: images.length ? "Every image has a description" : "No images to describe" });

  // Subject length, per language.
  for (const l of languages) {
    const n = l.subject.trim().length;
    const prefix = multi ? `${langName(l.lang)}: ` : "";
    if (n === 0) out.push({ id: `subject-${l.lang}`, tone: "warn", lang: l.lang, label: `${prefix}the subject is empty` });
    else if (n > SUBJECT_MAX) out.push({ id: `subject-${l.lang}`, tone: "warn", lang: l.lang, label: `${prefix}subject is ${n} characters (long for phones)` });
    else out.push({ id: `subject-${l.lang}`, tone: "good", lang: l.lang, label: `${prefix}subject is ${n} characters` });
  }

  // Links: count, https only, and every button has somewhere to go.
  const source = languages.find((l) => l.lang === "en") ?? languages[0];
  if (source) {
    const rendered = renderNewsletter({ blocks, language: source, kit, tenantId, assetBase: "https://assets.invalid", target: "version" });
    const insecure = rendered.links.filter((l) => l.url.startsWith("http://"));
    const noLink = visible.filter((b) => b.type === "button" && !b.settings.url);
    if (insecure.length) out.push({ id: "https", tone: "warn", label: `${insecure.length} link${insecure.length > 1 ? "s" : ""} not https` });
    else out.push({ id: "https", tone: "good", label: `${rendered.links.length} link${rendered.links.length === 1 ? "" : "s"}, all https` });
    if (noLink.length) out.push({ id: "button-links", tone: "warn", label: `${noLink.length} button${noLink.length > 1 ? "s have" : " has"} no link yet` });
  }

  // Text next to images.
  if (source) {
    const textChars = visible.reduce((n, b) => n + TEXT_FIELDS[b.type].reduce((m, f) => m + (source.texts[b.id]?.[f]?.length ?? 0), 0), 0);
    const imgCount = visible.filter((b) => b.type === "image" && isTenantAssetPath(b.settings.path, tenantId)).length;
    out.push(imgCount > 0 && textChars < MIN_TEXT_WITH_IMAGES
      ? { id: "balance", tone: "warn", label: "Mostly pictures: add some text so it does not look like spam" }
      : { id: "balance", tone: "good", label: "Enough text next to images" });
  }

  // Words spam filters dislike.
  const hits = new Set<string>();
  for (const l of languages) { const t = allText(l).toLowerCase(); for (const w of SPAM_WORDS) if (t.includes(w)) hits.add(w); }
  out.push(hits.size
    ? { id: "spam", tone: "warn", label: `Spam filters dislike: ${[...hits].map((h) => `"${h}"`).join(", ")}` }
    : { id: "spam", tone: "good", label: "No words spam filters dislike" });

  // Replaced-per-person fields the studio does not know.
  const unknown = new Set<string>();
  for (const l of languages) for (const t of unknownTokens(allText(l), KNOWN_TOKENS)) unknown.add(t);
  if (unknown.size) out.push({ id: "tokens", tone: "warn", label: `Unknown field${unknown.size > 1 ? "s" : ""} in the words: ${[...unknown].map((t) => `{{${t}}}`).join(", ")} (they would be left out)` });

  // Colours: body text on white (the dark-mode palette is fixed by the renderer).
  const body = contrastRatio(kit.text, "#ffffff");
  out.push(body < 4.5
    ? { id: "contrast", tone: "warn", label: `Body text colour is hard to read on white (contrast ${body.toFixed(1)})` }
    : { id: "contrast", tone: "good", label: "Colours readable" });

  // Each added language reviewed.
  for (const l of languages) {
    if (l.lang === "en") continue;
    const n = pendingBlocks(l, blocks).length;
    out.push(n
      ? { id: `review-${l.lang}`, tone: "warn", lang: l.lang, label: `${langName(l.lang)}: ${n} line${n > 1 ? "s" : ""} not yet checked` }
      : { id: `review-${l.lang}`, tone: "good", lang: l.lang, label: `${langName(l.lang)} reviewed` });
  }

  return out;
}

export const countWarnings = (checks: readonly Check[]): number => checks.filter((c) => c.tone === "warn").length;
