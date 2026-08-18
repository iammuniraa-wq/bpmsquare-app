import type { ObjectSpec } from "./types";
import type { FieldConfigResult } from "@/lib/fieldConfig";
import { customFieldSpecs } from "./registrySchema";

// Employees (0057) -- static spec like usersSchema.ts: the standard columns
// are hand-authored rather than derived from FIELD_REGISTRY, because the WFM
// surfaces render employee identity themselves. Tenant CUSTOM fields (0086)
// are appended at request time by buildEmployeesSpec(). Employee codes are
// SYSTEM-GENERATED on import (EMP-#### block, lib/employeeRef.ts) -- the
// file carries no code column on the way in, and export emits it read-only.
export const EMPLOYEES_SPEC: ObjectSpec = {
  id: "employees",
  label: "Employees",
  icon: "👥",
  description: "Load your staff list — an employee becomes loginable only when an admin creates a Business User for them",
  dependsOn: [],
  fields: [
    { key: "first_name", label: "First name", type: "text", required: true, hint: "Given name", aliases: ["firstname", "given name", "fname"] },
    { key: "last_name", label: "Last name", type: "text", hint: "Family name", aliases: ["lastname", "surname", "family name", "lname"] },
    { key: "email", label: "Email", type: "email", hint: "Becomes the login email if a Business User is created", aliases: ["email address", "e-mail", "work email", "mail"] },
    { key: "phone", label: "Phone", type: "text", hint: "Contact number", aliases: ["mobile", "phone number", "contact number"] },
    { key: "department", label: "Department", type: "text", hint: "e.g. Sales, Service", aliases: ["dept", "team", "function"] },
    { key: "designation", label: "Designation", type: "text", hint: "Job title", aliases: ["title", "job title", "position", "role title"] },
    { key: "valid_from", label: "Valid from", type: "date", hint: "Employment start (YYYY-MM-DD)", aliases: ["start date", "joining date", "doj"] },
    { key: "valid_to", label: "Valid to", type: "date", hint: "Employment end, if fixed-term (YYYY-MM-DD)", aliases: ["end date", "leaving date", "contract end"] },
  ],
  sampleRows: [
    { first_name: "Arjun", last_name: "Patel", email: "arjun@company.com", department: "Sales", designation: "Account Executive", valid_from: "2024-04-01" },
    { first_name: "Priya", last_name: "Sharma", email: "priya@company.com", department: "Service", designation: "Service Engineer", valid_from: "2023-11-15" },
  ],
};

/**
 * The employees spec as a tenant actually sees it: the static columns above
 * plus that tenant's employee custom fields, and -- for export/update only --
 * the read-only employee_code, so an exported file shows which staff row each
 * line is. Import never offers employee_code (codes are system-generated).
 *
 * Data Workbench, the export route and the update route all build the spec
 * through here, so a custom field can never appear in one and be missing from
 * the others.
 */
export function buildEmployeesSpec(fieldConfig: FieldConfigResult): ObjectSpec {
  return {
    ...EMPLOYEES_SPEC,
    fields: [
      { key: "employee_code", label: "Employee code", type: "text", hint: "System-generated — read-only", aliases: ["emp code", "employee id", "staff id"], exportOnly: true },
      ...EMPLOYEES_SPEC.fields,
      ...customFieldSpecs(fieldConfig),
    ],
  };
}
