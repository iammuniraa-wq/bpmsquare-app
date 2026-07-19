"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import type { Account } from "@/lib/types";
import { Pencil, CheckIcon } from "@/components/Icons";
import ObjectEditForm from "@/components/fields/ObjectEditForm";
import AdaptObjectDrawer from "@/components/AdaptObjectDrawer";

// Owns the whole account-detail header: static name/pills/meta (passed in as
// children, still server-rendered) sit in the top row alongside the action
// buttons, and the edit form -- which can run to a dozen-plus fields -- gets
// its own full-width row below when open, instead of being squeezed into the
// narrow flex slot next to the "Edit account" button.
export default function AccountEditPanel({ account, isAdmin, children }: { account: Account; isAdmin: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  return (
    <div style={{ ...cardStyle, marginBottom: 2, padding: "20px 22px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        {children}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => { setOpen((v) => !v); setSaved(false); }}
            style={{
              fontSize: 12, fontWeight: 600, color: c.muted,
              background: "none", border: `1px solid ${c.line}`,
              borderRadius: 6, padding: "5px 12px", cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 5,
            }}
          >
            {saved ? <><CheckIcon size={12} color={c.muted} /> Saved</> : <><Pencil size={12} color={c.muted} /> {open ? "Close" : "Edit account"}</>}
          </button>
          <AdaptObjectDrawer objectType="account" objectLabel="Account" isAdmin={isAdmin} />
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${c.line}`, maxWidth: 560 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>
            Edit account
          </div>
          <ObjectEditForm
            objectType="account"
            record={account as unknown as Record<string, unknown>}
            patchUrl={`/api/accounts/${account.id}`}
            onSaved={() => { setSaved(true); setOpen(false); }}
            onCancel={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
