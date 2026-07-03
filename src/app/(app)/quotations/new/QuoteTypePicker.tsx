"use client";

import { useRouter } from "next/navigation";
import { c, pillar } from "@/lib/theme";
import { QUOTE_TYPES, ROUTES } from "@/lib/constants";

export default function QuoteTypePicker() {
  const router = useRouter();

  return (
    <div style={{ maxWidth: 680, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, color: c.muted, marginBottom: 12 }}>
          <span
            onClick={() => router.push(ROUTES.quotations)}
            style={{ cursor: "pointer", textDecoration: "none" }}
          >
            ← Quotations
          </span>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: c.ink, margin: "0 0 6px" }}>
          New Quotation
        </h1>
        <p style={{ margin: 0, fontSize: 13, color: c.muted }}>
          Choose the type of quotation to create
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }} className="fg2">
        {QUOTE_TYPES.map((qt) => {
          const available = qt.available;
          return (
            <button
              key={qt.id}
              type="button"
              disabled={!available}
              onClick={() => router.push(`${ROUTES.quotationNew}?type=${qt.id}`)}
              style={{
                textAlign: "left",
                background: available ? c.panel : c.panel2,
                border: `1.5px solid ${available ? c.line : c.line}`,
                borderRadius: 12,
                padding: "20px 22px",
                cursor: available ? "pointer" : "not-allowed",
                opacity: available ? 1 : 0.55,
                transition: "border-color 0.15s, box-shadow 0.15s",
                position: "relative",
              }}
              onMouseEnter={(e) => {
                if (!available) return;
                (e.currentTarget as HTMLButtonElement).style.borderColor = c.accent;
                (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 0 0 3px ${c.accentbg}`;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = c.line;
                (e.currentTarget as HTMLButtonElement).style.boxShadow = "none";
              }}
            >
              <div style={{ fontSize: 26, marginBottom: 10 }}>{qt.icon}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: c.ink, marginBottom: 5 }}>
                {qt.label}
              </div>
              <div style={{ fontSize: 12.5, color: c.muted, lineHeight: 1.5 }}>
                {qt.description}
              </div>
              {!available && (
                <div style={{
                  position: "absolute", top: 12, right: 12,
                  fontSize: 10, fontWeight: 700, color: c.hint,
                  background: c.panel2, border: `1px solid ${c.line}`,
                  borderRadius: 4, padding: "2px 7px", letterSpacing: 0.3,
                  textTransform: "uppercase",
                }}>
                  Coming soon
                </div>
              )}
              {available && (
                <div style={{
                  marginTop: 14, fontSize: 12, fontWeight: 600,
                  color: c.accent, display: "flex", alignItems: "center", gap: 4,
                }}>
                  Select →
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
