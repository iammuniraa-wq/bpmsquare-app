import { redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { requireTenantUser } from "@/lib/supabase-server";
import NumberRangesClient from "./NumberRangesClient";

// One address for every business-ID convention in the product (owner
// decision 2026-08-15): IDs are always system-generated; the ONLY user
// influence is the format/number-range configuration on this page.
export default async function NumberRangesPage() {
  const { role } = await requireTenantUser();
  if (role !== "admin") redirect("/settings");

  return (
    <>
      <PageHeader
        title="Number Ranges"
        subtitle="How every business ID in this workspace is generated — IDs are always assigned by the system, never typed"
      />
      <NumberRangesClient />
    </>
  );
}
