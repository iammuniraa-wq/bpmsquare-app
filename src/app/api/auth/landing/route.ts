import { NextResponse } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { getTenant } from "@/lib/tenant";
import { DEFAULT_WFM_CONFIG, ROUTES } from "@/lib/constants";

// Where a FRESH LOGIN should land -- called once by LoginForm right after
// sign-in succeeds, and only when the caller didn't already ask for a
// specific `next` (an invite link, a deep link, etc. always wins).
//
// A workspace can send its employees straight to the punch instead of the
// dashboard: config.wfm.home_landing, default "dashboard" (owner correction
// 2026-09-21 -- it was product-wide, and only one client actually wants it).
// This is the ONLY place that rule is applied. It used to be enforced as a
// redirect on "/" in (app)/layout.tsx as well, which meant it fired on every
// visit rather than at login: an admin who pressed Dashboard, or who landed
// back on "/" after saving a setting, was bounced into the punch screen
// mid-task. A landing page happens once, so it lives at login only.
export async function GET() {
  try {
    const { supabase, tenantId, userId } = await requireTenantUser();
    const tenant = await getTenant();
    if (tenant?.features?.wfm !== true) {
      return NextResponse.json({ path: ROUTES.dashboard });
    }
    const landing = tenant?.config?.wfm?.home_landing ?? DEFAULT_WFM_CONFIG.home_landing;
    if (landing !== "my_workforce") {
      return NextResponse.json({ path: ROUTES.dashboard });
    }
    const { data: membership } = await supabase
      .from("tenant_users").select("employee_id").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
    // Every role with an employee record lands on My Workforce -- employee,
    // supervisor and admin alike (owner decision 2026-09-10), for a tenant
    // that asked for it. A login with NO employee record still gets the
    // dashboard: My Workforce could only tell that person they aren't set up
    // yet, which is a dead end rather than a landing page.
    return NextResponse.json({ path: membership?.employee_id ? ROUTES.wfmMe : ROUTES.dashboard });
  } catch {
    return NextResponse.json({ path: ROUTES.dashboard });
  }
}
