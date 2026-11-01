// The objects a person used last in Data Workbench: five per person per workspace, kept in the browser
// (docs/design/data-workbench-redesign.md 2b). Pure apart from the storage handed in, and tolerant of a storage
// that is missing, full or holds something else: recents are a convenience and never worth an error.

export const RECENTS_MAX = 5;

export const recentsKey = (tenantId: string, userId: string): string => `dw-recents:${tenantId}:${userId}`;

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

/** Newest first, no repeats, at most RECENTS_MAX. */
export function pushRecent(list: readonly string[], id: string): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, RECENTS_MAX);
}

export function readRecents(storage: ReadableStorage | null | undefined, key: string): string[] {
  try {
    const raw = storage?.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const x of parsed) {
      if (typeof x === "string" && x && !seen.has(x)) { seen.add(x); out.push(x); }
    }
    return out.slice(0, RECENTS_MAX);
  } catch {
    return [];
  }
}

export function writeRecents(storage: WritableStorage | null | undefined, key: string, list: readonly string[]): void {
  try {
    storage?.setItem(key, JSON.stringify(list.slice(0, RECENTS_MAX)));
  } catch {
    // Private browsing or a full quota: the list simply is not remembered.
  }
}

/** Reads, moves `id` to the front, writes back and returns the new list. */
export function touchRecent(storage: (ReadableStorage & WritableStorage) | null | undefined, key: string, id: string): string[] {
  const next = pushRecent(readRecents(storage, key), id);
  writeRecents(storage, key, next);
  return next;
}

/** The recents the workspace still owns, in order. An object that was switched off drops out without an error. */
export function ownedRecents(list: readonly string[], owned: ReadonlySet<string>): string[] {
  return list.filter((id) => owned.has(id)).slice(0, RECENTS_MAX);
}

export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
