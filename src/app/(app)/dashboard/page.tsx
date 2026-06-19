import { redirect } from "next/navigation";

// Dashboard moved to "/" — redirect any old bookmarks.
export default function DashboardRedirect() {
  redirect("/");
}
