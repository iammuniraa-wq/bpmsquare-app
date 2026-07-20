"use client";

import { c } from "@/lib/theme";
import { banner, mono, pill, select, td, th, tone } from "./ui";
import type { ColumnMapping, ObjectSpec, ParsedSheet } from "@/lib/import/types";

type Props = {
  sheet: ParsedSheet;
  spec: ObjectSpec;
  mapping: ColumnMapping;
  onChange: (mapping: ColumnMapping) => void;
};

export default function ColumnMapper({ sheet, spec, mapping, onChange }: Props) {
  const claimed = new Set(Object.values(mapping).filter(Boolean) as string[]);
  const missingRequired = spec.fields.filter((f) => f.required && !claimed.has(f.key));
  const mappedCount = claimed.size;
  const ignoredCount = sheet.headers.filter((h, i) => h.trim() !== "" && !mapping[i]).length;

  function setColumn(index: number, key: string | null) {
    onChange({ ...mapping, [index]: key });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={pill(tone.ok)}>{mappedCount} columns matched</span>
        {ignoredCount > 0 && <span style={pill(tone.warn)}>{ignoredCount} ignored</span>}
        {missingRequired.length > 0 && (
          <span style={pill(tone.bad)}>{missingRequired.length} required field{missingRequired.length > 1 ? "s" : ""} unmapped</span>
        )}
      </div>

      {missingRequired.length > 0 && (
        <div style={banner(tone.bad)}>
          <strong>Map these before continuing:</strong>{" "}
          {missingRequired.map((f) => f.label).join(", ")}. Pick the matching column from your file in the
          dropdowns below, or add the column to your file and re-upload.
        </div>
      )}

      <div style={{ overflowX: "auto", border: `1px solid ${c.line}`, borderRadius: 9 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Column in your file</th>
              <th style={th}>First value</th>
              <th style={{ ...th, width: 260 }}>Imports into</th>
            </tr>
          </thead>
          <tbody>
            {sheet.headers.map((header, index) => {
              const isBlankHeader = header.trim() === "";
              const sample = sheet.rows.find((r) => (r[index] ?? "").trim() !== "")?.[index] ?? "";
              const assigned = mapping[index] ?? null;

              return (
                <tr key={index} style={{ background: assigned ? "transparent" : c.panel2 }}>
                  <td style={{ ...td, ...mono, fontWeight: 600, color: isBlankHeader ? c.hint : c.ink }}>
                    {isBlankHeader ? `(column ${index + 1}, no header)` : header}
                  </td>
                  <td style={{ ...td, color: c.muted, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {sample || <span style={{ fontStyle: "italic", color: c.hint }}>empty</span>}
                  </td>
                  <td style={td}>
                    <select
                      value={assigned ?? ""}
                      onChange={(e) => setColumn(index, e.target.value || null)}
                      style={{
                        ...select,
                        color: assigned ? c.ink : c.hint,
                        borderColor: assigned ? c.line : c.line,
                      }}
                    >
                      <option value="">— don&apos;t import —</option>
                      {spec.fields.map((field) => {
                        const takenElsewhere = claimed.has(field.key) && assigned !== field.key;
                        return (
                          <option key={field.key} value={field.key} disabled={takenElsewhere}>
                            {field.label}
                            {field.required ? " (required)" : ""}
                            {takenElsewhere ? " — already mapped" : ""}
                          </option>
                        );
                      })}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 11.5, color: c.hint, lineHeight: 1.6 }}>
        Columns set to <em>don&apos;t import</em> are left untouched — extra columns in your file are fine.
      </div>
    </div>
  );
}
