"use client";

import { useCallback, useEffect, useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import {
  askCameraPermission, askGeoPermission, cameraPermissionState, canInstall,
  geoPermissionState, isIOS, isStandalone, onInstallAvailabilityChange,
  promptInstall, type PermState,
} from "@/lib/wfm/devicePermissions";

/**
 * "Set up this device" — shown once, before anyone needs to punch.
 *
 * This exists because a browser permission prompt is one-shot. Answering
 * "Deny" by reflex, in a queue at a gate, is permanent: the browser never
 * asks again, and getting back costs a trip through OS settings plus a page
 * reload. Every prompt raised here is raised from a button the employee has
 * deliberately tapped after reading one line about why -- and if they aren't
 * ready, they dismiss THIS card, which costs nothing, because the browser
 * was never asked and no refusal was recorded.
 *
 * The install row matters for the same reason: on iOS a home-screen app has
 * its OWN permission store, so installing is the one clean way out of a
 * refusal that is already stuck in Safari.
 */

const DISMISS_KEY = "bpm_wfm_setup_dismissed";

type RowState = "unknown" | "prompt" | "granted" | "denied" | "asking";

function Row({
  title, detail, state, actionLabel, onAction,
}: {
  title: string; detail: string; state: RowState; actionLabel: string; onAction?: () => void;
}) {
  const done = state === "granted";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, padding: "11px 0",
      borderTop: `1px solid ${c.line}`,
    }}>
      <span style={{
        width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: done ? "#12a150" : state === "denied" ? "#e5484d" : c.line,
        color: "#fff", fontSize: 12, fontWeight: 800,
      }}>
        {done ? "✓" : state === "denied" ? "!" : ""}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 650, color: c.ink }}>{title}</span>
        <span style={{ display: "block", fontSize: 11.5, color: c.muted, marginTop: 1, lineHeight: 1.5 }}>
          {done ? "Ready" : detail}
        </span>
      </span>
      {!done && onAction && (
        <button
          onClick={onAction}
          disabled={state === "asking"}
          style={{
            flexShrink: 0, padding: "8px 13px", borderRadius: 8, cursor: "pointer", font: "inherit",
            fontSize: 12.5, fontWeight: 650, border: "none", background: c.accent, color: "#fff",
            opacity: state === "asking" ? 0.6 : 1,
          }}
        >
          {state === "asking" ? "…" : actionLabel}
        </button>
      )}
    </div>
  );
}

export default function DeviceSetupCard({ needsLocation }: { needsLocation: boolean }) {
  const [geo, setGeo] = useState<RowState>("unknown");
  const [cam, setCam] = useState<RowState>("unknown");
  const [installable, setInstallable] = useState(false);
  const [standalone, setStandalone] = useState(true);
  const [iosHelp, setIosHelp] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  const refresh = useCallback(async () => {
    setGeo((await geoPermissionState()) as RowState);
    setCam((await cameraPermissionState()) as RowState);
  }, []);

  useEffect(() => {
    setStandalone(isStandalone());
    setInstallable(canInstall());
    try { setDismissed(localStorage.getItem(DISMISS_KEY) === "1"); } catch { setDismissed(false); }
    void refresh();
    return onInstallAvailabilityChange(() => setInstallable(canInstall()));
  }, [refresh]);

  async function allowLocation() {
    setGeo("asking");
    const { ok, denied } = await askGeoPermission();
    setGeo(ok ? "granted" : denied ? "denied" : "prompt");
  }

  async function allowCamera() {
    setCam("asking");
    const { ok, denied } = await askCameraPermission();
    setCam(ok ? "granted" : denied ? "denied" : "prompt");
  }

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* private mode */ }
    setDismissed(true);
  }

  // Nothing outstanding -> nothing to show. Camera is always needed for a
  // shift punch; location only when the workspace requires it.
  const geoOutstanding = needsLocation && geo !== "granted";
  const camOutstanding = cam !== "granted";
  const installOutstanding = !standalone && (installable || isIOS());
  if (dismissed || (!geoOutstanding && !camOutstanding && !installOutstanding)) return null;

  return (
    <section style={{ ...cardStyle, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 750, color: c.ink }}>Set up this device</div>
          <div style={{ fontSize: 12, color: c.muted, marginTop: 2, lineHeight: 1.55 }}>
            A minute now, so punching works first time. Your browser will ask permission after each
            button — tap Allow.
          </div>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          style={{ border: "none", background: "transparent", cursor: "pointer", color: c.muted, fontSize: 18, lineHeight: 1, padding: "0 2px" }}
        >
          ×
        </button>
      </div>

      <div style={{ marginTop: 10 }}>
        {camOutstanding && (
          <Row
            title="Camera"
            detail={cam === "denied"
              ? "Blocked. Every check in and out records a selfie, so punching can't work until it's allowed."
              : "Every check in and out records a selfie."}
            state={cam}
            actionLabel="Allow camera"
            onAction={allowCamera}
          />
        )}

        {geoOutstanding && (
          <Row
            title="Location"
            detail={geo === "denied"
              ? "Blocked. Your workspace requires location on a punch — installing the app below gives a clean start."
              : "Your punch records where you are, so your hours can be verified."}
            state={geo}
            actionLabel="Allow location"
            onAction={allowLocation}
          />
        )}

        {installOutstanding && (
          <div style={{ borderTop: `1px solid ${c.line}`, paddingTop: 11, marginTop: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 650, color: c.ink }}>Add to your home screen</div>
            <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2, lineHeight: 1.55 }}>
              Opens straight to punching, works without signal, and no address to remember.
              {(geo === "denied" || cam === "denied") && " It also gets its own permissions, which is the simplest way past a blocked one."}
            </div>
            {installable ? (
              <button
                onClick={async () => { if (await promptInstall()) setStandalone(true); }}
                style={{
                  marginTop: 9, padding: "8px 14px", borderRadius: 8, cursor: "pointer", font: "inherit",
                  fontSize: 12.5, fontWeight: 650, border: "none", background: c.accent, color: "#fff",
                }}
              >
                Install app
              </button>
            ) : (
              <>
                <button
                  onClick={() => setIosHelp((v) => !v)}
                  style={{
                    marginTop: 9, padding: "8px 14px", borderRadius: 8, cursor: "pointer", font: "inherit",
                    fontSize: 12.5, fontWeight: 650, border: `1px solid ${c.line}`, background: "transparent", color: c.ink,
                  }}
                >
                  {iosHelp ? "Hide steps" : "How to add it"}
                </button>
                {iosHelp && (
                  <ol style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 12.5, lineHeight: 1.85, color: c.ink }}>
                    <li>Tap the Share button at the bottom of Safari (a square with an arrow)</li>
                    <li>Scroll down and tap “Add to Home Screen”</li>
                    <li>Tap Add, then open BPMSquare from your home screen from now on</li>
                  </ol>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
