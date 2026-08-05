import { redirect } from "next/navigation";

// See src/app/wfm-app/page.tsx -- the whole /wfm-app tree redirects to
// My Workforce (/wfm/me), which now includes corrections requests inline.
export default function WfmAppCorrectionsRedirect() {
  redirect("/wfm/me");
}
