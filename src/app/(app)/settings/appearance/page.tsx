"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { useSettings, ACCENT_PRESETS } from "@/lib/settings";
import type { AccentPreset } from "@/lib/settings";
import { useTenant } from "@/lib/tenant-context";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import { SettingsInstantStatus } from "@/components/settings/SettingsHeaderActions";
import { Section, Toggle, useSavedFlash } from "@/components/settings/generalShared";
import InfoTip from "@/components/ui/InfoTip";
import { SETTINGS_TIPS } from "@/lib/settingsTips";

// Nova's own accent presets -- independent of ACCENT_PRESETS (classic/nextgen
// chrome). "Pink" (color: null) is Nova's shipped default -- it maps to no
// stored value at all, not a hardcoded hex, so a tenant that picks it back
// after trying another hue stays on Nova's true default rather than pinning
// today's hex forever.
const NOVA_ACCENT_PRESETS: { label: string; color: string | null }[] = [
  { label: "Pink (default)", color: null },
  { label: "Orange", color: "#FF6B35" },
  { label: "Purple", color: "#7B2FBE" },
  { label: "Teal", color: "#14C8B4" },
  { label: "Blue", color: "#3C82FF" },
];

/** Spectacular shell mixes. Each is a gradient PAIR plus the accent that
 *  reads on white beside it -- offered as one click because the three have to
 *  agree: a shell dark enough for white chrome, and an accent light enough to
 *  be a link but dark enough to be text. Picking the three separately is
 *  still there underneath for anyone who wants it. */
const SPECTACULAR_MIXES: { label: string; from: string; to: string; accent: string }[] = [
  { label: "Violet", from: "#211046", to: "#14072E", accent: "#5129C4" },
  { label: "Midnight", from: "#132A5C", to: "#0A1733", accent: "#2563C9" },
  { label: "Forest", from: "#0F3B2E", to: "#07211A", accent: "#0E7C55" },
  { label: "Plum", from: "#4A1136", to: "#2B0820", accent: "#A6206A" },
  { label: "Graphite", from: "#26262E", to: "#131318", accent: "#4B4B7A" },
  { label: "Ember", from: "#4A1A12", to: "#2A0D08", accent: "#B4451F" },
];

