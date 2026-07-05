import { redirect } from "next/navigation";
import { getUserRole } from "@/lib/tenant";
import SettingsTabs from "./SettingsTabs";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const role = await getUserRole();

  // Members cannot access settings at all — redirect to dashboard
  if (role === "member") redirect("/");

  const isAdmin = role === "admin";

  return (
    <SettingsTabs isAdmin={isAdmin}>
      {children}
    </SettingsTabs>
  );
}
