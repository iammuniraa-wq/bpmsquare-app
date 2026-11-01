import { DW_GROUPS, dwGroupLabel, type DwGroupId, type DwMode } from "@/lib/import/catalog";

// What the object picker shows for a given workspace, search and selection (docs/design/data-workbench-redesign.md 2b).
// Pure, so the rules (small workspaces open, large ones closed, search, the honest "not switched on" reply, keyboard
// stepping) are tested without a browser. The component only draws what this returns.

export type PickerEntry = {
  id: string;
  label: string;
  icon: string;
  group: DwGroupId;
  parent?: string;
  modes: readonly DwMode[];
  keywords: readonly string[];
};

/** An object the catalog knows that this workspace has not switched on. Never listed; only named when a search asks. */
export type PickerUnowned = { id: string; label: string; keywords: readonly string[] };

export type PickerItem =
  | { kind: "section"; key: string; label: string }
  | { kind: "group"; key: string; id: DwGroupId; label: string; count: number; open: boolean }
  | { kind: "object"; key: string; id: string; label: string; icon: string; child: boolean; caption?: string; selected: boolean }
  | { kind: "notice"; key: string; text: string };

/** At or below this many objects every group is open: a small workspace sees a short flat list. */
export const SMALL_WORKSPACE = 8;

export type OpenOverrides = Partial<Record<DwGroupId, boolean>>;

const words = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function haystack(e: { id: string; label: string; keywords: readonly string[] }): string {
  return [e.label, e.id.replace(/_/g, " "), ...e.keywords].join(" ").toLowerCase();
}

/** Every word of the query is found in the label, the id words or a keyword. */
export function matches(e: { id: string; label: string; keywords: readonly string[] }, query: string): boolean {
  const tokens = words(query);
  if (tokens.length === 0) return false;
  const h = haystack(e);
  return tokens.every((t) => h.includes(t));
}

export function searchEntries(entries: readonly PickerEntry[], query: string): PickerEntry[] {
  const hits = entries.filter((e) => matches(e, query));
  const q = query.trim().toLowerCase();
  // Stable: a name that contains what was typed comes before one that only has it as a keyword.
  return [...hits.filter((e) => e.label.toLowerCase().includes(q)), ...hits.filter((e) => !e.label.toLowerCase().includes(q))];
}

/** "Cases is not switched on in this workspace." for the unowned objects the query names, or null. */
export function notSwitchedOnReply(unowned: readonly PickerUnowned[], query: string): string | null {
  const hits = unowned.filter((u) => matches(u, query)).slice(0, 3);
  if (hits.length === 0) return null;
  const names = hits.length === 1 ? hits[0].label : `${hits.slice(0, -1).map((h) => h.label).join(", ")} and ${hits[hits.length - 1].label}`;
  return `${names} ${hits.length === 1 ? "is" : "are"} not switched on in this workspace.`;
}

export function groupIsOpen(group: DwGroupId, ctx: { total: number; selectedGroup: DwGroupId | null; overrides: OpenOverrides }): boolean {
  const own = ctx.overrides[group];
  if (own !== undefined) return own;
  return ctx.total <= SMALL_WORKSPACE || ctx.selectedGroup === group;
}

/** Top-level entries of a group in catalog order, each followed by its lines. A child whose parent is not owned stands on its own. */
function ordered(inGroup: readonly PickerEntry[]): { entry: PickerEntry; child: boolean }[] {
  const ids = new Set(inGroup.map((e) => e.id));
  const out: { entry: PickerEntry; child: boolean }[] = [];
  for (const e of inGroup.filter((x) => !x.parent || !ids.has(x.parent))) {
    out.push({ entry: e, child: false });
    for (const ch of inGroup.filter((x) => x.parent === e.id)) out.push({ entry: ch, child: true });
  }
  return out;
}

