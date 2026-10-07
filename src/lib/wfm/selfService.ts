/**
 * Whether one employee may punch from their own phone.
 *
 * `override` is employees.self_service_override (KAN-29): null/undefined
 * follows the workspace switch, true/false beats it. `undefined` is treated
 * exactly like null so the code keeps working while migration 0126 is still
 * unapplied and the column does not exist.
 */
export function effectiveSelfService(
  override: boolean | null | undefined,
  workspaceDefault: boolean
): boolean {
  return override ?? workspaceDefault;
}
