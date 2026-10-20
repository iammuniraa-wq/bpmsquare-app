"use client";

import { useState } from "react";
import { HONEYPOT_FIELD, LIMITS, type FormFieldKey, type PublicForm } from "@/lib/marketing/forms/types";
import styles from "./publicForm.module.css";

// The form as a visitor sees it: the hosted page, the iframe on the client's website and the
// builder's preview all render this one component. Every string arrives as data and is drawn as
// text (React escapes it); nothing here is ever inserted as HTML.

const TYPE: Partial<Record<FormFieldKey, string>> = { email: "email", phone: "tel" };
const MAX: Partial<Record<FormFieldKey, number>> = {
  name: LIMITS.value.name, company: LIMITS.value.company, email: LIMITS.value.email, phone: LIMITS.value.phone, message: LIMITS.value.message,
};
const AUTOCOMPLETE: Partial<Record<FormFieldKey, string>> = { name: "name", company: "organization", email: "email", phone: "tel" };

type Props = {
  form: PublicForm;
  brand: { name: string; logoUrl: string | null };
  /** Inside an iframe on another site: no page chrome. */
  embed?: boolean;
  /** The builder's preview: looks real, sends nothing. */
  preview?: boolean;
};

export default function PublicFormView({ form, brand, embed = false, preview = false }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [trap, setTrap] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (preview || state === "sending") return;
    setState("sending"); setError(null);
    try {
      const res = await fetch(`/api/f/${encodeURIComponent(form.key)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, consent, rt: form.renderToken, [HONEYPOT_FIELD]: trap }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; after?: { kind: string; message?: string; url?: string } };
      if (!res.ok || !j.ok) { setState("idle"); setError(j.error ?? "We could not send that. Please try again."); return; }
      if (j.after?.kind === "redirect" && j.after.url) { window.location.assign(j.after.url); return; }
      setMessage(j.after?.message ?? "Thank you.");
      setState("done");
    } catch {
      setState("idle"); setError("We could not send that. Please check your connection and try again.");
    }
  }

  const root = [styles.page, embed ? styles.embed : "", preview ? styles.preview : ""].filter(Boolean).join(" ");

  return (
    <div className={root}>
      <div className={styles.card}>
        {!embed && (brand.logoUrl || brand.name) && (
          <div className={styles.brand}>
            {brand.logoUrl ? <img src={brand.logoUrl} alt={brand.name} /> : null}
            {!brand.logoUrl ? <span>{brand.name}</span> : null}
          </div>
        )}
        <h1 className={styles.title}>{form.title}</h1>
        {form.intro ? <p className={styles.intro}>{form.intro}</p> : null}

        {state === "done" ? (
          <div className={styles.ok} role="status">{message}</div>
        ) : (
          <form onSubmit={submit} noValidate={false} className={styles.fields} aria-label={form.title}>
            {form.fields.map((f) => {
              const id = `pf-${f.key}`;
              return (
                <div className={styles.field} key={f.key}>
                  <label className={styles.label} htmlFor={id}>{f.label}{f.required ? <span className={styles.req} aria-hidden="true">*</span> : null}</label>
                  {f.key === "message" ? (
                    <textarea id={id} className={styles.textarea} name={f.key} required={f.required} maxLength={MAX.message} value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
                  ) : (
                    <input id={id} className={styles.input} name={f.key} type={TYPE[f.key] ?? "text"} required={f.required} maxLength={MAX[f.key] ?? LIMITS.value.custom} autoComplete={AUTOCOMPLETE[f.key]} value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
                  )}
                </div>
              );
            })}

            <div className={styles.trap} aria-hidden="true">
              <label htmlFor="pf-trap">Leave this empty</label>
              <input id="pf-trap" name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
            </div>

            <div className={styles.consent}>
              <label className={styles.check}>
                <input type="checkbox" checked={consent} required={form.consent.required} onChange={(e) => setConsent(e.target.checked)} />
                <span>{form.consent.text}{form.consent.required ? <span className={styles.req} aria-hidden="true">*</span> : null}</span>
              </label>
            </div>

            {error ? <div className={styles.err} role="alert">{error}</div> : null}
            <button className={styles.btn} type="submit" disabled={state === "sending"}>{state === "sending" ? "Sending…" : form.button}</button>
            {preview ? <p className={styles.note}>Preview: nothing is sent from here.</p> : null}
          </form>
        )}
      </div>
    </div>
  );
}
