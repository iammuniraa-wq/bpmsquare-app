import type { Tenant } from "@/lib/tenant";
import { canCreateWorkcenter } from "@/lib/permissions";
import type { resolvePermissions } from "@/lib/permissions";

/** Whether this person can turn an estimate into a Standard Quote, and the plain reason when they cannot. */
export function quoteAbility(
  perms: Awaited<ReturnType<typeof resolvePermissions>>,
  tenant: Pick<Tenant, "features"> | null,
  canEdit: boolean,
  hasQuote: boolean,
): { canQuote: boolean; quoteUnavailable: string | null } {
  const quotesOn = tenant?.features?.standard_quotes === true;
  const canQuote = canEdit && quotesOn && canCreateWorkcenter(perms, "standard_quotes");
  const quoteUnavailable = !quotesOn
    ? "Standard Quotes isn't enabled for your workspace, so this estimate has nowhere to become a quote."
    : !canQuote && !hasQuote ? "You don't have permission to create a quote." : null;
  return { canQuote, quoteUnavailable };
}
