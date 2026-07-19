import { cardStyle } from "@/components/Shell";
import AdaptObjectDrawer from "@/components/AdaptObjectDrawer";

// Static header shell: name/role/phone/email/account info (passed in as
// children) alongside the Adapt-fields drawer. Editing the contact's own
// field values happens inline in the Details card below (ObjectSections),
// not here.
export default function ContactHeader({ isAdmin, children }: { isAdmin: boolean; children: React.ReactNode }) {
  return (
    <div style={{ ...cardStyle, marginBottom: 14 }}>
      {children}
      <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <AdaptObjectDrawer objectType="contact" objectLabel="Contact" isAdmin={isAdmin} />
      </div>
    </div>
  );
}
