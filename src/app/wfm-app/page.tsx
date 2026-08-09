import { redirect } from "next/navigation";

// /wfm-app is retired in favour of My Workforce (/wfm/me), living inside the
// normal CRM shell instead of a separate standalone mini-app -- see
// src/app/(app)/wfm/me/page.tsx. Kept as a redirect (not deleted outright)
// so old bookmarks, "Add to Home Screen" shortcuts, and any invite link
// already sent still land somewhere useful.
export default function WfmAppRedirect() {
  redirect("/wfm/me");
}
