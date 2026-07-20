-- One-off data copy, not a schema change: the "vikas" (BPMSquare Demo) tenant
-- was used as the pilot when the product was being built, and has a fully
-- configured company profile (Settings > Entities & Tax). The real
-- "vikas-pioneers" tenant is the same actual company, but launched blank
-- (company_info = '{}', no entities/tax/territories in config) — this copies
-- that profile over. logo_url is intentionally NOT copied: vikas-pioneers
-- already has its own correct top-level tenants.logo_url, which the print
-- layout already falls back to when company_info.logo_url is absent
-- (QuotePrintDocument.tsx: companyInfo.logo_url ?? logoUrl ?? null).
--
-- config uses jsonb `||` merge so vikas-pioneers' own dashboard_layout and
-- quote_type_visibility (already configured for that tenant) are preserved,
-- not overwritten.

update tenants
set company_info = '{
  "iso": "ISO 9001:2015",
  "web": "www.vikaspioneers.com",
  "name": "Vikas Pioneers (India) Pvt. Ltd.",
  "email": "vikaspioneers@gmail.com",
  "gstin": "29AAECV2169C1ZB",
  "email2": "vew@vikaspioneers.com",
  "phones": [
    {"label": "Dir & Tech", "number": "9342681227, 9538884600"},
    {"label": "Commercial", "number": "9538884603"},
    {"label": "Work", "number": "9538884602"},
    {"label": "Landline", "number": "08394-231687"}
  ],
  "address": "Plot No: N3-N4/1, Industrial Estate, Dam Road, Hosapete - 583201, Vijayanagara (Dist), Karnataka",
  "logo_bg": "#003087",
  "tagline": "Professional in Motor Rewinding",
  "partners": [
    {"name": "ABB India Limited", "logo_url": "https://upload.wikimedia.org/wikipedia/commons/0/00/ABB_logo.svg"},
    {"name": "Crompton Greaves", "logo_url": "https://upload.wikimedia.org/wikipedia/commons/f/f0/Crompton_Greaves_Logo.svg"},
    {"name": "Marathon Electric", "logo_url": ""},
    {"name": "Rotomotive", "logo_url": ""},
    {"name": "Kirloskar", "logo_url": "https://upload.wikimedia.org/wikipedia/commons/5/5f/Kirloskar_Group_Logo.svg"},
    {"name": "WEG", "logo_url": "https://upload.wikimedia.org/wikipedia/commons/8/81/Weg_logo_blue_vector.svg"},
    {"name": "Jyoti Ltd.", "logo_url": ""}
  ],
  "undertaking": "LT | HT Large Motors · Drives Application Motors · DC Motors · Transformers · Hydro Gensets Rewinding",
  "footer_tagline": "Assuring our best services as always!"
}'::jsonb,
config = config || '{
  "tax": {"rate": 18, "label": "GST", "inclusive": false},
  "entities": [{
    "id": "vpipl-ho-001",
    "name": "Vikas Pioneers (India) Pvt. Ltd.",
    "email": "vikaspioneers@gmail.com",
    "gstin": "29AAECV2169C1ZB",
    "phone": "9342681227",
    "address": "Plot No: N3-N4/1, Industrial Estate, Dam Road, Hosapete - 583201, Vijayanagara (Dist), Karnataka",
    "tagline": "Professional in Motor Rewinding",
    "is_default": true,
    "short_name": "VPIPL"
  }],
  "sales_orgs": ["BPM-INDIA"],
  "territories": ["South-IN", "North-IN", "West-IN", "East-IN"],
  "quote_statuses": [
    {"color": "#3b82f6", "label": "Draft", "value": "draft", "is_initial": true},
    {"color": "#8b5cf6", "label": "Pending", "value": "pending"},
    {"color": "#10b981", "label": "PO Received", "value": "po_received", "is_terminal": true}
  ],
  "asset_print_fields": ["name", "kind", "serial", "model", "make", "rating", "notes", "rpm"]
}'::jsonb
where slug = 'vikas-pioneers';
