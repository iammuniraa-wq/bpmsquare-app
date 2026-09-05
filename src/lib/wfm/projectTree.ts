// Project hierarchy: a project may have children, and a child is just another
// project row with a parent.
//
// The structure is named PER PROJECT, not per workspace (owner decision
// 2026-09-05). One project is broken into a WBS, the next into phases, the
// next not at all -- so the word lives on the row (wfm_projects.level_label,
// 0107) and is chosen when the part is created. There is no configured
// ladder every project must fit.
//
// Depth is capped by a constant rather than a setting: past a few levels the
// tree and the reports stop being readable, and that is not a judgement a
// tenant benefits from tuning.
//
// Pure and dependency-free so the rules are unit-testable -- same convention
// as hours.ts, geofence.ts and projectAttribution.ts.

export type TreeNodeLike = { id: string; parent_id: string | null };

/** How deep the tree may go, counting the project itself as level 0. Five is
 *  already more nesting than a readable report can carry; the limit exists to
 *  stop an accident, not to express a policy. */
export const MAX_DEPTH = 5;

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

/** Whether anything may be added beneath a project at this depth. */
export function canNest(parentDepth: number): boolean {
  return parentDepth + 1 < MAX_DEPTH;
}

/** What to call the parts of a project: whatever its existing parts are
 *  already called, so siblings stay consistent without anyone re-typing it.
 *  Falls back to a neutral word for the first one. */
export function childLabelFrom(siblingLabels: (string | null)[]): string {
  for (const l of siblingLabels) {
    const t = (l ?? "").trim();
    if (t) return t;
  }
  return "Sub-item";
}

/**
 * The next ref for a part of `parentRef`: PRJ-0003.1, then .2, and
 * PRJ-0003.1.2 a level down.
 *
 * Numbered inside the parent rather than from the workspace-wide PRJ
 * sequence, so breaking one project into three no longer pushes the next
 * real project's number along by three. Takes the highest existing suffix
 * rather than a count, so deleting .2 of three parts still yields .4 and a
 * retired number is never reissued to a different part.
 *
 * `siblingRefs` may contain anything the caller's LIKE picked up, including
 * deeper descendants (PRJ-0003.1.2) and unrelated rows -- only direct
 * children of this exact parent count.
 */
export function nextChildRef(parentRef: string, siblingRefs: (string | null)[]): string {
  // The parent ref is data, not a pattern.
  const quoted = parentRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const direct = new RegExp(`^${quoted}\\.(\\d+)$`);
  let highest = 0;
  for (const ref of siblingRefs) {
    const m = direct.exec(ref ?? "");
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return `${parentRef}.${highest + 1}`;
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
  if (!canNest(parentDepth)) return "That is already the deepest level";

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
  if (parentDepth + 1 + deepestBelow >= MAX_DEPTH) {
    return "Its sub-items would go deeper than allowed";
  }
  return null;
}
