import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminSupabase } from "@/lib/supabase-server";
import { verifyPreferenceToken } from "@/lib/marketing/forms/preferenceToken";
import { loadPreferences } from "@/lib/marketing/forms/preferences";
import PreferencesForm from "@/components/marketing/PreferencesForm";
import styles from "@/components/marketing/publicForm.module.css";

export const metadata: Metadata = { title: "Email preferences", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// No login: reached by the signed link in a marketing email (preferenceToken.ts). Opening it
// changes nothing; the buttons POST. A bad token, an unknown contact and a workspace without the
// feature all answer "not found" the same way.
export default async function PreferencesPage({ params }: { params: Promise<{ contactId: string; token: string }> }) {
  const { contactId, token } = await params;
  if (!verifyPreferenceToken(contactId, token)) notFound();
  const loaded = await loadPreferences(createAdminSupabase(), contactId);
  if (!loaded) notFound();
  const { view } = loaded;

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          {view.brand.logoUrl ? <img src={view.brand.logoUrl} alt={view.brand.name} /> : <span>{view.brand.name}</span>}
        </div>
        <h1 className={styles.title}>{view.firstName ? `${view.firstName}, what would you like to hear about?` : "What would you like to hear about?"}</h1>
        <p className={styles.intro}>Choose the emails you want from {view.brand.name}. You can change your mind at any time. This does not affect quotes, invoices or other messages about your account.</p>
        <PreferencesForm contactId={contactId} token={token} initial={view.topics} blocked={view.blocked} />
        {view.history.length > 0 ? (
          <details>
            <summary className={styles.note}>Your recent choices</summary>
            <ul className={styles.history}>
              {view.history.map((h, i) => <li key={i}>{new Date(h.when).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}: {h.text}</li>)}
            </ul>
          </details>
        ) : null}
      </div>
    </div>
  );
}
