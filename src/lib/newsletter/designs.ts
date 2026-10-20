import type { LanguageRow, NewsletterBlock, NewsletterCategory, TextMap, BlockType, ReviewMap } from "./types";
import { directionOf } from "./types";

// Starting points: a blank design, new-block defaults, and the built-in designs
// shown beside a workspace's own templates in "Start from a design". All are
// structured blocks plus words -- never HTML. English first; the Eid design
// also carries Arabic, marked "translated" so a person checks it before it can
// be sent (nothing here claims a human reviewed it).

const block = (id: string, type: BlockType, settings: NewsletterBlock["settings"] = {}): NewsletterBlock => ({
  id, type, visible: true, settings, ...(type === "header" || type === "footer" ? { locked: true } : {}),
});

export const FOOTER_REASON = "You receive this because you are a customer of {{company_name}}.";

export function footerTexts(address: string): Record<string, string> {
  return { text: [address, FOOTER_REASON].filter(Boolean).join("\n"), unsub: "Unsubscribe", prefs: "Manage preferences" };
}

/** The words a freshly added block starts with (English). */
export function newBlockDefaults(type: BlockType): Record<string, string> {
  switch (type) {
    case "text": return { text: "New paragraph. Click to write." };
    case "button": return { label: "Read more" };
    case "columns": return { t1: "First column", p1: "A few words.", t2: "Second column", p2: "A few words." };
    case "product": return { name: "Product name", text: "", price: "", from: "" };
    case "event": return { title: "Event name", text: "", when: "Date and time", where: "Place" };
    case "image": return { alt: "" };
    case "hero": return { title: "Title", text: "One line about this issue." };
    case "interest": return { label: "Interested? Tell us more" };
    default: return {};
  }
}

export type BuiltInDesign = {
  id: string;
  name: string;
  category: NewsletterCategory;
  blocks: NewsletterBlock[];
  /** language -> words (and the review state of each). English is always present. */
  languages: { lang: string; subject: string; preheader: string; texts: TextMap; reviewed: boolean }[];
};

function make(
  id: string, name: string, category: NewsletterCategory, blocks: NewsletterBlock[],
  en: { subject: string; preheader: string; texts: TextMap },
  extra: BuiltInDesign["languages"] = [],
): BuiltInDesign {
  return { id, name, category, blocks, languages: [{ lang: "en", ...en, reviewed: true }, ...extra] };
}

const FOOT = footerTexts("");

