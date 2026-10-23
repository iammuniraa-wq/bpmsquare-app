// What a template looks like on a "What are you estimating?" card. Pure, no I/O: the
// card needs a name, one plain line, an icon key and a few words, and a template saved
// before 0213 (or by hand) has none of the last three, so each has a sensible fallback.

import { TEMPLATE_ICONS } from "./requests";

export type CardTemplate = {
  id: string;
  name: string;
  description: string | null;
  geometry: string | null;
  icon?: string | null;
  keywords?: string[] | null;
  locked?: boolean;
};

export type TemplateIconKey = (typeof TEMPLATE_ICONS)[number];

const ICON_BY_GEOMETRY: Record<string, TemplateIconKey> = {
  chainlink_fence: "fence",
  precast_villa: "building",
};

export function iconKeyFor(t: Pick<CardTemplate, "icon" | "geometry">): TemplateIconKey {
  if (t.icon && (TEMPLATE_ICONS as readonly string[]).includes(t.icon)) return t.icon as TemplateIconKey;
  return (t.geometry && ICON_BY_GEOMETRY[t.geometry]) || "grid";
}

/** The first sentence of the description, short enough for a card; empty when there is no description. */
export function oneLine(description: string | null | undefined, max = 110): string {
  const text = (description ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const stop = text.search(/[.!?](\s|$)/);
  const first = stop > 0 ? text.slice(0, stop + 1) : text;
  if (first.length <= max) return first;
  const cut = first.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 40 ? cut.slice(0, space) : cut).replace(/[,;:\s]+$/, "")}…`;
}

/** Template cards in a stable, useful order: locked starters are not pushed down; names sort plainly. */
export function sortForCards<T extends Pick<CardTemplate, "name">>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
