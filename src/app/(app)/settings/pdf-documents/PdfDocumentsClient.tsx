"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import { Toggle } from "@/components/settings/generalShared";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import { ROUTES, type PdfDesign, type PdfFrameToken, type TenantEntity } from "@/lib/constants";
import type { CompanyInfo } from "@/lib/tenant";
import { DEFAULT_PDF_DESIGN, FRAME_TOKENS, MAX_TOKENS_PER_AREA, TOKEN_LABEL } from "@/lib/pdf/design";
import { resolvePdfFrame } from "@/lib/pdf/frame";
import { PDF_TIPS } from "@/lib/pdf/tips";
import TemplatesListClient from "@/app/(app)/standard-quotes/templates/TemplatesListClient";
import s from "./pdf.module.css";

const TABS = ["frame", "layouts"] as const;
const LABEL: Record<(typeof TABS)[number], string> = { frame: "Page frame", layouts: "Layouts" };

export type LayoutRow = { id: string; name: string; is_default: boolean; updated_at: string };

type ColorKey = keyof PdfDesign["colors"];
const COLOR_LABEL: Record<ColorKey, string> = { text: "Text", band: "Header band", band_text: "Band text", sub_band: "Sub-band", table_head: "Table heading", rule: "Lines" };

const SAMPLE_ENTITY: TenantEntity = { id: "sample", name: "Your Company", short_name: "", address: "Street, City\nP.O. Box 1234", phone: "+000 00 000 0000", email: "info@example.com", crn: "0000000000", vat_number: "000000000000000", is_default: true, extra_ids: [] };

/** Settings > PDF documents. Two tabs: the page frame every framed PDF wears (with a live A4 preview) and the layouts. */
export default function PdfDocumentsClient({ initial, layouts, entity, companyInfo, tenantName, logoUrl, accent }: {
  initial: PdfDesign | null;
  layouts: LayoutRow[];
  entity: TenantEntity | null;
  companyInfo: CompanyInfo;
  tenantName: string;
  logoUrl: string | null;
  accent: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useUrlTab(TABS);
  const [baseline, setBaseline] = useState<PdfDesign | null>(initial);
  const [design, setDesign] = useState<PdfDesign | null>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const dirty = JSON.stringify(design) !== JSON.stringify(baseline);
  const edit = (fn: (d: PdfDesign) => PdfDesign) => { setSaved(false); setDesign((d) => fn(d ?? DEFAULT_PDF_DESIGN)); };

  async function save() {
    setSaving(true); setError(""); setSaved(false);
    const res = await fetch("/api/settings/pdf-design", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ design }) }).catch(() => null);
    setSaving(false);
    if (!res || !res.ok) { setError(res ? ((await res.json().catch(() => ({}))).error ?? "Could not save") : "Network error"); return; }
    const out = (await res.json()) as { design: PdfDesign | null };
    setBaseline(out.design); setDesign(out.design); setSaved(true);
    router.refresh();
  }

  return (
    <>
      {tab === "frame" && <SettingsSave dirty={dirty} saving={saving} saved={saved} error={error} onSave={save} />}
      <Tabs label="PDF documents" tabs={TABS.map((id) => ({ id, label: LABEL[id] }))} value={tab} onChange={(id) => setTab(id)} />
      <div role="tabpanel" aria-label={LABEL[tab as (typeof TABS)[number]]} style={{ marginTop: 14 }}>
        {tab === "frame" && (
          <FrameTab design={design} onToggleStandard={(on) => { setSaved(false); setDesign(on ? null : DEFAULT_PDF_DESIGN); }} edit={edit} entity={entity} companyInfo={companyInfo} tenantName={tenantName} logoUrl={logoUrl} accent={accent} />
        )}
        {tab === "layouts" && (
          <div style={{ maxWidth: 760 }}>
            <div className="bpm-label-row" style={{ marginBottom: 10 }}><span className="bpm-t-label">Layouts</span><InfoTip label="Layouts">{PDF_TIPS.layouts}</InfoTip></div>
            <TemplatesListClient templates={layouts} />
          </div>
        )}
      </div>
    </>
  );
}

