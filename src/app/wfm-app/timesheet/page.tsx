import { redirect } from "next/navigation";

// See src/app/wfm-app/page.tsx -- the whole /wfm-app tree redirects to
// My Workforce (/wfm/me), which now includes this month's hours inline.
export default function WfmAppTimesheetRedirect() {
  redirect("/wfm/me");
}
