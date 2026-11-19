// The client's own item number on an RFQ line ("Item no. 1.1"). An RFQ line has no column for it: it travels at the start of the
// line's specification, which is what the supplier reads in the email, the PDF and the reply page. PURE, client-safe.

const clean = (v: unknown): string | null => {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s === "" ? null : s.slice(0, 100);
};

/** The specification of a line that came from a numbered schedule: "Item no. 1.1", or "Item no. 1.1. <spec>" when it has one. */
export function itemNoSpec(itemNo: unknown, spec?: string | null): string | null {
  const no = clean(itemNo);
  const rest = spec?.trim() || null;
  if (!no) return rest;
  return rest ? `Item no. ${no}. ${rest}` : `Item no. ${no}`;
}

/** The item number a specification starts with ("Item no. 1.1. Grade 316" -> "1.1"), or null when it names none. */
export function itemNoOfSpec(spec: string | null | undefined): string | null {
  const m = /^Item no\. (\S+?)(?:\.\s|\.?$)/.exec((spec ?? "").trim());
  return m ? m[1] : null;
}
