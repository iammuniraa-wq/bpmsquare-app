// Newsletter Studio shared types and constants (docs/newsletter-studio-architecture.md).
// Pure: no I/O, no server-only import, so the client screens and the renderer
// share one definition of a block and a language.

export const SOURCE_LANGUAGE = "en";

export type LanguageDef = { code: string; name: string; native: string; dir: "ltr" | "rtl" };

// English first; others are added on top. Direction is stored on the language
// row so the renderer never guesses (doc section 5).
export const LANGUAGES: readonly LanguageDef[] = [
  { code: "en", name: "English", native: "English", dir: "ltr" },
  { code: "ar", name: "Arabic", native: "العربية", dir: "rtl" },
  { code: "hi", name: "Hindi", native: "हिन्दी", dir: "ltr" },
  { code: "ur", name: "Urdu", native: "اردو", dir: "rtl" },
  { code: "fr", name: "French", native: "Français", dir: "ltr" },
];

export const languageDef = (code: string): LanguageDef | null => LANGUAGES.find((l) => l.code === code) ?? null;
export const isKnownLanguage = (code: unknown): code is string => typeof code === "string" && LANGUAGES.some((l) => l.code === code);
export const directionOf = (code: string): "ltr" | "rtl" => languageDef(code)?.dir ?? "ltr";

export const CATEGORIES = ["Newsletter", "Offer", "Event", "Announcement", "Festival"] as const;
export type NewsletterCategory = (typeof CATEGORIES)[number];

export const NEWSLETTER_STATUSES = ["draft", "ready", "archived"] as const;
export type NewsletterStatus = (typeof NEWSLETTER_STATUSES)[number];

// A closed union: the one gate (sanitizeNewsletterBlocks) refuses anything else.
export const BLOCK_TYPES = ["header", "hero", "text", "image", "button", "columns", "product", "event", "divider", "social", "interest", "footer"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const BLOCK_LABEL: Record<BlockType, string> = {
  header: "Header", hero: "Hero", text: "Text", image: "Image", button: "Button", columns: "Columns", product: "Product card",
  event: "Event", divider: "Divider", social: "Social", interest: "Interested? button", footer: "Footer",
};

/** Brand blocks: in every design, locked by default. The footer carries the unsubscribe line and cannot be removed. */
export const REQUIRED_BLOCKS: readonly BlockType[] = ["header", "footer"];
/** Blocks a person may add from the "Add" row. */
export const ADDABLE_BLOCKS: readonly BlockType[] = ["text", "image", "button", "columns", "product", "event", "divider", "social"];

/** Text fields of each block type: these live in newsletter_languages.texts[blockId]. */
export const TEXT_FIELDS: Record<BlockType, readonly string[]> = {
  header: ["tag"],
  hero: ["title", "text"],
  text: ["text"],
  image: ["alt"],
  button: ["label"],
  columns: ["t1", "p1", "t2", "p2"],
  product: ["name", "text", "price", "from"],
  event: ["title", "text", "when", "where"],
  divider: [],
  social: [],
  interest: ["label"],
  footer: ["text", "unsub", "prefs"],
};

/** The field the block list shows as a one-line summary and the editor opens first. */
export const PRIMARY_FIELD: Record<BlockType, string | null> = {
  header: "tag", hero: "title", text: "text", image: "alt", button: "label", columns: "t1", product: "name", event: "title",
  divider: null, social: null, interest: "label", footer: "text",
};

/** Plain-words label of each field, for the editor. */
export const FIELD_LABEL: Record<string, string> = {
  tag: "Small text on the right", title: "Title", text: "Text", alt: "Description for people who cannot see the image",
  label: "Button text", t1: "First column title", p1: "First column text", t2: "Second column title", p2: "Second column text",
  name: "Product name", price: "Price", from: "Where it comes from", when: "When", where: "Where",
  unsub: "Unsubscribe link text", prefs: "Manage preferences link text",
};

export type BlockSettings = Record<string, string | number | boolean>;

export type NewsletterBlock = {
  id: string;
  type: BlockType;
  visible: boolean;
  locked?: boolean;
  settings: BlockSettings;
  /** Signals topic of the block's link, carried to the click row (doc 12.3). */
  topic_id?: string;
};

export type TextMap = Record<string, Record<string, string>>;
export type ReviewState = "written" | "translated" | "reviewed";
export type ReviewMap = Record<string, ReviewState>;

export type LanguageRow = {
  id?: string;
  lang: string;
  dir: "ltr" | "rtl";
  subject: string;
  preheader: string;
  texts: TextMap;
  review: ReviewMap;
  status: "draft" | "ready";
  translated_by?: "person" | "ai" | null;
};

/** Email-safe font pairings: one Latin stack and one Arabic stack. No web fonts: Gmail and Outlook drop them. */
export const FONT_PAIRINGS: Record<string, { label: string; latin: string; arabic: string }> = {
  arial: { label: "Arial", latin: "Arial, Helvetica, sans-serif", arabic: "Tahoma, 'Segoe UI', Arial, sans-serif" },
  georgia: { label: "Georgia", latin: "Georgia, 'Times New Roman', serif", arabic: "'Segoe UI', Tahoma, Arial, sans-serif" },
  segoe: { label: "Segoe UI", latin: "'Segoe UI', Helvetica, Arial, sans-serif", arabic: "'Segoe UI', Tahoma, Arial, sans-serif" },
};
export const DEFAULT_FONT_PAIRING = "arial";

export const MERGE_TOKENS = ["account_name", "company_name", "contact_name"] as const;
export type MergeToken = (typeof MERGE_TOKENS)[number];

/** Tokens the send route fills per recipient, beside the merge fields. */
export const LINK_TOKENS = ["unsubscribe_url", "preferences_url", "interest_url"] as const;
