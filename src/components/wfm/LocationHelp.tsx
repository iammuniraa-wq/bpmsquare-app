"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";

/**
 * Shown when a punch is refused because location is off.
 *
 * There is no link that can be given here, and it isn't an oversight: a web
 * page cannot navigate to `chrome://settings`, `app-settings:` or the iOS
 * Settings app. Browsers block it deliberately -- a page that could open
 * your permission settings could also walk you into granting something.
 * So the honest help is the exact tap-path for the device in hand, plus a
 * button to re-check once it's changed.
 *
 * The one case where a "button" genuinely works is permission state
 * "prompt" -- the browser will still ask, so asking again is the whole fix
 * and no instructions are needed. The Permissions API tells us which case
 * we're in, so the panel never sends someone into Settings when a tap
 * would have done.
 */

type PermState = "prompt" | "denied" | "granted" | "unknown";

function useGeoPermission(): PermState {
  const [state, setState] = useState<PermState>("unknown");
  useEffect(() => {
    let cancelled = false;
    if (!navigator.permissions?.query) return;
    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((status) => {
        if (cancelled) return;
        setState(status.state as PermState);
        status.onchange = () => setState(status.state as PermState);
      })
      .catch(() => { /* Safari < 16 has no Permissions API for geolocation */ });
    return () => { cancelled = true; };
  }, []);
  return state;
}

function steps(): { device: string; how: string[] } {
  if (typeof navigator === "undefined") return { device: "this device", how: [] };
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const safari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/.test(ua);

  if (iOS && safari) {
    return {
      device: "iPhone or iPad — Safari",
      how: [
        "Tap “aA” at the left of the address bar",
        "Website Settings → Location → Allow",
        "If it stays blocked: iOS Settings → Privacy & Security → Location Services → Safari Websites → While Using the App",
      ],
    };
  }
  if (iOS) {
    return {
      device: "iPhone or iPad",
      how: [
        "Open iOS Settings → Privacy & Security → Location Services",
        "Make sure Location Services is on",
        "Find your browser in the list and set it to “While Using the App”",
        "Return here and tap Try again",
      ],
    };
  }
  if (android) {
    return {
      device: "Android",
      how: [
        "Tap the padlock (or ⓘ) to the left of the address bar",
        "Permissions → Location → Allow",
        "If Location isn’t listed: browser Settings → Site settings → Location, and remove this site from Blocked",
      ],
    };
  }
  return {
    device: "this computer",
    how: [
      "Click the padlock (or ⓘ) to the left of the address bar",
      "Set Location to Allow",
      "Reload the page",
    ],
  };
}

export default function LocationHelp({ onRetry, retrying }: { onRetry: () => void; retrying?: boolean }) {
  const perm = useGeoPermission();
  const { device, how } = steps();
  // "prompt" means the browser will still ask — retrying IS the fix, so the
  // settings walkthrough would just be noise.
  const canJustAsk = perm === "prompt" || perm === "unknown";

  return (
    <div style={{
      border: `1px solid ${c.line}`, borderRadius: 12, padding: 14,
      background: "color-mix(in srgb, #d97706 8%, transparent)",
    }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: c.ink, marginBottom: 4 }}>
        Location is needed to punch in or out
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 12.5, lineHeight: 1.6, color: c.muted }}>
        {canJustAsk
          ? "Your browser will ask for permission — tap Allow when it does."
          : `Location is blocked for this site, so the browser won’t ask again. Browsers don’t let a page open its own permission settings, so it has to be changed by hand on ${device}:`}
      </p>

      {!canJustAsk && how.length > 0 && (
        <ol style={{ margin: "0 0 12px", paddingLeft: 18, fontSize: 12.5, lineHeight: 1.85, color: c.ink }}>
          {how.map((s) => <li key={s}>{s}</li>)}
        </ol>
      )}

      <button
        onClick={onRetry}
        disabled={retrying}
        style={{
          padding: "9px 16px", borderRadius: 9, border: "none", cursor: retrying ? "default" : "pointer",
          background: c.accent, color: "#fff", fontSize: 13, fontWeight: 650, font: "inherit",
          opacity: retrying ? 0.6 : 1,
        }}
      >
        {retrying ? "Checking…" : canJustAsk ? "Allow location" : "Try again"}
      </button>
    </div>
  );
}
