"use client";

import Link from "next/link";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import type { ComposeNewsletter } from "@/lib/newsletter/composeData";
import { COMPOSE_TIPS } from "@/lib/marketing/composeTips";

/**
 * "My newsletters" on a campaign: the design kept as a version, the languages this campaign sends
 * (only languages whose every line has been accepted can be ticked), the language to fall back to
 * and the topic consent is checked against. The words themselves are edited in the studio.
 */
export default function NewsletterSourceCard({
  newsletter, languages, onLanguages, fallback, onFallback, topic, onTopic, readOnly,
}: {
  newsletter: ComposeNewsletter;
  languages: string[]; onLanguages: (l: string[]) => void;
  fallback: string; onFallback: (l: string) => void;
  topic: string | null; onTopic: (t: string | null) => void;
  readOnly?: boolean;
}) {
  const toggle = (lang: string, on: boolean) => onLanguages(on ? [...new Set([...languages, lang])] : languages.filter((l) => l !== lang));
  const select: React.CSSProperties = { width: "100%", padding: "9px 11px", fontSize: 13, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel, color: c.ink, boxSizing: "border-box" };
  return (
    <Card
      title={`Newsletter: ${newsletter.name}`}
      info={COMPOSE_TIPS.newsletter}
      action={<span style={{ display: "inline-flex", gap: 10, alignItems: "baseline" }}><span style={{ fontSize: 11, color: c.hint }}>version {newsletter.version}</span><Link href={ROUTES.marketingNewsletter(newsletter.newsletterId)} style={{ color: c.accent, fontWeight: 600, fontSize: 12.5 }}>Open the design</Link></span>}
    >
      <Field label="Languages to send" info={COMPOSE_TIPS.languages}>
        <div style={{ display: "grid", gap: 6 }}>
          {newsletter.languages.map((l) => (
            <label key={l.lang} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: l.ready ? c.ink : c.hint, cursor: l.ready && !readOnly ? "pointer" : "default" }}>
              <input type="checkbox" disabled={!l.ready || readOnly} checked={l.ready && languages.includes(l.lang)} onChange={(e) => toggle(l.lang, e.target.checked)} style={{ marginTop: 3 }} />
              <span>{l.name}{!l.ready ? ` — ${l.pending} line${l.pending === 1 ? "" : "s"} still to check` : ""}</span>
            </label>
          ))}
        </div>
      </Field>
      <Field label="If a person's language is not ticked" info={COMPOSE_TIPS.fallback}>
        <select aria-label="Fallback language" style={select} value={fallback} disabled={readOnly} onChange={(e) => onFallback(e.target.value)}>
          {newsletter.languages.filter((l) => languages.includes(l.lang)).map((l) => <option key={l.lang} value={l.lang}>{l.name}</option>)}
        </select>
      </Field>
      <Field label="Consent topic" info={COMPOSE_TIPS.consentTopic} style={{ marginBottom: 0 }}>
        <select aria-label="Consent topic" style={select} value={topic ?? ""} disabled={readOnly} onChange={(e) => onTopic(e.target.value || null)}>
          <option value="">Any consent topic</option>
          {newsletter.topics.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </Field>
    </Card>
  );
}
