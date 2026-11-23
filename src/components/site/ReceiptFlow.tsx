"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { c } from "@/lib/theme";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import StatusPill from "@/components/ui/StatusPill";
import { ROUTES } from "@/lib/constants";
import { downscalePhoto, loadBootstrap, newClientId, lastProject, rememberProject, type SiteBootstrap } from "@/lib/site/clientHelpers";
import { submitOrQueue } from "@/lib/site/offlineQueue";
import { cleanReceiptInput, cleanReceiptLine, lineState, summarise, type LineState } from "@/lib/site/receiptRules";
import { CONDITIONS, CONDITION_LABEL, type Condition } from "@/lib/site/types";
import { SITE_TIPS } from "@/lib/site/tips";
import { Banner, BackLink, Chips, SiteFrame, Stepper, StickyBar, WaitingToUpload, sectionCard } from "./siteUi";
import SignaturePad from "./SignaturePad";

type Item = {
  key: string; line_key: string | null; element_code: string; building: string; description: string; uom: string; expected: number | null;
  received: number; rejected: number; condition: Condition; reason: string | null; note: string; open: boolean;
};

const STATE_TONE: Record<LineState, "green" | "amber" | "red" | "blue"> = { ok: "green", short: "amber", over: "amber", rejected: "red", damaged: "amber" };
const STATE_LABEL: Record<LineState, string> = { ok: "OK", short: "Short", over: "More than expected", rejected: "Rejected", damaged: "Damaged" };

const toLine = (i: Item) => ({
  line_key: i.line_key, element_code: i.element_code || null, building: i.building || null, description: i.description, uom: i.uom || null, qty_expected: i.expected,
  qty_received: i.received, qty_accepted: Math.max(0, i.received - i.rejected), qty_rejected: i.rejected, condition: i.condition, reason_code: i.reason, note: i.note || null,
});

/**
 * Receive delivery, in three steps and one primary button each: pick the delivery, check the items (starting from All OK, so a clean delivery
 * is two taps), confirm. A reason is required for anything short, over, rejected or damaged, and a photo for rejected or damaged pieces.
 * A confirmed receipt is evidence and cannot be edited. With no signal the whole receipt is saved on the phone and uploads later.
 */
