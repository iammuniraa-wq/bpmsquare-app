import type { Metadata } from "next";
import { createAdminSupabase } from "@/lib/supabase-server";
import { loadConfirmView } from "@/lib/marketing/forms/confirm";
import { verifyConfirmToken } from "@/lib/marketing/forms/confirmToken";
import ConfirmButton from "@/components/marketing/ConfirmButton";
import styles from "@/components/marketing/publicForm.module.css";

export const metadata: Metadata = { title: "Confirm your email", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// No login: reached by the signed link in the thank-you email (forms/confirmToken.ts). Opening it
// changes nothing; the button POSTs. An invalid, expired or unknown link shows a plain sentence,
// never an error page, and says nothing about whether the person exists.
function Plain({ title, text }: { title: string; text: string }) {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.intro}>{text}</p>
      </div>
    </div>
  );
}

export default async function ConfirmPage({ params }: { params: Promise<{ contactId: string; token: string }> }) {
  const { contactId, token } = await params;
  const check = verifyConfirmToken(contactId, token);
  if (!check.ok) {
    return check.reason === "expired"
      ? <Plain title="This link has expired" text="Links to confirm an email last seven days. Please fill in the form again and we will send you a new one." />
      : <Plain title="This link is not valid" text="Please use the link in the email we sent you, or fill in the form again." />;
  }
  const view = await loadConfirmView(createAdminSupabase(), contactId, check.windowStart);
  if (!view) return <Plain title="This link is not valid" text="Please use the link in the email we sent you, or fill in the form again." />;
  if (view.waiting.length === 0) {
    return view.alreadyConfirmed
      ? <Plain title="You are already confirmed" text={`Thank you. ${view.brand.name} already has your yes. You can change your mind at any time from any email we send.`} />
      : <Plain title="Nothing is waiting" text="There is nothing to confirm for this link. If you were expecting to, please fill in the form again." />;
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          {view.brand.logoUrl ? <img src={view.brand.logoUrl} alt={view.brand.name} /> : <span>{view.brand.name}</span>}
        </div>
        <h1 className={styles.title}>{view.firstName ? `${view.firstName}, please confirm` : "Please confirm"}</h1>
        <p className={styles.intro}>Do you want to hear from {view.brand.name} by email about: {view.waiting.join(", ")}?</p>
        <ConfirmButton contactId={contactId} token={token} brand={view.brand.name} />
      </div>
    </div>
  );
}
