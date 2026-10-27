import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import TemplateIcon from "@/components/estimator/TemplateIcon";
import { iconKeyFor, oneLine, sortForCards } from "@/lib/estimator/templateCard";
import type { CardTemplate } from "@/lib/estimator/templateCard";

/**
 * "What are you estimating?": one big card per active template (name, one plain line, icon).
 * A card goes to the working page with that template chosen. The last card starts from a
 * customer's email, where the AI picks the template.
 */
export default function TemplateCards({ templates, accountId, opportunityId, canPick }: { templates: CardTemplate[]; accountId?: string; opportunityId?: string; canPick: boolean }) {
  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams(extra);
    if (accountId) p.set("account_id", accountId);
    // A tender deal's estimate keeps its deal while the template is chosen (slice 3c-1).
    if (opportunityId) p.set("opportunity", opportunityId);
    return `${ROUTES.estimateNew}?${p.toString()}`;
  };
  const sorted = sortForCards(templates);
  return (
    <div className="est-pick" role="list">
      {sorted.map((t) => (
        <Link key={t.id} href={qs({ template: t.id })} className="est-pick-card" role="listitem">
          <span className="est-pick-icon"><TemplateIcon name={iconKeyFor(t)} size={30} /></span>
          <span className="est-pick-name">{t.name}</span>
          <span className="est-pick-line">{oneLine(t.description) || "Start an estimate from this template."}</span>
        </Link>
      ))}
      {canPick && sorted.length > 1 && (
        <Link href={qs({ template: sorted[0].id, email: "1" })} className="est-pick-card est-pick-email" role="listitem">
          <span className="est-pick-icon">
            <svg width="30" height="30" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="4" y="7" width="24" height="18" rx="2.5" /><path d="M5 9l11 8 11-8" />
            </svg>
          </span>
          <span className="est-pick-name">Not sure? Start from the customer&apos;s email</span>
          <span className="est-pick-line">Paste it and we choose the template and read the details for you to check.</span>
        </Link>
      )}
    </div>
  );
}
