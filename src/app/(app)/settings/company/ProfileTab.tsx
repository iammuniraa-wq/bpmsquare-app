"use client";

import { useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import { resizeImageFile } from "@/lib/resizeImage";
import type { CompanyInfo } from "@/lib/tenant";
import type { CompanyDraft } from "./companyLogic";
import { COMPANY_TIPS } from "./tips";
import s from "./company.module.css";

type Profile = CompanyDraft["profile"];
type Logo = { name: string; logo_url?: string };

const LOGO_MAX = { main: [400, 300], small: [300, 150] } as const;

/** Resize to fit and store; the address comes back as a public URL. */
async function uploadImage(file: File, max: readonly [number, number]): Promise<string> {
  const resized = await resizeImageFile(file, max[0], max[1]);
  const form = new FormData();
  form.append("file", resized);
  const res = await fetch("/api/upload", { method: "POST", body: form });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Upload failed");
  return json.url as string;
}

function LogoPicker({ url, onChange, max, small, label }: { url: string; onChange: (url: string) => void; max: readonly [number, number]; small?: boolean; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(""); setBusy(true);
    try { onChange(await uploadImage(file, max)); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); if (ref.current) ref.current.value = ""; }
  };
  return (
    <div className={s.logoRow}>
      <div className={`${s.logoBox} ${small ? s.logoSmall : ""}`}>{url ? <img src={url} alt={label} /> : "No logo"}</div>
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pick} aria-label={`Upload ${label}`} />
      <Button size="sm" onClick={() => ref.current?.click()} loading={busy}>{url ? "Replace" : "Upload"}</Button>
      {url && <Button size="sm" variant="quiet" onClick={() => onChange("")}>Remove</Button>}
      {err && <span role="alert" className="bpm-t-help" style={{ color: "var(--err-ink)" }}>{err}</span>}
    </div>
  );
}

