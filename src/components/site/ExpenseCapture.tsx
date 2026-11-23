"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { c } from "@/lib/theme";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import { ROUTES } from "@/lib/constants";
import { downscalePhoto, loadBootstrap, newClientId, lastProject, rememberProject, type SiteBootstrap } from "@/lib/site/clientHelpers";
import { submitOrQueue } from "@/lib/site/offlineQueue";
import { cleanExpenseInput } from "@/lib/site/expenseRules";
import { PAID_BY, PAID_BY_LABEL, type PaidBy } from "@/lib/site/types";
import { SITE_TIPS } from "@/lib/site/tips";
import { Banner, BackLink, Chips, SiteFrame, StickyBar, WaitingToUpload, sectionCard } from "./siteUi";

type Read = { amount: number | null; currency: string | null; expense_date: string | null; vendor_text: string | null; vat_amount: number | null; invoice_ref: string | null; category_name: string | null; note: string | null };
type ReadState = "idle" | "reading" | "done" | "later" | "failed";

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Add expense: the camera opens first, the receipt photo is the form. The fields the reader found are marked "read" and the person only
 * checks them; three things make an expense (a photo, a category, Submit). With no signal it is saved on the phone with its photos and
 * uploads later; a refusal from the server (a closed project, a bad amount) is shown on the spot.
 */
