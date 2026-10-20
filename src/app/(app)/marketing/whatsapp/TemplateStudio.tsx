"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import Button from "@/components/ui/Button";
import { useFeel } from "@/components/FeelProvider";
import { Group, StudioTour, cx, studio as styles, type TourStep } from "@/components/marketing/StudioKit";
import { ROUTES } from "@/lib/constants";
import {
  CATEGORIES, CATEGORY_HINT, CATEGORY_LABEL, LANGUAGES, LIMITS, STATUS_LABEL, TEMPLATE_VARIABLES, checkBody, renderTemplate, sampleValues,
  type TemplateCategory, type TemplateStatus,
} from "@/lib/marketing/whatsapp/template";

// The WhatsApp template editor in the studio layout every studio-type screen uses: options on the left (each group
// collapsible, one-line hint always visible), the message as the person will see it on the right, the panel above
// the canvas on a phone, an optional English "Show me how".

export type TemplateInitial = {
  id: string | null;
  ref: string | null;
  name: string;
  language: string;
  category: TemplateCategory;
  body: string;
  topic: string | null;
  provider_template_name: string;
  status: TemplateStatus;
  rejection_reason: string | null;
  sent: number;
};

type Sec = "basicsSec" | "messageSec" | "topicSec" | "approvalSec";

type Person = { id: string; name: string; company: string };

