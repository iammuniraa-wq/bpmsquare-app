"use client";

import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import { Toggle } from "@/components/settings/generalShared";
import { ACCENT_PRESETS, type AccentPreset } from "@/lib/settings";
import type { TenantFeatures } from "@/lib/constants";
import { SETTINGS_TIPS } from "@/lib/settingsTips";
import type { AppearanceDraft, Chrome, SpecColors, ThemeId } from "./appearanceLogic";
import s from "./appearance.module.css";

// Nova's presets. "Pink" stores nothing at all, so a workspace that goes back to it stays on Nova's true default.
const NOVA_PRESETS: { label: string; color: string | null }[] = [
  { label: "Pink", color: null },
  { label: "Orange", color: "#FF6B35" },
  { label: "Purple", color: "#7B2FBE" },
  { label: "Teal", color: "#14C8B4" },
  { label: "Blue", color: "#3C82FF" },
];
const NOVA_DEFAULT = "#E84393";

// A gradient pair plus the accent that reads beside it; picked as one click because the three have to agree.
const SPECTACULAR_MIXES: { label: string; from: string; to: string; accent: string }[] = [
  { label: "Violet", from: "#211046", to: "#14072E", accent: "#5129C4" },
  { label: "Midnight", from: "#132A5C", to: "#0A1733", accent: "#2563C9" },
  { label: "Forest", from: "#0F3B2E", to: "#07211A", accent: "#0E7C55" },
  { label: "Plum", from: "#4A1136", to: "#2B0820", accent: "#A6206A" },
  { label: "Graphite", from: "#26262E", to: "#131318", accent: "#4B4B7A" },
  { label: "Ember", from: "#4A1A12", to: "#2A0D08", accent: "#B4451F" },
];
const SPEC_DEFAULT = { shell_from: "#211046", shell_to: "#14072E", accent: "#5129C4" };

type ThemeTile = { value: ThemeId; label: string; swatch: string; gate?: keyof TenantFeatures };

/** Themes behind a platform-admin flag are offered only to the workspaces it was switched on for. */
const THEMES: ThemeTile[] = [
  { value: "classic", label: "Classic", swatch: "linear-gradient(135deg, #152233, #0e1a28)" },
  { value: "modern", label: "Modern", swatch: "linear-gradient(135deg, #14294b, #0a1830)" },
  { value: "nextgen", label: "Next-gen", swatch: "linear-gradient(135deg, #ffffff, #eef3fe)" },
  { value: "nextgen2", label: "Nova", swatch: "linear-gradient(135deg, #eef3fe, #dbe7fd)", gate: "next_experience" },
  { value: "enterprise", label: "Enterprise", swatch: "linear-gradient(135deg, #152233 0%, #152233 42%, #ffffff 42%, #ffffff 100%)", gate: "enterprise_theme" },
  { value: "spectacular", label: "Spectacular", swatch: "linear-gradient(135deg, #ffffff 0%, #edf3ff 55%, #1e3a6e 100%)", gate: "spectacular_theme" },
  { value: "spectacular_purple", label: "Spectacular Purple", swatch: "linear-gradient(135deg, #ffffff 0%, #efe9fd 55%, #4a2596 100%)", gate: "spectacular_theme" },
];

export const themeTiles = (features: Partial<TenantFeatures> | undefined) => THEMES.filter((t) => !t.gate || features?.[t.gate] === true);

const lower = (v: string) => v.toLowerCase();

function Chip({ selected, color, label, onClick }: { selected: boolean; color: string; label: string; onClick: () => void }) {
  return (
    <button type="button" className={s.chip} aria-pressed={selected} onClick={onClick}>
      <span className={s.dot} style={{ background: color }} />{label}
    </button>
  );
}

