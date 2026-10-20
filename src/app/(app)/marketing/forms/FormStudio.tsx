"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import Button from "@/components/ui/Button";
import PublicFormView from "@/components/marketing/PublicFormView";
import { useFeel } from "@/components/FeelProvider";
import { ROUTES } from "@/lib/constants";
import { FIELD_LABEL_DEFAULT, LIMITS, type AfterSubmit, type FormConsent, type FormField, type FormStatus, type PublicForm } from "@/lib/marketing/forms/types";
import FormTour, { type TourStep } from "./FormTour";
import styles from "../newsletters/newsletter.module.css";

// The form builder, in the studio layout every studio-type screen uses (options left, the thing
// being built on the right, every group collapsible with a one-line hint, "Show me how", the panel
// above the canvas on a phone). It shares the Newsletter Studio's stylesheet so the two look alike.

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
};

type Sec = "basicsSec" | "fieldsSec" | "consentSec" | "afterSec" | "shareSec";
const SECTIONS: { id: Sec; tab: string }[] = [
  { id: "basicsSec", tab: "Basics" }, { id: "fieldsSec", tab: "Fields" }, { id: "consentSec", tab: "Consent" },
  { id: "afterSec", tab: "After sending" }, { id: "shareSec", tab: "Share" },
];

const cx = (...p: (string | false | null | undefined)[]): string => p.filter(Boolean).join(" ");
const STATUS_LABEL: Record<FormStatus, string> = { draft: "Draft", live: "Live", archived: "Archived" };
const slugOf = (s: string) => s.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, LIMITS.slug);
const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const Chevron = () => (
  <svg className={styles.chev} viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

function Group({ id, title, summary, hint, open, on, onToggle, children }: {
  id: string; title: string; summary: string; hint: string; open: boolean; on: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <section className={cx(styles.sec, open && styles.open, on && styles.on)} id={id}>
      <button type="button" className={styles.sech} aria-expanded={open} aria-controls={`${id}Body`} onClick={onToggle}>
        <b>{title}</b><span className={styles.sum}>{summary}</span><span className={styles.hint}>{hint}</span><Chevron />
      </button>
      <div className={styles.in} id={`${id}Body`} hidden={!open}>{children}</div>
    </section>
  );
}

const snapshot = (d: unknown) => JSON.stringify(d);

export default function FormStudio({ initial, topics, origin, redirectHost, brand, submissions, canEdit, canDelete }: FormStudioProps) {
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
  const [open, setOpen] = useState<Sec | null>("basicsSec");
  const [tab, setTab] = useState<Sec>("basicsSec");
  const [saving, setSaving] = useState(false);
  const [toastText, setToastText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
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

  const openSection = useCallback((s: Sec) => { setOpen(s); setTab(s); }, []);
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
    setMenu(false);
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
    setMenu(false);
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
    { target: "consentSec", text: "Write the words people agree to and pick the topics they are agreeing to hear about. The box is never ticked for them, and these exact words are saved with every answer.", before: () => openSection("consentSec") },
    { target: "afterSec", text: "Choose what happens after sending: a thank-you message, or a page on your own domain.", before: () => openSection("afterSec") },
    { target: "shareSec", text: "When the form is Live, share the hosted address or paste the embed code into your website.", before: () => openSection("shareSec") },
    { target: "frCanvas", text: "This is the form exactly as a visitor sees it. It updates as you change the options.", before: () => undefined },
  ];

  return (
    <div className={styles.accent}>
      <PageHeader
        title={name || (initial.id ? "Form" : "New form")}
        subtitle={[initial.ref, `${enabledCount} fields`, initial.id ? `${submissions.length}${submissions.length === 25 ? "+" : ""} recent answers` : "not saved yet"].filter(Boolean).join(" · ")}
        badge={<span className={cx(styles.pill, status === "live" && !dirty && styles.ready, status === "archived" && styles.archived)}>{statusPill}</span>}
        action={
          <span className={styles.headRow}>
            <FormTour steps={tour} />
            <Button variant="primary" disabled={!canEdit || saving || !dirty} loading={saving} onClick={() => void save()}>Save</Button>
            {id && (
              <span className={styles.menu}>
                <Button aria-haspopup="true" aria-expanded={menu} aria-label="More" onClick={() => setMenu((m) => !m)}>⋯</Button>
                {menu && (
                  <ul role="menu">
                    <li><button type="button" role="menuitem" disabled={!canEdit} onClick={() => void archive()}>Archive</button></li>
                    <li><button type="button" role="menuitem" disabled={!canDelete} onClick={() => void remove()}>Delete</button></li>
                  </ul>
                )}
              </span>
            )}
          </span>
        }
      />

      {!canEdit && <div className={cx(styles.banner, styles.info)}>You can look at this form but not change it.</div>}
      {error && <div className={styles.err} role="alert">{error}</div>}

      <div className={styles.studio}>
        <div className={styles.panel}>
          <div className={styles.ptabs} role="tablist" aria-label="Options">
            {SECTIONS.map((s) => <button key={s.id} type="button" role="tab" aria-selected={tab === s.id} className={cx(styles.ptab, tab === s.id && styles.on)} onClick={() => openSection(s.id)}>{s.tab}</button>)}
          </div>

          <Group id="basicsSec" title="Basics" summary={name || "Unnamed"} hint="Names and words. The name is only for your team; the heading is what visitors read." open={open === "basicsSec"} on={tab === "basicsSec"} onToggle={() => toggleSection("basicsSec")}>
            <div>
              <label className={styles.lbl} htmlFor="frName">Name (only your team sees it)</label>
              <input id="frName" className={styles.nameInput} value={name} maxLength={LIMITS.name} disabled={!canEdit} placeholder="e.g. Website contact form" onChange={(e) => { setName(e.target.value); if (!slugTouched) setSlug(slugOf(e.target.value)); }} />
            </div>
            <div>
              <label className={styles.lbl} htmlFor="frSlug">Web address</label>
              <input id="frSlug" className={styles.field} value={slug} maxLength={LIMITS.slug} disabled={!canEdit} placeholder="contact-us" onChange={(e) => { setSlugTouched(true); setSlug(slugOf(e.target.value)); }} />
              <p className={styles.hint}>{origin ? `${origin.replace("https://", "")}/f/${slug || "…"}. ` : ""}Changing it breaks links already shared.</p>
            </div>
            <div>
              <label className={styles.lbl} htmlFor="frTitle">Heading</label>
              <input id="frTitle" className={styles.field} value={title} maxLength={LIMITS.title} disabled={!canEdit} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <label className={styles.lbl} htmlFor="frIntro">Introduction</label>
              <textarea id="frIntro" className={styles.field} value={intro} maxLength={LIMITS.intro} disabled={!canEdit} onChange={(e) => setIntro(e.target.value)} />
              <p className={styles.hint}>One or two sentences under the heading. Plain text only.</p>
            </div>
            <div>
              <label className={styles.lbl} htmlFor="frBtn">Button words</label>
              <input id="frBtn" className={styles.field} value={button} maxLength={LIMITS.button} disabled={!canEdit} onChange={(e) => setButton(e.target.value)} />
            </div>
          </Group>

          <Group id="fieldsSec" title="Fields" summary={`${enabledCount} asked`} hint="What the visitor is asked. Email is always asked; the rest are your choice." open={open === "fieldsSec"} on={tab === "fieldsSec"} onToggle={() => toggleSection("fieldsSec")}>
            {fields.map((f) => {
              const locked = f.key === "email";
              const custom = f.key.startsWith("custom");
              return (
                <div key={f.key} style={{ display: "grid", gap: 4, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
                  <label className={styles.chk}>
                    <input type="checkbox" checked={f.enabled} disabled={!canEdit || locked} onChange={(e) => setField(f.key, { enabled: e.target.checked })} />
                    <span><b>{custom ? `Your own question ${f.key.slice(-1)}` : FIELD_LABEL_DEFAULT[f.key]}</b>{locked ? " (always asked)" : ""}</span>
                  </label>
                  {f.enabled && (
                    <div className={styles.row}>
                      <input aria-label={`Wording of ${FIELD_LABEL_DEFAULT[f.key]}`} className={styles.field} style={{ flex: "1 1 160px", width: "auto" }} value={f.label} maxLength={LIMITS.label} disabled={!canEdit} onChange={(e) => setField(f.key, { label: e.target.value })} />
                      <label className={styles.chk}><input type="checkbox" checked={f.required} disabled={!canEdit || locked} onChange={(e) => setField(f.key, { required: e.target.checked })} /> Required</label>
                    </div>
                  )}
                </div>
              );
            })}
            <p className={styles.hint}>Name, company, phone, message and up to three questions of your own. Answers are plain text.</p>
          </Group>

          <Group id="consentSec" title="Consent" summary={topicNames.length ? `${topicNames.length} topic${topicNames.length > 1 ? "s" : ""}` : "All topics"} hint="The words people agree to, and what they are agreeing to hear about. Never pre-ticked." open={open === "consentSec"} on={tab === "consentSec"} onToggle={() => toggleSection("consentSec")}>
            <div>
              <label className={styles.lbl} htmlFor="frConsent">The words shown next to the box</label>
              <textarea id="frConsent" className={styles.field} value={consent.text} maxLength={LIMITS.consentText} disabled={!canEdit} onChange={(e) => setConsent((c) => ({ ...c, text: e.target.value }))} />
              <p className={styles.hint}>These exact words, the time, this form and a hashed network address are saved with every box that is ticked.</p>
            </div>
            <div>
              <div className={styles.lbl}>Topics this covers</div>
              {topics.map((t) => (
                <label key={t.key} className={styles.chk}>
                  <input type="checkbox" checked={consent.topics.includes(t.key)} disabled={!canEdit} onChange={(e) => setConsent((c) => ({ ...c, topics: e.target.checked ? [...c.topics, t.key] : c.topics.filter((x) => x !== t.key) }))} /> {t.label}
                </label>
              ))}
              <p className={styles.hint}>Pick none to cover every topic. Say in your words above what you will send.</p>
            </div>
            <label className={styles.chk}>
              <input type="checkbox" checked={consent.required} disabled={!canEdit} onChange={(e) => setConsent((c) => ({ ...c, required: e.target.checked }))} /> The box must be ticked to send
            </label>
            <p className={styles.hint}>Leave this off for a contact form: a person can ask a question without agreeing to emails. Someone who does not tick the box is not recorded as agreeing to anything.</p>
          </Group>

          <Group id="afterSec" title="After sending" summary={after.kind === "redirect" ? "Go to a page" : "Thank-you message"} hint="What the visitor sees once the form is sent." open={open === "afterSec"} on={tab === "afterSec"} onToggle={() => toggleSection("afterSec")}>
            <div className={styles.starts}>
              <button type="button" className={cx(styles.start, after.kind === "message" && styles.sel)} disabled={!canEdit} onClick={() => setAfter((a) => ({ ...a, kind: "message" }))}><b>Show a message</b><span>A short thank-you on the form itself.</span></button>
              <button type="button" className={cx(styles.start, after.kind === "redirect" && styles.sel)} disabled={!canEdit} onClick={() => setAfter((a) => ({ ...a, kind: "redirect" }))}><b>Go to a page</b><span>A page on your own domain ({redirectHost || "set a domain first"}).</span></button>
            </div>
            {after.kind === "message" ? (
              <div>
                <label className={styles.lbl} htmlFor="frMsg">Thank-you message</label>
                <textarea id="frMsg" className={styles.field} value={after.message} maxLength={LIMITS.message} disabled={!canEdit} onChange={(e) => setAfter((a) => ({ ...a, message: e.target.value }))} />
              </div>
            ) : (
              <div>
                <label className={styles.lbl} htmlFor="frUrl">Page address</label>
                <input id="frUrl" className={styles.field} value={after.redirect_url} maxLength={LIMITS.redirect} disabled={!canEdit} placeholder={`https://${redirectHost || "your-domain.com"}/thanks`} onChange={(e) => setAfter((a) => ({ ...a, redirect_url: e.target.value }))} />
                <p className={styles.hint}>Must start with https:// and be on {redirectHost || "your own domain"}. Anything after a ? is dropped.</p>
              </div>
            )}
          </Group>

          <Group id="shareSec" title="Share" summary={STATUS_LABEL[status]} hint="Switch it on, then use the hosted address or put the form on your website." open={open === "shareSec"} on={tab === "shareSec"} onToggle={() => toggleSection("shareSec")}>
            <div>
              <label className={styles.lbl} htmlFor="frStatus">Status</label>
              <select id="frStatus" className={styles.select} value={status} disabled={!canEdit} onChange={(e) => setStatus(e.target.value as FormStatus)}>
                <option value="draft">Draft - only you can see it</option>
                <option value="live">Live - visitors can send it</option>
                <option value="archived">Archived - switched off</option>
              </select>
              <p className={styles.hint}>Only a Live form can be opened or sent by a visitor. Save after changing it.</p>
            </div>
            {id && !origin ? <p className={styles.hint}>This workspace has no domain yet, so the form has no public address. Ask your administrator to set one up.</p> : id ? (
              <>
                <div>
                  <div className={styles.lbl}>Hosted address</div>
                  <p className={styles.help} style={{ overflowWrap: "anywhere" }}>{hosted}</p>
                  <Button size="sm" onClick={() => void copy(hosted, "Address")}>Copy address</Button>
                </div>
                <div>
                  <div className={styles.lbl}>Embed on your website</div>
                  <pre className={styles.pre}>{embed}</pre>
                  <Button size="sm" onClick={() => void copy(embed, "Embed code")}>Copy embed code</Button>
                  <p className={styles.hint}>Paste it where the form should appear. It sits in its own frame, so your site&apos;s styles cannot break it.</p>
                </div>
              </>
            ) : <p className={styles.hint}>Save the form to get its address and embed code.</p>}
          </Group>
        </div>

        <div className={styles.canvas} id="frCanvas">
          <div className={styles.tools}>
            <div className={styles.tabs} aria-label="Device">
              <button type="button" className={cx(styles.tab, dev === "desktop" && styles.on)} onClick={() => setDev("desktop")}>Desktop</button>
              <button type="button" className={cx(styles.tab, dev === "phone" && styles.on)} onClick={() => setDev("phone")}>Phone</button>
            </div>
            <span className={styles.help}>{status === "live" ? "Live: visitors can send this." : "Not live yet: visitors cannot open it."}</span>
          </div>
          <div className={styles.stage}>
            <div className={cx(styles.frameWrap, dev === "phone" && styles.phone)}>
              <PublicFormView form={preview} brand={brand} preview />
            </div>
          </div>
          <p className={styles.hint}>The form as a visitor sees it. Sending is switched off in this preview.</p>
        </div>
      </div>

      <details className={styles.fold} id="frSubs">
        <summary>Answers <small>the latest {submissions.length || "25"}, kept 180 days</small></summary>
        <div className={styles.foldIn}>
          {!id ? <p className={styles.note}>Save the form to start collecting answers.</p>
            : submissions.length === 0 ? <p className={styles.note}>No answers yet. Share the address above, or open it yourself and send a test.</p>
            : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead><tr>{["When", "Name", "Email", "Company", "Agreed to emails", "Person"].map((h) => <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: "var(--muted)", fontWeight: 600, borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {submissions.map((s) => (
                      <tr key={s.id}>
                        <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{new Date(s.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                        <td style={{ padding: "6px 8px" }}>{s.name || "-"}</td>
                        <td style={{ padding: "6px 8px" }}>{s.email || "-"}</td>
                        <td style={{ padding: "6px 8px" }}>{s.company || "-"}</td>
                        <td style={{ padding: "6px 8px" }}>{s.consent_given ? "Yes" : "No"}</td>
                        <td style={{ padding: "6px 8px" }}>{s.outcome === "matched" ? "Already a contact" : "New contact"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </details>
      <details className={styles.fold}>
        <summary>Details <small>reference, status</small></summary>
        <div className={styles.foldIn}>
          <p className={styles.note}>{[initial.ref, STATUS_LABEL[status], initial.createdAt ? `Created ${new Date(initial.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}` : null].filter(Boolean).join(" · ") || "Not saved yet."}</p>
        </div>
      </details>

      <div className={styles.bar}>
        <Button variant="primary" disabled={!canEdit || saving || !dirty} loading={saving} onClick={() => void save()}>Save</Button>
      </div>
      {toastText && <div className={styles.toast} role="status">{toastText}</div>}
    </div>
  );
}
