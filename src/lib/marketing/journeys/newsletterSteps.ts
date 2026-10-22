import type { JourneyDefinition, JourneyStep } from "./types";

// The client side of "a send step picks a newsletter by name". Pure: the screen passes in what the lookup
// returned and a function that asks the server to keep a version, so the rules are testable without either.

export type NewsletterChoice = { id: string; name: string; topic: string | null; languages: string[]; versionIds: string[] };
export type PickResult = { version_id: string; topic: string | null; languages: string[] };
export type SendNewsletterStep = Extract<JourneyStep, { kind: "send_newsletter" }>;

/** The newsletter a step currently sends, found through the version it holds. */
export function newsletterOfStep(newsletters: NewsletterChoice[], step: SendNewsletterStep): NewsletterChoice | null {
  if (!step.newsletter_version_id) return null;
  return newsletters.find((n) => n.versionIds.includes(step.newsletter_version_id as string)) ?? null;
}

/** What choosing a newsletter changes on the step: the kept version, and the topic it carries (never asked again). All its ready languages are sent. */
export function stepPatchForPick(r: PickResult): Pick<SendNewsletterStep, "newsletter_version_id" | "topic" | "languages"> {
  return { newsletter_version_id: r.version_id, topic: r.topic, languages: [] };
}

/** The list after a version was kept for one newsletter, so the step that now holds it still finds its newsletter. */
export function withKeptVersion(newsletters: NewsletterChoice[], newsletterId: string, r: PickResult): NewsletterChoice[] {
  return newsletters.map((n) => (n.id === newsletterId && !n.versionIds.includes(r.version_id) ? { ...n, versionIds: [r.version_id, ...n.versionIds], languages: r.languages } : n));
}

/**
 * Before a draft is saved, every send step follows its newsletter: the server keeps a new version only when the
 * newsletter changed, so an unchanged one costs a lookup and nothing else. A step whose newsletter cannot be
 * found, or whose refresh fails, keeps the version it had.
 */
export async function followNewsletters(
  def: JourneyDefinition, newsletters: NewsletterChoice[], resolve: (newsletterId: string) => Promise<PickResult | null>,
): Promise<{ def: JourneyDefinition; changed: boolean }> {
  let changed = false;
  const steps: JourneyStep[] = [];
  for (const s of def.steps) {
    const n = s.kind === "send_newsletter" ? newsletterOfStep(newsletters, s) : null;
    if (s.kind !== "send_newsletter" || !n) { steps.push(s); continue; }
    const r = await resolve(n.id);
    if (!r || r.version_id === s.newsletter_version_id) { steps.push(s); continue; }
    changed = true;
    steps.push({ ...s, ...stepPatchForPick(r) });
  }
  return { def: changed ? { ...def, steps } : def, changed };
}
