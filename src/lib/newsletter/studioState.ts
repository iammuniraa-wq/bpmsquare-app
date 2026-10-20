import { newBlockDefaults } from "./designs";
import { defaultBlockId, languageStatus } from "./sanitize";
import { REQUIRED_BLOCKS, SOURCE_LANGUAGE, TEXT_FIELDS, type BlockType, type LanguageRow, type NewsletterBlock } from "./types";

// Pure edits on the document the studio holds (blocks + one row per language).
// The screen calls these and the server re-applies the same rules on save, so a
// stale or hand-made request cannot skip them. No React, no I/O.

export type Doc = { blocks: NewsletterBlock[]; languages: LanguageRow[] };

const withStatus = (l: LanguageRow, blocks: readonly NewsletterBlock[]): LanguageRow => ({ ...l, status: languageStatus(l, blocks) });

const hasWords = (l: LanguageRow, blockId: string): boolean => Object.values(l.texts[blockId] ?? {}).some((v) => v);

/**
 * A person changed one field. Editing the English flags the same block
 * "translated" again in every other language that has words for it (never a
 * silent re-translation); editing another language leaves its review state for
 * the person to settle with Accept.
 */
export function editWords(doc: Doc, lang: string, blockId: string, field: string, value: string): Doc {
  const languages = doc.languages.map((l) => {
    if (l.lang === lang) return { ...l, texts: { ...l.texts, [blockId]: { ...(l.texts[blockId] ?? {}), [field]: value } } };
    if (lang === SOURCE_LANGUAGE && hasWords(l, blockId) && l.review[blockId] !== "translated") {
      return withStatus({ ...l, review: { ...l.review, [blockId]: "translated" } }, doc.blocks);
    }
    return l;
  });
  return { ...doc, languages };
}

export function setHeading(doc: Doc, lang: string, key: "subject" | "preheader", value: string): Doc {
  return { ...doc, languages: doc.languages.map((l) => (l.lang === lang ? { ...l, [key]: value } : l)) };
}

export function acceptBlock(doc: Doc, lang: string, blockId: string): Doc {
  return {
    ...doc,
    languages: doc.languages.map((l) => (l.lang === lang ? withStatus({ ...l, review: { ...l.review, [blockId]: "reviewed" } }, doc.blocks) : l)),
  };
}

export function acceptAll(doc: Doc, lang: string): Doc {
  return {
    ...doc,
    languages: doc.languages.map((l) => {
      if (l.lang !== lang) return l;
      const review = { ...l.review };
      for (const b of doc.blocks) if (review[b.id] === "translated") review[b.id] = "reviewed";
      return withStatus({ ...l, review }, doc.blocks);
    }),
  };
}

/** Adds a block before the footer. Every language gets the English starter words; the others are flagged for a check. */
export function addBlock(doc: Doc, type: BlockType): { doc: Doc; id: string } {
  const id = defaultBlockId(type, new Set(doc.blocks.map((b) => b.id)));
  const block: NewsletterBlock = { id, type, visible: true, settings: {} };
  const blocks = [...doc.blocks.slice(0, -1), block, doc.blocks[doc.blocks.length - 1]];
  const words = newBlockDefaults(type);
  const hasText = TEXT_FIELDS[type].length > 0;
  const languages = doc.languages.map((l) =>
    withStatus(
      { ...l, texts: hasText ? { ...l.texts, [id]: { ...words } } : l.texts, review: { ...l.review, [id]: hasText && l.lang !== SOURCE_LANGUAGE ? "translated" : "written" } },
      blocks,
    ),
  );
  return { doc: { blocks, languages }, id };
}

/** Moves a block up or down within the body. The header stays first and the footer last. */
export function moveBlock(doc: Doc, id: string, dir: -1 | 1): Doc {
  const i = doc.blocks.findIndex((b) => b.id === id);
  const j = i + dir;
  if (i < 1 || j < 1 || j > doc.blocks.length - 2 || i > doc.blocks.length - 2) return doc;
  const blocks = [...doc.blocks];
  [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  return { ...doc, blocks };
}

/** Drag and drop: puts `id` at the position of `overId`, within the body. */
export function moveBlockTo(doc: Doc, id: string, overId: string): Doc {
  const from = doc.blocks.findIndex((b) => b.id === id);
  const to = doc.blocks.findIndex((b) => b.id === overId);
  if (from < 1 || to < 1 || from > doc.blocks.length - 2 || to > doc.blocks.length - 2 || from === to) return doc;
  const blocks = [...doc.blocks];
  const [m] = blocks.splice(from, 1);
  blocks.splice(to, 0, m);
  return { ...doc, blocks };
}

export function toggleBlock(doc: Doc, id: string): Doc {
  return { ...doc, blocks: doc.blocks.map((b) => (b.id === id && !REQUIRED_BLOCKS.includes(b.type) ? { ...b, visible: !b.visible } : b)) };
}

export function removeBlock(doc: Doc, id: string): Doc {
  const b = doc.blocks.find((x) => x.id === id);
  if (!b || REQUIRED_BLOCKS.includes(b.type)) return doc;
  const blocks = doc.blocks.filter((x) => x.id !== id);
  return {
    blocks,
    languages: doc.languages.map((l) => {
      const texts = { ...l.texts }; delete texts[id];
      const review = { ...l.review }; delete review[id];
      return withStatus({ ...l, texts, review }, blocks);
    }),
  };
}

export function setSetting(doc: Doc, id: string, key: string, value: string | undefined): Doc {
  return {
    ...doc,
    blocks: doc.blocks.map((b) => {
      if (b.id !== id) return b;
      const settings = { ...b.settings };
      if (value === undefined || value === "") delete settings[key]; else settings[key] = value;
      return { ...b, settings };
    }),
  };
}

/** Number of blocks a language still has to settle. */
export const pendingCount = (l: LanguageRow, blocks: readonly NewsletterBlock[]): number =>
  blocks.filter((b) => b.visible && l.review[b.id] === "translated").length;
