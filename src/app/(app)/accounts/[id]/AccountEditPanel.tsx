"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import type { Account } from "@/lib/types";
import { Pencil, CheckIcon } from "@/components/Icons";
import ObjectEditForm from "@/components/fields/ObjectEditForm";

export default function AccountEditPanel({ account }: { account: Account }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); setSaved(false); }}
        style={{
          fontSize: 12, fontWeight: 600, color: c.muted,
          background: "none", border: `1px solid ${c.line}`,
          borderRadius: 6, padding: "5px 12px", cursor: "pointer",
          display: "inline-flex", alignItems: "center", gap: 5,
        }}
      >
        {saved ? <><CheckIcon size={12} color={c.muted} /> Saved</> : <><Pencil size={12} color={c.muted} /> Edit account</>}
      </button>
    );
  }

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${c.line}` }}>
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
  );
}