export default function TemplateStudio({ initial, topics, companyName, canEdit, canDelete, isAdmin }: {
  initial: TemplateInitial; topics: { key: string; label: string }[]; companyName: string; canEdit: boolean; canDelete: boolean; isAdmin: boolean;
}) {
  const router = useRouter();
  const { confirm } = useFeel();

  const [id, setId] = useState<string | null>(initial.id);
  const [name, setName] = useState(initial.name);
  const [language, setLanguage] = useState(initial.language);
  const [category, setCategory] = useState<TemplateCategory>(initial.category);
  const [body, setBody] = useState(initial.body);
  const [topic, setTopic] = useState<string | null>(initial.topic);
  const [providerName, setProviderName] = useState(initial.provider_template_name);
  const [status, setStatus] = useState<TemplateStatus>(initial.status);
  const [rejection, setRejection] = useState(initial.rejection_reason ?? "");

  const [open, setOpen] = useState<Sec | null>("basicsSec");
  const [saving, setSaving] = useState(false);
  const [toastText, setToastText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const content = useMemo(() => ({ name: name.trim() || "Untitled template", language, category, body, topic, provider_template_name: providerName }), [name, language, category, body, topic, providerName]);
  const snap = (d: unknown) => JSON.stringify(d);
  const [savedSnap, setSavedSnap] = useState(() => snap(content));
  const dirty = snap(content) !== savedSnap;
  const bodyCheck = checkBody(body);

  const toast = useCallback((m: string) => {
    setToastText(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastText(null), 4200);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const toggle = (s: Sec) => setOpen((o) => (o === s ? null : s));

  function insertVariable(key: string) {
    const el = bodyRef.current;
    const token = `{{${key}}}`;
    if (!el) { setBody((b) => `${b}${token}`); return; }
    const a = el.selectionStart ?? body.length;
    const z = el.selectionEnd ?? body.length;
    setBody(body.slice(0, a) + token + body.slice(z));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + token.length, a + token.length); });
  }

  async function save(): Promise<boolean> {
    if (!canEdit) return false;
    setSaving(true); setError(null);
    try {
      const res = await fetch(id ? `/api/whatsapp/templates/${id}` : "/api/whatsapp/templates", {
        method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(id ? { content } : content),
      });
      const j = (await res.json().catch(() => ({}))) as { id?: string; status?: TemplateStatus; error?: string; pending_migration?: boolean };
      if (!res.ok) { setError(j.pending_migration ? "WhatsApp is waiting for a database update." : j.error ?? "Could not save the template."); return false; }
      setSavedSnap(snap(content));
      if (j.status) setStatus(j.status);
      if (j.status === "draft" && initial.status === "approved") toast("Saved. Changing the words sends an approved template back to draft.");
      else toast("Saved.");
      if (!id && j.id) { setId(j.id); router.replace(ROUTES.marketingWhatsappTemplate(j.id)); }
      return true;
    } catch {
      setError("Could not save the template. Check your connection and try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function setApproval(next: TemplateStatus) {
    if (!id) return;
    if (dirty && !(await save())) return;
    setSaving(true); setError(null);
    const res = await fetch(`/api/whatsapp/templates/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next, rejection_reason: rejection }) });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    setSaving(false);
    if (!res.ok) { setError(j.error ?? "Could not change the status."); return; }
    setStatus(next);
    toast(next === "approved" ? "Marked approved. It can be sent now." : next === "rejected" ? "Marked rejected." : next === "archived" ? "Archived." : "Back to draft.");
  }

  async function remove() {
    setMenu(false);
    if (!id) return;
    if (!(await confirm({ title: "Delete this template?", body: "A template that has been sent is archived instead, so the log of what went out stays complete.", confirmLabel: "Delete", tone: "danger" }))) return;
    const res = await fetch(`/api/whatsapp/templates/${id}`, { method: "DELETE" });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) { setError(j.error ?? "Could not delete the template."); return; }
    router.push(ROUTES.marketingWhatsapp);
  }

  // The canvas
  const preview = renderTemplate(body || "Write the message on the left.", { ...sampleValues(), company_name: companyName });
  const topicLabel = topics.find((t) => t.key === topic)?.label ?? "any subject";
  const pill = dirty ? "Unsaved changes" : STATUS_LABEL[status];

  const tour: TourStep[] = [
    { target: "basicsSec", text: "Name the template for your team and choose its language. Each language is its own template, because WhatsApp approves them separately.", before: () => setOpen("basicsSec") },
    { target: "messageSec", text: "Write the message. Pick a detail from the list to drop a person's name or a quote number in; the preview on the right shows how it will read.", before: () => setOpen("messageSec") },
    { target: "topicSec", text: "Choose the subject. Only people who agreed to hear about it on WhatsApp will receive this message.", before: () => setOpen("topicSec") },
    { target: "approvalSec", text: "WhatsApp only lets you start a conversation with an approved template. Mark it approved once your provider has accepted it; until then it cannot be sent.", before: () => setOpen("approvalSec") },
    { target: "waCanvas", text: "This is the message as the person sees it, with sample details filled in.", before: () => undefined },
  ];

  return (
    <div className={styles.accent}>
      <PageHeader
        title={name || (initial.id ? "Template" : "New template")}
        subtitle={[initial.ref, id ? `${initial.sent} message${initial.sent === 1 ? "" : "s"} sent` : "not saved yet"].filter(Boolean).join(" · ")}
        badge={<span className={cx(styles.pill, status === "approved" && !dirty && styles.live, status === "rejected" && styles.paused)}>{pill}</span>}
        action={
          <span className={styles.headRow}>
            <StudioTour steps={tour} storageKey="bpm.whatsapp.tour.step" />
            <Button variant="primary" disabled={!canEdit || saving || !dirty || !bodyCheck.ok} loading={saving} onClick={() => void save()}>Save</Button>
            {id && (
              <span className={styles.menu}>
                <Button aria-haspopup="true" aria-expanded={menu} aria-label="More" onClick={() => setMenu((m) => !m)}>⋯</Button>
                {menu && (
                  <ul role="menu">
                    <li><button type="button" role="menuitem" disabled={!canEdit || status === "archived"} onClick={() => { setMenu(false); void setApproval("archived"); }}>Archive</button></li>
                    <li><button type="button" role="menuitem" disabled={!canDelete} onClick={() => void remove()}>Delete</button></li>
                  </ul>
                )}
              </span>
            )}
          </span>
        }
      />

      {!canEdit && <div className={cx(styles.banner, styles.info)}>You can look at this template but not change it.</div>}
      {error && <div className={styles.err} role="alert">{error}</div>}

      <div className={styles.studio}>
        <div className={styles.panel}>
          <Group id="basicsSec" title="Basics" summary={name || "Unnamed"} hint="Your team's name for it, the language, and what kind of message it is." open={open === "basicsSec"} onToggle={() => toggle("basicsSec")}>
            <div>
              <label className={styles.lbl} htmlFor="waName">Name (only your team sees it)</label>
              <input id="waName" className={styles.field} value={name} maxLength={LIMITS.name} disabled={!canEdit} placeholder="e.g. Quote ready" onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className={styles.lbl} htmlFor="waLang">Language</label>
              <select id="waLang" className={styles.select} value={language} disabled={!canEdit} onChange={(e) => setLanguage(e.target.value)}>
                {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
              <p className={styles.hint}>Write English first. For another language, make a second template with the same name.</p>
            </div>
            <div>
              <label className={styles.lbl} htmlFor="waCat">Kind of message</label>
              <select id="waCat" className={styles.select} value={category} disabled={!canEdit} onChange={(e) => setCategory(e.target.value as TemplateCategory)}>
                {CATEGORIES.map((k) => <option key={k} value={k}>{CATEGORY_LABEL[k]}</option>)}
              </select>
              <p className={styles.hint}>{CATEGORY_HINT[category]}</p>
            </div>
          </Group>

          <Group id="messageSec" title="The message" summary={`${body.length} characters`} hint="What the person reads. Details in double braces are filled in for each person." open={open === "messageSec"} onToggle={() => toggle("messageSec")}>
            <div>
              <label className={styles.lbl} htmlFor="waBody">Message</label>
              <textarea id="waBody" ref={bodyRef} className={styles.field} rows={6} value={body} maxLength={LIMITS.body} disabled={!canEdit} onChange={(e) => setBody(e.target.value)} />
              {!bodyCheck.ok && body.trim() !== "" && <p className={styles.help} role="status" style={{ color: "var(--amberink)" }}>{bodyCheck.error}</p>}
            </div>
            <div>
              <span className={styles.lbl}>Add a detail</span>
              <div className={styles.chips}>
                {TEMPLATE_VARIABLES.map((v) => (
                  <button key={v.key} type="button" className={styles.stepBtn} disabled={!canEdit} onClick={() => insertVariable(v.key)}>{v.label}</button>
                ))}
              </div>
              <p className={styles.hint}>A message cannot start or end with a detail, so add a few words before and after.</p>
            </div>
          </Group>

          <Group id="topicSec" title="Who may receive it" summary={topicLabel} hint="The subject this message is about. Only people who agreed to it on WhatsApp are sent it." open={open === "topicSec"} onToggle={() => toggle("topicSec")}>
            <div>
              <label className={styles.lbl} htmlFor="waTopic">Subject</label>
              <select id="waTopic" className={styles.select} value={topic ?? ""} disabled={!canEdit} onChange={(e) => setTopic(e.target.value || null)}>
                <option value="">Any subject</option>
                {topics.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <p className={styles.hint}>Consent is checked again at the moment of sending. A person who replies STOP is never sent another.</p>
            </div>
          </Group>

          <Group id="approvalSec" title="Approval" summary={STATUS_LABEL[status]} hint="WhatsApp must approve a template before you can start a conversation with it." open={open === "approvalSec"} onToggle={() => toggle("approvalSec")}>
            <div>
              <label className={styles.lbl} htmlFor="waProv">Name at your provider (optional)</label>
              <input id="waProv" className={styles.field} value={providerName} maxLength={80} disabled={!canEdit} placeholder="quote_ready" onChange={(e) => setProviderName(e.target.value)} />
              <p className={styles.hint}>The name you registered the template under, if it differs. Letters, numbers and underscores.</p>
            </div>
            {id ? (
              <div className={styles.row}>
                <Button variant="primary" disabled={!canEdit || !isAdmin || saving || status === "approved" || !bodyCheck.ok} onClick={() => void setApproval("approved")}>Mark approved</Button>
                <Button disabled={!canEdit || saving || status === "rejected"} onClick={() => void setApproval("rejected")}>Mark rejected</Button>
                <Button variant="quiet" disabled={!canEdit || saving || status === "draft"} onClick={() => void setApproval("draft")}>Back to draft</Button>
              </div>
            ) : <p className={styles.hint}>Save the template first, then mark it approved.</p>}
            {id && status === "rejected" && (
              <div>
                <label className={styles.lbl} htmlFor="waRej">Why it was rejected</label>
                <input id="waRej" className={styles.field} value={rejection} maxLength={LIMITS.reason} disabled={!canEdit} onChange={(e) => setRejection(e.target.value)} />
              </div>
            )}
            {!isAdmin && <p className={styles.hint}>Only an admin can mark a template approved.</p>}
            <p className={styles.hint}>In this version there is no live connection to WhatsApp, so you set the status yourself after your provider has approved the template.</p>
          </Group>
        </div>

        <div className={styles.canvas} id="waCanvas">
          <div className={styles.card}>
            <h2>How it looks <small>sample details, as the person sees it</small></h2>
            <div style={{ background: "var(--panel2)", borderRadius: 12, padding: 18, display: "grid" }}>
              <div style={{ maxWidth: 340, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "12px 12px 12px 3px", padding: "10px 12px", fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }} dir="auto">
                {preview.text}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>{companyName}</div>
            </div>
            <p className={styles.help}>{category === "marketing" ? "Marketing messages count toward the weekly limit per person (one by default)." : "This kind of message does not count toward the weekly limit."}</p>
          </div>

          {id && <TestSend templateId={id} approved={status === "approved" && !dirty} canEdit={canEdit} />}
        </div>
      </div>
      {toastText && <div className={styles.toast} role="status">{toastText}</div>}
    </div>
  );
}

function TestSend({ templateId, approved, canEdit }: { templateId: string; approved: boolean; canEdit: boolean }) {
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [picked, setPicked] = useState<Person | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "stop"; text: string } | null>(null);

  useEffect(() => {
    if (picked || q.trim().length < 2) { setPeople([]); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/whatsapp/lookup?q=${encodeURIComponent(q.trim())}`);
      const j = (await res.json().catch(() => ({}))) as { items?: Person[] };
      setPeople(j.items ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [q, picked]);

  async function send() {
    if (!picked) return;
    setBusy(true); setResult(null);
    const res = await fetch(`/api/whatsapp/templates/${templateId}/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contact_id: picked.id }) });
    const j = (await res.json().catch(() => ({}))) as { status?: string; message?: string; error?: string };
    setBusy(false);
    setResult({ tone: res.ok && (j.status === "sent" || j.status === "dry_run") ? "ok" : "stop", text: j.message ?? j.error ?? "Could not send." });
  }

  return (
    <div className={styles.card}>
      <h2>Send it to one person <small>goes through the same checks as a journey</small></h2>
      {!approved ? (
        <p className={styles.help}>Save the template and mark it approved to send a test.</p>
      ) : (
        <>
          <div>
            <label className={styles.lbl} htmlFor="waWho">Who</label>
            <input id="waWho" className={styles.field} value={picked ? `${picked.name}${picked.company ? ` · ${picked.company}` : ""}` : q} disabled={!canEdit || busy} placeholder="Start typing a name…"
              onChange={(e) => { setPicked(null); setQ(e.target.value); setResult(null); }} />
            {people.length > 0 && !picked && (
              <ul className={styles.list} role="listbox" aria-label="People">
                {people.map((p) => (
                  <li key={p.id}><button type="button" role="option" aria-selected="false" className={styles.stepBtn} onClick={() => setPicked(p)}>{p.name}</button><span>{p.company}</span></li>
                ))}
              </ul>
            )}
          </div>
          <div className={styles.row}>
            <Button variant="primary" disabled={!picked || busy || !canEdit} loading={busy} onClick={() => void send()}>Send</Button>
          </div>
          {result && <div className={cx(styles.check, result.tone === "stop" && styles.stop)} role="status">{result.text}</div>}
          <p className={styles.help}>Nobody is sent anything unless they agreed to WhatsApp for this subject. A workspace in demo mode only logs the message.</p>
        </>
      )}
    </div>
  );
}
