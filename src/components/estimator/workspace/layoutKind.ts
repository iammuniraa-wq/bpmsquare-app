// How the working page words and draws a template, by its layout module. Pure.
// The page was written for the precast villa; a fence (or tiles, or a cabin) must not read
// "About the villa", so the few words that name the subject come from here.

import { rangedRates } from "@/lib/estimator/simulation";
import type { TemplateRate } from "@/lib/estimator/types";

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

/** A layout module's name as a screen shows it, without the module's own "(illustrative)" suffix. */
export const layoutName = (label: string): string => label.replace(/ \(illustrative\)$/i, "");

/** Layout modules whose pieces the build-schedule and risk run understands (the precast erection sequence). */
const HAS_BUILD_SCHEDULE = new Set<string | null>([null, "precast_villa"]);

// A template with no layout is stored as null or as "" (the SQL starter seeds write ""): both mean the same thing.
export const hasBuildSchedule = (geometry: string | null | undefined): boolean => HAS_BUILD_SCHEDULE.has(geometry || null);

/** The "Schedule & risk" tab: for a build schedule, or for rates with a range, which give the risk run something to move. */
export const hasScheduleRiskTab = (template: { geometry?: string | null; rates?: readonly TemplateRate[] | null } | null | undefined): boolean =>
  hasBuildSchedule(template?.geometry) || rangedRates(template?.rates ?? []).length > 0;

/** Which preview a template draws: its bespoke module's, else the picture built from its inputs ("generic"), else nothing. */
export type PreviewKind = "fence" | "pieces" | "generic" | "none";
export const previewKindFor = (geometry: string | null | undefined, hasGenericPicture = false): PreviewKind =>
  geometry === "chainlink_fence" ? "fence" : geometry ? "pieces" : hasGenericPicture ? "generic" : "none";

/**
 * Every template opens straight onto its model and price with the default values (a template whose inputs have no default
 * simply has nothing to price yet). The precast villa keeps opening blank: it has no honest default to price.
 */
const OPENS_BLANK = new Set(["precast_villa"]);
export const opensWithDefaults = (geometry: string | null | undefined): boolean => !(geometry && OPENS_BLANK.has(geometry));
