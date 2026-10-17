import { NAV, type NavItem, type TenantFeatures } from "@/lib/constants";
import type { ViewableWorkcenters, WorkcenterKey } from "@/lib/workcenters";

// "Who sees what": for one person, which sidebar entries they get and, for
// each one they do not, which layer takes it away. It re-states the rules the
// app already applies (Sidebar.tsx filters, the app layout's supervisor test,
// resolvePermissions) over data that is already stored -- it stores nothing.

export type HidingLayer = "module" | "role" | "navigation" | "supervisor";

export const LAYER_LABEL: Record<HidingLayer, string> = {
  module: "Module is off for this workspace",
  role: "Business Role does not grant this workcenter",
  navigation: "Hidden in Settings → Navigation visibility",
  supervisor: "Workforce supervisors only",
};

/** What a person's login resolves to, as the app layout computes it. */
export type AccessInput = {
  role: "admin" | "member";
  /** "all" for admins and for members with no Business Role (today's default). */
  viewable: ViewableWorkcenters;
  isWfmSupervisor: boolean;
  roleNames: string[];
  /** Login switched off, or outside its valid dates -- they see nothing at all. */
  blocked?: string | null;
};

export type NavVerdict = {
  href: string;
  label: string;
  group: string;
  /** The bundle (Sales, Service, ...) a child sits under; null for a top-level entry. */
  parent: string | null;
  visible: boolean;
  hiddenBy: HidingLayer[];
};

export type GrantRow = { role_id: string; workcenter: string; can_view: boolean; can_edit: boolean };

/**
 * Mirrors resolvePermissions(): an admin, and a member with no Business Role,
 * are unrestricted. Otherwise a workcenter is viewable if ANY assigned role
 * grants view on it (the union -- roles only ever add).
 */
export function resolveAccess(args: {
  role: "admin" | "member";
  assignedRoleIds: string[];
  grants: GrantRow[];
  employeeIsActiveSupervisor: boolean;
}): Pick<AccessInput, "viewable" | "isWfmSupervisor"> {
  const { role, assignedRoleIds, grants, employeeIsActiveSupervisor } = args;
  if (role === "admin" || assignedRoleIds.length === 0) {
    return { viewable: "all", isWfmSupervisor: role === "admin" || employeeIsActiveSupervisor };
  }
  const mine = grants.filter((g) => assignedRoleIds.includes(g.role_id));
  const viewable = [...new Set(mine.filter((g) => g.can_view).map((g) => g.workcenter))] as WorkcenterKey[];
  // A Business Role with edit on "wfm" counts as a supervisor, same as the layout.
  const editsWfm = mine.some((g) => g.workcenter === "wfm" && g.can_edit);
  return { viewable, isWfmSupervisor: editsWfm || employeeIsActiveSupervisor };
}

function leafViewable(item: NavItem, viewable: ViewableWorkcenters): boolean {
  if (viewable === "all") return true;
  if (!item.workcenterKey) return true;
  return viewable.includes(item.workcenterKey as WorkcenterKey);
}

/** One verdict per sidebar link (children are listed, their bundle row is not). */
export function explainNav(args: {
  features: Partial<TenantFeatures>;
  hiddenHrefs: readonly string[];
  access: AccessInput;
}): NavVerdict[] {
  const { features, hiddenHrefs, access } = args;
  const out: NavVerdict[] = [];

  const judge = (item: NavItem, group: string, parent: string | null) => {
    const hiddenBy: HidingLayer[] = [];
    if (item.featureKey && features[item.featureKey as keyof TenantFeatures] !== true) hiddenBy.push("module");
    if (!leafViewable(item, access.viewable)) hiddenBy.push("role");
    if (hiddenHrefs.includes(item.href)) hiddenBy.push("navigation");
    if (item.supervisorOnly && !access.isWfmSupervisor) hiddenBy.push("supervisor");
    out.push({ href: item.href, label: item.label, group, parent, visible: hiddenBy.length === 0, hiddenBy });
  };

  for (const g of NAV) {
    for (const item of g.items) {
      if (item.children?.length) for (const ch of item.children) judge(ch, g.group, item.label);
      else judge(item, g.group, null);
    }
  }
  return out;
}