export default function ExpenseCapture() {
  const params = useSearchParams();
  const clientId = useRef(newClientId());
  const fileInput = useRef<HTMLInputElement>(null);
  const [boot, setBoot] = useState<SiteBootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState("");
  const [photos, setPhotos] = useState<{ blob: Blob; url: string }[]>([]);
  const [readState, setReadState] = useState<ReadState>("idle");
  const [readFields, setReadFields] = useState<Set<string>>(new Set());
  const [aiRead, setAiRead] = useState<Read | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [vendor, setVendor] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [line, setLine] = useState("");
  const [toFollow, setToFollow] = useState(false);
  const [more, setMore] = useState(false);
  const [vat, setVat] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [paidBy, setPaidBy] = useState<PaidBy>("company");
  const [note, setNote] = useState("");
  const [currency, setCurrency] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<"saved" | "queued" | null>(null);

  useEffect(() => {
    void loadBootstrap().then(({ data, error: e }) => {
      if (!data) { setError(e ?? "Nothing to show."); return; }
      setBoot(data);
      const want = params.get("project") ?? lastProject();
      setProject(data.projects.find((p) => p.id === want)?.id ?? data.projects[0]?.id ?? "");
    });
  }, [params]);

  const proj = useMemo(() => boot?.projects.find((p) => p.id === project) ?? null, [boot, project]);
  // The cost line is preselected when exactly one budget line of the chosen category's resource type exists; otherwise it is a short picker.
  const lines = proj?.lines ?? [];
  useEffect(() => { setLine(""); setCurrency(proj?.currency ?? ""); }, [project]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addPhoto(file: File | undefined) {
    if (!file) return;
    const blob = await downscalePhoto(file);
    setPhotos((p) => [...p, { blob, url: URL.createObjectURL(blob) }]);
    if (photos.length > 0 || readState === "reading") return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) { setReadState("later"); return; }
    setReadState("reading");
    try {
      const form = new FormData();
      form.append("photo", blob, "receipt.jpg");
      const res = await fetch("/api/site-expenses/read", { method: "POST", body: form });
      if (!res.ok) { setReadState("failed"); return; }
      const r = ((await res.json()).read ?? null) as Read | null;
      if (!r) { setReadState("failed"); return; }
      const got = new Set<string>();
      if (r.amount !== null) { setAmount(String(r.amount)); got.add("amount"); }
      if (r.expense_date) { setDate(r.expense_date); got.add("date"); }
      if (r.vendor_text) { setVendor(r.vendor_text); got.add("vendor"); }
      if (r.vat_amount !== null) { setVat(String(r.vat_amount)); got.add("vat"); }
      if (r.invoice_ref) { setInvoiceRef(r.invoice_ref); got.add("invoice"); }
      if (r.currency && r.currency !== proj?.currency) setCurrency(r.currency);
      const cat = boot?.categories.find((x) => x.name === r.category_name);
      if (cat) { setCategory(cat.id); got.add("category"); }
      setReadFields(got); setAiRead(r); setReadState("done");
    } catch { setReadState("later"); }
  }

  // The cost line is preselected when exactly one budget line has the category's resource type; otherwise the person picks or leaves "Not sure".
  function pickCategory(id: string) {
    setCategory(id);
    const code = boot?.categories.find((x) => x.id === id)?.resource_code;
    if (!code || line) return;
    const same = lines.filter((l) => l.resource_code === code);
    if (same.length === 1) setLine(same[0].line_key);
  }

  const readTag = (k: string) => (readFields.has(k) ? <span style={{ fontSize: 11, color: "var(--blueink)", background: "var(--bluebg)", borderRadius: 8, padding: "1px 6px", marginLeft: 6 }}>read</span> : null);

  async function submit() {
    setProblem(null);
    if (!boot || !proj) { setProblem("Choose the project"); return; }
    if (!category) { setProblem("Choose a category"); return; }
    if (!toFollow && photos.length === 0) { setProblem("Take a photo of the receipt, or turn on Invoice to follow"); return; }
    const payload = {
      client_id: clientId.current, project_id: proj.id, category_id: category, line_key: line || null, expense_date: date, amount, currency: currency || proj.currency || "SAR",
      vat_amount: vat || null, vendor_text: vendor || null, document_state: toFollow ? "invoice_to_follow" : "receipt_attached", invoice_ref: invoiceRef || null,
      paid_by: paidBy, note: note || null, source_type: aiRead ? "photo" : "manual",
      ai_read: aiRead ? { ...aiRead, state: readState, at: new Date().toISOString() } : readState === "later" ? { state: "later" } : null,
    };
    // The same checks the server makes, so a mistake is told here and not after a queue.
    const check = cleanExpenseInput(payload, { today: todayIso(), projectCurrency: proj.currency ?? "SAR" });
    if (!check.ok) { setProblem(check.error); return; }
    setBusy(true);
    rememberProject(proj.id);
    const catName = boot.categories.find((x) => x.id === category)?.name ?? "Expense";
    const r = await submitOrQueue({ id: clientId.current, kind: "expense", payload, photos: photos.map((p) => p.blob), signature: null, label: `${vendor || catName} ${amount}`, queuedAt: new Date().toISOString() });
    setBusy(false);
    if (r.state === "refused") { setProblem(r.error ?? "Could not save the expense"); return; }
    setDone(r.state);
  }

  if (error) return <SiteFrame><BackLink href={ROUTES.siteHome} label="Site" /><Banner tone="bad">{error}</Banner></SiteFrame>;
  if (!boot) return <SiteFrame><div style={{ color: c.hint, fontSize: 13 }}>Loading…</div></SiteFrame>;
  if (done) {
    return (
      <SiteFrame>
        <Banner tone={done === "saved" ? "good" : "warn"}>{done === "saved" ? "Sent. It is waiting for the manager." : "Saved on this phone. It uploads when there is signal."}</Banner>
        {/* A plain anchor, so the next expense starts with a fresh form and a fresh capture id. */}
        <a href={ROUTES.siteExpenseNew + (proj ? `?project=${proj.id}` : "")} className="bpm-btn bpm-btn-primary bpm-btn-md">Add another</a>
        <Link href={ROUTES.siteHome} className="bpm-btn bpm-btn-secondary bpm-btn-md">Back to Site</Link>
        <WaitingToUpload />
      </SiteFrame>
    );
  }

  return (
    <SiteFrame>
      <BackLink href={ROUTES.siteHome} label="Site" />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h1 style={{ fontSize: 20, margin: 0, color: c.ink }}>Add expense</h1>
        {typeof navigator !== "undefined" && navigator.onLine === false && <span style={{ fontSize: 12, color: "var(--amberink)" }}>Offline</span>}
      </div>

      <section style={sectionCard} data-guide="site.expense.photo">
        <input ref={fileInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void addPhoto(e.target.files?.[0]); e.target.value = ""; }} />
        {photos.length === 0 ? (
          <button type="button" className="bpm-btn bpm-btn-primary bpm-btn-md" style={{ minHeight: 64, fontSize: 16 }} onClick={() => fileInput.current?.click()}>Take photo of the receipt</button>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {photos.map((p, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={p.url} src={p.url} alt={`Receipt photo ${i + 1}`} style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, border: `1px solid ${c.line}` }} />
            ))}
            {photos.length < 8 && <button type="button" className="bpm-btn bpm-btn-secondary bpm-btn-md" onClick={() => fileInput.current?.click()}>+ Add</button>}
          </div>
        )}
        {readState === "reading" && <div role="status" style={{ fontSize: 12.5, color: c.hint }}>Reading the photo…</div>}
        {readState === "done" && <div style={{ fontSize: 12.5, color: c.hint, display: "flex", alignItems: "center", gap: 4 }}>Read from photo. Please check. <InfoTip label="Read from photo">{SITE_TIPS.readFromPhoto}</InfoTip></div>}
        {readState === "later" && <div style={{ fontSize: 12.5, color: "var(--amberink)" }}>Read later, please check it when you are back online.</div>}
        {readState === "failed" && <div style={{ fontSize: 12.5, color: c.hint }}>The photo could not be read. Type the amount.</div>}
      </section>

      <section style={sectionCard}>
        {boot.projects.length > 1 && (
          <Field label="Project">
            <select className="bpm-input" value={project} onChange={(e) => setProject(e.target.value)}>
              {boot.projects.map((p) => <option key={p.id} value={p.id}>{p.ref ? `${p.ref} · ` : ""}{p.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Amount" required>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input className="bpm-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" aria-label="Amount" style={{ flex: 1 }} />
            <span style={{ color: c.muted, fontSize: 13 }}>{currency || proj?.currency || ""}</span>
            {readTag("amount")}
          </div>
        </Field>
        <Field label="Date">
          <div style={{ display: "flex", alignItems: "center" }}>
            <input className="bpm-input" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} aria-label="Date" style={{ flex: 1 }} />{readTag("date")}
          </div>
        </Field>
        <Field label="Vendor">
          <div style={{ display: "flex", alignItems: "center" }}>
            <input className="bpm-input" value={vendor} onChange={(e) => setVendor(e.target.value)} aria-label="Vendor" style={{ flex: 1 }} />{readTag("vendor")}
          </div>
        </Field>
        <Field label="Category" required info={SITE_TIPS.category}>
          <Chips label="Category" value={category} onChange={pickCategory} options={boot.categories.map((x) => ({ id: x.id, label: x.name }))} />
        </Field>
        <Field label="Cost line" info={SITE_TIPS.costLine}>
          <select className="bpm-input" value={line} onChange={(e) => setLine(e.target.value)} aria-label="Cost line">
            <option value="">Not sure</option>
            {lines.map((l) => <option key={l.line_key} value={l.line_key}>{l.description}</option>)}
          </select>
        </Field>
        <label style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, fontSize: 14, color: c.ink, cursor: "pointer" }}>
          <input type="checkbox" checked={toFollow} onChange={(e) => setToFollow(e.target.checked)} style={{ width: 20, height: 20 }} />
          Invoice to follow <InfoTip label="Invoice to follow">{SITE_TIPS.invoiceToFollow}</InfoTip>
        </label>
      </section>

      <section style={sectionCard}>
        <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="bpm-btn bpm-btn-quiet bpm-btn-md" style={{ justifyContent: "flex-start" }}>{more ? "▾" : "▸"} More</button>
        {more && (
          <>
            <Field label="VAT amount"><input className="bpm-input" inputMode="decimal" value={vat} onChange={(e) => setVat(e.target.value)} />{readTag("vat")}</Field>
            <Field label="Invoice number"><input className="bpm-input" value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} />{readTag("invoice")}</Field>
            <Field label="Currency"><input className="bpm-input" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} aria-label="Currency" /></Field>
            <Field label="Paid by" info={SITE_TIPS.paidBy}>
              <select className="bpm-input" value={paidBy} onChange={(e) => setPaidBy(e.target.value as PaidBy)}>
                {PAID_BY.map((p) => <option key={p} value={p}>{PAID_BY_LABEL[p]}</option>)}
              </select>
            </Field>
            <Field label="Note"><textarea className="bpm-input" rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></Field>
          </>
        )}
      </section>

      {problem && <Banner tone="bad">{problem}</Banner>}
      <StickyBar>
        <button type="button" className="bpm-btn bpm-btn-primary bpm-btn-md" style={{ flex: 1, minHeight: 48, fontSize: 16 }} disabled={busy} onClick={submit}>{busy ? "Saving…" : "Submit"}</button>
      </StickyBar>
    </SiteFrame>
  );
}
