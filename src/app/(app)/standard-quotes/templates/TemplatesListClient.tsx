"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES } from "@/lib/constants";

type TemplateRow = { id: string; name: string; is_default: boolean; updated_at: string };

const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default function TemplatesListClient({ templates }: { templates: TemplateRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");

  function createTemplate() {
    const name = newName.trim();
    if (!name) return;
    setError("");
    startTransition(async () => {
      const res = await fetch("/api/standard-quote-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (res.ok) router.push(ROUTES.standardQuoteTemplate(json.id));
      else setError(json.error ?? "Failed to create template");
    });
  }

  function setDefault(id: string) {
    startTransition(async () => {
      const res = await fetch(`/api/standard-quote-templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_default: true }),
      });
      if (res.ok) router.refresh();
      else { const j = await res.json(); setError(j.error ?? "Failed to set default"); }
    });
  }

  function deleteTemplate(id: string, name: string) {
    if (!confirm(`Delete template "${name}"? Any quote currently using it falls back to the default layout.`)) return;
    startTransition(async () => {
      const res = await fetch(`/api/standard-quote-templates/${id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
      else { const j = await res.json(); setError(j.error ?? "Failed to delete template"); }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && (
        <div style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "var(--err-ink)" }}>
          {error}
        </div>
      )}

      <div style={{ ...cardStyle, display: "flex", gap: 10, alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 }}>
            New template name
          </label>
          <input
            style={{ width: "100%", padding: "9px 12px", fontSize: 13, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box" }}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Formal Proposal"
            onKeyDown={(e) => { if (e.key === "Enter") createTemplate(); }}
          />
        </div>
        <button
          type="button" disabled={pending || !newName.trim()} onClick={createTemplate}
          style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: c.accent, color: "#fff", fontWeight: 600, fontSize: 13, cursor: pending ? "wait" : "pointer" }}
        >
          + Create &amp; open builder
        </button>
      </div>

      {templates.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", padding: "40px 24px", color: c.muted }}>
          No templates yet — Standard Quotes use the built-in default layout until you create one.
        </div>
      ) : (
        <div style={{ ...cardStyle, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Name", "Default", "Last updated", ""].map((h) => (
                  <th key={h} style={{ textAlign: "left", color: c.hint, fontWeight: 500, padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 11.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id}>
                  <td style={{ padding: "10px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 13 }}>
                    <Link href={ROUTES.standardQuoteTemplate(t.id)} style={{ color: c.accent, fontWeight: 600, textDecoration: "none" }}>{t.name}</Link>
                  </td>
                  <td style={{ padding: "10px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 12.5 }}>
                    {t.is_default ? (
                      <span style={{ color: "var(--greenink)", fontWeight: 600 }}>Default</span>
                    ) : (
                      <button type="button" disabled={pending} onClick={() => setDefault(t.id)} style={{ background: "none", border: "none", color: c.muted, fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>
                        Set as default
                      </button>
                    )}
                  </td>
                  <td style={{ padding: "10px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 12.5, color: c.muted }}>{fmtDate(t.updated_at)}</td>
                  <td style={{ padding: "10px 12px", borderBottom: `1px solid ${c.line}`, textAlign: "right" }}>
                    <button type="button" disabled={pending} onClick={() => deleteTemplate(t.id, t.name)} style={{ background: "none", border: "none", color: "var(--red)", fontSize: 12, cursor: "pointer" }}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
