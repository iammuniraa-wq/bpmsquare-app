import { cardStyle } from "@/components/Shell";
import AdaptObjectDrawer from "@/components/AdaptObjectDrawer";

// Static header shell: name/pills/meta (passed in as children) alongside the
// Adapt-fields drawer. Editing the account's own field values happens inline
// in the Details card below (ObjectSections), not here.
export default function AccountHeader({ isAdmin, children }: { isAdmin: boolean; children: React.ReactNode }) {
  return (
    <div style={{ ...cardStyle, marginBottom: 2, padding: "20px 22px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        {children}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          <AdaptObjectDrawer objectType="account" objectLabel="Account" isAdmin={isAdmin} />
        </div>
      </div>
    </div>
  );
}