export const BUILT_IN_DESIGNS: BuiltInDesign[] = [
  make("blank", "Blank", "Newsletter",
    [block("header1", "header"), block("footer1", "footer")],
    { subject: "", preheader: "", texts: { header1: { tag: "" }, footer1: FOOT } }),

  make("monthly-update", "Monthly update", "Newsletter",
    [block("header1", "header"), block("hero1", "hero"), block("text1", "text"), block("product1", "product"), block("button1", "button"), block("columns1", "columns"), block("interest1", "interest"), block("footer1", "footer")],
    {
      subject: "Your update from {{company_name}}", preheader: "Three things worth a minute of your time",
      texts: {
        header1: { tag: "" },
        hero1: { title: "What is new this month", text: "Three things worth a minute of your time." },
        text1: { text: "Dear {{account_name}},\nA short note on what has changed and what is coming." },
        product1: { name: "Featured product", text: "One line about why it matters.", price: "", from: "" },
        button1: { label: "See more" },
        columns1: { t1: "First topic", p1: "A few words.", t2: "Second topic", p2: "A few words." },
        interest1: { label: "Interested? Tell us more" },
        footer1: FOOT,
      },
    }),

  make("offer", "Offer", "Offer",
    [block("header1", "header"), block("hero1", "hero"), block("text1", "text"), block("columns1", "columns"), block("button1", "button"), block("footer1", "footer")],
    {
      subject: "A special offer for {{account_name}}", preheader: "Valid for a limited period",
      texts: {
        header1: { tag: "" },
        hero1: { title: "A special offer", text: "Our thanks for working with us." },
        text1: { text: "Dear {{account_name}},\nFor a limited period we are offering you the following." },
        columns1: { t1: "The offer", p1: "Describe it in one or two lines.", t2: "How to claim it", p2: "Reply to this email or call us." },
        button1: { label: "Claim the offer" },
        footer1: FOOT,
      },
    }),

  make("event-invite", "Event invitation", "Event",
    [block("header1", "header"), block("hero1", "hero"), block("event1", "event"), block("text1", "text"), block("button1", "button"), block("footer1", "footer")],
    {
      subject: "You are invited: {{company_name}}", preheader: "Please save the date",
      texts: {
        header1: { tag: "" },
        hero1: { title: "You are invited", text: "We would be glad to see you." },
        event1: { title: "Event name", text: "What the event is about.", when: "Date and time", where: "Place" },
        text1: { text: "Dear {{account_name}},\nPlease let us know if you can join us." },
        button1: { label: "Tell us you are coming" },
        footer1: FOOT,
      },
    }),

  make("announcement", "Announcement", "Announcement",
    [block("header1", "header"), block("hero1", "hero"), block("text1", "text"), block("button1", "button"), block("footer1", "footer")],
    {
      subject: "News from {{company_name}}", preheader: "An important update",
      texts: {
        header1: { tag: "" },
        hero1: { title: "An update for you", text: "" },
        text1: { text: "Dear {{account_name}},\nWrite the announcement here." },
        button1: { label: "Read more" },
        footer1: FOOT,
      },
    }),

  make("festival-eid", "Eid greeting", "Festival",
    [block("header1", "header"), block("hero1", "hero"), block("text1", "text"), block("footer1", "footer")],
    {
      subject: "Eid Mubarak from {{company_name}}", preheader: "Warm wishes to you and your team",
      texts: {
        header1: { tag: "Eid Mubarak" },
        hero1: { title: "Eid Mubarak", text: "Warm wishes to you and your team." },
        text1: { text: "Dear {{account_name}},\nOn behalf of everyone at {{company_name}}, we wish you and your family a blessed Eid. Thank you for your trust this year." },
        footer1: FOOT,
      },
    },
    [{
      lang: "ar", reviewed: false,
      subject: "عيد مبارك من {{company_name}}", preheader: "أطيب التمنيات لكم ولفريقكم",
      texts: {
        header1: { tag: "عيد مبارك" },
        hero1: { title: "عيد مبارك", text: "أطيب التمنيات لكم ولفريقكم." },
        text1: { text: "عزيزنا {{account_name}}،\nباسم جميع العاملين في {{company_name}}، نتمنى لكم ولعائلتكم عيداً مباركاً. نشكركم على ثقتكم بنا هذا العام." },
        footer1: { text: "تصلك هذه الرسالة لأنك من عملاء {{company_name}}.", unsub: "إلغاء الاشتراك", prefs: "إدارة التفضيلات" },
      },
    }]),

  make("festival-diwali", "Diwali greeting", "Festival",
    [block("header1", "header"), block("hero1", "hero"), block("text1", "text"), block("footer1", "footer")],
    {
      subject: "Happy Diwali from {{company_name}}", preheader: "May the festival of lights bring you joy",
      texts: {
        header1: { tag: "Happy Diwali" },
        hero1: { title: "Happy Diwali", text: "May the festival of lights bring you joy and prosperity." },
        text1: { text: "Dear {{account_name}},\nThank you for being part of our year. We wish you and your team a bright and happy Diwali." },
        footer1: FOOT,
      },
    }),
];

export const builtInDesign = (id: string): BuiltInDesign | null => BUILT_IN_DESIGNS.find((d) => d.id === id) ?? null;

/** A design's languages as rows ready to save: translated blocks are marked so a person checks them. */
export function languageRowsOf(design: BuiltInDesign, footerAddress = ""): LanguageRow[] {
  return design.languages.map((l) => {
    const texts: TextMap = JSON.parse(JSON.stringify(l.texts));
    const footer = design.blocks.find((b) => b.type === "footer");
    if (footer && l.lang === "en" && footerAddress) texts[footer.id] = footerTexts(footerAddress);
    const review: ReviewMap = {};
    for (const b of design.blocks) review[b.id] = l.lang === "en" || l.reviewed ? "written" : "translated";
    return { lang: l.lang, dir: directionOf(l.lang), subject: l.subject, preheader: l.preheader, texts, review, status: l.reviewed || l.lang === "en" ? "ready" : "draft", translated_by: l.lang === "en" ? "person" : "ai" };
  });
}
