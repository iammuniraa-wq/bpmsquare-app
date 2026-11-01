import InfoTip from "@/components/ui/InfoTip";
import Tabs, { type TabDef } from "@/components/ui/Tabs";
import { c } from "@/lib/theme";
import { DW_MODES, dwGroupLabel, type DwCatalogEntry, type DwMode } from "@/lib/import/catalog";
import type { ObjectSpec } from "@/lib/import/types";
import { DW_TIPS } from "./tips";
import s from "./DataWorkbench.module.css";

const MODE_LABEL: Record<DwMode, string> = { import: "Import", export: "Export", update: "Update" };
const MODE_GUIDE: Record<DwMode, string> = { import: "dw.mode.import", export: "dw.mode.export", update: "dw.mode.update" };

/** What the "i" after an object's name says: the catalog note when there is one, otherwise the spec's own description. */
export function objectTip(catalog: DwCatalogEntry, spec: Pick<ObjectSpec, "description">): string {
  return (catalog.note ?? spec.description).trim();
}

/** The tabs of one object: all three modes, the ones it lacks greyed with the reason behind an "i". */
export function modeTabs(catalog: DwCatalogEntry): TabDef[] {
  return DW_MODES.map((m) => {
    const has = catalog.modes.includes(m);
    return { id: m, label: MODE_LABEL[m], guide: MODE_GUIDE[m], disabled: !has, info: has ? undefined : (catalog.modeNote?.[m] ?? DW_TIPS.modeOff) };
  });
}

/**
 * The working area's head: which object this is, where it sits and what it is for, and its three modes as tabs. On a
 * phone the `Change` chip opens the picker as a bottom sheet.
 */
export default function ObjectHeader({ spec, catalog, parentLabel, mode, onMode, onChange }: {
  spec: ObjectSpec;
  catalog: DwCatalogEntry;
  /** Label of the object this one's lines belong to, when it has a parent. */
  parentLabel?: string | null;
  mode: DwMode;
  onMode: (mode: DwMode) => void;
  /** Phones: open the picker. */
  onChange?: () => void;
}) {
  const tip = objectTip(catalog, spec);
  return (
    <>
      <div className={s.head}>
        <div className={s.headIcon} aria-hidden="true">{spec.icon}</div>
        <div style={{ minWidth: 0 }}>
          <div className={s.headTitle}>
            <span>{spec.label}</span>
            {tip && <InfoTip label={spec.label}>{tip}</InfoTip>}
          </div>
          <div style={{ fontSize: 12, color: c.muted }}>
            {dwGroupLabel(catalog.group)}{parentLabel ? ` · lines of ${parentLabel}` : ""}
          </div>
        </div>
        {onChange && (
          <button type="button" className={`bpm-btn bpm-btn-secondary bpm-btn-sm ${s.change}`} data-guide="dw.change" onClick={onChange}>
            Change ▾
          </button>
        )}
      </div>
      <div className={s.tabsWrap}>
        <Tabs tabs={modeTabs(catalog)} value={mode} onChange={(id) => onMode(id as DwMode)} label="Data Workbench modes" />
      </div>
    </>
  );
}
