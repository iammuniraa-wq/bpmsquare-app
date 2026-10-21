"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import MoreMenu, { type MenuItem } from "@/components/ui/MoreMenu";
import OptionGroup from "@/components/ui/OptionGroup";
import { CheckOpt, Opt } from "@/components/ui/Opt";
import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import PublicFormView from "@/components/marketing/PublicFormView";
import { useFeel } from "@/components/FeelProvider";
import { ROUTES } from "@/lib/constants";
import { FIELD_LABEL_DEFAULT, LIMITS, type AfterSubmit, type FormConsent, type FormField, type FormStatus, type PublicForm } from "@/lib/marketing/forms/types";
import { FORM_TIPS } from "@/lib/marketing/forms/tips";
import Tour, { type TourStep } from "@/components/marketing/Tour";
import styles from "../newsletters/newsletter.module.css";
import answerStyles from "./form.module.css";

// The form builder, in the studio layout every studio-type screen uses (options left, the thing being built on
// the right, the panel above the canvas on a phone, "Show me how"). Page tabs are Design and Answers. Labels,
// values and actions only: every explanation sits behind an "i" (docs/design/ux-simplification.md).

export type SubmissionRow = { id: string; created_at: string; name: string; email: string; company: string; message: string; consent_given: boolean; outcome: string };

export type FormInitial = {
  id: string | null;
  ref: string | null;
  name: string;
  slug: string;
  status: FormStatus;
  title: string;
  intro: string;
  button_label: string;
  fields: FormField[];
  consent: FormConsent;
  after_submit: AfterSubmit;
  createdAt: string | null;
};

export type FormStudioProps = {
  initial: FormInitial;
  topics: { key: string; label: string }[];
  /** https://<tenant domain> - the base of the hosted address. */
  origin: string;
  /** The host a redirect may go to. */
  redirectHost: string;
  brand: { name: string; logoUrl: string | null };
  submissions: SubmissionRow[];
  canEdit: boolean;
  canDelete: boolean;
  /** Members of this workspace the answer can be sent to. */
  people?: { id: string; label: string }[];
  /** What "Ask the person to confirm by email" is when the form leaves it alone (on for a workspace in the EU). */
  confirmDefault?: boolean;
};

type Sec = "basicsSec" | "fieldsSec" | "consentSec" | "afterSec" | "shareSec";
const SECTIONS: { id: Sec; tab: string }[] = [
  { id: "basicsSec", tab: "Basics" }, { id: "fieldsSec", tab: "Fields" }, { id: "consentSec", tab: "Consent" },
  { id: "afterSec", tab: "After sending" }, { id: "shareSec", tab: "Share" },
];
const SECTION_IDS = SECTIONS.map((s) => s.id);
const PAGE_TABS = ["design", "answers"] as const;
const ANSWERS_PER_PAGE = 10;

const cx = (...p: (string | false | null | undefined)[]): string => p.filter(Boolean).join(" ");
const STATUS_LABEL: Record<FormStatus, string> = { draft: "Draft", live: "Live", archived: "Archived" };
const slugOf = (s: string) => s.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, LIMITS.slug);
const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const snapshot = (d: unknown) => JSON.stringify(d);

