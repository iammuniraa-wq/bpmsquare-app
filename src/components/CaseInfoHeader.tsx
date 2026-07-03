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

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

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

  return (
    <div style={{
      background: c.panel,
      border: `1px solid ${c.line}`,
      borderRadius: 10,
      marginBottom: 12,
      overflow: "hidden",
    }}>
      {/* ── Collapsed strip ── */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center",
          gap: 0, padding: "10px 14px",
          background: "none", border: "none", cursor: "pointer",
          textAlign: "left",
        }}
      >
        {/* Key facts as chips */}
        <div style={{ flex: 1, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <Chip icon="▣" label={accountName} href={ROUTES.account(accountId)} accent />
          <Sep />
          <Chip icon="⚙" label={equipmentLabel.length > 40 ? equipmentLabel.slice(0, 40) + "…" : equipmentLabel} />
          <Sep />
          <Chip icon="◑" label={technicianName ?? "Unassigned"} muted={!technicianName} />
          <Sep />
          <Chip icon="📅" label={fmtDate(intakeAt)} muted />
          {loanerName && <><Sep /><Chip icon="⟳" label="Loaner out" warn /></>}
          {contractRef && <><Sep /><Chip icon="▥" label="AMC" /></>}
        </div>
        <span style={{
          fontSize: 14, color: c.hint, marginLeft: 10, flexShrink: 0,
          transform: open ? "rotate(180deg)" : "rotate(0deg)",
          transition: "transform .15s",
          display: "inline-block",
        }}>▾</span>
      </button>

      {/* ── Expanded detail ── */}
      {open && (
        <div style={{ borderTop: `1px solid ${c.line}`, padding: "14px 16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>

            {/* Complaint */}
            <div style={{ gridColumn: "1 / -1" }}>
              <FieldLabel>Complaint</FieldLabel>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: c.ink }}>{complaint}</p>
              {notes && (
                <p style={{ margin: "6px 0 0", fontSize: 12, color: c.muted, lineHeight: 1.6 }}>
                  <strong style={{ color: c.ink }}>Note: </strong>{notes}
                </p>
              )}
            </div>

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
            {contactName && (
              <div>
                <FieldLabel>Contact</FieldLabel>
                <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>{contactName}</div>
                {contactRole  && <div style={{ fontSize: 12, color: c.muted }}>{contactRole}</div>}
                {contactPhone && <FieldRow label="Phone" value={contactPhone} />}
              </div>
            )}

            {/* Equipment */}
            <div>
              <FieldLabel>Equipment</FieldLabel>
              <div style={{ fontSize: 13, fontWeight: 600, color: c.ink, lineHeight: 1.5 }}>{equipmentLabel}</div>
            </div>

            {/* Technician */}
            <div>
              <FieldLabel>Assigned to</FieldLabel>
              <div style={{ fontSize: 13, color: technicianName ? c.ink : c.hint, fontWeight: technicianName ? 600 : 400 }}>
                {technicianName ?? "Not yet assigned"}
              </div>
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

function Chip({ icon, label, href, accent, muted, warn }: {
  icon: string; label: string; href?: string;
  accent?: boolean; muted?: boolean; warn?: boolean;
}) {
  const color = accent ? c.accent : warn ? "#ba7517" : muted ? c.hint : c.ink;
  const content = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, color }}>
      <span style={{ fontSize: 11 }}>{icon}</span>
      <span style={{ fontWeight: accent ? 700 : 500 }}>{label}</span>
    </span>
  );
  if (href) return <Link href={href} style={{ textDecoration: "none" }}>{content}</Link>;
  return content;
}

function Sep() {
  return <span style={{ color: c.line, fontSize: 14, userSelect: "none" }}>·</span>;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10.5, fontWeight: 700, color: c.accent, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 5 }}>
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
