import { redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { ROUTES } from "@/lib/constants";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import OutboundEmailsClient from "./OutboundEmailsClient";

export default async function OutboundEmailsPage() {
  let role: string;
  try {
    ({ role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.dashboard);
  }
  if (role !== "admin") redirect(ROUTES.dashboard);

  return (
    <>
      <TabTitle title="Outbound Emails" />
      <PageHeader
        title="Outbound Emails"
        subtitle="Every quote email and campaign send recorded at the moment it was attempted — filter by channel, or a specific record's ID, then download as CSV."
      />
      <OutboundEmailsClient />
    </>
  );
}
