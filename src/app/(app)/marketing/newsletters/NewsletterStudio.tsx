"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import Button from "@/components/ui/Button";
import { useFeel } from "@/components/FeelProvider";
import { BUILT_IN_DESIGNS, languageRowsOf, footerTexts, type BuiltInDesign } from "@/lib/newsletter/designs";
import { countWarnings, type Check } from "@/lib/newsletter/checks";
import {
  acceptAll, acceptBlock, addBlock, editWords, moveBlock, moveBlockTo, pendingCount, removeBlock, setHeading, setSetting, toggleBlock, type Doc,
} from "@/lib/newsletter/studioState";
import {
  ADDABLE_BLOCKS, BLOCK_LABEL, CATEGORIES, SOURCE_LANGUAGE, directionOf, languageDef,
  type LanguageRow, type NewsletterBlock, type NewsletterCategory, type NewsletterStatus,
} from "@/lib/newsletter/types";
import { ROUTES } from "@/lib/constants";
import {
  addLanguage, createNewsletter, deleteNewsletter, draftWithAi, keepVersion, loadTemplate, previewNewsletter, rewriteWithAi, saveAsTemplate, saveNewsletter,
  type PreviewData,
} from "./studioApi";
import { AddLanguage, BlockEditor, BlockList, CheckChips, Group, LanguageRows, cx } from "./panels";
import PreviewFrame from "./PreviewFrame";
import StudioTour, { type TourStep } from "./StudioTour";
import styles from "./newsletter.module.css";

export type StudioInitial = {
  id: string | null;
  ref: string | null;
  name: string;
  category: NewsletterCategory;
  topic: string | null;
  status: NewsletterStatus;
  isTemplate: boolean;
  blocks: NewsletterBlock[];
  languages: LanguageRow[];
  versions: { id: string; version: number; created_at: string }[];
  templateOriginId: string | null;
  builtInOrigin: string | null;
  createdAt: string | null;
};

export type StudioProps = {
  initial: StudioInitial;
  topics: { key: string; label: string }[];
  templates: { id: string; name: string; category: string }[];
  kit: { companyName: string; primary: string; secondary: string; fontLabel: string; footerAddress: string; hasLogo: boolean };
  canEdit: boolean;
  isAdmin: boolean;
  aiReady: boolean;
  footerAddress: string;
};

type Sec = "startSec" | "blocksSec" | "langSec" | "checkSec" | "brandSec" | "useSec";
const SECTIONS: { id: Sec; tab: string }[] = [
  { id: "startSec", tab: "Start" }, { id: "blocksSec", tab: "Blocks" }, { id: "langSec", tab: "Languages" },
  { id: "checkSec", tab: "Check" }, { id: "brandSec", tab: "Brand" }, { id: "useSec", tab: "Use it" },
];

const snapshot = (d: { name: string; category: string; topic: string | null; blocks: NewsletterBlock[]; languages: LanguageRow[] }) => JSON.stringify(d);

