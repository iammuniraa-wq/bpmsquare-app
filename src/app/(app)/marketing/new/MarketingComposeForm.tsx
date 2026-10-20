"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import type { AccountType } from "@/lib/types";
import type { SegmentFilter } from "@/lib/marketingSegmentation";
import type { MarketingTemplateId } from "@/lib/marketingTemplates";
import ObjectFormPage from "@/components/page/ObjectFormPage";
import Card from "@/components/ui/Card";
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
import type { ComposeNewsletter } from "@/lib/newsletter/composeData";

export default function MarketingComposeForm({ accounts, initialGroupId, newsletter }: { accounts: AccountLite[]; initialGroupId?: string; newsletter?: ComposeNewsletter | null }) {
  const router = useRouter();
  const readyLanguages = newsletter?.languages.filter((l) => l.ready).map((l) => l.lang) ?? [];
  const [nlLanguages, setNlLanguages] = useState<string[]>(readyLanguages);
  const [nlFallback, setNlFallback] = useState(readyLanguages.includes("en") ? "en" : readyLanguages[0] ?? "en");
  const [nlTopic, setNlTopic] = useState<string | null>(newsletter?.topic ?? null);
  const [name, setName] = useState(newsletter?.name ?? "");
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
          ...(newsletter
            ? { newsletter_version_id: newsletter.versionId, languages: nlLanguages, fallback_language: nlFallback, topic: nlTopic }
            : templateId ? { template_id: templateId, custom_message: customMessage } : { html: body }),
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
    <ObjectFormPage
      backHref={ROUTES.marketing}
      backLabel="All campaigns"
      title="New Campaign"
      subtitle="Send a rich-text email to a filtered set of accounts"
      onSubmit={(e) => { e.preventDefault(); void saveDraft(); }}
      saving={saving}
      saveLabel="Save draft"
      error={error}
      maxWidth={760}
    >
      <Card>
        <Field label="Campaign name (internal)" style={{ marginBottom: 0 }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali greeting 2026" />
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
          <Field label="Subject" hint={"Use {{account_name}} and {{company_name}} — replaced per recipient."}>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Happy Diwali from {{company_name}}!" />
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
        autoLoadGroupId={initialGroupId}
      />
    </ObjectFormPage>
  );
}
