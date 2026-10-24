// How the working page words and draws a template, by its layout module. Pure.
// The page was written for the precast villa; a fence (or tiles, or a cabin) must not read
// "About the villa", so the few words that name the subject come from here.

export type LayoutWords = {
  /** Heading of the inputs card. */
  about: string;
  /** Heading of the model card. */
  model: string;
  /** The noun in "the ... and the price appear here". */
  subject: string;
  /** Example email in the paste box. */
  placeholder: string;
};

const WORDS: Record<string, LayoutWords> = {
  precast_villa: {
    about: "About the villa", model: "The villa", subject: "villa",
    placeholder: "Hi, we'd like a price for a villa in Riyadh. Two floors, about 180 m² each, with a 70 m boundary wall…",
  },
  chainlink_fence: {
    about: "About the fence", model: "The fence", subject: "fence",
    placeholder: "Hi, we need a 2.4 m high chain-link fence all the way round our yard, about 600 m, with two 6 m sliding gates…",
  },
};

const GENERIC: LayoutWords = {
  about: "About the job", model: "The layout", subject: "layout",
  placeholder: "Paste the customer's email here. Include any sizes, quantities and options they mention…",
};

export const wordsFor = (geometry: string | null | undefined): LayoutWords => (geometry && WORDS[geometry]) || GENERIC;

/** Layout modules whose pieces the build-schedule and risk run understands (the precast erection sequence). */
const HAS_BUILD_SCHEDULE = new Set<string | null>([null, "precast_villa"]);

export const hasBuildSchedule = (geometry: string | null | undefined): boolean => HAS_BUILD_SCHEDULE.has(geometry ?? null);

/** Which preview a layout module draws. */
export type PreviewKind = "fence" | "pieces" | "none";
export const previewKindFor = (geometry: string | null | undefined): PreviewKind =>
  geometry === "chainlink_fence" ? "fence" : geometry ? "pieces" : "none";
