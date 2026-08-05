import { redirect } from "next/navigation";
import { getTenant } from "@/lib/tenant";
import CorrectionsClient from "./CorrectionsClient";

export default async function WfmCorrectionsPage() {
  const tenant = await getTenant();
  if (!tenant?.features?.wfm) redirect("/");
  return <CorrectionsClient accentColor={tenant.accent_color ?? "#378ADD"} />;
}
