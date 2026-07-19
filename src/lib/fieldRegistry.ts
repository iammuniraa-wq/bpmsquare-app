// Import from the client-safe labels mirror, not "@/lib/data" (the barrel
// re-exports server-only live.ts data functions, which would otherwise leak
// into every client component that imports this registry).
import { ACCOUNT_TYPE_LABEL } from "@/lib/data/labels";
import type { AccountType } from "@/lib/types";

// ── Widget types ─────────────────────────────────────────────────────────────
//
// Superset of custom_fields.field_type ("text"|"number"|"date"|"select"|
// "checkbox"|"textarea") plus standard-field-only refinements that carry
// display/edit conventions the app already has (tel: links, mailto: links,
// https:// prefixing, fixed enums, sales-config-sourced dropdowns). Custom
// fields only ever use the shared subset — a tenant can never accidentally
// create a custom field that requires code-defined enum options.
export type WidgetType =
  | "text" | "textarea" | "number" | "date" | "select" | "checkbox"
  | "tel" | "email" | "url"
  | "enum";

export type SelectSource = "territory" | "sales_org"; // resolved via useSalesConfig()

export type StandardFieldDef = {
  /** Permanent DB column name — never renamed, never changes. */
  key: string;
  /** Label shown unless a field_overrides row sets a different one. */
  defaultLabel: string;
  widget: WidgetType;
  /** Seed section — tenant can reassign via field_overrides.section. */
  defaultSection: string;
  /** Cannot be hidden via a field_overrides.is_hidden override (e.g. name). Rename is still allowed. */
  locked?: boolean;
  /** Exists in the registry (discoverable via Adapt) but not shown out of the box. */
  hiddenByDefault?: boolean;
  /** False = read-only in the generic edit form (e.g. referred_by_account_id, created_at). Default true. */
  editable?: boolean;
  /** widget === "select" only */
  selectSource?: SelectSource;
  /** widget === "enum" only */
  enumOptions?: { value: string; label: string }[];
  placeholder?: string;
};

export type ObjectFieldRegistry = {
  /** Seed section order — also the section list offered in the Adapt drawer's pickers. */
  sections: string[];
  fields: StandardFieldDef[];
};

/**
 * The merged, effective shape of one field (standard or custom) after
 * applying tenant field_overrides — what the server's /api/settings/
 * field-config route returns and what every rendering component consumes.
 * Rule-derived hidden/required (via applyRules) are computed on TOP of
 * this at render time, since that needs live form values, not just config.
 */
export type EffectiveField = {
  field_key: string;
  label: string;
  widget: WidgetType;
  section: string;
  position: number;
  hidden: boolean;
  required: boolean;
  locked: boolean;
  editable: boolean;
  kind: "standard" | "custom";
  /** custom_fields.id — only set when kind === "custom" (needed to DELETE the definition). */
  id?: string;
  options?: string[];
  selectSource?: SelectSource;
  enumOptions?: { value: string; label: string }[];
  placeholder?: string;
};

export type PilotObjectType = "account" | "contact";

const ACCOUNT_TYPE_OPTIONS: { value: AccountType; label: string }[] =
  (Object.keys(ACCOUNT_TYPE_LABEL) as AccountType[]).map((value) => ({ value, label: ACCOUNT_TYPE_LABEL[value] }));

