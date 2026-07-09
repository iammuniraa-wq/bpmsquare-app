"use client";

import { useState, useRef, useTransition } from "react";
import { c } from "@/lib/theme";

// ── Object definitions ────────────────────────────────────────────────────────

type ObjectId = "accounts" | "contacts" | "assets" | "quotes" | "users";

type ColDef = { key: string; label: string; required: boolean; hint: string };

const OBJECTS: {
  id: ObjectId;
  label: string;
  icon: string;
  description: string;
  columns: ColDef[];
  sampleRows: string[][];
}[] = [
  {
    id: "accounts",
    label: "Accounts",
    icon: "▣",
    description: "Companies and organisations — the central hub everything else links to",
    columns: [
      { key: "name",   label: "name",   required: true,  hint: "Full company name" },
      { key: "type",   label: "type",   required: true,  hint: "prospect | oem | direct | end_customer" },
      { key: "city",   label: "city",   required: false, hint: "City / location" },
      { key: "phone",  label: "phone",  required: false, hint: "Primary phone" },
      { key: "email",  label: "email",  required: false, hint: "Primary email" },
      { key: "gstin",  label: "gstin",  required: false, hint: "GST number" },
      { key: "notes",  label: "notes",  required: false, hint: "Any extra notes" },
    ],
    sampleRows: [
      ["Vikas Pioneers India Pvt Ltd", "direct", "Mumbai", "+91 98200 00001", "vikas@example.com", "27AABCV1234F1Z5", "Key account since 2019"],
      ["Bharat Textiles Ltd", "oem", "Ahmedabad", "+91 97300 00002", "purchase@bharattex.com", "24AABCB5678G1Z3", ""],
      ["Kohinoor Spinning Mills", "end_customer", "Nagpur", "+91 91200 00003", "", "", "End customer under Bharat Textiles"],
    ],
  },
  {
    id: "contacts",
    label: "Contacts",
    icon: "◉",
    description: "People at accounts — linked by account name (must match exactly)",
    columns: [
      { key: "account_name", label: "account_name", required: true,  hint: "Must match an existing or imported account name exactly" },
      { key: "name",         label: "name",         required: true,  hint: "Full name" },
      { key: "role",         label: "role",         required: false, hint: "Job title / role e.g. Purchase Manager" },
      { key: "phone",        label: "phone",        required: false, hint: "Direct phone" },
      { key: "email",        label: "email",        required: false, hint: "Work email" },
    ],
    sampleRows: [
      ["Vikas Pioneers India Pvt Ltd", "Rajesh Sharma", "General Manager", "+91 98200 11111", "rajesh@vikaspioneer.com"],
      ["Vikas Pioneers India Pvt Ltd", "Priya Iyer", "Purchase Manager", "+91 98200 22222", "priya@vikaspioneer.com"],
      ["Bharat Textiles Ltd", "Anand Mehta", "Maintenance Head", "+91 97300 33333", "anand@bharattex.com"],
    ],
  },
  {
    id: "assets",
    label: "Assets",
    icon: "⚙",
    description: "Equipment and machinery linked to accounts",
    columns: [
      { key: "account_name", label: "account_name", required: true,  hint: "Must match an existing account name exactly" },
      { key: "name",         label: "name",         required: true,  hint: "Asset name / description" },
      { key: "kind",         label: "kind",         required: true,  hint: "motor | transformer | pump | generator | panel" },
      { key: "make",         label: "make",         required: false, hint: "Manufacturer / brand" },
      { key: "model",        label: "model",        required: false, hint: "Model number" },
      { key: "serial",       label: "serial",       required: false, hint: "Serial number" },
      { key: "rating",       label: "rating",       required: false, hint: "Rating / specs e.g. 75 kW · 415V" },
      { key: "notes",        label: "notes",        required: false, hint: "Service history or remarks" },
    ],
    sampleRows: [
      ["Vikas Pioneers India Pvt Ltd", "Ring Frame Drive Motor #1", "motor", "Crompton Greaves", "ND315S-2", "CG-75-2291", "75 kW · 415V · 1480 rpm", "Rewound June 2024"],
      ["Vikas Pioneers India Pvt Ltd", "Main Transformer", "transformer", "Siemens", "SG-500KVA", "SM-0042", "500 KVA · 11KV/415V", ""],
      ["Bharat Textiles Ltd", "Cooling Tower Pump", "pump", "Kirloskar", "STAR-3T", "KP-9981", "3 HP · 415V", "Last serviced Jan 2025"],
    ],
  },
  {
    id: "quotes",
    label: "Quotes",
    icon: "₹",
    description: "Import full quotations with line items — one row per line item, repeated quote header on first row",
    columns: [
      { key: "quote_name",        label: "quote_name",        required: true,  hint: "Unique name for this quote — groups rows into one quote" },
      { key: "account_name",      label: "account_name",      required: true,  hint: "Must match an existing account name exactly (first row only)" },
      { key: "contact_name",      label: "contact_name",      required: false, hint: "Contact person at the account (first row only)" },
      { key: "type",              label: "type",              required: false, hint: "quotation | technical | budgetary | supply (first row only)" },
      { key: "date",              label: "date",              required: false, hint: "Quote date YYYY-MM-DD (first row only)" },
      { key: "valid_until",       label: "valid_until",       required: false, hint: "Expiry date YYYY-MM-DD (first row only)" },
      { key: "scope_of_work",     label: "scope_of_work",     required: false, hint: "Scope description (first row only)" },
      { key: "notes",             label: "notes",             required: false, hint: "Notes for customer (first row only)" },
      { key: "terms",             label: "terms",             required: false, hint: "T&C text (first row only)" },
      { key: "po_number",         label: "po_number",         required: false, hint: "Customer PO number (first row only)" },
      { key: "po_amount",         label: "po_amount",         required: false, hint: "PO value in INR (first row only)" },
      { key: "line_description",  label: "line_description",  required: true,  hint: "Line item description (every row)" },
      { key: "line_uom",          label: "line_uom",          required: false, hint: "Unit: Nos / Job / Set / Mtr / Kg (every row)" },
      { key: "line_qty",          label: "line_qty",          required: false, hint: "Quantity — default 1 (every row)" },
      { key: "line_rate",         label: "line_rate",         required: false, hint: "Rate in INR (every row)" },
      { key: "line_discount_pct", label: "line_discount_pct", required: false, hint: "Discount % 0-100 (every row)" },
    ],
    sampleRows: [
      // Quote 1 — three lines
      ["AMC 2025 - Vikas Pioneers", "Vikas Pioneers India Pvt Ltd", "Rajesh Sharma", "quotation", "2025-01-15", "2025-02-15", "Annual maintenance of all motors in spinning section", "Payment within 30 days of invoice", "18% GST applicable. Prices valid for 30 days.", "PO-2025-001", "150000", "Motor rewinding - 75 kW ring frame drive", "Job", "1", "45000", "0"],
      ["AMC 2025 - Vikas Pioneers", "", "", "", "", "", "", "", "", "", "", "Bearing replacement - SKF 6312", "Nos", "4", "2500", "0"],
      ["AMC 2025 - Vikas Pioneers", "", "", "", "", "", "", "", "", "", "", "Testing and commissioning", "Job", "1", "8000", "5"],
      // Quote 2 — two lines
      ["Pump Supply - Bharat Textiles", "Bharat Textiles Ltd", "Anand Mehta", "supply", "2025-01-20", "2025-02-20", "Supply of centrifugal pumps for cooling tower", "", "Delivery within 4 weeks. GST extra.", "", "", "3 HP Centrifugal Pump - Kirloskar STAR-3T", "Nos", "2", "18000", "5"],
      ["Pump Supply - Bharat Textiles", "", "", "", "", "", "", "", "", "", "", "Gate Valve 50mm - Cast Iron", "Nos", "4", "850", "0"],
    ],
  },
  {
    id: "users",
    label: "Users",
    icon: "◍",
    description: "Invite team members and assign roles — each person receives an email invite",
    columns: [
      { key: "name",  label: "name",  required: true,  hint: "Full name" },
      { key: "email", label: "email", required: true,  hint: "Work email — invite sent here" },
      { key: "role",  label: "role",  required: true,  hint: "admin | member" },
    ],
    sampleRows: [
      ["Arjun Patel",   "arjun@company.com",  "member"],
      ["Sunita Rao",    "sunita@company.com",  "member"],
      ["Vikram Nair",   "vikram@company.com",  "admin"],
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function csvRow(cells: string[]): string {
  return cells.map((c) => {
    const s = c ?? "";
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  }).join(",");
}

function buildTemplate(obj: typeof OBJECTS[0]): string {
  const BOM = "﻿";
  const header = csvRow(obj.columns.map((c) => c.key));
  const hints  = csvRow(obj.columns.map((c) => (c.required ? `[REQUIRED] ${c.hint}` : c.hint)));
  const rows   = obj.sampleRows.map(csvRow);
  return BOM + [header, hints, ...rows].join("\r\n");
}

function parseCSV(text: string): string[][] {
  // Strip BOM
  const clean = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = clean.split("\n").filter((l) => l.trim());
  return lines.map((line) => {
    const cells: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQ = false; }
        else { cur += ch; }
      } else {
        if (ch === '"') { inQ = true; }
        else if (ch === ",") { cells.push(cur.trim()); cur = ""; }
        else { cur += ch; }
      }
    }
    cells.push(cur.trim());
    return cells;
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ImportRow = {
  rowNum: number;
  data: Record<string, string>;
  errors: string[];
  status: "pending" | "ok" | "error" | "skipped";
};

type ImportResult = {
  inserted: number;
  skipped: number;
  errors: { row: number; error: string }[];
};

// ── Styles ────────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: "#fff", border: `1px solid ${c.line}`, borderRadius: 12, padding: "20px 22px",
};
const btn = (accent: string = c.accent): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600,
  background: accent, color: "#fff", border: "none", cursor: "pointer",
});
const btnGhost: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 500,
  background: "none", color: c.muted, border: `1px solid ${c.line}`, cursor: "pointer",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function ColumnSpec({ columns }: { columns: ColDef[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {columns.map((col) => (
        <div key={col.key} style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <code style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 700, color: c.accent, minWidth: 130 }}>
            {col.key}{col.required ? " *" : ""}
          </code>
          <span style={{ fontSize: 12, color: c.muted }}>{col.hint}</span>
        </div>
      ))}
      <div style={{ marginTop: 4, fontSize: 11, color: c.hint }}>* Required field</div>
    </div>
  );
}

