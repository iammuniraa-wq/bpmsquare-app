"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import MoreMenu, { type MenuItem } from "@/components/ui/MoreMenu";
import OptionGroup from "@/components/ui/OptionGroup";
import { Opt } from "@/components/ui/Opt";
import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import { useFeel } from "@/components/FeelProvider";
import { BUILT_IN_DESIGNS, languageRowsOf, footerTexts, type BuiltInDesign } from "@/lib/newsletter/designs";
import { countWarnings, type Check } from "@/lib/newsletter/checks";
import {
  acceptAll, acceptBlock, addBlock, editWords, moveBlock, moveBlockTo, pendingCount, removeBlock, setHeading, setSetting, toggleBlock, type Doc,
} from "@/lib/newsletter/studioState";
import { NEWSLETTER_TIPS } from "@/lib/newsletter/tips";
import {
  ADDABLE_BLOCKS, BLOCK_LABEL, CATEGORIES, SOURCE_LANGUAGE, directionOf, languageDef,
  type LanguageRow, type NewsletterBlock, type NewsletterCategory, type NewsletterStatus,
} from "@/lib/newsletter/types";
import { ROUTES } from "@/lib/constants";
import {
  addLanguage, createNewsletter, deleteNewsletter, draftWithAi, loadTemplate, previewNewsletter, rewriteWithAi, saveAsTemplate, saveNewsletter,
  type PreviewData,
} from "./studioApi";
import { AddLanguage, BlockEditor, BlockList, CheckChips, LanguageRows, cx } from "./panels";
import PreviewFrame from "./PreviewFrame";
import SendPanel from "./SendPanel";
import LanguageCompare from "./LanguageCompare";
import Tour, { type TourStep } from "@/components/marketing/Tour";
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

type Sec = "startSec" | "blocksSec" | "langSec" | "checkSec";
const SECTIONS: { id: Sec; tab: string }[] = [
  { id: "startSec", tab: "Start" }, { id: "blocksSec", tab: "Blocks" }, { id: "langSec", tab: "Languages" }, { id: "checkSec", tab: "Health" },
];
const SECTION_IDS = SECTIONS.map((s) => s.id);