export const FIELD_REGISTRY: Record<PilotObjectType, ObjectFieldRegistry> = {
  account: {
    sections: ["Identity", "Address", "Communication", "Sales", "Business", "Notes"],
    fields: [
      { key: "name", defaultLabel: "Name", widget: "text", defaultSection: "Identity", locked: true },
      { key: "type", defaultLabel: "Type", widget: "enum", defaultSection: "Identity", enumOptions: ACCOUNT_TYPE_OPTIONS },

      { key: "address_line1", defaultLabel: "Address line 1", widget: "text", defaultSection: "Address", placeholder: "Street / building" },
      { key: "address_line2", defaultLabel: "Address line 2", widget: "text", defaultSection: "Address", placeholder: "Area / landmark" },
      { key: "city", defaultLabel: "City", widget: "text", defaultSection: "Address" },
      { key: "state", defaultLabel: "State", widget: "text", defaultSection: "Address" },
      { key: "postal_code", defaultLabel: "Postal code", widget: "text", defaultSection: "Address" },
      { key: "country", defaultLabel: "Country", widget: "text", defaultSection: "Address" },

      { key: "phone", defaultLabel: "Primary phone", widget: "tel", defaultSection: "Communication" },
      { key: "phone2", defaultLabel: "Secondary phone", widget: "tel", defaultSection: "Communication" },
      { key: "email", defaultLabel: "Primary email", widget: "email", defaultSection: "Communication" },
      { key: "email2", defaultLabel: "Secondary email", widget: "email", defaultSection: "Communication" },
      { key: "website", defaultLabel: "Website", widget: "url", defaultSection: "Communication" },

      { key: "territory", defaultLabel: "Territory", widget: "select", defaultSection: "Sales", selectSource: "territory" },
      { key: "sales_org", defaultLabel: "Sales org", widget: "select", defaultSection: "Sales", selectSource: "sales_org" },

      { key: "industry", defaultLabel: "Industry", widget: "text", defaultSection: "Business" },
      { key: "employee_count", defaultLabel: "Employees", widget: "text", defaultSection: "Business" },
      { key: "annual_revenue", defaultLabel: "Annual revenue", widget: "text", defaultSection: "Business" },
      { key: "gstin", defaultLabel: "GSTIN", widget: "text", defaultSection: "Business" },

      { key: "notes", defaultLabel: "Notes", widget: "textarea", defaultSection: "Notes" },

      { key: "referred_by_account_id", defaultLabel: "Referred by", widget: "text", defaultSection: "Business", locked: true, editable: false, hiddenByDefault: true },
      { key: "created_at", defaultLabel: "Created", widget: "date", defaultSection: "Identity", locked: true, editable: false, hiddenByDefault: true },
    ],
  },

  contact: {
    sections: ["Identity", "Phone numbers", "Email & web", "Address", "Sales", "Notes"],
    fields: [
      { key: "name", defaultLabel: "Name", widget: "text", defaultSection: "Identity", locked: true },
      { key: "role", defaultLabel: "Role", widget: "text", defaultSection: "Identity" },
      { key: "department", defaultLabel: "Department", widget: "text", defaultSection: "Identity" },
      { key: "birthday", defaultLabel: "Birthday", widget: "date", defaultSection: "Identity" },
      { key: "linkedin_url", defaultLabel: "LinkedIn", widget: "url", defaultSection: "Identity" },

      { key: "phone", defaultLabel: "Primary", widget: "tel", defaultSection: "Phone numbers" },
      { key: "phone2", defaultLabel: "Secondary", widget: "tel", defaultSection: "Phone numbers" },
      { key: "phone3", defaultLabel: "Third", widget: "tel", defaultSection: "Phone numbers" },

      { key: "email", defaultLabel: "Primary email", widget: "email", defaultSection: "Email & web" },
      { key: "email2", defaultLabel: "Secondary email", widget: "email", defaultSection: "Email & web" },
      { key: "website", defaultLabel: "Website", widget: "url", defaultSection: "Email & web" },

      { key: "address_line1", defaultLabel: "Address line 1", widget: "text", defaultSection: "Address" },
      { key: "address_line2", defaultLabel: "Address line 2", widget: "text", defaultSection: "Address" },
      { key: "city", defaultLabel: "City", widget: "text", defaultSection: "Address" },
      { key: "state", defaultLabel: "State", widget: "text", defaultSection: "Address" },
      { key: "postal_code", defaultLabel: "Postal code", widget: "text", defaultSection: "Address" },
      { key: "country", defaultLabel: "Country", widget: "text", defaultSection: "Address" },

      { key: "territory", defaultLabel: "Territory", widget: "select", defaultSection: "Sales", selectSource: "territory" },
      { key: "sales_org", defaultLabel: "Sales org", widget: "select", defaultSection: "Sales", selectSource: "sales_org" },

      { key: "notes", defaultLabel: "Notes", widget: "textarea", defaultSection: "Notes" },
    ],
  },
};

export function isPilotObjectType(objectType: string): objectType is PilotObjectType {
  return objectType === "account" || objectType === "contact";
}

// ── Rule condition tree ──────────────────────────────────────────────────────

export type ConditionOperator =
  | "equals" | "not_equals"
  | "contains" | "not_contains"
  | "is_empty" | "is_not_empty"
  | "in" | "not_in";

