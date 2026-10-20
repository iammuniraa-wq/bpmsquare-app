"use client";

import { useState } from "react";
import styles from "./publicForm.module.css";

type Topic = { key: string; label: string; hint: string; on: boolean };

// The person's own view of their choices. Switches change nothing until Save; "Unsubscribe from
// all" acts at once (one tap, no confirmation screen). Every word is drawn as text.

export default function PreferencesForm({ contactId, token, initial, blocked }: {
  contactId: string; token: string; initial: Topic[]; blocked: null | "do_not_contact" | "opted_out";
}) {
  const [topics, setTopics] = useState<Topic[]>(initial);
  const [saved, setSaved] = useState<Topic[]>(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBlocked, setIsBlocked] = useState(blocked);

  const dirty = topics.some((t, i) => t.on !== saved[i]?.on);

  async function send(changes: { topic: string | null; on: boolean }[], done: string) {
    setBusy(true); setError(null); setNote(null);
    try {
      const res = await fetch(`/api/marketing/preferences/${encodeURIComponent(contactId)}/${encodeURIComponent(token)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changes }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; topics?: Topic[]; blocked?: typeof blocked };
      if (!res.ok || !j.ok) { setError(j.error ?? "We could not save that. Please try again."); return; }
      if (j.topics) { setTopics(j.topics); setSaved(j.topics); }
      setIsBlocked(j.blocked ?? null);
      setNote(done);
    } catch {
      setError("We could not save that. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const save = () => send(topics.map((t, i) => ({ t, was: saved[i]?.on })).filter((x) => x.t.on !== x.was).map((x) => ({ topic: x.t.key, on: x.t.on })), "Your choices are saved.");

  return (
    <>
      {isBlocked ? (
        <div className={styles.err} role="status">
          {isBlocked === "do_not_contact" ? "We have been asked not to contact you. To change that, please get in touch with us directly." : "You asked us to stop all marketing emails. To start again, please get in touch with us directly."}
        </div>
      ) : null}
      <div className={styles.topics} role="group" aria-label="Topics">
        {topics.map((t) => (
          <div className={styles.topic} key={t.key}>
            <b id={`t-${t.key}`}>{t.label}</b>
            {t.hint ? <small>{t.hint}</small> : null}
            <label className={styles.switch}>
              <input type="checkbox" role="switch" aria-labelledby={`t-${t.key}`} checked={t.on} disabled={busy || isBlocked !== null && !t.on} onChange={(e) => setTopics((all) => all.map((x) => (x.key === t.key ? { ...x, on: e.target.checked } : x)))} />
              <span />
            </label>
          </div>
        ))}
      </div>
      {error ? <div className={styles.err} role="alert">{error}</div> : null}
      {note ? <div className={styles.ok} role="status">{note}</div> : null}
      <div className={styles.actions}>
        <button type="button" className={styles.btn} disabled={busy || !dirty} onClick={() => void save()}>{busy ? "Saving…" : "Save my choices"}</button>
        <button type="button" className={`${styles.btn} ${styles.ghost}`} disabled={busy} onClick={() => void send([{ topic: null, on: false }], "You are unsubscribed from all marketing emails.")}>Unsubscribe from all</button>
      </div>
    </>
  );
}