export default function ThemeAndColoursPage() {
  const router = useRouter();
  const { settings } = useSettings();
  const tenant = useTenant();
  const accent = tenant?.accent_color || ACCENT_PRESETS[settings.accentPreset].color;
  const [saved, flashSaved] = useSavedFlash();

  // ── Appearance — tenant-wide. Accent colour writes tenants.accent_color directly
  // (the same field the platform admin sets), so there's one source of truth, not
  // a local preset that gets silently overridden by it. ─────────────────────────
  const [apSaving, startApSave] = useTransition();
  const [compactSidebar, setCompactSidebar] = useState<boolean>(() => tenant?.config?.appearance?.compact_sidebar ?? false);
  const [accentColor, setAccentColor] = useState<string>(() => tenant?.accent_color || ACCENT_PRESETS.blue.color);
  // Provisioning sets the STARTING theme (TenantEditor.tsx); from here on it's
  // this workspace's own call, same as accent colour. useUiTheme() degrades a
  // retired "modern2"/"modern3" value to "modern" AND folds "nextgen2" into
  // "nextgen" (they share CSS) -- this picker needs the raw stored value so
  // a tenant on "nextgen2" sees that option selected, not plain "nextgen".
  const [theme, setTheme] = useState<"classic" | "modern" | "nextgen" | "nextgen2" | "enterprise" | "spectacular" | "spectacular_purple">(() => {
    const raw = tenant?.config?.appearance?.ui_theme as string | undefined;
    if (raw === "nextgen" || raw === "nextgen2" || raw === "enterprise" || raw === "spectacular" || raw === "spectacular_purple") return raw;
    if (raw === "modern" || raw === "modern2" || raw === "modern3") return "modern";
    return "classic";
  });
  const [themeSaving, startThemeSave] = useTransition();

  const saveTheme = (v: "classic" | "modern" | "nextgen" | "nextgen2" | "enterprise" | "spectacular" | "spectacular_purple") => {
    setTheme(v);
    startThemeSave(async () => {
      await fetch("/api/settings/entities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appearance: { ...tenant?.config?.appearance, ui_theme: v } }),
      });
      // A theme switch changes which major component tree Shell mounts
      // (Nova's sidebar/topbar/Account360Drawer/etc vs classic/modern's) --
      // router.refresh() only re-fetches server data and reconciles, it
      // does NOT force client components to remount, so any of THEIR
      // internal state (an open modal, a memoized layout choice) can
      // survive across the switch and end up paired with the new theme's
      // DOM (user-reported: switching nextgen -> Nova -> nextgen left the
      // page in a stuck, part-old-part-new visual state). A full reload
      // guarantees nothing stale survives a change this structural.
      flashSaved();
      window.location.reload();
    });
  };

  const saveAccentColor = (hex: string) => {
    setAccentColor(hex);
    startApSave(async () => {
      await fetch("/api/settings/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accent_color: hex }),
      });
      flashSaved();
      router.refresh();
    });
  };

  // Nova's own accent hue -- independent of the classic accentColor above
  // (see the comment on TenantConfig.appearance.nova_accent_color). Empty
  // string = unset = Nova's default pink.
  const [novaAccentColor, setNovaAccentColor] = useState<string>(() => tenant?.config?.appearance?.nova_accent_color ?? "");
  const saveNovaAccentColor = (hex: string | null) => {
    setNovaAccentColor(hex ?? "");
    startApSave(async () => {
      await fetch("/api/settings/entities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appearance: { ...tenant?.config?.appearance, nova_accent_color: hex || undefined } }),
      });
      flashSaved();
      router.refresh();
    });
  };

  // Which dashboard the workspace opens on. Unset resolves the same way
  // DashboardLayout resolves it -- curated on Spectacular, adaptive
  // elsewhere -- so this control never shows a value the app isn't using.
  const dashboardMode = tenant?.config?.appearance?.dashboard_mode
    ?? (tenant?.config?.appearance?.ui_theme === "spectacular_purple" || tenant?.config?.appearance?.ui_theme === "spectacular" ? "curated" : "adaptive");
  const saveDashboardMode = (m: "curated" | "adaptive") => {
    startApSave(async () => {
      await fetch("/api/settings/entities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appearance: { ...tenant?.config?.appearance, dashboard_mode: m } }),
      });
      flashSaved();
      router.refresh();
    });
  };

  // Spectacular's own three. Stored partially on purpose: a workspace that
  // only wants a different accent sets one key, and globals.css's
  // var(--spec-accent, #5129C4) fallbacks keep the rest as shipped. The
  // defaults below mirror those fallbacks, or the pickers would open on a
  // colour the app isn't actually using.
  const specColors = tenant?.config?.appearance?.spectacular_colors;
  const specFrom = specColors?.shell_from ?? "#211046";
  const specTo = specColors?.shell_to ?? "#14072E";
  const specAccent = specColors?.accent ?? "#5129C4";
  // null clears the whole object -- back to the shipped violet.
  const saveSpectacularColors = (patch: { shell_from?: string; shell_to?: string; accent?: string } | null) => {
    const next = patch === null ? undefined : { ...(specColors ?? {}), ...patch };
    startApSave(async () => {
      await fetch("/api/settings/entities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appearance: { ...tenant?.config?.appearance, spectacular_colors: next } }),
      });
      flashSaved();
      router.refresh();
    });
  };

  // Three pieces of chrome that used to require adopting a whole theme behind
  // a platform-admin flag. Each writes one boolean into config.appearance and
  // reloads, for the same reason saveTheme does: they change which components
  // Shell mounts, and router.refresh() doesn't remount client components.
  // On by default -- these ship WITH nextgen (see nextgenChromeOn); only an
  // explicit false, set right here, turns one off. Mirrors the hooks exactly,
  // or the switch would show off while the chrome is on.
  const [chrome, setChrome] = useState(() => ({
    top_bar_identity: tenant?.config?.appearance?.top_bar_identity !== false,
    command_palette: tenant?.config?.appearance?.command_palette !== false,
    navy_sidebar: tenant?.config?.appearance?.navy_sidebar !== false,
  }));
  const saveChrome = (key: keyof typeof chrome, v: boolean) => {
    const next = { ...chrome, [key]: v };
    setChrome(next);
    startApSave(async () => {
      await fetch("/api/settings/entities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appearance: { ...tenant?.config?.appearance, ...next } }),
      });
      flashSaved();
      window.location.reload();
    });
  };

  const saveCompactSidebar = (v: boolean) => {
    setCompactSidebar(v);
    startApSave(async () => {
      // The route replaces config.appearance wholesale (it's a shallow merge
      // at the config-root level) -- spread the current object in, or this
      // silently drops whatever theme was just chosen above.
      await fetch("/api/settings/entities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appearance: { ...tenant?.config?.appearance, compact_sidebar: v } }),
      });
      flashSaved();
      router.refresh();
    });
  };

  return (
    <div style={{ maxWidth: 680 }}>
      <SettingsPageHeader title="Theme & colours" info={SETTINGS_TIPS.appearance} />
      <SettingsInstantStatus saved={saved} saving={themeSaving || apSaving} />

      <Section id="appearance" title="">
        <div style={{ marginBottom: 20 }}>
          <div className="bpm-t-label" style={{ marginBottom: 10 }}>Theme</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
            {([
              { value: "classic" as const, label: "Classic", desc: "Dark navy sidebar, the original look.", swatch: "linear-gradient(135deg, #152233, #0e1a28)" },
              { value: "modern" as const, label: "Modern", desc: "Denser cards, sharper borders, navy + gold.", swatch: "linear-gradient(135deg, #14294b, #0a1830)" },
              { value: "nextgen" as const, label: "Next-gen", desc: "Flat, minimal, real icons — with dark mode.", swatch: "linear-gradient(135deg, #ffffff, #eef3fe)" },
              // Next Experience program: offered only to tenants the PLATFORM
              // admin has flagged in (demo first, clients after validation) --
              // a workspace admin can't opt into the experiment on their own.
              ...(tenant?.features?.next_experience === true
                ? [{ value: "nextgen2" as const, label: "Nova", desc: "BPMSquare Nova — the Business OS. Command palette, engagement layer, identity in the top bar.", swatch: "linear-gradient(135deg, #eef3fe, #dbe7fd)" }]
                : []),
              // Same platform-admin-only gate (owner correction 2026-08-25:
              // this shipped without one and surfaced directly in the demo
              // tenant's own picker, which isn't this codebase's pattern).
              ...(tenant?.features?.enterprise_theme === true
                ? [{ value: "enterprise" as const, label: "Enterprise", desc: "Dark navy sidebar, clean white workspace.", swatch: "linear-gradient(135deg, #152233 0%, #152233 42%, #ffffff 42%, #ffffff 100%)" }]
                : []),
              // Same platform-admin-only gate as the two above.
              // One flag, two palettes -- same theme, same rules, different
              // hue (see useSpectacularVariant()). Listed as two options
              // because a palette is what a workspace actually picks.
              ...(tenant?.features?.spectacular_theme === true
                ? [
                    { value: "spectacular" as const, label: "Spectacular", desc: "Navy band, colour-filled KPI cards, white rail. Light only.", swatch: "linear-gradient(135deg, #ffffff 0%, #edf3ff 55%, #1e3a6e 100%)" },
                    { value: "spectacular_purple" as const, label: "Spectacular Purple", desc: "The same, in violet and lilac. Light only.", swatch: "linear-gradient(135deg, #ffffff 0%, #efe9fd 55%, #4a2596 100%)" },
                  ]
                : []),
            ]).map((opt) => {
              const selected = theme === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => !themeSaving && saveTheme(opt.value)}
                  style={{
                    display: "flex", flexDirection: "column", gap: 8, padding: 12, borderRadius: 10,
                    border: selected ? `2px solid ${accent}` : `1px solid ${c.line}`,
                    background: c.panel, cursor: themeSaving ? "wait" : "pointer", textAlign: "left",
                  }}
                >
                  <span style={{ height: 34, borderRadius: 6, background: opt.swatch, border: `1px solid ${c.line}` }} />
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: selected ? accent : c.ink }}>{opt.label}</span>
                    {selected && <span style={{ fontSize: 11, color: accent }}>✓</span>}
                  </span>
                  <span className="bpm-t-help">{opt.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ marginBottom: 20, paddingTop: 16, borderTop: `1px solid ${c.line}` }}>
          <div className="bpm-t-label" style={{ marginBottom: 10 }}>Accent colour</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {(Object.entries(ACCENT_PRESETS) as [AccentPreset, typeof ACCENT_PRESETS[AccentPreset]][]).map(([key, preset]) => {
              const selected = accentColor.toLowerCase() === preset.color.toLowerCase();
              return (
                <button key={key} onClick={() => !apSaving && saveAccentColor(preset.color)} title={preset.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 8, cursor: "pointer", border: selected ? `2px solid ${preset.color}` : `2px solid ${c.line}`, background: selected ? preset.colorBg : "var(--panel)", transition: "all 0.15s" }}>
                  <span style={{ width: 14, height: 14, borderRadius: "50%", background: preset.color, flexShrink: 0, boxShadow: selected ? `0 0 0 2px ${preset.color}44` : "none" }} />
                  <span style={{ fontSize: 12.5, fontWeight: selected ? 600 : 400, color: selected ? preset.color : c.muted }}>{preset.label}</span>
                  {selected && <span style={{ fontSize: 12, color: preset.color }}>✓</span>}
                </button>
              );
            })}
          </div>
        </div>
        {tenant?.features?.next_experience === true && (
          <div style={{ marginBottom: 20, paddingTop: 16, borderTop: `1px solid ${c.line}` }}>
            <LabelWithTip label="Nova accent colour" tip={SETTINGS_TIPS.novaAccent} />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              {NOVA_ACCENT_PRESETS.map((preset) => {
                const selected = novaAccentColor === "" ? preset.color === null : novaAccentColor.toLowerCase() === preset.color?.toLowerCase();
                return (
                  <button key={preset.label} onClick={() => !apSaving && saveNovaAccentColor(preset.color)} title={preset.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 8, cursor: "pointer", border: selected ? `2px solid ${preset.color ?? "#E84393"}` : `2px solid ${c.line}`, background: selected ? "var(--panel2)" : "var(--panel)", transition: "all 0.15s" }}>
                    <span style={{ width: 14, height: 14, borderRadius: "50%", background: preset.color ?? "linear-gradient(135deg, #FF6B35, #E84393)", flexShrink: 0, boxShadow: selected ? `0 0 0 2px ${(preset.color ?? "#E84393")}44` : "none" }} />
                    <span style={{ fontSize: 12.5, fontWeight: selected ? 600 : 400, color: selected ? (preset.color ?? "#E84393") : c.muted }}>{preset.label}</span>
                    {selected && <span style={{ fontSize: 12, color: preset.color ?? "#E84393" }}>✓</span>}
                  </button>
                );
              })}
              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 8, border: `2px solid ${c.line}`, cursor: "pointer" }}>
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(novaAccentColor) ? novaAccentColor : "#E84393"}
                  onChange={(e) => !apSaving && saveNovaAccentColor(e.target.value)}
                  style={{ width: 22, height: 22, border: "none", padding: 0, background: "none", cursor: "pointer" }}
                />
                <span className="bpm-t-help">Custom</span>
              </label>
            </div>
          </div>
        )}
        <div style={{ marginBottom: 20, paddingTop: 16, borderTop: `1px solid ${c.line}` }}>
          <LabelWithTip label="Dashboard" tip={SETTINGS_TIPS.dashboard} />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {([
              { value: "curated" as const, label: "Curated", desc: "A fixed set of cards, in a set order" },
              { value: "adaptive" as const, label: "My layout", desc: "Whatever each person arranged" },
            ]).map((opt) => {
              const selected = dashboardMode === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => !apSaving && saveDashboardMode(opt.value)}
                  style={{
                    textAlign: "left", padding: "10px 14px", borderRadius: 9, cursor: "pointer",
                    background: selected ? "var(--panel2)" : "var(--panel)",
                    border: selected ? `2px solid ${c.accent}` : `2px solid ${c.line}`,
                    minWidth: 210,
                  }}
                >
                  <div style={{ fontSize: 12.5, fontWeight: selected ? 700 : 500, color: selected ? c.accent : c.ink }}>
                    {opt.label}{selected ? " ✓" : ""}
                  </div>
                  <div className="bpm-t-help" style={{ marginTop: 2 }}>{opt.desc}</div>
                </button>
              );
            })}
          </div>
        </div>
        {theme === "spectacular_purple" && (
          <div style={{ marginBottom: 20, paddingTop: 16, borderTop: `1px solid ${c.line}` }}>
            <LabelWithTip label="Spectacular colours" tip={SETTINGS_TIPS.spectacular} />

            {/* The live shell, not a description of it. Everything below sets
                the same three values this strip is drawn from, so what you see
                here is what the workspace will look like. */}
            <div style={{
              borderRadius: 12, padding: "16px 16px 14px", marginBottom: 14,
              background: `linear-gradient(158deg, ${specFrom} 0%, ${specTo} 78%)`,
            }}>
              <div style={{ background: "#fff", borderRadius: 9, padding: "12px 14px" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#171227" }}>Good morning</div>
                <div style={{ fontSize: 11.5, color: "#6B6285", marginTop: 2 }}>
                  The sheet stays white — only the shell and the accent move.
                </div>
                <div style={{ display: "flex", gap: 7, marginTop: 10, alignItems: "center" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: specAccent }}>A link</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: specAccent, borderRadius: 6, padding: "4px 10px" }}>A button</span>
                </div>
              </div>
            </div>

            <div style={{ fontSize: 11.5, fontWeight: 600, color: c.muted, marginBottom: 8 }}>Mixes</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              {SPECTACULAR_MIXES.map((mix) => {
                const selected =
                  specFrom.toLowerCase() === mix.from.toLowerCase() &&
                  specTo.toLowerCase() === mix.to.toLowerCase() &&
                  specAccent.toLowerCase() === mix.accent.toLowerCase();
                return (
                  <button
                    key={mix.label}
                    onClick={() => !apSaving && saveSpectacularColors({ shell_from: mix.from, shell_to: mix.to, accent: mix.accent })}
                    title={mix.label}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "7px 12px 7px 8px",
                      borderRadius: 9, cursor: "pointer", background: "var(--panel)",
                      border: selected ? `2px solid ${mix.accent}` : `2px solid ${c.line}`,
                    }}
                  >
                    <span style={{
                      width: 30, height: 18, borderRadius: 5, flexShrink: 0,
                      background: `linear-gradient(135deg, ${mix.from}, ${mix.to})`,
                    }} />
                    <span style={{ fontSize: 12.5, fontWeight: selected ? 600 : 400, color: selected ? mix.accent : c.muted }}>{mix.label}</span>
                    {selected && <span style={{ fontSize: 12, color: mix.accent }}>✓</span>}
                  </button>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-end" }}>
              {([
                { key: "shell_from" as const, label: "Shell, top", value: specFrom },
                { key: "shell_to" as const, label: "Shell, bottom", value: specTo },
                { key: "accent" as const, label: "Accent", value: specAccent },
              ]).map(({ key, label, value }) => (
                <label key={key} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <span className="bpm-t-help">{label}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 9px", borderRadius: 8, border: `1px solid ${c.line}` }}>
                    <input
                      type="color"
                      value={value}
                      onChange={(e) => !apSaving && saveSpectacularColors({ [key]: e.target.value })}
                      style={{ width: 24, height: 24, border: "none", padding: 0, background: "none", cursor: "pointer" }}
                    />
                    <span style={{ fontSize: 12, fontFamily: "ui-monospace, monospace", color: c.muted }}>{value.toUpperCase()}</span>
                  </span>
                </label>
              ))}
              <button
                onClick={() => !apSaving && saveSpectacularColors(null)}
                style={{
                  fontSize: 12, fontWeight: 600, color: c.hint, background: "transparent",
                  border: `1px solid ${c.line}`, borderRadius: 8, padding: "8px 14px", cursor: "pointer",
                }}
              >
                Reset to violet
              </button>
            </div>
          </div>
        )}
        {/* Plain nextgen only -- Nova has its own answers for all three, and
            classic/modern build their chrome differently. */}
        {theme === "nextgen" && (
          <div style={{ marginBottom: 4, paddingTop: 16, borderTop: `1px solid ${c.line}` }}>
            <LabelWithTip label="Layout" tip={SETTINGS_TIPS.layout} />
            {([
              { key: "top_bar_identity" as const, label: "Sign-in name in the top right", hint: SETTINGS_TIPS.layoutIdentity },
              { key: "command_palette" as const, label: "Command palette on Ctrl + K", hint: SETTINGS_TIPS.layoutPalette },
              { key: "navy_sidebar" as const, label: "Navy sidebar in light mode", hint: SETTINGS_TIPS.layoutNavy },
            ]).map(({ key, label, hint }, i) => (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderTop: i > 0 ? `1px solid ${c.line}` : "none" }}>
                <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center" }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: c.ink }}>{label}</span>
                  <InfoTip label={label}>{hint}</InfoTip>
                </div>
                <Toggle on={chrome[key]} onChange={(v) => !apSaving && saveChrome(key, v)} accent={accent} />
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 14, borderTop: `1px solid ${c.line}` }}>
          <div>
            <div style={{ display: "flex", alignItems: "center" }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: c.ink }}>Compact sidebar</span>
              <InfoTip label="Compact sidebar">{SETTINGS_TIPS.compactSidebar}</InfoTip>
            </div>
          </div>
          <Toggle on={compactSidebar} onChange={(v) => !apSaving && saveCompactSidebar(v)} accent={accent} />
        </div>
      </Section>
    </div>
  );
}

function LabelWithTip({ label, tip }: { label: string; tip: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
      <span className="bpm-t-label">{label}</span>
      <InfoTip label={label}>{tip}</InfoTip>
    </div>
  );
}
