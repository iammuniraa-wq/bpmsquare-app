"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Button from "@/components/ui/Button";
import { SETTINGS_ACTIONS_ID } from "./SettingsPageHeader";

/** Renders its children into the settings page header's actions slot. */
export function SettingsHeaderActions({ children }: { children: React.ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setSlot(document.getElementById(SETTINGS_ACTIONS_ID)); }, []);
  return slot ? createPortal(children, slot) : null;
}

/** Warns before a reload or tab close while there are unsaved edits. (Moving
 *  between settings pages with the menu is not intercepted.) */
function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}

/**
 * Save, top right: disabled until something changed, with the state beside it
 * ("Unsaved changes" / "Saving…" / "Saved" / the server's error). One per page.
 */
export function SettingsSave({
  dirty, saving = false, saved = false, error = "", onSave, label = "Save",
}: {
  dirty: boolean;
  saving?: boolean;
  saved?: boolean;
  error?: string;
  onSave: () => void;
  label?: string;
}) {
  useUnsavedWarning(dirty);
  const status = error ? null : saving ? "Saving…" : saved && !dirty ? "✓ Saved" : dirty ? "Unsaved changes" : "";
  return (
    <SettingsHeaderActions>
      <span role="status" aria-live="polite" className="bpm-save-status" data-dirty={dirty && !saving ? "true" : undefined}>
        {status}
      </span>
      {error && <span role="alert" className="bpm-save-error">{error}</span>}
      <Button variant="primary" onClick={onSave} disabled={!dirty} loading={saving}>
        {label}
      </Button>
    </SettingsHeaderActions>
  );
}

/** For a page whose choices apply the moment they are made (theme, accent):
 *  no Save to press, but the header still says what happened. */
export function SettingsInstantStatus({ saved, saving = false }: { saved: boolean; saving?: boolean }) {
  return (
    <SettingsHeaderActions>
      <span role="status" aria-live="polite" className="bpm-save-status">
        {saving ? "Applying…" : saved ? "✓ Saved" : "Changes apply as you make them"}
      </span>
    </SettingsHeaderActions>
  );
}
