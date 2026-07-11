-- ─────────────────────────────────────────────────────────────────────────────
-- Vikas Pioneers [India] Pvt. Ltd. — BPMSquare tenant seed
-- Run in Supabase SQL Editor. Replace <VIKAS_TENANT_ID> with actual UUID.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Company info + partner logos
UPDATE tenants
SET company_info = '{
  "name":           "Vikas Pioneers (India) Pvt. Ltd.",
  "tagline":        "Professional in Motor Rewinding",
  "undertaking":    "LT | HT Large Motors · Drives Application Motors · DC Motors · Transformers · Hydro Gensets Rewinding",
  "iso":            "ISO 9001:2015",
  "email":          "vikaspioneers@gmail.com",
  "email2":         "vew@vikaspioneers.com",
  "web":            "www.vikaspioneers.com",
  "gstin":          "29AAECV2169C1ZB",
  "address":        "Plot No: N3-N4/1, Industrial Estate, Dam Road, Hosapete – 583201, Vijayanagara (Dist), Karnataka",
  "footer_tagline": "Assuring our best services as always!",
  "logo_bg":        "#003087",
  "phones": [
    { "label": "Dir & Tech",  "number": "9342681227, 9538884600" },
    { "label": "Commercial",  "number": "9538884603" },
    { "label": "Work",        "number": "9538884602" },
    { "label": "Landline",    "number": "08394-231687" }
  ],
  "partners": [
    {
      "name":     "ABB India Limited",
      "logo_url": "https://upload.wikimedia.org/wikipedia/commons/0/00/ABB_logo.svg"
    },
    {
      "name":     "Crompton Greaves",
      "logo_url": "https://upload.wikimedia.org/wikipedia/commons/f/f0/Crompton_Greaves_Logo.svg"
    },
    {
      "name":     "Marathon Electric",
      "logo_url": ""
    },
    {
      "name":     "Rotomotive",
      "logo_url": ""
    },
    {
      "name":     "Kirloskar",
      "logo_url": "https://upload.wikimedia.org/wikipedia/commons/5/5f/Kirloskar_Group_Logo.svg"
    },
    {
      "name":     "WEG",
      "logo_url": "https://upload.wikimedia.org/wikipedia/commons/8/81/Weg_logo_blue_vector.svg"
    },
    {
      "name":     "Jyoti Ltd.",
      "logo_url": ""
    }
  ]
}'::jsonb
WHERE id = '<VIKAS_TENANT_ID>';


-- 2. Config: entity + GST
UPDATE tenants
SET config = '{
  "tax": { "label": "GST", "rate": 18, "inclusive": false },
  "entities": [{
    "id":         "vpipl-ho-001",
    "name":       "Vikas Pioneers (India) Pvt. Ltd.",
    "short_name": "VPIPL",
    "tagline":    "Professional in Motor Rewinding",
    "address":    "Plot No: N3-N4/1, Industrial Estate, Dam Road, Hosapete – 583201, Vijayanagara (Dist), Karnataka",
    "phone":      "9342681227",
    "email":      "vikaspioneers@gmail.com",
    "gstin":      "29AAECV2169C1ZB",
    "is_default": true
  }]
}'::jsonb
WHERE id = '<VIKAS_TENANT_ID>';


-- 3. Verify
SELECT id, name, company_info->>'gstin' AS gstin,
       jsonb_array_length(company_info->'partners') AS partner_count
FROM tenants WHERE id = '<VIKAS_TENANT_ID>';
