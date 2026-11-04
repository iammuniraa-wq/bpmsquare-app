import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants";

// The campaign list lives under Email now (docs/design/marketing-two-parts.md). Old bookmarks and links land there.
export default async function MarketingPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  if (sp.q) q.set("q", sp.q);
  if (sp.page) q.set("page", sp.page);
  const qs = q.toString();
  redirect(qs ? `${ROUTES.marketingEmail}?${qs}` : ROUTES.marketingEmail);
}
