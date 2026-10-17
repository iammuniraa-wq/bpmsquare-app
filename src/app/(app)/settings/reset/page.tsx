"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFeel } from "@/components/FeelProvider";
import { c } from "@/lib/theme";
import { useSettings } from "@/lib/settings";
import { useTenant } from "@/lib/tenant-context";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import Button from "@/components/ui/Button";
import { Section, useSavedFlash } from "@/components/settings/generalShared";

export default function ResetLayoutPage() {
  const router = useRouter();
  const { reset } = useSettings();
  const tenant = useTenant();
  const { confirm } = useFeel();
  const [saved, flashSaved] = useSavedFlash();

  // ── Reset ────────────────────────────────────────────────────────────────────
  const [resetting, startReset] = useTransition();
  const resetTenantDefaults = async () => {
    if (!(await confirm({ title: "Reset navigation to defaults?", body: "Nav visibility and the compact sidebar go back to their defaults. Accent colour, workspace name and theme are untouched.", confirmLabel: "Reset" }))) return;
    startReset(async () => {
      // appearance is replaced wholesale by the route -- keep the theme
      // choice by carrying it forward explicitly, or this silently reverts
      // it to classic along with the things actually meant to be reset.
      await fetch("/api/settings/entities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nav_hidden_hrefs: [], appearance: { ui_theme: tenant?.config?.appearance?.ui_theme } }),
      });
      reset();
      flashSaved();
      router.refresh();
    });
  };

  return (
    <div style={{ maxWidth: 680 }}>
      <SettingsPageHeader title="Reset layout" subtitle="Restore navigation visibility and the compact sidebar to their defaults." />

      <Section id="reset" title="">
        <p style={{ margin: "0 0 14px", fontSize: 12.5, color: c.muted, lineHeight: 1.5 }}>
          Restore navigation visibility and compact sidebar to defaults, for the whole workspace. Accent colour and
          workspace name aren't reset since there's no default to go back to. Your data is not affected.
        </p>
        <Button variant="danger" onClick={resetTenantDefaults} loading={resetting}>
          {resetting ? "Resetting…" : "Reset navigation & layout to defaults"}
        </Button>
        {saved && <span role="status" style={{ marginLeft: 12, fontSize: 12.5, color: "var(--teal)" }}>✓ Reset</span>}
      </Section>
    </div>
  );
}
