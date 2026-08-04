import type { ObjectSpec } from "./types";

// Employees (0057) -- static spec like usersSchema.ts, since employees have
// no FIELD_REGISTRY entry / custom fields. Import-only for now: bulk-loading
// staff from an HR export is the use case; edits happen in the Business
// Users screen.
export const EMPLOYEES_SPEC: ObjectSpec = {
  id: "employees",
  label: "Employees",
  icon: "👥",
  description: "Load your staff list — an employee becomes loginable only when an admin creates a Business User for them",
  dependsOn: [],
  fields: [
    { key: "first_name", label: "First name", type: "text", required: true, hint: "Given name", aliases: ["firstname", "given name", "fname"] },
    { key: "last_name", label: "Last name", type: "text", hint: "Family name", aliases: ["lastname", "surname", "family name", "lname"] },
    { key: "employee_code", label: "Employee code", type: "text", hint: "Your HR system's employee ID — must be unique", aliases: ["employee id", "emp code", "emp id", "personnel number", "staff id"] },
    { key: "email", label: "Email", type: "email", hint: "Becomes the login email if a Business User is created", aliases: ["email address", "e-mail", "work email", "mail"] },
    { key: "phone", label: "Phone", type: "text", hint: "Contact number", aliases: ["mobile", "phone number", "contact number"] },
    { key: "department", label: "Department", type: "text", hint: "e.g. Sales, Service", aliases: ["dept", "team", "function"] },
    { key: "designation", label: "Designation", type: "text", hint: "Job title", aliases: ["title", "job title", "position", "role title"] },
    { key: "valid_from", label: "Valid from", type: "date", hint: "Employment start (YYYY-MM-DD)", aliases: ["start date", "joining date", "doj"] },
    { key: "valid_to", label: "Valid to", type: "date", hint: "Employment end, if fixed-term (YYYY-MM-DD)", aliases: ["end date", "leaving date", "contract end"] },
  ],
  sampleRows: [
    { first_name: "Arjun", last_name: "Patel", employee_code: "EMP-0042", email: "arjun@company.com", department: "Sales", designation: "Account Executive", valid_from: "2024-04-01" },
    { first_name: "Priya", last_name: "Sharma", employee_code: "EMP-0043", email: "priya@company.com", department: "Service", designation: "Service Engineer", valid_from: "2023-11-15" },
  ],
};
