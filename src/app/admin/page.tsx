import { redirect } from "next/navigation";

// The platform admin's home is the Instances screen (every instance and every tenant in one place). The list of THIS database's
// tenants moved to /admin/tenants.
export default function AdminHome() {
  redirect("/admin/instances");
}
