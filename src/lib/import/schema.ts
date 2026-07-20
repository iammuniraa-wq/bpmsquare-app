import type { FieldSpec, ImportObjectId, ObjectSpec } from "./types";

export const ACCOUNT_TYPES = ["prospect", "oem", "direct", "end_customer"] as const;
export const ASSET_KINDS = ["motor", "transformer", "pump", "generator", "panel"] as const;
export const QUOTE_TYPES = ["quotation", "technical", "budgetary", "supply", "repair"] as const;
export const MEMBER_ROLES = ["admin", "member"] as const;
export const DISCOUNT_TYPES = ["pct", "fixed"] as const;

const ADDRESS_FIELDS: FieldSpec[] = [
  { key: "address_line1", label: "Address line 1", type: "text", hint: "Street / building / plot", aliases: ["address", "address1", "street", "addr line 1"] },
  { key: "address_line2", label: "Address line 2", type: "text", hint: "Area / landmark", aliases: ["address2", "landmark", "area"] },
  { key: "city", label: "City", type: "text", hint: "City", aliases: ["town"] },
  { key: "state", label: "State", type: "text", hint: "State / province", aliases: ["province", "region"] },
  { key: "postal_code", label: "Postal code", type: "text", hint: "PIN / ZIP code", aliases: ["pin", "pincode", "pin code", "zip", "zipcode", "postcode"] },
  { key: "country", label: "Country", type: "text", hint: "Country — defaults to India when blank", aliases: ["nation"] },
];

const SALES_FIELDS: FieldSpec[] = [
  { key: "territory", label: "Territory", type: "text", hint: "Sales territory, e.g. West India", aliases: ["sales territory", "zone"] },
  { key: "sales_org", label: "Sales org", type: "text", hint: "Sales org code, e.g. IN-West", aliases: ["sales organisation", "sales organization", "org"] },
];

const ACCOUNTS: ObjectSpec = {
  id: "accounts",
  label: "Accounts",
  icon: "▣",
  description: "Companies and organisations — the hub every other record links to",
  dependsOn: [],
  fields: [
    { key: "name", label: "Account name", type: "text", required: true, hint: "Full company name", aliases: ["company", "company name", "customer", "customer name", "account", "party", "party name", "organisation", "organization"] },
    { key: "type", label: "Type", type: "enum", required: true, options: ACCOUNT_TYPES, hint: "prospect · oem · direct · end_customer", aliases: ["account type", "category", "customer type"] },
    ...ADDRESS_FIELDS,
    { key: "phone", label: "Phone", type: "text", hint: "Primary phone", aliases: ["phone number", "mobile", "contact number", "tel", "telephone", "phone 1"] },
    { key: "phone2", label: "Phone 2", type: "text", hint: "Secondary phone", aliases: ["alternate phone", "phone 2", "mobile 2"] },
    { key: "email", label: "Email", type: "email", hint: "Primary email", aliases: ["email address", "e-mail", "mail", "email 1"] },
    { key: "email2", label: "Email 2", type: "email", hint: "Secondary email", aliases: ["alternate email", "email 2"] },
    { key: "website", label: "Website", type: "text", hint: "Website URL", aliases: ["url", "web", "site"] },
    { key: "industry", label: "Industry", type: "text", hint: "Industry / sector", aliases: ["sector", "vertical"] },
    { key: "employee_count", label: "Employees", type: "text", hint: "Number of employees", aliases: ["employees", "headcount", "staff"] },
    { key: "annual_revenue", label: "Annual revenue", type: "text", hint: "Annual revenue, e.g. ₹25 Cr", aliases: ["revenue", "turnover"] },
    ...SALES_FIELDS,
    { key: "gstin", label: "GSTIN", type: "text", hint: "GST number", aliases: ["gst", "gst no", "gst number", "tax id"] },
    { key: "notes", label: "Notes", type: "longtext", hint: "Any extra notes", aliases: ["remarks", "comments", "description"] },
    { key: "referred_by_account_name", label: "Referred by", type: "ref", hint: "Name of the OEM account that referred this one — only used when type is end_customer", aliases: ["referred by", "referrer", "oem", "oem name", "referred by account"] },
  ],
  sampleRows: [
    {
      name: "Vikas Pioneers India Pvt Ltd", type: "direct",
      address_line1: "Plot 12, MIDC Phase 2", address_line2: "Andheri East",
      city: "Mumbai", state: "Maharashtra", postal_code: "400093", country: "India",
      phone: "+91 98200 00001", email: "contact@vikaspioneers.com",
      website: "https://vikaspioneers.com", industry: "Textile Manufacturing",
      employee_count: "500", annual_revenue: "₹25 Cr", gstin: "27AABCV1234F1Z5",
      notes: "Key account since 2019",
    },
    {
      name: "Bharat Textiles Ltd", type: "oem",
      city: "Ahmedabad", state: "Gujarat", postal_code: "380001", country: "India",
      phone: "+91 97300 00002", email: "purchase@bharattex.com",
      industry: "Textiles", employee_count: "250", gstin: "24AABCB5678G1Z3",
    },
  ],
};

