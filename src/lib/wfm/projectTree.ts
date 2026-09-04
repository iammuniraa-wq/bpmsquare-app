// Project hierarchy: a project may have children, and a child is just another
// project row with a parent. BIM calls the level below a project a WBS; other
// tenants call it a phase, a task, a cost code -- so the LEVELS ARE NAMED BY
// THE TENANT (config.wfm.project_levels) rather than by us.
//
// The configured list is a MAXIMUM, not a requirement. One project can stop at
// the top while another uses every level; nothing forces a shape on a project
// that doesn't need one.
//
// Pure and dependency-free so the rules are unit-testable -- same convention
// as hours.ts, geofence.ts and projectAttribution.ts.

export type TreeNodeLike = { id: string; parent_id: string | null };

/**
 * How deep a project sits. A root project is 0, its child 1, and so on.
 *
 * Returns null when the chain is broken or circular rather than looping
 * forever -- a cycle should never exist (createChildBlocked guards against
 * it), but a function that walks parent pointers must not trust that.
 */
export function depthOf(nodes: Map<string, TreeNodeLike>, id: string): number | null {
  let depth = 0;
  let current = nodes.get(id);
  const seen = new Set<string>([id]);
  while (current?.parent_id) {
    if (seen.has(current.parent_id)) return null; // cycle
    seen.add(current.parent_id);
    current = nodes.get(current.parent_id);
    if (!current) return null; // broken chain
    depth += 1;
  }
  return depth;
}

/** The label for the level BELOW a project at `depth`, or null when that
 *  depth is already the deepest the tenant allows. This is what decides
 *  whether an "Add ..." button exists at all. */
export function childLevelName(levels: string[], parentDepth: number): string | null {
  return parentDepth < levels.length ? levels[parentDepth] : null;
}

/** What this node itself is called: "Project" at the root, otherwise the
 *  tenant's own word for that level. */
export function levelNameOf(levels: string[], depth: number): string {
  return depth === 0 ? "Project" : (levels[depth - 1] ?? "Level " + depth);
}

/** Every descendant id of `rootId`, excluding the root. */
export function descendantsOf(nodes: TreeNodeLike[], rootId: string): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.parent_id) continue;
    childrenOf.set(n.parent_id, [...(childrenOf.get(n.parent_id) ?? []), n.id]);
  }
  const out: string[] = [];
  const stack = [...(childrenOf.get(rootId) ?? [])];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue; // defensive: a cycle must not hang the caller
    seen.add(id);
    out.push(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }
  return out;
}

/**
 * Roll own-minutes up through every ancestor.
 *
 * An hour booked to a task counts for its phase and its project too -- that is
 * the whole point of a hierarchy. `own` is what landed directly on a node;
 * `total` is own plus everything beneath it.
 */
export function rollUp(
  nodes: TreeNodeLike[],
  own: Map<string, number>
): Map<string, { own: number; total: number }> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, { own: number; total: number }>();
  for (const n of nodes) out.set(n.id, { own: own.get(n.id) ?? 0, total: own.get(n.id) ?? 0 });

  for (const n of nodes) {
    const mine = own.get(n.id) ?? 0;
    if (mine === 0) continue;
    // Walk to the root, adding this node's own minutes to each ancestor.
    let parentId = n.parent_id;
    const seen = new Set<string>([n.id]);
    while (parentId) {
      if (seen.has(parentId)) break; // cycle guard
      seen.add(parentId);
      const entry = out.get(parentId);
      if (entry) entry.total += mine;
      parentId = byId.get(parentId)?.parent_id ?? null;
    }
  }
  return out;
}

/**
 * Why a project may not be given this parent. Returns null when it is allowed.
 *
 * Three ways it can be wrong, and all three are easy to do by accident on a
 * screen that lets you re-parent: making something its own parent, creating a
 * loop, or pushing a subtree past the depth the tenant configured.
 */
export function reparentError(
  nodes: TreeNodeLike[],
  levels: string[],
  childId: string,
  newParentId: string | null
): string | null {
  if (!newParentId) return null;
  if (newParentId === childId) return "A project can't be its own parent";

  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Moving a node beneath its own descendant would orphan the whole subtree
  // into a loop.
  if (descendantsOf(nodes, childId).includes(newParentId)) {
    return "That would put this inside one of its own sub-items";
  }

  const parentDepth = depthOf(byId, newParentId);
  if (parentDepth === null) return "That parent is not reachable";
  if (!childLevelName(levels, parentDepth)) {
    return levels.length === 0
      ? "Sub-items aren't switched on for this workspace"
      : `That is already the deepest level (${levels[levels.length - 1]})`;
  }

  // The moved node brings its own subtree with it; the deepest leaf must still
  // fit. Checking only the node itself would let a 3-deep branch be dragged
  // under a parent that only has room for 1.
  const subtree = descendantsOf(nodes, childId);
  let deepestBelow = 0;
  for (const id of subtree) {
    const d = depthOf(byId, id);
    const c = depthOf(byId, childId);
    if (d === null || c === null) continue;
    deepestBelow = Math.max(deepestBelow, d - c);
  }
  if (parentDepth + 1 + deepestBelow > levels.length) {
    return "Its sub-items would go deeper than this workspace allows";
  }
  return null;
}
