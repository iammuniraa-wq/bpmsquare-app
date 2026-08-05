import { redirect } from "next/navigation";
import { getTenant } from "@/lib/tenant";
import PunchClient from "./PunchClient";

// Employee punch app — deliberately OUTSIDE the (app) CRM shell: employees
// get a focused mobile screen, not the desktop sidebar. Auth is enforced by
// middleware (unauthenticated → /login?next=/wfm-app).
export default async function WfmAppPage() {
  const tenant = await getTenant();
  if (!tenant?.features?.wfm) redirect("/");

  return <PunchClient tenantName={tenant.name} accentColor={tenant.accent_color ?? "#378ADD"} />;
}
