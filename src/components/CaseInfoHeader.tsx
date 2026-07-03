"use client";

import { useState } from "react";
import Link from "next/link";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";

type Props = {
  accountId: string;
  accountName: string;
  accountCity: string | null;
  accountPhone: string | null;
  accountEmail: string | null;
  contactName: string | null;
  contactRole: string | null;
  contactPhone: string | null;
  equipmentLabel: string;
  technicianName: string | null;
  intakeAt: string;
  closedAt: string | null;
  complaint: string;
  notes: string | null;
  loanerName: string | null;
  contractRef: string | null;
};

const fmtDateTime = (s: string) =>
  new Date(s).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });

export default function CaseInfoHeader({
  accountId, accountName, accountCity, accountPhone, accountEmail,
  contactName, contactRole, contactPhone,
  equipmentLabel, technicianName, intakeAt, closedAt,
  complaint, notes, loanerName, contractRef,
}: Props) {
  const [open, setOpen] = useState(false);

  // Summary chips shown in collapsed state
  const chips = [
    { icon: "", label: accountName },
    equipmentLabel ? { icon: "", label: equipmentLabel } : null,
    technicianName ? { icon: "", label: technicianName } : null,
    loanerName     ? { icon: "", label: `Loaner: ${loanerName}` } : null,
  ].filter(Boolean) as { icon: string; label: string }[];

  return (
    <div style={{
      background: c.panel,
      border: `1px solid ${c.line}`,
      borderRadius: 10,
      marginBottom: 12,
      overflow: "hidden",
    }}>
      {/* Toggle button — always visible */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {/* Label */}
        <span style={{ fontSize: 11, fontWeight: 700, color: c.accent, textTransform: "uppercase", letterSpacing: 0.8, flexShrink: 0 }}>
          Overview
        </span>

        {/* Chips — hidden on mobile when collapsed to keep header slim */}
        {!open && (
          <span
            className="mob-hide"
            style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0, overflow: "hidden" }}
          >
            {chips.map((chip, i) => (
              <span key={i} style={{
                fontSize: 11.5, color: c.muted, display: "flex", alignItems: "center", gap: 3,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>
                {i > 0 && <span style={{ color: c.hint, margin: "0 2px" }}>·</span>}
                <span style={{ color: c.hint }}>{chip.icon}</span>
                {chip.label}
              </span>
            ))}
          </span>
        )}

        {/* Complaint preview on mobile (collapsed) */}
        {!open && (
          <span
            className="mob-show"
            style={{
              flex: 1, fontSize: 11.5, color: c.muted,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}
          >
            {complaint.length > 60 ? complaint.slice(0, 60) + "…" : complaint}
          </span>
        )}

        {/* Chevron */}
        <span style={{
          flexShrink: 0,
          marginLeft: "auto",
          fontSize: 13,
          color: c.hint,
          transform: open ? "rotate(180deg)" : "rotate(0deg)",
          transition: "transform 0.18s",
          lineHeight: 1,
        }}>
          ▾
        </span>
      </button>

      {/* Expanded content */}
      {open && (
        <div style={{ borderTop: `1px solid ${c.line}` }}>
          {/* Case description — full width */}
          <div style={{ padding: "14px 16px 0" }}>
            <FieldLabel>Case description</FieldLabel>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: c.ink }}>{complaint}</p>
            {notes && (
              <p style={{ margin: "6px 0 0", fontSize: 12, color: c.muted, lineHeight: 1.6 }}>
                <strong style={{ color: c.ink }}>Note: </strong>{notes}
              </p>
            )}
          </div>

          {/* Detail grid */}
          <div style={{
            padding: "14px 16px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 16,
          }}>
            {/* Account */}
            <div>
              <FieldLabel>Account</FieldLabel>
              <Link
                href={ROUTES.account(accountId)}
                style={{ fontSize: 13, fontWeight: 600, color: c.accent, display: "block", marginBottom: 4 }}
              >
                {accountName}
              </Link>
              {accountCity  && <FieldRow label="City"  value={accountCity} />}
              {accountPhone && <FieldRow label="Phone" value={accountPhone} />}
              {accountEmail && <FieldRow label="Email" value={accountEmail} />}
            </div>

            {/* Contact */}
            <div>
              <FieldLabel>Contact</FieldLabel>
              {contactName ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>{contactName}</div>
                  {contactRole  && <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>{contactRole}</div>}
                  {contactPhone && <FieldRow label="Phone" value={contactPhone} />}
                </>
              ) : (
                <div style={{ fontSize: 12, color: c.hint }}>—</div>
              )}
            </div>

            {/* Owner */}
            <div>
              <FieldLabel>Owner</FieldLabel>
              <div style={{
                fontSize: 13,
                color: technicianName ? c.ink : c.hint,
                fontWeight: technicianName ? 600 : 400,
              }}>
                {technicianName ?? "Not yet assigned"}
              </div>
            </div>

            {/* Equipment */}
            <div>
              <FieldLabel>Equipment</FieldLabel>
              <div style={{ fontSize: 13, fontWeight: 600, color: c.ink, lineHeight: 1.5 }}>{equipmentLabel}</div>
            </div>

            {/* Timeline */}
            <div>
              <FieldLabel>Timeline</FieldLabel>
              <FieldRow label="Intake"  value={fmtDateTime(intakeAt)} />
              {closedAt && <FieldRow label="Closed" value={fmtDateTime(closedAt)} />}
            </div>

            {/* Loaner */}
            {loanerName && (
              <div>
                <FieldLabel>Loaner dispatched</FieldLabel>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#ba7517" }}>{loanerName}</div>
                <div style={{ fontSize: 11.5, color: "#ba7517", marginTop: 2 }}>Return on delivery</div>
              </div>
            )}

            {/* AMC contract */}
            {contractRef && (
              <div>
                <FieldLabel>AMC contract</FieldLabel>
                <div style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 600, color: c.accent }}>{contractRef}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10.5, fontWeight: 700, color: c.accent,
      textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 5,
    }}>
      {children}
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, marginTop: 4 }}>
      <span style={{ color: c.muted, flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: "right", wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}
