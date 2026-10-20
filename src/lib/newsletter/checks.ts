import { contrastRatio, type ResolvedBrandKit } from "./brandKit";
import { pendingBlocks, isTenantAssetPath } from "./sanitize";
import { renderNewsletter } from "./render";
import { MERGE_TOKENS, TEXT_FIELDS, languageDef, type LanguageRow, type NewsletterBlock } from "./types";
import { unknownTokens } from "./tokens";

// "Content health": rules that run every time, not opinions and never a score. Deterministic
// code, unit-tested -- a pass/fail a person acts on is never an AI output (same doctrine as
// Account 360's rating). Every amber item says in plain words what to change.

export type Check = {
  id: string;
  tone: "good" | "warn";
  label: string;
  /** What to change, in plain words. Only on an amber item. */
  fix?: string;
  /** Language the check is about, when it is per language. */
  lang?: string;
};

export const SUBJECT_MAX = 60;
export const MAX_LINKS = 10;
export const LONG_TEXT_CHARS = 3500;
export const HEAVY_IMAGE_BYTES = 500 * 1024;
export const HEAVY_TOTAL_IMAGE_BYTES = 1024 * 1024;
/** Gmail cuts a message off ("View entire message") around 102 KB of HTML; warn before that. */
export const GMAIL_CLIP_BYTES = 102 * 1000;
export const GMAIL_NEAR_BYTES = 90 * 1000;
const MIN_TEXT_WITH_IMAGES = 150;

// A short list of words spam filters dislike. A starting list, not a verdict.
export const SPAM_WORDS = ["free money", "act now", "limited time", "100% free", "click here", "guarantee", "winner", "urgent", "cash bonus", "no obligation", "risk-free", "buy now", "congratulations", "$$$"];

const KNOWN_TOKENS: ReadonlySet<string> = new Set([...MERGE_TOKENS]);

const langName = (code: string): string => languageDef(code)?.name ?? code;

function allText(row: Pick<LanguageRow, "subject" | "preheader" | "texts">): string {
  const parts = [row.subject, row.preheader];
  for (const fields of Object.values(row.texts)) for (const v of Object.values(fields)) parts.push(v);
  return parts.join("\n");
}

/** Words of four or more capital letters (Latin), the shouting a filter and a reader both notice. */
export function shoutingWords(text: string): string[] {
  return (text.match(/\b[A-Z]{4,}\b/g) ?? []).filter((w) => !/^(HTTP|HTTPS|HTML|WLLC?|QAR|SAR|AED|INR|USD|EUR|PVC|HVAC|ISO|ANSI)$/.test(w));
}

/** Placeholders that look like a field but will not be replaced: {{ name }}, {name}, {{two words}}, a missing brace. */
export function brokenPlaceholders(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\{\{[^{}]*\}\}/g)) if (!/^\{\{\w+\}\}$/.test(m[0])) out.add(m[0]);
  const stripped = text.replace(/\{\{\w+\}\}/g, "").replace(/\{\{[^{}]*\}\}/g, "");
  for (const m of stripped.matchAll(/\{[^{}]*\}/g)) out.add(m[0]);
  if (/[{}]/.test(stripped.replace(/\{[^{}]*\}/g, ""))) out.add("an unmatched { or }");
  return [...out];
}

