"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import { c } from "@/lib/theme";
import { useSettings, ACCENT_PRESETS } from "@/lib/settings";
import { useTenant } from "@/lib/tenant-context";
import PageHeader from "@/components/PageHeader";
import { Section, useSavedFlash } from "@/components/settings/generalShared";

export default function CompanyProfilePage() {
  const router = useRouter();
  const { settings } = useSettings();
  const tenant = useTenant();
  const accent = tenant?.accent_color || ACCENT_PRESETS[settings.accentPreset].color;
  const [saved, flashSaved] = useSavedFlash();

  // ── Workspace name — writes tenants.name directly ──────────────────────────
  const [wsName, setWsName] = useState(tenant?.name ?? "");
  const [wsSaving, startWsSave] = useTransition();
  const wsNameDirty = wsName.trim() !== "" && wsName.trim() !== (tenant?.name ?? "");

  const saveWorkspaceName = () => {
    const name = wsName.trim();
    startWsSave(async () => {
      await fetch("/api/settings/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      flashSaved();
      router.refresh();
    });
  };

  return (
    <div style={{ maxWidth: 680 }}>
      <PageHeader
        title="Company profile"
        subtitle="Your organisation's name, shown in the sidebar header."
        action={<span style={{ fontSize: 12, color: "var(--teal)", fontWeight: 500, opacity: saved ? 1 : 0, transition: "opacity 0.3s" }}>✓ Saved</span>}
      />

      {/* ── 4. Workspace ── */}
      <Section
        id="workspace"
        title="Workspace name"
        description="Your organisation's name, shown in the sidebar header."
      >
        <div style={{ display: "flex", gap: 10 }}>
          <input value={wsName} onChange={(e) => setWsName(e.target.value)} placeholder="Workspace name" style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: `1px solid ${wsNameDirty ? accent : c.line}`, fontSize: 13, color: c.ink, outline: "none", transition: "border-color 0.15s" }} />
          <button onClick={saveWorkspaceName} disabled={!wsNameDirty || wsSaving} style={{ padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 500, border: "none", cursor: wsNameDirty ? "pointer" : "default", background: wsNameDirty ? accent : c.line, color: wsNameDirty ? "#fff" : c.hint, transition: "all 0.15s" }}>
            {wsSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </Section>

      {tenant?.features?.quotations === true && (
        <p style={{ fontSize: 12, color: c.hint, margin: "4px 2px 0", lineHeight: 1.5 }}>
          Legal entities, logo, letterhead and tax are under <Link href={ROUTES.settingsEntities} style={{ color: c.accent }}>Entities &amp; Tax</Link>.
        </p>
      )}
    </div>
  );
}