/** A card under the header that a ⋯ menu item opens: Save as template, Versions, Email HTML. One at a time. */
type UtilityCard = "template" | "versions" | "html";

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
  const [view, setView] = useState<"email" | "compare">("email");
  const [cmpRight, setCmpRight] = useState("");
  const [selId, setSelId] = useState<string | null>(null);
  // `tab` is the group the phone's strip has selected and lives in ?panel=; `open` is the group expanded on a wide screen.
  const [tabId, setTab] = useUrlTab(SECTION_IDS, "panel", initial.id ? "blocksSec" : "startSec");
  const tab = tabId as Sec;
  const [open, setOpen] = useState<Sec | null>(tab);
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
  const [card, setCard] = useState<UtilityCard | null>(null);
  const [tplName, setTplName] = useState("");
  const [tplCategory, setTplCategory] = useState<NewsletterCategory>(initial.category);
  const [sendOpen, setSendOpen] = useState(false);

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

  const openSection = useCallback((s: Sec) => { setOpen(s); setTab(s); }, [setTab]);
  const toggleSection = (s: Sec) => { if (open === s) setOpen(null); else openSection(s); };

  const body = () => ({
    name: name.trim() || "Untitled newsletter", category, topic, blocks: doc.blocks, languages: doc.languages,
    template_origin_id: initial.templateOriginId, built_in_origin: initial.builtInOrigin,
  });

  /**
   * Saves the whole design. Returns the id, or null when it failed (the error is shown). A first save moves
   * the page to the new newsletter's address unless the caller is about to do more (add a language, hand
   * over to a campaign): moving the page earlier would reload the screen from the database in the middle
   * of that work, so those callers move it themselves when they are done.
   */
  const save = useCallback(async (quiet = false, move = true): Promise<string | null> => {
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
      if (move) router.replace(ROUTES.marketingNewsletter(r.data.id));
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
    const savedId = await save(true, false);
    if (!savedId) { setAddingLang(false); return; }
    const r = await addLanguage(savedId, code, mode);
    setAddingLang(false);
    if (!id) router.replace(ROUTES.marketingNewsletter(savedId));
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
    const savedId = await save(true, false);
    if (!savedId) return;
    const r = await saveAsTemplate(savedId, tplName.trim() || `${name || "Newsletter"} (template)`, tplCategory);
    if (!id) router.replace(ROUTES.marketingNewsletter(savedId));
    if (!r.ok) { setError(r.error); return; }
    setCard(null);
    toast("Saved as a template: it now appears beside the built-in designs when you start a newsletter.");
  }

  /** The panel sends what is saved, so the design is saved first. A first save does not move the page yet: that would remount the screen under the open panel. */
  async function openSend() {
    if (!(await save(true, false))) return;
    setSendOpen(true);
  }

  function closeSend() {
    setSendOpen(false);
    if (!initial.id && id) router.replace(ROUTES.marketingNewsletter(id));
  }

  async function duplicate() {
    const r = await createNewsletter({ ...body(), name: `${name.trim() || "Newsletter"} (copy)` });
    if (!r.ok) { setError(r.error); return; }
    router.push(ROUTES.marketingNewsletter(r.data.id));
  }

  async function archive() {
    if (!id) return;
    if (!(await confirm({ title: "Archive this newsletter?", body: "It leaves your list. Campaigns that already used it are not affected.", confirmLabel: "Archive" }))) return;
    const r = await saveNewsletter(id, { ...body(), status: "archived" });
    if (!r.ok) { setError(r.error); return; }
    router.push(ROUTES.marketingNewsletters);
  }

  async function remove() {
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
    { target: "nlHeadActions", text: "In the ⋯ menu, Save as template keeps this design to start from next time, beside the built-in designs. Versions and the email HTML are there too.", before: () => { setDev("desktop"); setLang(SOURCE_LANGUAGE); } },
    { target: "nlHeadActions", text: "Send opens one panel: pick who gets it and send. Each person gets their own language, and only people who agreed to this topic are emailed. On a phone it is the button at the bottom.", before: () => { setCard(null); } },
  ];

  const langNames = doc.languages.filter((l) => l.lang !== SOURCE_LANGUAGE).map((l) => languageDef(l.lang)?.name ?? l.lang);
  const statusPill = initial.status === "archived" ? "Archived" : initial.status === "ready" && !dirty ? "Ready to use" : dirty ? "Unsaved changes" : "Draft";
  const subtitleBits = [
    initial.isTemplate ? "Template" : category,
    langNames.length ? `English + ${langNames.join(", ")}` : "English",
    initial.versions.length ? `${initial.versions.length} version${initial.versions.length > 1 ? "s" : ""}` : "never sent",
  ];

  const menuItems: MenuItem[] = [
    { label: "Duplicate", hidden: !canEdit, onSelect: () => void duplicate() },
    { label: "Save as template", hidden: !canEdit, onSelect: () => { setTplName(`${name || "Newsletter"} (template)`); setCard("template"); } },
    { label: "Versions", onSelect: () => setCard("versions") },
    { label: "Email HTML", onSelect: () => { setCard("html"); if (htmlFold === null) void loadVersionHtml(); } },
    { label: "Export HTML", onSelect: () => void exportHtml() },
    { label: "Brand kit", hidden: !isAdmin, href: ROUTES.settingsBrandKit },
    { label: "Archive", hidden: !id || !canEdit, onSelect: () => void archive() },
    { label: "Delete", danger: true, hidden: !id || !canEdit, onSelect: () => void remove() },
  ];

  return (
    <div className={styles.accent}>
      <PageHeader
        title={name || (initial.id ? "Newsletter" : "New newsletter")}
        subtitle={subtitleBits.join(" · ")}
        badge={<span className={cx(styles.pill, initial.status === "ready" && !dirty && styles.ready, initial.status === "archived" && styles.archived)}>{statusPill}</span>}
        action={
          <span className={styles.headRow} id="nlHeadActions">
            <Tour steps={tour} storageKey="bpm.newsletter.tour.step" buttonId="nlTourBtn" />
            <span className={styles.headBtns}>
              <Button variant={initial.isTemplate ? "primary" : undefined} disabled={!canEdit || saving} loading={saving} onClick={() => void save()}>Save</Button>
              {!initial.isTemplate && <Button id="nlCampaignBtn" variant="primary" disabled={!canEdit || saving} onClick={() => void openSend()}>Send...</Button>}
            </span>
            <MoreMenu items={menuItems} />
          </span>
        }
      />

      {!canEdit && <div className={cx(styles.banner, styles.info)}>You can look at this newsletter but not change it.</div>}
      {error && <div className={styles.err} role="alert">{error}</div>}

      {card === "template" && (
        <div className={styles.utility}>
          <div className={styles.utilHead}><b>Save as template</b></div>
          <div className={styles.row}>
            <div style={{ flex: "2 1 200px" }}>
              <label className={styles.lbl} htmlFor="tplName">Template name</label>
              <input id="tplName" className={styles.field} value={tplName} maxLength={120} onChange={(e) => setTplName(e.target.value)} />
            </div>
            <div style={{ flex: "1 1 140px" }}>
              <label className={styles.lbl} htmlFor="tplCat">Category</label>
              <select id="tplCat" className={styles.select} value={tplCategory} onChange={(e) => setTplCategory(e.target.value as NewsletterCategory)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
            </div>
          </div>
          <div className={styles.row}><Button variant="primary" size="sm" onClick={() => void onSaveTemplate()}>Save template</Button><Button size="sm" onClick={() => setCard(null)}>Cancel</Button></div>
        </div>
      )}
      {card === "versions" && (
        <div className={styles.utility}>
          <div className={styles.utilHead}><b>Versions</b><Button size="sm" variant="quiet" onClick={() => setCard(null)}>Close</Button></div>
          {initial.versions.length === 0
            ? <p className={styles.note}>No versions yet. One is kept each time you send.</p>
            : initial.versions.map((v) => <p key={v.id} className={styles.note}>Version {v.version} · {new Date(v.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>)}
        </div>
      )}
      {card === "html" && (
        <div className={styles.utility}>
          <div className={styles.utilHead}>
            <span className="bpm-label-row"><b>Email HTML</b><InfoTip label="Email HTML">{NEWSLETTER_TIPS.html}</InfoTip></span>
            <Button size="sm" variant="quiet" onClick={() => setCard(null)}>Close</Button>
          </div>
          <pre className={styles.pre}>{htmlFold ?? "Building it…"}</pre>
        </div>
      )}

      <div className={styles.studio}>
        <div className={cx(styles.panel, "bpm-og-panel")}>
          <div className={styles.ptabsWrap}>
            <Tabs tabs={SECTIONS.map((s) => ({ id: s.id, label: s.tab, count: s.id === "checkSec" ? warnings : undefined }))} value={tab} onChange={(t) => openSection(t as Sec)} label="Options" />
          </div>

          <OptionGroup id="startSec" title="Start" info={NEWSLETTER_TIPS.start} summary={initial.id ? "Details" : startMode === "ai" ? "Write it for me" : startMode === "design" ? "A design" : "Blank"} open={open === "startSec"} on={tab === "startSec"} onToggle={() => toggleSection("startSec")}>
            <Opt label="Name" info={NEWSLETTER_TIPS.name} htmlFor="nlName">
              <input id="nlName" className={styles.nameInput} value={name} maxLength={120} disabled={!canEdit} placeholder="e.g. October update" onChange={(e) => setName(e.target.value)} />
            </Opt>
            <div className={styles.row}>
              <div style={{ flex: "1 1 120px" }}>
                <Opt label="Category" htmlFor="nlCat">
                  <select id="nlCat" className={styles.select} value={category} disabled={!canEdit} onChange={(e) => setCategory(e.target.value as NewsletterCategory)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
                </Opt>
              </div>
              <div style={{ flex: "1 1 220px" }}>
                <Opt label="Consent topic" info={NEWSLETTER_TIPS.consentTopic} htmlFor="nlTopic">
                  <select id="nlTopic" className={styles.select} value={topic ?? ""} disabled={!canEdit} onChange={(e) => setTopic(e.target.value || null)}>
                    <option value="">Any consent topic</option>
                    {topics.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                </Opt>
              </div>
            </div>
            <div className={styles.starts}>
              <button type="button" className={cx(styles.start, startMode === "ai" && styles.sel)} onClick={() => setStartMode("ai")}><b>Write it for me</b><span>AI drafts it from one line</span></button>
              <button type="button" className={cx(styles.start, startMode === "design" && styles.sel)} onClick={() => setStartMode("design")}><b>Start from a design</b><span>Your templates and built-in designs</span></button>
              <button type="button" className={cx(styles.start, startMode === "blank" && styles.sel)} onClick={() => { setStartMode("blank"); if (canEdit) void startBlank(); }}><b>Blank</b><span>Header and footer only</span></button>
            </div>
            {startMode === "ai" && (
              <div style={{ display: "grid", gap: 6 }}>
                <label className={styles.lbl} htmlFor="nlBrief">What is this newsletter about?</label>
                <textarea id="nlBrief" className={styles.field} value={brief} disabled={!canEdit} placeholder="New product range in stock. The warehouse opens on Saturdays. 10% off until the end of the month." onChange={(e) => setBrief(e.target.value)} />
                <label className={styles.chk}><input type="checkbox" checked={useProducts} onChange={(e) => setUseProducts(e.target.checked)} /> Use my recent products</label>
                <label className={styles.chk}><input type="checkbox" checked={useCampaigns} onChange={(e) => setUseCampaigns(e.target.checked)} /> Use my recent campaigns</label>
                <div className={styles.row}>
                  <Button variant="primary" loading={drafting} disabled={!canEdit || !aiReady || drafting || brief.trim().length < 10} onClick={() => void runDraft()}>Write it for me</Button>
                  {!aiReady && <span className={styles.help}>AI is not set up for this workspace.</span>}
                </div>
                <div className={styles.chips} aria-live="polite">
                  {drafting && <><div className={styles.skel} style={{ width: "60%" }} /><div className={styles.skel} style={{ width: "40%" }} /></>}
                  {understood.map((u, i) => <span key={i} className={cx(styles.chip, u.assumed && styles.a)}>{u.text}</span>)}
                </div>
              </div>
            )}
            {startMode === "design" && (
              <div style={{ display: "grid", gap: 8 }}>
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
            <div className={cx("bpm-label-row", styles.fact)}>
              <b>Brand:</b>&nbsp;{kit.companyName}
              <InfoTip label="Brand">{NEWSLETTER_TIPS.brand}</InfoTip>
              {isAdmin && <Link href={ROUTES.settingsBrandKit} className={styles.factLink}>Change</Link>}
            </div>
          </OptionGroup>

          <OptionGroup id="blocksSec" title="Blocks" info={NEWSLETTER_TIPS.blocks} summary={`${doc.blocks.filter((b) => b.visible).length} blocks`} open={open === "blocksSec"} on={tab === "blocksSec"} onToggle={() => toggleSection("blocksSec")}>
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
          </OptionGroup>

          <OptionGroup id="langSec" title="Languages" info={NEWSLETTER_TIPS.languages} summary={langNames.length ? `English + ${langNames.join(", ")}` : "English only"} open={open === "langSec"} on={tab === "langSec"} onToggle={() => toggleSection("langSec")}>
            <LanguageRows blocks={doc.blocks} languages={doc.languages} canEdit={canEdit} onRemove={(l) => void removeLanguage(l)} />
            <AddLanguage present={doc.languages.map((l) => l.lang)} busy={addingLang} canEdit={canEdit} aiReady={aiReady} onAdd={(c, m) => void onAddLanguage(c, m)} />
          </OptionGroup>

          <OptionGroup id="checkSec" title="Health" info={NEWSLETTER_TIPS.health} summary={warnings ? `${warnings} to fix` : checks.length ? "All clear" : "…"} open={open === "checkSec"} on={tab === "checkSec"} onToggle={() => toggleSection("checkSec")}>
            <CheckChips checks={checks} loading={previewing} />
          </OptionGroup>
        </div>

        <div className={styles.canvas} id="nlCanvas">
          {doc.languages.length > 1 && (
            <div className={styles.tabs} role="tablist" aria-label="View">
              <button type="button" role="tab" aria-selected={view === "email"} className={cx(styles.tab, view === "email" && styles.on)} onClick={() => setView("email")}>The email</button>
              <button type="button" role="tab" aria-selected={view === "compare"} className={cx(styles.tab, view === "compare" && styles.on)} onClick={() => setView("compare")}>Compare languages</button>
            </div>
          )}
          {view === "compare" && doc.languages.length > 1 ? (
            <LanguageCompare
              blocks={doc.blocks} languages={doc.languages} left={activeLang}
              right={doc.languages.some((l) => l.lang === cmpRight && l.lang !== activeLang) ? cmpRight : (doc.languages.find((l) => l.lang !== activeLang)?.lang ?? activeLang)}
              onPick={(side, l) => { if (side === "left") setLang(l); else setCmpRight(l); }}
              canEdit={canEdit}
              onAccept={(l, bid) => { setDoc((d) => acceptBlock(d, l, bid)); toast("Accepted."); }}
              onEdit={(l, bid) => { setLang(l); setView("email"); setSelId(bid); openSection("blocksSec"); }}
            />
          ) : (<>
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
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }} id="nlDevice">
              <span className="bpm-label-row"><span className={styles.lbl}>Preview</span><InfoTip label="Preview">{NEWSLETTER_TIPS.preview}</InfoTip></span>
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
              <div>
                <label htmlFor="nlSubject">Subject</label>
                <input id="nlSubject" className={styles.field} value={row.subject} dir={row.dir} lang={row.lang} disabled={!canEdit} maxLength={200} onChange={(e) => setDoc((d) => setHeading(d, activeLang, "subject", e.target.value))} />
              </div>
              <div>
                <span className="bpm-label-row"><label htmlFor="nlPreheader">Preheader</label><InfoTip label="Preheader">{NEWSLETTER_TIPS.preheader}</InfoTip></span>
                <input id="nlPreheader" className={styles.field} value={row.preheader} dir={row.dir} lang={row.lang} disabled={!canEdit} maxLength={200} onChange={(e) => setDoc((d) => setHeading(d, activeLang, "preheader", e.target.value))} />
              </div>
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
          </>)}
        </div>
      </div>

      <div className={styles.bar}>
        <Button disabled={!canEdit || saving} loading={saving} onClick={() => void save()}>Save</Button>
        {!initial.isTemplate && <Button variant="primary" disabled={!canEdit || saving} onClick={() => void openSend()}>Send...</Button>}
      </div>
      {sendOpen && id && (
        <SendPanel
          newsletterId={id} name={name} onClose={closeSend} onSent={() => router.refresh()}
          topicLabel={topics.find((t) => t.key === topic)?.label ?? "Any topic"}
          languageNames={doc.languages.map((l) => languageDef(l.lang)?.name ?? l.lang)}
          waiting={doc.languages.filter((l) => pendingCount(l, doc.blocks) > 0).map((l) => languageDef(l.lang)?.name ?? l.lang)}
        />
      )}
      {toastText && <div className={styles.toast} role="status">{toastText}</div>}
    </div>
  );
}