const CONTACTS: ObjectSpec = {
  id: "contacts",
  label: "Contacts",
  icon: "◉",
  description: "People at accounts — matched to an account by name",
  dependsOn: ["accounts"],
  fields: [
    { key: "account_name", label: "Account", type: "ref", required: true, hint: "Must match an account already in the system", aliases: ["company", "company name", "customer", "customer name", "account", "organisation", "organization"] },
    { key: "name", label: "Full name", type: "text", required: true, hint: "Contact's full name", aliases: ["contact name", "person", "person name", "full name"] },
    { key: "role", label: "Role", type: "text", hint: "Job title, e.g. Purchase Manager", aliases: ["title", "job title", "designation", "position"] },
    { key: "department", label: "Department", type: "text", hint: "Department, e.g. Maintenance", aliases: ["dept", "team", "function"] },
    { key: "phone", label: "Phone", type: "text", hint: "Primary phone", aliases: ["phone number", "mobile", "contact number", "tel", "telephone"] },
    { key: "phone2", label: "Phone 2", type: "text", hint: "Secondary phone", aliases: ["alternate phone", "phone 2"] },
    { key: "phone3", label: "Phone 3", type: "text", hint: "Third phone", aliases: ["phone 3"] },
    { key: "email", label: "Email", type: "email", hint: "Primary email", aliases: ["email address", "e-mail", "mail"] },
    { key: "email2", label: "Email 2", type: "email", hint: "Secondary email", aliases: ["alternate email", "email 2"] },
    { key: "website", label: "Website", type: "text", hint: "Personal or secondary profile URL", aliases: ["url", "web"] },
    { key: "linkedin_url", label: "LinkedIn", type: "text", hint: "LinkedIn profile URL", aliases: ["linkedin", "linked in"] },
    { key: "birthday", label: "Birthday", type: "date", hint: "YYYY-MM-DD", aliases: ["dob", "date of birth", "birth date"] },
    ...ADDRESS_FIELDS,
    ...SALES_FIELDS,
    { key: "notes", label: "Notes", type: "longtext", hint: "Any notes", aliases: ["remarks", "comments"] },
  ],
  sampleRows: [
    { account_name: "Vikas Pioneers India Pvt Ltd", name: "Rajesh Sharma", role: "General Manager", department: "Operations", phone: "+91 98200 11111", email: "rajesh@vikaspioneers.com" },
    { account_name: "Bharat Textiles Ltd", name: "Anand Mehta", role: "Maintenance Head", department: "Engineering", phone: "+91 97300 33333", email: "anand@bharattex.com" },
  ],
};

const ASSETS: ObjectSpec = {
  id: "assets",
  label: "Assets",
  icon: "⚙",
  description: "Motors, transformers, pumps and panels — owned by an account or held as loaner stock",
  dependsOn: ["accounts"],
  fields: [
    { key: "account_name", label: "Account", type: "ref", hint: "Owning account — leave blank for company-owned loaner stock", aliases: ["company", "company name", "customer", "customer name", "account", "owner"] },
    { key: "name", label: "Asset name", type: "text", required: true, hint: "Asset name or description", aliases: ["asset", "description", "equipment", "machine", "item"] },
    { key: "kind", label: "Kind", type: "enum", required: true, options: ASSET_KINDS, hint: "motor · transformer · pump · generator · panel", aliases: ["type", "asset type", "equipment type", "category"] },
    { key: "make", label: "Make", type: "text", hint: "Manufacturer / brand", aliases: ["manufacturer", "brand", "oem"] },
    { key: "model", label: "Model", type: "text", hint: "Model / frame number", aliases: ["model no", "model number", "frame"] },
    { key: "serial", label: "Serial", type: "text", hint: "Serial number", aliases: ["serial no", "serial number", "sr no", "sl no"] },
    { key: "rating", label: "Rating", type: "text", hint: "Rating / specs, e.g. 75 kW · 415V", aliases: ["specs", "specification", "kw", "capacity", "power"] },
    { key: "rpm", label: "RPM", type: "text", hint: "Speed in RPM, e.g. 1480", aliases: ["speed", "rev", "revolutions"] },
    { key: "is_loaner", label: "Loaner", type: "boolean", hint: "true / false — company loaner unit", aliases: ["loaner", "is loan", "loan unit", "spare"] },
    { key: "notes", label: "Notes", type: "longtext", hint: "Service history or remarks", aliases: ["remarks", "comments", "history"] },
  ],
  sampleRows: [
    { account_name: "Vikas Pioneers India Pvt Ltd", name: "Ring Frame Drive Motor #1", kind: "motor", make: "Crompton Greaves", model: "ND315S-2", serial: "CG-75-2291", rating: "75 kW · 415V", rpm: "1480", is_loaner: "false", notes: "Rewound June 2024" },
    { name: "Loaner Motor Pool Unit #4", kind: "motor", make: "Kirloskar", model: "KM-40S", serial: "KP-LN-0004", rating: "40 kW · 415V", rpm: "1440", is_loaner: "true", notes: "Workshop loaner pool" },
  ],
};