export default function NewsletterStudio(props: StudioProps) {
  const { initial, topics, templates, kit, canEdit, isAdmin, aiReady } = props;
  const router = useRouter();
  const { confirm } = useFeel();

  const [id, setId] = useState<string | null>(initial.id);
  const [name, setName] = useState(initial.name);
  const [category, setCategory] = useState<NewsletterCategory>(initial.category);
  const [topic, setTopic] = useState<string | null>(initial.topic);
  const [doc, setDoc] = useState<Doc>({ blocks: initial.blocks, languages: initial.languages });
  const [lang, setLang] = useState(SOURCE_LANGUAGE);
  const [dev, setDev] = useState<"desktop" | "phone">("desktop");
  const [dark, setDark] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const [open, setOpen] = useState<Sec | null>(initial.id ? "blocksSec" : "startSec");
  const [tab, setTab] = useState<Sec>(initial.id ? "blocksSec" : "startSec");
  const [startMode, setStartMode] = useState<"ai" | "design" | "blank">(initial.id ? "design" : "ai");
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());

  const [brief, setBrief] = useState("");
  const [useProducts, setUseProducts] = useState(true);
  const [useCampaigns, setUseCampaigns] = useState(true);
  const [understood, setUnderstood] = useState<{ text: string; assumed: boolean }[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [rewriting, setRewriting] = useState<string | null>(null);
  const [addingLang, setAddingLang] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toastText, setToastText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [templateForm, setTemplateForm] = useState(false);
  const [tplName, setTplName] = useState("");
  const [tplCategory, setTplCategory] = useState<NewsletterCategory>(initial.category);

  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewing, setPreviewing] = useState(true);
  const [htmlFold, setHtmlFold] = useState<string | null>(null);
  const [savedSnap, setSavedSnap] = useState(() => snapshot({ name: initial.name, category: initial.category, topic: initial.topic, blocks: initial.blocks, languages: initial.languages }));
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rewriteUndo = useRef<{ lang: string; id: string; field: string; value: string } | null>(null);

  const row = doc.languages.find((l) => l.lang === lang) ?? doc.languages[0];
  const activeLang = row?.lang ?? SOURCE_LANGUAGE;
  const sel = doc.blocks.find((b) => b.id === selId) ?? null;
  const dirty = snapshot({ name, category, topic, blocks: doc.blocks, languages: doc.languages }) !== savedSnap;
  const pendingIds = useMemo(() => (row ? doc.blocks.filter((b) => b.visible && row.review[b.id] === "translated").map((b) => b.id) : []), [doc.blocks, row]);

  const toast = useCallback((m: string) => {
    setToastText(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastText(null), 4800);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // The preview is what the server's renderer makes from what is on screen: same gate, same output as a send.
  useEffect(() => {
    let cancelled = false;
    setPreviewing(true);
    const t = setTimeout(async () => {
      const r = await previewNewsletter(doc.blocks, doc.languages, activeLang);
      if (cancelled) return;
      setPreviewing(false);
      if (r.ok) setPreview(r.data);
      else if (!r.pending) setError(r.error);
    }, 280);
    return () => { cancelled = true; clearTimeout(t); };
  }, [doc, activeLang]);

  const checks: Check[] = preview?.checks ?? [];
  const warnings = countWarnings(checks);

  const openSection = useCallback((s: Sec) => { setOpen(s); setTab(s); }, []);
  const toggleSection = (s: Sec) => { if (open === s) setOpen(null); else openSection(s); };

  const body = () => ({
    name: name.trim() || "Untitled newsletter", category, topic, blocks: doc.blocks, languages: doc.languages,
    template_origin_id: initial.templateOriginId, built_in_origin: initial.builtInOrigin,
  });

  /** Saves the whole design. Returns the id, or null when it failed (the error is shown). */
  const save = useCallback(async (quiet = false): Promise<string | null> => {
    if (!canEdit) return id;
    setSaving(true); setError(null);
    const b = { name: name.trim() || "Untitled newsletter", category, topic, blocks: doc.blocks, languages: doc.languages, template_origin_id: initial.templateOriginId, built_in_origin: initial.builtInOrigin };
    const r = id ? await saveNewsletter(id, b) : await createNewsletter(b);
    setSaving(false);
    if (!r.ok) { setError(r.pending ? "The Newsletter Studio is waiting for a database update." : r.error); return null; }
    setSavedSnap(snapshot({ name, category, topic, blocks: doc.blocks, languages: doc.languages }));
    if (!quiet) toast(r.data.warnings.length ? `Saved. ${r.data.warnings[0]}` : "Saved.");
    if (!id) {
      setId(r.data.id);
      router.replace(ROUTES.marketingNewsletter(r.data.id));
    }
    return r.data.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, id, name, category, topic, doc, initial.templateOriginId, initial.builtInOrigin, router, toast]);

  const replaceDesign = useCallback(async (next: { blocks: NewsletterBlock[]; languages: LanguageRow[]; name?: string; category?: NewsletterCategory }) => {
    const pristine = doc.blocks.length <= 2 && !doc.languages.some((l) => l.subject);
    if (!pristine && !(await confirm({ title: "Replace this design?", body: "The blocks and words on screen are replaced. Nothing is lost until you press Save.", confirmLabel: "Replace" }))) return false;
    setDoc({ blocks: next.blocks, languages: next.languages });
    if (next.name && !name.trim()) setName(next.name);
    if (next.category) setCategory(next.category);
    setLang(SOURCE_LANGUAGE); setSelId(null);
    return true;
  }, [confirm, doc, name]);

  async function runDraft() {
    setDrafting(true); setError(null); setUnderstood([]);
    const r = await draftWithAi({ brief, use_products: useProducts, use_campaigns: useCampaigns, topic });
    setDrafting(false);
    if (!r.ok) { setError(r.code === "not_configured" ? "AI is not set up for this workspace. You can still start from a design or a blank page." : r.error); return; }
    const d = r.data;
    const review: LanguageRow["review"] = {};
    d.blocks.forEach((b) => { review[b.id] = "written"; });
    const en: LanguageRow = { lang: SOURCE_LANGUAGE, dir: "ltr", subject: d.subject, preheader: d.preheader, texts: d.texts, review, status: "ready", translated_by: "person" };
    if (!(await replaceDesign({ blocks: d.blocks, languages: [en] }))) return;
    setUnderstood([...d.understood.map((t) => ({ text: t, assumed: false })), ...d.assumed.map((t) => ({ text: t, assumed: true })), ...d.warnings.map((t) => ({ text: t, assumed: true }))]);
    openSection("blocksSec");
    toast("Drafted in English. Nothing is saved until you press Save.");
  }

  async function useBuiltIn(d: BuiltInDesign) {
    const rows = languageRowsOf(d, props.footerAddress);
    if (await replaceDesign({ blocks: d.blocks, languages: rows, name: d.name, category: d.category })) { toast(`${d.name} loaded.`); openSection("blocksSec"); }
  }

  async function useTemplate(tid: string) {
    const r = await loadTemplate(tid);
    if (!r.ok) { setError(r.error); return; }
    if (await replaceDesign({ blocks: r.data.newsletter.blocks, languages: r.data.languages, name: r.data.newsletter.name, category: r.data.newsletter.category as NewsletterCategory })) { toast("Template loaded."); openSection("blocksSec"); }
  }

  async function startBlank() {
    const header: NewsletterBlock = { id: "header1", type: "header", visible: true, locked: true, settings: {} };
    const footer: NewsletterBlock = { id: "footer1", type: "footer", visible: true, locked: true, settings: {} };
    const en: LanguageRow = { lang: SOURCE_LANGUAGE, dir: "ltr", subject: "", preheader: "", texts: { header1: { tag: "" }, footer1: footerTexts(props.footerAddress) }, review: { header1: "written", footer1: "written" }, status: "ready", translated_by: "person" };
    if (await replaceDesign({ blocks: [header, footer], languages: [en] })) toast("A blank design keeps only the brand header and footer.");
  }

  const doEdit = (field: string, value: string) => { if (selId) setDoc((d) => editWords(d, activeLang, selId, field, value)); };

  async function onRewrite(field: string, tone: "shorter" | "warmer" | "formal") {
    if (!selId) return;
    const current = row?.texts[selId]?.[field] ?? "";
    setRewriting(`${field}:${tone}`); setError(null);
    const r = await rewriteWithAi({ text: current, tone, lang: activeLang, field });
    setRewriting(null);
    if (!r.ok) { setError(r.code === "not_configured" ? "AI is not set up for this workspace." : r.error); return; }
    if (!r.data.text) { toast(r.data.message ?? "The rewrite was not usable, so your words were kept."); return; }
    rewriteUndo.current = { lang: activeLang, id: selId, field, value: current };
    setDoc((d) => editWords(d, activeLang, selId, field, r.data.text as string));
    toast("Rewritten by AI. Keep it or edit it. Press Undo rewrite to go back.");
  }

  function undoRewrite() {
    const u = rewriteUndo.current;
    if (!u) return;
    setDoc((d) => editWords(d, u.lang, u.id, u.field, u.value));
    rewriteUndo.current = null;
    toast("Rewrite undone.");
  }

  async function onAddLanguage(code: string, mode: "ai" | "empty") {
    if (!canEdit) return;
    setAddingLang(true); setError(null);
    const savedId = await save(true);
    if (!savedId) { setAddingLang(false); return; }
    const r = await addLanguage(savedId, code, mode);
    setAddingLang(false);
    if (!r.ok) {
      setError(r.code === "not_configured" ? "AI is not set up for this workspace. Use 'I'll write it' to add the language by hand." : r.error);
      return;
    }
    setDoc((d) => ({ ...d, languages: [...d.languages, r.data.language] }));
    setSavedSnap(snapshot({ name, category, topic, blocks: doc.blocks, languages: [...doc.languages, r.data.language] }));
    setLang(code);
    const n = languageDef(code)?.name ?? code;
    toast(mode === "ai"
      ? `${n} added and translated by AI from the English. Check the lines marked in the email.${r.data.kept.length ? ` ${r.data.kept.length} line(s) kept in English because the translation was not usable.` : ""}`
      : `${n} added. Write each block, then press Accept on it.`);
  }

  async function removeLanguage(code: string) {
    if (!(await confirm({ title: `Remove ${languageDef(code)?.name ?? code}?`, body: "Its words are removed when you press Save.", confirmLabel: "Remove", tone: "danger" }))) return;
    setDoc((d) => ({ ...d, languages: d.languages.filter((l) => l.lang !== code) }));
    if (lang === code) setLang(SOURCE_LANGUAGE);
  }

  async function onSaveTemplate() {
    const savedId = await save(true);
    if (!savedId) return;
    const r = await saveAsTemplate(savedId, tplName.trim() || `${name || "Newsletter"} (template)`, tplCategory);
    if (!r.ok) { setError(r.error); return; }
    setTemplateForm(false);
    toast("Saved as a template: it now appears beside the built-in designs when you start a newsletter.");
  }

  async function onUseInCampaign() {
    const savedId = await save(true);
    if (!savedId) return;
    const r = await keepVersion(savedId);
    if (!r.ok) { setError(r.error); return; }
    const waiting = doc.languages.filter((l) => pendingCount(l, doc.blocks) > 0).map((l) => languageDef(l.lang)?.name ?? l.lang);
    toast(`Version ${r.data.version} kept.${waiting.length ? ` ${waiting.join(", ")} still has lines to check, so the campaign can send the other languages until then.` : ""}`);
    router.push(r.data.next);
  }

  async function duplicate() {
    setMenu(false);
    const r = await createNewsletter({ ...body(), name: `${name.trim() || "Newsletter"} (copy)` });
    if (!r.ok) { setError(r.error); return; }
    router.push(ROUTES.marketingNewsletter(r.data.id));
  }

  async function archive() {
    setMenu(false);
    if (!id) return;
    if (!(await confirm({ title: "Archive this newsletter?", body: "It leaves your list. Campaigns that already used it are not affected.", confirmLabel: "Archive" }))) return;
    const r = await saveNewsletter(id, { ...body(), status: "archived" });
    if (!r.ok) { setError(r.error); return; }
    router.push(ROUTES.marketingNewsletters);
  }

  async function remove() {
    setMenu(false);
    if (!id) return;
    if (!(await confirm({ title: "Delete this newsletter?", body: "It is removed for good. If a campaign has used it you will be asked to archive it instead.", confirmLabel: "Delete", tone: "danger" }))) return;
    const r = await deleteNewsletter(id);
    if (!r.ok) { setError(r.error); return; }
    router.push(ROUTES.marketingNewsletters);
  }

  async function loadVersionHtml() {
    const r = await fetch("/api/newsletters/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blocks: doc.blocks, languages: doc.languages, lang: activeLang, target: "version" }) });
    const j = await r.json().catch(() => ({}));
    setHtmlFold(typeof j.html === "string" ? j.html : "The email could not be built.");
    return typeof j.html === "string" ? (j.html as string) : null;
  }

  async function exportHtml() {
    setMenu(false);
    const html = htmlFold ?? (await loadVersionHtml());
    if (!html) return;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${(name || "newsletter").replace(/[^\w-]+/g, "-").toLowerCase()}-${activeLang}.html`; a.click();
    URL.revokeObjectURL(url);
  }

  const tour: TourStep[] = [
    { target: "startSec", text: "Start here. Write one line about this issue and press Write it for me, or pick one of your templates or a built-in design. English comes first.", before: () => openSection("startSec") },
    { target: "nlBlocksList", text: "These are the pieces your newsletter is built from. Drag to reorder, hide what you do not need, add more from the list below.", before: () => openSection("blocksSec") },
    { target: "nlEditor", text: "Click a block to change its words. Rewrite makes it shorter, friendlier or more formal; you keep what you like.", before: () => { openSection("blocksSec"); const b = doc.blocks.find((x) => x.type === "text") ?? doc.blocks[1]; if (b) setSelId(b.id); } },
    { target: "langSec", text: "Add a language on top of the English. AI translates every block and keeps product names and prices as they are.", before: () => { openSection("langSec"); } },
    { target: "nlStage", text: "Check this marks the lines the translation was unsure about. Accept or edit each one; a language can be sent once every line is checked.", before: () => { const other = doc.languages.find((l) => l.lang !== SOURCE_LANGUAGE); if (other) setLang(other.lang); } },
    { target: "nlDevice", text: "See it as a phone or a desktop, light or dark, exactly as it is built for email programs.", before: () => { setDev("phone"); } },
    { target: "nlTemplateBtn", text: "Save as template keeps this design to start from next time, beside the built-in designs.", before: () => { setDev("desktop"); setLang(SOURCE_LANGUAGE); openSection("useSec"); } },
    { target: "nlCampaignBtn", text: "Use in a campaign hands the design to a campaign, which picks the audience and the languages. Each person gets their own.", before: () => openSection("useSec") },
  ];

  const langNames = doc.languages.filter((l) => l.lang !== SOURCE_LANGUAGE).map((l) => languageDef(l.lang)?.name ?? l.lang);
  const statusPill = initial.status === "archived" ? "Archived" : initial.status === "ready" && !dirty ? "Ready" : dirty ? "Unsaved changes" : "Draft";
  const subtitleBits = [
    initial.isTemplate ? "Template" : category,
    langNames.length ? `English + ${langNames.join(", ")}` : "English",
    initial.versions.length ? `${initial.versions.length} version${initial.versions.length > 1 ? "s" : ""} kept` : "not yet used in a campaign",
  ];

  const useActions = (
    <>
      <Button className={styles.useBtn} disabled={!canEdit || saving} loading={saving} onClick={() => void save()}>Save</Button>
      <p className={styles.hint}>Keeps your work. Nothing is sent.</p>
      {!templateForm ? (
        <Button id="nlTemplateBtn" disabled={!canEdit} onClick={() => { setTplName(`${name || "Newsletter"} (template)`); setTemplateForm(true); }}>Save as template</Button>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          <label className={styles.lbl} htmlFor="tplName">Template name</label>
          <input id="tplName" className={styles.field} value={tplName} maxLength={120} onChange={(e) => setTplName(e.target.value)} />
          <label className={styles.lbl} htmlFor="tplCat">Category</label>
          <select id="tplCat" className={styles.select} value={tplCategory} onChange={(e) => setTplCategory(e.target.value as NewsletterCategory)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          <div className={styles.row}><Button variant="primary" size="sm" onClick={() => void onSaveTemplate()}>Save template</Button><Button size="sm" onClick={() => setTemplateForm(false)}>Cancel</Button></div>
        </div>
      )}
      <p className={styles.hint}>Keeps this design to start from next time, beside the built-in designs.</p>
      {!initial.isTemplate && (
        <>
          <Button id="nlCampaignBtn" variant="primary" className={styles.useBtn} disabled={!canEdit || saving} onClick={() => void onUseInCampaign()}>Use in a campaign</Button>
          <p className={styles.hint}>A campaign (or a journey step) picks the audience and the languages. Each person gets their own language; sending follows the usual consent and unsubscribe rules.</p>
        </>
      )}
    </>
  );

  return (
    <div className={styles.accent}>
      <PageHeader
        title={name || (initial.id ? "Newsletter" : "New newsletter")}
        subtitle={subtitleBits.join(" · ")}
        badge={<span className={cx(styles.pill, initial.status === "ready" && !dirty && styles.ready, initial.status === "archived" && styles.archived)}>{statusPill}</span>}
        action={
          <span className={styles.headRow}>
            <StudioTour steps={tour} />
            <span className={styles.menu}>
              <Button aria-haspopup="true" aria-expanded={menu} aria-label="More" onClick={() => setMenu((m) => !m)}>⋯</Button>
              {menu && (
                <ul role="menu">
                  <li><button type="button" role="menuitem" disabled={!canEdit} onClick={() => void duplicate()}>Duplicate</button></li>
                  <li><button type="button" role="menuitem" onClick={() => { setMenu(false); document.getElementById("nlVersions")?.setAttribute("open", ""); document.getElementById("nlVersions")?.scrollIntoView({ block: "center" }); }}>Versions</button></li>
                  <li><button type="button" role="menuitem" onClick={() => void exportHtml()}>Export the email HTML</button></li>
                  {id && <li><button type="button" role="menuitem" disabled={!canEdit} onClick={() => void archive()}>Archive</button></li>}
                  {id && <li><button type="button" role="menuitem" disabled={!canEdit} onClick={() => void remove()}>Delete</button></li>}
                </ul>
              )}
            </span>
          </span>
        }
      />

      {!canEdit && <div className={cx(styles.banner, styles.info)}>You can look at this newsletter but not change it.</div>}
      {error && <div className={styles.err} role="alert">{error}</div>}

      <div className={styles.studio}>
        <div className={styles.panel}>
          <div className={styles.ptabs} role="tablist" aria-label="Options">
            {SECTIONS.map((s) => <button key={s.id} type="button" role="tab" aria-selected={tab === s.id} className={cx(styles.ptab, tab === s.id && styles.on)} onClick={() => openSection(s.id)}>{s.tab}</button>)}
          </div>

          <Group id="startSec" title="Start" summary={initial.id ? "Details" : startMode === "ai" ? "Write it for me" : startMode === "design" ? "A design" : "Blank"} hint="How to begin: say what this issue is about, pick a design, or start blank." open={open === "startSec"} on={tab === "startSec"} onToggle={() => toggleSection("startSec")}>
            <div>
              <label className={styles.lbl} htmlFor="nlName">Name (only your team sees it)</label>
              <input id="nlName" className={styles.nameInput} value={name} maxLength={120} disabled={!canEdit} placeholder="e.g. October update" onChange={(e) => setName(e.target.value)} />
            </div>
            <div className={styles.row}>
              <div style={{ flex: "1 1 120px" }}>
                <label className={styles.lbl} htmlFor="nlCat">Category</label>
                <select id="nlCat" className={styles.select} value={category} disabled={!canEdit} onChange={(e) => setCategory(e.target.value as NewsletterCategory)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
              </div>
              <div style={{ flex: "1 1 120px" }}>
                <label className={styles.lbl} htmlFor="nlTopic">Topic</label>
                <select id="nlTopic" className={styles.select} value={topic ?? ""} disabled={!canEdit} onChange={(e) => setTopic(e.target.value || null)}>
                  <option value="">No one topic</option>
                  {topics.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </div>
            </div>
            <p className={styles.hint}>The topic decides which answers people gave about what they want to hear from you; it is checked for each person when you send.</p>
            <div className={styles.starts}>
              <button type="button" className={cx(styles.start, startMode === "ai" && styles.sel)} onClick={() => setStartMode("ai")}><b>Write it for me</b><span>AI drafts the blocks from one line and your catalogue. You review every block.</span></button>
              <button type="button" className={cx(styles.start, startMode === "design" && styles.sel)} onClick={() => setStartMode("design")}><b>Start from a design</b><span>Your saved templates and the built-in designs.</span></button>
              <button type="button" className={cx(styles.start, startMode === "blank" && styles.sel)} onClick={() => { setStartMode("blank"); if (canEdit) void startBlank(); }}><b>Blank</b><span>Brand header and footer only.</span></button>
            </div>
            {startMode === "ai" && (
              <div style={{ display: "grid", gap: 6 }}>
                <label className={styles.lbl} htmlFor="nlBrief">What is this newsletter about?</label>
                <textarea id="nlBrief" className={styles.field} value={brief} disabled={!canEdit} placeholder="New product range in stock. The warehouse opens on Saturdays. 10% off until the end of the month." onChange={(e) => setBrief(e.target.value)} />
                <label className={styles.chk}><input type="checkbox" checked={useProducts} onChange={(e) => setUseProducts(e.target.checked)} /> Use my recent products</label>
                <label className={styles.chk}><input type="checkbox" checked={useCampaigns} onChange={(e) => setUseCampaigns(e.target.checked)} /> Use my recent campaigns</label>
                <div className={styles.row}>
                  <Button variant="primary" loading={drafting} disabled={!canEdit || !aiReady || drafting || brief.trim().length < 10} onClick={() => void runDraft()}>Write it for me</Button>
                  <span className={styles.help}>{aiReady ? "In English first. Nothing is saved until you press Save." : "AI is not set up for this workspace."}</span>
                </div>
                <div className={styles.chips} aria-live="polite">
                  {drafting && <><div className={styles.skel} style={{ width: "60%" }} /><div className={styles.skel} style={{ width: "40%" }} /></>}
                  {understood.map((u, i) => <span key={i} className={cx(styles.chip, u.assumed && styles.a)}>{u.text}</span>)}
                </div>
              </div>
            )}
            {startMode === "design" && (
              <div style={{ display: "grid", gap: 8 }}>
                <p className={styles.hint}>Pick one; its blocks and words come in and you change what you like.</p>
                {templates.length > 0 && (
                  <div>
                    <div className={styles.lbl}>My templates ({templates.length})</div>
                    <div className={styles.chips}>{templates.map((t) => <button key={t.id} type="button" className={cx(styles.chip, styles.n)} style={{ border: 0, cursor: "pointer" }} disabled={!canEdit} onClick={() => void useTemplate(t.id)}>{t.name}</button>)}</div>
                  </div>
                )}
                <div>
                  <div className={styles.lbl}>Built-in designs</div>
                  <div className={styles.chips}>{BUILT_IN_DESIGNS.filter((d) => d.id !== "blank").map((d) => <button key={d.id} type="button" className={cx(styles.chip, styles.n)} style={{ border: 0, cursor: "pointer" }} disabled={!canEdit} onClick={() => void useBuiltIn(d)}>{d.name}</button>)}</div>
                </div>
              </div>
            )}
          </Group>

          <Group id="blocksSec" title="Blocks" summary={`${doc.blocks.filter((b) => b.visible).length} blocks`} hint="The pieces your newsletter is built from. Click one to change its words; drag to reorder." open={open === "blocksSec"} on={tab === "blocksSec"} onToggle={() => toggleSection("blocksSec")}>
            <BlockList
              blocks={doc.blocks} row={row} selId={selId} canEdit={canEdit}
              onSelect={(bid) => { setSelId(bid); openSection("blocksSec"); }}
              onToggle={(bid) => setDoc((d) => toggleBlock(d, bid))}
              onMove={(bid, dir) => setDoc((d) => moveBlock(d, bid, dir))}
              onRemove={(bid) => { setDoc((d) => removeBlock(d, bid)); if (selId === bid) setSelId(null); }}
              onDropOn={(a, b) => setDoc((d) => moveBlockTo(d, a, b))}
            />
            {canEdit && (
              <div className={styles.add}>
                <span className={styles.help} style={{ alignSelf: "center" }}>Add:</span>
                {ADDABLE_BLOCKS.map((t) => (
                  <button key={t} type="button" onClick={() => { const r = addBlock(doc, t); setDoc(r.doc); setSelId(r.id); toast(`${BLOCK_LABEL[t]} added${doc.languages.length > 1 ? ". The other languages need a check." : "."}`); }}>{BLOCK_LABEL[t]}</button>
                ))}
              </div>
            )}
            <p className={styles.hint}>Header and footer carry your brand and the unsubscribe line, so they stay in every design.</p>
            {sel && row && (
              <BlockEditor
                block={sel} row={row} lang={activeLang} canEdit={canEdit} isAdmin={isAdmin} unlocked={unlocked.has(sel.id)}
                onUnlock={() => setUnlocked((u) => new Set(u).add(sel.id))}
                onWords={doEdit}
                onSetting={(k, v) => setDoc((d) => setSetting(d, sel.id, k, v))}
                onRewrite={(f, t) => void onRewrite(f, t)} rewriting={rewriting} aiReady={aiReady} onError={setError}
              />
            )}
            {rewriteUndo.current && <div><Button size="sm" onClick={undoRewrite}>Undo rewrite</Button></div>}
          </Group>

          <Group id="langSec" title="Languages" summary={langNames.length ? `English + ${langNames.join(", ")}` : "English only"} hint="English is written first. Add a language on top and each person gets their own." open={open === "langSec"} on={tab === "langSec"} onToggle={() => toggleSection("langSec")}>
            <LanguageRows blocks={doc.blocks} languages={doc.languages} canEdit={canEdit} onRemove={(l) => void removeLanguage(l)} />
            <AddLanguage present={doc.languages.map((l) => l.lang)} busy={addingLang} canEdit={canEdit} aiReady={aiReady} onAdd={(c, m) => void onAddLanguage(c, m)} />
            <p className={styles.hint}>AI translates every block and keeps product names and prices as they are. Lines it was unsure about show &quot;Check this&quot; in the email until you accept or edit them.</p>
            <p className={styles.hint}>Who gets which: the contact&apos;s preferred language, then the account&apos;s, then English.</p>
          </Group>

          <Group id="checkSec" title="Check before sending" summary={warnings ? `${warnings} to fix` : checks.length ? "All clear" : "…"} hint="Rules that run every time, not opinions. Fix the amber ones." open={open === "checkSec"} on={tab === "checkSec"} onToggle={() => toggleSection("checkSec")}>
            <CheckChips checks={checks} loading={previewing} />
          </Group>

          <Group id="brandSec" title="Brand kit" summary={kit.companyName} hint="Your logo, colours and fonts, set once by an admin and used by every design." open={open === "brandSec"} on={tab === "brandSec"} onToggle={() => toggleSection("brandSec")}>
            <div className={styles.kit}>
              <div><b>Logo</b>{kit.hasLogo ? "Your logo" : "No logo yet; the company name is used"}</div>
              <div><b>Colours</b><span className={styles.sw} style={{ background: kit.primary }} />Main <span className={styles.sw} style={{ background: kit.secondary, marginInlineStart: 8 }} />Accent</div>
              <div><b>Fonts that survive email</b>{kit.fontLabel}</div>
              <div><b>Footer</b>{kit.footerAddress || "No address yet"}</div>
            </div>
            <p className={styles.hint}>{isAdmin ? <Link href={ROUTES.settingsBrandKit}>Change it in Settings, Brand kit.</Link> : "An admin changes it in Settings, Brand kit."}</p>
          </Group>

          <Group id="useSec" title="Use it" summary="Save · Campaign" hint="Keep this design, or hand it to a campaign." open={open === "useSec"} on={tab === "useSec"} onToggle={() => toggleSection("useSec")}>
            <div className={styles.use}>{useActions}</div>
          </Group>
        </div>

        <div className={styles.canvas} id="nlCanvas">
          <div className={styles.tools}>
            <div className={styles.tabs} role="tablist" aria-label="Language">
              {doc.languages.map((l) => {
                const n = pendingCount(l, doc.blocks);
                return (
                  <button key={l.lang} type="button" role="tab" aria-selected={activeLang === l.lang} className={cx(styles.tab, activeLang === l.lang && styles.on)} onClick={() => setLang(l.lang)} lang={l.lang}>
                    {languageDef(l.lang)?.native ?? l.lang}{n ? <span className={styles.b}>{n}</span> : null}
                  </button>
                );
              })}
              <button type="button" className={styles.tab} onClick={() => { openSection("langSec"); setTimeout(() => document.getElementById("nlLangPick")?.focus(), 60); }}>+ Add language</button>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} id="nlDevice">
              <div className={styles.tabs} aria-label="Device">
                <button type="button" className={cx(styles.tab, dev === "desktop" && styles.on)} onClick={() => setDev("desktop")}>Desktop</button>
                <button type="button" className={cx(styles.tab, dev === "phone" && styles.on)} onClick={() => setDev("phone")}>Phone</button>
              </div>
              <div className={styles.tabs} aria-label="Appearance">
                <button type="button" className={cx(styles.tab, !dark && styles.on)} onClick={() => setDark(false)}>Light</button>
                <button type="button" className={cx(styles.tab, dark && styles.on)} onClick={() => setDark(true)}>Dark</button>
              </div>
            </div>
          </div>

          {row && (
            <div className={styles.subj}>
              <label>Subject
                <input className={styles.field} value={row.subject} dir={row.dir} lang={row.lang} disabled={!canEdit} maxLength={200} onChange={(e) => setDoc((d) => setHeading(d, activeLang, "subject", e.target.value))} />
              </label>
              <label>Preheader (the preview line after the subject)
                <input className={styles.field} value={row.preheader} dir={row.dir} lang={row.lang} disabled={!canEdit} maxLength={200} onChange={(e) => setDoc((d) => setHeading(d, activeLang, "preheader", e.target.value))} />
              </label>
            </div>
          )}

          {pendingIds.length > 1 && canEdit && <div><Button size="sm" onClick={() => setDoc((d) => acceptAll(d, activeLang))}>Accept all {pendingIds.length} lines in {languageDef(activeLang)?.name ?? activeLang}</Button></div>}

          <div id="nlStage">
            <PreviewFrame
              html={preview?.html ?? "<!doctype html><html><body></body></html>"} dark={dark} phone={dev === "phone"} rtl={directionOf(activeLang) === "rtl"}
              selectedId={selId} pendingIds={pendingIds} loading={previewing}
              onSelect={(bid) => { setSelId(bid); openSection("blocksSec"); }}
              onAccept={(bid) => { setDoc((d) => acceptBlock(d, activeLang, bid)); toast("Accepted."); }}
              onEdit={(bid) => { setSelId(bid); openSection("blocksSec"); setTimeout(() => document.getElementById("nlEditor")?.scrollIntoView({ block: "center", behavior: "smooth" }), 80); }}
            />
          </div>
          <p className={styles.hint}>Shown exactly as it is built for email programs: tables, plain fonts, no scripts. Phone and Dark show what a small screen or a program that inverts colours does with it.</p>
        </div>
      </div>

      <details className={styles.fold} id="nlVersions">
        <summary>Versions <small>what a campaign actually sent</small></summary>
        <div className={styles.foldIn}>
          {initial.versions.length === 0
            ? <p className={styles.note}>No versions yet. &quot;Use in a campaign&quot; keeps a copy of this design, so editing it later never changes a campaign that already went out.</p>
            : initial.versions.map((v) => <p key={v.id} className={styles.note}>Version {v.version} · kept {new Date(v.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>)}
        </div>
      </details>
      <details className={styles.fold} onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open && htmlFold === null) void loadVersionHtml(); }}>
        <summary>Email HTML <small>for your IT team</small></summary>
        <div className={styles.foldIn}>
          <pre className={styles.pre}>{htmlFold ?? "Open to build it."}</pre>
          <p className={styles.note}>Generated by the renderer from the blocks. Every text is escaped; links are checked; nothing you type is sent as HTML. Fields replaced for each person show as {"{{…}}"}.</p>
        </div>
      </details>
      <details className={styles.fold}>
        <summary>Details <small>reference, status, your own fields</small></summary>
        <div className={styles.foldIn}>
          <p className={styles.note}>{[initial.ref, statusPill, `Category: ${category}`, initial.createdAt ? `Created ${new Date(initial.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}` : null].filter(Boolean).join(" · ") || "Not saved yet."}</p>
        </div>
      </details>

      <div className={styles.bar}>
        <Button disabled={!canEdit || saving} loading={saving} onClick={() => void save()}>Save</Button>
        {!initial.isTemplate && <Button variant="primary" disabled={!canEdit || saving} onClick={() => void onUseInCampaign()}>Use in a campaign</Button>}
      </div>
      {toastText && <div className={styles.toast} role="status">{toastText}</div>}
    </div>
  );
}
