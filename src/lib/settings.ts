"use client";

import { useEffect, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AccentPreset = "blue" | "teal" | "orange" | "purple" | "slate";

export type AppSettings = {
  hiddenNavHrefs: string[];
  accentPreset: AccentPreset;
  workspaceName: string;
  compactSidebar: boolean;
};

// ── Accent presets ────────────────────────────────────────────────────────────

export const ACCENT_PRESETS: Record<
  AccentPreset,
  { label: string; color: string; colorBg: string }
> = {
  blue:   { label: "Blue",   color: "#378ADD", colorBg: "#e6f1fb" },
  teal:   { label: "Teal",   color: "#0d9488", colorBg: "#e0f7f5" },
  orange: { label: "Orange", color: "#ea7316", colorBg: "#fff4ea" },
  purple: { label: "Purple", color: "#7c3aed", colorBg: "#f5f3ff" },
  slate:  { label: "Slate",  color: "#475569", colorBg: "#f1f5f9" },
};

// ── Defaults ──────────────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: AppSettings = {
  hiddenNavHrefs: [],
  accentPreset: "blue",
  workspaceName: "My Workspace",
  compactSidebar: false,
};

// ── Storage helpers ───────────────────────────────────────────────────────────

const SETTINGS_KEY = "vevey_settings_v1";

export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: AppSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    window.dispatchEvent(new Event("vevey-settings-changed"));
  } catch {}
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    setSettings(loadSettings());
    const sync = () => setSettings(loadSettings());
    window.addEventListener("vevey-settings-changed", sync);
    return () => window.removeEventListener("vevey-settings-changed", sync);
  }, []);

  const update = (patch: Partial<AppSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
  };

  const reset = () => {
    try { localStorage.removeItem(SETTINGS_KEY); } catch {}
    setSettings(DEFAULT_SETTINGS);
    window.dispatchEvent(new Event("vevey-settings-changed"));
  };

  return { settings, update, reset };
}
