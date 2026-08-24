import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants";

// /pricing itself has no content -- Today's rates is the natural landing
// tab. Nothing links to bare ROUTES.pricing today, but a direct visit (or a
// future link) would otherwise 404 with no page.tsx in this exact segment.
export default function PricingIndexPage() {
  redirect(ROUTES.pricingToday);
}
