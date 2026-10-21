"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import { SETTINGS_TIPS } from "@/lib/settingsTips";
import { c } from "@/lib/theme";
import { useTenant } from "@/lib/tenant-context";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import { Section, useSavedFlash } from "@/components/settings/generalShared";
import { Input } from "@/components/ui/Input";

export default function CompanyProfilePage() {
  const router = useRouter();
  const tenant = useTenant();
  const [saved, flashSaved] = useSavedFlash();

  // ── Workspace name — writes tenants.name directly ──────────────────────────
  const [wsName, setWsName] = useState(tenant?.name ?? "");
  const [storedName, setStoredName] = useState(tenant?.name ?? "");
  const [wsSaving, setWsSaving] = useState(false);
  const [error, setError] = useState("");
  const wsNameDirty = wsName.trim() !== "" && wsName.trim() !== storedName;

  const saveWorkspaceName = async () => {
    const name = wsName.trim();
    setWsSaving(true);
    setError("");
    const res = await fetch("/api/settings/workspace", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    setWsSaving(false);
    if (!res) { setError("Network error"); return; }
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? "Could not save"); return; }
    setStoredName(name);
    flashSaved();
    router.refresh();
  };

  return (
    <div style={{ maxWidth: 680 }}>
      <SettingsPageHeader title="Company profile" info={SETTINGS_TIPS.company} />
      <SettingsSave dirty={wsNameDirty} saving={wsSaving} saved={saved} error={error} onSave={saveWorkspaceName} />

      <Section title="Workspace name">
        <Input
          aria-label="Workspace name"
          value={wsName}
          onChange={(e) => setWsName(e.target.value)}
          placeholder="Workspace name"
        />
      </Section>

      {tenant?.features?.quotations === true && (
        <p className="bpm-t-help" style={{ margin: "4px 2px 0" }}>
          Legal entities, logo, letterhead and tax are under <Link href={ROUTES.settingsEntities} style={{ color: c.accent }}>Entities &amp; Tax</Link>.
        </p>
      )}
    </div>
  );
}
