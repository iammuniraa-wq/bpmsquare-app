"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFeel } from "@/components/FeelProvider";
import { c } from "@/lib/theme";
import { useSettings } from "@/lib/settings";
import { useTenant } from "@/lib/tenant-context";
import PageHeader from "@/components/PageHeader";
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
      <PageHeader
        title="Reset layout"
        subtitle="Restore navigation visibility and the compact sidebar to their defaults."
        action={<span style={{ fontSize: 12, color: "var(--teal)", fontWeight: 500, opacity: saved ? 1 : 0, transition: "opacity 0.3s" }}>✓ Saved</span>}
      />

      <Section id="reset" title="">
        <p style={{ margin: "0 0 14px", fontSize: 12.5, color: c.muted, lineHeight: 1.5 }}>
          Restore navigation visibility and compact sidebar to defaults, for the whole workspace. Accent colour and
          workspace name aren't reset since there's no default to go back to. Your data is not affected.
        </p>
        <button onClick={resetTenantDefaults} disabled={resetting} style={{ padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 500, background: "var(--redbg)", color: "var(--redink)", border: "1px solid var(--err-line)", cursor: "pointer" }}>
          {resetting ? "Resetting…" : "Reset navigation & layout to defaults"}
        </button>
      </Section>
    </div>
  );
}
