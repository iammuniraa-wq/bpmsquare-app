"use client";

import { useRef, useState } from "react";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import { Opt } from "@/components/ui/Opt";
import { NEWSLETTER_TIPS } from "@/lib/newsletter/tips";
import { uploadImage } from "./studioApi";
import { pendingCount } from "@/lib/newsletter/studioState";
import { BLOCK_LABEL, FIELD_LABEL, LANGUAGES, PRIMARY_FIELD, REQUIRED_BLOCKS, TEXT_FIELDS, SOURCE_LANGUAGE, languageDef, type LanguageRow, type NewsletterBlock } from "@/lib/newsletter/types";
import type { Check } from "@/lib/newsletter/checks";
import styles from "./newsletter.module.css";

// The pieces of the left panel. Each is a controlled component: the studio holds
// the document, these only show it and report what a person did.

export const cx = (...p: (string | false | null | undefined)[]): string => p.filter(Boolean).join(" ");

const ICON = {
  eye: <svg viewBox="0 0 24 24"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>,
  eyeOff: <svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 10.6A3 3 0 0 0 13.4 13.4M9.9 5.1A10 10 0 0 1 22 12a16 16 0 0 1-3.2 3.7M6.6 6.6A16 16 0 0 0 2 12s3.5 6 10 6a9.8 9.8 0 0 0 4.2-.9" /></svg>,
  lock: <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>,
  trash: <svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>,
};

/** The one-line summary of a block in the list: its main words, in the language being edited. */
export function blockHint(b: NewsletterBlock, row: LanguageRow | undefined): string {
  const f = PRIMARY_FIELD[b.type];
  const v = f ? row?.texts[b.id]?.[f] ?? "" : "";
  return v.split("\n")[0].slice(0, 60);
}

