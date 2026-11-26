import { Suspense } from "react";
import { requireSitePage } from "@/lib/site/pageGuard";
import ExpenseCapture from "@/components/site/ExpenseCapture";

/** Add expense: photo first, then a category and Submit. */
export default async function SiteExpenseCapturePage() {
  await requireSitePage("site_expenses");
  return <Suspense fallback={null}><ExpenseCapture /></Suspense>;
}
