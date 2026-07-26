"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import RichTextEditor from "@/components/RichTextEditor";
import TargetAudiencePicker, { type AccountLite } from "@/components/marketing/TargetAudiencePicker";
import TemplatePicker from "@/components/marketing/TemplatePicker";
import type { MarketingTemplateId } from "@/lib/marketingTemplates";
import type { MarketingCampaign, MarketingCampaignRecipient, AccountType } from "@/lib/types";
import type { SegmentFilter } from "@/lib/marketingSegmentation";

const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", border: `1px solid ${c.line}`, borderRadius: 8,
  padding: "8px 12px", fontSize: 13, color: c.ink, background: c.panel, outline: "none",
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 600, color: c.muted,
  textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6,
};

const RECIPIENT_STATUS_LABEL: Record<string, string> = {
  sent: "Sent", failed: "Failed", skipped_opt_out: "Skipped (opted out)", skipped_no_email: "Skipped (no email)", pending: "Pending",
};
const RECIPIENT_STATUS_TONE: Record<string, "green" | "red" | "amber" | "blue"> = {
  sent: "green", failed: "red", skipped_opt_out: "amber", skipped_no_email: "amber", pending: "blue",
};

export default function MarketingCampaignDetail({
  campaign, recipients, accounts,
}: {
  campaign: MarketingCampaign;
  recipients: (MarketingCampaignRecipient & { account_name: string | null })[];
  accounts: AccountLite[];
}) {
  const router = useRouter();
  const [name, setName] = useState(campaign.name);
  const [templateId, setTemplateId] = useState<MarketingTemplateId | null>(campaign.template_id as MarketingTemplateId | null);
  const [subject, setSubject] = useState(campaign.subject);
  const [customMessage, setCustomMessage] = useState(campaign.custom_message ?? "");
  const [body, setBody] = useState(campaign.body);
  const [types, setTypes] = useState<Set<AccountType>>(new Set(campaign.account_types));
  const [includeIds, setIncludeIds] = useState<Set<string>>(new Set(campaign.include_account_ids));
  const [excludeIds, setExcludeIds] = useState<Set<string>>(new Set(campaign.exclude_account_ids));
  const [manualEmails, setManualEmails] = useState<Set<string>>(new Set(campaign.manual_emails));
  const [filters, setFilters] = useState<SegmentFilter[]>(campaign.filters ?? []);
  const [match, setMatch] = useState<"all" | "any">(campaign.match ?? "all");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const isDraft = campaign.status === "draft";

  async function saveChanges() {
    setError("");
    setSaving(true);
    try {
      const res = await fetch(`/api/marketing/campaigns/${campaign.id}`, {
        method: "PATCH",
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
      if (!res.ok) { const j = await res.json(); throw new Error(j.error || "Failed to save"); }
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function sendNow() {
    if (!window.confirm("Send this campaign now? This can't be undone.")) return;
    setError("");
    setSending(true);
    try {
      await saveChanges();
      const res = await fetch(`/api/marketing/campaigns/${campaign.id}/send`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Send failed");
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  if (!isDraft) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 760 }}>
        <section style={cardStyle}>
          <div style={{ display: "flex", gap: 16, marginBottom: 14 }}>
            <Stat label="Sent" value={campaign.sent_count} color="#1d9e75" />
            <Stat label="Failed" value={campaign.failed_count} color="#a32d2d" />
            <Stat label="Skipped" value={campaign.skipped_count} color={c.hint} />
          </div>
          <div style={{ fontSize: 11, color: c.hint }}>
            {campaign.status === "sending" ? "Sending…" : campaign.sent_at ? `Sent ${new Date(campaign.sent_at).toLocaleString("en-IN")}` : ""}
          </div>
        </section>

        <section style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", borderBottom: `1px solid ${c.line}`, fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5 }}>Recipients</div>
          {recipients.length === 0 ? (
            <div style={{ padding: "24px", textAlign: "center", color: c.hint, fontSize: 13 }}>No recipients matched this campaign's targeting.</div>
          ) : (
            <div>
              {recipients.map((r) => (
                <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 14px", borderBottom: `1px solid ${c.line}` }}>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>{r.account_name ?? (r.manual_email ? "External contact" : "—")}</div>
                    <div style={{ fontSize: 11, color: c.hint }}>{r.email ?? r.manual_email ?? "—"}{r.error ? ` · ${r.error}` : ""}</div>
                  </div>
                  <Pill label={RECIPIENT_STATUS_LABEL[r.status] ?? r.status} tone={RECIPIENT_STATUS_TONE[r.status] ?? "blue"} />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 760 }}>
      <section style={cardStyle}>
        <label style={lbl}>Campaign name (internal)</label>
        <input style={inp} value={name} onChange={(e) => setName(e.target.value)} />
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
            <input style={inp} value={subject} onChange={(e) => setSubject(e.target.value)} />
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
      />

      {error && <div style={{ fontSize: 12.5, color: "#dc2626" }}>{error}</div>}

      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={saveChanges} disabled={saving || sending} style={{ padding: "10px 20px", borderRadius: 8, border: `1px solid ${c.line}`, background: "#fff", color: c.muted, fontWeight: 600, fontSize: 13.5, cursor: saving ? "not-allowed" : "pointer" }}>
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button onClick={sendNow} disabled={saving || sending} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: c.accent, color: "#fff", fontWeight: 600, fontSize: 13.5, cursor: sending ? "not-allowed" : "pointer" }}>
          {sending ? "Sending…" : "Send now"}
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
