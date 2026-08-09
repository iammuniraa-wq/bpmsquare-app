import type { ObjectSpec } from "./types";

// Users has no FIELD_REGISTRY entry and no custom fields (fixed columns) —
// kept as its own static spec rather than forced through the field-config
// machinery every other object now uses.
export const MEMBER_ROLES = ["admin", "member"] as const;

/** Separator for the multi-valued business_roles column. */
export const ROLE_LIST_SEPARATOR = ";";

export const USERS_SPEC: ObjectSpec = {
  id: "users",
  label: "Users",
  icon: "◍",
  description:
    "Add your team in bulk and assign Business Roles. No emails are sent — each person gets a temporary password you hand out.",
  dependsOn: [],
  fields: [
    { key: "name", label: "Full name", type: "text", required: true, hint: "Full name", aliases: ["person", "person name", "full name", "employee"] },
    { key: "email", label: "Email", type: "email", required: true, hint: "Work email — this is their login", aliases: ["email address", "e-mail", "mail", "work email"] },
    { key: "role", label: "Access level", type: "enum", required: true, options: MEMBER_ROLES, hint: "admin · member", aliases: ["access", "permission", "user role"] },
    {
      key: "business_roles",
      label: "Business roles",
      type: "text",
      required: false,
      hint: "Role names, separated by ; — e.g. Sales User;Marketing User. Ignored for admins.",
      aliases: ["business role", "roles", "role names", "permission set"],
    },
    {
      key: "employee_code",
      label: "Employee code",
      type: "text",
      required: false,
      hint: "Links this login to an existing employee (needed for Workforce punch-in)",
      aliases: ["employee id", "emp code", "staff code", "employee no"],
    },
  ],
  sampleRows: [
    { name: "Arjun Patel", email: "arjun@company.com", role: "member", business_roles: "Sales User", employee_code: "" },
    { name: "Vikram Nair", email: "vikram@company.com", role: "member", business_roles: "Service User;WFM User", employee_code: "EMP-014" },
  ],
};
