// Who may see a study (docs/process-design-studio-architecture.md section 1).
// This is the TypeScript twin of process_studio_can_see() in 0152_process_studio.sql
// and the single rule every studio route applies on top of RLS:
//
//   - the creator always sees their own study;
//   - on a DEMO workspace nobody else does -- two prospects on the shared demo
//     tenant must never see each other's business;
//   - on any other workspace the tenant's admins see every study;
//   - a platform admin sees everything, but only through /admin/studies.
//
// Kept pure so the privacy rule is unit-tested (access.test.ts) and cannot drift
// from the SQL without a test noticing.

export type StudyViewer = {
  userId: string;
  role: "admin" | "member";
  /** tenants.is_demo for the workspace the request arrived on. */
  tenantIsDemo: boolean;
};

export function canSeeStudy(viewer: StudyViewer, study: { created_by: string }): boolean {
  if (study.created_by === viewer.userId) return true;
  if (viewer.tenantIsDemo) return false;
  return viewer.role === "admin";
}

/** The ids a list screen may show: used when a query returns more than the viewer may see. */
export function visibleStudies<T extends { created_by: string }>(viewer: StudyViewer, rows: readonly T[]): T[] {
  return rows.filter((r) => canSeeStudy(viewer, r));
}
