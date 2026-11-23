import { Suspense } from "react";
import { requireSitePage } from "@/lib/site/pageGuard";
import ReceiptFlow from "@/components/site/ReceiptFlow";

/** Receive delivery: pick the delivery, check the items, confirm. */
export default async function SiteReceiptCapturePage() {
  await requireSitePage("site_receipts");
  return <Suspense fallback={null}><ReceiptFlow /></Suspense>;
}
