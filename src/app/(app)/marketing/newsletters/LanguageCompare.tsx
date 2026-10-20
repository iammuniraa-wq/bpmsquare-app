"use client";

import { useMemo } from "react";
import Button from "@/components/ui/Button";
import { compareLanguages } from "@/lib/newsletter/compare";
import { languageDef, type LanguageRow, type NewsletterBlock, type ReviewState } from "@/lib/newsletter/types";
import styles from "./newsletter.module.css";
import { cx } from "./panels";

const STATE_WORDS: Record<ReviewState, string> = { written: "Written", translated: "Check this", reviewed: "Reviewed" };

/**
 * Two languages of the design side by side, block by block, with each block's review state. The
 * reviewer can Accept or open a block to edit without leaving the page.
 */
export default function LanguageCompare({ blocks, languages, left, right, onPick, canEdit, onAccept, onEdit }: {
  blocks: NewsletterBlock[]; languages: LanguageRow[]; left: string; right: string;
  onPick: (side: "left" | "right", lang: string) => void; canEdit: boolean;
  onAccept: (lang: string, blockId: string) => void; onEdit: (lang: string, blockId: string) => void;
}) {
  const a = languages.find((l) => l.lang === left) ?? languages[0];
  const b = languages.find((l) => l.lang === right) ?? languages[1] ?? languages[0];
  const cmp = useMemo(() => (a && b ? compareLanguages(blocks, a, b) : null), [blocks, a, b]);
  if (!a || !b || !cmp) return null;

  const pick = (side: "left" | "right", value: string) => (
    <select className={styles.select} aria-label={side === "left" ? "First language" : "Second language"} value={value} onChange={(e) => onPick(side, e.target.value)}>
      {languages.map((l) => <option key={l.lang} value={l.lang}>{languageDef(l.lang)?.name ?? l.lang}</option>)}
    </select>
  );
  const cell = (row: LanguageRow, text: string, state?: ReviewState) => (
    <div className={styles.cmpCell} dir={row.dir} lang={row.lang}>
      {state && <span className={cx(styles.st, state === "translated" ? styles.w : state === "reviewed" ? styles.ok : styles.n)}>{STATE_WORDS[state]}</span>}
      <div className={styles.cmpText}>{text || <span className={styles.help}>(empty)</span>}</div>
    </div>
  );

  return (
    <div className={styles.cmp} id="nlCompare">
      <div className={styles.cmpHead}>{pick("left", a.lang)}{pick("right", b.lang)}</div>
      <p className={styles.hint}>
        {cmp.pendingB > 0 ? `${cmp.pendingB} block${cmp.pendingB === 1 ? "" : "s"} in ${languageDef(b.lang)?.name ?? b.lang} still need a check.` : `Every block in ${languageDef(b.lang)?.name ?? b.lang} has been checked.`}
      </p>
      <div className={styles.cmpRow}><div className={styles.lbl}>Subject</div></div>
      <div className={styles.cmpRow}>{cell(a, cmp.subject.a)}{cell(b, cmp.subject.b)}</div>
      <div className={styles.cmpRow}><div className={styles.lbl}>Preview line</div></div>
      <div className={styles.cmpRow}>{cell(a, cmp.preheader.a)}{cell(b, cmp.preheader.b)}</div>
      {cmp.rows.map((r) => (
        <section key={r.blockId} className={styles.cmpBlock} aria-label={r.label}>
          <div className={styles.cmpRow}>
            <div className={styles.lbl}>{r.label}</div>
            {canEdit && (
              <span className={styles.cmpActs}>
                {r.b === "translated" && <Button size="sm" onClick={() => onAccept(b.lang, r.blockId)}>{`Accept ${languageDef(b.lang)?.name ?? b.lang}`}</Button>}
                <Button size="sm" onClick={() => onEdit(b.lang, r.blockId)}>Edit</Button>
              </span>
            )}
          </div>
          {r.fields.map((f, i) => (
            <div className={styles.cmpRow} key={f.field}>
              {cell(a, f.a, i === 0 ? r.a : undefined)}
              {cell(b, f.b, i === 0 ? r.b : undefined)}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