export default function ReceiptFlow() {
  const params = useSearchParams();
  const clientId = useRef(newClientId());
  const photoInput = useRef<HTMLInputElement>(null);
  const [boot, setBoot] = useState<SiteBootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [project, setProject] = useState("");
  const [packageId, setPackageId] = useState<string | null>(null);
  const [noteRef, setNoteRef] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [addDesc, setAddDesc] = useState("");
  const [addQty, setAddQty] = useState(1);
  const [addCode, setAddCode] = useState("");
  const [driver, setDriver] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<{ blob: Blob; url: string }[]>([]);
  const [signature, setSignature] = useState<Blob | null>(null);
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
  const reasons = boot?.reasons ?? [];

  function pick(deliveryId: string | null) {
    setPackageId(deliveryId);
    const d = proj?.deliveries.find((x) => x.package_id === deliveryId);
    setItems(d ? d.items.map((i, n) => ({
      key: `${i.line_key}-${n}`, line_key: i.line_key, element_code: "", building: i.building ?? "", description: i.description, uom: i.uom ?? "", expected: i.qty_expected,
      received: i.qty_expected ?? 0, rejected: 0, condition: "ok", reason: null, note: "", open: false,
    })) : []);
    setStep(2);
  }
  const patch = (key: string, p: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));
  function allOk() { setItems((list) => list.map((i) => ({ ...i, received: i.expected ?? i.received, rejected: 0, condition: "ok", reason: null, note: "", open: false }))); }
  function addManual() {
    if (!addDesc.trim()) return;
    setItems((list) => [...list, { key: `m-${Date.now()}-${list.length}`, line_key: null, element_code: addCode.trim(), building: "", description: addDesc.trim(), uom: "", expected: null, received: addQty, rejected: 0, condition: "ok", reason: null, note: "", open: false }]);
    setAddDesc(""); setAddQty(1); setAddCode("");
  }

  const errors = useMemo(() => items.map((i) => { const r = cleanReceiptLine(toLine(i), 0); return r.ok ? null : r.error.replace(/^Line 1: /, ""); }), [items]);
  const sum = useMemo(() => summarise(items.map((i) => ({ ...toLine(i), condition: i.condition } as Parameters<typeof summarise>[0][number]))), [items]);
  const needsPhoto = items.some((i) => i.rejected > 0 || i.condition !== "ok");

  async function addPhoto(file: File | undefined) {
    if (!file) return;
    const blob = await downscalePhoto(file);
    setPhotos((p) => [...p, { blob, url: URL.createObjectURL(blob) }]);
  }

  async function confirm() {
    setProblem(null);
    if (!proj) { setProblem("Choose the project"); return; }
    if (needsPhoto && photos.length === 0) { setProblem("Add a photo of the rejected or damaged pieces"); return; }
    const payload = {
      client_id: clientId.current, project_id: proj.id, package_id: packageId, delivery_note_ref: noteRef || null, source_type: packageId ? "package" : "manual",
      received_at: new Date().toISOString(), handed_by: driver || null, vehicle: vehicle || null, note: note || null, lines: items.map(toLine),
    };
    const check = cleanReceiptInput(payload, { now: new Date() });
    if (!check.ok) { setProblem(check.error); return; }
    setBusy(true);
    rememberProject(proj.id);
    const r = await submitOrQueue({ id: clientId.current, kind: "receipt", payload, photos: photos.map((p) => p.blob), signature, label: noteRef || `${items.length} items`, queuedAt: new Date().toISOString() });
    setBusy(false);
    if (r.state === "refused") { setProblem(r.error ?? "Could not save the receipt"); return; }
    setDone(r.state);
  }

  if (error) return <SiteFrame><BackLink href={ROUTES.siteHome} label="Site" /><Banner tone="bad">{error}</Banner></SiteFrame>;
  if (!boot) return <SiteFrame><div style={{ color: c.hint, fontSize: 13 }}>Loading…</div></SiteFrame>;
  if (done) {
    return (
      <SiteFrame>
        <Banner tone={done === "saved" ? "good" : "warn"}>{done === "saved" ? "Receipt confirmed." : "Saved on this phone. It uploads when there is signal."}</Banner>
        <a href={ROUTES.siteReceiptNew + (proj ? `?project=${proj.id}` : "")} className="bpm-btn bpm-btn-primary bpm-btn-md">Receive another delivery</a>
        <a href={ROUTES.siteHome} className="bpm-btn bpm-btn-secondary bpm-btn-md">Back to Site</a>
        <WaitingToUpload />
      </SiteFrame>
    );
  }

  const header = (title: string, back: () => void) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button type="button" aria-label="Back" className="bpm-btn bpm-btn-quiet bpm-btn-md" onClick={back}>←</button>
      <h1 style={{ fontSize: 20, margin: 0, color: c.ink }}>{title}</h1>
      <span style={{ marginLeft: "auto", fontSize: 12, color: c.hint }}>Step {step} of 3</span>
    </div>
  );

  // ── Step 1: pick the delivery ────────────────────────────────────────────────────────────────────────────────────
  if (step === 1) {
    return (
      <SiteFrame>
        <BackLink href={ROUTES.siteHome} label="Site" />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h1 style={{ fontSize: 20, margin: 0, color: c.ink }}>Receive delivery</h1>
          <InfoTip label="Receive delivery">{SITE_TIPS.receiptStep1}</InfoTip>
          <span style={{ marginLeft: "auto", fontSize: 12, color: c.hint }}>Step 1 of 3</span>
        </div>
        {boot.projects.length > 1 && (
          <Field label="Project">
            <select className="bpm-input" value={project} onChange={(e) => setProject(e.target.value)}>
              {boot.projects.map((p) => <option key={p.id} value={p.id}>{p.ref ? `${p.ref} · ` : ""}{p.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Delivery note number"><input className="bpm-input" value={noteRef} maxLength={100} onChange={(e) => setNoteRef(e.target.value)} placeholder="DN-24817" /></Field>
        {(proj?.deliveries ?? []).length > 0 && <strong style={{ fontSize: 12.5, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4 }}>Expected</strong>}
        {(proj?.deliveries ?? []).map((d) => (
          <button key={d.package_id} type="button" onClick={() => pick(d.package_id)} style={{ ...sectionCard, textAlign: "left", cursor: "pointer", minHeight: 64 }}>
            <span style={{ fontWeight: 700, color: c.ink, fontSize: 15 }}>{d.ref ? `${d.ref} · ` : ""}{d.name}</span>
            <span style={{ fontSize: 12.5, color: c.hint }}>{d.supplier_name ? `${d.supplier_name} · ` : ""}{d.items.length} item{d.items.length === 1 ? "" : "s"}</span>
          </button>
        ))}
        <button type="button" onClick={() => pick(null)} className="bpm-btn bpm-btn-secondary bpm-btn-md" style={{ minHeight: 56 }}>Something else (no delivery on the list)</button>
      </SiteFrame>
    );
  }

  // ── Step 2: check the items ──────────────────────────────────────────────────────────────────────────────────────
  if (step === 2) {
    const blocked = items.length === 0 || errors.some(Boolean);
    return (
      <SiteFrame>
        {header(noteRef || "Check the items", () => setStep(1))}
        {items.some((i) => i.expected !== null) && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button type="button" className="bpm-btn bpm-btn-primary bpm-btn-md" style={{ minHeight: 48 }} onClick={allOk} data-guide="site.receipt.allok">All OK</button>
            <InfoTip label="All OK">{SITE_TIPS.allOk}</InfoTip>
          </div>
        )}
        {items.map((i, n) => {
          const st = lineState({ qty_expected: i.expected, qty_received: i.received, qty_accepted: i.received - i.rejected, qty_rejected: i.rejected, condition: i.condition });
          return (
            <section key={i.key} style={sectionCard}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: c.ink, fontSize: 14.5, overflowWrap: "anywhere" }}>{i.element_code ? `${i.element_code} · ` : ""}{i.description}</div>
                  <div style={{ fontSize: 12.5, color: c.hint }}>{i.expected === null ? "Not on the list" : `Expected ${i.expected}${i.uom ? ` ${i.uom}` : ""}`}</div>
                </div>
                <StatusPill label={STATE_LABEL[st]} tone={STATE_TONE[st]} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <Stepper label={`Received, item ${n + 1}`} value={i.received} onChange={(v) => patch(i.key, { received: v, rejected: Math.min(i.rejected, v) })} />
                <button type="button" className="bpm-btn bpm-btn-secondary bpm-btn-md" aria-expanded={i.open} onClick={() => patch(i.key, { open: !i.open })}>{i.open || st !== "ok" ? "Problem ▾" : "Problem ▸"}</button>
              </div>
              {(i.open || st !== "ok") && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <Field label="Condition">
                    <Chips label="Condition" value={i.condition} onChange={(v) => patch(i.key, { condition: v })} options={CONDITIONS.map((k) => ({ id: k, label: CONDITION_LABEL[k] }))} />
                  </Field>
                  <Field label="Rejected pieces" info={SITE_TIPS.accepted}>
                    <Stepper label={`Rejected, item ${n + 1}`} value={i.rejected} max={i.received} onChange={(v) => patch(i.key, { rejected: v })} />
                  </Field>
                  <Field label="Reason" info={SITE_TIPS.reason}>
                    <Chips label="Reason" value={i.reason} onChange={(v) => patch(i.key, { reason: v })} options={reasons.map((r) => ({ id: r.code, label: r.label }))} />
                  </Field>
                  <Field label="Note"><input className="bpm-input" value={i.note} maxLength={500} onChange={(e) => patch(i.key, { note: e.target.value })} /></Field>
                </div>
              )}
              {errors[n] && <div role="alert" style={{ fontSize: 12.5, color: "var(--redink)" }}>{errors[n]}</div>}
            </section>
          );
        })}
        <section style={sectionCard}>
          <strong style={{ fontSize: 13, color: c.ink }}>Add an item that is not on the list</strong>
          <input className="bpm-input" aria-label="Item description" placeholder="What is it" value={addDesc} maxLength={300} onChange={(e) => setAddDesc(e.target.value)} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <input className="bpm-input" aria-label="Element code" placeholder="Tag, as on the note" value={addCode} maxLength={80} style={{ flex: 1, minWidth: 120 }} onChange={(e) => setAddCode(e.target.value)} />
            <InfoTip label="Element code">{SITE_TIPS.elementCode}</InfoTip>
            <Stepper label="Quantity" value={addQty} onChange={setAddQty} />
          </div>
          <button type="button" className="bpm-btn bpm-btn-secondary bpm-btn-md" disabled={!addDesc.trim()} onClick={addManual}>Add item</button>
        </section>
        <StickyBar>
          <button type="button" className="bpm-btn bpm-btn-primary bpm-btn-md" style={{ flex: 1, minHeight: 48, fontSize: 16 }} disabled={blocked} onClick={() => setStep(3)}>Continue</button>
        </StickyBar>
      </SiteFrame>
    );
  }

  // ── Step 3: confirm ──────────────────────────────────────────────────────────────────────────────────────────────
  return (
    <SiteFrame>
      {header("Confirm receipt", () => setStep(2))}
      <section style={{ ...sectionCard, flexDirection: "row", justifyContent: "space-around", textAlign: "center" }} aria-label="Summary">
        <div><div style={{ fontSize: 22, fontWeight: 700, color: "var(--greenink)" }}>{sum.accepted}</div><div style={{ fontSize: 12, color: c.hint }}>Accepted</div></div>
        <div><div style={{ fontSize: 22, fontWeight: 700, color: sum.rejected ? "var(--redink)" : c.ink }}>{sum.rejected}</div><div style={{ fontSize: 12, color: c.hint }}>Rejected</div></div>
        <div><div style={{ fontSize: 22, fontWeight: 700, color: sum.short ? "var(--amberink)" : c.ink }}>{sum.short}</div><div style={{ fontSize: 12, color: c.hint }}>Short</div></div>
      </section>
      <section style={sectionCard}>
        <Field label="Received by"><div style={{ fontSize: 14, color: c.ink, minHeight: 44, display: "flex", alignItems: "center" }}>You, as signed in</div></Field>
        <Field label="Driver"><input className="bpm-input" value={driver} maxLength={200} onChange={(e) => setDriver(e.target.value)} /></Field>
        <Field label="Vehicle"><input className="bpm-input" value={vehicle} maxLength={100} onChange={(e) => setVehicle(e.target.value)} placeholder="Truck, plate" /></Field>
        <Field label="Note"><input className="bpm-input" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></Field>
      </section>
      <section style={sectionCard}>
        <Field label={needsPhoto ? "Photos (required)" : "Photos"}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {photos.map((p, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={p.url} src={p.url} alt={`Photo ${i + 1}`} style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, border: `1px solid ${c.line}` }} />
            ))}
            {photos.length < 8 && <button type="button" className="bpm-btn bpm-btn-secondary bpm-btn-md" onClick={() => photoInput.current?.click()}>+ Add photo</button>}
          </div>
          <input ref={photoInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void addPhoto(e.target.files?.[0]); e.target.value = ""; }} />
        </Field>
        <Field label="Signature" info={SITE_TIPS.signature}><SignaturePad onChange={setSignature} /></Field>
      </section>
      {sum.rejected > 0 || sum.short > 0 ? <Banner tone="warn">The project manager is told about the rejected and missing pieces.</Banner> : null}
      {problem && <Banner tone="bad">{problem}</Banner>}
      <StickyBar>
        <button type="button" className="bpm-btn bpm-btn-primary bpm-btn-md" style={{ flex: 1, minHeight: 48, fontSize: 16 }} disabled={busy} onClick={confirm}>{busy ? "Saving…" : "Confirm receipt"}</button>
      </StickyBar>
    </SiteFrame>
  );
}
