import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants";

// Pricing Engine moved into its own workcenter (owner decision 2026-08-23:
// "workcenter first" -- Business-Role-scoped access, not admin-only) — the
// raw config cockpit that used to live here now lives at /pricing/advanced,
// gated by PricingLayout (requireWorkcenterView("pricing") + the
// pricing_engine feature flag) instead of the admin-only check this page
// used to do itself. Kept as a redirect rather than deleted so old links
// (bookmarks, the Settings hub tile before it's updated) keep working.
export default function PricingEnginePage() {
  redirect(ROUTES.pricingAdvanced);
}