function PreviewTable({ rows, columns }: { rows: ImportRow[]; columns: ColDef[] }) {
  return (
    <div style={{ overflowX: "auto", border: `1px solid ${c.line}`, borderRadius: 8 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: c.panel2 }}>
            <th style={{ padding: "8px 10px", textAlign: "left", color: c.hint, fontWeight: 600, whiteSpace: "nowrap", borderBottom: `1px solid ${c.line}` }}>Row</th>
            <th style={{ padding: "8px 10px", textAlign: "left", color: c.hint, fontWeight: 600, whiteSpace: "nowrap", borderBottom: `1px solid ${c.line}` }}>Status</th>
            {columns.map((col) => (
              <th key={col.key} style={{ padding: "8px 10px", textAlign: "left", color: c.hint, fontWeight: 600, whiteSpace: "nowrap", borderBottom: `1px solid ${c.line}` }}>
                {col.label}{col.required ? " *" : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const bg = row.errors.length > 0 ? "#fff7f7" : "#f7fff9";
            const statusColor = row.errors.length > 0 ? "#dc2626" : "#1d9e75";
            const statusLabel = row.errors.length > 0 ? "Error" : "Ready";
            return (
              <tr key={row.rowNum} style={{ borderBottom: `1px solid ${c.line}`, background: bg }}>
                <td style={{ padding: "7px 10px", color: c.hint, fontFamily: "monospace" }}>{row.rowNum}</td>
                <td style={{ padding: "7px 10px" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: statusColor, background: statusColor + "1a", borderRadius: 5, padding: "2px 8px" }}>
                    {statusLabel}
                  </span>
                  {row.errors.length > 0 && (
                    <div style={{ fontSize: 11, color: "#dc2626", marginTop: 3 }}>{row.errors.join("; ")}</div>
                  )}
                </td>
                {columns.map((col) => (
                  <td key={col.key} style={{ padding: "7px 10px", color: row.data[col.key] ? c.ink : c.hint, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {row.data[col.key] || <span style={{ fontSize: 11, fontStyle: "italic" }}>—</span>}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Importer panel ────────────────────────────────────────────────────────────

function ImporterPanel({ obj }: { obj: typeof OBJECTS[0] }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview]     = useState<ImportRow[] | null>(null);
  const [parseErr, setParseErr]   = useState("");
  const [result, setResult]       = useState<ImportResult | null>(null);
  const [pending, startImport]    = useTransition();
  const [dragging, setDragging]   = useState(false);

  function downloadTemplate() {
    const csv  = buildTemplate(obj);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `bpmsquare_import_${obj.id}_template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function processFile(file: File) {
    setParseErr("");
    setPreview(null);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      try {
        const parsed = parseCSV(text);
        if (parsed.length < 2) { setParseErr("File appears empty or has no data rows."); return; }

        const headers = parsed[0].map((h) => h.toLowerCase().trim());
        // Skip the hints row if it starts with "[REQUIRED]" or "[optional]"
        const firstDataIdx = parsed[1]?.[0]?.startsWith("[") ? 2 : 1;
        const dataRows = parsed.slice(firstDataIdx).filter((r) => r.some((c) => c.trim()));

        const importRows: ImportRow[] = dataRows.map((row, i) => {
          const data: Record<string, string> = {};
          headers.forEach((h, hi) => { data[h] = (row[hi] ?? "").trim(); });

          const errors: string[] = [];
          obj.columns.forEach((col) => {
            if (col.required && !data[col.key]) {
              errors.push(`${col.key} is required`);
            }
          });

          // Type-specific validation
          if (obj.id === "accounts") {
            const valid = ["prospect", "oem", "direct", "end_customer"];
            if (data.type && !valid.includes(data.type)) {
              errors.push(`type must be one of: ${valid.join(", ")}`);
            }
          }
          if (obj.id === "assets") {
            const valid = ["motor", "transformer", "pump", "generator", "panel"];
            if (data.kind && !valid.includes(data.kind)) {
              errors.push(`kind must be one of: ${valid.join(", ")}`);
            }
          }
          if (obj.id === "users") {
            const valid = ["admin", "member"];
            if (data.role && !valid.includes(data.role)) {
              errors.push(`role must be admin or member`);
            }
            if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
              errors.push(`email is not valid`);
            }
          }

          return { rowNum: firstDataIdx + i + 1, data, errors, status: errors.length ? "error" : "pending" };
        });

        setPreview(importRows);
      } catch {
        setParseErr("Could not parse the file. Make sure it is a CSV file.");
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function runImport() {
    if (!preview) return;
    const validRows = preview.filter((r) => r.errors.length === 0);
    if (validRows.length === 0) return;

    startImport(async () => {
      const res = await fetch(`/api/import/${obj.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: validRows.map((r) => r.data) }),
      });
      const json = await res.json();
      if (res.ok) {
        setResult(json as ImportResult);
        setPreview(null);
      } else {
        setParseErr(json.error ?? "Import failed");
      }
    });
  }

  const validCount   = preview?.filter((r) => r.errors.length === 0).length ?? 0;
  const errorCount   = preview?.filter((r) => r.errors.length > 0).length ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Step 1 — download template */}
      <div style={{ ...card }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: c.accentbg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0, color: c.accent }}>1</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: c.ink, marginBottom: 4 }}>Download the template</div>
            <p style={{ fontSize: 12.5, color: c.muted, margin: "0 0 14px", lineHeight: 1.6 }}>
              The template includes column headers, hints, and 3 sample rows. Fill in your data below the sample rows (or replace the samples). Save as <strong>.csv</strong> from Excel or Google Sheets.
            </p>
            <ColumnSpec columns={obj.columns} />
            <div style={{ marginTop: 16 }}>
              <button onClick={downloadTemplate} style={btn()}>
                ↓ Download CSV template
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Step 2 — upload */}
      <div style={{ ...card }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: c.accentbg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0, color: c.accent }}>2</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: c.ink, marginBottom: 4 }}>Upload your filled CSV</div>
            <p style={{ fontSize: 12.5, color: c.muted, margin: "0 0 14px", lineHeight: 1.6 }}>
              Drag and drop or click to choose your filled file. The first two rows (headers + hints) are ignored automatically.
            </p>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${dragging ? c.accent : c.line}`,
                borderRadius: 10, padding: "32px 24px", textAlign: "center", cursor: "pointer",
                background: dragging ? c.accentbg : c.panel2, transition: "all 0.15s",
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 8 }}>⇅</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>Drop CSV here or click to browse</div>
              <div style={{ fontSize: 12, color: c.hint, marginTop: 4 }}>Accepts .csv files · Excel files: File → Save As → CSV</div>
              <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFileChange} style={{ display: "none" }} />
            </div>

            {parseErr && (
              <div style={{ marginTop: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "#dc2626" }}>
                {parseErr}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Step 3 — preview + confirm */}
      {preview && (
        <div style={{ ...card }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: c.accentbg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0, color: c.accent }}>3</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: c.ink }}>Review before importing</div>
                <span style={{ fontSize: 12, color: "#1d9e75", fontWeight: 600, background: "#e1f5ee", borderRadius: 6, padding: "2px 10px" }}>
                  {validCount} ready
                </span>
                {errorCount > 0 && (
                  <span style={{ fontSize: 12, color: "#dc2626", fontWeight: 600, background: "#fef2f2", borderRadius: 6, padding: "2px 10px" }}>
                    {errorCount} with errors (will be skipped)
                  </span>
                )}
              </div>

              <PreviewTable rows={preview} columns={obj.columns} />

              <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center" }}>
                <button
                  onClick={runImport}
                  disabled={validCount === 0 || pending}
                  style={{
                    ...btn(validCount > 0 ? "#1d9e75" : c.line),
                    cursor: validCount > 0 && !pending ? "pointer" : "not-allowed",
                  }}
                >
                  {pending ? "Importing…" : `Import ${validCount} ${obj.label.toLowerCase()}`}
                </button>
                <button onClick={() => setPreview(null)} style={btnGhost}>Cancel</button>
                {errorCount > 0 && (
                  <span style={{ fontSize: 12, color: c.hint, marginLeft: 4 }}>
                    Fix the errors in your CSV and re-upload to include those rows.
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Result banner */}
      {result && (
        <div style={{ background: "#e1f5ee", border: "1px solid #a8dfc9", borderRadius: 10, padding: "16px 20px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#04342c", marginBottom: 6 }}>
            ✓ Import complete
          </div>
          <div style={{ fontSize: 13, color: "#1d6b4a" }}>
            {result.inserted} {obj.label.toLowerCase()} imported successfully.
            {result.skipped > 0 && ` ${result.skipped} skipped (duplicates).`}
          </div>
          {result.errors.length > 0 && (
            <div style={{ marginTop: 10 }}>
              {result.errors.map((e) => (
                <div key={e.row} style={{ fontSize: 12, color: "#dc2626" }}>Row {e.row}: {e.error}</div>
              ))}
            </div>
          )}
          <button onClick={() => setResult(null)} style={{ ...btnGhost, marginTop: 12, fontSize: 12 }}>
            Import another file
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DataWorkbenchClient() {
  const [activeId, setActiveId] = useState<ObjectId>("accounts");
  const activeObj = OBJECTS.find((o) => o.id === activeId)!;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 16, alignItems: "start" }}>

      {/* Left — object list */}
      <nav style={{ display: "flex", flexDirection: "column", gap: 4, position: "sticky", top: 20 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.7, padding: "4px 10px 8px" }}>
          Import objects
        </div>
        {OBJECTS.map((obj) => {
          const active = obj.id === activeId;
          return (
            <button
              key={obj.id}
              onClick={() => setActiveId(obj.id)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px", borderRadius: 8, border: "none", cursor: "pointer",
                textAlign: "left", width: "100%",
                background: active ? c.accentbg : "transparent",
                color: active ? c.accent : c.ink,
                fontWeight: active ? 600 : 400,
              }}
            >
              <span style={{ fontSize: 16, width: 20, textAlign: "center", flexShrink: 0 }}>{obj.icon}</span>
              <div>
                <div style={{ fontSize: 13 }}>{obj.label}</div>
                <div style={{ fontSize: 10.5, color: c.hint, marginTop: 1, fontWeight: 400 }}>
                  {obj.columns.length} columns
                </div>
              </div>
            </button>
          );
        })}

        <div style={{ borderTop: `1px solid ${c.line}`, marginTop: 12, paddingTop: 12 }}>
          <div style={{ fontSize: 11, color: c.hint, lineHeight: 1.6, padding: "0 10px" }}>
            <strong style={{ display: "block", marginBottom: 4, color: c.muted }}>Import order</strong>
            Import Accounts first, then Contacts and Assets (they reference account names), then Users last.
          </div>
        </div>
      </nav>

      {/* Right — importer */}
      <div>
        {/* Object header */}
        <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: c.accentbg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: c.accent }}>
            {activeObj.icon}
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: c.ink }}>{activeObj.label}</div>
            <div style={{ fontSize: 12.5, color: c.muted }}>{activeObj.description}</div>
          </div>
        </div>

        <ImporterPanel key={activeId} obj={activeObj} />
      </div>
    </div>
  );
}
