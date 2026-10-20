"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import Button from "@/components/ui/Button";
import { ROUTES } from "@/lib/constants";
import { createJourney } from "../journeyApi";
import styles from "../journey.module.css";

export default function NewJourney({ templates, canCreate }: { templates: { id: string; name: string; hint: string }[]; canCreate: boolean }) {
  const router = useRouter();
  const [tpl, setTpl] = useState("quote_follow_up");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true); setError(null);
    const r = await createJourney(name, tpl);
    setBusy(false);
    if (!r.ok) { setError(r.pending ? "Journeys are waiting for a database update." : r.error); return; }
    router.push(ROUTES.marketingJourney(r.data.id));
  }

  return (
    <div className={styles.accent}>
      <PageHeader title="New journey" subtitle="Start from a ready-made journey or from nothing. Nothing is sent until you turn it on." />
      {error && <div className={styles.err} role="alert">{error}</div>}
      <div className={styles.card}>
        <h2>Start from</h2>
        <div className={styles.templates} role="radiogroup" aria-label="Template">
          {templates.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={tpl === t.id} className={`${styles.tpl} ${tpl === t.id ? styles.sel : ""}`} onClick={() => setTpl(t.id)}>
              <b>{t.name}</b><span>{t.hint}</span>
            </button>
          ))}
        </div>
        <div>
          <label className={styles.lbl} htmlFor="jnNewName">Name (only your team sees it)</label>
          <input id="jnNewName" className={styles.nameInput} value={name} maxLength={120} placeholder="Leave empty to use the template name" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className={styles.row}>
          <Button variant="primary" disabled={!canCreate || busy} loading={busy} onClick={() => void go()}>Create journey</Button>
          <Button onClick={() => router.push(ROUTES.marketingJourneys)}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
