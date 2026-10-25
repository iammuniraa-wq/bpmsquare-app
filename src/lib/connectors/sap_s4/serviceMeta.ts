// What a connected SAP system says about its own order services, read from its `$metadata` (pure: no server import, tested with the
// checked-in fixtures in metadataFixtures.ts). The order code never assumes a property exists on the customer's release: it asks this
// map, and when a REQUIRED property is missing it refuses with the name of the property and the service, instead of sending a
// request SAP would reject with a less helpful message. A property that is only wanted (a marker, a sales group) is used when listed
// and left out when not.

export type PropMeta = { creatable: boolean; filterable: boolean };
export type SetMeta = { typeName: string; props: Map<string, PropMeta>; navs: Set<string> };
export type ServiceMeta = Map<string, SetMeta>;

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
};

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function readType(xml: string, typeName: string): SetMeta | null {
    const block = new RegExp(`<EntityType\\b[^>]*\\bName="${escapeRe(typeName)}"[^>]*>([\\s\\S]*?)</EntityType>`, "i").exec(xml);
    if (!block) return null;
    const props = new Map<string, PropMeta>();
    for (const p of block[1].matchAll(/<Property\b[^>]*>/gi)) {
      const pn = attr(p[0], "Name");
      if (!pn) continue;
      props.set(pn, { creatable: attr(p[0], "sap:creatable") !== "false", filterable: attr(p[0], "sap:filterable") !== "false" });
    }
    const navs = new Set<string>();
    for (const n of block[1].matchAll(/<NavigationProperty\b[^>]*>/gi)) {
      const nn = attr(n[0], "Name");
      if (nn) navs.add(nn);
    }
    return { typeName, props, navs };
}

/** Entity set -> its properties and navigation properties; each entity TYPE is listed under its own name too. SAP marks a property that cannot be written `sap:creatable="false"`. */
export function parseServiceMeta(xml: string): ServiceMeta {
  const out: ServiceMeta = new Map();
  for (const t of xml.matchAll(/<EntityType\b[^>]*>/gi)) {
    const typeName = attr(t[0], "Name");
    const meta = typeName ? readType(xml, typeName) : null;
    if (typeName && meta) out.set(typeName, meta);
  }
  for (const setTag of xml.matchAll(/<EntitySet\b[^>]*>/gi)) {
    const name = attr(setTag[0], "Name");
    const typeName = attr(setTag[0], "EntityType")?.split(".").pop();
    const meta = typeName ? out.get(typeName) : undefined;
    if (name && meta) out.set(name, meta);
  }
  return out;
}

/** `meta` is null when `$metadata` could not be read (too large, refused): nothing is checked then and the call itself tells. */
export type MaybeMeta = ServiceMeta | null;

export const hasProp = (meta: MaybeMeta, set: string, prop: string): boolean => (meta ? meta.get(set)?.props.has(prop) === true : true);
export const hasNav = (meta: MaybeMeta, set: string, nav: string): boolean => (meta ? meta.get(set)?.navs.has(nav) === true : true);
export const canWrite = (meta: MaybeMeta, set: string, prop: string): boolean => (meta ? meta.get(set)?.props.get(prop)?.creatable === true : false);

/** The first candidate the system lists; with no metadata, null (the caller reads the row it gets back instead). */
export function pickProp(meta: MaybeMeta, set: string, candidates: readonly string[]): string | null {
  if (!meta) return null;
  const s = meta.get(set);
  return candidates.find((c) => s?.props.has(c)) ?? null;
}

/** What is missing from the system, as sentences naming the property and the service. Empty when all are there (or unchecked). */
export function missingProps(meta: MaybeMeta, service: string, needs: { set: string; props?: readonly string[]; navs?: readonly string[] }[]): string[] {
  if (!meta) return [];
  const out: string[] = [];
  for (const n of needs) {
    const s = meta.get(n.set);
    if (!s) { out.push(`${service} does not list ${n.set}`); continue; }
    for (const p of n.props ?? []) if (!s.props.has(p)) out.push(`${n.set} has no ${p} in ${service}`);
    for (const p of n.navs ?? []) if (!s.navs.has(p)) out.push(`${n.set} has no ${p} link in ${service}`);
  }
  return out;
}

export const refusalFor = (missing: string[], nothing = "Nothing was sent."): string =>
  `This SAP system does not offer what is needed: ${missing.slice(0, 3).join("; ")}${missing.length > 3 ? ` (and ${missing.length - 3} more)` : ""}. ${nothing}`;
