// The explanations the People page keeps behind an "i" (bpmsquarecore 6b). One place, so a test holds every text
// to the InfoTip limit (two sentences, 160 characters). The screen never prints these as running text.

export const PEOPLE_TIPS = {
  page: "People who can sign in. Add someone from their employee record, or here directly.",
  role: "An Admin can change settings and reach everything. A Member reaches only what their business roles allow.",
  businessRoles: "Pick the roles that decide which screens this member sees. With none picked, the member keeps full access.",
  validity: "The dates this login works between. Leave both empty for no limit.",
  counted: "A counted user takes one licence seat.",
  password: "Sets a new password now. They must choose their own the next time they sign in.",
  changes: "Every access change for this login: who made it and when. Passwords are never shown.",
  inviteValidity: "Copied from the employee record. You can change it later on the person.",
  employee: "Ties this login to an employee record. Only an employee without a login can be picked.",
  invitePassword: "Leave empty to email an invite. If the email already has an account, it is added to this workspace and the password is ignored.",
  inviteEmployee: "Creates the login for an employee. A password is needed because no invite email is sent.",
  roleAccess: "Tick the areas this role can open. Create, Edit and Delete decide what the person can do there.",
  roleDashboard: "The dashboard members of this role see first. People with several roles see them combined.",
  standardRole: "Shipped with BPMSquare and kept up to date, so it cannot be edited. Duplicate it to make a version you can change.",
  syncRole: "Re-applies the current catalog to this role, for one set up before a catalog fix.",
} as const;

export type PeopleTipKey = keyof typeof PEOPLE_TIPS;
