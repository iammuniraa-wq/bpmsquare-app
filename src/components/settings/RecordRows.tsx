"use client";

import { Children } from "react";
import MoreMenu from "@/components/ui/MoreMenu";
import type { MenuItem } from "@/components/ui/menuItems";
import { c } from "@/lib/theme";
import { CARD_SURFACE } from "@/components/ui/Card";

/**
 * The row pattern every list-type settings page shares (decision 2 of
 * ui-restructure-spec section 11): "+ New ..." sits in the page header, each
 * record is one row, and Edit / Remove / the rest live in the row's "..."
 * menu. A plain list of divs rather than a table on purpose: the menu opens
 * downwards and a scrolling table would clip it.
 */
export function RecordList({ children, empty }: { children?: React.ReactNode; empty?: React.ReactNode }) {
  const rows = Children.toArray(children);
  return (
    <div style={{ ...CARD_SURFACE, padding: 0, minWidth: 0 }}>
      {rows.length === 0 ? empty : rows}
    </div>
  );
}

export function RecordRow({
  title, subtitle, facts, status, menu, dim, children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Small label/value pairs shown under the title, e.g. Quota: 2 / month. */
  facts?: { label: string; value: React.ReactNode }[];
  /** A StatusPill (or any chip) shown before the menu. */
  status?: React.ReactNode;
  menu?: MenuItem[];
  /** Fade an inactive record. */
  dim?: boolean;
  /** Inline edit form or extra detail, drawn under the row. */
  children?: React.ReactNode;
}) {
  return (
    <div className="bpm-record-row" style={{ borderTop: `1px solid ${c.line}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", opacity: dim ? 0.6 : 1 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: c.ink, overflowWrap: "anywhere" }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: c.muted, marginTop: 2, overflowWrap: "anywhere" }}>{subtitle}</div>}
          {facts && facts.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 14px", marginTop: 4, fontSize: 12, color: c.muted }}>
              {facts.map((f) => (
                <span key={f.label}><span style={{ color: c.hint }}>{f.label}: </span>{f.value}</span>
              ))}
            </div>
          )}
        </div>
        {status}
        {menu && <MoreMenu items={menu} label={`Actions for ${typeof title === "string" ? title : "this record"}`} />}
      </div>
      {children}
    </div>
  );
}
