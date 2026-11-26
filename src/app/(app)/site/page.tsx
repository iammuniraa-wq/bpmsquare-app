import { Suspense } from "react";
import { requireSitePage } from "@/lib/site/pageGuard";
import SiteHomeClient from "@/components/site/SiteHomeClient";

/** The phone home of the site person: Receive delivery, Add expense, what is waiting to upload. */
export default async function SitePage() {
  await requireSitePage("any");
  return <Suspense fallback={null}><SiteHomeClient /></Suspense>;
}
