"use client";

import { c } from "@/lib/theme";
import type { EffectiveField, WidgetType } from "@/lib/fieldRegistry";
import { useSalesConfig } from "@/lib/useSalesConfig";

const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "8px 11px", fontSize: 13,
  border: `1px solid ${c.line}`, borderRadius: 7,
  background: c.panel, color: c.ink, outline: "none", fontFamily: "inherit",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatPlainDate(s: string): string {
  const [y, m, d] = s.split("-");
  if (!y || !m || !d) return s;
  return `${d} ${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

function assertNever(x: never): never {
  throw new Error(`Unhandled widget type: ${String(x)}`);
}

type Props = {
  field: EffectiveField;
  mode: "view" | "edit";
  value: unknown;
  onChange?: (value: unknown) => void;
};

export default function FieldWidget({ field, mode, value, onChange }: Props) {
  const salesCfg = useSalesConfig();
  if (mode === "view") return <FieldValueView field={field} value={value} />;
  return <FieldValueEdit field={field} value={value} onChange={onChange!} salesCfg={salesCfg} />;
}

function FieldValueView({ field, value }: { field: EffectiveField; value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <span style={{ color: c.hint }}>—</span>;
  }
  const widget: WidgetType = field.widget;
  switch (widget) {
    case "tel":
      return <a href={`tel:${value}`} style={{ color: c.accent, textDecoration: "none" }}>{String(value)}</a>;
    case "email":
      return <a href={`mailto:${value}`} style={{ color: c.accent, textDecoration: "none", wordBreak: "break-all" }}>{String(value)}</a>;
    case "url": {
      const href = String(value).startsWith("http") ? String(value) : `https://${value}`;
      return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: c.accent, textDecoration: "none", wordBreak: "break-all" }}>{String(value)}</a>;
    }
    case "checkbox":
      return <span>{value ? "Yes" : "No"}</span>;
    case "date":
      return <span>{formatPlainDate(String(value))}</span>;
    case "enum": {
      const opt = field.enumOptions?.find((o) => o.value === value);
      return <span>{opt?.label ?? String(value)}</span>;
    }
    case "select":
      return <span>{String(value)}</span>;
    case "textarea":
      return <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{String(value)}</p>;
    case "number":
    case "text":
      return <span style={{ wordBreak: "break-word" }}>{String(value)}</span>;
    default:
      return assertNever(widget);
  }
}

function FieldValueEdit({ field, value, onChange, salesCfg }: {
  field: EffectiveField;
  value: unknown;
  onChange: (v: unknown) => void;
  salesCfg: { territories: string[]; sales_orgs: string[] };
}) {
  const strValue = value === null || value === undefined ? "" : String(value);
  const widget: WidgetType = field.widget;

  switch (widget) {
    case "textarea":
      return (
        <textarea
          style={{ ...inp, minHeight: 70, resize: "vertical" }}
          value={strValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
        />
      );
    case "checkbox":
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          style={{ width: 16, height: 16, accentColor: c.accent }}
        />
      );
    case "date":
      return <input type="date" style={inp} value={strValue} onChange={(e) => onChange(e.target.value)} />;
    case "number":
      return <input type="number" style={inp} value={strValue} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} />;
    case "email":
      return <input type="email" style={inp} value={strValue} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} />;
    case "enum":
      return (
        <select style={{ ...inp, cursor: "pointer" }} value={strValue} onChange={(e) => onChange(e.target.value)}>
          {(field.enumOptions ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      );
    case "select": {
      const options = field.selectSource === "territory" ? salesCfg.territories
        : field.selectSource === "sales_org" ? salesCfg.sales_orgs
        : field.options ?? [];
      return (
        <select style={{ ...inp, cursor: "pointer" }} value={strValue} onChange={(e) => onChange(e.target.value)}>
          <option value="">— None —</option>
          {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          {strValue && !options.includes(strValue) && <option value={strValue}>{strValue}</option>}
        </select>
      );
    }
    // tel/url stay plain text inputs in edit mode — matching the existing
    // edit panels' behavior exactly (only "email" gets a typed input today).
    case "tel":
    case "url":
    case "text":
      return <input type="text" style={inp} value={strValue} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} />;
    default:
      return assertNever(widget);
  }
}