export type FieldCondition = {
  type: "condition";
  /** Another field on the SAME object (standard registry key or custom cf_ key). */
  field_key: string;
  operator: ConditionOperator;
  /** Omitted for is_empty / is_not_empty. */
  value?: string | number | boolean | (string | number)[] | null;
};

export type ConditionGroup = {
  type: "group";
  logic: "AND" | "OR";
  children: ConditionNode[];
};

export type ConditionNode = FieldCondition | ConditionGroup;

export type FieldRuleEffect = "hide" | "show" | "require" | "optional";

export type FieldRule = {
  id: string;
  object_type: string;
  target_field_key: string;
  effect: FieldRuleEffect;
  conditions: ConditionNode;
  is_active: boolean;
  position: number;
};

const CONDITION_OPERATORS: readonly ConditionOperator[] =
  ["equals", "not_equals", "contains", "not_contains", "is_empty", "is_not_empty", "in", "not_in"];

/** Structural validator for a ConditionNode tree coming from an API request body (untyped JSON). */
export function isValidConditionNode(node: unknown): node is ConditionNode {
  if (typeof node !== "object" || node === null) return false;
  const n = node as Record<string, unknown>;
  if (n.type === "condition") {
    return typeof n.field_key === "string" && n.field_key.length > 0
      && typeof n.operator === "string" && CONDITION_OPERATORS.includes(n.operator as ConditionOperator);
  }
  if (n.type === "group") {
    return (n.logic === "AND" || n.logic === "OR")
      && Array.isArray(n.children) && n.children.length > 0
      && n.children.every(isValidConditionNode);
  }
  return false;
}

/** Pure, side-effect-free — safe to run identically on server and client. */
export function evaluateConditionNode(node: ConditionNode, values: Record<string, unknown>): boolean {
  if (node.type === "group") {
    const results = node.children.map((child) => evaluateConditionNode(child, values));
    return node.logic === "AND" ? results.every(Boolean) : results.some(Boolean);
  }
  const actual = values[node.field_key];
  switch (node.operator) {
    case "equals": return String(actual ?? "") === String(node.value ?? "");
    case "not_equals": return String(actual ?? "") !== String(node.value ?? "");
    case "contains": return String(actual ?? "").toLowerCase().includes(String(node.value ?? "").toLowerCase());
    case "not_contains": return !String(actual ?? "").toLowerCase().includes(String(node.value ?? "").toLowerCase());
    case "is_empty": return actual === null || actual === undefined || actual === "";
    case "is_not_empty": return !(actual === null || actual === undefined || actual === "");
    case "in": return Array.isArray(node.value) && node.value.map(String).includes(String(actual ?? ""));
    case "not_in": return Array.isArray(node.value) && !node.value.map(String).includes(String(actual ?? ""));
    default: {
      const _exhaustive: never = node.operator;
      return _exhaustive;
    }
  }
}

/**
 * Evaluation precedence per field (SAP C4C convention: hide wins over show,
 * require wins over optional — the safer outcome always wins so a
 * misconfigured rule fails closed, not open):
 *   1. Start from the field's base hidden/required state (registry default
 *      + field_overrides.is_hidden / custom_fields.is_required).
 *   2. Any ACTIVE matching rule with effect 'hide'     -> hidden = true  (wins over 'show').
 *   3. Any ACTIVE matching rule with effect 'show'     -> hidden = false, unless a hide-rule also matched.
 *   4. Any ACTIVE matching rule with effect 'require'  -> required = true (wins over 'optional').
 *   5. Any ACTIVE matching rule with effect 'optional' -> required = false, unless a require-rule also matched.
 */
export function applyRules(
  rules: FieldRule[],
  fieldKey: string,
  baseHidden: boolean,
  baseRequired: boolean,
  values: Record<string, unknown>,
): { hidden: boolean; required: boolean } {
  let hideMatched = false;
  let showMatched = false;
  let requireMatched = false;
  let optionalMatched = false;

  for (const rule of rules) {
    if (!rule.is_active || rule.target_field_key !== fieldKey) continue;
    if (!evaluateConditionNode(rule.conditions, values)) continue;
    if (rule.effect === "hide") hideMatched = true;
    if (rule.effect === "show") showMatched = true;
    if (rule.effect === "require") requireMatched = true;
    if (rule.effect === "optional") optionalMatched = true;
  }

  return {
    hidden: hideMatched ? true : showMatched ? false : baseHidden,
    required: requireMatched ? true : optionalMatched ? false : baseRequired,
  };
}
