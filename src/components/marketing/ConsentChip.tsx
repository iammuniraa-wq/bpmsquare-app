import Link from "next/link";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import InfoTip from "@/components/ui/InfoTip";
import { COMPOSE_TIPS } from "@/lib/marketing/composeTips";

/**
 * The result of the consent rules, shown where a message is sent, with the one place that sets them
 * (Settings > Marketing > Consent). Screens never define topics or rules themselves
 * (docs/design/marketing-two-parts.md, slice 4): they show this chip and link.
 */
export default function ConsentChip({ topicLabel }: { topicLabel?: string | null }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minHeight: 44 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Consent</span>
      <span style={{ fontSize: 12.5, padding: "2px 10px", borderRadius: 999, background: c.accentbg, color: c.accent, fontWeight: 600 }}>
        {topicLabel ? `Topic: ${topicLabel}` : "Any topic"}
      </span>
      <Link href={ROUTES.settingsMarketingConsent} target="_blank" style={{ fontSize: 12.5, color: c.accent, fontWeight: 600 }}>Change in Settings</Link>
      <InfoTip label="Consent">{COMPOSE_TIPS.consentChip}</InfoTip>
    </div>
  );
}
