import type { MarketingTopic } from "@/lib/constants";

// What the Consent screen decides before it draws anything. Pure, so the tests read it without a browser.

export type Basis = "consent_required" | "existing_customer";
export type Jurisdiction = { code: string; label: string; existing_customer_allowed: boolean; plain: string };

export const MAX_TOPICS = 20;

/** The rule a country group really has: a relaxed choice on a group that does not allow it reads as strict. */
export function basisOf(j: Jurisdiction, defaults: Record<string, Basis>): Basis {
  return j.existing_customer_allowed && defaults[j.code] === "existing_customer" ? "existing_customer" : "consent_required";
}

export const basisWord = (b: Basis): string => (b === "existing_customer" ? "Also existing customers" : "Only people who said yes");

/**
 * The rows of the rules table: the country the workspace sits in first, then any other country that has been relaxed
 * (a relaxed rule is never hidden), then, only when asked, the rest.
 */
export function visibleRules(jurisdictions: Jurisdiction[], defaults: Record<string, Basis>, home: string, showAll: boolean): Jurisdiction[] {
  const homeFirst = [...jurisdictions].sort((a, b) => Number(b.code === home) - Number(a.code === home));
  return homeFirst.filter((j) => showAll || j.code === home || basisOf(j, defaults) === "existing_customer");
}

export const hiddenRuleCount = (jurisdictions: Jurisdiction[], defaults: Record<string, Basis>, home: string): number =>
  jurisdictions.length - visibleRules(jurisdictions, defaults, home, false).length;

/** A topic added and then left without a name is not kept: the server would drop it anyway. */
export const dropBlankTopic = (topics: MarketingTopic[], index: number): MarketingTopic[] =>
  topics[index] && topics[index].label.trim() === "" ? topics.filter((_, i) => i !== index) : topics;

export const topicsFull = (topics: MarketingTopic[]): boolean => topics.length >= MAX_TOPICS;
