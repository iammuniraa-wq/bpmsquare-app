"use client";

/**
 * Client-side permission helpers for the punch screen.
 *
 * The whole point of this module is that a browser permission prompt is
 * ONE-SHOT: a reflexive "Deny" at a gate is permanent, and recovering from
 * it costs an OS-settings trip plus a page reload. So the prompt must never
 * be fired cold -- it is only ever raised from a control the user has
 * deliberately tapped, having just read what it is for.
 */

export type PermState = "prompt" | "denied" | "granted" | "unknown";

async function queryPermission(name: string): Promise<PermState> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unknown";
  try {
    const status = await navigator.permissions.query({ name: name as PermissionName });
    return status.state as PermState;
  } catch {
    // Safari has no Permissions API entry for "camera", and older versions
    // none for geolocation either. "unknown" is honest: we cannot tell
    // without asking, and asking is exactly what we're avoiding.
    return "unknown";
  }
}

export const geoPermissionState = () => queryPermission("geolocation");
export const cameraPermissionState = () => queryPermission("camera");

/** Fires the real geolocation prompt. Only ever call this from a tap. */
export function askGeoPermission(timeoutMs = 10_000): Promise<{ ok: boolean; denied: boolean }> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      return resolve({ ok: false, denied: false });
    }
    navigator.geolocation.getCurrentPosition(
      () => resolve({ ok: true, denied: false }),
      (err) => resolve({ ok: false, denied: err.code === err.PERMISSION_DENIED }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 }
    );
  });
}

/**
 * Fires the real camera prompt, then releases the camera immediately -- this
 * is a permission request, not a capture, so leaving the stream open would
 * light the indicator and hold the device for no reason.
 */
export async function askCameraPermission(): Promise<{ ok: boolean; denied: boolean }> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
    stream.getTracks().forEach((t) => t.stop());
    return { ok: true, denied: false };
  } catch (e) {
    const name = (e as Error)?.name;
    return { ok: false, denied: name === "NotAllowedError" || name === "SecurityError" };
  }
}

/** True when running as an installed home-screen app rather than a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS predates display-mode and uses its own flag.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/**
 * Chrome/Edge fire beforeinstallprompt once, early -- often before React has
 * mounted anything. Captured at module load so the install button can still
 * offer it later; iOS has no equivalent event and needs instructions instead.
 */
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferredInstall: InstallPromptEvent | null = null;
const installListeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstall = e as InstallPromptEvent;
    installListeners.forEach((fn) => fn());
  });
  window.addEventListener("appinstalled", () => {
    deferredInstall = null;
    installListeners.forEach((fn) => fn());
  });
}

export function canInstall(): boolean {
  return deferredInstall !== null;
}

export function onInstallAvailabilityChange(fn: () => void): () => void {
  installListeners.add(fn);
  return () => { installListeners.delete(fn); };
}

export async function promptInstall(): Promise<boolean> {
  if (!deferredInstall) return false;
  await deferredInstall.prompt();
  const choice = await deferredInstall.userChoice.catch(() => ({ outcome: "dismissed" }));
  deferredInstall = null;
  installListeners.forEach((fn) => fn());
  return choice.outcome === "accepted";
}

/**
 * Turn a getUserMedia failure into something the person in front of the
 * screen can act on.
 *
 * Every camera call site used to swallow the error and print one generic
 * "camera blocked" line. That cost us a real support cycle on a Xiaomi/MIUI
 * tablet (2026-09): face login AND the kiosk both failed, and the screen
 * could not tell us whether the permission was denied, the camera was held
 * by another app, or there was no camera at all -- three completely
 * different fixes. The browser knew; we were throwing it away.
 *
 * MIUI is called out by name in the denied case on purpose: it gates the
 * camera at the OS level ON TOP of Chrome's own permission, and when that
 * outer gate is shut Chrome frequently never shows its prompt, so "allow it
 * in the browser" is advice that cannot work.
 */
export function cameraSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

export function describeCameraError(e: unknown): string {
  // Checked first: on an out-of-date browser the call throws before any
  // permission is ever considered, so a permission-flavoured message would
  // send someone digging through settings that were never the problem.
  if (!cameraSupported()) {
    return "This browser is too old to use the camera. Update Chrome from the Play Store, then reload this page.";
  }
  const name = (e as Error)?.name ?? "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera permission was refused. On Xiaomi/MIUI also check Settings → Apps → Chrome → Permissions → Camera, then reload this page.";
    case "NotReadableError":
    case "AbortError":
      // Genuinely common: MIUI keeps a camera app resident, and Android
      // hands the camera to one app at a time.
      return "The camera is being used by another app. Close any camera or video app, then reload this page.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No front camera was found on this device.";
    case "TypeError":
      // navigator.mediaDevices is undefined in two situations that look
      // identical from here: an out-of-date browser, and a non-secure (http)
      // origin. BOTH are named because guessing wrong wastes a support cycle
      // -- and on a Xiaomi/MIUI tablet (2026-09) the real answer was the
      // stale bundled Chrome, on a device that was otherwise brand new.
      return "This browser can't use the camera. Update Chrome from the Play Store, reload, and make sure the address starts with https.";
    default:
      return name
        ? `The camera could not be started (${name}). Reload the page and allow camera access.`
        : "The camera could not be started. Reload the page and allow camera access.";
  }
}
