"use client";

import { useState } from "react";
import type { RfqOriginType } from "@/lib/rfq/types";
import type { ComposerLine } from "./RfqComposer";
import RfqDialog, { type RfqCreated } from "./RfqDialog";
import { btnGhost } from "./rfqUi";

// "Request quotation" on any record: opens the RFQ form prefilled with what
// the record knows, and lands on the new RFQ (or hands its ids back to the
// caller, e.g. a quote editor that wants to remember which RFQ line each of
// its lines became).

export default function CreateRfqButton({
  origin, originLabel, lines, title, label = "Request quotation", onCreated, buttonStyle,
}: {
  origin: { type: RfqOriginType; id: string | null };
  originLabel?: string | null;
  lines?: ComposerLine[];
  title?: string;
  label?: string;
  onCreated?: (r: RfqCreated) => void;
  buttonStyle?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" style={{ ...btnGhost, ...buttonStyle }} onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <RfqDialog
          onClose={() => setOpen(false)}
          origin={origin}
          originLabel={originLabel}
          lines={lines}
          title={title}
          onCreated={onCreated}
        />
      )}
    </>
  );
}
