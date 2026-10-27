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
  tiles_floor: {
    about: "About the floor", model: "The floor", subject: "floor",
    placeholder: "Hi, we'd like to tile a 5 m by 4 m living room with 600 by 600 mm porcelain tiles, brick pattern, with skirting…",
  },
  porta_cabin: {
    about: "About the cabin", model: "The cabin", subject: "cabin",
    placeholder: "Hi, we need four porta cabins in a row, each 6 by 2.4 m, with two windows and a door each, standard fit-out…",
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

/**
 * Layouts whose inputs all have sensible defaults open straight onto a floor, a fence or a cabin and its price. The precast
 * villa keeps opening blank: it has no honest default to price.
 */
const OPENS_WITH_DEFAULTS = new Set(["chainlink_fence", "tiles_floor", "porta_cabin"]);
export const opensWithDefaults = (geometry: string | null | undefined): boolean => !!geometry && OPENS_WITH_DEFAULTS.has(geometry);
