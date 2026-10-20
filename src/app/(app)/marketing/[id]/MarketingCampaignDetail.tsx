"use client";

import { useState } from "react";
import { useFeel } from "@/components/FeelProvider";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
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
import NewsletterSourceCard from "@/components/marketing/NewsletterSourceCard";
import { AudiencePanel, SeeAsPerson } from "@/components/marketing/NewsletterAudience";
import type { ComposeNewsletter } from "@/lib/newsletter/composeData";
import type { MarketingTemplateId } from "@/lib/marketingTemplates";
import type { MarketingCampaign, AccountType } from "@/lib/types";
import type { SegmentFilter } from "@/lib/marketingSegmentation";

/** The editor for a DRAFT campaign (a sent campaign's recipients render on the page itself). */
export default function MarketingCampaignDetail({
  campaign, accounts, newsletter,
}: {
  campaign: MarketingCampaign;
  accounts: AccountLite[];
  newsletter?: ComposeNewsletter | null;
}) {
  const router = useRouter();
  const [nlLanguages, setNlLanguages] = useState<string[]>(campaign.languages ?? []);
  const [nlFallback, setNlFallback] = useState(campaign.fallback_language ?? "en");
  const [nlTopic, setNlTopic] = useState<string | null>(campaign.topic ?? null);
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

  async function saveChanges() {
    setError("");
    setSaving(true);
    try {
      const res = await fetch(`/api/marketing/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          ...(newsletter
            ? { languages: nlLanguages, fallback_language: nlFallback, topic: nlTopic }
            : { subject, ...(templateId ? { template_id: templateId, custom_message: customMessage } : { html: body }) }),
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

  const { confirm } = useFeel();
  async function sendNow() {
    if (!(await confirm({ title: "Send this campaign now?", body: "Emails go out immediately to everyone in the audience. This cannot be recalled.", confirmLabel: "Send now" }))) return;
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

  return (
    <div className="bpm-form-page" style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 760 }}>
      <Card>
        <Field label="Campaign name (internal)" style={{ marginBottom: 0 }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </Card>

      {newsletter ? (
        <NewsletterSourceCard
          newsletter={newsletter} languages={nlLanguages} onLanguages={setNlLanguages} fallback={nlFallback} onFallback={setNlFallback}
          topic={nlTopic} onTopic={setNlTopic}
        />
      ) : (
        <TemplatePicker
          selectedId={templateId}
          onSelect={setTemplateId}
          subject={subject}
          onSubjectChange={setSubject}
          customMessage={customMessage}
          onCustomMessageChange={setCustomMessage}
        />
      )}

      {!templateId && !newsletter && (
        <Card>
          <Field label="Subject">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 }}>Message</div>
          <RichTextEditor value={body} onChange={setBody} placeholder="Write your message…" minHeight={160} />
        </Card>
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

      {newsletter && (
        <>
          <AudiencePanel
            newsletter={newsletter} languages={nlLanguages} fallback={nlFallback} topic={nlTopic}
            audienceRule={() => ({ account_types: [...types], include_account_ids: [...includeIds], exclude_account_ids: [...excludeIds], manual_emails: [...manualEmails], filters, match })}
          />
          <SeeAsPerson newsletter={newsletter} languages={nlLanguages} fallback={nlFallback} topic={nlTopic} />
        </>
      )}

      {error && <div role="alert" style={{ fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}

      <div className="bpm-form-footer" style={{ marginTop: 0 }}>
        <Button variant="secondary" onClick={saveChanges} loading={saving} disabled={sending}>{saving ? "Saving…" : "Save changes"}</Button>
        <Button variant="primary" onClick={sendNow} loading={sending} disabled={saving}>{sending ? "Sending…" : "Send now"}</Button>
      </div>
    </div>
  );
}
