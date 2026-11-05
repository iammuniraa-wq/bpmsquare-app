// Per-run aliases (design 5.4): the model sees P1..Pn and S1..Sn, never a name or an id. The map is plain JSON so the
// runner can store it in crew_runs.alias_map (service role only) and put names back when a permitted viewer renders a finding.

export type AliasMap = {
  /** alias -> real employee id */
  persons: Record<string, string>;
  /** alias -> real site id */
  sites: Record<string, string>;
};

export type AliasKind = "person" | "site";

const PREFIX: Record<AliasKind, string> = { person: "P", site: "S" };
const BUCKET: Record<AliasKind, "persons" | "sites"> = { person: "persons", site: "sites" };

export const ALIAS_TOKEN = /\b[PS]\d+\b/g;
export const PERSON_ALIAS_TOKEN = /\bP\d+\b/g;

export function emptyAliasMap(): AliasMap {
  return { persons: {}, sites: {} };
}

export function aliasOf(map: AliasMap, kind: AliasKind, realId: string): string | null {
  const bucket = map[BUCKET[kind]];
  for (const [alias, id] of Object.entries(bucket)) if (id === realId) return alias;
  return null;
}

/**
 * Give every id an alias. Ids that already have one keep it; new ids are numbered after the highest existing number in
 * ascending id order, so the same set of ids always yields the same aliases whatever order the reads returned them in
 * ("stable per run"), and a re-run that adds a person does not renumber anyone.
 */
export function assignAliases(map: AliasMap, kind: AliasKind, realIds: string[]): AliasMap {
  const bucket = { ...map[BUCKET[kind]] };
  const known = new Set(Object.values(bucket));
  let next = Object.keys(bucket).reduce((m, a) => Math.max(m, Number(a.slice(1)) || 0), 0) + 1;
  for (const id of [...new Set(realIds)].sort()) {
    if (known.has(id)) continue;
    bucket[`${PREFIX[kind]}${next++}`] = id;
    known.add(id);
  }
  return { ...map, [BUCKET[kind]]: bucket };
}

export function resolveAlias(map: AliasMap, alias: string): { kind: AliasKind; id: string } | null {
  if (map.persons[alias]) return { kind: "person", id: map.persons[alias] };
  if (map.sites[alias]) return { kind: "site", id: map.sites[alias] };
  return null;
}

/**
 * Put names back, for a permitted viewer's rendering only. Unknown aliases are left as they are, and a name is never
 * written back into stored text.
 */
export function renderWithNames(text: string, nameOfAlias: (alias: string) => string | null): string {
  return text.replace(ALIAS_TOKEN, (alias) => nameOfAlias(alias) ?? alias);
}

/** Aliases that appear in a piece of text. */
export function aliasesIn(text: string): string[] {
  return [...new Set(text.match(ALIAS_TOKEN) ?? [])];
}

export function personAliasesIn(text: string): string[] {
  return [...new Set(text.match(PERSON_ALIAS_TOKEN) ?? [])];
}

/**
 * The privacy check the adapters' tests run on everything that is about to leave for the model: none of the forbidden
 * strings (real ids, names, codes) may appear anywhere in the serialised value. Returns the strings that leaked.
 */
export function leakedStrings(value: unknown, forbidden: string[]): string[] {
  const text = JSON.stringify(value) ?? "";
  const lower = text.toLowerCase();
  return forbidden.filter((f) => f.length >= 2 && lower.includes(f.toLowerCase()));
}