export default function FormStudio({ initial, topics, origin, redirectHost, brand, submissions, canEdit, canDelete, people = [], confirmDefault = false }: FormStudioProps) {
  const router = useRouter();
  const { confirm } = useFeel();

  const [id, setId] = useState<string | null>(initial.id);
  const [name, setName] = useState(initial.name);
  const [slug, setSlug] = useState(initial.slug);
  const [slugTouched, setSlugTouched] = useState(!!initial.id);
  const [status, setStatus] = useState<FormStatus>(initial.status);
  const [title, setTitle] = useState(initial.title);
  const [intro, setIntro] = useState(initial.intro);
  const [button, setButton] = useState(initial.button_label);
  const [fields, setFields] = useState<FormField[]>(initial.fields);
  const [consent, setConsent] = useState<FormConsent>(initial.consent);
  const [after, setAfter] = useState<AfterSubmit>(initial.after_submit);

  const [dev, setDev] = useState<"desktop" | "phone">("desktop");
  // The page tab lives in ?tab=; `panelTab` is the group the phone's strip has selected and lives in ?panel=;
  // `open` is the group expanded on a wide screen.
  const [pageTab, setPageTab] = useUrlTab(PAGE_TABS);
  const [panelTab, setPanelTab] = useUrlTab(SECTION_IDS, "panel");
  const tab = panelTab as Sec;
  const [open, setOpen] = useState<Sec | null>(tab);
  const [answersPage, setAnswersPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [toastText, setToastText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const body = useMemo(() => ({
    name: name.trim() || "Untitled form", slug: slug || slugOf(name), status, title, intro, button_label: button, fields, consent, after_submit: after,
  }), [name, slug, status, title, intro, button, fields, consent, after]);
  const [savedSnap, setSavedSnap] = useState(() => snapshot(body));
  const dirty = snapshot(body) !== savedSnap;

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

  const openSection = useCallback((s: Sec) => { setPageTab("design"); setOpen(s); setPanelTab(s); }, [setPageTab, setPanelTab]);
  const toggleSection = (s: Sec) => { if (open === s) setOpen(null); else openSection(s); };

  const setField = (key: FormField["key"], patch: Partial<FormField>) => setFields((all) => all.map((f) => (f.key === key ? { ...f, ...patch } : f)));

  async function save(): Promise<void> {
    if (!canEdit) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch(id ? `/api/marketing-forms/${id}` : "/api/marketing-forms", {
        method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as { id?: string; slug?: string; error?: string; warnings?: string[]; pending_migration?: boolean };
      if (!res.ok) { setError(j.pending_migration ? "Forms are waiting for a database update." : j.error ?? "Could not save the form."); return; }
      const saved = { ...body, slug: j.slug ?? body.slug };
      if (j.slug) setSlug(j.slug);
      setSavedSnap(snapshot(saved));
      toast(j.warnings?.length ? `Saved. ${j.warnings[0]}` : "Saved.");
      if (!id && j.id) { setId(j.id); router.replace(ROUTES.marketingForm(j.id)); }
    } catch {
      setError("Could not save the form. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!id) return;
    if (!(await confirm({ title: "Archive this form?", body: "The hosted page and any copy on your website stop working. The answers already collected are kept.", confirmLabel: "Archive" }))) return;
    setStatus("archived");
    setSaving(true);
    const res = await fetch(`/api/marketing-forms/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, status: "archived" }) });
    setSaving(false);
    if (!res.ok) { setError("Could not archive the form."); return; }
    router.push(ROUTES.marketingForms);
  }

  async function remove() {
    if (!id) return;
    if (!(await confirm({ title: "Delete this form?", body: "It is removed for good. A form that has answers cannot be deleted; archive it instead.", confirmLabel: "Delete", tone: "danger" }))) return;
    const res = await fetch(`/api/marketing-forms/${id}`, { method: "DELETE" });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) { setError(j.error ?? "Could not delete the form."); return; }
    router.push(ROUTES.marketingForms);
  }

  async function copy(text: string, what: string) {
    try { await navigator.clipboard.writeText(text); toast(`${what} copied.`); } catch { toast("Select the text and copy it."); }
  }

  const hosted = origin ? `${origin}/f/${slug || "your-form"}` : "";
  const embed = !hosted ? "" : `<iframe src="${attr(`${hosted}?embed=1`)}" title="${attr(title || "Contact form")}" width="100%" height="640" style="border:0;max-width:640px;" loading="lazy"></iframe>`;

  // The canvas is drawn by the very component the public page uses.
  const preview: PublicForm = {
    key: "preview", title: title || name || "Your form", intro, button: button || "Send",
    fields: fields.filter((f) => f.enabled).map((f) => ({ key: f.key, label: f.label, required: f.required })),
    consent: { text: consent.text, required: consent.required }, renderToken: "",
  };

  const enabledCount = fields.filter((f) => f.enabled).length;
  const statusPill = dirty ? "Unsaved changes" : STATUS_LABEL[status];
  const topicNames = consent.topics.map((k) => topics.find((t) => t.key === k)?.label ?? k);

  const tour: TourStep[] = [
    { target: "basicsSec", text: "Start with the name only your team sees, the web address and the heading your visitors read.", before: () => openSection("basicsSec") },
    { target: "fieldsSec", text: "Choose what to ask. Email is always asked, because that is how we find a person again and attach their consent to them.", before: () => openSection("fieldsSec") },
    { target: "consentSec", text: "Write the words people agree to and pick the consent topics they are agreeing to hear about. The box is never ticked for them, and these exact words are saved with every answer.", before: () => openSection("consentSec") },
    { target: "afterSec", text: "Choose what happens after sending: a thank-you message, or a page on your own domain.", before: () => openSection("afterSec") },
    { target: "shareSec", text: "When the form is Live, share the hosted address or paste the embed code into your website.", before: () => openSection("shareSec") },
    { target: "frCanvas", text: "This is the form exactly as a visitor sees it. It updates as you change the options.", before: () => setPageTab("design") },
    { target: "frTabs", text: "Answers lists the latest people who sent the form.", before: () => setPageTab("design") },
  ];

  const menuItems: MenuItem[] = [
    { label: "Archive", hidden: !id || !canEdit, onSelect: () => void archive() },
    { label: "Delete", danger: true, hidden: !id || !canDelete, onSelect: () => void remove() },
  ];

  const pages = Math.max(1, Math.ceil(submissions.length / ANSWERS_PER_PAGE));
  const answersAt = Math.min(answersPage, pages - 1);
  const shown = submissions.slice(answersAt * ANSWERS_PER_PAGE, (answersAt + 1) * ANSWERS_PER_PAGE);
  const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className={styles.accent}>
      <PageHeader
        title={name || (initial.id ? "Form" : "New form")}
        subtitle={[initial.ref, `${enabledCount} fields`, initial.id ? `${submissions.length}${submissions.length === 25 ? "+" : ""} recent answers` : "not saved yet"].filter(Boolean).join(" · ")}
        badge={<span className={cx(styles.pill, status === "live" && !dirty && styles.ready, status === "archived" && styles.archived)}>{statusPill}</span>}
        action={
          <span className={styles.headRow}>
            <Tour steps={tour} storageKey="bpm.forms.tour.step" buttonId="frTourBtn" />
            <span className={styles.headBtns}>
              <Button variant="primary" disabled={!canEdit || saving || !dirty} loading={saving} onClick={() => void save()}>Save</Button>
            </span>
            <MoreMenu items={menuItems} />
          </span>
        }
      />

      {!canEdit && <div className={cx(styles.banner, styles.info)}>You can look at this form but not change it.</div>}
      {error && <div className={styles.err} role="alert">{error}</div>}

      <div id="frTabs">
        <Tabs
          tabs={[{ id: "design", label: "Design" }, { id: "answers", label: "Answers", count: submissions.length }]}
          value={pageTab} onChange={setPageTab} label="Form"
        />
      </div>

      {pageTab === "design" && (
      <div className={styles.studio}>
        <div className={cx(styles.panel, "bpm-og-panel")}>
          <div className={styles.ptabsWrap}>
            <Tabs tabs={SECTIONS.map((s) => ({ id: s.id, label: s.tab }))} value={tab} onChange={(t) => openSection(t as Sec)} label="Options" />
          </div>

          <OptionGroup id="basicsSec" title="Basics" info={FORM_TIPS.basics} summary={name || "Unnamed"} open={open === "basicsSec"} on={tab === "basicsSec"} onToggle={() => toggleSection("basicsSec")}>
            <Opt label="Name" info={FORM_TIPS.name} htmlFor="frName">
              <input id="frName" className={styles.nameInput} value={name} maxLength={LIMITS.name} disabled={!canEdit} placeholder="e.g. Website contact form" onChange={(e) => { setName(e.target.value); if (!slugTouched) setSlug(slugOf(e.target.value)); }} />
            </Opt>
            <Opt label="Web address" hint="Changing it breaks shared links" htmlFor="frSlug">
              <input id="frSlug" className={styles.field} value={slug} maxLength={LIMITS.slug} disabled={!canEdit} placeholder="contact-us" onChange={(e) => { setSlugTouched(true); setSlug(slugOf(e.target.value)); }} />
            </Opt>
            <Opt label="Heading" htmlFor="frTitle">
              <input id="frTitle" className={styles.field} value={title} maxLength={LIMITS.title} disabled={!canEdit} onChange={(e) => setTitle(e.target.value)} />
            </Opt>
            <Opt label="Introduction" info={FORM_TIPS.intro} hint="Plain text only" htmlFor="frIntro">
              <textarea id="frIntro" className={styles.field} value={intro} maxLength={LIMITS.intro} disabled={!canEdit} onChange={(e) => setIntro(e.target.value)} />
            </Opt>
            <Opt label="Button words" htmlFor="frBtn">
              <input id="frBtn" className={styles.field} value={button} maxLength={LIMITS.button} disabled={!canEdit} onChange={(e) => setButton(e.target.value)} />
            </Opt>
          </OptionGroup>

          <OptionGroup id="fieldsSec" title="Fields" info={FORM_TIPS.fields} summary={`${enabledCount} asked`} open={open === "fieldsSec"} on={tab === "fieldsSec"} onToggle={() => toggleSection("fieldsSec")}>
            {fields.map((f) => {
              const locked = f.key === "email";
              const custom = f.key.startsWith("custom");
              const label = `${custom ? `Your own question ${f.key.slice(-1)}` : FIELD_LABEL_DEFAULT[f.key]}${locked ? " (always asked)" : ""}`;
              return (
                <div key={f.key} style={{ display: "grid", gap: 4, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
                  <CheckOpt label={label} checked={f.enabled} disabled={!canEdit || locked} onChange={(v) => setField(f.key, { enabled: v })} />
                  {f.enabled && (
                    <div className={styles.row}>
                      <input aria-label={`Wording of ${FIELD_LABEL_DEFAULT[f.key]}`} className={styles.field} style={{ flex: "1 1 160px", width: "auto" }} value={f.label} maxLength={LIMITS.label} disabled={!canEdit} onChange={(e) => setField(f.key, { label: e.target.value })} />
                      <label className={styles.chk}><input type="checkbox" checked={f.required} disabled={!canEdit || locked} onChange={(e) => setField(f.key, { required: e.target.checked })} /> Required</label>
                    </div>
                  )}
                </div>
              );
            })}
          </OptionGroup>

          <OptionGroup id="consentSec" title="Consent" info={FORM_TIPS.consent} summary={topicNames.length ? `${topicNames.length} consent topic${topicNames.length > 1 ? "s" : ""}` : "Any consent topic"} open={open === "consentSec"} on={tab === "consentSec"} onToggle={() => toggleSection("consentSec")}>
            <Opt label="The words shown next to the box" info={FORM_TIPS.consentWords} htmlFor="frConsent">
              <textarea id="frConsent" className={styles.field} value={consent.text} maxLength={LIMITS.consentText} disabled={!canEdit} onChange={(e) => setConsent((c) => ({ ...c, text: e.target.value }))} />
            </Opt>
            <Opt label="Consent topics" info={FORM_TIPS.consentTopics}>
              {topics.map((t) => (
                <label key={t.key} className={styles.chk}>
                  <input type="checkbox" checked={consent.topics.includes(t.key)} disabled={!canEdit} onChange={(e) => setConsent((c) => ({ ...c, topics: e.target.checked ? [...c.topics, t.key] : c.topics.filter((x) => x !== t.key) }))} /> {t.label}
                </label>
              ))}
            </Opt>
            <CheckOpt label="The box must be ticked to send" info={FORM_TIPS.consentRequired} checked={consent.required} disabled={!canEdit} onChange={(v) => setConsent((c) => ({ ...c, required: v }))} />
          </OptionGroup>

          <OptionGroup id="afterSec" title="After sending" info={FORM_TIPS.after} summary={[after.kind === "redirect" ? "Go to a page" : "Thank-you message", after.thank_you_email ? "email" : null].filter(Boolean).join(" + ")} open={open === "afterSec"} on={tab === "afterSec"} onToggle={() => toggleSection("afterSec")}>
            <div className={styles.starts}>
              <button type="button" className={cx(styles.start, after.kind === "message" && styles.sel)} disabled={!canEdit} onClick={() => setAfter((a) => ({ ...a, kind: "message" }))}><b>Show a message</b><span>A thank-you on the form</span></button>
              <button type="button" className={cx(styles.start, after.kind === "redirect" && styles.sel)} disabled={!canEdit} onClick={() => setAfter((a) => ({ ...a, kind: "redirect" }))}><b>Go to a page</b><span>{redirectHost || "No domain yet"}</span></button>
            </div>
            {after.kind === "message" ? (
              <Opt label="Thank-you message" htmlFor="frMsg">
                <textarea id="frMsg" className={styles.field} value={after.message} maxLength={LIMITS.message} disabled={!canEdit} onChange={(e) => setAfter((a) => ({ ...a, message: e.target.value }))} />
              </Opt>
            ) : (
              <>
                {!redirectHost && <div className={cx(styles.banner)}>This workspace has no domain yet, so a page cannot be chosen.</div>}
                <Opt label="Page address" info={FORM_TIPS.redirect} hint={`Must be on ${redirectHost || "your own domain"}`} htmlFor="frUrl">
                  <input id="frUrl" className={styles.field} value={after.redirect_url} maxLength={LIMITS.redirect} disabled={!canEdit} placeholder={`https://${redirectHost || "your-domain.com"}/thanks`} onChange={(e) => setAfter((a) => ({ ...a, redirect_url: e.target.value }))} />
                </Opt>
              </>
            )}
            <CheckOpt label="Send a thank-you email" info={FORM_TIPS.thankYou} checked={after.thank_you_email} disabled={!canEdit} onChange={(v) => setAfter((a) => ({ ...a, thank_you_email: v }))} />
            {after.thank_you_email && (
              <Opt label="Words in the email" info={FORM_TIPS.thankYouWords} htmlFor="frThanks">
                <textarea id="frThanks" className={styles.field} value={after.thank_you_text} maxLength={LIMITS.thankYou} disabled={!canEdit} onChange={(e) => setAfter((a) => ({ ...a, thank_you_text: e.target.value }))} />
              </Opt>
            )}
            <CheckOpt label="Ask the person to confirm by email" info={after.thank_you_email ? FORM_TIPS.confirm : FORM_TIPS.confirmNeeds} checked={after.confirm_by_email ?? confirmDefault} disabled={!canEdit} onChange={(v) => setAfter((a) => ({ ...a, confirm_by_email: v }))} />
            <CheckOpt label="Tell someone about each new answer" info={FORM_TIPS.notify} checked={after.notify_owner} disabled={!canEdit || people.length === 0} onChange={(v) => setAfter((a) => ({ ...a, notify_owner: v, notify_user_id: v ? (a.notify_user_id ?? people[0]?.id ?? null) : a.notify_user_id }))} />
            {after.notify_owner && (
              <Opt label="Who" info={FORM_TIPS.notifyWho} htmlFor="frNotify">
                <select id="frNotify" className={styles.select} value={after.notify_user_id ?? ""} disabled={!canEdit} onChange={(e) => setAfter((a) => ({ ...a, notify_user_id: e.target.value || null }))}>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </Opt>
            )}
          </OptionGroup>

          <OptionGroup id="shareSec" title="Share" info={FORM_TIPS.share} summary={STATUS_LABEL[status]} open={open === "shareSec"} on={tab === "shareSec"} onToggle={() => toggleSection("shareSec")}>
            <Opt label="Status" info={FORM_TIPS.status} htmlFor="frStatus">
              <select id="frStatus" className={styles.select} value={status} disabled={!canEdit} onChange={(e) => setStatus(e.target.value as FormStatus)}>
                <option value="draft">Draft — only you can see it</option>
                <option value="live">Live — visitors can send it</option>
                <option value="archived">Archived — switched off</option>
              </select>
            </Opt>
            {id && !origin ? <div className={styles.banner}>This workspace has no domain yet, so the form has no public address. Ask your administrator to set one up.</div> : id ? (
              <>
                <Opt label="Hosted address">
                  <p className={styles.help} style={{ overflowWrap: "anywhere", margin: 0 }}>{hosted}</p>
                  <div><Button size="sm" onClick={() => void copy(hosted, "Address")}>Copy address</Button></div>
                </Opt>
                <Opt label="Embed on your website" info={FORM_TIPS.embed}>
                  <pre className={styles.pre}>{embed}</pre>
                  <div><Button size="sm" onClick={() => void copy(embed, "Embed code")}>Copy embed code</Button></div>
                </Opt>
              </>
            ) : (
              <div className={answerStyles.empty}><b>No address yet</b><span>Save the form to get its address and embed code.</span></div>
            )}
          </OptionGroup>
        </div>

        <div className={styles.canvas} id="frCanvas">
          <div className={styles.tools}>
            <div className={styles.tabs} aria-label="Device">
              <button type="button" className={cx(styles.tab, dev === "desktop" && styles.on)} onClick={() => setDev("desktop")}>Desktop</button>
              <button type="button" className={cx(styles.tab, dev === "phone" && styles.on)} onClick={() => setDev("phone")}>Phone</button>
            </div>
            {status !== "live" && <span className={styles.help}>Not live yet: visitors cannot open it.</span>}
          </div>
          <div className={styles.stage}>
            <div className={cx(styles.frameWrap, dev === "phone" && styles.phone)}>
              <PublicFormView form={preview} brand={brand} preview />
            </div>
          </div>
        </div>
      </div>
      )}

      {pageTab === "answers" && (
        <div className={answerStyles.answers} id="frSubs">
          <div className={answerStyles.answersHead}>
            <span className="bpm-label-row"><h2>Answers</h2><InfoTip label="Answers">{FORM_TIPS.answers}</InfoTip></span>
          </div>
          {!id ? (
            <div className={answerStyles.emptyBig}><b>No answers yet</b><span>Save the form to start collecting answers.</span></div>
          ) : submissions.length === 0 ? (
            <div className={answerStyles.emptyBig}><b>No answers yet</b><span>Share the address from the Design tab, or open it yourself and send a test.</span></div>
          ) : (
            <>
              <div className={answerStyles.hd} aria-hidden="true">
                <span>When</span><span>Name</span><span>Email</span><span>Company</span><span>Agreed to emails</span><span>Person</span>
              </div>
              {shown.map((s) => (
                <div key={s.id} className={answerStyles.row}>
                  <span className={answerStyles.when}>{when(s.created_at)}</span>
                  <span>{s.name || "-"}</span>
                  <span>{s.email || "-"}</span>
                  <span><span className={answerStyles.lab}>Company</span>{s.company || "-"}</span>
                  <span><span className={answerStyles.lab}>Agreed to emails</span>{s.consent_given ? "Yes" : "No"}</span>
                  <span>{s.outcome === "matched" ? "Already a contact" : "New contact"}</span>
                </div>
              ))}
              {pages > 1 && (
                <div className={answerStyles.pager}>
                  <span>{answersAt * ANSWERS_PER_PAGE + 1}–{answersAt * ANSWERS_PER_PAGE + shown.length} of {submissions.length}</span>
                  <span>
                    <Button size="sm" disabled={answersAt === 0} onClick={() => setAnswersPage(answersAt - 1)}>Previous</Button>
                    <Button size="sm" disabled={answersAt >= pages - 1} onClick={() => setAnswersPage(answersAt + 1)}>Next</Button>
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className={styles.bar}>
        <Button variant="primary" disabled={!canEdit || saving || !dirty} loading={saving} onClick={() => void save()}>Save</Button>
      </div>
      {toastText && <div className={styles.toast} role="status">{toastText}</div>}
    </div>
  );
}