export function BlockList({ blocks, row, selId, canEdit, onSelect, onToggle, onMove, onRemove, onDropOn }: {
  blocks: NewsletterBlock[]; row: LanguageRow | undefined; selId: string | null; canEdit: boolean;
  onSelect: (id: string) => void; onToggle: (id: string) => void; onMove: (id: string, dir: -1 | 1) => void; onRemove: (id: string) => void; onDropOn: (dragId: string, overId: string) => void;
}) {
  const [over, setOver] = useState<string | null>(null);
  const drag = useRef<string | null>(null);
  return (
    <div id="nlBlocksList">
      {blocks.map((b, i) => {
        const brand = REQUIRED_BLOCKS.includes(b.type);
        const hint = blockHint(b, row);
        return (
          <div
            key={b.id} role="button" tabIndex={0} data-id={b.id}
            className={cx(styles.blk, selId === b.id && styles.sel, !b.visible && styles.off, over === b.id && styles.over)}
            draggable={canEdit && !brand}
            onDragStart={() => { drag.current = b.id; }}
            onDragOver={(e) => { if (drag.current && !brand) { e.preventDefault(); setOver(b.id); } }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); if (drag.current && drag.current !== b.id && !brand) onDropOn(drag.current, b.id); drag.current = null; }}
            onClick={() => onSelect(b.id)}
            onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onSelect(b.id); } }}
          >
            <span className={styles.h} aria-hidden="true">{brand ? <span style={{ display: "inline-grid", width: 14, height: 14 }} className={styles.ic}>{ICON.lock}</span> : "⋮⋮"}</span>
            <span className={styles.n}>{BLOCK_LABEL[b.type]}{hint ? <small>{hint}</small> : null}</span>
            <span className={styles.t} onClick={(e) => e.stopPropagation()}>
              {brand || !canEdit ? <span className={styles.help} style={{ fontSize: 11 }}>{brand ? "brand" : ""}</span> : (
                <>
                  <button className={styles.ic} type="button" aria-label={b.visible ? `Hide ${BLOCK_LABEL[b.type]}` : `Show ${BLOCK_LABEL[b.type]}`} onClick={() => onToggle(b.id)}>{b.visible ? ICON.eye : ICON.eyeOff}</button>
                  <button className={styles.ic} type="button" aria-label="Move up" disabled={i <= 1} onClick={() => onMove(b.id, -1)}>↑</button>
                  <button className={styles.ic} type="button" aria-label="Move down" disabled={i >= blocks.length - 2} onClick={() => onMove(b.id, 1)}>↓</button>
                  <button className={styles.ic} type="button" aria-label={`Remove ${BLOCK_LABEL[b.type]}`} onClick={() => onRemove(b.id)}>{ICON.trash}</button>
                </>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const LONG_FIELDS = new Set(["text", "p1", "p2"]);
const REWRITABLE = new Set(["text", "p1", "p2", "title"]);

export function BlockEditor({ block, row, lang, canEdit, isAdmin, unlocked, onUnlock, onWords, onSetting, onRewrite, rewriting, aiReady, onError }: {
  block: NewsletterBlock; row: LanguageRow; lang: string; canEdit: boolean; isAdmin: boolean; unlocked: boolean; onUnlock: () => void;
  onWords: (field: string, value: string) => void; onSetting: (key: string, value: string | undefined) => void;
  onRewrite: (field: string, tone: "shorter" | "warmer" | "formal") => void; rewriting: string | null; aiReady: boolean; onError: (m: string) => void;
}) {
  const brand = REQUIRED_BLOCKS.includes(block.type);
  const locked = brand && !unlocked;
  const rtl = row.dir === "rtl";
  const fields = TEXT_FIELDS[block.type];
  const [uploading, setUploading] = useState(false);
  const words = row.texts[block.id] ?? {};
  const disabled = !canEdit || locked;

  async function pick(file: File) {
    setUploading(true);
    const r = await uploadImage(file);
    setUploading(false);
    if (!r.ok) { onError(r.error); return; }
    onSetting("path", r.data.path);
    onSetting("bytes", String(r.data.bytes));
  }

  return (
    <div className={styles.editor} id="nlEditor">
      <div className={styles.lbl}>{BLOCK_LABEL[block.type]} · {languageDef(lang)?.name ?? lang}{locked ? " (brand block, locked)" : ""}</div>
      {locked && isAdmin && <div><Button size="sm" onClick={onUnlock}>Unlock to edit</Button></div>}
      {locked && !isAdmin && <p className={styles.hint}>Brand block: only an admin can unlock it.</p>}

      {fields.map((f) => (
        <div key={f} style={{ display: "grid", gap: 4 }}>
          <label className={styles.lbl} htmlFor={`nlf-${f}`}>{FIELD_LABEL[f] ?? f}</label>
          {LONG_FIELDS.has(f) ? (
            <textarea id={`nlf-${f}`} className={styles.field} value={words[f] ?? ""} disabled={disabled} dir={rtl ? "rtl" : "ltr"} lang={lang} onChange={(e) => onWords(f, e.target.value)} />
          ) : (
            <input id={`nlf-${f}`} className={styles.field} value={words[f] ?? ""} disabled={disabled} dir={rtl ? "rtl" : "ltr"} lang={lang} onChange={(e) => onWords(f, e.target.value)} />
          )}
          {REWRITABLE.has(f) && !disabled && (
            <div className={styles.rw}>
              <span className="bpm-label-row">Rewrite<InfoTip label="Rewrite">{NEWSLETTER_TIPS.rewrite}</InfoTip></span>
              {(["shorter", "warmer", "formal"] as const).map((t) => (
                <Button key={t} size="sm" disabled={!aiReady || !words[f] || rewriting !== null} loading={rewriting === `${f}:${t}`} onClick={() => onRewrite(f, t)}>
                  {t === "shorter" ? "Shorter" : t === "warmer" ? "Friendlier" : "More formal"}
                </Button>
              ))}
            </div>
          )}
        </div>
      ))}

      {(block.type === "button" || block.type === "product" || block.type === "event" || block.type === "image") && (
        <Opt label={block.type === "image" ? "Where a click goes (optional)" : "Where it goes"} info={NEWSLETTER_TIPS.link} htmlFor="nlf-url">
          <input
            id="nlf-url" className={styles.field} type="url" inputMode="url" placeholder="https://" disabled={!canEdit}
            value={String(block.settings[block.type === "image" ? "link" : "url"] ?? "")}
            onChange={(e) => onSetting(block.type === "image" ? "link" : "url", e.target.value)}
          />
        </Opt>
      )}

      {(block.type === "image" || block.type === "product") && (
        <Opt label="Picture" info={NEWSLETTER_TIPS.picture} hint="PNG, JPG, WebP · max 2 MB" htmlFor="nlf-file">
          {typeof block.settings.path === "string" && block.settings.path && <span className={styles.chip}>A picture is chosen</span>}
          <input id="nlf-file" type="file" accept="image/png,image/jpeg,image/webp" disabled={!canEdit || uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ""; }} />
          {typeof block.settings.path === "string" && block.settings.path && canEdit && <div><Button size="sm" onClick={() => { onSetting("path", undefined); onSetting("bytes", undefined); }}>Remove the picture</Button></div>}
        </Opt>
      )}

      {block.type === "product" && typeof block.settings.product_id === "string" && <span className={styles.chip}>Linked to your catalogue</span>}
      {fields.length === 0 && block.type !== "social" && <p className={styles.hint}>No words in this block.</p>}
      {block.type === "social" && <p className={styles.hint}>Social links come from your brand kit.</p>}
    </div>
  );
}

export function LanguageRows({ blocks, languages, canEdit, onRemove }: {
  blocks: NewsletterBlock[]; languages: LanguageRow[]; canEdit: boolean; onRemove: (lang: string) => void;
}) {
  return (
    <div>
      {languages.map((l) => {
        const n = pendingCount(l, blocks);
        const def = languageDef(l.lang);
        return (
          <div className={styles.lang} key={l.lang}>
            <b>{def?.name ?? l.lang}{l.lang === SOURCE_LANGUAGE ? " (default)" : ""}</b>
            {l.lang === SOURCE_LANGUAGE ? <span className={cx(styles.st, styles.ok)}>Written first</span> : n ? <span className={cx(styles.st, styles.w)}>{n} to check</span> : <span className={cx(styles.st, styles.ok)}>Ready</span>}
            <small dir={l.dir} lang={l.lang}>{l.subject || "No subject yet"}</small>
            {canEdit && l.lang !== SOURCE_LANGUAGE && <span style={{ gridColumn: 2, gridRow: 2 }}><button type="button" className={styles.ic} aria-label={`Remove ${def?.name ?? l.lang}`} onClick={() => onRemove(l.lang)}>{ICON.trash}</button></span>}
          </div>
        );
      })}
    </div>
  );
}

export function AddLanguage({ present, busy, canEdit, aiReady, onAdd }: {
  present: string[]; busy: boolean; canEdit: boolean; aiReady: boolean; onAdd: (lang: string, mode: "ai" | "empty") => void;
}) {
  const options = LANGUAGES.filter((l) => !present.includes(l.code));
  const [pick, setPick] = useState("");
  const chosen = pick && options.some((o) => o.code === pick) ? pick : options[0]?.code ?? "";
  if (options.length === 0) return <p className={styles.hint}>Every language the studio knows is already there.</p>;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div className="bpm-label-row"><span className={styles.lbl}>Add language</span><InfoTip label="Add language">{NEWSLETTER_TIPS.addLanguage}</InfoTip></div>
      <div className={styles.addlang}>
        <select id="nlLangPick" className={styles.select} aria-label="Language to add" value={chosen} onChange={(e) => setPick(e.target.value)} disabled={!canEdit}>
          {options.map((o) => <option key={o.code} value={o.code}>{o.name} ({o.native})</option>)}
        </select>
        <Button variant="primary" size="sm" loading={busy} disabled={!canEdit || !aiReady || busy} onClick={() => onAdd(chosen, "ai")}>Translate with AI</Button>
        <Button size="sm" disabled={!canEdit || busy} onClick={() => onAdd(chosen, "empty")}>I&apos;ll write it</Button>
      </div>
      {!aiReady && <span className={styles.hint}>AI is not set up for this workspace, so you write the language yourself.</span>}
    </div>
  );
}

/** The content health checklist: green ticks and amber items, each amber one saying in plain words what to change. */
export function CheckChips({ checks, loading }: { checks: Check[]; loading: boolean }) {
  if (checks.length === 0) return <div aria-live="polite">{loading ? <><div className={styles.skel} style={{ width: "60%" }} /><div className={styles.skel} style={{ width: "40%" }} /></> : <span className={styles.help}>Nothing to check yet.</span>}</div>;
  const warn = checks.filter((c) => c.tone === "warn");
  const good = checks.filter((c) => c.tone === "good");
  return (
    <div className={styles.health} aria-live="polite">
      {warn.length > 0 && (
        <ul className={styles.healthList} aria-label="To change">
          {warn.map((c) => (
            <li key={c.id} className={styles.healthItem}>
              <span className={cx(styles.chip, styles.a)}>{"⚠ "}{c.label}</span>
              {c.fix && <span className={styles.healthFix}>{c.fix}</span>}
            </li>
          ))}
        </ul>
      )}
      {good.length > 0 && (
        <ul className={styles.healthList} aria-label="All good">
          {good.map((c) => <li key={c.id}><span className={cx(styles.chip, styles.g)}>{"✓ "}{c.label}</span></li>)}
        </ul>
      )}
    </div>
  );
}
