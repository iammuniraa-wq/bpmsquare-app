import { NextResponse } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { ROUTES } from "@/lib/constants";

// Where a FRESH LOGIN should land -- called once by LoginForm right after
// sign-in succeeds, and only when the caller didn't already ask for a
// specific `next` (an invite link, a deep link, etc. always wins). Anyone
// whose login is linked to a WFM employee record lands on My Workforce
// instead of the KPI dashboard (owner decision 2026-09-08, after BIM
// employees asked why login shows a dashboard instead of straight to
// punch) -- deliberately scoped to login only, not a redirect baked into
// the dashboard page itself, so the sidebar's own Dashboard link still
// works normally once inside the app.
export async function GET() {
  try {
    const { supabase, tenantId, userId } = await requireTenantUser();
    if (!(await tenantHasFeature(supabase, tenantId, "wfm"))) {
      return NextResponse.json({ path: ROUTES.dashboard });
    }
    const { data: membership } = await supabase
      .from("tenant_users").select("employee_id").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
    // Both settings agree on one thing: a login with no employee record must
    // not be sent to My Workforce, because all that page can tell them is
    // that they aren't set up yet. `landing_page: "my_workforce"` widens WHO
    // goes there (every role, supervisors and admins included, rather than
    // only non-supervisor employees) -- it does not remove that floor.
    return NextResponse.json({ path: membership?.employee_id ? ROUTES.wfmMe : ROUTES.dashboard });
  } catch {
    return NextResponse.json({ path: ROUTES.dashboard });
  }
}
