"use client";

import type { Contact } from "@/lib/types";
import ObjectSections, { type FormHelpers } from "@/components/fields/ObjectSections";
import Button from "@/components/ui/Button";

type AccountAddress = {
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
} | null;

// Thin client wrapper so the "Copy from account" button (a closure, can't
// cross the server/client boundary as a prop) can be built here instead of
// in the server-rendered page.
export default function ContactDetailSections({ contact, accountAddress }: { contact: Contact; accountAddress: AccountAddress }) {
  return (
    <ObjectSections
      objectType="contact"
      record={contact as unknown as Record<string, unknown>}
      patchUrl={`/api/contacts/${contact.id}`}
      exclude={["name", "role", "phone"]}
      sectionExtras={accountAddress ? {
        Address: ({ setValues }: FormHelpers) => (
          <Button
            variant="quiet"
            size="sm"
            onClick={() => setValues({
              address_line1: accountAddress.address_line1 ?? "",
              address_line2: accountAddress.address_line2 ?? "",
              city: accountAddress.city ?? "",
              state: accountAddress.state ?? "",
              postal_code: accountAddress.postal_code ?? "",
              country: accountAddress.country ?? "",
            })}
          >
            ↙ Copy from account
          </Button>
        ),
      } : undefined}
    />
  );
}
