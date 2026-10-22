import { generatedManifests } from "./generate";
import { ACCOUNT_DETAIL } from "./account";
import { CASE_DETAIL } from "./case";
import { SETTINGS_MIDDLEWARE } from "./middleware";
import { QUOTE_DETAIL } from "./quote";
import { STANDARD_QUOTE_DETAIL } from "./standardQuote";
import { SETTINGS_WEBHOOKS } from "./webhooks";
import { applyAccess } from "./filter";
import type { ScreenAccess, ScreenField, ScreenManifest, ScreenOverlay, VisibleScreen } from "./types";

// The manifest loader: a route in, the screen's manifest out, keyed by the path the server parsed (the client only
// sends the path). A screen without a manifest returns null and the assistant says it has no screen knowledge.

/** Hand-written verbs and tasks, one small file per screen. An id that matches no generated screen fails the tests. */
export const OVERLAYS: ScreenOverlay[] = [QUOTE_DETAIL, STANDARD_QUOTE_DETAIL, ACCOUNT_DETAIL, CASE_DETAIL, SETTINGS_WEBHOOKS, SETTINGS_MIDDLEWARE];

const byId = <T extends { id: string }>(base: T[], extra: T[] = []): T[] => {
  const map = new Map(base.map((x) => [x.id, x]));
  for (const x of extra) map.set(x.id, x);
  return [...map.values()];
};

export function mergeOverlay(base: ScreenManifest, overlay: ScreenOverlay): ScreenManifest {
  return {
    ...base,
    purpose: overlay.purpose ?? base.purpose,
    tabs: overlay.tabs ?? base.tabs,
    controls: byId(base.controls, overlay.controls),
    tasks: byId(base.tasks, overlay.tasks),
    prerequisites: overlay.prerequisites ?? base.prerequisites,
  };
}

let cache: ScreenManifest[] | null = null;

/** Every manifest: generated from the product's own tables, then the hand-written half laid over it. Static data, no tenant content. */
export function allManifests(): ScreenManifest[] {
  if (cache) return cache;
  const generated = generatedManifests();
  cache = generated.map((m) => {
    const overlay = OVERLAYS.find((o) => o.id === m.id);
    return overlay ? mergeOverlay(m, overlay) : m;
  });
  return cache;
}

/** The path the server looks the screen up by: no query, no fragment, no trailing slash, bounded. */
export function normalizePath(path: unknown): string | null {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  const p = path.slice(0, 300).split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return p;
}

export function findManifest(path: unknown): ScreenManifest | null {
  const p = normalizePath(path);
  if (!p) return null;
  for (const m of allManifests()) {
    try {
      if (m.match(p)) return m;
    } catch {
      // A manifest whose matcher throws is treated as not matching: one bad screen never breaks the others.
    }
  }
  return null;
}

export const manifestById = (id: string): ScreenManifest | null => allManifests().find((m) => m.id === id) ?? null;

export const fieldControlId = (objectType: string, key: string) => `${objectType}.field.${key}`;

type ConfigField = { field_key: string; label: string; hidden: boolean; required: boolean; locked: boolean; editable: boolean; exportOnly?: boolean; kind: "standard" | "custom" };
type ConfigSection = { label: string; fields: ConfigField[] };

/** The tenant's effective field configuration (getEffectiveFieldConfig), reduced to what a guide needs. */
export function toScreenFields(sections: ConfigSection[], kind: ScreenManifest["kind"]): ScreenField[] {
  const out: ScreenField[] = [];
  for (const s of sections) {
    for (const f of s.fields) {
      if (f.hidden) continue;
      if ((kind === "new" || kind === "edit") && (f.editable === false || f.exportOnly)) continue;
      out.push({ key: f.field_key, label: f.label, section: s.label, required: f.required, locked: f.locked, editable: f.editable !== false, custom: f.kind === "custom" });
    }
  }
  return out;
}

export type ScreenDeps = {
  /** The caller's field configuration for an object (tenant-scoped by the caller). May throw; a failure just means no field list. */
  loadFields?: (objectType: string) => Promise<ConfigSection[]>;
};

/** The screen for a path, as this caller may see it, or null when there is none or it is not theirs. */
export async function resolveScreen(path: unknown, access: ScreenAccess, deps: ScreenDeps = {}): Promise<VisibleScreen | null> {
  const manifest = findManifest(path);
  if (!manifest) return null;
  let fields: ScreenField[] = [];
  if (manifest.objectType && deps.loadFields && manifest.kind !== "list") {
    try { fields = toScreenFields(await deps.loadFields(manifest.objectType), manifest.kind); } catch { fields = []; }
  }
  return applyAccess(manifest, fields, access);
}

/** One line per screen the caller may open: for the catalogue and for "which screen does X". */
export function screenIndex(access: ScreenAccess): { id: string; title: string }[] {
  return allManifests().filter((m) => applyAccess(m, [], access)).map((m) => ({ id: m.id, title: m.title }));
}
