/**
 * Vikas Pioneers India (P) Ltd — tenant extension.
 * All Vikas-specific logic lives here. Standard product is untouched.
 *
 * No "use client" here (unlike a stale earlier version of this file) — every
 * hook is invoked directly from server-side code (loadExtension() is called
 * from the quote print Server Component, never from a Client Component), and
 * quoteSignatureSlot only returns a plain <img>, no hooks/handlers. _base/
 * has no directive either; this file should match it exactly.
 */
import type { TenantExtension } from "@/extensions/types";
import { VIKAS_SIGNATURE } from "@/lib/vikasSig";

const vikas: TenantExtension = {
  extraCustomFields: (objectType) => {
    // "make" and "rpm" removed — both now native FIELD_REGISTRY.asset columns
    // (see FIELD_REGISTRY_ROLLOUT.md). "frame_size"/"insulation" are left as
    // genuinely different shapes from the new "frame_type"/"insulation_class"
    // native fields (select-with-options vs plain text) — not reconciled here,
    // pending a decision on whether they're the same concept.
    if (objectType === "asset") return [
      { key: "kva_rating",    label: "KVA Rating",     type: "text" },
      { key: "voltage",       label: "Voltage (V)",    type: "text" },
      { key: "frame_size",    label: "Frame Size",     type: "text" },
      { key: "poles",         label: "Poles",          type: "number" },
      { key: "insulation",    label: "Insulation Class", type: "select", options: ["A","B","E","F","H"] },
      { key: "ip_rating",     label: "IP Rating",      type: "text" },
      { key: "mounting",      label: "Mounting",       type: "select", options: ["Foot","Flange","Foot+Flange"] },
    ];
    return [];
  },

  // Sales reps often already type "Rewinding of ..." into the quote name
  // themselves -- prepending the fixed prefix unconditionally produced
  // "Quotation for the Rewinding of Rewinding Of 132KW Motor". Only add the
  // prefix when the name doesn't already start with "rewinding".
  quoteSubject: (name) => {
    const trimmed = name.trim();
    return /^rewinding\b/i.test(trimmed)
      ? `Quotation for the ${trimmed}`
      : `Quotation for the Rewinding of ${trimmed}`;
  },

  quoteSignatureSlot: () => (
    <img
      src={VIKAS_SIGNATURE}
      alt=""
      style={{ display: "block", height: 48, width: "auto", marginBottom: 6, objectFit: "contain", objectPosition: "left bottom" }}
    />
  ),
};

export default vikas;
