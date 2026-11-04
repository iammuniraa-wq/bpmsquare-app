import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants";

// Scored leads is the Scored view of Leads now (docs/design/marketing-two-parts.md, slice 6). Old bookmarks, briefing
// links and notices land there with their search, stage, sort and page.
export default async function ScoredLeadsRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams({ view: "scored" });
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "view") q.set(k, v);
  redirect(`${ROUTES.leads}?${q.toString()}`);
}