function LogoList({ title, tip, items, onChange, noun }: { title: string; tip: string; items: Logo[]; onChange: (next: Logo[]) => void; noun: string }) {
  const set = (i: number, patch: Partial<Logo>) => onChange(items.map((x, xi) => (xi === i ? { ...x, ...patch } : x)));
  return (
    <>
      <div className={s.subhead}>{title}<InfoTip label={title}>{tip}</InfoTip></div>
      {items.map((it, i) => (
        <div key={i} className={s.itemRow}>
          <LogoPicker url={it.logo_url ?? ""} onChange={(u) => set(i, { logo_url: u })} max={LOGO_MAX.small} small label={`${noun} ${i + 1} logo`} />
          <Input aria-label={`${noun} ${i + 1} name`} value={it.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Name" />
          <Button size="sm" variant="quiet" onClick={() => onChange(items.filter((_, xi) => xi !== i))}>Remove</Button>
        </div>
      ))}
      <Button size="sm" onClick={() => onChange([...items, { name: "", logo_url: "" }])}>+ Add {noun.toLowerCase()}</Button>
    </>
  );
}

function PhoneList({ phones, onChange }: { phones: NonNullable<CompanyInfo["phones"]>; onChange: (next: NonNullable<CompanyInfo["phones"]>) => void }) {
  const set = (i: number, patch: Partial<{ label: string; number: string }>) => onChange(phones.map((p, pi) => (pi === i ? { ...p, ...patch } : p)));
  return (
    <>
      <div className={s.subhead}>Phone numbers<InfoTip label="Phone numbers">{COMPANY_TIPS.phones}</InfoTip></div>
      {phones.map((p, i) => (
        <div key={i} className={s.phoneRow}>
          <Input aria-label={`Phone ${i + 1} label`} value={p.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="Label" />
          <Input aria-label={`Phone ${i + 1} number`} value={p.number} onChange={(e) => set(i, { number: e.target.value })} placeholder="+91 98000 00000" />
          <Button size="sm" variant="quiet" onClick={() => onChange(phones.filter((_, pi) => pi !== i))}>Remove</Button>
        </div>
      ))}
      <Button size="sm" onClick={() => onChange([...phones, { label: "", number: "" }])}>+ Add phone</Button>
    </>
  );
}

/**
 * One company profile: the name every screen and document uses, and the letterhead details printed on quotations
 * and invoices. A workspace that prints nothing is asked for the name alone.
 */
export default function ProfileTab({ draft, letterhead, onName, onPrintName, onProfile }: {
  draft: CompanyDraft;
  letterhead: boolean;
  onName: (name: string) => void;
  onPrintName: (name: string) => void;
  onProfile: (patch: Partial<Profile>) => void;
}) {
  const p = draft.profile;
  const text = (key: keyof Profile) => ({
    value: (p[key] as string | undefined) ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => onProfile({ [key]: e.target.value } as Partial<Profile>),
  });
  return (
    <div className={s.card}>
      <div className={s.grid}>
        <Field label="Company name" info={COMPANY_TIPS.name} style={{ gridColumn: "1 / -1" }}>
          <Input value={draft.name} onChange={(e) => onName(e.target.value)} placeholder="Acme Corporation" />
        </Field>
        {letterhead && (
          <>
            <Field label="Logo" info={COMPANY_TIPS.logo} style={{ gridColumn: "1 / -1" }}>
              <LogoPicker url={p.logo_url ?? ""} onChange={(u) => onProfile({ logo_url: u })} max={LOGO_MAX.main} label="Company logo" />
            </Field>
            <Field label="Address" style={{ gridColumn: "1 / -1" }}><Input {...text("address")} placeholder="Street, City, State, PIN" /></Field>
            <Field label="Email"><Input type="email" {...text("email")} placeholder="info@company.com" /></Field>
            <Field label="Website"><Input {...text("web")} placeholder="www.company.com" /></Field>
            <Field label="Tax ID" info={COMPANY_TIPS.taxId}><Input {...text("gstin")} className={s.mono} placeholder="29AXXXXX0000X0XX" /></Field>
            <Field label="Tagline" info={COMPANY_TIPS.tagline}><Input {...text("tagline")} placeholder="Engineering excellence since 1990" /></Field>
          </>
        )}
      </div>

      {letterhead && (
        <details className={s.more}>
          <summary>More letterhead details</summary>
          <div className={s.moreBody}>
            {draft.printName !== "" && (
              <Field label="Name on printed documents" info={COMPANY_TIPS.printName}>
                <Input value={draft.printName} onChange={(e) => onPrintName(e.target.value)} />
              </Field>
            )}
            <div className={s.grid}>
              <Field label="Second email"><Input type="email" {...text("email2")} placeholder="sales@company.com" /></Field>
              <Field label="Footer line" info={COMPANY_TIPS.footerTagline}><Input {...text("footer_tagline")} /></Field>
              <Field label="Header strip" info={COMPANY_TIPS.undertaking} style={{ gridColumn: "1 / -1" }}><Input {...text("undertaking")} placeholder="Rewinding of LT | HT motors and transformers" /></Field>
              <Field label="Logo background" info={COMPANY_TIPS.logoBg}>
                <Input type="color" value={p.logo_bg ?? "#378ADD"} onChange={(e) => onProfile({ logo_bg: e.target.value })} aria-label="Logo background colour" style={{ height: 44, padding: 4 }} />
              </Field>
              {(p.iso ?? "") !== "" && (p.certifications ?? []).length === 0 && (
                <Field label="Old ISO text" info={COMPANY_TIPS.oldIso}><Input {...text("iso")} /></Field>
              )}
            </div>
            <PhoneList phones={p.phones ?? []} onChange={(next) => onProfile({ phones: next })} />
            <LogoList title="Accreditation logos" tip={COMPANY_TIPS.accreditations} noun="Accreditation" items={p.certifications ?? []} onChange={(next) => onProfile({ certifications: next })} />
            <LogoList title="Partner logos" tip={COMPANY_TIPS.partners} noun="Partner" items={p.partners ?? []} onChange={(next) => onProfile({ partners: next })} />
          </div>
        </details>
      )}
    </div>
  );
}