const QUOTES: ObjectSpec = {
  id: "quotes",
  label: "Quotes",
  icon: "₹",
  description: "Quotations with line items — one row per line, header fields on the first row of each quote",
  dependsOn: ["accounts", "contacts"],
  fields: [
    { key: "quote_name", label: "Quote name", type: "text", required: true, scope: "header", hint: "Groups rows into one quote — repeat on every line of the same quote", aliases: ["quote", "quotation", "quote title", "title"] },
    { key: "account_name", label: "Account", type: "ref", required: true, scope: "header", hint: "Must match an account already in the system", aliases: ["company", "company name", "customer", "customer name", "account", "party"] },
    { key: "contact_name", label: "Contact", type: "ref", scope: "header", hint: "Contact person at the account", aliases: ["contact", "contact person", "attn"] },
    { key: "type", label: "Quote type", type: "enum", options: QUOTE_TYPES, scope: "header", hint: "quotation · technical · budgetary · supply · repair", aliases: ["quote type", "offer type"] },
    { key: "date", label: "Date", type: "date", scope: "header", hint: "Quote date YYYY-MM-DD", aliases: ["quote date", "quotation date"] },
    { key: "valid_until", label: "Valid until", type: "date", scope: "header", hint: "Expiry date YYYY-MM-DD", aliases: ["validity", "expiry", "expiry date", "valid till"] },
    { key: "ref_no", label: "Reference no", type: "text", scope: "header", hint: "Client-facing reference, separate from the system quote ID", aliases: ["ref", "reference", "reference number", "our ref"] },
    { key: "pr_no", label: "PR no", type: "text", scope: "header", hint: "Customer purchase requisition number", aliases: ["pr", "pr number", "requisition"] },
    { key: "po_number", label: "PO number", type: "text", scope: "header", hint: "Customer PO number", aliases: ["po", "po no", "purchase order"] },
    { key: "po_amount", label: "PO amount", type: "number", scope: "header", hint: "PO value in INR", aliases: ["po value", "order value"] },
    { key: "scope_of_work", label: "Scope of work", type: "longtext", scope: "header", hint: "Scope description", aliases: ["scope", "sow", "work scope"] },
    { key: "notes", label: "Notes", type: "longtext", scope: "header", hint: "Notes for the customer", aliases: ["remarks", "comments"] },
    { key: "terms", label: "Terms", type: "longtext", scope: "header", hint: "Terms & conditions text", aliases: ["t&c", "terms and conditions", "conditions"] },
    { key: "discount_type", label: "Discount type", type: "enum", options: DISCOUNT_TYPES, scope: "header", hint: "pct · fixed", aliases: ["header discount type"] },
    { key: "discount_pct", label: "Discount %", type: "number", scope: "header", hint: "Header discount 0-100, used when discount_type is pct", aliases: ["discount percent", "header discount"] },
    { key: "discount_fixed", label: "Discount amount", type: "number", scope: "header", hint: "Header discount in INR, used when discount_type is fixed", aliases: ["discount value", "flat discount"] },
    { key: "gst_rate", label: "GST %", type: "number", scope: "header", hint: "GST rate — leave blank to omit GST entirely", aliases: ["gst", "tax", "tax rate", "gst percent"] },
    ...SALES_FIELDS.map((f) => ({ ...f, scope: "header" as const })),
    { key: "line_description", label: "Line description", type: "text" as const, required: true, scope: "line" as const, hint: "Line item description — required on every row", aliases: ["description", "item", "particulars", "work description", "line item"] },
    { key: "line_uom", label: "Line UOM", type: "text" as const, scope: "line" as const, hint: "Nos · Job · Set · Mtr · Kg", aliases: ["uom", "unit", "units"] },
    { key: "line_qty", label: "Line qty", type: "number" as const, scope: "line" as const, hint: "Quantity — defaults to 1", aliases: ["qty", "quantity", "nos"] },
    { key: "line_rate", label: "Line rate", type: "number" as const, scope: "line" as const, hint: "Rate in INR", aliases: ["rate", "price", "unit price", "unit rate"] },
    { key: "line_discount_pct", label: "Line discount %", type: "number" as const, scope: "line" as const, hint: "Line discount 0-100", aliases: ["line discount", "item discount"] },
  ],
  sampleRows: [
    {
      quote_name: "AMC 2025 - Vikas Pioneers", account_name: "Vikas Pioneers India Pvt Ltd",
      contact_name: "Rajesh Sharma", type: "quotation", date: "2025-01-15", valid_until: "2025-02-15",
      ref_no: "REF-AMC-2025-01", pr_no: "PR-4471", po_number: "PO-2025-001", po_amount: "150000",
      scope_of_work: "Annual maintenance of all motors in the spinning section",
      notes: "Payment within 30 days of invoice",
      terms: "18% GST applicable.\nPrices valid for 30 days.",
      discount_type: "pct", discount_pct: "0", gst_rate: "18",
      line_description: "Motor rewinding - 75 kW ring frame drive", line_uom: "Job", line_qty: "1", line_rate: "45000", line_discount_pct: "0",
    },
    {
      quote_name: "AMC 2025 - Vikas Pioneers",
      line_description: "Bearing replacement - SKF 6312", line_uom: "Nos", line_qty: "4", line_rate: "2500", line_discount_pct: "0",
    },
    {
      quote_name: "Pump Supply - Bharat Textiles", account_name: "Bharat Textiles Ltd",
      contact_name: "Anand Mehta", type: "supply", date: "2025-01-20", valid_until: "2025-02-20",
      scope_of_work: "Supply of centrifugal pumps for cooling tower",
      terms: "Delivery within 4 weeks. GST extra.",
      line_description: "3 HP Centrifugal Pump - Kirloskar STAR-3T", line_uom: "Nos", line_qty: "2", line_rate: "18000", line_discount_pct: "5",
    },
  ],
};

