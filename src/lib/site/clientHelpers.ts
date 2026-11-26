// Browser-side helpers of the site screens: the capture id, the photo downscale and the cached lists the phone works from with no signal.
// No server import, no secret.

import type { ExpectedDelivery } from "./receiptsServer";
import type { CostLineChoice } from "./server";

export const newClientId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  const h = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${h(8)}-${h(4)}-4${h(3)}-8${h(3)}-${h(12)}`;
};

/**
 * A phone photo is 3 to 8 MB; a receipt is readable at 1600 px on the long side as a JPEG, which is a few hundred KB and uploads on a weak signal.
 * A file that is not an image the browser can draw is returned as it is (the server then decides).
 */
export function downscalePhoto(file: File, maxSide = 1600, quality = 0.82): Promise<Blob> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) { resolve(file); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => resolve(blob ?? file), "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

export type SiteBootstrap = {
  user_id: string;
  modules: { expenses: boolean; receipts: boolean };
  projects: { id: string; ref: string | null; name: string; currency: string | null; lines: CostLineChoice[]; deliveries: ExpectedDelivery[] }[];
  categories: { id: string; name: string; resource_code?: string | null }[];
  reasons: { code: string; label: string }[];
  fetched_at: string;
};

const KEY = "site-bootstrap-v1";

/** The lists the phone works from: fresh when there is signal, otherwise what it kept on the last open. */
export async function loadBootstrap(): Promise<{ data: SiteBootstrap | null; stale: boolean; error?: string }> {
  try {
    const res = await fetch("/api/site/bootstrap", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as SiteBootstrap;
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* private mode: it just is not kept */ }
      return { data, stale: false };
    }
    if (res.status === 404) return { data: null, stale: false, error: "Site entry is not switched on for this workspace." };
    if (res.status === 401 || res.status === 403) return { data: null, stale: false, error: "Sign in again to continue." };
  } catch { /* no signal */ }
  try {
    const kept = localStorage.getItem(KEY);
    if (kept) return { data: JSON.parse(kept) as SiteBootstrap, stale: true };
  } catch { /* nothing kept */ }
  return { data: null, stale: false, error: "No signal and nothing saved on this phone yet. Open this page once with signal." };
}

const LAST = "site-last-project";
export const lastProject = (): string | null => { try { return localStorage.getItem(LAST); } catch { return null; } };
export const rememberProject = (id: string): void => { try { localStorage.setItem(LAST, id); } catch { /* not kept */ } };

export const fmtMoney = (n: number | null | undefined, currency?: string | null): string =>
  n === null || n === undefined ? "—" : `${currency ? `${currency} ` : ""}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