export function runChecks(input: {
  blocks: readonly NewsletterBlock[];
  languages: readonly LanguageRow[];
  kit: ResolvedBrandKit;
  tenantId: string;
}): Check[] {
  const { blocks, languages, kit, tenantId } = input;
  const out: Check[] = [];
  const add = (c: Check) => out.push(c);
  const visible = blocks.filter((b) => b.visible);
  const multi = languages.length > 1;
  const prefix = (l: LanguageRow) => (multi ? `${langName(l.lang)}: ` : "");

  const renders = new Map(languages.map((l) => [l.lang, renderNewsletter({ blocks, language: l, kit, tenantId, assetBase: "https://assets.invalid", target: "version" })]));

  // Unsubscribe and preferences links: in the footer of every language, worded in that language.
  const footer = visible.find((b) => b.type === "footer");
  if (!footer) add({ id: "footer", tone: "warn", label: "The footer with the unsubscribe line is missing", fix: "Turn the footer block back on. It carries the unsubscribe and preferences links and cannot be left out." });
  else {
    const noLinks = languages.filter((l) => { const h = renders.get(l.lang)?.html ?? ""; return !h.includes("{{unsubscribe_url}}") || !h.includes("{{preferences_url}}"); });
    const gaps = languages.filter((l) => l.lang !== "en").filter((l) => !l.texts[footer.id]?.unsub || !l.texts[footer.id]?.prefs);
    if (noLinks.length) for (const l of noLinks) add({ id: `footer-links-${l.lang}`, tone: "warn", lang: l.lang, label: `${prefix(l)}the unsubscribe or preferences link is missing`, fix: "Open the footer block and make sure it is on. Every email must carry both links." });
    if (gaps.length) for (const l of gaps) add({ id: `footer-${l.lang}`, tone: "warn", lang: l.lang, label: `${langName(l.lang)}: unsubscribe and preferences links are not worded in this language yet`, fix: "Write the link wording in the footer block for this language, or accept the translation." });
    if (!noLinks.length && !gaps.length) add({ id: "footer", tone: "good", label: "Unsubscribe and Manage preferences in the footer" });
  }

  // Images: a picture chosen, and a description for people who cannot see it.
  const images = visible.filter((b) => b.type === "image" || (b.type === "product" && b.settings.path));
  const imgProblems: string[] = [];
  for (const b of visible.filter((x) => x.type === "image")) {
    if (!isTenantAssetPath(b.settings.path, tenantId)) imgProblems.push("An image block has no picture yet");
    for (const l of languages) if (!l.texts[b.id]?.alt) { imgProblems.push(`${prefix(l)}an image has no description`); break; }
  }
  add(imgProblems.length
    ? { id: "images", tone: "warn", label: [...new Set(imgProblems)].join("; "), fix: "Choose a picture for each image block and describe it in a few words; people who cannot see the picture hear that text." }
    : { id: "images", tone: "good", label: images.length ? "Every image has a description" : "No images to describe" });

  // Image weight, when the sizes are known (recorded at upload).
  const weights = images.map((b) => Number(b.settings.bytes)).filter((n) => Number.isFinite(n) && n > 0);
  if (weights.length) {
    const total = weights.reduce((a, b) => a + b, 0);
    const heavy = weights.some((w) => w > HEAVY_IMAGE_BYTES) || total > HEAVY_TOTAL_IMAGE_BYTES;
    add(heavy
      ? { id: "image-weight", tone: "warn", label: `Pictures weigh ${(total / 1024 / 1024).toFixed(1)} MB in total`, fix: "Use smaller pictures (under 500 KB each, about 1 MB in all) so the email opens quickly on a phone." }
      : { id: "image-weight", tone: "good", label: "Pictures are light enough" });
  }

  // Subject length and a preview line, per language.
  for (const l of languages) {
    const n = l.subject.trim().length;
    if (n === 0) add({ id: `subject-${l.lang}`, tone: "warn", lang: l.lang, label: `${prefix(l)}the subject is empty`, fix: "Write a subject. It is the first thing people read." });
    else if (n > SUBJECT_MAX) add({ id: `subject-${l.lang}`, tone: "warn", lang: l.lang, label: `${prefix(l)}subject is ${n} characters (long for phones)`, fix: `Shorten it to ${SUBJECT_MAX} characters or fewer so a phone shows all of it.` });
    else add({ id: `subject-${l.lang}`, tone: "good", lang: l.lang, label: `${prefix(l)}subject is ${n} characters` });
    add(l.preheader.trim()
      ? { id: `preheader-${l.lang}`, tone: "good", lang: l.lang, label: `${prefix(l)}has a preview line` }
      : { id: `preheader-${l.lang}`, tone: "warn", lang: l.lang, label: `${prefix(l)}no preview line`, fix: "Add a short preview line. It shows next to the subject in the inbox; without it the inbox shows a scrap of the email instead." });
  }

  const source = languages.find((l) => l.lang === "en") ?? languages[0];
  const sourceRender = source ? renders.get(source.lang) : undefined;

  // Links: how many, https only, and every button has somewhere to go.
  if (source && sourceRender) {
    const links = sourceRender.links;
    const insecure = links.filter((l) => l.url.startsWith("http://"));
    const noLink = visible.filter((b) => b.type === "button" && !b.settings.url);
    if (insecure.length) add({ id: "https", tone: "warn", label: `${insecure.length} link${insecure.length > 1 ? "s" : ""} not https`, fix: "Change those addresses to start with https://. Some mail programs warn people about plain http links." });
    else if (links.length > MAX_LINKS) add({ id: "https", tone: "warn", label: `${links.length} links (a lot)`, fix: `Keep it to ${MAX_LINKS} links or fewer. Many links look like spam and split attention.` });
    else if (links.length === 0) add({ id: "https", tone: "warn", label: "No links to click", fix: "Add a button or a link so people have something to do next." });
    else add({ id: "https", tone: "good", label: `${links.length} link${links.length === 1 ? "" : "s"}, all https` });
    if (noLink.length) add({ id: "button-links", tone: "warn", label: `${noLink.length} button${noLink.length > 1 ? "s have" : " has"} no link yet`, fix: "Open each button and enter where it should go." });
  }

  // Length, and text next to images.
  if (source) {
    const textChars = visible.reduce((n, b) => n + TEXT_FIELDS[b.type].reduce((m, f) => m + (source.texts[b.id]?.[f]?.length ?? 0), 0), 0);
    add(textChars > LONG_TEXT_CHARS
      ? { id: "length", tone: "warn", label: `${textChars.toLocaleString("en-GB")} characters of text (long)`, fix: "Cut it down or move detail to a page you link to. Short emails get read." }
      : { id: "length", tone: "good", label: `${textChars.toLocaleString("en-GB")} characters of text` });
    const imgCount = visible.filter((b) => b.type === "image" && isTenantAssetPath(b.settings.path, tenantId)).length;
    add(imgCount > 0 && textChars < MIN_TEXT_WITH_IMAGES
      ? { id: "balance", tone: "warn", label: "Mostly pictures: not much text", fix: "Add a few sentences next to the pictures so it does not look like spam and still makes sense with images off." }
      : { id: "balance", tone: "good", label: "Enough text next to images" });
  }

  // Gmail clips long messages.
  for (const l of languages) {
    const bytes = Buffer.byteLength(renders.get(l.lang)?.html ?? "", "utf8");
    if (bytes >= GMAIL_CLIP_BYTES) add({ id: `gmail-${l.lang}`, tone: "warn", lang: l.lang, label: `${prefix(l)}the email is ${Math.round(bytes / 1000)} KB; Gmail cuts messages off around 102 KB`, fix: "Remove a block or shorten the text. People using Gmail would otherwise see 'View entire message' and miss the footer links." });
    else if (bytes >= GMAIL_NEAR_BYTES) add({ id: `gmail-${l.lang}`, tone: "warn", lang: l.lang, label: `${prefix(l)}the email is ${Math.round(bytes / 1000)} KB, close to Gmail's limit`, fix: "Trim a little so adding one more block does not push it over 102 KB." });
    else if (l === languages[0]) add({ id: "gmail", tone: "good", label: "Small enough for Gmail" });
  }

  // Words spam filters dislike, and shouting.
  const hits = new Set<string>();
  const shouts = new Set<string>();
  for (const l of languages) {
    const t = allText(l);
    const lower = t.toLowerCase();
    for (const w of SPAM_WORDS) if (lower.includes(w)) hits.add(w);
    for (const w of shoutingWords(t)) shouts.add(w);
  }
  add(hits.size
    ? { id: "spam", tone: "warn", label: `Spam filters dislike: ${[...hits].map((h) => `"${h}"`).join(", ")}`, fix: "Reword those phrases in plain language." }
    : { id: "spam", tone: "good", label: "No words spam filters dislike" });
  const subjectShouts = source ? source.subject.length >= 8 && source.subject === source.subject.toUpperCase() && /[A-Z]/.test(source.subject) : false;
  add(shouts.size >= 3 || subjectShouts
    ? { id: "caps", tone: "warn", label: subjectShouts ? "The subject is all capitals" : `${shouts.size} words in ALL CAPS`, fix: "Write in normal sentence case. Capital letters read as shouting and trigger spam filters." }
    : { id: "caps", tone: "good", label: "No shouting in capitals" });

  // Placeholders that will not be replaced.
  const unknown = new Set<string>();
  const broken = new Set<string>();
  for (const l of languages) {
    const t = allText(l);
    for (const x of unknownTokens(t, KNOWN_TOKENS)) unknown.add(x);
    for (const x of brokenPlaceholders(t)) broken.add(x);
  }
  if (unknown.size) add({ id: "tokens", tone: "warn", label: `Unknown field${unknown.size > 1 ? "s" : ""} in the words: ${[...unknown].map((t) => `{{${t}}}`).join(", ")} (they would be left out)`, fix: `Use only ${MERGE_TOKENS.map((t) => `{{${t}}}`).join(", ")}, or delete the field.` });
  add(broken.size
    ? { id: "placeholders", tone: "warn", label: `A field looks broken: ${[...broken].slice(0, 3).join(", ")}`, fix: "Write fields with two curly brackets on each side and no spaces, like {{account_name}}, or the person would see the brackets." }
    : { id: "placeholders", tone: "good", label: "Fields to fill in look right" });

  // Colours: body text on white (the dark-mode palette is fixed by the renderer).
  const body = contrastRatio(kit.text, "#ffffff");
  add(body < 4.5
    ? { id: "contrast", tone: "warn", label: `Body text colour is hard to read on white (contrast ${body.toFixed(1)})`, fix: "Choose a darker text colour in Settings, Brand kit." }
    : { id: "contrast", tone: "good", label: "Colours readable" });

  // Each added language reviewed.
  for (const l of languages) {
    if (l.lang === "en") continue;
    const n = pendingBlocks(l, blocks).length;
    add(n
      ? { id: `review-${l.lang}`, tone: "warn", lang: l.lang, label: `${langName(l.lang)}: ${n} line${n > 1 ? "s" : ""} not yet checked`, fix: "Press Accept on each line marked Check this, or edit it. A language can be sent once every line is checked." }
      : { id: `review-${l.lang}`, tone: "good", lang: l.lang, label: `${langName(l.lang)} reviewed` });
  }

  return out;
}

export const countWarnings = (checks: readonly Check[]): number => checks.filter((c) => c.tone === "warn").length;
