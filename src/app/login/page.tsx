import { headers } from "next/headers";
import { isPrimaryOrDevHost } from "@/lib/constants";
import { getTenantBrandingByHost } from "@/lib/tenant";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const host = (await headers()).get("host")?.split(":")[0] ?? "";
  const branding = isPrimaryOrDevHost(host) ? null : await getTenantBrandingByHost(host);

  return <LoginForm branding={branding} />;
}
