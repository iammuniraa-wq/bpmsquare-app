"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES } from "@/lib/constants";
import type { AccountType } from "@/lib/types";
import type { SegmentFilter } from "@/lib/marketingSegmentation";
import type { MarketingTemplateId } from "@/lib/marketingTemplates";
import dynamic from "next/dynamic";

// tiptap (the editor's engine) is one of the heaviest client libraries in
// the app -- loading it on demand keeps it out of this page's initial
// bundle, where it was inflating time-to-interactive for every visit that
// never touches the editor.
const RichTextEditor = dynamic(() => import("@/components/RichTextEditor"), {
  ssr: false,
  loading: () => <div style={{ minHeight: 120, borderRadius: 8, background: "var(--panel2, #f3f4f6)" }} />,
});
import TargetAudiencePicker, { type AccountLite } from "@/components/marketing/TargetAudiencePicker";
import TemplatePicker from "@/components/marketing/TemplatePicker";

const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", border: `1px solid ${c.line}`, borderRadius: 8,
  padding: "8px 12px", fontSize: 13, color: c.ink, background: c.panel, outline: "none",
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 600, color: c.muted,
  textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6,
};

export default function MarketingComposeForm({ accounts, initialGroupId }: { accounts: AccountLite[]; initialGroupId?: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState<MarketingTemplateId | null>(null);
  const [subject, setSubject] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [body, setBody] = useState("");
  const [types, setTypes] = useState<Set<AccountType>>(new Set());
  const [includeIds, setIncludeIds] = useState<Set<string>>(new Set());
  const [excludeIds, setExcludeIds] = useState<Set<string>>(new Set());
  const [manualEmails, setManualEmails] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<SegmentFilter[]>([]);
  const [match, setMatch] = useState<"all" | "any">("all");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function saveDraft() {
    if (!name.trim()) { setError("Give this campaign a name."); return; }
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/marketing/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, subject,
          ...(templateId ? { template_id: templateId, custom_message: customMessage } : { html: body }),
          account_types: [...types],
          include_account_ids: [...includeIds],
          exclude_account_ids: [...excludeIds],
          manual_emails: [...manualEmails],
          filters, match,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save");
      router.push(ROUTES.marketingCampaign(json.id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 760 }}>
      <section style={cardStyle}>
        <label style={lbl}>Campaign name (internal)</label>
        <input style={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali greeting 2026" />
      </section>

      <TemplatePicker
        selectedId={templateId}
        onSelect={setTemplateId}
        subject={subject}
        onSubjectChange={setSubject}
        customMessage={customMessage}
        onCustomMessageChange={setCustomMessage}
      />

      {!templateId && (
        <section style={cardStyle}>
          <div style={{ marginBottom: 12 }}>
            <label style={lbl}>Subject</label>
            <input style={inp} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Happy Diwali from {{company_name}}!" />
            <div style={{ fontSize: 11, color: c.hint, marginTop: 4 }}>Use {"{{account_name}}"} and {"{{company_name}}"} — replaced per recipient.</div>
          </div>
          <div>
            <label style={lbl}>Message</label>
            <RichTextEditor value={body} onChange={setBody} placeholder="Write your message…" minHeight={160} />
          </div>
        </section>
      )}

      <TargetAudiencePicker
        accounts={accounts}
        types={types} setTypes={setTypes}
        includeIds={includeIds} setIncludeIds={setIncludeIds}
        excludeIds={excludeIds} setExcludeIds={setExcludeIds}
        manualEmails={manualEmails} setManualEmails={setManualEmails}
        filters={filters} setFilters={setFilters}
        match={match} setMatch={setMatch}
        autoLoadGroupId={initialGroupId}
      />

      {error && <div style={{ fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}

      <div>
        <button onClick={saveDraft} disabled={saving} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: c.accent, color: "#fff", fontWeight: 600, fontSize: 13.5, cursor: saving ? "not-allowed" : "pointer" }}>
          {saving ? "Saving…" : "Save draft"}
        </button>
      </div>
    </div>
  );
}
