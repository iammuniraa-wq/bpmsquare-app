import { headers } from "next/headers";
import { isPrimaryOrDevHost } from "@/lib/constants";
import { getTenantBrandingByHost } from "@/lib/tenant";
import ResetPasswordForm from "./ResetPasswordForm";

export default async function ResetPasswordPage() {
  const host = (await headers()).get("host")?.split(":")[0] ?? "";
  const branding = isPrimaryOrDevHost(host) ? null : await getTenantBrandingByHost(host);

  return <ResetPasswordForm branding={branding} />;
}