function AccentRow({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  return (
    <div className={s.chips}>
      {(Object.entries(ACCENT_PRESETS) as [AccentPreset, (typeof ACCENT_PRESETS)[AccentPreset]][]).map(([key, p]) => (
        <Chip key={key} selected={lower(value) === lower(p.color)} color={p.color} label={p.label} onClick={() => onChange(p.color)} />
      ))}
    </div>
  );
}

/** Theme tiles, the ONE colour row for the chosen theme, and the compact sidebar. Rare choices sit behind "More". */
export default function ThemeTab({ draft, features, accent, onChange }: {
  draft: AppearanceDraft;
  features: Partial<TenantFeatures> | undefined;
  accent: string;
  onChange: (patch: Partial<AppearanceDraft>) => void;
}) {
  const { theme } = draft;
  const spec = { ...SPEC_DEFAULT, ...(draft.spec ?? {}) };
  const setSpec = (patch: SpecColors) => onChange({ spec: { ...(draft.spec ?? {}), ...patch } });
  const setChrome = (key: keyof Chrome, v: boolean) => onChange({ chrome: { ...draft.chrome, [key]: v } });
  const novaOn = draft.novaAccent === "";

  return (
    <div className={s.card}>
      <div>
        <div className={s.label}><span className="bpm-t-label">Theme</span></div>
        <div className={s.tiles}>
          {themeTiles(features).map((t) => (
            <button key={t.value} type="button" className={s.tile} aria-pressed={theme === t.value} onClick={() => onChange({ theme: t.value })}>
              <span className={s.swatch} style={{ background: t.swatch }} />
              <span className={s.tileName}>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className={s.label}><span className="bpm-t-label">Colour</span></div>
        {theme === "nextgen2" ? (
          <div className={s.chips}>
            {NOVA_PRESETS.map((p) => (
              <Chip
                key={p.label} label={p.label} color={p.color ?? NOVA_DEFAULT}
                selected={p.color === null ? novaOn : lower(draft.novaAccent) === lower(p.color)}
                onClick={() => onChange({ novaAccent: p.color ?? "" })}
              />
            ))}
            <label className={s.picker}>
              <span>Custom</span>
              <input type="color" aria-label="Custom Nova colour" value={/^#[0-9a-fA-F]{6}$/.test(draft.novaAccent) ? draft.novaAccent : NOVA_DEFAULT} onChange={(e) => onChange({ novaAccent: e.target.value })} />
            </label>
          </div>
        ) : theme === "spectacular_purple" ? (
          <div className={s.chips}>
            {SPECTACULAR_MIXES.map((m) => (
              <button
                key={m.label} type="button" className={s.chip}
                aria-pressed={lower(spec.shell_from) === lower(m.from) && lower(spec.shell_to) === lower(m.to) && lower(spec.accent) === lower(m.accent)}
                onClick={() => onChange({ spec: { shell_from: m.from, shell_to: m.to, accent: m.accent } })}
              >
                <span className={s.dot} style={{ background: `linear-gradient(135deg, ${m.from}, ${m.to})` }} />{m.label}
              </button>
            ))}
          </div>
        ) : (
          <AccentRow value={draft.accent} onChange={(accentHex) => onChange({ accent: accentHex })} />
        )}
      </div>

      <div className={s.switchRow}>
        <span className={s.name}>Compact sidebar<InfoTip label="Compact sidebar">{SETTINGS_TIPS.compactSidebar}</InfoTip></span>
        <Toggle on={draft.compact} onChange={(v) => onChange({ compact: v })} accent={accent} label="Compact sidebar" />
      </div>

      {(theme === "nextgen" || theme === "nextgen2" || theme === "spectacular_purple") && (
        <details className={s.more}>
          <summary>More</summary>
          <div className={s.moreBody}>
            {theme === "nextgen" && (
              <div>
                <div className={s.label}><span className="bpm-t-label">Layout</span><InfoTip label="Layout">{SETTINGS_TIPS.layout}</InfoTip></div>
                {([
                  ["top_bar_identity", "Sign-in name in the top right", SETTINGS_TIPS.layoutIdentity],
                  ["command_palette", "Command palette on Ctrl + K", SETTINGS_TIPS.layoutPalette],
                  ["navy_sidebar", "Navy sidebar in light mode", SETTINGS_TIPS.layoutNavy],
                ] as const).map(([key, label, tip]) => (
                  <div key={key} className={s.switchRow}>
                    <span className={s.name}>{label}<InfoTip label={label}>{tip}</InfoTip></span>
                    <Toggle on={draft.chrome[key]} onChange={(v) => setChrome(key, v)} accent={accent} label={label} />
                  </div>
                ))}
              </div>
            )}
            {theme === "spectacular_purple" && (
              <div>
                <div className={s.label}><span className="bpm-t-label">Custom colours</span><InfoTip label="Custom colours">{SETTINGS_TIPS.spectacular}</InfoTip></div>
                <div className={s.pickers}>
                  {([["shell_from", "Shell, top"], ["shell_to", "Shell, bottom"], ["accent", "Accent"]] as const).map(([key, label]) => (
                    <label key={key} className={s.picker}>
                      <span>{label}</span>
                      <input type="color" value={spec[key]} aria-label={label} onChange={(e) => setSpec({ [key]: e.target.value })} />
                    </label>
                  ))}
                  <Button size="sm" onClick={() => onChange({ spec: null })}>Reset to violet</Button>
                </div>
              </div>
            )}
            {(theme === "nextgen2" || theme === "spectacular_purple") && (
              <div>
                <div className={s.label}><span className="bpm-t-label">Accent for links and tabs</span><InfoTip label="Accent for links and tabs">{SETTINGS_TIPS.accent}</InfoTip></div>
                <AccentRow value={draft.accent} onChange={(accentHex) => onChange({ accent: accentHex })} />
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