export function pickerItems(input: {
  entries: readonly PickerEntry[];
  unowned: readonly PickerUnowned[];
  query: string;
  selectedId: string | null;
  /** The mode in play, if the person has one: an object that lacks it carries a caption. */
  mode: DwMode | null;
  recents: readonly string[];
  overrides: OpenOverrides;
}): PickerItem[] {
  const { entries, query, selectedId, mode } = input;
  const byId = new Map(entries.map((e) => [e.id, e]));
  const lacks = (e: PickerEntry) => (mode && !e.modes.includes(mode) ? `no ${mode}` : undefined);
  const objectItem = (e: PickerEntry, child: boolean, prefix: string, caption?: string): PickerItem => ({
    kind: "object", key: `${prefix}:${e.id}`, id: e.id, label: e.label, icon: e.icon, child, caption: caption ?? lacks(e), selected: e.id === selectedId,
  });

  if (query.trim()) {
    const hits = searchEntries(entries, query);
    if (hits.length > 0) return hits.map((e) => objectItem(e, false, "s", dwGroupLabel(e.group)));
    return [{ kind: "notice", key: "none", text: notSwitchedOnReply(input.unowned, query) ?? "Nothing matches." }];
  }

  const out: PickerItem[] = [];
  const recents = input.recents.map((id) => byId.get(id)).filter((e): e is PickerEntry => !!e).slice(0, 5);
  if (recents.length > 0) {
    out.push({ kind: "section", key: "sec-recent", label: "Recent" });
    for (const e of recents) out.push(objectItem(e, false, "r"));
    out.push({ kind: "section", key: "sec-all", label: "All objects" });
  }
  const selectedGroup = (selectedId && byId.get(selectedId)?.group) || null;
  for (const g of DW_GROUPS) {
    const inGroup = entries.filter((e) => e.group === g.id);
    if (inGroup.length === 0) continue;
    const open = groupIsOpen(g.id, { total: entries.length, selectedGroup, overrides: input.overrides });
    out.push({ kind: "group", key: `g:${g.id}`, id: g.id, label: g.label, count: inGroup.length, open });
    if (!open) continue;
    for (const { entry, child } of ordered(inGroup)) out.push(objectItem(entry, child, "o"));
  }
  return out;
}

export const isInteractive = (it: PickerItem): it is Extract<PickerItem, { kind: "group" | "object" }> => it.kind === "group" || it.kind === "object";

/** Arrow keys over the interactive rows: -1 means "nothing highlighted yet". Stops at both ends. */
export function stepHighlight(current: number, key: "ArrowDown" | "ArrowUp" | "Home" | "End", count: number): number {
  if (count <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return Math.min(count - 1, current + 1);
  return Math.max(0, current - 1);
}

type Row = Extract<PickerItem, { kind: "group" | "object" }>;

export type PickerKeyResult = {
  /** The key was the picker's: the caller prevents the browser default. */
  handled: boolean;
  hl: number;
  query: string;
  /** Open an object, toggle a group, or ask the host to close (Esc with nothing left to clear). */
  act?: { kind: "open"; id: string } | { kind: "toggle"; id: DwGroupId; open: boolean } | { kind: "close" };
};

/** What one key does in the search box, given the rows on screen. The component only applies the result. */
export function pickerKey(state: { key: string; query: string; hl: number; rows: readonly Row[] }): PickerKeyResult {
  const { key, query, hl, rows } = state;
  if (key === "ArrowDown" || key === "ArrowUp") return { handled: true, hl: stepHighlight(hl, key, rows.length), query };
  // Home and End belong to the text cursor until there is a list to walk, which is when something has been typed.
  if ((key === "Home" || key === "End") && query !== "") return { handled: true, hl: stepHighlight(hl, key, rows.length), query };
  if (key === "Enter") {
    const row = rows[hl];
    if (!row) return { handled: false, hl, query };
    return { handled: true, hl, query, act: row.kind === "group" ? { kind: "toggle", id: row.id, open: !row.open } : { kind: "open", id: row.id } };
  }
  if (key === "Escape") {
    if (query) return { handled: true, hl: -1, query: "" };
    return { handled: false, hl, query, act: { kind: "close" } };
  }
  return { handled: false, hl, query };
}

/** The "/" shortcut: it focuses the search unless the cursor is already in something you type into. */
export function shouldFocusSearch(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }, active: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return false;
  if (active && (/^(input|textarea|select)$/i.test(active.tagName ?? "") || active.isContentEditable)) return false;
  return true;
}