const USERS: ObjectSpec = {
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

export const IMPORT_OBJECTS: ObjectSpec[] = [ACCOUNTS, CONTACTS, ASSETS, QUOTES, USERS];

export function getObjectSpec(id: ImportObjectId): ObjectSpec {
  const spec = IMPORT_OBJECTS.find((o) => o.id === id);
  if (!spec) throw new Error(`Unknown import object: ${id}`);
  return spec;
}

/**
 * Workbench ids are plural; tenants.config.custom_fields keys are singular, and
 * users are not a custom-field-bearing object type.
 */
export const CUSTOM_FIELD_OBJECT_TYPE: Record<ImportObjectId, string | null> = {
  accounts: "account",
  contacts: "contact",
  assets: "asset",
  quotes: "quote",
  users: null,
};

export const CUSTOM_FIELD_PREFIX = "cf_";

/**
 * custom_fields.field_key is already stored prefixed (e.g. "cf_territory"), and
 * CustomFieldsSection reads custom_data by that exact key. Use it verbatim so the
 * import column, the stored key and the rendered field all agree.
 */
export function customFieldKey(rawKey: string): string {
  return rawKey.startsWith(CUSTOM_FIELD_PREFIX) ? rawKey : `${CUSTOM_FIELD_PREFIX}${rawKey}`;
}

export function customFieldToSpec(def: { key: string; label: string; type: string; options?: string[] }): FieldSpec {
  const type: FieldSpec["type"] =
    def.type === "number" ? "number"
    : def.type === "date" ? "date"
    : def.type === "boolean" || def.type === "checkbox" ? "boolean"
    : def.type === "select" ? "enum"
    : "text";

  const key = customFieldKey(def.key);

  return {
    key,
    label: def.label,
    type,
    hint: type === "enum" && def.options?.length ? def.options.join(" · ") : `Custom field — ${def.label}`,
    options: type === "enum" ? def.options : undefined,
    aliases: [def.label, def.key, key.slice(CUSTOM_FIELD_PREFIX.length)],
    custom: true,
    scope: "header",
  };
}

export function withCustomFields(spec: ObjectSpec, defs: { key: string; label: string; type: string; options?: string[] }[]): ObjectSpec {
  if (defs.length === 0) return spec;
  return { ...spec, fields: [...spec.fields, ...defs.map(customFieldToSpec)] };
}
