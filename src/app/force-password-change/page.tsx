import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAuthUser } from "@/lib/supabase-server";
import { isPrimaryOrDevHost } from "@/lib/constants";
import { getTenantBrandingByHost } from "@/lib/tenant";
import ForcePasswordChangeForm from "./ForcePasswordChangeForm";

export default async function ForcePasswordChangePage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const host = (await headers()).get("host")?.split(":")[0] ?? "";
  const branding = isPrimaryOrDevHost(host) ? null : await getTenantBrandingByHost(host);

  return <ForcePasswordChangeForm branding={branding} />;
}
