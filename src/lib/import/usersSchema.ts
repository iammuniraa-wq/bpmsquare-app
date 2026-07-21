import type { ObjectSpec } from "./types";

// Users has no FIELD_REGISTRY entry and no custom fields (invite-only flow,
// three fixed columns) — kept as its own static spec rather than forced
// through the field-config machinery every other object now uses.
export const MEMBER_ROLES = ["admin", "member"] as const;

export const USERS_SPEC: ObjectSpec = {
  id: "users",
  label: "Users",
  icon: "◍",
  description: "Invite team members and assign roles — each person receives an email invite",
  dependsOn: [],
  fields: [
    { key: "name", label: "Full name", type: "text", required: true, hint: "Full name", aliases: ["person", "person name", "full name", "employee"] },
    { key: "email", label: "Email", type: "email", required: true, hint: "Work email — the invite is sent here", aliases: ["email address", "e-mail", "mail", "work email"] },
    { key: "role", label: "Role", type: "enum", required: true, options: MEMBER_ROLES, hint: "admin · member", aliases: ["access", "permission", "user role"] },
  ],
  sampleRows: [
    { name: "Arjun Patel", email: "arjun@company.com", role: "member" },
    { name: "Vikram Nair", email: "vikram@company.com", role: "admin" },
  ],
};
