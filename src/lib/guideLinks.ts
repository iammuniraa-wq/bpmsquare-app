// "Learn more" targets for the InfoTip, in one place: key -> anchor into the how-to guide
// (docs/guides/marketing-how-to.md section ids). The guide's base address is NEXT_PUBLIC_GUIDE_BASE_URL; while it
// is unset no link is drawn, so a tip never points at a page that does not exist yet.
import { guideHref } from "./infoTip";

export const GUIDE_LINKS: Record<string, string> = {
  consent: "#1-consent-and-topics",
  forms: "#2-forms-and-the-preference-centre",
  newsletters: "#3-newsletter-studio",
  languages: "#3-newsletter-studio",
  health: "#3-newsletter-studio",
  emailHealth: "#4-email-health",
  leadScores: "#5-lead-scores",
  journeys: "#6-journeys",
  journeyGuards: "#6-journeys",
  signals: "#7-buying-signals",
  abm: "#8-abm-programs",
};

export function guideUrl(key: string | undefined): string | null {
  return guideHref(GUIDE_LINKS, key, process.env.NEXT_PUBLIC_GUIDE_BASE_URL);
}
