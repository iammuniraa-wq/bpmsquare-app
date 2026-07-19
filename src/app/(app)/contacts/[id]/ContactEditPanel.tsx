"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import type { Contact } from "@/lib/types";
import { Pencil, CheckIcon } from "@/components/Icons";
import ObjectEditForm, { type FormHelpers } from "@/components/fields/ObjectEditForm";

interface Props {
  contact: Contact;
  accountAddress?: {
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    country: string | null;
  } | null;
}

export default function ContactEditPanel({ contact, accountAddress }: Props) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); setSaved(false); }}
        style={{
          fontSize: 12.5, fontWeight: 600, color: saved ? c.muted : c.accent,
          background: saved ? "none" : c.accentbg, border: `1px solid ${saved ? c.line : c.accent + "40"}`,
          borderRadius: 6, padding: "6px 14px", cursor: "pointer",
          display: "inline-flex", alignItems: "center", gap: 5,
        }}
      >
        {saved ? <><CheckIcon size={12} color={c.muted} /> Saved</> : <><Pencil size={12} color={c.accent} /> Edit contact</>}
      </button>
    );
  }

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${c.line}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>
        Edit contact
      </div>
      <ObjectEditForm
        objectType="contact"
        record={contact as unknown as Record<string, unknown>}
        patchUrl={`/api/contacts/${contact.id}`}
        onSaved={() => { setSaved(true); setOpen(false); }}
        onCancel={() => setOpen(false)}
        sectionExtras={accountAddress ? {
          Address: ({ setValues }: FormHelpers) => (
            <button
              type="button"
              onClick={() => setValues({
                address_line1: accountAddress.address_line1 ?? "",
                address_line2: accountAddress.address_line2 ?? "",
                city: accountAddress.city ?? "",
                state: accountAddress.state ?? "",
                postal_code: accountAddress.postal_code ?? "",
                country: accountAddress.country ?? "",
              })}
              style={{
                fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 5,
                border: `1px solid ${c.accent}40`, background: c.accentbg, color: c.accent,
                cursor: "pointer",
              }}
            >
              ↙ Copy from account
            </button>
          ),
        } : undefined}
      />
    </div>
  );
}
