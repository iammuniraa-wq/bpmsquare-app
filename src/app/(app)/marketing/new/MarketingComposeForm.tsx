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
import { COMPOSE_TIPS } from "@/lib/marketing/composeTips";
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

export default function MarketingComposeForm({ accounts, initialGroupId }: { accounts: AccountLite[]; initialGroupId?: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState<MarketingTemplateId | null>(null);
  const [subject, setSubject] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [body, setBody] = useState("");
  const [types, setTypes] = useState<Set<AccountType>>(new Set(initialGroupId ? [] : ["direct", "end_customer", "oem", "prospect"]));
  const [includeIds, setIncludeIds] = useState<Set<string>>(new Set());
  const [excludeIds, setExcludeIds] = useState<Set<string>>(new Set());
  const [manualEmails, setManualEmails] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<SegmentFilter[]>([]);
  const [match, setMatch] = useState<"all" | "any">("all");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Once saved, a second press updates the same draft instead of creating a copy.
  const [savedId, setSavedId] = useState<string | null>(null);

  async function saveDraft() {
    if (!name.trim()) { setError("Give this campaign a name."); return; }
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const res = await fetch(savedId ? `/api/marketing/campaigns/${savedId}` : "/api/marketing/campaigns", {
        method: savedId ? "PATCH" : "POST",
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
      const id: string = savedId ?? json.id;
      setSavedId(id);
      // The draft IS saved at this point; say so before the page changes, and keep the link in case it does not.
      setNotice("Draft saved. Opening it…");
      router.push(ROUTES.marketingCampaign(id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
      setSaving(false);
    }
  }

  return (
    <ObjectFormPage
      backHref={ROUTES.marketingEmail}
      backLabel="All email"
      title="New Campaign"
      subtitle="Email · choose the audience and the text"
      onSubmit={(e) => { e.preventDefault(); void saveDraft(); }}
      saving={saving}
      saveLabel="Save draft"
      error={error}
      footerLeft={notice ? (
        <span role="status" style={{ fontSize: 12.5, color: "var(--ok-ink, #04342c)" }}>
          {notice}{savedId ? <> <a href={ROUTES.marketingCampaign(savedId)} style={{ color: c.accent, fontWeight: 600 }}>Open the draft</a></> : null}
        </span>
      ) : undefined}
      maxWidth={760}
    >
      <Card>
        <Field label="Campaign name (internal)" style={{ marginBottom: 0 }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali greeting 2026" />
        </Field>
      </Card>

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

      <TemplatePicker
        selectedId={templateId}
        onSelect={setTemplateId}
        subject={subject}
        onSubjectChange={setSubject}
        customMessage={customMessage}
        onCustomMessageChange={setCustomMessage}
      />

      {!templateId && (
        <Card>
          <Field label="Subject" info={COMPOSE_TIPS.subject}>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Happy Diwali from {{company_name}}!" />
          </Field>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 }}>Message</div>
          <RichTextEditor value={body} onChange={setBody} placeholder="Write your message…" minHeight={160} />
        </Card>
      )}

    </ObjectFormPage>
  );
}
