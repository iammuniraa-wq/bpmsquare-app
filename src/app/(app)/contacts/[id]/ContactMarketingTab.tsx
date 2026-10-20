import type { ContactHealth } from "@/lib/marketing/contactHealth";
import type { ContactConsent } from "@/lib/marketing/contactConsent";
import EmailHealthCard from "./EmailHealthCard";
import ConsentCard from "./ConsentCard";

// The contact's Marketing tab: what is known about reaching this person by email
// (Newsletter Studio), and what they have agreed to (marketing program). Each card
// is shown only for a workspace with its flag on, and degrades to a "waiting for a
// database update" note while its migration is pending.
export default function ContactMarketingTab({ contactId, email, canEdit, health, consent }: {
  contactId: string; email: string | null; canEdit: boolean; health: ContactHealth | null; consent: ContactConsent | null;
}) {
  return (
    <>
      {health && <EmailHealthCard contactId={contactId} email={email} health={health} canEdit={canEdit} />}
      {consent && <ConsentCard contactId={contactId} consent={consent} canEdit={canEdit} />}
    </>
  );
}
