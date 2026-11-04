import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants";

// The Newsletters list lives under Email now (docs/design/marketing-two-parts.md). Old bookmarks and links land there.
export default async function NewslettersPage({ searchParams }: { searchParams: Promise<{ q?: string; template?: string; page?: string }> }) {
  const sp = await searchParams;
  const q = new URLSearchParams({ view: sp.template ? "templates" : "designs" });
  if (sp.q) q.set("q", sp.q);
  if (sp.page) q.set("page", sp.page);
  redirect(`${ROUTES.marketingEmail}?${q.toString()}`);
}