function TokenPicker({ label, info, value, onChange }: { label: string; info?: string; value: PdfFrameToken[]; onChange: (v: PdfFrameToken[]) => void }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="bpm-label-row"><span className="bpm-t-label">{label}</span>{info && <InfoTip label={label}>{info}</InfoTip>}</div>
      <div className={s.chips} role="group" aria-label={label}>
        {FRAME_TOKENS.map((t) => {
          const on = value.includes(t);
          return (
            <label key={t} className={s.chip} data-on={on}>
              <input type="checkbox" checked={on} disabled={!on && value.length >= MAX_TOKENS_PER_AREA}
                onChange={(e) => onChange(e.target.checked ? [...value, t] : value.filter((x) => x !== t))} />
              {TOKEN_LABEL[t]}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function FrameTab({ design, onToggleStandard, edit, entity, companyInfo, tenantName, logoUrl, accent }: {
  design: PdfDesign | null;
  onToggleStandard: (standard: boolean) => void;
  edit: (fn: (d: PdfDesign) => PdfDesign) => void;
  entity: TenantEntity | null;
  companyInfo: CompanyInfo;
  tenantName: string;
  logoUrl: string | null;
  accent: string;
}) {
  const d = design ?? DEFAULT_PDF_DESIGN;
  const standard = design === null;
  const set = <K extends keyof PdfDesign>(key: K, patch: Partial<PdfDesign[K]>) => edit((x) => ({ ...x, [key]: { ...(x[key] as object), ...patch } }) as PdfDesign);
  const ids = (entity?.extra_ids ?? []).filter((x) => x.value.trim());

  return (
    <div className={s.shell}>
      <div className={s.panel}>
        <div className={s.card}>
          <div className={s.row}>
            <span className="bpm-label-row"><span className="bpm-t-label">Use the standard look</span><InfoTip label="Use the standard look">{PDF_TIPS.standard}</InfoTip></span>
            <Toggle on={standard} onChange={onToggleStandard} accent={accent} label="Use the standard look" />
          </div>
        </div>

        <div className={`${s.card} ${standard ? s.off : ""}`} aria-disabled={standard}>
          <div className={s.grid2}>
            <Field label="Paper size" info={PDF_TIPS.paper}>
              <Select value={d.page.size} onChange={(e) => set("page", { size: e.target.value as "A4" | "Letter" })} disabled={standard}>
                <option value="A4">A4</option><option value="Letter">Letter</option>
              </Select>
            </Field>
            <Field label="Logo" info={PDF_TIPS.logo}>
              <Select value={d.header.logo} onChange={(e) => set("header", { logo: e.target.value as PdfDesign["header"]["logo"] })} disabled={standard}>
                <option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option><option value="none">None</option>
              </Select>
            </Field>
          </div>
          <TokenPicker label="Header lines" info={PDF_TIPS.headerLines} value={d.header.lines} onChange={(lines) => set("header", { lines })} />
          <TokenPicker label="Footer, left column" info={PDF_TIPS.footerLines} value={d.footer.left} onChange={(left) => set("footer", { left })} />
          <TokenPicker label="Footer, right column" value={d.footer.right} onChange={(right) => set("footer", { right })} />
          <div className="bpm-label-row" style={{ marginTop: 4 }}><span className="bpm-t-label">Colours</span><InfoTip label="Colours">{PDF_TIPS.colours}</InfoTip></div>
          <div className={s.colors}>
            {(Object.keys(COLOR_LABEL) as ColorKey[]).map((k) => (
              <label key={k} className={s.color}>
                <input type="color" value={d.colors[k]} disabled={standard} onChange={(e) => set("colors", { [k]: e.target.value })} aria-label={COLOR_LABEL[k]} />
                {COLOR_LABEL[k]}
              </label>
            ))}
          </div>
          <div className={s.row}>
            <span className="bpm-label-row"><span className="bpm-t-label">Page numbers</span><InfoTip label="Page numbers">{PDF_TIPS.pageNumbers}</InfoTip></span>
            <Toggle on={d.footer.page_numbers} onChange={(v) => set("footer", { page_numbers: v })} accent={accent} label="Page numbers" />
          </div>

          <details className={s.more}>
            <summary>More</summary>
            <div className={s.moreBody}>
              <div className={s.grid2}>
                <Field label="Top margin (mm)" info={PDF_TIPS.margins}><Input type="number" min={20} max={60} value={d.page.margins_mm.top} disabled={standard} onChange={(e) => set("page", { margins_mm: { ...d.page.margins_mm, top: Number(e.target.value) } })} /></Field>
                <Field label="Bottom margin (mm)"><Input type="number" min={14} max={50} value={d.page.margins_mm.bottom} disabled={standard} onChange={(e) => set("page", { margins_mm: { ...d.page.margins_mm, bottom: Number(e.target.value) } })} /></Field>
                <Field label="Left margin (mm)"><Input type="number" min={8} max={40} value={d.page.margins_mm.left} disabled={standard} onChange={(e) => set("page", { margins_mm: { ...d.page.margins_mm, left: Number(e.target.value) } })} /></Field>
                <Field label="Right margin (mm)"><Input type="number" min={8} max={40} value={d.page.margins_mm.right} disabled={standard} onChange={(e) => set("page", { margins_mm: { ...d.page.margins_mm, right: Number(e.target.value) } })} /></Field>
                <Field label="Text size" info={PDF_TIPS.baseSize}>
                  <Select value={String(d.base_pt)} onChange={(e) => edit((x) => ({ ...x, base_pt: Number(e.target.value) as 9 | 10 | 11 }))} disabled={standard}>
                    <option value="9">9 pt</option><option value="10">10 pt</option><option value="11">11 pt</option>
                  </Select>
                </Field>
                <Field label="Font" info={PDF_TIPS.font}>
                  <Select value={d.font} onChange={(e) => edit((x) => ({ ...x, font: e.target.value as PdfDesign["font"] }))} disabled={standard}>
                    <option value="arial_like">Arial-like</option><option value="print_sans">Print sans</option>
                  </Select>
                </Field>
                <Field label="Tables" info={PDF_TIPS.tableStyle}>
                  <Select value={d.table.borders} onChange={(e) => set("table", { borders: e.target.value as "grid" | "rows" })} disabled={standard}>
                    <option value="grid">Grid</option><option value="rows">Rows</option>
                  </Select>
                </Field>
                <Field label="Logo height (mm)"><Input type="number" min={8} max={30} value={d.header.logo_height_mm} disabled={standard} onChange={(e) => set("header", { logo_height_mm: Number(e.target.value) })} /></Field>
              </div>
              <div className={s.row}><span className="bpm-t-label">Title band</span><Toggle on={d.header.title_band} onChange={(v) => set("header", { title_band: v })} accent={accent} label="Title band" /></div>
              <div className={s.row}><span className="bpm-t-label">Footer rule</span><Toggle on={d.footer.rule} onChange={(v) => set("footer", { rule: v })} accent={accent} label="Footer rule" /></div>
              <div className={s.row}><span className="bpm-t-label">Zebra rows</span><Toggle on={d.table.zebra} onChange={(v) => set("table", { zebra: v })} accent={accent} label="Zebra rows" /></div>
            </div>
          </details>
        </div>

        <div className={s.card}>
          <div className={s.source}>
            <span className="bpm-label-row"><span className="bpm-t-label">Company details</span><InfoTip label="Company details">{PDF_TIPS.extraIds}</InfoTip></span>
            <span>{entity?.name || companyInfo.name || tenantName}</span>
            {entity?.crn && <span>C.R. {entity.crn}</span>}
            {(entity?.vat_number || entity?.gstin) && <span>VAT {entity.vat_number || entity.gstin}</span>}
            {ids.map((x) => <span key={x.id}>{x.label}: {x.value}</span>)}
            <Link href={ROUTES.settingsCompany + "?tab=entities"} style={{ minHeight: 44, display: "inline-flex", alignItems: "center", color: "var(--accent)" }}>Edit in Company</Link>
          </div>
        </div>
      </div>

      <Preview design={d} standard={standard} entity={entity ?? SAMPLE_ENTITY} companyInfo={companyInfo} tenantName={tenantName} logoUrl={logoUrl} />
    </div>
  );
}

/** A live A4 (or Letter) preview of the frame with a sample body, drawn from the same resolver the PDF uses. */
function Preview({ design, standard, entity, companyInfo, tenantName, logoUrl }: {
  design: PdfDesign; standard: boolean; entity: TenantEntity; companyInfo: CompanyInfo; tenantName: string; logoUrl: string | null;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const apply = () => setScale(Math.max(0.2, el.clientWidth / (design.page.size === "A4" ? 794 : 816)));
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [design.page.size]);

  const frame = useMemo(() => resolvePdfFrame({
    design, entity, companyInfo, tenantName, logoDataUri: logoUrl, printIds: (entity.extra_ids ?? []).map((x) => x.id),
    title: "QUOTATION", referenceLabel: "RFQ #", reference: "167 / 2026", revision: "Rev. No. 00", fonts: null,
  }), [design, entity, companyInfo, tenantName, logoUrl]);

  const w = design.page.size === "A4" ? 794 : 816;
  const h = design.page.size === "A4" ? 1123 : 1056;
  const mm = 3.7795;
  if (!frame) return null;
  return (
    <div className={s.preview} data-guide="pdf-frame-preview">
      <div className="bpm-label-row" style={{ marginBottom: 6 }}><span className="bpm-t-label">Preview{standard ? " (a sample frame; the standard look is on)" : ""}</span></div>
      <div className={s.previewBox}>
        <div className={s.sheetWrap} ref={wrap} style={{ height: h * scale }}>
          <div className={s.sheet} style={{ width: w, height: h, transform: `scale(${scale})` }}>
            <style>{`${frame.bodyCss}`}</style>
            <div dangerouslySetInnerHTML={{ __html: frame.previewHeaderHtml }} />
            <div className={`pf ${s.sheetBody}`} style={{ top: frame.marginsMm.top * mm, left: frame.marginsMm.left * mm, right: frame.marginsMm.right * mm }}>
              <div className="kv"><b>DATE:</b> <span>10 August 2026</span></div>
              <div className="kv"><b>Company:</b> <span>Sample Customer</span></div>
              <div className="kv"><b>Project Title:</b> <span>Precast foundations</span></div>
              <p style={{ marginTop: "4mm" }}>Dear Sir,</p>
              <div className="band">A. Important information</div>
              <p>This offer is based on the current drawings provided by you. The company reserves the right to reassess if the final drawings change.</p>
              <table>
                <thead><tr><th className="th">SL</th><th className="th" style={{ textAlign: "left" }}>DESCRIPTION</th><th className="th">QTY</th><th className="th">T/VALUE</th></tr></thead>
                <tbody><tr><td className="ctr">1</td><td>Precast foundation 1000 x 1000 x 1200</td><td className="num">400.0</td><td className="num">1,058,000.00</td></tr></tbody>
              </table>
            </div>
            <div className={s.sheetFoot} dangerouslySetInnerHTML={{ __html: frame.previewFooterHtml }} />
          </div>
        </div>
      </div>
    </div>
  );
}
