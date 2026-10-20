import { BLOCK_LABEL, FIELD_LABEL, TEXT_FIELDS, type BlockType, type LanguageRow, type NewsletterBlock, type ReviewState } from "./types";

// Language compare: two languages of the same design, block by block, so a reviewer reads the
// English and the Arabic together. Pure; the review state shown is the one stored on each row.

export type CompareField = { field: string; label: string; a: string; b: string };
export type CompareRow = {
  blockId: string;
  type: BlockType;
  label: string;
  fields: CompareField[];
  a: ReviewState;
  b: ReviewState;
};
export type Comparison = {
  subject: { a: string; b: string };
  preheader: { a: string; b: string };
  rows: CompareRow[];
  /** Blocks on the second language still waiting for a person ("Check this"). */
  pendingB: number;
};

export function compareLanguages(blocks: readonly NewsletterBlock[], a: Pick<LanguageRow, "subject" | "preheader" | "texts" | "review">, b: Pick<LanguageRow, "subject" | "preheader" | "texts" | "review">): Comparison {
  const rows: CompareRow[] = [];
  for (const blk of blocks) {
    if (!blk.visible) continue;
    const fields: CompareField[] = [];
    for (const f of TEXT_FIELDS[blk.type]) {
      const av = a.texts[blk.id]?.[f] ?? "";
      const bv = b.texts[blk.id]?.[f] ?? "";
      if (av || bv) fields.push({ field: f, label: FIELD_LABEL[f] ?? f, a: av, b: bv });
    }
    if (fields.length === 0) continue;
    rows.push({ blockId: blk.id, type: blk.type, label: BLOCK_LABEL[blk.type], fields, a: a.review[blk.id] ?? "written", b: b.review[blk.id] ?? "written" });
  }
  return {
    subject: { a: a.subject, b: b.subject }, preheader: { a: a.preheader, b: b.preheader }, rows,
    pendingB: rows.filter((r) => r.b === "translated").length,
  };
}
