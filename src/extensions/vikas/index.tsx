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
    if (objectType === "asset") return [
      { key: "kva_rating",    label: "KVA Rating",     type: "text" },
      { key: "voltage",       label: "Voltage (V)",    type: "text" },
      { key: "rpm",           label: "RPM",            type: "number" },
      { key: "frame_size",    label: "Frame Size",     type: "text" },
      { key: "make",          label: "Make / Brand",   type: "text" },
      { key: "poles",         label: "Poles",          type: "number" },
      { key: "insulation",    label: "Insulation Class", type: "select", options: ["A","B","E","F","H"] },
      { key: "ip_rating",     label: "IP Rating",      type: "text" },
      { key: "mounting",      label: "Mounting",       type: "select", options: ["Foot","Flange","Foot+Flange"] },
    ];
    return [];
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
