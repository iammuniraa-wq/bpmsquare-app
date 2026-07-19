"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import type { Contact } from "@/lib/types";
import { Pencil, CheckIcon } from "@/components/Icons";
import ObjectEditForm, { type FormHelpers } from "@/components/fields/ObjectEditForm";
import AdaptObjectDrawer from "@/components/AdaptObjectDrawer";

interface Props {
  contact: Contact;
  isAdmin: boolean;
  accountAddress?: {
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    country: string | null;
  } | null;
  children: React.ReactNode;
}

// Owns the whole contact-detail header: static name/role/phone/email/account
// info (passed in as children, still server-rendered) sits above the action
// buttons, and the edit form -- which can run to a dozen-plus fields -- gets
// its own full-width row below when open, instead of sharing a flex row with
// the small "Edit contact" / Adapt buttons.
export default function ContactEditPanel({ contact, isAdmin, accountAddress, children }: Props) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  return (
    <div style={{ ...cardStyle, marginBottom: 14 }}>
      {children}

      <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => { setOpen((v) => !v); setSaved(false); }}
          style={{
            fontSize: 12.5, fontWeight: 600, color: saved ? c.muted : c.accent,
            background: saved ? "none" : c.accentbg, border: `1px solid ${saved ? c.line : c.accent + "40"}`,
            borderRadius: 6, padding: "6px 14px", cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 5,
          }}
        >
          {saved ? <><CheckIcon size={12} color={c.muted} /> Saved</> : <><Pencil size={12} color={c.accent} /> {open ? "Close" : "Edit contact"}</>}
        </button>
        <AdaptObjectDrawer objectType="contact" objectLabel="Contact" isAdmin={isAdmin} />
      </div>

      {open && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${c.line}`, maxWidth: 560 }}>
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
      )}
    </div>
  );
}
